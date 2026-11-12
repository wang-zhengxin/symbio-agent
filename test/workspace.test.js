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
  for (let i=1; i<12; i++) assert.equal(office.saveAgent({name:'Agent ' + i,runtime:'demo'}).seatIndex,i);
  assert.equal(workspace.snapshot().workstationCount,12);
  const hire = workspace.saveHuman({name:'新员工',title:'工程师'});
  assert.equal(hire.seatIndex,12);
  assert.equal(workspace.snapshot().workstationCount,13);
  assert.equal(addWorkstations(store,{amount:2}).count,15);
  assert.equal(office.saveAgent({name:'新 Agent',runtime:'demo'}).seatIndex,13);
  assert.equal(workspace.snapshot().workstationCount,15);
  assert.equal(workspace.saveHuman({...legacy,title:'产品设计师'}).seatIndex,0);
});
