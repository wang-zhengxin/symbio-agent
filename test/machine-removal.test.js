import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {createDiscovery} from '../src/discovery.js';

const report={hostname:'remote',platform:'linux',installed:['codex'],processScan:'ok',processes:[]};
function setup(t) {
  const store=openStore(':memory:');t.after(()=>store.close());
  const discovery=createDiscovery(store);
  const {machine,token}=discovery.issueMachine({name:'可清理机器'});
  discovery.receive(machine.id,report);
  const source=store.list('candidate')[0];
  const offline=()=>{store.tx(()=>store.put('machine',{...store.get('machine',machine.id),seenAt:new Date(Date.now()-200_000).toISOString()}));discovery.sweep();};
  const state=()=>discovery.snapshot().machines.find(row=>row.id===machine.id).removal;
  return {store,discovery,machine,source,token,offline,state};
}

test('Deletion checks actual offline state, including recent heartbeats after revocation',t=>{
  const {discovery,machine,offline,state}=setup(t);
  assert.equal(state().allowed,false);
  assert.throws(()=>discovery.deleteMachine(machine.id),{status:409});
  discovery.revoke(machine.id);
  assert.equal(state().allowed,false);
  assert.throws(()=>discovery.deleteMachine(machine.id),{status:409});
  offline();assert.equal(state().allowed,true);
  discovery.deleteMachine(machine.id);
  assert.throws(()=>discovery.deleteMachine(machine.id),{status:404});
  discovery.receive('local',report);
  assert.throws(()=>discovery.deleteMachine('local'),{status:409});
});

test('Paused or unauthorized employees still block removal; changing runtime releases the old source',t=>{
  const {discovery,store,machine,source,offline,state}=setup(t);offline();
  store.tx(()=>store.put('agent',{id:'staff',candidateId:source.id,runtime:'observed',paused:true,authorization:{execution:false}}));
  assert.equal(state().boundCount,1);assert.throws(()=>discovery.deleteMachine(machine.id),/员工使用/);
  discovery.receive('local',report);
  const local=store.list('candidate').find(row=>row.machineId==='local');
  store.tx(()=>store.put('agent',{...store.get('agent','staff'),runnerCandidateId:local.id,runtime:'codex'}));
  assert.equal(state().allowed,true);
  discovery.deleteMachine(machine.id);
  assert.equal(store.get('agent','staff').runnerCandidateId,local.id);
  assert.ok(store.get('candidate',local.id));
});

test('Active run snapshots block deletion, and a new heartbeat invalidates a previously allowed deletion',t=>{
  const {discovery,store,machine,source,offline,state}=setup(t);offline();
  store.tx(()=>store.put('run',{id:'work',status:'queued',agent:{runnerCandidateId:source.id}}));
  assert.equal(state().allowed,false);assert.throws(()=>discovery.deleteMachine(machine.id),/任务/);
  store.tx(()=>store.put('run',{...store.get('run','work'),status:'completed'}));
  assert.equal(state().allowed,true);
  discovery.receive(machine.id,report);
  assert.throws(()=>discovery.deleteMachine(machine.id),/离线/);
  offline();discovery.deleteMachine(machine.id);
  assert.equal(store.get('run','work').status,'completed');
});

test('Deleting a machine invalidates tokens and pairing codes, removes sources and retains history',t=>{
  const {discovery,store,machine,token,offline}=setup(t);offline();
  store.tx(()=>store.put('task',{id:'history',title:'保留任务'}));
  discovery.deleteMachine(machine.id,{username:'admin'});
  assert.equal(store.list('candidate').length,0);
  assert.throws(()=>discovery.authenticate('Bearer '+token),{status:401});
  assert.throws(()=>discovery.receive(machine.id,report),{status:401});
  const pairing=discovery.issuePairing({name:'未使用的配对'});
  discovery.deleteMachine(pairing.machine.id);
  assert.throws(()=>discovery.exchangeCode({code:pairing.code}),{status:401});
  assert.equal(store.get('task','history').title,'保留任务');
  assert.ok(store.since(0).some(event=>event.type==='machine.deleted'&&event.payload.operator==='admin'));
});
