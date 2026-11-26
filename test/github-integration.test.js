import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { companyTools } from '../src/company-tools.js';
import { createGithubIntegration } from '../src/github-integration.js';
import { createGhSession } from '../src/github-auth.js';
import { githubOperations } from '../public/github-policy.js';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const primary = 'team/project';
const secondary = 'team/notes';
const primaryPath = '/repos/' + primary;
const branchPath = primaryPath + '/branches/work%2Ffeature';

function setup(t, handle = () => assert.fail('Unexpected GitHub request')) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const office = createOffice(store);
  const requests = [];
  const remote = {account:{id:'1', login:'workspace-user'}, primaryId:101, primaryPush:true};
  const github = createGithubIntegration(store, async () => ({
    account:{...remote.account},
    async request(path, options = {}) {
      const request = {path, method:options.method ?? 'GET', body:options.body};
      requests.push(request);
      if (path === primaryPath || path === '/repos/' + secondary) {
        const main = path === primaryPath;
        return {id:main ? remote.primaryId : 102, full_name:main ? primary : secondary,
          default_branch:'main', private:true, has_issues:true, permissions:{push:main && remote.primaryPush}};
      }
      return handle(request);
    },
  }));
  const save = (fullName, operations) => github.saveRepository({fullName, operations, expectedVersion:github.read().version});
  const start = agent => {
    const task = office.saveTask({title:'Test GitHub access', assigneeId:agent.id});
    const run = office.startRun(office.enqueueTask(task.id).id);
    return {run, task, tools:companyTools(store, office, run, {github})};
  };
  return {store, office, github, remote, requests, save, start};
}

let sequence = 0;
async function invoke(tools, tool, args, callId = `${tool}-${++sequence}`) {
  const response = await tools.call({tool, callId, arguments:args});
  return {success:response.success, ...JSON.parse(response.contentItems[0].text)};
}

test('GitHub workspace grants are inherited and agent scopes can only narrow them', async t => {
  const {store, office, github, remote, requests, save, start} = setup(t, request => {
    if (request.path === primaryPath + '/contents/README.md?ref=main') {
      return {type:'file', size:10, encoding:'base64', content:Buffer.from('hello').toString('base64')};
    }
    assert.fail('Out of scope: ' + request.path);
  });
  const existing = office.saveAgent({name:'Codex employee', runtime:'codex'});
  assert.equal(start(existing).tools.definitions.some(tool => tool.name.startsWith('github_')), false);
  await assert.rejects(save(primary, ['read']), /先连接/);
  await github.connect({expectedVersion:0});
  await save(primary, ['read','pr_create']);
  await save(secondary, ['read','branch']);
  const inherited = start(existing);
  const restricted = office.saveAgent({name:'Pi employee', runtime:'pi', authorization:{github:{
    mode:'custom', repositoryIds:['101','999'], operations:['read','pr_merge'],
  }}});
  const confined = start(restricted);
  const denied = start(office.saveAgent({name:'Denied', runtime:'codex', authorization:{github:{mode:'deny'}}}));
  const demo = start(office.saveAgent({name:'Demo', runtime:'demo'}));

  const listing = await invoke(inherited.tools, 'github_list_repositories', {});
  assert.deepEqual(listing.repositories.map(row => row.fullName), [secondary, primary]);
  const scoped = await invoke(confined.tools, 'github_list_repositories', {});
  assert.deepEqual(scoped.repositories, [{id:'101', fullName:primary, operations:['read']}]);
  assert.equal((await invoke(confined.tools, 'github_read_path', {repository:primary, path:'README.md'})).content, 'hello');
  assert.equal(confined.tools.definitions.some(tool => tool.name === 'github_create_pull_request'), false);
  assert.equal(denied.tools.definitions.some(tool => tool.name.startsWith('github_')), false);
  assert.equal(demo.tools.definitions.some(tool => tool.name.startsWith('github_')), false);

  const before = requests.length;
  assert.equal((await invoke(confined.tools, 'github_get_repository', {repository:secondary})).success, false);
  assert.equal((await invoke(confined.tools, 'github_merge_pull_request', {repository:primary})).success, false);
  assert.equal((await invoke(denied.tools, 'github_list_repositories', {})).success, false);
  assert.equal(requests.length, before);
  const upstreamDenied = await invoke(inherited.tools, 'github_create_branch', {repository:secondary, branch:'work/test'});
  assert.match(upstreamDenied.error, /推送权限/);

  remote.primaryId = 300;
  const replaced = await invoke(inherited.tools, 'github_read_path', {repository:primary, path:'README.md'});
  assert.match(replaced.error, /仓库身份/);
  remote.account = {id:'2', login:'another-user'};
  const switched = await invoke(inherited.tools, 'github_get_repository', {repository:primary});
  assert.match(switched.error, /登录账号/);
  await assert.rejects(github.connect({expectedVersion:github.read().version}), /切回原账号/);
  assert.equal(github.read().account.id, '1');

  const events = store.audit().filter(event => event.type === 'github.operation');
  assert.ok(events.some(event => event.agent_id === confined.run.agentId && event.task_id === confined.task.id &&
    event.run_id === confined.run.id && event.payload.outcome === 'denied' && event.payload.name === secondary));
});

