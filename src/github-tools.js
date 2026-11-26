import { choice, fail, integer, string } from './input.js';

const text = {type:'string'};
const number = {type:'integer'};
const repository = {repository:text};
const state = {type:'string', enum:['open', 'closed', 'all']};
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const maxFileBytes = 160_000;
const pageSize = 25;

export function repositoryName(value) {
  const name = string(value, 'GitHub 仓库', 140);
  if (!/^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/i.test(name) || /\/\.{1,2}$/.test(name)) {
    fail('GitHub 仓库须使用 owner/repository 格式');
  }
  return name;
}

function branchName(value) {
  const name = string(value, '分支名', 180);
  if (!/^[a-z\d_][a-z\d_./-]*$/i.test(name) || name.startsWith('refs/') || name.includes('..') ||
      name.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) fail('分支名无效');
  return name;
}

function commitSha(value) {
  const sha = string(value, '提交 SHA', 40);
  if (!/^[a-f0-9]{40}$/i.test(sha)) fail('请提供完整的提交 SHA');
  return sha.toLowerCase();
}

function filePath(value, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  const path = string(value, '仓库路径', 512);
  if (path !== value || /[\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part =>
    !part || ['.', '..', '.git'].includes(part.toLowerCase()))) fail('仓库路径须为有效的相对路径');
  return path;
}

function itemNumber(value) {
  return integer(value, '编号', 1, 2_147_483_647);
}

function listQuery(args, fallback = 'open') {
  const page = integer(args.page ?? 1, '页码', 1, 1000);
  return {page, query:new URLSearchParams({state:choice(args.state ?? fallback, state.enum, '状态'), page, per_page:pageSize})};
}

function tool(operation, name, description, properties, required, execute) {
  return {operation, execute, definition:{type:'function', name, description,
    inputSchema:{type:'object', properties, required, additionalProperties:false}}};
}

async function branchInfo({request, path}, branch) {
  const result = await request(path + '/branches/' + encodeURIComponent(branch));
  return {name:result.name, sha:result.commit?.sha, protected:result.protected === true};
}

const issue = (row, repo, includeBody = true) => ({
  number:row.number, title:row.title, state:row.state, author:row.user?.login,
  labels:row.labels?.map(label => label.name), updatedAt:row.updated_at,
  url:`https://github.com/${repo.fullName}/issues/${row.number}`,
  ...(includeBody ? {body:row.body?.slice(0, 12_000)} : {}),
});

const pull = (row, repo, includeBody = true) => ({
  number:row.number, title:row.title, state:row.state, draft:row.draft, merged:row.merged,
  head:row.head?.ref, headSha:row.head?.sha, base:row.base?.ref, updatedAt:row.updated_at,
  url:`https://github.com/${repo.fullName}/pull/${row.number}`,
  ...(includeBody ? {body:row.body?.slice(0, 12_000), mergeable:row.mergeable, mergeState:row.mergeable_state} : {}),
});

async function readIssue({request, path}, n) {
  const row = await request(path + '/issues/' + n);
  if (row.pull_request) fail('该编号是 PR，请使用 PR 工具');
  return row;
}

function commitChanges(args) {
  const {files = [], deletePaths = []} = args;
  if (!Array.isArray(files) || !Array.isArray(deletePaths) || !files.length && !deletePaths.length ||
      files.length + deletePaths.length > 24) fail('每次提交须包含 1 至 24 个文件变更');
  let bytes = 0;
  const additions = files.map(file => {
    if (typeof file?.content !== 'string' || file.content.includes('\0')) fail('提交内容须为 UTF-8 文本');
    bytes += Buffer.byteLength(file.content);
    if (bytes > 256_000) fail('提交文本总计不能超过 256 KB', 413);
    return {path:filePath(file.path), contents:Buffer.from(file.content).toString('base64')};
  });
  const deletions = deletePaths.map(path => ({path:filePath(path)}));
  const paths = [...additions, ...deletions].map(file => file.path).sort();
  const unique = new Set(paths);
  if (unique.size !== paths.length || paths.some(path => path.split('/').slice(0, -1).some((_, index, parts) => unique.has(parts.slice(0, index + 1).join('/'))))) {
    fail('提交中存在重复或冲突的文件路径');
  }
  return {additions, deletions};
}

const commitMutation = `mutation SymbioCommit($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid url } }
}`;
const mergeQuery = `query SymbioPullRequest($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state isDraft headRefOid mergeStateStatus reviewDecision }
  }
}`;

