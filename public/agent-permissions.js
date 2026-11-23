export const executionRuntimes = ['codex', 'pi'];

export const agentPermissionDefinitions = [
  {key:'comments', label:'任务评论与 @ 协作', roles:['worker','lead','hr','finance'], runtimes:['codex','pi']},
  {key:'discussions', label:'发起协作讨论', roles:['worker','lead','hr','finance'], runtimes:['codex']},
  {key:'delegation', label:'拆分并启动子任务', roles:['lead'], runtimes:['codex']},
  {key:'hiring', label:'提交入职档案与创建员工', roles:['hr'], runtimes:['codex']},
  {key:'budgets', label:'调整小队与员工预算', roles:['finance'], runtimes:['codex']},
];

export function permissionAvailable(agent, definition) {
  return definition.roles.includes(agent.role) && definition.runtimes.includes(agent.runtime);
}

export function effectiveAgentPermissions(agent) {
  const tools = agent.authorization?.tools ?? agent.permissions;
  return Object.fromEntries(agentPermissionDefinitions.map(definition => [definition.key,
    permissionAvailable(agent, definition) && (agent.authorization?.execution ?? true) && (tools?.[definition.key] ?? true)]));
}

export function agentAuthorization(agent) {
  return {execution:agent.authorization?.execution ?? true,
    sandbox:agent.authorization?.sandbox ?? agent.sandbox ?? 'read-only',
    mcpServerIds:agent.authorization?.mcpServerIds ?? agent.mcpServerIds ?? [],
    tools:Object.fromEntries(agentPermissionDefinitions.map(item => [item.key,
      agent.authorization?.tools?.[item.key] ?? agent.permissions?.[item.key] ?? item.roles.includes(agent.role)]))};
}

export function executionAdapterStatus(agent) {
  if (executionRuntimes.includes(agent.runtime)) return {label:'已接入执行', ready:true,
    detail:agent.runtime === 'pi' ? 'Pi 已接入任务执行，内置文件和终端工具未接入。' : 'Codex 已接入任务执行。'};
  if (agent.runtime === 'demo') return {label:'演示适配器', ready:true, detail:'仅演示事件流，不调用真实模型。'};
  return {label:executionRuntimes.includes(agent.provider) ? '仅观察模式' : '未接入执行', ready:false, detail:executionRuntimes.includes(agent.provider)
    ? '当前来源仅用于发现，未绑定本机执行适配器。可在 Agent 选择中改用已接入的本机运行方式。'
    : '已支持发现与状态采集，尚未接入此来源的任务执行接口。管理员授权不能代替执行适配器。'};
}

export function agentCanExecute(agent) {
  return executionAdapterStatus(agent).ready && agentAuthorization(agent).execution;
}

const toolPermissions = {
  office_post_comment:'comments', office_start_discussion:'discussions',
  office_create_task:'delegation', office_start_subtask:'delegation',
  office_review_candidate:'hiring', office_hire:'hiring', office_set_budget:'budgets',
};
export function agentToolAllowed(agent, name) {
  const permission = toolPermissions[name];
  return !permission || effectiveAgentPermissions(agent)[permission];
}
