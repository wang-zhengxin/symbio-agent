import { agentCanExecute, executionRuntimes } from './agent-permissions.js';

export const githubOperations = Object.freeze({
  read: '读取代码、Issue 和 PR',
  branch: '创建分支',
  commit: '提交代码',
  issues: '管理 Issue',
  pr_create: '创建 PR',
  pr_merge: '合并 PR',
});

export const githubModes = Object.freeze({
  inherit: '继承工作区 GitHub 权限',
  custom: '自定义仓库及操作范围',
  deny: '禁止访问 GitHub',
});

export function githubScope(agent) {
  return agent.authorization?.github ?? {mode:'inherit', repositoryIds:[], operations:[]};
}

export function githubGrants(integration, agent, scope = githubScope(agent)) {
  if (!integration?.account || !executionRuntimes.includes(agent.runtime) || !agentCanExecute(agent) || scope.mode === 'deny') return [];
  return integration.repositories.flatMap(({id, fullName, operations}) => {
    if (scope.mode === 'inherit') return operations.length ? [{id, fullName, operations}] : [];
    if (scope.mode !== 'custom' || !scope.repositoryIds.includes(id)) return [];
    const allowed = operations.filter(operation => scope.operations.includes(operation));
    return allowed.length ? [{id, fullName, operations:allowed}] : [];
  });
}