test('Revocation applies to running tasks and reconnecting or widening cannot elevate an existing run', async t => {
  const reachedBranch = Promise.withResolvers();
  const reply = Promise.withResolvers();
  const {office, github, requests, save, start} = setup(t, request => {
    assert.equal(request.path, primaryPath + '/branches/main');
    reachedBranch.resolve();
    return reply.promise;
  });
  await github.connect({expectedVersion:0});
  await save(primary, ['read','branch']);
  const employee = office.saveAgent({name:'Agent', runtime:'codex'});
  const {tools} = start(employee);
  await save(primary, ['read','branch','pr_merge']);
  assert.equal((await invoke(tools, 'github_merge_pull_request', {repository:primary})).success, false);

  const pending = invoke(tools, 'github_create_branch', {repository:primary, branch:'work/change'});
  await reachedBranch.promise;
  const restricted = office.saveAgent({...employee, authorization:{github:{mode:'deny'}}});
  reply.resolve({commit:{sha:a}});
  assert.match((await pending).error, /没有.*授权/);
  assert.ok(!requests.some(request => request.method !== 'GET'));

  github.disconnect({expectedVersion:github.read().version});
  await github.connect({expectedVersion:github.read().version});
  await save(primary, ['read','branch']);
  office.saveAgent({...restricted, authorization:{github:{mode:'inherit'}}});
  assert.equal((await invoke(tools, 'github_list_repositories', {})).success, false);
  assert.ok((await invoke(start(employee).tools, 'github_list_repositories', {})).success);
});

