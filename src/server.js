import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { createOffice } from './office.js';
import { createScheduler } from './scheduler.js';
import { fail } from './input.js';
import { createDiscovery } from './discovery.js';
import { createSettings } from './settings.js';
import { createWorkspace } from './workspace.js';
import { addWorkstations, backfillWorkstations } from './workstations.js';
import { runTrace } from './run-trace.js';
import { createProjectSpace, maxSpaceFileBytes } from './project-space.js';
import { createAccounts, sessionCookie } from './accounts.js';
import { createMailer } from './mailer.js';
import { createMentionEmailDelivery } from './mention-email.js';
import { scanAgents } from '../collector/office-collector.mjs';
import { collectorCommand, collectorPackageSpec } from './collector-command.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(process.env.OFFICE_DATA_DIR ?? join(root, 'data'));
const port = Number(process.env.OFFICE_PORT ?? 4317);
const concurrency = process.env.OFFICE_CONCURRENCY === undefined ? undefined : Number(process.env.OFFICE_CONCURRENCY);
if (!Number.isInteger(port) || port < 1 || port > 65535 ||
    (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16))) {
  throw new Error('OFFICE_PORT 或 OFFICE_CONCURRENCY 无效');
}
const collectorPort = Number(process.env.OFFICE_COLLECTOR_PORT ?? (port === 65535 ? 0 : port + 1));
const collectorHost = process.env.OFFICE_COLLECTOR_HOST || '127.0.0.1';
const certFile = process.env.OFFICE_COLLECTOR_TLS_CERT;
const keyFile = process.env.OFFICE_COLLECTOR_TLS_KEY;
const allowLanHttp = process.env.OFFICE_COLLECTOR_ALLOW_HTTP === '1';
const loopback = ['localhost', '127.0.0.1', '::1'].includes(collectorHost);
if (!Number.isInteger(collectorPort) || collectorPort < 0 || collectorPort > 65535 || collectorPort === port) {
  throw new Error('OFFICE_COLLECTOR_PORT 无效或与工作台端口冲突');
}
if (collectorPort && (Boolean(certFile) !== Boolean(keyFile) || (!loopback && !certFile && !allowLanHttp))) {
  throw new Error('远程监听需要同时配置 TLS 证书和密钥，或显式允许可信局域网 HTTP');
}
const tls = collectorPort && certFile ? {cert: readFileSync(certFile), key: readFileSync(keyFile)} : null;
const collectorProtocol = tls ? 'https' : 'http';
const collectorPackageArchive = process.env.OFFICE_COLLECTOR_PACKAGE_FILE
  ? readFileSync(resolve(process.env.OFFICE_COLLECTOR_PACKAGE_FILE)) : null;
const collectorAddressHost = collectorHost.includes(':') ? '[' + collectorHost + ']' : collectorHost;
const defaultCollectorAddress = process.env.OFFICE_COLLECTOR_PUBLIC_URL ||
  (['0.0.0.0','::'].includes(collectorHost) ? '' :
    `${collectorProtocol}://${collectorAddressHost}:${collectorPort}`);
mkdirSync(data, {recursive: true, mode: 0o700});

const store = openStore(join(data, 'office.sqlite'));
let mailer;
try {
  mailer = createMailer();
} catch (error) {
  console.error('邮件服务配置无效：' + error.message);
}
const accounts = createAccounts(store, mailer?.sendCode);
const mentionEmails = createMentionEmailDelivery(store, mailer?.sendMention, `http://127.0.0.1:${port}`);
const settings = createSettings(store, {concurrencyOverride: concurrency});
const workspace = createWorkspace(store);
const space = createProjectSpace(store, data);
const office = createOffice(store, settings, space);
const discovery = createDiscovery(store);
let closing = false;
let scanPending;
function scanLocal() {
  if (!scanPending) {
    scanPending = scanAgents().then(report => {
      if (!closing) return discovery.receive('local', report);
    }).finally(() => { scanPending = undefined; });
  }
  return scanPending;
}
const scheduler = createScheduler({store, office, space, data, configuration: settings.runtime,
  executable: process.env.OFFICE_CODEX_BIN || 'codex', piExecutable: process.env.OFFICE_PI_BIN || 'pi',
  piProviderExtension: process.env.OFFICE_PI_PROVIDER_EXTENSION});
