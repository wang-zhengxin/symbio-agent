import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProcesses, processWindowTitles, withProcessWindowTitles } from '../collector/office-collector.mjs';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { createDiscovery } from '../src/discovery.js';
import { companyTools } from '../src/company-tools.js';
import { discoveryGroups } from '../public/discovery-model.js';

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

test('Instance names use executable basenames and titles from the matching PID without including command arguments', () => {
  const processes = discoverProcesses([
    {pid:1, ppid:0, started:'one', name:'/Applications/Antigravity.app/Contents/MacOS/Antigravity', command:'Antigravity --token secret-value'},
    {pid:2, ppid:0, started:'two', name:'/usr/local/bin/agy', command:'agy --prompt private-text'},
  ]);
  assert.deepEqual(processes.map(row => row.processName), ['Antigravity','agy']);
  const named = withProcessWindowTitles(processes, [
    {pid:1,title:'  项目设计 — Antigravity  '}, {pid:1,title:'项目设计 — Antigravity'},
    {pid:1,title:'第二个窗口'}, {pid:999,title:'其他应用内容'}, {pid:2,title:''},
  ]);
  assert.deepEqual(named[0].windowTitles, ['项目设计 — Antigravity','第二个窗口']);
  assert.deepEqual(named[1].windowTitles, []);
  assert.doesNotMatch(JSON.stringify(named), /secret-value|private-text|Applications|其他应用/);
  assert.equal(named[0].instance, processes[0].instance);
  const bounded = withProcessWindowTitles(processes, Array.from({length:12}, (_,i)=>({pid:1,title:'\u0000\u202e'+i+'x'.repeat(200)})));
  assert.equal(bounded[0].windowTitles.length,8);
  assert.ok(bounded[0].windowTitles.every(title=>title.length===160));
  assert.doesNotMatch(bounded[0].windowTitles.join(''), /[\u0000\u202e]/);
});

test('Window title collection supports macOS and Windows and degrades safely if access is unavailable', async () => {
  for(const platform of ['darwin','win32']) {
    const titles = await processWindowTitles([{pid:12}], {platform, execute:async()=>({stdout:JSON.stringify([
      {pid:12,title:'设计窗口'}, {pid:99,title:'其他进程'}, {pid:12,title:null},
    ])})});
    assert.deepEqual(titles,{status:'available',windows:[{pid:12,title:'设计窗口'}]});
    assert.deepEqual(await processWindowTitles([{pid:12}], {platform, execute:async()=>{throw new Error('denied');}}),{status:'unavailable',windows:[]});
  }
  assert.deepEqual(await processWindowTitles([{pid:12}], {platform:'darwin', execute:async()=>({stdout:'{"status":"permission-required","windows":[]}'})}),{status:'permission-required',windows:[]});
  assert.deepEqual(await processWindowTitles([{pid:12}], {platform:'linux', execute:()=>assert.fail('No window command on unsupported platforms')}),{status:'unsupported',windows:[]});
  assert.deepEqual(await processWindowTitles([], {platform:'darwin', execute:()=>assert.fail('No process to query')}),{status:'not-requested',windows:[]});
});

