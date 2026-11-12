import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { createSettings } from '../src/settings.js';

function setup(t, options) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const settings = createSettings(store, options);
  return {store, settings, office: createOffice(store, settings)};
}

test('Legacy tasks gain stable numbers and new runs receive workspace context and configured reservation', t => {
  const {store, settings, office} = setup(t, {concurrencyOverride: 4});
  store.tx(() => store.put('task', {id: 'legacy', title: 'Legacy task'}));
  settings.backfillTaskNumbers();
  settings.backfillTaskNumbers();
  const workspace = {...settings.read('workspace'), name: '研发', taskPrefix: 'dev', context: 'Use design tokens.'};
  settings.save('workspace', workspace);
  settings.save('workflow', {...settings.read('workflow'), defaultPriority: 'high'});
  settings.save('runtime', {...settings.runtime(), concurrency: 2, reserve: 1234});
  const agent = office.saveAgent({name: 'Worker'});
  const task = office.saveTask({title: 'UI update', assigneeId: agent.id, dueDate: '2026-11-20'});
  const run = office.enqueueTask(task.id);
  assert.equal(store.get('task', 'legacy').number, 1);
  assert.equal(task.number, 2);
  assert.equal(task.priority, 'high');
  assert.equal(settings.runtime().concurrency, 4);
  assert.equal(run.reserve, 1234);
  assert.equal(run.workspaceContext, 'Use design tokens.');
  assert.match(run.prompt, /DEV-2.*UI update/);
  assert.match(run.prompt, /2026-11-20/);
  const comment = office.commentTask(task.id, {text: '请检查暗色模式'});
  assert.equal(comment.author, workspace.operator);
  assert.deepEqual(office.taskDetail(task.id).comments, [comment]);
});

test('Archiving task classification keeps historical values and blocks new assignments', t => {
  const {settings, office} = setup(t);
  const label = settings.saveCatalogue('label', {name: '客户反馈', color: 'blue'});
  const property = settings.saveCatalogue('property', {name: '平台', type: 'select', options: ['Web', 'Desktop']});
  const task = office.saveTask({title: '反馈', labelIds: [label.id], properties: {[property.id]: 'Web'}});
  assert.throws(() => settings.saveCatalogue('property', {...property, options: ['Desktop']}), {status: 409});
  settings.archive('label', label.id, true);
  settings.archive('property', property.id, true);
  const edited = office.saveTask({id: task.id, title: '跟进反馈', labelIds: []});
  assert.deepEqual(edited.labelIds, [label.id]);
  assert.deepEqual(edited.properties, {[property.id]: 'Web'});
  assert.throws(() => office.saveTask({title: 'New', labelIds: [label.id]}), {status: 400});
  assert.throws(() => office.saveTask({title: 'New', properties: {[property.id]: 'Web'}}), {status: 400});
});

test('The board adds planning and cancellation while preserving saved workflow names and run gates', t => {
  const {store, settings, office} = setup(t);
  store.tx(() => store.put('setting', {
    id: 'workflow', value: {names: {todo: '自定义待办'}, defaultPriority: 'medium'},
  }));
  const {names} = settings.read('workflow');
  assert.deepEqual(Object.keys(names), ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'cancelled']);
  assert.equal(names.todo, '自定义待办');
  assert.equal(names.backlog, '待规划');
  assert.equal(names.cancelled, '已取消');
  const agent = office.saveAgent({name: '执行员工', runtime: 'demo'});
  const task = office.saveTask({title: '测试任务', assigneeId: agent.id, dueDate: '2026-11-20'});
  const edited = office.taskPriority(task.id, 'urgent');
  assert.equal(edited.priority, 'urgent');
  assert.equal(edited.dueDate, task.dueDate);
  assert.equal(edited.assigneeId, agent.id);
  assert.equal(office.taskStatus(task.id, 'backlog').status, 'backlog');
  assert.throws(() => office.enqueueTask(task.id), {status: 409});
  office.taskStatus(task.id, 'todo');
  const run = office.enqueueTask(task.id);
  assert.throws(() => office.taskPriority(task.id, 'low'), {status: 409});
  assert.throws(() => office.taskStatus(task.id, 'cancelled'), {status: 409});
  office.stop(run.id);
  assert.equal(store.get('task', task.id).status, 'todo');
  assert.equal(office.taskStatus(task.id, 'cancelled').status, 'cancelled');
  assert.throws(() => office.enqueueTask(task.id), {status: 409});
  assert.equal(office.taskStatus(task.id, 'todo').status, 'todo');
});

test('Inbox distinguishes relevant statuses and leaves events newer than the displayed cursor unread', t => {
  const {store, settings} = setup(t);
  store.tx(() => {
    store.event('task.status', {status: 'done'});
    store.event('machine.status', {status: 'online'});
    store.event('task.status', {status: 'review'});
  });
  const first = settings.inbox();
  assert.equal(first.unread, 1);
  assert.equal(first.events.length, 1);
  store.tx(() => store.event('run.failed', {error: 'Example'}));
  settings.markInboxRead(first.events[0].seq);
  assert.equal(settings.inbox().unread, 1);
  settings.save('notifications', {...settings.read('notifications'), failures: false});
  assert.equal(settings.inbox().unread, 0);
  assert.equal(settings.inbox().events.length, 1);
  assert.equal(store.audit()[0].type, 'settings.updated');
});
