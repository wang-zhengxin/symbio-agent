import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../src/store.js';
import { createDiscovery } from '../src/discovery.js';
import { createCollectorApi } from '../src/collector-api.js';
import { collectorCommand } from '../src/collector-command.js';
import { endpoint, parseArgs } from '../collector/office-collector.mjs';

const exec = promisify(execFile);
function setup(t) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.tx(() => {
    store.put('project', {id: 'p1', name: '项目一'});
    store.put('project', {id: 'p2', name: '项目二'});
    store.put('task', {id: 't1', number: 1, projectId: 'p1', title: '调研', status: 'todo', description: '调研知识图谱', privatePrompt: 'secret'});
    store.put('task', {id: 't2', number: 2, projectId: 'p2', title: '私有项目', status: 'done'});
    store.put('task', {id: 't3', number: 3, projectId: 'p1', parentId: 't1', title: '子任务', status: 'todo'});
  });
  return {store, discovery: createDiscovery(store)};
}

test('Pairing codes are single-use, expire, hide hashes and keep project permissions after exchange', t => {
  const {store, discovery} = setup(t);
  const pairing = discovery.issuePairing({name: '测试电脑', taskAccess: 'project:p1'});
  assert.match(pairing.code, /^[A-F0-9]{4}(-[A-F0-9]{4}){3}$/);
  assert.equal(pairing.machine.pairingHash, undefined);
  assert.equal(pairing.token, undefined);
  assert.ok(!JSON.stringify(store.list('machine')).includes(pairing.code));
  const login = discovery.exchangeCode({code: pairing.code.toLowerCase()});
  const id = discovery.authenticate('Bearer ' + login.token);
  assert.throws(() => discovery.exchangeCode({code: pairing.code}), {status: 401});
  const tasks = discovery.readTasks(id);
  assert.deepEqual(tasks.tasks.map(task => task.id), ['t1']);
  assert.equal(tasks.tasks[0].number, 'AG-1');
  assert.doesNotMatch(JSON.stringify(tasks), /privatePrompt|secret/);
  assert.equal(discovery.readTasks(id, {ref: 'AG-1'}).subtasks[0].id, 't3');
  assert.equal(discovery.readTasks(id, {ref: '1'}).task.id, 't1');
  assert.throws(() => discovery.readTasks(id, {ref: 'AG-2'}), {status: 404});
  assert.throws(() => discovery.readTasks(id, {limit: 201}), {status: 400});
  assert.throws(() => discovery.readTasks(id, {status: 'bogus'}), {status: 400});
  const legacy = discovery.issueMachine({name: '旧版'});
  assert.throws(() => discovery.readTasks(legacy.machine.id), {status: 403});
  const expired = discovery.issuePairing({name: '过期'});
  store.tx(() => store.put('machine', {...store.get('machine', expired.machine.id), pairingExpiresAt: new Date(0).toISOString()}));
  assert.throws(() => discovery.exchangeCode({code: expired.code}), {status: 401});
  const revoked = discovery.issuePairing({name: '撤销'});
  discovery.revoke(revoked.machine.id);
  assert.throws(() => discovery.exchangeCode({code: revoked.code}), {status: 401});
  discovery.revoke(id);
  assert.throws(() => discovery.authenticate('Bearer ' + login.token), {status: 401});
  assert.throws(() => discovery.readTasks(id), {status: 401});
});

test('Collector API rate limits pairing and rejects browser origins and unauthenticated queries', async t => {
  const {discovery} = setup(t);
  const api = createCollectorApi(discovery, async () => ({code: '0000-0000-0000-0000'}));
  const request = {method: 'POST', url: '/v1/pair', headers: {}, socket: {remoteAddress: 'test'}};
  for (let i = 0; i < 10; i++) await assert.rejects(api(request), {status: 401});
  await assert.rejects(api(request), {status: 429});
  await assert.rejects(api({...request, headers: {origin: 'https://other.example'}}), {status: 403});
  await assert.rejects(api({...request, method: 'GET', url: '/v1/tasks'}), {status: 401});
});