const clients = new Set();
const mime = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'overview.js': 'text/javascript; charset=utf-8',
  'overview.css': 'text/css; charset=utf-8',
  'office-avatars.js': 'text/javascript; charset=utf-8',
  'office-presence.js': 'text/javascript; charset=utf-8',
  'office-scene.js': 'text/javascript; charset=utf-8',
  'office-model.js': 'text/javascript; charset=utf-8',
  'office-figure.js': 'text/javascript; charset=utf-8',
  'office-scene.css': 'text/css; charset=utf-8',
  'workspace.js': 'text/javascript; charset=utf-8',
  'workspace.css': 'text/css; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
};
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const apogeeCsp = [
  "default-src 'self'", "frame-ancestors 'none'", "base-uri 'none'",
  "style-src 'self' https://db.onlinewebfonts.com", "style-src-attr 'unsafe-inline'",
  'font-src https://db.onlinewebfonts.com', 'media-src https://d8j0ntlcm91z4.cloudfront.net',
].join('; ');
const apogeeMime = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8'};

function json(res, payload, status = 200) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(payload));
}

async function requestBytes(req, limit) {
  if (Number(req.headers['content-length']) > limit) fail('请求内容过大', 413);
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) fail('请求内容过大', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail('需要 JSON 请求', 415);
  const bytes = await requestBytes(req, 128_000);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('JSON 格式无效');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('需要 JSON 对象');
  return value;
}

async function receiveCollector(req, res) {
  try {
    if (collectorPackageArchive && req.method === 'GET' && req.url === '/v1/collector-package.tgz') {
      res.writeHead(200, {'Content-Type':'application/gzip','Content-Length':collectorPackageArchive.length,'Cache-Control':'no-cache'});
      return res.end(collectorPackageArchive);
    }
    if (req.method !== 'POST' || req.url !== '/v1/report') fail('未找到该地址', 404);
    if (req.headers.origin) fail('采集接口仅供客户端使用', 403);
    const machineId = discovery.authenticate(req.headers.authorization);
    return json(res, discovery.receive(machineId, await body(req)));
  } catch (error) {
    if (res.headersSent) return res.destroy();
    if (!error.status) console.error(error);
    return json(res, {error: error.status ? error.message : '采集接收失败'}, error.status ?? 500);
  }
}
const collectorServer = collectorPort
  ? (tls ? createHttpsServer(tls, receiveCollector) : createServer(receiveCollector))
  : null;
if (collectorServer) {
  collectorServer.requestTimeout = 15000;
  collectorServer.headersTimeout = 10000;
  collectorServer.on('error', error => console.error('采集端口启动失败：' + error.message));
}

function eventStream(req, res, url, user) {
  const cursor = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > store.cursor()) fail('事件游标无效');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  clients.add(res);
  const stillAuthorized = () => {
    const current = accounts.current(req.headers.cookie);
    return Boolean(current?.email) && current.role === user.role;
  };
  function write(event) {
    if (res.writableEnded) return false;
    if (!stillAuthorized()) {
      res.end();
      return false;
    }
    const payload = user.role === 'admin' ? event : {seq:event.seq};
    const accepted = res.write(`id: ${event.seq}\ndata: ${JSON.stringify(payload)}\n\n`);
    if (!accepted && res.writableLength > 512_000) {
      res.destroy();
      return false;
    }
    return true;
  }
  let after = cursor;
  while (!res.destroyed && !res.writableEnded) {
    const batch = store.since(after);
    for (const event of batch) {
      if (!write(event)) break;
      after = event.seq;
    }
    if (batch.length < 200) break;
  }
  if (res.destroyed || res.writableEnded) {
    clients.delete(res);
    return;
  }
  const heartbeat = setInterval(() => {
    if (!stillAuthorized()) res.end();
    else if (res.writableLength > 512_000) res.destroy();
    else res.write(': heartbeat\n\n');
  }, 15000);
  store.stream.on('event', write);
  res.on('close', () => {
    clearInterval(heartbeat);
    store.stream.off('event', write);
    clients.delete(res);
  });
}