test('Collectors persist fresh instance metadata, clear stale titles and accept old clients without names', t => {
  const {discovery,store,machine}=setup(t);
  const report = {...sample,windowTitleStatus:'available',processes:[{...sample.processes[0],processName:'codex',windowTitles:['方案讨论']}]};
  discovery.receive(machine.id, report);
  assert.equal(store.get('machine',machine.id).windowTitleStatus,'available');
  const instance = store.list('candidate').find(row=>row.kind==='process');
  assert.equal(instance.processName,'codex');assert.deepEqual(instance.windowTitles,['方案讨论']);
  discovery.receive(machine.id, {...report,processScan:'unavailable',processes:[]});
  assert.deepEqual(store.get('candidate',instance.id).windowTitles,['方案讨论']);
  discovery.receive(machine.id, {...report,processes:[{...report.processes[0],windowTitles:[]}]});
  assert.deepEqual(store.get('candidate',instance.id).windowTitles,[]);
  discovery.receive(machine.id,sample);
  assert.equal(store.get('machine',machine.id).windowTitleStatus,'unknown');
  assert.equal(store.get('candidate',instance.id).processName,null);
  assert.deepEqual(store.get('candidate',instance.id).windowTitles,[]);
  for(const invalid of [{processName:'/private/token'}, {processName:'x'.repeat(81)}, {windowTitles:null},
    {windowTitles:['\u0000bad']}, {windowTitles:Array(9).fill('window')}, {windowTitles:[{}]}]) {
    assert.throws(()=>discovery.receive(machine.id,{...sample,processes:[{...sample.processes[0],...invalid}]}),{status:400});
  }
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

test('Connecting a remote runtime does not create staff and cannot grant remote execution', t => {
  const {discovery, office, store, machine} = setup(t);
  discovery.receive(machine.id, sample);
  const candidate = discovery.snapshot().candidates.find(row => row.kind !== 'process');
  const profile = {name:'远程 Codex', personality:'严谨', scope:'代码审阅', runtime:'observed', runnerCandidateId:candidate.id};
  assert.throws(() => office.saveManagedAgent(profile), {status:409});
  discovery.connect(candidate.id);
  assert.equal(store.list('agent').length, 0);
  const employee = office.saveManagedAgent(profile);
  assert.equal(employee.runtime, 'observed');
  assert.equal(employee.sandbox, 'read-only');
  assert.throws(() => office.saveManagedAgent({...employee,runtime:'codex'}), {status:400});
  assert.throws(() => office.saveTask({title:'远程执行',assigneeId:employee.id}), {status:409});
  discovery.receive(machine.id, sample);
  assert.equal(store.get('candidate',candidate.id).status,'connected');
  const hr = office.saveAgent({name:'人事',role:'hr'});
  const task = office.saveTask({title:'查看运行器',assigneeId:hr.id});
  const run = office.startRun(office.enqueueTask(task.id).id);
  const tools = companyTools(store,office,run);
  assert.ok(!tools.definitions.some(tool => tool.name === 'office_review_candidate'));
  assert.equal(tools.call({callId:'old-review',tool:'office_review_candidate',arguments:{}}).success,false);
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
    assert.throws(() => office.stageCandidate(other.id, profile), {status: other.kind === 'process' ? 409 : 400});
  }
  const draft = office.stageCandidate(local.id, profile);
  const worker = office.approveCandidate(local.id, draft.reviewVersion);
  assert.equal(worker.runtime, 'pi');
  assert.equal(worker.sandbox, 'read-only');
});

test('Many PIDs yield one onboarding candidate; process churn and ignored status do not refill HR', t => {
  const {discovery, office, machine, store} = setup(t);
  const processes = Array.from({length: 20}, (_, i) => ({provider: 'codex', pid: 100 + i, instance: `${100 + i}-0123456789abcdef`}));
  discovery.receive(machine.id, {...sample, processes});
  let snapshot = discovery.snapshot();
  const candidate = snapshot.candidates.find(row => row.kind === 'installation');
  assert.equal(snapshot.candidates.filter(row => row.status === 'discovered').length, 1);
  const groups = discoveryGroups(snapshot.candidates, snapshot.machines);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].processes.length, 20);
  assert.throws(() => office.stageCandidate(groups[0].processes[0].id, {name: 'PID 员工', personality: '严谨', scope: '测试'}), {status: 409});
  const hr = office.saveAgent({name: '人事', role: 'hr'});
  const task = office.saveTask({title: '候选查询', assigneeId: hr.id});
  const run = office.startRun(office.enqueueTask(task.id).id);
  const response = companyTools(store, office, run).call({callId: 'grouped-candidates', tool: 'office_candidates', arguments: {}});
  assert.equal(response.success, true);
  assert.doesNotMatch(JSON.stringify(response), /"kind":"process"/);
  office.dismissCandidate(candidate.id);
  discovery.receive(machine.id, {...sample, processes: [{provider: 'codex', pid: 900, instance: '900-fedcba9876543210'}]});
  snapshot = discovery.snapshot();
  const refreshed = discoveryGroups(snapshot.candidates, snapshot.machines);
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].candidate.id, candidate.id);
  assert.equal(refreshed[0].candidate.status, 'dismissed');
  assert.deepEqual(refreshed[0].processes.map(row => row.pid), [900]);
  assert.equal(snapshot.candidates.filter(row => row.status === 'discovered').length, 0);
  assert.equal(discovery.clientStatus(machine.id).runtimes.length, 1);
});

test('Process-only runtimes stay stable when installed later and do not show stale instances as live', t => {
  const {discovery, machine} = setup(t);
  discovery.receive(machine.id, {...sample, installed: []});
  const candidate = discovery.snapshot().candidates.find(row => row.kind !== 'process');
  assert.equal(candidate.kind, 'runtime');
  discovery.receive(machine.id, {...sample, processScan: 'unavailable', processes: [], installed: []});
  let snapshot = discovery.snapshot();
  assert.equal(discoveryGroups(snapshot.candidates, snapshot.machines)[0].processState, 'unknown');
  assert.equal(snapshot.candidates.find(row => row.id === candidate.id).present, true);
  discovery.receive(machine.id, sample);
  snapshot = discovery.snapshot();
  assert.equal(snapshot.candidates.find(row => row.kind === 'installation').id, candidate.id);
  discovery.receive('local', sample);
  snapshot = discovery.snapshot();
  assert.equal(discoveryGroups(snapshot.candidates, snapshot.machines).length, 2);
  discovery.revoke(machine.id);
  snapshot = discovery.snapshot();
  assert.equal(discoveryGroups(snapshot.candidates, snapshot.machines).length, 1);
  discovery.receive('local', {...sample, installed: [], processes: []});
  snapshot = discovery.snapshot();
  assert.equal(discoveryGroups(snapshot.candidates, snapshot.machines).length, 0);
});