test('GitHub write tools preserve branch state, Issue type and PR checks, and replay an in-flight call only once', async t => {
  let mergeState = 'BLOCKED';
  const {office, requests, github, save, start} = setup(t, ({path, method, body}) => {
    if ([branchPath, primaryPath + '/branches/main', primaryPath + '/branches/protected'].includes(path)) {
      return {commit:{sha:a}, protected:path.endsWith('/protected')};
    }
    if (path === primaryPath + '/git/refs' && method === 'POST') {
      assert.deepEqual(body, {ref:'refs/heads/work/feature', sha:a});
      return {object:{sha:a}};
    }
    if (path === '/graphql' && body.query.includes('createCommitOnBranch')) {
      assert.deepEqual(body.variables.input, {branch:{repositoryNameWithOwner:primary, refName:'refs/heads/work/feature'},
        expectedHeadOid:a, message:{headline:'Update files'}, fileChanges:{
          additions:[{path:'src/example.js', contents:Buffer.from('export const value = 1;\n').toString('base64')}],
          deletions:[{path:'old.txt'}],
        }});
      return {data:{createCommitOnBranch:{commit:{oid:b}}}};
    }
    if (path === primaryPath + '/issues' && method === 'POST') return {number:1, title:body.title, state:'open'};
    if (path === primaryPath + '/issues/1') {
      return {number:1, title:'Issue', state:method === 'PATCH' ? body.state : 'open'};
    }
    if (path === primaryPath + '/issues/1/comments' && method === 'POST') return {id:501};
    if (path === primaryPath + '/issues/2') return {number:2, pull_request:{}};
    if (path === primaryPath + '/pulls' && method === 'POST') {
      assert.equal(body.head, 'work/feature');
      return {number:2, title:body.title, head:{sha:b}, state:'open'};
    }
    if (path === '/graphql' && body.query.includes('mergeStateStatus')) {
      return {data:{repository:{pullRequest:{state:'OPEN', isDraft:false, headRefOid:b, mergeStateStatus:mergeState}}}};
    }
    if (path === primaryPath + '/pulls/2/merge' && method === 'PUT') {
      assert.deepEqual(body, {sha:b, merge_method:'squash'});
      return {merged:true, sha:b};
    }
    assert.fail('Unexpected GitHub request: ' + path);
  });
  await github.connect({expectedVersion:0});
  await save(primary, Object.keys(githubOperations));
  const {tools} = start(office.saveAgent({name:'Developer', runtime:'codex'}));
  const call = (name, args, id) => invoke(tools, 'github_' + name, {repository:primary, ...args}, id);
  const [branch, replay] = await Promise.all([
    call('create_branch', {branch:'work/feature'}, 'duplicate'),
    call('create_branch', {branch:'work/feature'}, 'duplicate'),
  ]);
  assert.equal(branch.sha, a);
  assert.deepEqual(replay, branch);
  assert.equal(requests.filter(item => item.path.endsWith('/git/refs')).length, 1);

  const commit = {branch:'work/feature', expectedHead:a, message:'Update files',
    files:[{path:'src/example.js', content:'export const value = 1;\n'}], deletePaths:['old.txt']};
  assert.match((await call('commit_files', {...commit, branch:'main'})).error, /工作分支/);
  assert.match((await call('commit_files', {...commit, branch:'protected'})).error, /工作分支/);
  assert.match((await call('commit_files', {...commit, expectedHead:b})).error, /分支已更新/);
  assert.equal(requests.filter(item => item.path === '/graphql').length, 0);
  assert.equal((await call('commit_files', commit)).sha, b);
  assert.equal((await call('manage_issue', {action:'create', title:'Issue'})).number, 1);
  assert.equal((await call('manage_issue', {action:'edit', number:1, state:'closed'})).state, 'closed');
  assert.equal((await call('manage_issue', {action:'comment', number:1, body:'Reviewed'})).commentId, 501);
  assert.match((await call('manage_issue', {action:'edit', number:2, state:'closed'})).error, /是 PR/);
  assert.equal((await call('create_pull_request', {head:'work/feature', title:'Change'})).number, 2);
  assert.match((await call('merge_pull_request', {number:2, expectedHead:b, method:'squash'})).error, /未满足合并条件/);
  assert.ok(!requests.some(item => item.method === 'PUT'));
  mergeState = 'CLEAN';
  assert.equal((await call('merge_pull_request', {number:2, expectedHead:b, method:'squash'})).merged, true);
});

test('GitHub credentials stay on the fixed API origin and redirects are refused', async () => {
  const token = 'mock-test-credential-only';
  const seen = [];
  const open = createGhSession({tokenFor:async () => token, fetcher:async (url, options) => {
    seen.push({origin:url.origin, path:url.pathname, redirect:options.redirect});
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    return url.pathname === '/user' ? Response.json({id:7, login:'tester'})
      : new Response(null, {status:302, headers:{Location:'https://outside.example/path'}});
  }});
  const session = await open();
  assert.deepEqual(session.account, {id:'7', login:'tester'});
  await assert.rejects(session.request('https://outside.example/path'), /地址无效/);
  await assert.rejects(session.request('/repos/team/renamed'), /地址已变更/);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(row => row.origin === 'https://api.github.com' && row.redirect === 'manual'));
  assert.ok(!JSON.stringify(session).includes(token));
});