const saveRoutes = {
  '/api/agents': office.saveAgent,
  '/api/teams': input => office.saveNamed('team', input),
  '/api/skills': input => office.saveNamed('skill', input),
  '/api/projects': input => office.saveNamed('project', input),
  '/api/tasks': office.saveTask,
  '/api/budgets': office.setBudget,
  '/api/conversations': office.startConversation,
  '/api/humans': workspace.saveHuman,
  '/api/schedules': workspace.saveSchedule,
  '/api/layout/workstations': input => addWorkstations(store, input),
  '/api/discovery/scan': scanLocal,
};

function requireUser(req, path, spaceRoute) {
  const user = accounts.current(req.headers.cookie);
  if (!user) fail('请先登录工作台', 401);
  if (!user.email) fail('请先验证并绑定邮箱', 428);
  if (user.role === 'admin') return user;
  const sharedRead = req.method === 'GET' && (spaceRoute ||
    ['/api/state', '/api/events', '/api/inbox'].includes(path) || /^\/api\/tasks\/[a-f0-9-]+$/.test(path));
  const memberWrite = req.method === 'POST' && (path === '/api/inbox/read' || /^\/api\/tasks\/[a-f0-9-]+\/comments$/.test(path));
  if (!sharedRead && !memberWrite) fail('需要管理员权限', 403);
  return user;
}

function workspaceState(user) {
  const records = office.snapshot();
  const workspaceData = workspace.snapshot();
  const configuration = settings.snapshot();
  const base = {...records, ...workspaceData, user, settings:configuration, unread:settings.inbox(false, user).unread};
  if (user.role === 'admin') return {...base, ...discovery.snapshot(),
    collector:{listening:Boolean(collectorServer?.listening), port:collectorPort, protocol:collectorProtocol,
      loopback, defaultAddress:defaultCollectorAddress, packageSpec:collectorPackageSpec,
      tunnelHost:['0.0.0.0','::'].includes(collectorHost) ? '127.0.0.1' : collectorAddressHost}};
  return {...base, agents:records.agents.map(({id, name, teamId}) => ({id, name, teamId})),
    humans:workspaceData.humans.map(({id, name, teamId}) => ({id, name, teamId})),
    runs:records.runs.map(({error, usage, ...run}) => run),
    ledger:[], conversations:[], machines:[], candidates:[],
    settings:{workflow:configuration.workflow, labels:configuration.labels, properties:configuration.properties,
      workspace:{name:configuration.workspace.name, taskPrefix:configuration.workspace.taskPrefix}}};
}

