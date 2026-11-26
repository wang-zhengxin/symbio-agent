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

test('Deleting labels and custom properties strips task references and logs audit events', t => {
  const {store, settings, office} = setup(t);
  const keepLabel = settings.saveCatalogue('label', {name: '保留标签', color: 'green'});
  const dropLabel = settings.saveCatalogue('label', {name: '待删标签', color: 'red'});
  const keepProp = settings.saveCatalogue('property', {name: '保留字段', type: 'text'});
  const dropProp = settings.saveCatalogue('property', {name: '待删字段', type: 'select', options: ['A', 'B']});
  const task = office.saveTask({
    title: '清理测试',
    labelIds: [keepLabel.id, dropLabel.id],
    properties: {[keepProp.id]: 'ok', [dropProp.id]: 'A'},
  });
  settings.removeCatalogue('label', dropLabel.id);
  settings.removeCatalogue('property', dropProp.id);
  assert.equal(store.get('label', dropLabel.id), undefined);
  assert.equal(store.get('property', dropProp.id), undefined);
  const updatedTask = store.get('task', task.id);
  assert.deepEqual(updatedTask.labelIds, [keepLabel.id]);
  assert.deepEqual(updatedTask.properties, {[keepProp.id]: 'ok'});
  const auditTypes = store.audit().map(event => event.type);
  assert.equal(auditTypes.filter(type => type === 'catalogue.deleted').length, 2);
  assert.throws(() => settings.removeCatalogue('label', dropLabel.id), {status: 404});
});

test('Deleting teams, skills, and MCP servers cascades cleanup across agents, humans, layout, and budgets', async t => {
  const {createWorkspace} = await import('../src/workspace.js');
  const {store, office} = setup(t);
  const workspace = createWorkspace(store);
  const team = office.saveNamed('team', {name: '核心小队'});
  const keepSkill = office.saveNamed('skill', {name: '保留技能'});
  const dropSkill = office.saveNamed('skill', {name: '待删技能'});
  const mcp = office.saveMcpServer({name: '本地检索', transport: 'http', url: 'https://example.com/mcp', tools: 'search', enabled: true});
  const agent = office.saveAgent({
    name: '小王',
    runtime: 'codex',
    teamId: team.id,
    skillIds: [keepSkill.id, dropSkill.id],
    authorization: {execution: true, sandbox: 'read-only', mcpServerIds: [mcp.id]},
  });
  const human = workspace.saveHuman({name: '李四', title: '产品', teamId: team.id});
  const currentLayout = workspace.snapshot().layout;
  const assignedDraft = {...currentLayout.draft, zones: currentLayout.draft.zones.map((z, idx) => idx === 0 ? {...z, teamId: team.id} : z)};
  workspace.saveLayout({revision: currentLayout.revision, draft: assignedDraft}, true);
  office.setBudget({scope: 'team', targetId: team.id, limit: 50_000});

  office.deleteTeam(team.id);
  office.deleteSkill(dropSkill.id);
  office.deleteMcpServer(mcp.id);

  assert.equal(store.get('team', team.id), undefined);
  assert.equal(store.get('budget', 'team:' + team.id), undefined);
  assert.equal(store.get('skill', dropSkill.id), undefined);
  assert.equal(store.get('mcpServer', mcp.id), undefined);

  const afterAgent = store.get('agent', agent.id);
  assert.equal(afterAgent.teamId, null);
  assert.deepEqual(afterAgent.skillIds, [keepSkill.id]);
  assert.deepEqual(afterAgent.mcpServerIds, []);
  assert.deepEqual(afterAgent.authorization.mcpServerIds, []);

  assert.equal(store.get('human', human.id).teamId, null);
  const afterLayout = workspace.snapshot().layout;
  assert.equal(afterLayout.draft.zones[0].teamId, null);
  assert.equal(afterLayout.published.zones[0].teamId, null);

  const auditTypes = store.audit().map(event => event.type);
  assert.ok(auditTypes.includes('team.deleted'));
  assert.ok(auditTypes.includes('skill.deleted'));
  assert.ok(auditTypes.includes('mcp.deleted'));

  assert.throws(() => office.deleteTeam(team.id), {status: 404});
  assert.throws(() => office.deleteSkill(dropSkill.id), {status: 404});
  assert.throws(() => office.deleteMcpServer(mcp.id), {status: 404});
});
