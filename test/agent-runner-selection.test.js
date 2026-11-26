import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {createOffice} from '../src/office.js';
import {createDiscovery} from '../src/discovery.js';
import {agentRunnerChoices, candidateExecutionStatus, candidateRuntimes, selectedRunnerChoice, discoveryGroups, runnerBoundAgents} from '../public/discovery-model.js';

function setup(t) {
  const store=openStore(':memory:'); t.after(()=>store.close());
  const office=createOffice(store), discovery=createDiscovery(store);
  discovery.receive('local',{hostname:'test',platform:'darwin',installed:['codex','pi','workbuddy','antigravity','claude'],processScan:'ok',processes:[]});
  const candidate=provider=>store.list('candidate').find(row=>row.provider===provider);
  for (const row of store.list('candidate')) if (row.kind !== 'process') discovery.connect(row.id);
  return {store,office,discovery,candidate};
}

test('Discovery counts all five legacy local employees without changing their binding or mixing remote runtimes', t => {
  const {office, discovery, store} = setup(t);
  const employees = ['负责人', '产品', '开发', '测试', '运维'].map(name => office.saveAgent({name, runtime:'codex'}));
  office.saveAgent({name:'Pi 同事', runtime:'pi'});
  office.saveAgent({name:'演示同事', runtime:'demo'});
  const before = store.list('agent');
  const snapshot = discovery.snapshot();
  const codex = discoveryGroups(snapshot.candidates, snapshot.machines).find(row => row.provider === 'codex');
  assert.deepEqual(runnerBoundAgents(codex, before, snapshot.candidates).map(row => row.id).sort(), employees.map(row => row.id).sort());
  assert.deepEqual(runnerBoundAgents({...codex, machine:{id:'remote'}}, before, snapshot.candidates), []);
  assert.deepEqual(store.list('agent'), before);
  assert.ok(employees.every(row => !row.runnerCandidateId));
});

test('Current binding overrides hiring history, preserves legacy process provenance and never guesses missing explicit sources', () => {
  const candidates = [
    {id:'codex', machineId:'local', provider:'codex', kind:'installation'},
    {id:'pi', machineId:'local', provider:'pi', kind:'installation'},
    {id:'old-process', machineId:'remote', provider:'codex', kind:'process', present:false},
  ];
  const agents = [
    {id:'switched', runtime:'pi', runnerCandidateId:'pi', candidateId:'codex'},
    {id:'hired', runtime:'codex', candidateId:'codex'},
    {id:'paused', runtime:'codex', runnerCandidateId:'codex', candidateId:'codex', paused:true, authorization:{execution:false}},
    {id:'legacy-process', runtime:'observed', candidateId:'old-process'},
    {id:'missing', runtime:'codex', runnerCandidateId:'removed', candidateId:'codex'},
    {id:'unbound-observer', runtime:'observed', provider:'codex'},
  ];
  const bound = (provider, machineId='local') => runnerBoundAgents({provider, machine:{id:machineId}}, agents, candidates).map(row => row.id);
  assert.deepEqual(bound('codex'), ['hired', 'paused']);
  assert.deepEqual(bound('pi'), ['switched']);
  assert.deepEqual(bound('codex', 'remote'), ['legacy-process']);
});

test('Discovery counts follow saved runtime changes and employee removal', t => {
  const {office, discovery, store, candidate} = setup(t);
  const count = provider => {
    const snapshot = discovery.snapshot();
    const group = discoveryGroups(snapshot.candidates, snapshot.machines).find(row => row.provider === provider);
    return runnerBoundAgents(group, store.list('agent'), snapshot.candidates).length;
  };
  const legacy = office.saveAgent({name:'运维', runtime:'codex'});
  assert.equal(count('codex'), 1);
  const changed = office.saveManagedAgent({...legacy, runtime:'observed', runnerCandidateId:candidate('workbuddy').id});
  assert.equal(count('codex'), 0);
  assert.equal(count('workbuddy'), 1);
  const restored = office.saveManagedAgent({...changed, runtime:'codex', runnerCandidateId:candidate('codex').id});
  assert.equal(count('codex'), 1);
  assert.equal(count('workbuddy'), 0);
  store.tx(() => store.remove('agent', restored.id));
  assert.equal(count('codex'), 0);
});

test('Discovery and runner choices share execution labels, deduplicate local adapters and preserve the selected binding',t=>{
 const {office,discovery,candidate}=setup(t);
 const original=office.saveAgent({name:'已有负责人',role:'lead',runtime:'codex'});
 const snapshot=discovery.snapshot();
 const choices=agentRunnerChoices(original,snapshot.candidates,snapshot.machines);
 for(const provider of ['codex','pi','workbuddy','antigravity']) {
   const source=candidate(provider);
   const rows=choices.filter(row=>row.provider===provider);
   assert.equal(rows.length,1);
   assert.deepEqual(rows[0].adapter,candidateExecutionStatus(source));
   assert.equal(rows[0].runtime,candidateRuntimes(source).at(-1));
 }
 assert.equal(selectedRunnerChoice(original,choices),'codex');
 assert.equal(choices.find(row=>row.value==='codex').candidateId,undefined);
 const fresh=agentRunnerChoices({},snapshot.candidates,snapshot.machines);
 assert.equal(selectedRunnerChoice({},fresh),'source:'+candidate('codex').id);
 const bound={...original,runnerCandidateId:candidate('codex').id};
 assert.equal(selectedRunnerChoice(bound,agentRunnerChoices(bound,snapshot.candidates,snapshot.machines)),'source:'+candidate('codex').id);
 const observed={...bound,runtime:'observed',provider:'codex',candidateId:candidate('codex').id};
 const observedChoices=agentRunnerChoices(observed,snapshot.candidates,snapshot.machines);
 const selected=observedChoices.find(row=>row.value===selectedRunnerChoice(observed,observedChoices));
 assert.equal(selected.runtime,'observed');assert.equal(selected.adapter.label,'仅观察模式');
 assert.equal(observedChoices.filter(row=>row.provider==='codex'&&row.runtime==='observed').length,1);
});

