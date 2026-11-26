import { randomUUID } from 'node:crypto';
import { githubGrants, githubModes, githubOperations } from '../public/github-policy.js';
import { choice, fail, ids } from './input.js';
import { createGhSession } from './github-auth.js';
import { githubListTool, githubTools, repositoryName } from './github-tools.js';

const operationKeys = Object.keys(githubOperations);
const tools = new Map(githubTools.map(tool => [tool.definition.name, tool]));
const maxRepositories = 100;
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

export function readGithubIntegration(store) {
  return store.get('integration', 'github') ?? {id:'github', version:0, account:null, connectionId:null, repositories:[]};
}

function operations(values) {
  return ids(values, 'GitHub 操作范围', operationKeys.length).map(value => choice(value, operationKeys, 'GitHub 操作'));
}

export function normalizeGithubScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['mode', 'repositoryIds', 'operations'].includes(key))) fail('GitHub 授权范围无效');
  const mode = choice(input.mode, Object.keys(githubModes), 'GitHub 授权方式');
  if (mode !== 'custom') return {mode, repositoryIds:[], operations:[]};
  const repositoryIds = ids(input.repositoryIds ?? [], 'GitHub 仓库范围', maxRepositories);
  if (repositoryIds.some(id => !/^[1-9]\d{0,15}$/.test(id))) fail('GitHub 仓库标识无效');
  return {mode, repositoryIds, operations:operations(input.operations ?? [])};
}

export function snapshotGithubAccess(store, agent) {
  const integration = readGithubIntegration(store);
  const repositories = githubGrants(integration, agent);
  return repositories.length ? {connectionId:integration.connectionId, repositories} : undefined;
}

function githubRepository(value) {
  if (!Number.isSafeInteger(value?.id) || value.id <= 0 || typeof value.default_branch !== 'string') {
    fail('GitHub 未返回有效的仓库信息', 502);
  }
  return {id:String(value.id), fullName:repositoryName(value.full_name), defaultBranch:value.default_branch,
    private:value.private === true, disabled:value.disabled === true, archived:value.archived === true,
    hasIssues:value.has_issues !== false, canPush:value.permissions?.push === true};
}

