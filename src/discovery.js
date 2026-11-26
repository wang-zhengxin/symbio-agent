import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { providers } from '../collector/office-collector.mjs';
import { choice, fail, integer, string } from './input.js';
import { taskStates } from './settings.js';
import { discoveryGroups, runnerConnected } from '../public/discovery-model.js';

const known = Object.keys(providers);
const expiry = 40_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

function validateReport(input) {
  const hostname = string(input.hostname, '主机名', 160);
  const platform = choice(input.platform, ['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'sunos', 'aix'], '系统');
  const processScan = choice(input.processScan, ['ok', 'unavailable'], '进程扫描状态');
  const windowTitleStatus = choice(input.windowTitleStatus ?? 'unknown',
    ['unknown','not-requested','available','permission-required','unsupported','unavailable'], '窗口标题采集状态');
  if (!Array.isArray(input.installed) || input.installed.length > known.length ||
      !Array.isArray(input.processes) || input.processes.length > 150) fail('采集清单无效');
  if (processScan === 'unavailable' && input.processes.length) fail('进程扫描结果无效');
  const found = new Map();
  for (const provider of input.installed) {
    choice(provider, known, '运行器');
    found.set('install:' + provider, {provider, kind: 'installation'});
  }
  for (const row of input.processes) {
    if (!row || typeof row !== 'object') fail('进程记录无效');
    const provider = choice(row.provider, known, '运行器');
    const pid = integer(row.pid, '进程 ID', 1, 2_147_483_647);
    if (typeof row.instance !== 'string' || !new RegExp('^' + pid + '-[a-f0-9]{16}$').test(row.instance)) fail('进程标识无效');
    const processName = row.processName == null ? null : string(row.processName, '进程名称', 80);
    if (processName && /[/\\\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(processName)) fail('进程名称无效');
    if (row.windowTitles !== undefined && (!Array.isArray(row.windowTitles) || row.windowTitles.length > 8)) fail('窗口标题清单无效');
    const windowTitles = [...new Set((row.windowTitles ?? []).map(value => {
      const title = string(value, '窗口标题', 160);
      if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(title)) fail('窗口标题无效');
      return title;
    }))];
    // One onboarding candidate per machine/provider, including CLIs not found on PATH.
    if (!found.has('install:' + provider)) found.set('install:' + provider, {provider, kind: 'runtime'});
    found.set('process:' + provider + ':' + row.instance, {provider, kind: 'process', pid, processName, windowTitles});
  }
  return {hostname, platform, processScan, windowTitleStatus, found};
}

export function createDiscovery(store) {
  const {get, put, list, remove, tx, event} = store;
  const publicMachine = ({tokenHash, pairingHash, ...machine}) => machine;

  // Keep historical employee links and reviewed drafts. Unreviewed PIDs become
  // observations, so a restart or the next scan cannot repopulate the HR queue.
  function normalizeCandidates() {
    const candidates = list('candidate');
    const changes = candidates.filter(row => row.kind === 'process' && row.status === 'discovered' && !row.draft && !row.agentId);
    const keys = new Set(candidates.filter(row => row.kind !== 'process').map(row => row.machineId + ':' + row.provider));
    const missing = candidates.filter(row => {
      const key = row.machineId + ':' + row.provider;
      if (row.kind !== 'process' || !row.present || keys.has(key) || get('machine', row.machineId)?.status === 'revoked') return false;
      keys.add(key);
      return true;
    });
    if (!changes.length && !missing.length) return;
    tx(() => {
      for (const row of changes) put('candidate', {...row, status: 'observed'});
      for (const row of missing) put('candidate', {id: randomUUID(), key: 'install:' + row.provider,
        machineId: row.machineId, provider: row.provider, kind: 'runtime', present: true, status: 'discovered',
        firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt});
      event('discovery.normalized', {observations: changes.length, runtimes: missing.length});
    });
  }
  normalizeCandidates();

  // Preserve explicit bindings made before runtime connection and employee creation were separated.
  const boundIds = new Set(list('agent').flatMap(agent => [agent.runnerCandidateId, agent.candidateId]).filter(Boolean));
  const boundSources = list('candidate').filter(row => row.kind !== 'process' && boundIds.has(row.id) && !runnerConnected(row));
  if (boundSources.length) tx(() => {
    for (const row of boundSources) put('candidate', {...row, connectionStatus:'connected', connectedAt:now()});
  });

  function connect(id) {
    return tx(() => {
      const candidate = get('candidate', id);
      const machine = candidate && get('machine', candidate.machineId);
      if (!candidate || candidate.kind === 'process') fail('请选择运行器接入，进程仅供诊断', 409);
      if (!machine || machine.status !== 'online' || !candidate.present) fail('来源离线或未检测到运行器，请重新扫描后接入', 409);
      if (runnerConnected(candidate)) return candidate;
      const updated = put('candidate', {...candidate, status:'connected', connectionStatus:'connected', connectedAt:now()});
      event('runtime.connected', {candidateId:id, machineId:machine.id, provider:candidate.provider});
      return updated;
    });
  }

  function issueMachine(input, pairing = false) {
    const name = string(input.name, '机器名称', 100);
    const taskAccess = input.taskAccess ?? 'none';
    if (!['none', 'all'].includes(taskAccess) &&
        !(typeof taskAccess === 'string' && taskAccess.startsWith('project:') && get('project', taskAccess.slice(8)))) {
      fail('请选择有效的任务读取范围');
    }
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const code = pairing ? randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-') : null;
    return tx(() => {
      const machine = put('machine', {id, name, taskAccess,
        tokenHash: pairing ? undefined : digest(secret),
        pairingHash: pairing ? digest(code.replaceAll('-', '')) : undefined,
        pairingExpiresAt: pairing ? new Date(Date.now() + 600_000).toISOString() : undefined, status: 'awaiting',
        local: false, createdAt: now(), seenAt: null});
      event('machine.paired', {machineId: id, status: machine.status});
      return pairing ? {machine: publicMachine(machine), code, expiresAt: machine.pairingExpiresAt}
        : {machine: publicMachine(machine), token: id + '.' + secret};
    });
  }

  function exchangeCode(input) {
    const code = typeof input.code === 'string' ? input.code.trim().replaceAll('-', '').toUpperCase() : '';
    if (!/^[A-F0-9]{16}$/.test(code)) fail('配对码无效、已使用或已过期', 401);
    return tx(() => {
      const hash = digest(code);
      const machine = list('machine').find(row => row.pairingHash === hash && row.status !== 'revoked' &&
        Date.parse(row.pairingExpiresAt) > Date.now());
      if (!machine) fail('配对码无效、已使用或已过期', 401);
      const secret = randomBytes(32).toString('base64url');
      const updated = put('machine', {...machine, tokenHash: digest(secret), pairingHash: undefined,
        pairingExpiresAt: undefined, pairedAt: now()});
      event('machine.login', {machineId: machine.id});
      return {machine: publicMachine(updated), token: machine.id + '.' + secret};
    });
  }

  function clientStatus(machineId) {
    const machine = get('machine', machineId);
    if (!machine || machine.status === 'revoked') fail('配对凭据无效', 401);
    const candidates = list('candidate').filter(row => row.machineId === machineId);
    const runtimes = discoveryGroups(candidates, [machine]).map(group => ({id: group.candidate?.id,
      provider: group.provider, machineId, kind: group.candidate?.kind, status: group.candidate?.status,
      agentId: group.candidate?.agentId, instances: group.processes.length, processState: group.processState}));
    return {machine: publicMachine(machine), candidates, runtimes};
  }

  function readTasks(machineId, {status, project, limit = 50, offset = 0, ref} = {}) {
    const {machine} = clientStatus(machineId);
    if (!machine.taskAccess || machine.taskAccess === 'none') fail('此机器未获任务读取权限，请在后台重新配对并选择读取范围', 403);
    limit = integer(Number(limit), '数量', 1, 200);
    offset = integer(Number(offset), '偏移量', 0, 1_000_000);
    if (status) choice(status, taskStates, '任务状态');
    const taskKey = task => task.number ? (get('setting', 'workspace')?.value?.taskPrefix ?? 'AG') + '-' + task.number : task.id;
    const visible = list('task').filter(task => machine.taskAccess === 'all' ||
      task.projectId === machine.taskAccess.slice(8));
    const projectTask = task => ({id: task.id, number: taskKey(task), title: task.title, status: task.status,
      priority: task.priority, projectId: task.projectId, project: get('project', task.projectId)?.name,
      assignee: get('agent', task.assigneeId)?.name, parentId: task.parentId,
      dueDate: task.dueDate, createdAt: task.createdAt, updatedAt: task.updatedAt});
    if (ref) {
      const task = visible.find(task => task.id === ref || taskKey(task) === ref || String(task.number) === ref);
      if (!task) fail('任务不存在或无权访问', 404);
      return {task: {...projectTask(task), description: task.description, acceptance: task.acceptance},
        subtasks: visible.filter(row => row.parentId === task.id).map(projectTask)};
    }
    const tasks = visible.filter(task => !task.parentId && (!status || task.status === status) &&
      (!project || task.projectId === project)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return {tasks: tasks.slice(offset, offset + limit).map(projectTask), total: tasks.length, limit, offset};
  }

  function authenticate(header) {
    const match = typeof header === 'string' && header.match(/^Bearer ([a-f0-9-]{36})\.([a-zA-Z0-9_-]{43})$/);
    const machine = match && get('machine', match[1]);
    if (!machine?.tokenHash || machine.status === 'revoked' ||
        !timingSafeEqual(Buffer.from(machine.tokenHash, 'hex'), Buffer.from(digest(match[2]), 'hex'))) {
      fail('配对凭据无效', 401);
    }
    return machine.id;
  }

  function revoke(id) {
    return tx(() => {
      const machine = get('machine', id);
      if (!machine || machine.local) fail('远程机器不存在', 404);
      if (machine.status === 'revoked') return publicMachine(machine);
      const updated = put('machine', {...machine, status: 'revoked', tokenHash: undefined, pairingHash: undefined, pairingExpiresAt: undefined});
      event('machine.revoked', {machineId: id, status: 'revoked'});
      return publicMachine(updated);
    });
  }

  function removalState(machine) {
    if (machine.local || machine.id === 'local') return {allowed:false, reason:'本机不能删除'};
    const sourceIds = new Set(list('candidate').filter(row => row.machineId === machine.id).map(row => row.id));
    const usesMachine = agent => sourceIds.has(agent?.runnerCandidateId || agent?.candidateId);
    const bound = list('agent').filter(usesMachine);
    if (bound.length) return {allowed:false, reason:`仍有 ${bound.length} 位员工使用，请先在智能体中改绑运行器`, boundCount:bound.length};
    if (list('run').some(run => ['queued','running','stopping'].includes(run.status) && usesMachine(run.agent))) {
      return {allowed:false, reason:'仍有排队或执行中的任务使用此机器，请先结束任务'};
    }
    const grace = Math.max(expiry, (machine.heartbeatSeconds ?? 10) * 3000 + 10_000);
    if (machine.status === 'online' || (machine.seenAt && Date.now() - Date.parse(machine.seenAt) <= grace)) {
      return {allowed:false, reason:'请先停止客户端采集并等待离线，最近上报尚未过期'};
    }
    return {allowed:true, reason:'机器离线且没有员工使用，可删除配对与扫描记录'};
  }

  function deleteMachine(id, actor) {
    return tx(() => {
      const machine = get('machine', id);
      if (!machine) fail('接入机器不存在', 404);
      const state = removalState(machine);
      if (!state.allowed) fail(state.reason, 409);
      const candidates = list('candidate').filter(row => row.machineId === id);
      for (const row of candidates) remove('candidate', row.id);
      remove('machine', id);
      event('machine.deleted', {machineId:id, name:machine.name, removedSources:candidates.length, operator:actor?.username});
      return {id, name:machine.name};
    });
  }

  function receive(machineId, input) {
    const {hostname, platform, processScan, windowTitleStatus, found} = validateReport(input);
    const heartbeatSeconds = integer(input.heartbeatSeconds ?? 10, '心跳间隔', 5, 3600);
    const local = machineId === 'local';
    return tx(() => {
      const before = get('machine', machineId);
      if (!local && (!before || before.status === 'revoked')) fail('配对凭据无效', 401);
      const stamp = now();
      const machine = put('machine', {...before, id: machineId, name: before?.name ?? '本机',
        hostname, platform, processScan, windowTitleStatus, heartbeatSeconds, local, status: 'online', seenAt: stamp,
        createdAt: before?.createdAt ?? stamp});
      if (before?.status !== 'online' || before.processScan !== processScan) {
        event('machine.status', {machineId, status: machine.status, processScan});
      }
      const existing = list('candidate').filter(candidate => candidate.machineId === machineId);
      const indexed = new Map(existing.map(candidate => [candidate.key, candidate]));
      for (const [key, observation] of found) {
        const old = indexed.get(key);
        const candidate = put('candidate', {
          ...old, ...observation, id: old?.id ?? randomUUID(), key, machineId, present: true,
          status: old?.status ?? (observation.kind === 'process' ? 'observed' : 'discovered'),
          firstSeenAt: old?.firstSeenAt ?? stamp, lastSeenAt: stamp,
        });
        if (!old || !old.present) event(observation.kind === 'process' ? 'runtime.instance_seen'
          : old ? 'candidate.reappeared' : 'candidate.discovered',
          {candidateId: candidate.id, machineId, provider: candidate.provider, kind: candidate.kind},
          {agentId: candidate.agentId});
      }
      for (const old of existing) {
        if (!old.present || found.has(old.key) || (['process', 'runtime'].includes(old.kind) && processScan === 'unavailable')) continue;
        put('candidate', {...old, present: false});
        event('candidate.not_seen', {candidateId: old.id, machineId}, {agentId: old.agentId});
      }
      return {accepted: found.size};
    });
  }

  function sweep() {
    const disconnected = list('machine').filter(machine => machine.status === 'online' &&
      Date.now() - Date.parse(machine.seenAt) > Math.max(expiry, (machine.heartbeatSeconds ?? 10) * 3000 + 10_000));
    if (!disconnected.length) return;
    tx(() => {
      for (const machine of disconnected) {
        put('machine', {...machine, status: 'offline'});
        event('machine.status', {machineId: machine.id, status: 'offline'});
      }
    });
  }

  function snapshot() {
    return {machines: list('machine').map(machine => ({...publicMachine(machine), removal:removalState(machine)})), candidates: list('candidate')};
  }

  return {connect, issueMachine, issuePairing: input => issueMachine(input, true), exchangeCode, clientStatus, readTasks,
    authenticate, receive, revoke, deleteMachine, sweep, snapshot};
}
