#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
});
const aliases = new Map(Object.entries(providers).flatMap(([provider, names]) =>
  names.map(name => [name, provider])));
const exec = promisify(execFile);
const options = {timeout: 8000, maxBuffer: 16 * 1024 * 1024, windowsHide: true};

function executableName(path) {
  return path.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.(?:exe|cmd|bat|mjs|cjs|js|py)$/, '');
}

function identify(command, name) {
  const tokens = command?.match(/"[^"]*"|'[^']*'|\S+/g)?.slice(0, 4)
    .map(token => token.replace(/^["']|["']$/g, '')) ?? [];
  const first = executableName(tokens[0] ?? name ?? '');
  const direct = aliases.get(first) ?? aliases.get(executableName(name ?? ''));
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
    results.push({provider: row.provider, pid: row.pid, instance: `${row.pid}-${identity}`});
  }
  return results.sort((a, b) => a.pid - b.pid).slice(0, 150);
}

async function readProcesses() {
  if (process.platform === 'win32') {
    const {stdout} = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n='Started';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress"], options);
    return [JSON.parse(stdout.replace(/^\uFEFF/, ''))].flat().map(row => ({
      pid: row.ProcessId, ppid: row.ParentProcessId, name: row.Name, command: row.CommandLine, started: row.Started,
    }));
  }
  const {stdout} = await exec('/bin/ps', ['-ww', '-u', String(process.getuid()), '-o', 'pid=,ppid=,lstart=,command='],
    {...options, env: {...process.env, LC_ALL: 'C'}});
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/);
    return match ? [{pid: Number(match[1]), ppid: Number(match[2]), started: match[3], command: match[4]}] : [];
  });
}

async function installedProviders() {
  const windows = process.platform === 'win32';
  const extra = windows ? [] : [join(homedir(), '.local', 'bin'), join(homedir(), '.cargo', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin'];
  const paths = [...new Set([...(process.env.PATH ?? '').split(delimiter), ...extra].filter(Boolean))];
  const suffixes = windows ? ['', '.exe', '.cmd', '.bat'] : [''];
  const detected = await Promise.all(Object.entries(providers).map(async ([provider, names]) => {
    const override = {codex: process.env.OFFICE_CODEX_BIN, pi: process.env.OFFICE_PI_BIN}[provider];
    if (override) names = [...names, override];
    for (const name of names) {
      for (const suffix of suffixes) {
        const candidates = /[/\\]/.test(name) ? [name + suffix] : paths.map(path => join(path, name + suffix));
        const matches = await Promise.all(candidates.map(async path => {
          try {
            await access(path, windows ? constants.F_OK : constants.X_OK);
            return (await stat(path)).isFile();
          } catch { return false; }
        }));
        if (matches.some(Boolean)) return provider;
      }
    }
    return null;
  }));
  return detected.filter(Boolean).sort();
}

export async function scanAgents({excludeSelf = true} = {}) {
  const [installed, scan] = await Promise.all([installedProviders(), readProcesses()
    .then(rows => ({processes: discoverProcesses(rows, excludeSelf ? process.pid : undefined), processScan: 'ok'}))
    .catch(() => ({processes: [], processScan: 'unavailable'}))]);
  return {hostname: hostname(), platform: process.platform, installed, ...scan};
}

const configPath = process.env.OFFICE_COLLECTOR_CONFIG || join(homedir(), '.agent-office', 'collector.json');

function endpoint(address, allowHttp) {
  const url = new URL(address);
  if (url.username || url.password || url.search || url.hash) throw new Error('接收地址不能包含凭据或查询参数');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowHttp))) {
    throw new Error('远程接收地址需要 HTTPS。可信局域网可显式使用 --allow-http');
  }
  url.pathname = url.pathname.replace(/\/$/, '') + '/v1/report';
  return url;
}

async function sendReport(config) {
  const response = await fetch(endpoint(config.server, config.allowHttp), {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token},
    body: JSON.stringify(await scanAgents()),
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) throw Object.assign(new Error('配对凭据无效或已撤销，请重新安装配对'), {permanent: true});
  if (!response.ok) throw new Error(`接收端返回 HTTP ${response.status}`);
}

async function main([command, address, ...flags]) {
  if (command === 'scan') {
    console.log(JSON.stringify(await scanAgents(), null, 2));
    return;
  }
  if (command === 'install') {
    if (!address) throw new Error('用法：node office-collector.mjs install <接收地址> [--allow-http]');
    const allowHttp = flags.includes('--allow-http');
    endpoint(address, allowHttp);
    const reader = createInterface({input: process.stdin, output: process.stdout, terminal: false});
    let token;
    try {
      token = process.env.OFFICE_COLLECTOR_TOKEN || (await reader.question('粘贴工作台生成的机器配对密钥：')).trim();
    } finally { reader.close(); }
    if (!/^[a-f0-9-]{36}\.[a-zA-Z0-9_-]{43}$/.test(token)) throw new Error('配对密钥格式无效');
    const config = {server: address, token, allowHttp};
    await sendReport(config);
    await mkdir(dirname(configPath), {recursive: true, mode: 0o700});
    await writeFile(configPath, JSON.stringify(config) + '\n', {mode: 0o600, flag: 'wx'});
    console.log('配对成功。运行 node office-collector.mjs run 开始持续采集。');
    return;
  }
  if (command !== 'run') {
    console.log('用法：node office-collector.mjs scan | install <接收地址> | run [--once]');
    return;
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const once = address === '--once';
  for (;;) {
    try {
      await sendReport(config);
      if (once) { console.log('上报成功'); return; }
    } catch (error) {
      if (once || error.permanent) throw error;
      console.error(`采集上报失败，将重试：${error.message}`);
    }
    await sleep(10_000);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.code === 'EEXIST' ? '已存在配对配置。重新配对前请移走旧配置。' : error.message);
    process.exitCode = 1;
  });
}