export function createGithubIntegration(store, openSession = createGhSession()) {
  const read = () => readGithubIntegration(store);

  function expectVersion(expectedVersion) {
    const current = read();
    if (expectedVersion !== current.version) fail('GitHub 集成设置已更新，请刷新后重试', 409);
    return current;
  }

  function save(current, changes, type, payload, actor) {
    return store.tx(() => {
      expectVersion(current.version);
      const next = store.put('integration', {...current, ...changes, version:current.version + 1});
      store.event(type, {name:'GitHub', ...payload, operator:actor?.username});
      return next;
    });
  }

  async function connect({expectedVersion}, actor) {
    const current = expectVersion(expectedVersion);
    const {account} = await openSession();
    if (current.account && current.account.id !== account.id) {
      fail('当前 gh 登录账号与工作区不同。请切回原账号，或断开后连接新账号', 409);
    }
    return save(current, {account, connectionId:current.connectionId ?? randomUUID(), verifiedAt:new Date().toISOString()},
      current.account ? 'github.verified' : 'github.connected', {account:account.login}, actor);
  }

  function disconnect({expectedVersion}, actor) {
    const current = expectVersion(expectedVersion);
    if (!current.account) return current;
    return save(current, {account:null, connectionId:null, verifiedAt:null, repositories:[]},
      'github.disconnected', {account:current.account.login}, actor);
  }

  async function saveRepository(input, actor) {
    const current = expectVersion(input.expectedVersion);
    if (!current.account) fail('请先连接工作区 GitHub 账号', 409);
    const fullName = repositoryName(input.fullName);
    const allowed = operations(input.operations);
    const {account, request} = await openSession();
    if (account.id !== current.account.id) fail('当前 gh 登录账号与工作区不同，请验证 GitHub 连接', 409);
    const repository = githubRepository(await request('/repos/' + fullName));
    const existing = current.repositories.find(row => row.id === repository.id);
    if (input.id && input.id !== repository.id) fail('GitHub 仓库身份已变化，请重新添加仓库', 409);
    if (!existing && current.repositories.length >= maxRepositories) fail('工作区最多可以授权 100 个 GitHub 仓库');
    const repositories = current.repositories.filter(row => row.id !== repository.id && !sameName(row.fullName, repository.fullName));
    repositories.push({...repository, operations:allowed});
    repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return save(current, {repositories}, 'github.repository_saved',
      {name:repository.fullName, account:account.login, operations:allowed}, actor);
  }

  function removeRepository({id, expectedVersion}, actor) {
    const current = expectVersion(expectedVersion);
    const repo = current.repositories.find(row => row.id === id);
    if (!repo) fail('工作区中没有此 GitHub 仓库', 404);
    return save(current, {repositories:current.repositories.filter(row => row.id !== id)},
      'github.repository_removed', {name:repo.fullName, account:current.account?.login}, actor);
  }

  function grantsFor(run) {
    const current = read();
    if (run.kind !== 'task' || !current.account || !run.githubAccess || current.connectionId !== run.githubAccess.connectionId) return [];
    const agent = store.get('agent', run.agentId);
    if (!agent) return [];
    const previous = new Map(run.githubAccess.repositories.map(repo => [repo.id, repo.operations]));
    return githubGrants(current, agent).flatMap(repo => {
      const allowed = repo.operations.filter(operation => previous.get(repo.id)?.includes(operation));
      return allowed.length ? [{...repo, operations:allowed}] : [];
    });
  }

  function definitions(run) {
    const activeOperations = new Set(grantsFor(run).flatMap(repo => repo.operations));
    if (!activeOperations.size) return [];
    return [githubListTool, ...githubTools.filter(tool => activeOperations.has(tool.operation)).map(tool => tool.definition)];
  }

  function requireGrant(run, permission, name) {
    if (store.get('run', run.id)?.status !== 'running') fail('执行已结束，GitHub 工具不可用', 409);
    const grants = grantsFor(run);
    if (name === undefined && grants.length) return grants;
    const grant = grants.find(repo => sameName(repo.fullName, name ?? '') && repo.operations.includes(permission));
    if (!grant) fail('本次任务没有该 GitHub 仓库或操作的授权', 403);
    return grant;
  }

  async function call(run, toolName, args, signal) {
    const tool = tools.get(toolName);
    if (!tool && toolName !== githubListTool.name) fail('未知的 GitHub 工具', 404);
    const current = read();
    let repository;
    let resource;
    let outcome = 'success';
    try {
      signal?.throwIfAborted();
      if (tool) repository = repositoryName(args.repository);
      const grant = requireGrant(run, tool?.operation, repository);
      const {account, request} = await openSession(signal);
      if (account.id !== current.account?.id) fail('当前 gh 登录账号与工作区不同，请管理员验证连接', 403);
      if (!tool) return {repositories:requireGrant(run)};
      // Recheck live authorization before each API step, including just before a write.
      const guarded = (path, options) => {
        signal?.throwIfAborted();
        const latest = requireGrant(run, tool.operation, repository);
        if (latest.id !== grant.id) fail('GitHub 仓库授权已变更，请重新派发任务', 403);
        return request(path, options);
      };
      const path = '/repos/' + grant.fullName;
      const repo = githubRepository(await guarded(path));
      if (repo.id !== grant.id || !sameName(repo.fullName, grant.fullName)) fail('GitHub 仓库身份已变化，请管理员重新授权', 403);
      if (repo.disabled || (tool.operation !== 'read' && repo.archived)) fail('当前 GitHub 仓库不可执行此操作', 403);
      if (['commit', 'branch', 'pr_merge'].includes(tool.operation) && !repo.canPush) fail('当前 GitHub 账号没有该仓库的推送权限', 403);
      if (tool.operation === 'issues' && !repo.hasIssues) fail('此 GitHub 仓库未启用 Issues', 409);
      const result = await tool.execute({request:guarded, repo, path}, args);
      if (tool.operation !== 'read') resource = {number:result.number, branch:result.branch, sha:result.sha};
      return result;
    } catch (error) {
      outcome = error.status === 403 ? 'denied' : 'failed';
      // Normalized integration errors never contain GitHub response bodies or shell output.
      if (error.status) throw error;
      fail(signal?.aborted ? 'GitHub 操作已中止' : 'GitHub 工具调用失败', 502);
    } finally {
      store.tx(() => store.event('github.operation', {name:repository ?? 'GitHub',
        account:current.account?.login, operation:toolName, outcome, resource}, run));
    }
  }

  return {read, connect, disconnect, saveRepository, removeRepository, definitions, call,
    handles:toolName => tools.has(toolName) || toolName === githubListTool.name};
}