test('Legacy normalization is idempotent and preserves drafts, employee links and process history', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.tx(() => {
    store.put('machine', {id: 'local', name: '本机', status: 'online', processScan: 'ok'});
    for (const [id, status] of [['raw', 'discovered'], ['draft', 'review'], ['hired', 'approved']]) {
      store.put('candidate', {id, machineId: 'local', kind: 'process', provider: 'codex', status, present: true,
        key: 'process:codex:' + id, pid: 1, firstSeenAt: '2026-11-21T00:00:00.000Z', lastSeenAt: '2026-11-21T00:00:00.000Z',
        ...(id === 'draft' ? {draft: {name: '保留档案'}, reviewVersion: 2} : {}), ...(id === 'hired' ? {agentId: 'employee'} : {})});
    }
    store.put('agent', {id: 'employee', name: '已有员工', candidateId: 'hired'});
  });
  const discovery = createDiscovery(store);
  assert.equal(store.get('candidate', 'raw').status, 'observed');
  assert.equal(store.get('candidate', 'draft').reviewVersion, 2);
  assert.equal(store.get('candidate', 'hired').agentId, 'employee');
  assert.equal(store.get('agent', 'employee').candidateId, 'hired');
  const before = discovery.snapshot();
  createDiscovery(store);
  assert.deepEqual(discovery.snapshot(), before);
  const groups = discoveryGroups(before.candidates, before.machines);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].processes.length, 3);
  assert.equal(groups[0].legacyReviews[0].draft.name, '保留档案');
});

test('Desktop agents recognize main executables and relocated bundles without treating helpers or prompts as agents', () => {
  const rows = [
    {pid: 1, ppid: 0, started: 'one', command: '/Applications/Antigravity.app/Contents/MacOS/Antigravity', name: '/Applications/Antigravity.app/Contents/MacOS/Antigravity'},
    {pid: 2, ppid: 1, started: 'two', command: '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)'},
    {pid: 3, ppid: 1, started: 'three', command: '/Applications/Antigravity.app/Contents/Resources/bin/language_server'},
    {pid: 4, ppid: 0, started: 'four', command: '/Volumes/External Disk/WorkBuddy.app/Contents/MacOS/launcher', name: '/Volumes/External Disk/WorkBuddy.app/Contents/MacOS/launcher'},
    {pid: 5, ppid: 0, started: 'five', command: '"C:\\Program Files\\WorkBuddy\\WorkBuddy.exe" --secret private', name: 'WorkBuddy.exe'},
    {pid: 6, ppid: 5, started: 'six', command: 'WorkBuddy.exe --type=renderer', name: 'WorkBuddy.exe'},
    {pid: 7, ppid: 0, started: 'seven', command: 'bash -c "workbuddy --private"'},
    {pid: 8, ppid: 0, started: 'eight', command: 'node script.js --prompt antigravity'},
    {pid: 9, ppid: 0, started: 'nine', command: 'agy'},
    {pid: 10, ppid: 3, started: 'ten', command: '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper', name: '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper'},
    {pid: 11, ppid: 999, started: 'eleven', command: 'WorkBuddy.exe --type=utility', name: 'WorkBuddy.exe'},
  ];
  assert.deepEqual(discoverProcesses(rows).map(({provider, pid}) => [provider, pid]),
    [['antigravity', 1], ['workbuddy', 4], ['workbuddy', 5], ['antigravity', 9]]);
  assert.doesNotMatch(JSON.stringify(discoverProcesses(rows)), /secret|private|External Disk/);
});

test('WorkBuddy and Antigravity enroll as observed employees only and group their running instances', t => {
  const {discovery, office} = setup(t);
  discovery.receive('local', {...sample, installed: ['workbuddy', 'antigravity'], processes: [
    {provider: 'antigravity', pid: 80, instance: '80-0123456789abcdef'},
    {provider: 'antigravity', pid: 81, instance: '81-0123456789abcdef'},
  ]});
  const snapshot = discovery.snapshot();
  const groups = discoveryGroups(snapshot.candidates, snapshot.machines);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(row => row.provider === 'antigravity').processes.length, 2);
  for (const candidate of snapshot.candidates.filter(row => row.kind === 'installation')) {
    const profile = {name: candidate.provider, personality: '细致', scope: '采集观察'};
    assert.throws(() => office.stageCandidate(candidate.id, {...profile, runtime: 'codex'}), {status: 400});
    const draft = office.stageCandidate(candidate.id, {...profile, runtime: 'observed'});
    const agent = office.approveCandidate(candidate.id, draft.reviewVersion);
    assert.equal(agent.runtime, 'observed');
    assert.equal(agent.sandbox, 'read-only');
  }
});
