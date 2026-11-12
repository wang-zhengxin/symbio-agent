import assert from 'node:assert/strict';
import test from 'node:test';
import { companyTools } from '../src/company-tools.js';
import { createMentionEmailDelivery } from '../src/mention-email.js';
import { createOffice } from '../src/office.js';
import { createSettings } from '../src/settings.js';
import { openStore } from '../src/store.js';

test('Timed dispatch waits for its dependencies and creates exactly one run', t => {
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-01-01T12:00:00Z')});
  const store = openStore(':memory:');
  t.after(() => store.close());
  const office = createOffice(store);
  const agent = office.saveAgent({name:'定时执行', runtime:'demo'});
  const prior = office.saveTask({title:'前置', assigneeId:agent.id});
  const task = office.saveTask({title:'定时任务', assigneeId:agent.id, dependencyIds:[prior.id],
    scheduledAt:'2026-01-01T12:01:00Z'});
  assert.throws(() => office.enqueueTask(task.id), /指定时间/);
  t.mock.timers.tick(60_001);
  office.dispatchScheduled();
  assert.equal(office.taskDetail(task.id).runs.length, 0);
  const run = office.enqueueTask(prior.id);
  office.startRun(run.id);
  office.finish(run.id, 'completed');
  office.taskStatus(prior.id, 'done');
  office.setAgentPaused(agent.id, true);
  office.dispatchScheduled();
  assert.equal(office.taskDetail(task.id).runs.length, 0);
  office.setAgentPaused(agent.id, false);
  office.dispatchScheduled();
  office.dispatchScheduled();
  assert.equal(office.taskDetail(task.id).runs.length, 1);
  const scheduled = office.taskDetail(task.id).task;
  assert.ok(scheduled.scheduleStartedAt);
  office.stop(scheduled.lastRunId);
  office.dispatchScheduled();
  assert.equal(office.taskDetail(task.id).runs.length, 1);
});

test('A running lead can split work and exchange scoped threaded replies without advancing the task', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const settings = createSettings(store);
  const office = createOffice(store, settings);
  const lead = office.saveAgent({name:'项目负责人', role:'lead'});
  const peer = office.saveAgent({name:'复核员', runtime:'pi'});
  const project = office.saveNamed('project', {name:'项目'});
  const parent = office.saveTask({title:'主任务', projectId:project.id, assigneeId:lead.id});
  const run = office.enqueueTask(parent.id);
  office.startRun(run.id);
  const tools = companyTools(store, office, run);
  function tool(name, args, callId = name) {
    const response = tools.call({callId, tool:name, arguments:args});
    assert.ok(response.success, response.contentItems[0].text);
    return JSON.parse(response.contentItems[0].text);
  }
  const child = tool('office_create_task', {title:'子任务', description:'核对', acceptance:'通过', assigneeId:peer.id});
  assert.equal(child.parentId, parent.id);
  assert.equal(child.projectId, project.id);
  assert.deepEqual(office.taskDetail(parent.id).subtasks.map(task => task.id), [child.id]);
  assert.throws(() => office.saveTask({title:'循环子任务', parentId:parent.id, dependencyIds:[parent.id]}), /父任务/);
  const comment = tool('office_post_comment', {text:'@管理员 @复核员 请确认进展'});
  assert.equal(tool('office_post_comment', {text:'重复提交'}).id, comment.id);
  assert.equal(comment.author, lead.name);
  assert.equal(settings.inbox().events[0].type, 'task.mention');
  assert.throws(() => office.commentTask(child.id, {text:'无效回复', replyToId:comment.id}), {status:404});
  const human = office.commentTask(parent.id, {text:'请补充边界', replyToId:comment.id, mentions:['agent:' + peer.id]});
  assert.equal(human.threadId, comment.id);
  const replyRun = office.startRun(human.responseRunIds[0]);
  assert.equal(replyRun.kind, 'comment');
  assert.equal(companyTools(store, office, replyRun).definitions.length, 0);
  office.report(replyRun.id, 'message.final', {text:'已补充。 @项目负责人'});
  office.finish(replyRun.id, 'completed');
  office.finish(replyRun.id, 'completed');
  const detail = office.taskDetail(parent.id);
  const reply = detail.comments.at(-1);
  assert.equal(reply.replyToId, human.id);
  assert.equal(reply.threadId, comment.id);
  assert.equal(reply.author, peer.name);
  assert.equal(reply.responseRunIds.length, 0);
  assert.equal(detail.task.lastRunId, run.id);
  assert.equal(detail.task.status, 'in_progress');
  assert.equal(settings.inbox().events[0].payload.id, reply.id);
  assert.equal(tool('office_task_discussion', {}).comments.at(-1).id, reply.id);
  const childRun = tool('office_start_subtask', {taskId:child.id});
  office.finish(run.id, 'completed');
  assert.throws(() => office.taskStatus(parent.id, 'done'), {status:409});
  office.stop(childRun.id);
  office.taskStatus(child.id, 'cancelled');
  assert.equal(office.taskStatus(parent.id, 'done').status, 'done');
});

test('Comment emails honor both preferences while all explicit recipients keep their inbox mentions', async t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const settings = createSettings(store);
  const office = createOffice(store, settings);
  const task = office.saveTask({title:'任务'});
  const author = {id:'author', name:'发布者', status:'active'};
  const optedIn = {id:'opted-in', name:'收件人', status:'active', email:'enabled@example.com', mentionEmail:true};
  const optedOut = {id:'opted-out', name:'关闭通知', status:'active', email:'disabled@example.com'};
  const unbound = {id:'unbound', name:'旧账号', status:'active', mentionEmail:true};
  store.tx(() => {
    for (const user of [author, optedIn, optedOut, unbound]) store.put('user', user);
  });
  const silent = office.commentTask(task.id, {text:'@收件人 仅站内通知', emailMentions:false}, null, author);
  assert.equal(store.list('mention-email').length, 0);
  assert.equal(settings.inbox(true, optedIn).events[0].payload.id, silent.id);
  const comment = office.commentTask(task.id, {text:'@收件人 @关闭通知 @旧账号 请检查', mentions:['user:opted-in']}, null, author);
  assert.equal(store.list('mention-email').length, 1);
  for (const user of [optedIn, optedOut, unbound]) {
    assert.equal(settings.inbox(true, user).events[0].payload.id, comment.id);
  }
  const sent = [];
  const delivery = createMentionEmailDelivery(store, async (email, message) => sent.push({email, ...message}), 'http://127.0.0.1:4317');
  await delivery.wake();
  await delivery.wake();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, optedIn.email);
  assert.equal(sent[0].comment.text, comment.text);
  assert.equal(sent[0].url, `http://127.0.0.1:4317/office#tasks/all/${task.id}/${comment.id}`);
  assert.equal(store.list('mention-email').length, 0);
});
