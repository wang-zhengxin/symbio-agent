import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { providers } from '../collector/office-collector.mjs';
import { choice, fail, integer, string } from './input.js';

const known = Object.keys(providers);
const expiry = 40_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

function validateReport(input) {
  const hostname = string(input.hostname, '主机名', 160);
  const platform = choice(input.platform, ['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'sunos', 'aix'], '系统');
  const processScan = choice(input.processScan, ['ok', 'unavailable'], '进程扫描状态');
  if (!Array.isArray(input.installed) || input.installed.length > known.length ||
      !Array.isArray(input.processes) || input.processes.length > 150) fail('采集清单无效');
  if (processScan === 'unavailable' && input.processes.length) fail('进程扫描结果无效');
  const found = new Map();
  for (const provider of input.installed) {
    choice(provider, known, '运行器');
    found.set('install:' + provider, {provider, kind: 'installation'});
  }
  for (const row of input.processes) {
    if (!row || typeof row !== 'object') fail('进程记录无效');
    const provider = choice(row.provider, known, '运行器');
    const pid = integer(row.pid, '进程 ID', 1, 2_147_483_647);
    if (typeof row.instance !== 'string' || !new RegExp('^' + pid + '-[a-f0-9]{16}$').test(row.instance)) fail('进程标识无效');
    found.set('process:' + provider + ':' + row.instance, {provider, kind: 'process', pid});
  }
  return {hostname, platform, processScan, found};
}

export function createDiscovery(store) {
  const {get, put, list, tx, event} = store;
  const publicMachine = ({tokenHash, ...machine}) => machine;

  function issueMachine(input) {
    const name = string(input.name, '机器名称', 100);
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    return tx(() => {
      const machine = put('machine', {id, name, tokenHash: digest(secret), status: 'awaiting',
        local: false, createdAt: now(), seenAt: null});
      event('machine.paired', {machineId: id, status: machine.status});
      return {machine: publicMachine(machine), token: id + '.' + secret};
    });
  }

  function authenticate(header) {
    const match = typeof header === 'string' && header.match(/^Bearer ([a-f0-9-]{36})\.([a-zA-Z0-9_-]{43})$/);
    const machine = match && get('machine', match[1]);
    if (!machine?.tokenHash || machine.status === 'revoked' ||
        !timingSafeEqual(Buffer.from(machine.tokenHash, 'hex'), Buffer.from(digest(match[2]), 'hex'))) {
      fail('配对凭据无效', 401);
    }
    return machine.id;
  }

  function revoke(id) {
    return tx(() => {
      const machine = get('machine', id);
      if (!machine || machine.local) fail('远程机器不存在', 404);
      if (machine.status === 'revoked') return publicMachine(machine);
      const updated = put('machine', {...machine, status: 'revoked', tokenHash: undefined});
      event('machine.revoked', {machineId: id, status: 'revoked'});
      return publicMachine(updated);
    });
  }

  function receive(machineId, input) {
    const {hostname, platform, processScan, found} = validateReport(input);
    const local = machineId === 'local';
    return tx(() => {
      const before = get('machine', machineId);
      if (!local && (!before || before.status === 'revoked')) fail('配对凭据无效', 401);
      const stamp = now();
      const machine = put('machine', {...before, id: machineId, name: before?.name ?? '本机',
        hostname, platform, processScan, local, status: 'online', seenAt: stamp,
        createdAt: before?.createdAt ?? stamp});
      if (before?.status !== 'online' || before.processScan !== processScan) {
        event('machine.status', {machineId, status: machine.status, processScan});
      }
      const existing = list('candidate').filter(candidate => candidate.machineId === machineId);
      const indexed = new Map(existing.map(candidate => [candidate.key, candidate]));
      for (const [key, observation] of found) {
        const old = indexed.get(key);
        const candidate = put('candidate', {
          ...old, ...observation, id: old?.id ?? randomUUID(), key, machineId, present: true,
          status: old?.status ?? 'discovered', firstSeenAt: old?.firstSeenAt ?? stamp, lastSeenAt: stamp,
        });
        if (!old || !old.present) event(old ? 'candidate.reappeared' : 'candidate.discovered',
          {candidateId: candidate.id, machineId, provider: candidate.provider, kind: candidate.kind},
          {agentId: candidate.agentId});
      }
      for (const old of existing) {
        if (!old.present || found.has(old.key) || (old.kind === 'process' && processScan === 'unavailable')) continue;
        put('candidate', {...old, present: false});
        event('candidate.not_seen', {candidateId: old.id, machineId}, {agentId: old.agentId});
      }
      return {accepted: found.size};
    });
  }

  function sweep() {
    const disconnected = list('machine').filter(machine => machine.status === 'online' &&
      Date.now() - Date.parse(machine.seenAt) > expiry);
    if (!disconnected.length) return;
    tx(() => {
      for (const machine of disconnected) {
        put('machine', {...machine, status: 'offline'});
        event('machine.status', {machineId: machine.id, status: 'offline'});
      }
    });
  }

  function snapshot() {
    return {machines: list('machine').map(publicMachine), candidates: list('candidate')};
  }

  return {issueMachine, authenticate, receive, revoke, sweep, snapshot};
}