const server = createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host)) fail('无效的本机访问地址', 403);
    const origin = req.headers.origin;
    if (origin && origin !== 'http://' + req.headers.host) fail('仅允许同源请求', 403);
    const url = new URL(req.url, 'http://' + req.headers.host);
    const path = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (path.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site') fail('仅允许同源请求', 403);
    if (path === '/api/auth/session' && req.method === 'GET') {
      return json(res, {user:accounts.current(req.headers.cookie), setup:!accounts.ready(), emailAvailable:accounts.emailAvailable});
    }
    if (path === '/api/auth/registration-code' && req.method === 'POST') {
      return json(res, await accounts.requestRegistrationCode(await body(req)));
    }
    if (req.method === 'POST' && path === '/api/auth/email-code') {
      return json(res, await accounts.requestBindingCode(await body(req), req.headers.cookie));
    }
    if (req.method === 'POST' && path === '/api/auth/bind-email') {
      return json(res, accounts.bindEmail(await body(req), req.headers.cookie));
    }
    if (req.method === 'POST' && path === '/api/auth/mention-email') {
      return json(res, accounts.setMentionEmail(await body(req), req.headers.cookie));
    }
    if (req.method === 'POST' && ['/api/auth/setup', '/api/auth/register', '/api/auth/login',
      '/api/auth/logout', '/api/auth/password'].includes(path)) {
      const input = await body(req);
      const cookie = req.headers.cookie;
      if (path === '/api/auth/logout') {
        accounts.logout(cookie);
        res.setHeader('Set-Cookie', sessionCookie());
        return json(res, {ok:true});
      }
      const result = path === '/api/auth/login' ? await accounts.login(input, cookie)
        : path === '/api/auth/password' ? await accounts.changePassword(input, cookie)
          : await accounts.register(input, {setup:path === '/api/auth/setup'});
      if (result.token) res.setHeader('Set-Cookie', sessionCookie(result.token));
      return json(res, {user:result.user}, ['/api/auth/setup', '/api/auth/register'].includes(path) ? 201 : 200);
    }
    const spaceRoute = path.match(/^\/api\/projects\/([a-f0-9-]+)\/space(?:\/(file))?$/);
    const user = path.startsWith('/api/') ? requireUser(req, path, spaceRoute) : null;
    if (spaceRoute) {
      const [, projectId, resource] = spaceRoute;
      const query = url.searchParams;
      if (req.method === 'GET' && !resource) return json(res, space.view(projectId));
      if (req.method === 'GET' && resource === 'file') {
        const preview = query.get('preview') === '1';
        const file = await space.read(projectId, {versionId:query.get('version'), deliveryId:query.get('delivery'),
          path:query.get('path'), preview});
        if (preview) return json(res, file);
        const filename = encodeURIComponent(file.path.split('/').at(-1)).replace(/['()*!]/g,
          char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
        res.writeHead(200, {'Content-Type':'application/octet-stream',
          'Content-Disposition':"attachment; filename*=UTF-8''" + filename, 'Cache-Control':'no-store'});
        return res.end(file.bytes);
      }
      if (req.method === 'PUT' && resource === 'file') {
        if (req.headers['content-type'] !== 'application/octet-stream') fail('需要文件内容', 415);
        const bytes = await requestBytes(req, maxSpaceFileBytes);
        requireUser(req, path, spaceRoute);
        return json(res, await space.upload(projectId, query.get('path'), query.get('base'), bytes), 201);
      }
    }
    if (req.method === 'GET') {
      const threeFile = path.match(/^\/office-vendor\/(three\.(?:module|core)\.min\.js)$/);
      if (threeFile) {
        const source = readFileSync(join(root, 'node_modules', 'three', 'build', threeFile[1]));
        res.writeHead(200, {'Content-Type':mime['app.js'], 'Cache-Control':'no-cache'});
        return res.end(source);
      }
      if (path === '/api/state') return json(res, workspaceState(user));
      if (path === '/api/users') return json(res, accounts.list());
      if (path === '/api/inbox') return json(res, settings.inbox(true, user));
      if (path === '/api/overview') return json(res, store.overview());
      if (path === '/api/settings/audit') return json(res, store.audit());
      const detailRoute = path.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
      if (detailRoute) return json(res, office.taskDetail(detailRoute[1]));
      if (path === '/downloads/office-collector.mjs') {
        res.writeHead(200, {'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="office-collector.mjs"'});
        return res.end(readFileSync(join(root, 'collector', 'office-collector.mjs')));
      }
      const officeAsset = path.match(/^\/office-assets\/([a-z0-9-]+\.svg)$/);
      if (officeAsset) {
        let svg;
        try {
          svg = readFileSync(join(root, 'public', 'office-assets', officeAsset[1]));
        } catch (error) {
          if (error.code === 'ENOENT') fail('素材不存在', 404);
          throw error;
        }
        res.writeHead(200, {'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400'});
        return res.end(svg);
      }
      if (path === '/api/events') return eventStream(req, res, url, user);
      const runRoute = path.match(/^\/api\/runs\/([a-f0-9-]+)$/);
      if (runRoute) {
        const record = office.requireRecord('run', runRoute[1], '执行');
        const {instructions: _instructions, ...run} = record;
        return json(res, {run, events: store.timeline(run.id), trace: runTrace(record, store.runObservations(run.id))});
      }
      const apogeeAsset = path.match(/^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/);
      if (path === '/' || apogeeAsset) {
        try {
          const file = readFileSync(join(root, 'apogee', 'dist', apogeeAsset ? path.slice(1) : 'index.html'));
          if (!apogeeAsset) res.setHeader('Content-Security-Policy', apogeeCsp);
          res.writeHead(200, {
            'Content-Type': apogeeAsset ? apogeeMime[apogeeAsset[1]] : mime['index.html'],
            'Cache-Control': apogeeAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
          });
          return res.end(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          if (apogeeAsset) fail('素材不存在', 404);
        }
      }
      const officePage = ['/', '/office', '/office/'].includes(path);
      const filename = officePage ? 'index.html' : basename(path);
      if (Object.hasOwn(mime, filename) && (officePage || path === '/' + filename)) {
        res.writeHead(200, {'Content-Type': mime[filename], 'Cache-Control': 'no-cache'});
        return res.end(readFileSync(join(root, 'public', filename)));
      }
    }
    if (req.method === 'POST') {
      const input = await body(req);
      const actor = path.startsWith('/api/') ? requireUser(req, path, spaceRoute) : null;
      const accountRoute = path.match(/^\/api\/users\/([a-f0-9-]+)$/);
      if (accountRoute) return json(res, accounts.update(accountRoute[1], input, actor));
      if (Object.hasOwn(saveRoutes, path)) return json(res, await saveRoutes[path](input));
      if (path === '/api/layout/draft' || path === '/api/layout/publish') {
        return json(res, workspace.saveLayout(input, path.endsWith('/publish')));
      }
      const dispatchRoute = path.match(/^\/api\/agents\/([a-f0-9-]+)\/dispatch$/);
      if (dispatchRoute) return json(res, office.setAgentPaused(dispatchRoute[1], input.paused));
      if (path === '/api/inbox/read') return json(res, settings.markInboxRead(input.through, actor));
      const settingRoute = path.match(/^\/api\/settings\/(workspace|workflow|runtime|notifications)$/);
      if (settingRoute) return json(res, settings.save(settingRoute[1], input));
      const catalogueRoute = path.match(/^\/api\/settings\/(label|property)(?:\/([a-f0-9-]+)\/archive)?$/);
      if (catalogueRoute) {
        const [, kind, id] = catalogueRoute;
        return json(res, id ? settings.archive(kind, id, input.archived) : settings.saveCatalogue(kind, input));
      }
      if (path === '/api/machines') {
        if (!collectorServer?.listening) fail('采集接收端未启动', 409);
        const command = input.address === undefined ? null : collectorCommand(input,allowLanHttp,Boolean(collectorPackageArchive));
        const pairing = discovery.issueMachine(input);
        if (!command) return json(res,pairing,201);
        return json(res,{machine:pairing.machine, command:command.launch(pairing.token),
          restart:command.restart, loopback:command.loopback},201);
      }
      const machineRoute = path.match(/^\/api\/machines\/([a-f0-9-]+)\/revoke$/);
      if (machineRoute) return json(res, discovery.revoke(machineRoute[1]));
      const candidateRoute = path.match(/^\/api\/candidates\/([a-f0-9-]+)\/(review|approve|dismiss)$/);
      if (candidateRoute) {
        const [, id, action] = candidateRoute;
        if (action === 'review') return json(res, office.stageCandidate(id, input));
        if (action === 'approve') return json(res, office.approveCandidate(id, input.reviewVersion));
        return json(res, office.dismissCandidate(id));
      }
      const taskRoute = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/(run|status|priority|comments)$/);
      if (taskRoute) {
        const [, id, action] = taskRoute;
        if (action === 'run') return json(res, office.enqueueTask(id, input.reserve));
        if (action === 'comments') return json(res, office.commentTask(id, input, undefined, actor), 201);
        if (action === 'priority') return json(res, office.taskPriority(id, input.priority));
        const task = office.taskStatus(id, input.status, input.reviewedHeads, input.deliveryId);
        if (task.conflicts) return json(res, {error:'共享文件版本已变化，交付保留在待发布区', conflicts:task.conflicts}, 409);
        return json(res, task);
      }
      const stopRoute = path.match(/^\/api\/runs\/([a-f0-9-]+)\/stop$/);
      if (stopRoute) return json(res, office.stop(stopRoute[1]));
      const conversationRoute = path.match(/^\/api\/conversations\/([a-f0-9-]+)\/(add|close|resume)$/);
      if (conversationRoute) return json(res, office.updateConversation(conversationRoute[1], conversationRoute[2], input));
    }
    fail('未找到该地址', 404);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    if (!error.status) console.error(error);
    return json(res, {error: error.status ? error.message : '本机服务出错'}, error.status ?? 500);
  }
});

