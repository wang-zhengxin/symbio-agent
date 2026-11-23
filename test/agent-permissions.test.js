import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {createOffice} from '../src/office.js';
import {companyTools} from '../src/company-tools.js';
import {effectiveAgentPermissions} from '../public/agent-permissions.js';
import {createDiscovery} from '../src/discovery.js';
import {agentAuthorization, agentCanExecute, executionAdapterStatus} from '../public/agent-permissions.js';

function setup(t) {const store=openStore(':memory:');t.after(()=>store.close());return {store,office:createOffice(store)};}

test('Pending authorization persists independently of adapter capabilities and activates after a supported binding', t=>{
 const {store,office}=setup(t);
 const discovery=createDiscovery(store);
 discovery.receive('local',{hostname:'test',platform:'darwin',installed:['workbuddy','codex'],processScan:'ok',processes:[]});
 const source=provider=>store.list('candidate').find(row=>row.provider===provider);
 const server=office.saveMcpServer({name:'检索',transport:'http',url:'https://example.com/mcp',tools:'lookup'});
 const draft=office.stageCandidate(source('workbuddy').id,{name:'负责人',role:'lead',runtime:'observed',personality:'稳健',scope:'协调'});
 const hired=office.approveCandidate(draft.id,draft.reviewVersion);
 const {candidateId,...profile}=hired;
 const pending=office.saveAgent({...profile,authorization:{execution:true,sandbox:'workspace-write',mcpServerIds:[server.id],tools:{delegation:true}}});
 assert.equal(executionAdapterStatus(pending).ready,false);
 assert.equal(agentCanExecute(pending),false);
 assert.equal(pending.authorization.sandbox,'workspace-write');
 assert.deepEqual(pending.authorization.mcpServerIds,[server.id]);
 assert.equal(pending.authorization.tools.delegation,true);
 assert.equal(pending.sandbox,'read-only');assert.deepEqual(pending.mcpServerIds,[]);
 assert.ok(Object.values(pending.permissions).every(value=>value===false));
 assert.throws(()=>office.saveTask({title:'不能用授权代替适配',assigneeId:pending.id}),{status:409});
 const saved=office.saveAgent({...pending,candidateId:undefined,name:'改名'});
 assert.deepEqual(agentAuthorization(store.get('agent',saved.id)),pending.authorization);
 const bound=office.saveAgent({...saved,candidateId:undefined,runtime:'codex',runnerCandidateId:source('codex').id});
 assert.equal(agentCanExecute(bound),true);assert.equal(bound.permissions.delegation,true);
 assert.equal(bound.sandbox,'workspace-write');assert.deepEqual(bound.mcpServerIds,[server.id]);
});

test('Execution authorization blocks new manual, timed, conversation and mention runs without changing queued snapshots',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-01-01T12:00:00Z')});
 const {store,office}=setup(t);
 const agent=office.saveAgent({name:'负责人',role:'lead',runtime:'codex'});
 const peer=office.saveAgent({name:'同事',runtime:'pi'});
 const queuedTask=office.saveTask({title:'已排队',assigneeId:agent.id});
 const queued=office.enqueueTask(queuedTask.id);
 const manual=office.saveTask({title:'手动',assigneeId:agent.id});
 const timed=office.saveTask({title:'定时',assigneeId:agent.id,scheduledAt:'2026-01-01T12:01:00Z'});
 const disabled=office.saveAgent({...agent,authorization:{execution:false}});
 assert.equal(agentCanExecute(disabled),false);
 assert.ok(Object.values(disabled.permissions).every(value=>value===false));
 assert.throws(()=>office.enqueueTask(manual.id),{status:409});
 assert.throws(()=>office.startConversation({topic:'讨论',participantIds:[agent.id,peer.id]}),{status:409});
 assert.throws(()=>office.commentTask(manual.id,{text:'请回复',mentions:['agent:'+agent.id]}),{status:400});
 office.commentTask(manual.id,{text:'@负责人 请回复'});
 t.mock.timers.tick(60_001);office.dispatchScheduled();
 assert.equal(office.taskDetail(timed.id).runs.length,0);
 assert.equal(store.list('run').length,1);
 assert.equal(store.get('run',queued.id).agent.authorization.execution,true);
 const restored=office.saveAgent({...disabled,authorization:{execution:true}});
 assert.equal(restored.permissions.delegation,true);
 office.dispatchScheduled();assert.equal(office.taskDetail(timed.id).runs.length,1);
});

