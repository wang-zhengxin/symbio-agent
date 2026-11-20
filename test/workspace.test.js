import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore } from '../src/store.js';
import { createWorkspace } from '../src/workspace.js';
import { createOffice } from '../src/office.js';
import { addWorkstations, backfillWorkstations } from '../src/workstations.js';

test('Layout drafts stay private to the editor until publication, and stale writes cannot overwrite them', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const initial = workspace.snapshot().layout;
  const draft = structuredClone(initial.draft);
  draft.zones[0].name = '异步协作区';
  draft.zones[0].x = 24;
  draft.widgets.activity = false;
  const saved = workspace.saveLayout({revision: initial.revision, draft}, false);
  assert.equal(workspace.snapshot().layout.published, null);
  assert.throws(() => workspace.saveLayout({revision: initial.revision, draft}, true), {status: 409});
  const published = workspace.saveLayout({revision: saved.revision, draft}, true);
  draft.zones[0].name = '仍是草稿';
  workspace.saveLayout({revision: published.revision, draft}, false);
  const {layout} = workspace.snapshot();
  assert.equal(layout.published.zones[0].name, '异步协作区');
  assert.equal(layout.published.zones[0].x, 24);
  assert.equal(layout.published.widgets.activity, false);
  assert.equal(layout.draft.zones[0].name, '仍是草稿');
});

test('A human assignment can progress without an Agent run and is preserved during task edits', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const office = createOffice(store);
  const employee = workspace.saveHuman({name: '林远', title: '产品负责人'});
  const task = office.saveTask({title: '确认设计范围', humanId: employee.id});
  const edited = office.saveTask({id: task.id, title: '复核设计范围'});
  assert.equal(edited.humanId, employee.id);
  assert.equal(office.taskStatus(task.id, 'in_progress').status, 'in_progress');
  assert.equal(office.taskStatus(task.id, 'review').status, 'review');
  assert.equal(office.taskStatus(task.id, 'done').status, 'done');
  assert.equal(store.list('run').length, 0);
});

test('Human and Agent profiles retain a selected avatar across edits by older clients', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const office = createOffice(store);
  const human = workspace.saveHuman({name:'林远', title:'产品负责人', avatarId:'analyst'});
  const agent = office.saveAgent({name:'研发', runtime:'demo', avatarId:'engineer'});
  assert.equal(workspace.saveHuman({id:human.id,name:human.name,title:'项目经理'}).avatarId,'analyst');
  assert.equal(office.saveAgent({id:agent.id,name:agent.name,runtime:agent.runtime}).avatarId,'engineer');
  assert.throws(() => office.saveAgent({name:'研发',avatarId:'missing'}), {status:400});
  assert.throws(() => workspace.saveHuman({name:'林远',title:'项目经理',avatarId:'missing'}), {status:400});
});

test('Existing staff and new hires keep unique desks as the shared layout expands', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const office = createOffice(store);
  store.tx(() => store.put('human',{id:'legacy',name:'老员工',title:'设计师'}));
  backfillWorkstations(store);
  const legacy = workspace.snapshot().humans[0];
  assert.equal(legacy.seatIndex,0);
  for (let i=1; i<12; i++) assert.equal(office.saveAgent({name:'Agent ' + i,runtime:'demo'}).seatIndex,i < 11 ? i : i+1);
  assert.equal(workspace.snapshot().workstationCount,13);
  const hire = workspace.saveHuman({name:'新员工',title:'工程师'});
  assert.equal(hire.seatIndex,13);
  assert.equal(workspace.snapshot().workstationCount,14);
  assert.equal(addWorkstations(store,{amount:2}).count,16);
  assert.equal(office.saveAgent({name:'新 Agent',runtime:'demo'}).seatIndex,14);
  assert.equal(workspace.snapshot().workstationCount,16);
  assert.equal(workspace.saveHuman({...legacy,title:'产品设计师'}).seatIndex,0);
});


test('Administrator profiles bind once, reuse matching email, and keep the private office reserved', t => {
  const store = openStore(':memory:');t.after(()=>store.close());
  const workspace = createWorkspace(store);
  const legacy = workspace.saveHuman({name:'旧名字',title:'管理员',email:'boss@example.test'});
  const user = {id:'admin-one',name:'老板账号',role:'admin',email:'boss@example.test'};
  const boss = workspace.ensureAdministrator(user);
  assert.equal(boss.id,legacy.id);
  assert.equal(boss.userId,user.id);
  assert.equal(boss.officeRole,'boss');
  const cursor = store.cursor();
  workspace.ensureAdministrator(user);
  assert.equal(store.cursor(),cursor);
  assert.equal(workspace.snapshot().humans.length,1);
  workspace.ensureAdministrator({...user,name:'新名字'});
  assert.equal(workspace.snapshot().humans[0].name,'新名字');
  workspace.ensureAdministrator({...user,id:'member',role:'member'});
  assert.equal(workspace.snapshot().humans.length,1);
  assert.equal(workspace.saveHuman({...boss,title:'老板'}).userId,user.id);
  store.tx(()=>store.put('agent',{id:'old-seat',name:'旧工位',seatIndex:11}));
  backfillWorkstations(store);
  assert.notEqual(store.get('agent','old-seat').seatIndex,11);
});

test('Clearing initialized staff does not recreate demo employees on restart', t => {
  const store=openStore(':memory:');t.after(()=>store.close());
  const office=createOffice(store);
  office.seed();
  assert.equal(store.list('agent').length,5);
  const teams=store.list('team').length, skills=store.list('skill').length;
  store.tx(()=>{for(const person of store.list('agent'))store.remove('agent',person.id);});
  createOffice(store).seed();
  assert.equal(store.list('agent').length,0);
  assert.equal(store.list('team').length,teams);
  assert.equal(store.list('skill').length,skills);
});
