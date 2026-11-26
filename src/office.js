import { randomUUID } from 'node:crypto';
import { active, live } from './store.js';
import { choice, fail, ids, integer, string } from './input.js';
import { createSettings, priorities, taskStates } from './settings.js';
import { projectFields } from './workspace.js';
import { runtimeInstructions } from './runtimes.js';
import { createTaskDiscussion } from './task-discussion.js';
import { avatarIds } from '../public/office-avatars.js';
import { assignWorkstation } from './workstations.js';
import { mcpFields } from './agent-capabilities.js';
import { agentPermissionDefinitions, effectiveAgentPermissions, agentAuthorization, agentCanExecute } from '../public/agent-permissions.js';
import { candidateRuntimes, runnerConnected } from '../public/discovery-model.js';
import { normalizeGithubScope, snapshotGithubAccess } from './github-integration.js';

const terminal = ['completed', 'failed', 'cancelled', 'interrupted'];
const maxTokens = 1_000_000_000_000;
const modelRuntimes = ['codex', 'pi'];
const time = () => new Date().toISOString();
const field = (value, label, limit = 120) => string(value, label, limit);
const note = (value, label, limit = 8000) => string(value, label, limit, true);

export function createOffice(store, settings = createSettings(store), space) {
  const { get, put, remove, list, tx, event } = store;
  const discussion = createTaskDiscussion(store, settings, enqueueReply);
  const childrenOf = id => list('task').filter(task => task.parentId === id);
  function requireRecord(kind, id, label) {
    const record = get(kind, id);
    if (!record) fail(`${label}不存在`, 404);
    return record;
  }

  function saveNamed(kind, input, source) {
    const labels = {team: '小组', skill: '技能', project: '项目'};
    const label = labels[kind];
    const before = input.id ? requireRecord(kind, input.id, label) : null;
    return tx(() => {
      const record = put(kind, {
        id: before?.id ?? randomUUID(),
        name: field(input.name, label + '名称'),
        description: note(input.description, label + '说明'),
        ...(kind === 'skill' ? {instructions:note(input.instructions ?? before?.instructions, 'SKILL.md 正文', 32_000),
          ...((source ?? before?.source) ? {source:source ?? before.source} : {})} : {}),
        ...(kind === 'project' ? projectFields(input, before) : {}),
        version: (before?.version ?? 0) + 1,
      });
      event(`${kind}.saved`, {id: record.id, name: record.name});
      return record;
    });
  }

  function saveMcpServer(input) {
    return tx(() => {
      const before = input.id ? requireRecord('mcpServer', input.id, 'MCP 服务') : null;
      const record = put('mcpServer', {
        id:before?.id ?? randomUUID(), name:field(input.name, 'MCP 服务名称'),
        ...mcpFields(input, before), version:(before?.version ?? 0) + 1,
      });
      event('mcp.saved', {id:record.id, name:record.name, enabled:record.enabled});
      return record;
    });
  }

  function deleteTeam(id) {
    return tx(() => {
      const team = requireRecord('team', id, '小组');
      for (const agent of list('agent')) {
        if (agent.teamId === id) put('agent', {...agent, teamId: null});
      }
      for (const human of list('human')) {
        if (human.teamId === id) put('human', {...human, teamId: null});
      }
      for (const candidate of list('candidate')) {
        if (candidate.draft?.teamId === id) {
          put('candidate', {...candidate, draft: {...candidate.draft, teamId: null}});
        }
      }
      const layout = get('setting', 'layout');
      if (layout) {
        const clearZones = group => group && Array.isArray(group.zones)
          ? {...group, zones: group.zones.map(zone => zone.teamId === id ? {...zone, teamId: null} : zone)}
          : group;
        const draftChanged = layout.draft?.zones?.some(zone => zone.teamId === id);
        const pubChanged = layout.published?.zones?.some(zone => zone.teamId === id);
        if (draftChanged || pubChanged) {
          put('setting', {...layout, draft: clearZones(layout.draft), published: clearZones(layout.published)});
        }
      }
      if (get('budget', 'team:' + id)) remove('budget', 'team:' + id);
      remove('team', id);
      event('team.deleted', {id, name: team.name});
      return {id, name: team.name};
    });
  }

  function deleteSkill(id) {
    return tx(() => {
      const skill = requireRecord('skill', id, '技能');
      for (const agent of list('agent')) {
        if (agent.skillIds?.includes(id)) {
          put('agent', {...agent, skillIds: agent.skillIds.filter(item => item !== id)});
        }
      }
      for (const candidate of list('candidate')) {
        if (candidate.draft?.skillIds?.includes(id)) {
          put('candidate', {...candidate, draft: {...candidate.draft,
            skillIds: candidate.draft.skillIds.filter(item => item !== id)}});
        }
      }
      remove('skill', id);
      event('skill.deleted', {id, name: skill.name});
      return {id, name: skill.name};
    });
  }

  function deleteMcpServer(id) {
    return tx(() => {
      const server = requireRecord('mcpServer', id, 'MCP 服务');
      const stripMcp = record => {
        const hasTop = record.mcpServerIds?.includes(id);
        const hasAuth = record.authorization?.mcpServerIds?.includes(id);
        if (!hasTop && !hasAuth) return null;
        return {
          ...record,
          ...(hasTop ? {mcpServerIds: record.mcpServerIds.filter(item => item !== id)} : {}),
          ...(hasAuth ? {authorization: {...record.authorization,
            mcpServerIds: record.authorization.mcpServerIds.filter(item => item !== id)}} : {}),
        };
      };
      for (const agent of list('agent')) {
        const updated = stripMcp(agent);
        if (updated) put('agent', updated);
      }
      for (const candidate of list('candidate')) {
        const updatedDraft = candidate.draft ? stripMcp(candidate.draft) : null;
        if (updatedDraft) put('candidate', {...candidate, draft: updatedDraft});
      }
      remove('mcpServer', id);
      event('mcp.deleted', {id, name: server.name});
      return {id, name: server.name};
    });
  }

  function agentProfile(input, runtimes, previous) {
    const teamId = input.teamId || null;
    if (teamId) requireRecord('team', teamId, '小组');
    const skillIds = ids(input.skillIds ?? previous?.skillIds ?? [], '技能');
    for (const id of skillIds) requireRecord('skill', id, '技能');
    const role = choice(input.role ?? 'worker', ['worker', 'lead', 'hr', 'finance'], '岗位');
    const runtime = choice(input.runtime ?? runtimes[0], runtimes, '运行器');
    const requested = input.authorization;
    if (requested !== undefined && (!requested || typeof requested !== 'object' || Array.isArray(requested) ||
        Object.keys(requested).some(key => !['execution','sandbox','mcpServerIds','tools','github'].includes(key)) ||
        (requested.execution !== undefined && typeof requested.execution !== 'boolean'))) fail('管理员授权配置无效');
    for (const tools of [input.permissions, requested?.tools]) {
      if (tools !== undefined && (!tools || typeof tools !== 'object' || Array.isArray(tools) ||
          Object.entries(tools).some(([key, value]) => !agentPermissionDefinitions.some(item => item.key === key) || typeof value !== 'boolean'))) fail('权限配置无效');
    }
    const prior = agentAuthorization(previous ?? {role, runtime});
    // Effective fields returned by the API must not overwrite saved grants.
    // Legacy clients without `authorization` can still update those fields.
    const legacy = requested === undefined ? input : {};
    const authorization = {execution:requested?.execution ?? prior.execution,
      sandbox:choice(requested?.sandbox ?? legacy.sandbox ?? prior.sandbox, ['read-only','workspace-write'], '文件授权'),
      mcpServerIds:ids(requested?.mcpServerIds ?? legacy.mcpServerIds ?? prior.mcpServerIds, 'MCP 服务'),
      tools:{...prior.tools, ...legacy.permissions, ...requested?.tools}};
    if (requested?.github !== undefined) authorization.github = normalizeGithubScope(requested.github);
    else if (prior.github) authorization.github = prior.github;
    for (const id of authorization.mcpServerIds) requireRecord('mcpServer', id, 'MCP 服务');
    const permissions = effectiveAgentPermissions({role, runtime, authorization});
    const mcpServerIds = authorization.execution && modelRuntimes.includes(runtime) ? authorization.mcpServerIds : [];
    const sandbox = authorization.execution ? authorization.sandbox : 'read-only';
    const model = runtime === 'observed' ? '' : note(input.model, '模型', 100);
    if (runtime === 'pi' && model.startsWith('-')) fail('Pi 模型名称不能以短横线开头');
    return {
      name: field(input.name, '姓名'), role, permissions, authorization,
      personality: note(input.personality, '人格'),
      scope: note(input.scope, '职责范围'),
      teamId, skillIds, mcpServerIds, runtime, avatarId: choice(input.avatarId ?? previous?.avatarId ?? 'auto', avatarIds, '人物形象'),
      model,
      sandbox: ['observed', 'pi'].includes(runtime) || ['hr', 'finance'].includes(role) ? 'read-only' : sandbox,
    };
  }

  function recordAgent(profile, before, actorRun, candidateId = before?.candidateId) {
    const record = put('agent', {
      ...profile, id: before?.id ?? randomUUID(), version: (before?.version ?? 0) + 1, candidateId,
      paused: before?.paused ?? false,
      seatIndex:assignWorkstation(store, before),
    });
    event('agent.saved', {id: record.id, name: record.name, version: record.version},
      actorRun ?? {agentId: record.id});
    return record;
  }

  function saveAgent(input, actorRun) {
    const before = input.id ? requireRecord('agent', input.id, '员工') : null;
    if (input.expectedVersion !== undefined && input.expectedVersion !== before?.version) fail('员工配置已更新，请重新打开权限设置', 409);
    if (input.candidateId && input.candidateId !== before?.candidateId) fail('请使用已接入的运行器绑定员工', 409);
    const runnerId = input.runnerCandidateId === undefined ? before?.runnerCandidateId : input.runnerCandidateId;
    let source;
    if (runnerId) {
      source = requireRecord('candidate', runnerId, 'Agent 来源');
      const machine = requireRecord('machine', source.machineId, '采集机器');
      if (source.kind === 'process' || machine.status === 'revoked' ||
          (!source.present && runnerId !== before?.runnerCandidateId)) fail('请选择可用的运行器来源', 409);
      if (!runnerConnected(source) && runnerId !== before?.runnerCandidateId) fail('请先在发现与接入中接入该运行器', 409);
    }
    const allowed = source ? candidateRuntimes(source) : before?.candidateId ? [before.runtime] : [...modelRuntimes, 'demo'];
    const profile = agentProfile(input, allowed, before);
    if ((profile.runtime !== before?.runtime || runnerId !== before?.runnerCandidateId) && before &&
        list('run').some(run => run.agentId === before.id && active.includes(run.status))) fail('员工仍有排队或执行中的任务，请结束后切换 Agent', 409);
    Object.assign(profile, {runnerCandidateId: runnerId || undefined,
      provider: source?.provider ?? (profile.runtime === 'observed' ? get('candidate', before?.candidateId)?.provider : profile.runtime)});
    if (before?.candidateId) {
      field(profile.personality, '人格', 8000);
      field(profile.scope, '职责范围', 8000);
    }
    return tx(() => recordAgent(profile, before, actorRun));
  }

  // Public employee creation must bind an admitted source. Legacy internal seed
  // profiles may retain their existing generic runtime without being rebound.
  function saveManagedAgent(input, actorRun) {
    const before = input.id ? requireRecord('agent', input.id, '员工') : null;
    const runnerId = input.runnerCandidateId === undefined ? before?.runnerCandidateId : input.runnerCandidateId;
    const runtime = input.runtime ?? before?.runtime ?? (runnerId ? candidateRuntimes(get('candidate', runnerId)).at(-1) : 'codex');
    const keepLegacy = before && !before.runnerCandidateId && before.runtime === runtime;
    if (runtime !== 'demo' && !runnerId && !keepLegacy) fail('请先接入运行器，再在智能体中绑定', 409);
    return saveAgent({...input, runtime}, actorRun);
  }

  function stageCandidate(id, input, actorRun) {
    return tx(() => {
      const candidate = requireRecord('candidate', id, '候选 Agent');
      if (candidate.kind === 'process' && candidate.status !== 'review') fail('进程仅用于运行诊断，请选择对应运行器办理入职', 409);
      if (!['discovered', 'review'].includes(candidate.status)) fail('候选已结束人事流程', 409);
      const profile = agentProfile(input, candidateRuntimes(candidate), candidate.draft);
      field(profile.personality, '人格', 8000);
      field(profile.scope, '职责范围', 8000);
      const updated = put('candidate', {...candidate, status: 'review', draft: profile,
        reviewVersion: (candidate.reviewVersion ?? 0) + 1,
        reviewerId: actorRun?.agentId ?? null, reviewedAt: time()});
      event('candidate.reviewed', {candidateId: id, reviewVersion: updated.reviewVersion}, actorRun);
      return updated;
    });
  }

  function approveCandidate(id, version) {
    return tx(() => {
      const candidate = requireRecord('candidate', id, '候选 Agent');
      if (candidate.status !== 'review' || candidate.reviewVersion !== version) fail('请确认当前版本的入职档案', 409);
      const machine = requireRecord('machine', candidate.machineId, '采集机器');
      if (machine.status === 'revoked') fail('采集机器已撤销', 409);
      const profile = agentProfile(candidate.draft, candidateRuntimes(candidate));
      Object.assign(profile, {runnerCandidateId: candidate.id, provider: candidate.provider});
      const agent = recordAgent(profile, null, null, candidate.id);
      put('candidate', {...candidate, status: 'approved', agentId: agent.id, approvedAt: time()});
      event('candidate.approved', {candidateId: id, machineId: machine.id}, {agentId: agent.id});
      return agent;
    });
  }

  function dismissCandidate(id) {
    return tx(() => {
      const candidate = requireRecord('candidate', id, '候选 Agent');
      if (runnerConnected(candidate)) fail('该运行器已接入，不能忽略', 409);
      if (candidate.status === 'dismissed') return candidate;
      const updated = put('candidate', {...candidate, status: 'dismissed', dismissedAt: time()});
      event('candidate.dismissed', {candidateId: id});
      return updated;
    });
  }

  function assignableAgent(id, label) {
    const agent = requireRecord('agent', id, label);
    if (agent.runtime === 'observed') fail('该来源尚未接入执行适配器，授权不能代替适配能力', 409);
    if (!agentCanExecute(agent)) fail('管理员尚未允许该员工执行平台任务', 409);
    return agent;
  }

  function setAgentPaused(id, paused) {
    if (typeof paused !== 'boolean') fail('暂停状态无效');
    return tx(() => {
      const agent = assignableAgent(id, '员工');
      const updated = put('agent', {...agent, paused});
      event('agent.dispatch', {paused, name: agent.name}, {agentId: id});
      return updated;
    });
  }

  function hasActiveTaskRun(id) {
    return list('run').some(run => run.taskId === id && run.kind === 'task' && active.includes(run.status));
  }

  function saveTask(input, actorRun) {
    const before = input.id ? requireRecord('task', input.id, '任务') : null;
    const id = before?.id ?? randomUUID();
    if (hasActiveTaskRun(id)) fail('请先结束本任务的当前执行', 409);
    const parentId = before ? before.parentId ?? null : input.parentId || null;
    const parent = parentId ? requireRecord('task', parentId, '父任务') : null;
    if (before && input.parentId !== undefined && (input.parentId || null) !== parentId) fail('不能更改任务的父任务', 409);
    if (!before && parent && ['done', 'cancelled'].includes(parent.status)) fail('已结束的任务不能添加子任务', 409);
    const assigneeId = input.assigneeId || null;
    const humanId = input.humanId === undefined ? before?.humanId ?? null : input.humanId || null;
    const projectId = parent ? parent.projectId : input.projectId || null;
    if (before && before.projectId !== projectId && childrenOf(id).length) fail('已有子任务，不能更改所属项目', 409);
    const schedule = taskSchedule(input, before, parentId, assigneeId);
    const conversationId = input.conversationId || before?.conversationId || null;
    if (assigneeId) assignableAgent(assigneeId, '负责人');
    if (humanId) requireRecord('human', humanId, '协作员工');
    if (projectId) requireRecord('project', projectId, '项目');
    if (conversationId) requireRecord('conversation', conversationId, '会话');
    const dependencyIds = ids(input.dependencyIds ?? [], '依赖任务');
    const metadata = settings.taskMetadata(input, before);
    const visited = new Set();
    const ancestors = new Set();
    for (let ancestor = parent; ancestor; ancestor = get('task', ancestor.parentId)) ancestors.add(ancestor.id);
    function checkDependency(dependencyId) {
      if (dependencyId === id) fail('任务依赖形成循环');
      if (ancestors.has(dependencyId)) fail('子任务不能依赖父任务的验收');
      if (visited.has(dependencyId)) return;
      visited.add(dependencyId);
      requireRecord('task', dependencyId, '依赖任务').dependencyIds.forEach(checkDependency);
    }
    dependencyIds.forEach(checkDependency);
    return tx(() => {
      if (before?.projectId !== projectId) space?.returnDelivery(before?.lastRunId);
      const record = put('task', {
        id, ...metadata, ...schedule, parentId, number: before?.number ?? settings.nextTaskNumber(),
        title: field(input.title, '标题', 200), description: note(input.description, '任务描述'),
        acceptance: note(input.acceptance, '验收标准'),
        assigneeId, humanId, projectId, dependencyIds, conversationId,
        status: before?.status ?? 'todo', lastRunId: before?.lastRunId ?? null,
        createdAt: before?.createdAt ?? time(), updatedAt: time(),
      });
      event('task.saved', {title:record.title, parentId}, {agentId:assigneeId, ...actorRun, taskId:id});
      return record;
    });
  }

  function taskSchedule(input, before, parentId, assigneeId) {
    const value = input.scheduledAt === undefined ? before?.scheduledAt : input.scheduledAt;
    if (parentId && value) fail('子任务由父任务拆分，不能设置定时派发');
    const date = value ? new Date(field(value, '定时执行时间', 40)) : null;
    if (date && !Number.isFinite(date.getTime())) fail('定时执行时间无效');
    const scheduledAt = date?.toISOString() ?? null;
    const changed = scheduledAt !== (before?.scheduledAt ?? null);
    if (changed && before?.lastRunId) fail('任务已启动，不能更改定时派发', 409);
    if (changed && date && date.getTime() <= Date.now()) fail('定时执行时间须晚于当前时间');
    if (scheduledAt && !before?.scheduleStartedAt && !assigneeId) fail('定时任务需要 Agent 负责人');
    return {scheduledAt, scheduleStartedAt:before?.scheduleStartedAt ?? null};
  }

  function taskStatus(id, status, reviewedHeads, deliveryId) {
    return tx(() => {
      const task = requireRecord('task', id, '任务');
      choice(status, taskStates, '任务状态');
      if (deliveryId != null && deliveryId !== task.lastRunId) fail('任务已有更新的交付，请重新打开验收', 409);
      if (status === task.status) return task;
      if (hasActiveTaskRun(id)) {
        fail('运行中的任务不能手动更改状态', 409);
      }
      if (['review', 'in_progress'].includes(status) &&
          (!task.humanId || task.assigneeId || ['done', 'backlog', 'cancelled'].includes(task.status))) {
        fail('只有真人负责的未验收任务支持手动推进', 409);
      }
      if (status === 'done' && task.status !== 'review') fail('只有待验收的任务可以验收', 409);
      if (['done', 'cancelled'].includes(status) && childrenOf(id).some(child => !['done', 'cancelled'].includes(child.status))) {
        fail('请先验收或取消所有子任务', 409);
      }
      if (status === 'done') {
        const conflicts = space?.approve(task, reviewedHeads);
        if (conflicts?.length) return {...task, conflicts};
      } else if (task.status === 'review') {
        space?.returnDelivery(task.lastRunId);
      }
      return changeTask(task, status);
    });
  }

  function taskPriority(id, priority) {
    return tx(() => {
      const task = requireRecord('task', id, '任务');
      choice(priority, priorities, '优先级');
      if (priority === task.priority) return task;
      if (hasActiveTaskRun(id)) fail('请先结束本任务的当前执行', 409);
      const updated = put('task', {...task, priority, updatedAt: time()});
      event('task.saved', {title: task.title}, {taskId: id, agentId: task.assigneeId});
      return updated;
    });
  }

  function taskDetail(id) {
    const task = requireRecord('task', id, '任务');
    const delivery = get('space-delivery', task.lastRunId);
    return {
      task, cursor:store.cursor(),
      delivery: delivery ? {id:delivery.id, projectId:delivery.projectId, status:delivery.status, count:delivery.files.length} : null,
      parent: get('task', task.parentId), subtasks: childrenOf(id),
      comments: discussion.forTask(id), mentionTargets: discussion.people(),
      runs: list('run').filter(run => run.taskId === id).map(({id, agentId, status, createdAt, kind}) =>
        ({id, agentId, status, createdAt, kind})).reverse(),
    };
  }

  function discussionTask(run, parent) {
    if (run.kind !== 'task') fail('本次执行无法发起任务讨论', 403);
    const task = requireRecord('task', run.taskId, '任务');
    return parent ? requireRecord('task', task.parentId, '父任务') : task;
  }

  function commentTask(taskId, input, run, actor) {
    return tx(() => {
      const task = run ? discussionTask(run, input.parent === true) : requireRecord('task', taskId, '任务');
      return discussion.post(task, input, run, false, actor);
    });
  }

  function taskDiscussion(run, parent) {
    const task = discussionTask(run, parent);
    return {comments:discussion.context(task.id, 20), mentionTargets:discussion.people()};
  }

  function changeTask(task, status, extra = {}) {
    const updated = put('task', {...task, ...extra, status, updatedAt: time()});
    event('task.status', {status}, {taskId: task.id, agentId: task.assigneeId});
    return updated;
  }

  function account(scope, id, runs = list('run'), budget = get('budget', scope + ':' + id)) {
    const scoped = runs.filter(run => modelRuntimes.includes(run.agent.runtime) &&
      (scope === 'company' || (scope === 'agent' ? run.agentId === id : run.agent.teamId === id)));
    const spent = scoped.reduce((total, run) => total + (run.usage?.totalTokens ?? 0), 0);
    const reserved = scoped.filter(run => live.includes(run.status))
      .reduce((total, run) => total + Math.max(0, run.reserved - (run.usage?.totalTokens ?? 0)), 0);
    return {scope, id, limit: budget?.limit ?? null, spent, reserved,
      available: budget ? budget.limit - spent - reserved : null,
      unknown: scoped.filter(run => run.startedAt && terminal.includes(run.status) && !run.usage).length};
  }

  function ledger() {
    const runs = list('run');
    return [
      account('company', 'local', runs),
      ...list('team').map(team => account('team', team.id, runs)),
      ...list('agent').map(agent => account('agent', agent.id, runs)),
    ];
  }

  function setBudget(input, actorRun) {
    const scope = choice(input.scope, ['company', 'team', 'agent'], '预算范围');
    const target = scope === 'company' ? 'local' : input.targetId;
    if (scope !== 'company') requireRecord(scope, target, '预算对象');
    const limit = integer(input.limit, 'Token 上限', 0, maxTokens);
    if (actorRun) {
      if (scope === 'company' || (scope === 'agent' && target === actorRun.agentId)) fail('财务无权修改该预算', 403);
      const company = get('budget', 'company:local');
      if (!company || limit > company.limit) fail('调整额度须在已设置的公司总额度内', 403);
    }
    return tx(() => {
      const budget = put('budget', {id: scope + ':' + target, scope, target, limit});
      event('budget.updated', {scope, target, limit}, actorRun);
      return budget;
    });
  }

  function enqueue(agent, taskId, reservation, prompt, {conversationId = null, projectSpace, replyToId} = {}) {
    const run = {
      id: randomUUID(), taskId, agentId: agent.id,
      agent: {...agent, skills: (agent.skillIds ?? []).map(id => get('skill', id))},
      kind: replyToId ? 'comment' : conversationId ? 'conversation' : 'task', conversationId, prompt,
      workspaceContext: settings.read('workspace').context,
      status: 'queued', activity: '等待调度', tools: {}, plan: [], usage: null,
      reserve: reservation, reserved: 0, createdAt: time(), output: '', error: null,
    };
    if (projectSpace) run.projectSpace = projectSpace;
    if (replyToId) run.replyToId = replyToId;
    if (run.kind === 'task') {
      const access = snapshotGithubAccess(store, agent);
      if (access) run.githubAccess = access;
    }
    run.instructions = runtimeInstructions(run);
    put('run', run);
    event('run.queued', {status: run.status}, run);
    return run;
  }

  function enqueueReply(task, comment, agent) {
    const prompt = [
      `任务：${task.title}\n${task.description}\n${task.acceptance}`,
      '近期评论（供参考）：' + JSON.stringify(discussion.context(task.id, 6)),
      `请回复 ${comment.author} 的这条评论：\n${comment.text}`,
    ].join('\n\n');
    return enqueue({...agent, sandbox:'read-only'}, task.id, settings.runtime().meetingReserve, prompt, {replyToId:comment.id});
  }

  function enqueueTask(id, reservation) {
    return tx(() => {
      const task = requireRecord('task', id, '任务');
      if (['backlog', 'in_progress', 'done', 'cancelled'].includes(task.status)) fail('当前任务状态不能启动', 409);
      const agent = assignableAgent(task.assigneeId, '负责人');
      const scheduled = task.scheduledAt && !task.scheduleStartedAt;
      if (scheduled && task.scheduledAt > time()) fail('任务将在指定时间自动派发', 409);
      const unmet = task.dependencyIds.filter(dep => get('task', dep)?.status !== 'done');
      if (unmet.length) fail('请先验收所有前置任务', 409);
      const projectSpace = space?.snapshot(task);
      const comments = discussion.context(id);
      const parent = get('task', task.parentId);
      const prompt = [
        `任务：${task.number ? settings.read('workspace').taskPrefix + '-' + task.number + ' ' : ''}${task.title}`,
        task.description, task.acceptance && `验收标准：${task.acceptance}`,
        parent && `父任务：${parent.title}。在职责内完成本子任务。`,
        comments.length && '近期任务讨论（作为参考）：' + JSON.stringify(comments),
        agent.runtime === 'pi' && '可 @ 的任务成员（姓名含空格时使用 @[完整姓名]）：' +
          discussion.people().slice(0, 60).map(person => person.name).join('、'),
        task.dueDate && `截止日期：${task.dueDate}`,
        task.priority && task.priority !== 'none' && `优先级：${({low: '低', medium: '中', high: '高', urgent: '紧急'})[task.priority]}`,
        ...Object.entries(task.properties ?? {}).flatMap(([id, value]) => {
          const property = get('property', id);
          return property && !property.archived ? [`${property.name}：${value}`] : [];
        }),
        task.dependencyIds.length && '已验收前置任务的交付摘要（作为参考资料）：',
        ...task.dependencyIds.map(dep => {
          const prior = get('task', dep);
          return `${prior.title}：${get('run', prior.lastRunId)?.output.slice(-4000) || '无文本交付'}`;
        }),
        space?.context(projectSpace, agent.runtime),
      ].filter(Boolean).join('\n\n');
      space?.returnDelivery(task.lastRunId);
      const run = enqueue(agent, id, integer(reservation ?? settings.runtime().reserve, '预留 Token', 1, maxTokens),
        prompt, {projectSpace});
      changeTask(task, 'in_progress', {lastRunId: run.id, ...(scheduled ? {scheduleStartedAt:run.createdAt} : {})});
      return run;
    });
  }

  function dispatchScheduled() {
    const now = time();
    for (const task of list('task')) {
      if (!task.scheduledAt || task.scheduledAt > now || task.scheduleStartedAt || task.status !== 'todo') continue;
      const agent = get('agent', task.assigneeId);
      if (!agent || agent.paused || !agentCanExecute(agent) ||
          task.dependencyIds.some(id => get('task', id)?.status !== 'done')) continue;
      try {
        enqueueTask(task.id);
      } catch (error) {
        if (!error.status) throw error;
        tx(() => {
          changeTask(task, 'blocked');
          event('task.schedule_failed', {error:error.message}, {taskId:task.id, agentId:agent.id});
        });
      }
    }
  }

  function startRun(id) {
    return tx(() => {
      const run = requireRecord('run', id, '执行');
      if (run.status !== 'queued') fail('该执行不在队列中', 409);
      const billable = modelRuntimes.includes(run.agent.runtime);
      if (billable) {
        const accounts = [account('company', 'local'), account('agent', run.agentId)];
        if (run.agent.teamId) accounts.push(account('team', run.agent.teamId));
        const insufficient = accounts.find(row => row.available !== null && row.available < run.reserve);
        if (insufficient) return finalize(run, 'failed', '可用 Token 预算不足，未启动执行');
      }
      const updated = put('run', {...run, status: 'running', activity: '启动运行器',
        reserved: billable ? run.reserve : 0, startedAt: time()});
      event('run.started', {status: updated.status, reserved: updated.reserved}, updated);
      return updated;
    });
  }

  function report(id, type, payload) {
    return tx(() => {
      const run = get('run', id);
      if (!run || !live.includes(run.status)) return null;
      switch (type) {
        case 'run.workspace':
          run.workspace = payload.cwd;
          break;
        case 'artifact.created':
          run.artifacts = [...(run.artifacts ?? []), payload.path];
          break;
        case 'tool.started':
          run.tools = {...run.tools, [payload.id]: payload.label};
          run.activity = payload.label;
          break;
        case 'tool.completed':
        case 'tool.failed':
          delete run.tools[payload.id];
          run.activity = Object.values(run.tools).at(-1) ?? '等待运行器更新';
          break;
        case 'plan.updated':
          run.plan = payload.plan;
          break;
        case 'message.delta':
          run.output = (run.output + payload.text).slice(-48_000);
          run.activity = '正在输出';
          break;
        case 'message.final':
          run.output = payload.text.slice(-48_000);
          break;
        case 'usage.updated':
          if (run.usage && run.usage.totalTokens >= payload.totalTokens) return run;
          run.usage = payload;
          break;
        case 'run.activity':
          run.activity = payload.label;
          break;
      }
      put('run', run);
      event(type, payload, run);
      return run;
    });
  }

  function finalize(run, status, error = null) {
    const updated = put('run', {...run, status, activity: null, tools: {}, reserved: 0, error, endedAt: time()});
    event(`run.${status}`, {status, error, usage: run.usage}, updated);
    if (run.kind === 'task') {
      const task = get('task', run.taskId);
      if (task?.lastRunId === run.id) {
        changeTask(task, {completed: 'review', cancelled: 'todo'}[status] ?? 'blocked');
      }
    } else if (run.kind === 'conversation') {
      finishSpeaker(updated);
    }
    return updated;
  }

  function finish(id, status, error = null, files = []) {
    return tx(() => {
      const run = requireRecord('run', id, '执行');
      if (terminal.includes(run.status)) return run;
      if (status === 'completed' && run.kind === 'comment') {
        const text = run.output.trim();
        if (!text) return finalize(run, 'failed', 'Agent 没有返回评论内容');
        discussion.post(requireRecord('task', run.taskId, '任务'), {text:text.slice(0, 4000), replyToId:run.replyToId}, run, true);
      }
      if (status === 'completed') space?.stage(run, files);
      return finalize(run, status, error);
    });
  }

  function stop(id) {
    return tx(() => stopRun(requireRecord('run', id, '执行')));
  }

  function stopRun(run) {
    if (run.status === 'queued') return finalize(run, 'cancelled');
    if (run.status !== 'running') return run;
    const updated = put('run', {...run, status: 'stopping'});
    event('run.stopping', {}, updated);
    return updated;
  }

  function conversationEvent(conversation, type, payload = {}) {
    event(type, {status: conversation.status, mode: conversation.mode, ...payload},
      {taskId: conversation.taskId, conversationId: conversation.id});
  }

  function startConversation(input, actorRun) {
    const participantIds = ids(input.participantIds, '参与员工', 8);
    if (participantIds.length < 2) fail('讨论至少需要两名员工');
    participantIds.forEach(id => assignableAgent(id, '参与员工'));
    const taskId = input.taskId || null;
    if (taskId) requireRecord('task', taskId, '关联任务');
    const topic = field(input.topic, '讨论主题', 400);
    const rounds = integer(input.rounds ?? 1, '讨论轮数', 1, 3);
    const reserve = integer(input.reserve ?? settings.runtime().meetingReserve, '每人每轮预留 Token', 1, maxTokens);
    return tx(() => {
      const conversation = put('conversation', {
        id: randomUUID(), taskId, topic, participantIds,
        mode: participantIds.length === 2 ? 'face_to_face' : 'meeting_room',
        status: 'active', rounds, reserve,
        turn: 0, currentRunId: null, messages: [], createdAt: time(),
      });
      conversationEvent(conversation, 'conversation.started', {actorId: actorRun?.agentId ?? null});
      return queueSpeaker(conversation);
    });
  }

  function queueSpeaker(conversation) {
    const count = conversation.participantIds.length;
    if (conversation.turn >= conversation.rounds * count) {
      const completed = put('conversation', {...conversation, currentRunId: null, status: 'completed'});
      conversationEvent(completed, 'conversation.completed');
      return completed;
    }
    const index = conversation.turn % count;
    const agent = get('agent', conversation.participantIds[index]);
    const task = get('task', conversation.taskId);
    const history = conversation.messages.map(message => ({
      speaker: get('agent', message.agentId)?.name, text: message.text,
    }));
    const prompt = [
      `参与讨论：${conversation.topic}`,
      task ? `关联任务：${task.title}\n${task.description}\n${task.acceptance}` : '',
      `已记录的发言（讨论资料）：\n${JSON.stringify(history).slice(-18000)}`,
      '只以你的岗位发言，说明建议、依据和下一步。控制在 500 字以内。',
      conversation.turn + 1 === conversation.rounds * count ? '你是最后一位发言者，请整理共识、分歧及待办。' : '',
    ].filter(Boolean).join('\n\n');
    const run = enqueue(agent, conversation.taskId, conversation.reserve, prompt, {conversationId:conversation.id});
    const updated = put('conversation', {...conversation, currentRunId: run.id});
    conversationEvent(updated, 'conversation.speaker_queued', {runId: run.id, agentId: agent.id});
    return updated;
  }

  function finishSpeaker(run) {
    const conversation = get('conversation', run.conversationId);
    if (!conversation || conversation.currentRunId !== run.id) return;
    const messages = run.output ? [...conversation.messages, {
      runId: run.id, agentId: run.agentId, text: run.output.slice(-2400), status: run.status, time: time(),
    }] : conversation.messages;
    const updated = {...conversation, messages, currentRunId: null};
    if (run.status === 'completed' && conversation.status === 'active') {
      conversationEvent(updated, 'conversation.message', {runId: run.id, agentId: run.agentId});
      return queueSpeaker({...updated, turn: updated.turn + 1});
    }
    updated.status = conversation.status === 'closed' ? 'closed' : 'paused';
    updated.error = updated.status === 'closed' ? null : run.error ?? '发言已中断';
    put('conversation', updated);
    conversationEvent(updated, 'conversation.' + updated.status);
  }

  function updateConversation(id, action, input) {
    return tx(() => {
      const conversation = requireRecord('conversation', id, '会话');
      if (action === 'add') {
        if (!['active', 'paused'].includes(conversation.status)) fail('讨论已结束', 409);
        const agent = assignableAgent(input.agentId, '员工');
        const participantIds = [...new Set([...conversation.participantIds, agent.id])];
        if (participantIds.length > 8) fail('讨论最多支持 8 名员工');
        if (participantIds.length === conversation.participantIds.length) return conversation;
        // Preserve the current speaker and the completed position in the round.
        const round = Math.floor(conversation.turn / conversation.participantIds.length);
        const index = conversation.turn % conversation.participantIds.length;
        const updated = put('conversation', {...conversation, participantIds, mode: 'meeting_room',
          turn: round * participantIds.length + index});
        conversationEvent(updated, 'conversation.participants_updated', {participantIds});
        return updated;
      }
      if (action === 'resume') {
        if (conversation.status !== 'paused') fail('仅可继续暂停的讨论', 409);
        const updated = {...conversation, status: 'active', error: null};
        conversationEvent(updated, 'conversation.resumed');
        return queueSpeaker(updated);
      }
      if (['completed', 'closed'].includes(conversation.status)) return conversation;
      const updated = put('conversation', {...conversation, status: 'closed', error: null});
      conversationEvent(updated, 'conversation.closed');
      if (conversation.currentRunId) stopRun(requireRecord('run', conversation.currentRunId, '执行'));
      return get('conversation', updated.id);
    });
  }

  function seed() {
    if (get('setting', 'agents-initialized')) return;
    if (list('agent').length) {
      tx(() => put('setting', {id:'agents-initialized', initializedAt:time()}));
      return;
    }
    const team = saveNamed('team', {name: '产品研发'});
    const skill = saveNamed('skill', {name: '交付记录', description: '交付时说明结果、验证方法及未解决问题。'});
    const profiles = [
      ['人事', 'hr', '准确复述岗位要求', '创建员工和配置岗位'],
      ['财务', 'finance', '用数据说明变化', '统计 Token 和管理预算'],
      ['项目负责人', 'lead', '先明确验收条件', '拆解并协调研发工作'],
      ['工程师', 'worker', '直接、审慎', '实现和验证研发任务'],
      ['测试工程师', 'worker', '复现优先', '验证交付并记录问题'],
    ];
    for (const [name, role, personality, scope] of profiles) {
      saveAgent({name, role, personality, scope, teamId: team.id, skillIds: [skill.id],
        sandbox: name === '工程师' ? 'workspace-write' : 'read-only'});
    }
    tx(() => put('setting', {id:'agents-initialized', initializedAt:time()}));
  }

  function snapshot() {
    return {
      cursor: store.cursor(), agents: list('agent'), teams: list('team'), skills: list('skill'), mcpServers:list('mcpServer'),
      projects: list('project'), tasks: list('task'), conversations: list('conversation'), ledger: ledger(),
      runs: list('run').reverse().map(run => ({
        id: run.id, taskId: run.taskId, agentId: run.agentId, kind: run.kind, status: run.status, conversationId:run.conversationId,
        activity: run.activity, usage: run.usage, error: run.error, createdAt: run.createdAt,
        startedAt: run.startedAt, endedAt: run.endedAt,
      })),
      taskStates,
    };
  }

  return {saveNamed, saveMcpServer, deleteTeam, deleteSkill, deleteMcpServer, saveAgent, saveManagedAgent, saveTask, taskStatus, taskPriority, enqueueTask, startRun, report, stop, finish,
    setBudget, ledger, startConversation, updateConversation, snapshot, seed, requireRecord,
    stageCandidate, approveCandidate, dismissCandidate, taskDetail, commentTask, taskDiscussion, dispatchScheduled, setAgentPaused};
}