test('CLI end-to-end: login, safe config, tasks, report, revoke, logout and change server', async t => {
  const {discovery} = setup(t);
  const dir = await mkdtemp(join(tmpdir(), 'symbio-cli-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const configPath = join(dir, 'config.json');
  const api = createCollectorApi(discovery, async req => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  });
  const server = createServer(async (req, res) => {
    try { const result = await api(req); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); }
    catch (error) { res.writeHead(error.status || 500); res.end(JSON.stringify({error: error.message})); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const address = 'http://127.0.0.1:' + server.address().port;
  const cli = (...args) => exec(process.execPath, [resolve('collector/office-collector.mjs'), ...args],
    {env: {...process.env, OFFICE_COLLECTOR_CONFIG: configPath}, timeout: 20000});
  const pairing = discovery.issuePairing({name: '远程测试', taskAccess: 'project:p1'});
  await cli('login', address, '--code', pairing.code);
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  assert.ok(saved.token);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  assert.equal(discovery.snapshot().machines[0].status, 'online');
  assert.equal(JSON.parse((await cli('status', '--json')).stdout).machine.name, '远程测试');
  assert.ok(Array.isArray(JSON.parse((await cli('agents', 'list', '--json')).stdout)));
  assert.equal(JSON.parse((await cli('tasks', 'list', '--json')).stdout).total, 1);
  assert.equal(JSON.parse((await cli('tasks', 'show', 'AG-1', '--json')).stdout).subtasks.length, 1);
  await assert.rejects(cli('tasks', 'show', 'AG-2'), /任务不存在或无权访问/);
  await assert.rejects(cli('login', address, '--code', pairing.code), /已有登录/);
  const display = (await cli('config', 'show')).stdout;
  assert.ok(!display.includes(saved.token));
  await cli('config', 'set', 'interval', '60');
  await cli('run', '--once');
  assert.equal(discovery.snapshot().machines[0].heartbeatSeconds, 60);
  await assert.rejects(cli('config', 'set', 'interval', '0'), /5–3600/);
  await assert.rejects(cli('config', 'get', 'token'), /可用配置键/);
  discovery.revoke(pairing.machine.id);
  await assert.rejects(cli('tasks', 'list'), /配对凭据无效/);
  await cli('logout');
  await assert.rejects(cli('status'), /尚未登录/);
  const second = discovery.issuePairing({name: '第二次登录', taskAccess: 'all'});
  await cli('login', '--code', second.code);
  assert.equal(JSON.parse((await cli('tasks', 'list', '--status', 'done', '--json')).stdout).total, 1);
  await cli('config', 'set', 'server', 'https://example.invalid');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).token, undefined);
  await assert.rejects(cli('status'), /尚未登录/);
  await assert.rejects(cli('tasks', 'list', '--typo'), /未知参数/);
  const legacy = discovery.issueMachine({name: '旧命令兼容'});
  await exec(process.execPath, [resolve('collector/office-collector.mjs'), 'join', address, '--once'],
    {env: {...process.env, OFFICE_COLLECTOR_CONFIG: configPath, OFFICE_COLLECTOR_TOKEN: legacy.token}, timeout: 20000});
  assert.equal(JSON.parse((await cli('status', '--json')).stdout).machine.id, legacy.machine.id);
  await assert.rejects(cli('tasks', 'list'), /未获任务读取权限/);
});

test('Offline detection respects a configured long heartbeat without keeping stale machines online forever', t => {
  const {discovery, store} = setup(t);
  const {machine} = discovery.issueMachine({name: '慢心跳'});
  discovery.receive(machine.id, {hostname: 'slow', platform: 'linux', processScan: 'ok', installed: [], processes: [], heartbeatSeconds: 60});
  store.tx(() => store.put('machine', {...store.get('machine', machine.id), seenAt: new Date(Date.now() - 60_000).toISOString()}));
  discovery.sweep();
  assert.equal(store.get('machine', machine.id).status, 'online');
  store.tx(() => store.put('machine', {...store.get('machine', machine.id), seenAt: new Date(Date.now() - 200_000).toISOString()}));
  discovery.sweep();
  assert.equal(store.get('machine', machine.id).status, 'offline');
});

test('Generated npm login commands avoid embedding codes, support shells and preserve legacy join', () => {
  const sh = collectorCommand({address: 'https://office.example', shell: 'sh'}, false, false);
  assert.match(sh.install, /^npm install --global .*symbio-agent-collector@0\.2\.0$/);
  assert.match(sh.login, /^symbio login /);
  assert.equal(sh.restart, 'symbio run');
  assert.match(sh.login, /login 'https:\/\/office.example' --run$/);
  assert.doesNotMatch(sh.login, /--code|token/);
  assert.match(sh.launch('legacy-secret'), /printf.*legacy-secret.* -- symbio join/);
  const ps = collectorCommand({address: 'http://127.0.0.1:4318', shell: 'powershell'}, false, true);
  assert.match(ps.install, /^npm.cmd install --global /);
  assert.match(ps.install, /collector-package.tgz/);
  assert.match(ps.login, /^symbio\.cmd login /);
  assert.equal(ps.restart, 'symbio.cmd run');
  assert.match(ps.legacyRestart, /^npx.cmd /);
  const lan = collectorCommand({address:'http://192.168.1.10:4318',shell:'sh'},true,true);
  assert.match(lan.login,/--allow-http --run$/);
  const quoted = collectorCommand({address:"https://office.example/a'b",shell:'sh'},false,true);
  assert.ok(quoted.login.includes("'\"'\"'"));
  const quotedPs = collectorCommand({address:"https://office.example/a'b",shell:'powershell'},false,true);
  assert.ok(quotedPs.install.includes("a''b"));
  for(const path of ['/office','/v1/report','/v1/pair/']) assert.throws(()=>collectorCommand({address:'https://office.example'+path},false,true),/基础地址/);
  assert.throws(() => endpoint('http://remote.example', false), /HTTPS/);
  assert.throws(() => endpoint('https://u:password@example.org', false), /凭据/);
  assert.equal(endpoint('https://office.example/collector', false, '/v1/tasks').pathname, '/collector/v1/tasks');
  assert.throws(() => parseArgs(['tasks', '--limit']), /缺少值/);
});
