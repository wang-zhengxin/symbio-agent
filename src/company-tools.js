import { fail } from './input.js';

const text = {type: 'string'};
const count = {type: 'integer'};
const flag = {type: 'boolean'};
const strings = {type: 'array', items: text};
const spec = (name, description, properties = {}, required = []) => ({
  type: 'function', name, description,
  inputSchema: {type: 'object', properties, required, additionalProperties: false},
});

export function companyTools(store, office, run) {
  const tools = new Map();
  const add = (definition, handler) => tools.set(definition.name, {definition, handler});
  const readUsage = () => office.ledger().map(row => ({
    ...row, name: row.scope === 'company' ? '公司' : store.get(row.scope, row.id)?.name,
  }));

  if (run.kind !== 'comment') add(spec('office_roster', '查询员工、小组和技能的名称及 ID'), () => ({
    agents: store.list('agent').map(({id, name, role, teamId, scope, runtime}) => ({id, name, role, teamId, scope, runtime})),
    teams: store.list('team').map(({id, name}) => ({id, name})),
    skills: store.list('skill').map(({id, name, description}) => ({id, name, description})),
  }));

  if (run.agent.role === 'finance' && run.kind !== 'comment') {
    add(spec('office_usage', '查询公司、小组和员工的 Token 用量、预留和可用余额'), readUsage);
  }
  if (run.kind === 'task') {
    add(spec('office_task_discussion', '读取当前任务的新评论及 @ 对象。子任务可用 parent=true 读取父任务讨论。',
      {parent:flag}), args => office.taskDiscussion(run, args.parent === true));
    add(spec('office_post_comment', '在当前任务发表评论，可回复指定评论或 @ 同事。@ Agent 会异步排队回复。子任务可用 parent=true 发到父任务。',
      {text, replyToId:text, mentions:strings, parent:flag, emailMentions:flag}, ['text']), args => office.commentTask(run.taskId, args, run));
    if (run.agent.role === 'hr') {
      add(spec('office_candidates', '查询扫描发现且待人事处理的候选 Agent'),
        () => store.list('candidate').filter(item => ['discovered', 'review'].includes(item.status) && item.present)
          .slice(0, 100).map(({id, provider, kind, machineId, status}) => ({id, provider, kind, machineId, status})));
      add(spec('office_review_candidate', '为扫描发现的 Agent 提交入职档案，等待工作台批准',
        {candidateId: text, name: text, personality: text, scope: text, teamId: text, skillIds: strings},
        ['candidateId', 'name', 'personality', 'scope']), args =>
        office.stageCandidate(args.candidateId, {...args, role: 'worker', runtime: 'observed', sandbox: 'read-only'}, run));
      add(spec('office_hire', '创建普通员工。新员工沿用人事的运行器，仅有只读文件权限。',
        {name: text, personality: text, scope: text, teamId: text, skillIds: strings},
        ['name', 'personality', 'scope']), args => office.saveAgent({
        ...args, id: undefined, role: 'worker', runtime: run.agent.runtime, model: run.agent.model, sandbox: 'read-only',
      }, run));
    }
    if (run.agent.role === 'finance') {
      add(spec('office_set_budget', '在已设置的公司额度内调整小组或其他员工的 Token 上限',
        {scope: {type: 'string', enum: ['team', 'agent']}, targetId: text, limit: count},
        ['scope', 'targetId', 'limit']), args => office.setBudget(args, run));
    }
    if (run.agent.role === 'lead') {
      add(spec('office_create_task', '把当前任务拆出一个子任务，可指定 Agent、真人负责人和前置依赖。返回子任务 ID。',
        {title:text, description:text, acceptance:text, assigneeId:text, humanId:text, dependencyIds:strings},
        ['title', 'description', 'acceptance']), args => office.saveTask({
        title:args.title, description:args.description, acceptance:args.acceptance,
        assigneeId:args.assigneeId, humanId:args.humanId, dependencyIds:args.dependencyIds, parentId:run.taskId,
      }, run));
      add(spec('office_start_subtask', '启动当前任务下已分配给 Agent 的子任务。执行异步排队，请勿在本次运行中持续等待。',
        {taskId:text}, ['taskId']), args => {
        if (store.get('task', args.taskId)?.parentId !== run.taskId) fail('只能启动当前任务的直接子任务', 403);
        const queued = office.enqueueTask(args.taskId);
        return {id:queued.id, taskId:queued.taskId, status:queued.status};
      });
    }
    add(spec('office_start_discussion', '邀请其他员工围绕当前任务讨论。调用会安排实际发言，无需在本次执行中等待结果。',
      {topic: text, inviteeIds: strings}, ['topic', 'inviteeIds']), args => {
      if (!Array.isArray(args.inviteeIds)) fail('参与员工无效');
      return office.startConversation({topic: args.topic, participantIds: [run.agentId, ...args.inviteeIds],
        taskId: run.taskId, rounds: 1, reserve: run.reserve}, run);
    });
  }

  const responses = new Map();
  return {
    definitions: [...tools.values()].map(tool => tool.definition),
    call({callId, namespace, tool, arguments: args}) {
      if (responses.has(callId)) return responses.get(callId);
      function respond(success, value) {
        const response = {success, contentItems: [{type: 'inputText', text: JSON.stringify(value)}]};
        if (responses.size < 12) responses.set(callId, response);
        return response;
      }
      try {
        if (responses.size >= 12) fail('本次执行的公司工具调用已达上限');
        if (store.get('run', run.id)?.status !== 'running') fail('执行已经停止');
        const definition = !namespace && tools.get(tool);
        if (!definition || typeof callId !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) {
          fail('不支持此公司工具或参数');
        }
        return respond(true, definition.handler(args));
      } catch (error) {
        return respond(false, {error: error.status ? error.message : '公司工具调用失败'});
      }
    },
  };
}
