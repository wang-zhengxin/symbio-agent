import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {createOffice} from '../src/office.js';
import {createDiscovery} from '../src/discovery.js';
import {agentRunnerChoices, runnerConnected} from '../public/discovery-model.js';
import {officeOverview} from '../public/overview.js';

const report={hostname:'test',platform:'darwin',installed:['codex','pi','workbuddy'],processScan:'ok',processes:[]};
function setup(t) {
 const store=openStore(':memory:');t.after(()=>store.close());
 const office=createOffice(store),discovery=createDiscovery(store);
 discovery.receive('local',report);
 return {store,office,discovery,source:provider=>store.list('candidate').find(row=>row.provider===provider)};
}

test('Connection is idempotent, creates no staff, and enables one runtime to bind multiple independent employees',t=>{
 const {store,office,discovery,source}=setup(t);
 const codex=source('codex');
 const choices=()=>agentRunnerChoices({},discovery.snapshot().candidates,discovery.snapshot().machines);
 assert.deepEqual(choices().map(row=>row.runtime),['demo']);
 const profile={name:'负责人',role:'lead',runtime:'codex',runnerCandidateId:codex.id};
 assert.throws(()=>office.saveManagedAgent(profile),{status:409});
 assert.throws(()=>office.saveManagedAgent({name:'绕过接入',runtime:'codex'}),{status:409});
 const connected=discovery.connect(codex.id);
 assert.deepEqual(discovery.connect(codex.id),connected);
 assert.equal(store.list('agent').length,0);assert.equal(store.list('run').length,0);
 assert.equal(choices().filter(row=>row.runtime==='codex').length,1);
 const lead=office.saveManagedAgent(profile);
 const engineer=office.saveManagedAgent({...profile,name:'研发',role:'worker',authorization:{execution:false}});
 assert.notEqual(lead.id,engineer.id);assert.notEqual(lead.seatIndex,engineer.seatIndex);
 assert.equal(lead.runnerCandidateId,engineer.runnerCandidateId);
 assert.equal(lead.authorization.execution,true);assert.equal(engineer.authorization.execution,false);
 assert.equal(store.get('candidate',codex.id).agentId,undefined);
 discovery.receive('local',report);
 assert.equal(runnerConnected(source('codex')),true);
 assert.throws(()=>office.dismissCandidate(codex.id),{status:409});
 discovery.connect(source('workbuddy').id);
 const observed=office.saveManagedAgent({name:'观察员',runtime:'observed',runnerCandidateId:source('workbuddy').id});
 assert.ok(officeOverview({agents:[observed],...discovery.snapshot()},{},{timeZone:'Asia/Shanghai'}).online.some(agent=>agent.id===observed.id));
 assert.throws(()=>office.enqueueTask(office.saveTask({title:'观察员不能执行',assigneeId:observed.id}).id),{status:409});
});

test('Ignored sources can reconnect; offline, revoked and individual process sources cannot be newly admitted',t=>{
 const {store,office,discovery,source}=setup(t);
 office.dismissCandidate(source('pi').id);discovery.connect(source('pi').id);
 assert.equal(runnerConnected(source('pi')),true);
 const {machine}=discovery.issueMachine({name:'远程'});
 discovery.receive(machine.id,{...report,installed:['codex'],processes:[{provider:'codex',pid:1,instance:'1-0123456789abcdef'}]});
 const remote=store.list('candidate').find(row=>row.machineId===machine.id&&row.kind!=='process');
 const process=store.list('candidate').find(row=>row.kind==='process');
 assert.throws(()=>discovery.connect(process.id),{status:409});
 store.tx(()=>store.put('machine',{...store.get('machine',machine.id),status:'offline'}));
 assert.throws(()=>discovery.connect(remote.id),{status:409});
 discovery.receive(machine.id,{...report,installed:['codex']});discovery.connect(remote.id);
 discovery.revoke(machine.id);
 assert.throws(()=>discovery.connect(remote.id),{status:409});
 assert.throws(()=>office.saveManagedAgent({name:'失效来源',runtime:'observed',runnerCandidateId:remote.id}),{status:409});
 assert.ok(!agentRunnerChoices({},discovery.snapshot().candidates,discovery.snapshot().machines).some(row=>row.candidateId===remote.id));
});

test('Migration preserves preexisting bindings and drafts without creating employees or admitting unrelated sources',t=>{
 const {store,office,source}=setup(t);
 const legacy=office.saveAgent({name:'已有员工',runtime:'codex'});
 store.tx(()=>{
   store.put('agent',{...legacy,runnerCandidateId:source('codex').id});
   store.put('candidate',{...source('pi'),status:'review',draft:{name:'旧草稿'},reviewVersion:2});
 });
 const migrated=createDiscovery(store);
 assert.equal(runnerConnected(source('codex')),true);
 assert.equal(runnerConnected(source('pi')),false);
 assert.equal(source('pi').draft.name,'旧草稿');
 const before=migrated.snapshot();createDiscovery(store);assert.deepEqual(migrated.snapshot(),before);
 assert.equal(store.list('agent').length,1);
 assert.equal(office.saveManagedAgent({...store.get('agent',legacy.id),name:'改名'}).runnerCandidateId,source('codex').id);
});