test('Legacy permission updates remain supported and malformed authorization is rejected',t=>{
 const {office}=setup(t);
 const agent=office.saveAgent({name:'负责人',role:'lead',runtime:'codex'});
 const {authorization,...legacy}=agent;
 const changed=office.saveAgent({...legacy,permissions:{comments:false},sandbox:'workspace-write'});
 assert.equal(changed.authorization.tools.comments,false);assert.equal(changed.sandbox,'workspace-write');
 for(const invalid of [null,[],{execution:'true'},{root:true},{tools:{delegation:'true'}},{tools:{unknown:true}},{sandbox:'unrestricted'},{mcpServerIds:['missing']}]) {
   assert.throws(()=>office.saveAgent({...changed,authorization:invalid}));
 }
});

test('Per-agent permissions filter tool definitions and reject direct calls, leaving other staff independent',t=>{
 const {store,office}=setup(t);
 const lead=office.saveAgent({name:'受限负责人',role:'lead',runtime:'codex',permissions:{delegation:false,comments:false,discussions:false}});
 const task=office.saveTask({title:'测试权限',assigneeId:lead.id});
 const run=office.startRun(office.enqueueTask(task.id).id);
 const tools=companyTools(store,office,run);
 for(const name of ['office_create_task','office_start_subtask','office_post_comment','office_start_discussion']) {
   assert.ok(!tools.definitions.some(tool=>tool.name===name));
   assert.equal(tools.call({callId:name,tool:name,arguments:{}}).success,false);
 }
 assert.ok(tools.definitions.some(tool=>tool.name==='office_task_discussion'));
 const other=office.saveAgent({name:'其他负责人',role:'lead',runtime:'codex'});
 assert.equal(other.permissions.delegation,true);
 const renamed=office.saveAgent({...lead,name:'新名称'});
 assert.equal(renamed.permissions.delegation,false);
});

test('Permission changes affect new run snapshots and reject stale writes and invalid permission values',t=>{
 const {store,office}=setup(t);
 const agent=office.saveAgent({name:'负责人',role:'lead',runtime:'codex',sandbox:'workspace-write'});
 const task=office.saveTask({title:'已排队',assigneeId:agent.id});const before=office.enqueueTask(task.id);
 const changed=office.saveAgent({...agent,expectedVersion:agent.version,authorization:{...agent.authorization,sandbox:'read-only',tools:{...agent.authorization.tools,delegation:false}}});
 assert.equal(store.get('run',before.id).agent.permissions.delegation,true);
 assert.equal(store.get('run',before.id).agent.sandbox,'workspace-write');
 const second=office.saveTask({title:'新任务',assigneeId:agent.id});const next=office.enqueueTask(second.id);
 assert.equal(next.agent.permissions.delegation,false);assert.equal(next.agent.sandbox,'read-only');
 assert.throws(()=>office.saveAgent({...agent,expectedVersion:agent.version}),{status:409});
 assert.throws(()=>office.saveAgent({...changed,permissions:{comments:'false'}}),{status:400});
 assert.throws(()=>office.saveAgent({...changed,permissions:{root:true}}),{status:400});
});

test('Role and runtime constraints cannot be bypassed with permission flags',t=>{
 const {office}=setup(t);
 const worker=office.saveAgent({name:'研发',role:'worker',runtime:'codex',permissions:{delegation:true,hiring:true,budgets:true}});
 assert.equal(worker.permissions.delegation,false);assert.equal(worker.permissions.hiring,false);assert.equal(worker.permissions.budgets,false);
 const hr=office.saveAgent({name:'人事',role:'hr',runtime:'codex',sandbox:'workspace-write',permissions:{hiring:false}});
 assert.equal(hr.sandbox,'read-only');assert.equal(hr.permissions.hiring,false);
 const pi=office.saveAgent({name:'Pi',role:'lead',runtime:'pi',permissions:{delegation:true,comments:false}});
 assert.equal(pi.permissions.delegation,false);assert.equal(pi.permissions.comments,false);
 assert.ok(Object.values(effectiveAgentPermissions({role:'lead',runtime:'observed'})).every(value=>value===false));
 assert.equal(effectiveAgentPermissions({role:'lead',runtime:'codex'}).delegation,true);
});