let scanTimer;
let sweepTimer;
let taskScheduleTimer;
let accountSweepTimer;
let mentionEmailTimer;
function dispatchScheduledTasks() {
  try {
    office.dispatchScheduled();
  } catch (error) {
    console.error('定时任务派发失败', error);
  }
}
function configureScan(initial = false) {
  clearInterval(scanTimer);
  const {autoScan, scanSeconds} = settings.runtime();
  if (!autoScan) return;
  const scan = () => scanLocal().catch(error => console.error('本机采集失败：' + error.message));
  if (initial) scan();
  scanTimer = setInterval(scan, scanSeconds * 1000);
}
store.stream.on('event', event => {
  if (event.type === 'settings.updated' && event.payload.section === 'runtime') configureScan();
  if (event.type === 'task.mention') mentionEmails.wake();
});
server.listen(port, '127.0.0.1', () => {
  office.seed();
  backfillWorkstations(store);
  settings.backfillTaskNumbers();
  scheduler.recover();
  dispatchScheduledTasks();
  taskScheduleTimer = setInterval(dispatchScheduledTasks, 2000);
  configureScan(true);
  sweepTimer = setInterval(discovery.sweep, 5000);
  accounts.sweep();
  accountSweepTimer = setInterval(accounts.sweep, 60_000);
  if (mailer) {
    mentionEmails.wake();
    mentionEmailTimer = setInterval(mentionEmails.wake, 15_000);
  }
  collectorServer?.listen(collectorPort, collectorHost, () =>
    console.log(`Agent 采集监听 ${collectorHost}:${collectorPort}（${tls ? 'HTTPS' : 'HTTP'}）`));
  console.log(`Agent 公司运行于 http://127.0.0.1:${port}`);
});

async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(scanTimer);
  clearInterval(sweepTimer);
  clearInterval(taskScheduleTimer);
  clearInterval(accountSweepTimer);
  clearInterval(mentionEmailTimer);
  for (const client of clients) client.end();
  const serverClosed = new Promise(resolve => server.close(resolve));
  const collectorClosed = collectorServer?.listening && new Promise(resolve => collectorServer.close(resolve));
  await Promise.all([serverClosed, collectorClosed, scanPending, scheduler.close(), mentionEmails.close()]);
  store.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
