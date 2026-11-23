import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {createOffice} from '../src/office.js';
import {createDiscovery} from '../src/discovery.js';
import {agentRunnerChoices, candidateExecutionStatus, candidateRuntimes, selectedRunnerChoice} from '../public/discovery-model.js';

function setup(t) {
  const store=openStore(':memory:'); t.after(()=>store.close());
  const office=createOffice(store), discovery=createDiscovery(store);
  discovery.receive('local',{hostname:'test',platform:'darwin',installed:['codex','pi','workbuddy','antigravity','claude'],processScan:'ok',processes:[]});
  const candidate=provider=>store.list('candidate').find(row=>row.provider===provider);
  return {store,office,discovery,candidate};
}

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
 assert.throws(()=>office.stageCandidate(runtime.id,{name:'不能冒充安装',personality:'严谨',scope:'测试',runtime:'codex'}),{status:400});
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

test('Runner selection rejects forged capabilities, process sources and skips HR only for existing employees', t=>{
  const {office,discovery,candidate,store}=setup(t);
  const original=office.saveAgent({name:'工程师',runtime:'codex'});
  assert.throws(()=>office.saveAgent({...original,runnerCandidateId:candidate('antigravity').id,runtime:'codex'}),{status:400});
  assert.throws(()=>office.saveAgent({name:'新同事',runnerCandidateId:candidate('workbuddy').id,runtime:'observed'}),{status:409});
  const {machine}=discovery.issueMachine({name:'远程'});
  discovery.receive(machine.id,{hostname:'remote',platform:'linux',installed:['codex'],processScan:'ok',processes:[{provider:'codex',pid:99,instance:'99-0123456789abcdef'}]});
  const remote=store.list('candidate').find(row=>row.machineId===machine.id&&row.kind==='installation');
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
  const draft=office.stageCandidate(candidate('antigravity').id,{name:'观察员工',personality:'严谨',scope:'观察',runtime:'observed'});
  const hired=office.approveCandidate(draft.id,draft.reviewVersion);
  assert.equal(hired.provider,'antigravity');assert.equal(hired.runnerCandidateId,draft.id);
});
