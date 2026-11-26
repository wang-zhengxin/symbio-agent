#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants, existsSync, realpathSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

export const providers = Object.freeze({
  codex: ['codex', 'codex-cli', 'codex-desktop'],
  pi: ['pi'],
  claude: ['claude', 'claude-code'],
  gemini: ['gemini', 'gemini-cli'],
  opencode: ['opencode'],
  aider: ['aider'],
  cursor: ['cursor-agent'],
  copilot: ['copilot'],
  qwen: ['qwen', 'qwen-code'],
  kiro: ['kiro-cli'],
  openclaw: ['openclaw', 'openclaw-gateway'],
  workbuddy: ['workbuddy'],
  antigravity: ['antigravity', 'agy'],
});
const aliases = new Map(Object.entries(providers).flatMap(([provider, names]) =>
  names.map(name => [name, provider])));
const exec = promisify(execFile);
const options = {timeout: 8000, maxBuffer: 16 * 1024 * 1024, windowsHide: true};
const displayText = (value, limit) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, limit) : '';

function executableName(path) {
  return path.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.(?:exe|cmd|bat|mjs|cjs|js|py)$/, '');
}

function identify(command, name) {
  // comm is an executable path, not an argument string. This also handles app
  // bundles on external disks whose paths contain spaces, and AppPorts launchers.
  const bundle = name?.match(/\/(WorkBuddy|Antigravity)\.app\/Contents\/MacOS\/(WorkBuddy|Antigravity|launcher)$/i);
  if (bundle && (bundle[2].toLowerCase() === bundle[1].toLowerCase() || bundle[2] === 'launcher')) return bundle[1].toLowerCase();
  const tokens = command?.match(/"[^"]*"|'[^']*'|\S+/g)?.slice(0, 4)
    .map(token => token.replace(/^["']|["']$/g, '')) ?? [];
  const first = executableName(tokens[0] ?? name ?? '');
  // Prefer the OS executable name: tokenizing an unquoted "Antigravity Helper"
  // path would otherwise truncate it to "Antigravity" and create a false agent.
  const direct = name ? aliases.get(executableName(name)) : aliases.get(first);
  if (direct && ['workbuddy', 'antigravity'].includes(direct) &&
      (/\.app\/Contents\/Frameworks\//i.test(name ?? tokens[0] ?? '') || /\s--type(?:=|\s)\S+/.test(command ?? ''))) return undefined;
  if (direct) return direct;
  if (/^(?:node|nodejs|bun|python[\d.]*)$/.test(first)) {
    const entry = tokens[1] === '-m' ? tokens[2] : tokens[1];
    const script = executableName(entry ?? '');
    return aliases.get(script) ??
      (/[/\\](?:@earendil-works|@mariozechner)[/\\]pi-coding-agent[/\\]/.test(entry ?? '') ? 'pi' : undefined) ??
      (/[/\\]@google[/\\]gemini-cli[/\\]/.test(entry ?? '') ? 'gemini' : undefined);
  }
  return undefined;
}

export function discoverProcesses(processes, excludedPid) {
  const indexed = new Map(processes.map(row => [row.pid, {...row, provider: identify(row.command, row.name)}]));
  const results = [];
  for (const row of indexed.values()) {
    if (!row.provider || !row.started || !Number.isInteger(row.pid) || row.pid <= 0) continue;
    if (indexed.get(row.ppid)?.provider === row.provider) continue;
    let ancestor = row;
    let excluded = false;
    const visited = new Set();
    while (ancestor && !visited.has(ancestor.pid)) {
      if (ancestor.pid === excludedPid) {
        excluded = true;
        break;
      }
      visited.add(ancestor.pid);
      ancestor = indexed.get(ancestor.ppid);
    }
    if (excluded) continue;
    const identity = createHash('sha256').update(String(row.started)).digest('hex').slice(0, 16);
    const executable = row.name || row.command?.match(/^\s*("[^"]*"|'[^']*'|\S+)/)?.[1]?.replace(/^["']|["']$/g, '');
    const processName = displayText(executable?.split(/[\\/]/).at(-1), 80);
    results.push({provider: row.provider, pid: row.pid, instance: `${row.pid}-${identity}`, ...(processName ? {processName} : {})});
  }
  return results.sort((a, b) => a.pid - b.pid).slice(0, 150);
}

// Window titles describe UI windows, not agent conversations. Limit collection
// to discovered PIDs and use existing OS access without prompting for permission.
export async function processWindowTitles(processes, {platform = process.platform, execute = exec} = {}) {
  if (!['darwin', 'win32'].includes(platform)) return {windows:[], status:'unsupported'};
  const pids = [...new Set(processes.map(row => row.pid).filter(pid => Number.isInteger(pid) && pid > 0))];
  if (!pids.length) return {windows:[], status:'not-requested'};
  try {
    let output;
    if (platform === 'darwin') {
      const script = `ObjC.import('Cocoa'); ObjC.import('CoreGraphics');
        ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]);
        ObjC.bindFunction('CGWindowListCopyWindowInfo', ['id', ['unsigned int', 'unsigned int']]);
        function run() {
          if (!$.CGPreflightScreenCaptureAccess()) return JSON.stringify({status:'permission-required', windows:[]});
          var pids = ${JSON.stringify(pids)};
          var windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(16, 0)) || [];
          return JSON.stringify(windows.filter(function(row) {
            return pids.indexOf(row.kCGWindowOwnerPID) !== -1 && row.kCGWindowLayer === 0 && row.kCGWindowName;
          }).map(function(row) { return {pid: row.kCGWindowOwnerPID, title: row.kCGWindowName}; }));
        }`;
      output = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {...options, timeout:3000});
    } else {
      output = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object @{n='pid';e={$_.Id}},@{n='title';e={$_.MainWindowTitle}} | ConvertTo-Json -Compress`], {...options, timeout:3000});
    }
    const parsed = JSON.parse(output.stdout.replace(/^\uFEFF/, '').trim() || '[]');
    if (parsed?.status === 'permission-required') return {windows:[], status:'permission-required'};
    return {status:'available', windows:[parsed].flat().filter(row => row && pids.includes(row.pid) && typeof row.title === 'string')};
  } catch { return {windows:[], status:'unavailable'}; }
}

export function withProcessWindowTitles(processes, windows) {
  return processes.map(row => ({...row, windowTitles:[...new Set(windows.filter(window => window.pid === row.pid)
    .map(window => displayText(window.title, 160)).filter(Boolean))].slice(0, 8)}));
}

async function readProcesses() {
  if (process.platform === 'win32') {
    const {stdout} = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n='Started';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress"], options);
    return [JSON.parse(stdout.replace(/^\uFEFF/, ''))].flat().map(row => ({
      pid: row.ProcessId, ppid: row.ParentProcessId, name: row.Name, command: row.CommandLine, started: row.Started,
    }));
  }
  const psOptions = {...options, env: {...process.env, LC_ALL: 'C'}};
  const [{stdout}, {stdout: names}] = await Promise.all([
    exec('/bin/ps', ['-ww', '-u', String(process.getuid()), '-o', 'pid=,ppid=,lstart=,command='], psOptions),
    exec('/bin/ps', ['-ww', '-u', String(process.getuid()), '-o', 'pid=,comm='], psOptions),
  ]);
  const executablePaths = new Map(names.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match ? [[Number(match[1]), match[2]]] : [];
  }));
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/);
    return match ? [{pid: Number(match[1]), ppid: Number(match[2]), started: match[3], command: match[4], name: executablePaths.get(Number(match[1]))}] : [];
  });
}

export function desktopExecutables(platform = process.platform, home = homedir(), env = process.env) {
  const result = {workbuddy: [], antigravity: []};
  for (const [provider, app] of [['workbuddy', 'WorkBuddy'], ['antigravity', 'Antigravity']]) {
    if (platform === 'darwin') result[provider] = ['/Applications', join(home, 'Applications')].flatMap(root =>
      [app, 'launcher'].map(binary => join(root, app + '.app', 'Contents', 'MacOS', binary)));
    if (platform === 'win32') result[provider] = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles]
      .filter(Boolean).map(root => join(root, app, app + '.exe'));
  }
  return result;
}

// Discovery and managed execution must locate the same CLI, including desktop-bundled binaries.
export async function resolveProviderExecutable(provider, {env = process.env, platform = process.platform, home = homedir()} = {}) {
  const windows = platform === 'win32';
  const extra = windows ? [] : [join(home, '.local', 'bin'), join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin'];
  const paths = [...new Set([...(env.PATH ?? '').split(delimiter), ...extra].filter(Boolean))];
  const suffixes = windows ? ['', '.exe', '.cmd', '.bat'] : [''];
  const override = {codex: env.OFFICE_CODEX_BIN, pi: env.OFFICE_PI_BIN,
    workbuddy: env.OFFICE_WORKBUDDY_BIN, antigravity: env.OFFICE_ANTIGRAVITY_BIN}[provider];
  const bundled = provider === 'codex' && platform === 'darwin'
    ? [join(home, 'Applications'), '/Applications'].flatMap(root => [
      join(root, 'ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
      join(root, 'Codex.app/Contents/Resources/codex'),
    ]) : [];
  // An explicit override is authoritative; do not silently run another installation.
  const names = override ? [override] : ['codex','pi'].includes(provider)
    ? [provider, ...bundled] : [...(providers[provider] ?? []), ...(desktopExecutables()[provider] ?? [])];
    for (const name of names) {
      for (const suffix of suffixes) {
        const candidates = /[/\\]/.test(name) ? [name + suffix] : paths.map(path => join(path, name + suffix));
        const matches = await Promise.all(candidates.map(async path => {
          try {
            await access(path, windows ? constants.F_OK : constants.X_OK);
            return (await stat(path)).isFile();
          } catch { return false; }
        }));
        const index = matches.findIndex(Boolean);
        if (index !== -1) return candidates[index];
      }
    }
  return null;
}

export async function installedProviders(options) {
  const detected = await Promise.all(Object.keys(providers).map(async provider =>
    await resolveProviderExecutable(provider, options) ? provider : null));
  return detected.filter(Boolean).sort();
}

export async function scanAgents({excludeSelf = true} = {}) {
  const [installed, scan] = await Promise.all([installedProviders(), readProcesses()
    .then(async rows => {
      const processes = discoverProcesses(rows, excludeSelf ? process.pid : undefined);
      const titles = await processWindowTitles(processes);
      return {processes:withProcessWindowTitles(processes, titles.windows), processScan:'ok', windowTitleStatus:titles.status};
    })
    .catch(() => ({processes: [], processScan: 'unavailable'}))]);
  return {hostname: hostname(), platform: process.platform, installed, ...scan};
}

const configPath = process.env.OFFICE_COLLECTOR_CONFIG || join(homedir(), '.agent-office', 'collector.json');
const defaults = {interval: 10, allowHttp: false};

export function endpoint(address, allowHttp, path = '/v1/report') {
  const url = new URL(address);
  if (url.username || url.password || url.search || url.hash) throw new Error('接收地址不能包含凭据、查询参数或锚点');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowHttp))) {
    throw new Error('远程接收地址需要 HTTPS。可信局域网可显式使用 --allow-http');
  }
  url.pathname = url.pathname.replace(/\/$/, '') + path;
  return url;
}

async function request(config, path, payload, authenticated = true, query) {
  if (authenticated && !config.token) throw new Error('尚未登录，请先执行 login <接收地址>');
  const url = endpoint(config.server, config.allowHttp, path);
  if (query) for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {...(payload === undefined ? {} : {'Content-Type': 'application/json'}),
      ...(authenticated ? {Authorization: 'Bearer ' + config.token} : {})},
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `接收端返回 HTTP ${response.status}`),
    {permanent: response.status === 401 || response.status === 403});
  return result;
}

async function sendReport(config) {
  return request(config, '/v1/report', {...await scanAgents(), heartbeatSeconds: config.interval ?? 10});
}

async function readConfig() {
  try { return {...defaults, ...JSON.parse(await readFile(configPath, 'utf8'))}; }
  catch (error) { if (error.code === 'ENOENT') return {...defaults}; throw error; }
}

async function writeConfig(config) {
  const temporary = configPath + '.' + process.pid + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    await rename(temporary, configPath);
  } finally { await rm(temporary, {force: true}); }
}

async function changeConfig(action) {
  await mkdir(dirname(configPath), {recursive: true, mode: 0o700});
  const lock = configPath + '.lock';
  try { await writeFile(lock, String(process.pid), {mode: 0o600, flag: 'wx'}); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`配置正在被其他命令修改。如上次命令异常退出，确认其已停止后删除 ${lock}`);
    throw error;
  }
  try { return await action(await readConfig()); }
  finally { await rm(lock, {force: true}); }
}

function safeConfig(config) {
  const {token, ...visible} = config;
  return {...visible, authenticated: Boolean(token)};
}

async function readSecret(prompt, env) {
  if (env) return env.trim();
  const reader = createInterface({input: process.stdin, output: process.stdout, terminal: false});
  try {
    if (process.stdin.isTTY) return (await reader.question(prompt)).trim();
    for await (const line of reader) return line.trim();
    throw new Error('没有收到配对码，请交互输入或使用 --code');
  } finally { reader.close(); }
}

export function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`重复参数：${arg}`);
    if (['json', 'once', 'run', 'allow-http', 'help'].includes(key)) options[key] = true;
    else if (['code', 'status', 'project', 'limit', 'offset'].includes(key)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} 缺少值`);
      options[key] = args[++i];
    } else throw new Error(`未知参数：${arg}`);
  }
  return {positional, options};
}

const help = `Symbio CLI 0.2.0
用法：symbio <命令>
别名：symbio-cli；旧命令 symbio-agent-collector 仍可使用，配置与登录共用。
  login [接收地址] [--code 配对码] [--allow-http] [--run]
  logout                         清除本地登录，保留配置（后台撤销可令凭据失效）
  status | whoami [--json]        查询机器连接、授权和采集状态
  config show | path | get <键> | set <键> <值>
    可修改：server、interval（5–3600 秒）、allowHttp（true/false）
    修改 server 会清除登录；配置中不显示凭据
  scan                           扫描本机 Agent
  run [--once]                   持续采集或只上报一次
  tasks list [--status 状态] [--project 项目ID] [--limit 数量] [--offset 偏移量] [--json]
  tasks show <任务编号或ID> [--json]   查看任务及子任务
  agents list [--json]            按运行器查看本机发现项、实例数与接入状态
  join | install <接收地址>       兼容旧版配对密钥
配置文件：~/.agent-office/collector.json，可用 OFFICE_COLLECTOR_CONFIG 指定路径。
任务读取范围由后台配对时授权；客户端不会自动入职或执行远程任务。`;

async function main(args) {
  const {positional: [command, ...rest], options} = parseArgs(args);
  if (!command || command === 'help' || options.help) { console.log(help); return; }
  const allowed = {login: ['code', 'allow-http', 'run'], join: ['allow-http', 'once'], install: ['allow-http'],
    run: ['once'], scan: [], config: [], logout: [], status: ['json'], whoami: ['json'],
    tasks: rest[0] === 'show' ? ['json'] : ['json', 'status', 'project', 'limit', 'offset'], agents: ['json']};
  if (!allowed[command]) throw new Error('未知命令。运行 help 查看帮助。');
  for (const key of Object.keys(options)) if (!allowed[command].includes(key)) throw new Error(`${command} 不支持 --${key}`);
  const maxArgs = {login: 1, join: 1, install: 1, run: 0, scan: 0, config: 3, logout: 0, status: 0, whoami: 0, tasks: 2, agents: 1};
  if (rest.length > maxArgs[command]) throw new Error('多余参数。运行 help 查看用法。');
  if (command === 'scan') { console.log(JSON.stringify(await scanAgents(), null, 2)); return; }
  if (command === 'config') {
    const [action = 'show', key, value] = rest;
    if (action === 'path' && !key) { console.log(configPath); return; }
    if (action === 'show' && !key) { console.log(JSON.stringify(safeConfig(await readConfig()), null, 2)); return; }
    if (!['server', 'interval', 'allowHttp'].includes(key)) throw new Error('可用配置键：server、interval、allowHttp');
    if (action === 'get' && value === undefined) { console.log((await readConfig())[key] ?? ''); return; }
    if (action !== 'set' || value === undefined) throw new Error('用法：config set <键> <值>');
    await changeConfig(async config => {
      if (key === 'interval') {
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) throw new Error('interval 必须为 5–3600 秒的整数');
        config.interval = seconds;
      } else if (key === 'allowHttp') {
        if (!['true', 'false'].includes(value)) throw new Error('allowHttp 必须为 true 或 false');
        config.allowHttp = value === 'true';
        if (config.server) endpoint(config.server, config.allowHttp);
      } else {
        endpoint(value, config.allowHttp);
        const server = new URL(value).href.replace(/\/$/, '');
        if (config.server !== server) { delete config.token; delete config.machine; }
        config.server = server;
      }
      await writeConfig(config);
    });
    console.log(key === 'server' ? '接收地址已保存；地址改变后需要重新 login。' : '配置已保存，持续采集会在下个周期读取。');
    return;
  }
  if (command === 'logout') {
    await changeConfig(async config => { delete config.token; delete config.machine; await writeConfig(config); });
    console.log('已清除本地登录。需要令已复制的凭据失效时，请在后台撤销机器。');
    return;
  }
  if (['login', 'join', 'install'].includes(command)) {
    await changeConfig(async existing => {
      const address = rest[0] || existing.server;
      if (!address) throw new Error('请提供采集接收地址');
      const config = {...existing, server: address, allowHttp: options['allow-http'] || existing.allowHttp};
      endpoint(address, config.allowHttp);
      if (command === 'login') {
        if (existing.token) throw new Error('已有登录。请先 logout，或用 OFFICE_COLLECTOR_CONFIG 选择另一份配置。');
        const code = options.code || await readSecret('输入后台生成的配对码：', process.env.OFFICE_PAIRING_CODE);
        const result = await request(config, '/v1/pair', {code}, false);
        if (!/^[a-f0-9-]{36}\.[a-zA-Z0-9_-]{43}$/.test(result.token ?? '')) throw new Error('接收端返回了无效凭据');
        config.token = result.token;
        config.machine = {id: result.machine.id, name: result.machine.name, taskAccess: result.machine.taskAccess};
        // Persist the exchanged credential before scanning: a transient scan failure must not lose a one-time pairing.
        await writeConfig(config);
      } else {
        config.token = await readSecret('粘贴旧版机器配对密钥：', process.env.OFFICE_COLLECTOR_TOKEN);
        if (!/^[a-f0-9-]{36}\.[a-zA-Z0-9_-]{43}$/.test(config.token ?? '')) throw new Error('配对密钥格式无效');
        if (existing.token && (command !== 'join' || existing.server !== address || existing.token !== config.token || existing.allowHttp !== config.allowHttp)) {
          throw new Error('已有不同配对，请先 logout 或指定另一份配置。');
        }
        await sendReport(config);
        await writeConfig(config);
      }
    });
    if (command === 'login') {
      try { await sendReport(await readConfig()); }
      catch (error) { throw new Error(`登录已保存，但首次上报失败：${error.message}。请修复连接后执行 run。`); }
    }
    console.log('登录和首次上报成功。');
    if (options.run || (command === 'join' && !options.once)) {
      console.log('持续采集中，按 Ctrl+C 停止。');
      await collect(false);
    }
    return;
  }
  if (command === 'run') { await collect(Boolean(options.once)); return; }
  const config = await readConfig();
  if (command === 'status' || command === 'whoami' || command === 'agents') {
    if (command === 'agents' && rest[0] !== 'list') throw new Error('用法：agents list [--json]');
    const result = await request(config, '/v1/status');
    const runtimes = result.runtimes ?? result.candidates.filter(row => row.kind !== 'process');
    if (options.json) console.log(JSON.stringify(command === 'agents' ? runtimes : result, null, 2));
    else if (command === 'agents') console.table(runtimes.map(({provider, kind, status, instances, processState, agentId}) => ({provider, kind, status, instances, processState, agentId})));
    else console.table({...result.machine, server: config.server});
    return;
  }
  if (command === 'tasks') {
    const [action = 'list', ref] = rest;
    if (!['list', 'show'].includes(action) || (action === 'show' && !ref) || (action === 'list' && ref)) throw new Error('用法：tasks list | tasks show <编号或ID>');
    const filters = Object.fromEntries(['status', 'project', 'limit', 'offset'].map(key => [key, options[key]]));
    const result = await request(config, action === 'show' ? '/v1/tasks/' + encodeURIComponent(ref) : '/v1/tasks', undefined, true, action === 'list' ? filters : undefined);
    if (options.json || action === 'show') console.log(JSON.stringify(result, null, 2));
    else {
      console.table(result.tasks.map(({number, id, title, status, priority, project, assignee}) => ({number: number || id, title, status, priority, project, assignee})));
      console.log(`共 ${result.total} 个任务；当前偏移 ${result.offset}，返回 ${result.tasks.length} 个。`);
    }
  }
}

async function collect(once) {
  for (;;) {
    const config = await readConfig();
    if (!config.token) throw new Error('尚未登录或已退出，请先 login');
    try {
      await sendReport(config);
      if (once) { console.log('上报成功'); return; }
    } catch (error) {
      if (once || error.permanent) throw error;
      console.error(`采集上报失败，将重试：${error.message}`);
    }
    await sleep((config.interval ?? 10) * 1000);
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