test('Process detection and remote collection do not falsely advertise executable sources',t=>{
 const {office,discovery}=setup(t);
 discovery.receive('local',{hostname:'test',platform:'darwin',installed:[],processScan:'ok',processes:[{provider:'codex',pid:12,instance:'12-0123456789abcdef'}]});
 const snapshot=discovery.snapshot();
 const runtime=snapshot.candidates.find(row=>row.kind==='runtime');
 assert.equal(candidateExecutionStatus(runtime).label,'已适配，待定位 CLI');
 assert.equal(candidateExecutionStatus(runtime).ready,false);
 assert.deepEqual(candidateRuntimes(runtime),['observed']);
 assert.throws(()=>office.saveManagedAgent({name:'不能冒充安装',runtime:'codex',runnerCandidateId:runtime.id}),{status:400});
 const remote={...runtime,machineId:'remote',kind:'installation'};
 assert.equal(candidateExecutionStatus(remote).label,'远程执行未接入');
 assert.deepEqual(candidateRuntimes(remote),['observed']);
});

test('All discovered runtimes are selectable and observation bindings persist without execution privileges', t=>{
  const {store,office,discovery,candidate}=setup(t);
  const original=office.saveAgent({name:'负责人',role:'lead',runtime:'codex',personality:'稳健',scope:'协调',sandbox:'read-only'});
  const options=agentRunnerChoices(original,discovery.snapshot().candidates,discovery.snapshot().machines);
  for(const provider of ['workbuddy','antigravity','claude']) assert.equal(options.find(row=>row.provider===provider).runtime,'observed');
  const changed=office.saveAgent({...original,candidateId:undefined,runnerCandidateId:candidate('workbuddy').id,runtime:'observed',sandbox:'workspace-write'});
  assert.equal(changed.provider,'workbuddy'); assert.equal(changed.sandbox,'read-only');
  assert.equal(changed.runnerCandidateId,candidate('workbuddy').id);
  assert.deepEqual(changed.mcpServerIds,[]);
  assert.throws(()=>office.saveTask({title:'不得执行',assigneeId:changed.id}),{status:409});
  const edited=office.saveAgent({...changed,candidateId:undefined,name:'负责人改名'});
  assert.equal(edited.provider,'workbuddy');
  const restored=office.saveAgent({...edited,candidateId:undefined,runnerCandidateId:candidate('codex').id,runtime:'codex'});
  assert.equal(restored.runtime,'codex');
  assert.equal(store.list('agent').length,1);
});

test('Runner selection rejects forged capabilities and process sources; connected sources can bind new employees', t=>{
  const {office,discovery,candidate,store}=setup(t);
  const original=office.saveAgent({name:'工程师',runtime:'codex'});
  assert.throws(()=>office.saveAgent({...original,runnerCandidateId:candidate('antigravity').id,runtime:'codex'}),{status:400});
  assert.equal(office.saveManagedAgent({name:'新同事',runnerCandidateId:candidate('workbuddy').id,runtime:'observed'}).runtime,'observed');
  const {machine}=discovery.issueMachine({name:'远程'});
  discovery.receive(machine.id,{hostname:'remote',platform:'linux',installed:['codex'],processScan:'ok',processes:[{provider:'codex',pid:99,instance:'99-0123456789abcdef'}]});
  const remote=store.list('candidate').find(row=>row.machineId===machine.id&&row.kind==='installation');
  discovery.connect(remote.id);
  assert.throws(()=>office.saveAgent({...original,runnerCandidateId:remote.id,runtime:'codex'}),{status:400});
  const pid=store.list('candidate').find(row=>row.kind==='process');
  assert.throws(()=>office.saveAgent({...original,runnerCandidateId:pid.id,runtime:'observed'}),{status:409});
  discovery.revoke(machine.id);
  assert.throws(()=>office.saveAgent({...original,runnerCandidateId:remote.id,runtime:'observed'}),{status:409});
  assert.ok(!agentRunnerChoices(original,discovery.snapshot().candidates,discovery.snapshot().machines).some(row=>row.candidateId===remote.id));
});

test('Queued work prevents switching runtime and approved hires retain their provider identity',t=>{
  const {office,candidate}=setup(t);
  const original=office.saveAgent({name:'开发',runtime:'demo'});
  const task=office.saveTask({title:'已有工作',assigneeId:original.id});office.enqueueTask(task.id);
  assert.throws(()=>office.saveAgent({...original,runnerCandidateId:candidate('workbuddy').id,runtime:'observed'}),{status:409});
  const hired=office.saveManagedAgent({name:'观察员工',personality:'严谨',scope:'观察',runtime:'observed',runnerCandidateId:candidate('antigravity').id});
  assert.equal(hired.provider,'antigravity');assert.equal(hired.runnerCandidateId,candidate('antigravity').id);
});