export const githubTools = [
  tool('read', 'github_get_repository', '读取获授权仓库及分支信息。传 branch 获取其当前提交 SHA。',
    {...repository, branch:text}, ['repository'], async (context, args) => ({
      repository:context.repo.fullName, defaultBranch:context.repo.defaultBranch, private:context.repo.private,
      ...(args.branch === undefined ? {} : {branch:await branchInfo(context, branchName(args.branch))}),
    })),
  tool('read', 'github_read_path', '列出仓库目录或读取 UTF-8 文本文件。ref 可填写分支名或完整提交 SHA。',
    {...repository, path:text, ref:text}, ['repository'], async ({request, path, repo}, args) => {
      const name = filePath(args.path, true);
      const ref = args.ref === undefined ? repo.defaultBranch
        : /^[a-f0-9]{40}$/i.test(args.ref) ? commitSha(args.ref) : branchName(args.ref);
      const result = await request(`${path}/contents${name ? '/' + encodePath(name) : ''}?${new URLSearchParams({ref})}`);
      if (Array.isArray(result)) return {path:name, ref, truncated:result.length > 100,
        entries:result.slice(0, 100).map(({name, path, type, size, sha}) => ({name, path, type, size, sha}))};
      if (result.type !== 'file' || result.encoding !== 'base64' || result.size > maxFileBytes || typeof result.content !== 'string') {
        fail('只支持读取不超过 160 KB 的 UTF-8 文本文件', 413);
      }
      const bytes = Buffer.from(result.content, 'base64');
      if (bytes.length > maxFileBytes || bytes.includes(0)) fail('文件超出大小限制或不是文本', 413);
      let content;
      try { content = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
      catch { fail('该文件不是 UTF-8 文本'); }
      return {path:name, ref, sha:result.sha, content};
    }),
  tool('branch', 'github_create_branch', '在获授权仓库创建分支。base 省略时使用默认分支。',
    {...repository, branch:text, base:text}, ['repository', 'branch'], async (context, args) => {
      const branch = branchName(args.branch);
      const {sha} = await branchInfo(context, args.base === undefined ? context.repo.defaultBranch : branchName(args.base));
      const created = await context.request(context.path + '/git/refs', {method:'POST', body:{ref:`refs/heads/${branch}`, sha:commitSha(sha)}});
      return {branch, sha:created.object?.sha};
    }),
  tool('commit', 'github_commit_files', '向非默认、非受保护分支提交文本文件变更。expectedHead 必须是该分支当前的完整 SHA。',
    {...repository, branch:text, expectedHead:text, message:text,
      files:{type:'array', items:{type:'object', properties:{path:text, content:text}, required:['path', 'content'], additionalProperties:false}},
      deletePaths:{type:'array', items:text}}, ['repository', 'branch', 'expectedHead', 'message'], async (context, args) => {
      const branch = branchName(args.branch);
      const expectedHeadOid = commitSha(args.expectedHead);
      const headline = string(args.message, '提交说明', 240);
      if (/[\r\n]/.test(headline)) fail('提交说明须为单行文本');
      const fileChanges = commitChanges(args);
      const head = await branchInfo(context, branch);
      if (branch === context.repo.defaultBranch || head.protected) fail('请在工作分支提交代码，然后通过 PR 交付', 403);
      if (head.sha !== expectedHeadOid) fail('分支已更新，请读取最新 SHA 并核对变更后重试', 409);
      const result = await context.request('/graphql', {method:'POST', body:{query:commitMutation, variables:{input:{
        branch:{repositoryNameWithOwner:context.repo.fullName, refName:`refs/heads/${branch}`},
        expectedHeadOid, message:{headline}, fileChanges,
      }}}});
      const commit = result.data?.createCommitOnBranch?.commit;
      if (!commit?.oid || result.errors?.length) fail('GitHub 未提交变更，请核对分支最新 SHA、凭据权限和仓库规则', 409);
      return {branch, sha:commit.oid, url:`https://github.com/${context.repo.fullName}/commit/${commit.oid}`};
    }),
  tool('read', 'github_list_issues', '分页读取仓库 Issue。每页最多 25 条，state 可选 open、closed 或 all。',
    {...repository, state, page:number}, ['repository'], async ({request, path, repo}, args) => {
      const {page, query} = listQuery(args);
      const rows = await request(path + '/issues?' + query);
      return {page, hasMore:rows.length === pageSize, issues:rows.filter(row => !row.pull_request).map(row => issue(row, repo, false))};
    }),
  tool('read', 'github_get_issue', '读取指定 Issue 的正文、状态与最近评论。',
    {...repository, number}, ['repository', 'number'], async (context, args) => {
      const n = itemNumber(args.number);
      const row = await readIssue(context, n);
      const comments = await context.request(`${context.path}/issues/${n}/comments?per_page=10&sort=created&direction=desc`);
      return {...issue(row, context.repo), comments:comments.map(row => ({author:row.user?.login, body:row.body?.slice(0, 3000)}))};
    }),
  tool('issues', 'github_manage_issue', '创建、编辑、关闭、重开或评论 Issue。action 为 create、edit 或 comment。',
    {...repository, action:{type:'string', enum:['create', 'edit', 'comment']}, number, title:text, body:text,
      state:{type:'string', enum:['open', 'closed']}}, ['repository', 'action'], async (context, args) => {
      const {request, path, repo} = context;
      const action = choice(args.action, ['create', 'edit', 'comment'], 'Issue 操作');
      if (action === 'create') return issue(await request(path + '/issues', {method:'POST', body:{
        title:string(args.title, 'Issue 标题', 240), body:string(args.body, 'Issue 正文', 16_000, true),
      }}), repo, false);
      const n = itemNumber(args.number);
      await readIssue(context, n);
      if (action === 'comment') {
        const comment = await request(`${path}/issues/${n}/comments`, {method:'POST', body:{body:string(args.body, '评论', 16_000)}});
        return {number:n, commentId:comment.id, url:`https://github.com/${repo.fullName}/issues/${n}#issuecomment-${comment.id}`};
      }
      const changes = {};
      if (args.title !== undefined) changes.title = string(args.title, 'Issue 标题', 240);
      if (args.body !== undefined) changes.body = string(args.body, 'Issue 正文', 16_000, true);
      if (args.state !== undefined) changes.state = choice(args.state, ['open', 'closed'], 'Issue 状态');
      if (!Object.keys(changes).length) fail('请提供需要更新的 Issue 字段');
      return issue(await request(`${path}/issues/${n}`, {method:'PATCH', body:changes}), repo, false);
    }),
  tool('read', 'github_list_pull_requests', '分页读取仓库 PR。每页最多 25 条，state 可选 open、closed 或 all。',
    {...repository, state, page:number}, ['repository'], async ({request, path, repo}, args) => {
      const {page, query} = listQuery(args);
      const rows = await request(path + '/pulls?' + query);
      return {page, hasMore:rows.length === pageSize, pullRequests:rows.map(row => pull(row, repo, false))};
    }),
  tool('read', 'github_get_pull_request', '读取指定 PR 和当前 head SHA。',
    {...repository, number}, ['repository', 'number'], async ({request, path, repo}, args) =>
      pull(await request(path + '/pulls/' + itemNumber(args.number)), repo)),
  tool('pr_create', 'github_create_pull_request', '为同一仓库的工作分支创建 PR。base 省略时使用默认分支。',
    {...repository, head:text, base:text, title:text, body:text, draft:{type:'boolean'}},
    ['repository', 'head', 'title'], async ({request, path, repo}, args) => {
      const head = branchName(args.head);
      const base = args.base === undefined ? repo.defaultBranch : branchName(args.base);
      if (head === base) fail('来源分支和目标分支不能相同');
      if (args.draft !== undefined && typeof args.draft !== 'boolean') fail('草稿选项无效');
      return pull(await request(path + '/pulls', {method:'POST', body:{head, base,
        title:string(args.title, 'PR 标题', 240), body:string(args.body, 'PR 正文', 16_000, true), draft:args.draft ?? false,
      }}), repo, false);
    }),
  tool('pr_merge', 'github_merge_pull_request', '按 GitHub 仓库规则合并已通过检查的 PR。expectedHead 须匹配已验收的完整 head SHA。',
    {...repository, number, expectedHead:text, method:{type:'string', enum:['merge', 'squash', 'rebase']}},
    ['repository', 'number', 'expectedHead'], async ({request, path, repo}, args) => {
      const n = itemNumber(args.number);
      const sha = commitSha(args.expectedHead);
      const [owner, name] = repo.fullName.split('/');
      const merge_method = choice(args.method ?? 'merge', ['merge', 'squash', 'rebase'], '合并方式');
      const result = await request('/graphql', {method:'POST', body:{query:mergeQuery, variables:{owner, name, number:n}}});
      const pr = result.data?.repository?.pullRequest;
      if (!pr || result.errors?.length) fail('GitHub 未返回 PR 的合并条件，请检查权限后重试', 409);
      if (pr.headRefOid !== sha) fail('PR 内容已更新，请核对最新提交后再合并', 409);
      if (pr.state !== 'OPEN' || pr.isDraft || pr.mergeStateStatus !== 'CLEAN' ||
          ['REVIEW_REQUIRED', 'CHANGES_REQUESTED'].includes(pr.reviewDecision)) {
        fail('PR 当前未满足合并条件，请在 GitHub 检查评审、检查项和分支状态', 409);
      }
      const merged = await request(`${path}/pulls/${n}/merge`, {method:'PUT', body:{sha, merge_method}});
      if (merged.merged !== true) fail('GitHub 未合并该 PR，请检查仓库规则', 409);
      return {number:n, sha:merged.sha, merged:true, url:`https://github.com/${repo.fullName}/pull/${n}`};
    }),
];

export const githubListTool = {type:'function', name:'github_list_repositories',
  description:'查看本次任务获授权的工作区 GitHub 仓库和每个仓库允许的操作。',
  inputSchema:{type:'object', properties:{}, required:[], additionalProperties:false}};
