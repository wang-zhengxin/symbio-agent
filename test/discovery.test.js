import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProcesses } from '../collector/office-collector.mjs';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { createDiscovery } from '../src/discovery.js';
import { companyTools } from '../src/company-tools.js';

const sample = {
  hostname: 'worker-a', platform: 'linux', installed: ['codex'],
  processScan: 'ok', processes: [{provider: 'codex', pid: 45, instance: '45-0123456789abcdef'}],
};

test('Process scanner recognizes CLI wrappers without leaking arguments or duplicating managed children', () => {
  const rows = [
    {pid: 1, ppid: 0, command: 'bash', started: 'one'},
    {pid: 20, ppid: 1, command: 'node /cli/codex.js --token private', started: 'two'},
    {pid: 21, ppid: 20, command: '/bin/codex --token private', started: 'three'},
    {pid: 22, ppid: 1, command: 'bash -c "start codex"', started: 'four'},
    {pid: 23, ppid: 2, command: 'codex app-server', started: 'five'},
    {pid: 2, ppid: 1, command: 'node src/server.js', started: 'six'},
    {pid: 24, ppid: 1, command: 'node /npm/@google/gemini-cli/dist/index.js', started: 'seven'},
    {pid: 25, ppid: 1, command: 'node /npm/@earendil-works/pi-coding-agent/dist/bundle/cli.js', started: 'eight'},
  ];
  const result = discoverProcesses(rows, 2);
  assert.deepEqual(result.map(({provider, pid}) => [provider, pid]), [['codex', 20], ['gemini', 24], ['pi', 25]]);
  assert.doesNotMatch(JSON.stringify(result), /private|token|\/cli/);
  assert.notEqual(discoverProcesses([{...rows[1], started: 'different'}])[0].instance, result[0].instance);
});

function setup(t) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const discovery = createDiscovery(store);
  const office = createOffice(store);
  const {machine, token} = discovery.issueMachine({name: '远程测试机'});
  return {store, discovery, office, machine, token};
}

test('Collectors are scoped to their pairing, scan outages do not mark processes exited, and revocation blocks reports', t => {
  const {discovery, store, machine, token} = setup(t);
  assert.throws(() => discovery.authenticate('Bearer ' + token.slice(0, -1)), {status: 401});
  const id = discovery.authenticate('Bearer ' + token);
  discovery.receive(id, {...sample, machineId: 'local'});
  assert.equal(discovery.snapshot().machines[0].tokenHash, undefined);
  const process = discovery.snapshot().candidates.find(candidate => candidate.kind === 'process');
  assert.equal(process.machineId, machine.id);
  discovery.receive(id, {...sample, processScan: 'unavailable', processes: []});
  assert.equal(store.get('candidate', process.id).present, true);
  discovery.receive(id, {...sample, processes: []});
  assert.equal(store.get('candidate', process.id).present, false);
  store.tx(() => store.put('machine', {...store.get('machine', id), seenAt: new Date(0).toISOString()}));
  discovery.sweep();
  assert.equal(store.get('machine', id).status, 'offline');
  discovery.receive(id, sample);
  assert.equal(store.get('machine', id).status, 'online');
  assert.equal(store.get('candidate', process.id).present, true);
  discovery.revoke(id);
  assert.throws(() => discovery.authenticate('Bearer ' + token), {status: 401});
  assert.throws(() => discovery.receive(id, sample), {status: 401});
});

test('Discovered instances require a reviewed draft; remote workers cannot obtain execution access', t => {
  const {discovery, office, store, machine} = setup(t);
  discovery.receive(machine.id, sample);
  const candidate = discovery.snapshot().candidates[0];
  assert.equal(store.list('agent').length, 0);
  assert.throws(() => office.approveCandidate(candidate.id, 1), {status: 409});
  const profile = {name: '远程 Codex', personality: '严谨', scope: '代码审阅'};
  assert.throws(() => office.stageCandidate(candidate.id, {...profile, runtime: 'codex'}), {status: 400});
  assert.throws(() => office.stageCandidate(candidate.id, {...profile, personality: ' '}), {status: 400});

  const hr = office.saveAgent({name: '人事', role: 'hr'});
  const task = office.saveTask({title: '拟档', assigneeId: hr.id});
  const run = office.startRun(office.enqueueTask(task.id).id);
  const tools = companyTools(store, office, run);
  assert.equal(tools.call({callId: 'draft-1', tool: 'office_review_candidate',
    arguments: {...profile, candidateId: candidate.id}}).success, true);
  assert.equal(store.list('agent').length, 1);
  const review = office.stageCandidate(candidate.id, {...profile, sandbox: 'workspace-write'});
  assert.throws(() => office.approveCandidate(candidate.id, review.reviewVersion - 1), {status: 409});
  const employee = office.approveCandidate(candidate.id, review.reviewVersion);
  assert.equal(employee.runtime, 'observed');
  assert.equal(employee.sandbox, 'read-only');
  assert.throws(() => office.approveCandidate(candidate.id, review.reviewVersion), {status: 409});
  assert.throws(() => office.saveAgent({...employee, candidateId: undefined, runtime: 'codex'}), {status: 400});
  assert.throws(() => office.saveTask({title: '远程执行', assigneeId: employee.id}), {status: 409});
  assert.throws(() => office.startConversation({topic: '例会', participantIds: [employee.id, hr.id]}), {status: 409});
  discovery.receive(machine.id, sample);
  assert.equal(store.get('candidate', candidate.id).agentId, employee.id);
});

test('A local Codex installation can be enrolled as a managed worker only after approval', t => {
  const {discovery, office} = setup(t);
  discovery.receive('local', sample);
  const candidate = discovery.snapshot().candidates.find(row => row.kind === 'installation');
  const review = office.stageCandidate(candidate.id, {
    name: '研发', personality: '直接', scope: '测试项目', runtime: 'codex', sandbox: 'workspace-write', avatarId:'lead',
  });
  const worker = office.approveCandidate(candidate.id, review.reviewVersion);
  assert.equal(worker.runtime, 'codex');
  assert.equal(worker.sandbox, 'workspace-write');
  assert.equal(worker.avatarId, 'lead');
});

test('Only local Pi installations can gain text execution through onboarding', t => {
  const {discovery, office, machine} = setup(t);
  const report = {...sample, installed: ['pi'], processes: [{...sample.processes[0], provider: 'pi'}]};
  discovery.receive('local', report);
  discovery.receive(machine.id, report);
  const candidates = discovery.snapshot().candidates;
  const local = candidates.find(row => row.machineId === 'local' && row.kind === 'installation');
  const profile = {name: '复核员', personality: '严谨', scope: '校对', runtime: 'pi', sandbox: 'workspace-write'};
  for (const other of candidates.filter(row => row.id !== local.id)) {
    assert.throws(() => office.stageCandidate(other.id, profile), {status: 400});
  }
  const draft = office.stageCandidate(local.id, profile);
  const worker = office.approveCandidate(local.id, draft.reviewVersion);
  assert.equal(worker.runtime, 'pi');
  assert.equal(worker.sandbox, 'read-only');
});
