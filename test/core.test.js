import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { companyTools } from '../src/company-tools.js';
import { runTrace } from '../src/run-trace.js';

function setup(t) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const office = createOffice(store);
  const create = (name, role = 'worker', runtime = 'codex') => office.saveAgent({name, role, runtime});
  const task = agent => office.saveTask({title: '任务', assigneeId: agent.id});
  return {store, office, create, task};
}

test('Failed transactions neither persist nor publish events; successful void transactions publish after commit', t => {
  const {store} = setup(t);
  const events = [];
  store.stream.on('event', event => {
    assert.equal(store.cursor(), event.seq);
    events.push(event);
  });
  assert.throws(() => store.tx(() => {
    store.put('task', {id: 'x'});
    store.event('task.saved', {});
    throw new Error('rollback');
  }), /rollback/);
  assert.equal(store.get('task', 'x'), undefined);
  assert.deepEqual(store.since(0), []);
  store.tx(() => {
    store.put('task', {id: 'y'});
    store.event('task.saved', {});
  });
  assert.deepEqual(events, store.since(0));
});

test('Concurrent token reservations share company balance and cumulative usage is idempotent', t => {
  const {office, create, task} = setup(t);
  office.setBudget({scope: 'company', limit: 100});
  const a = office.enqueueTask(task(create('A', 'worker', 'pi')).id, 60);
  const b = office.enqueueTask(task(create('B')).id, 50);
  assert.equal(office.startRun(a.id).status, 'running');
  assert.equal(office.startRun(b.id).status, 'failed');
  assert.equal(office.ledger()[0].unknown, 0);
  office.report(a.id, 'usage.updated', {totalTokens: 20});
  office.report(a.id, 'usage.updated', {totalTokens: 20});
  office.report(a.id, 'usage.updated', {totalTokens: 10});
  assert.deepEqual(office.ledger()[0], {
    scope: 'company', id: 'local', limit: 100, spent: 20, reserved: 40, available: 40, unknown: 0,
  });
  office.finish(a.id, 'completed');
  assert.equal(office.ledger()[0].available, 80);
  assert.equal(office.snapshot().tasks.find(task => task.id === a.taskId).status, 'review');
});

test('Pi JSONL forwards text and usage, while a failed assistant response stays failed', async t => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const {piRuntime} = await import('../src/runtimes.js');
  const cwd = await mkdtemp(join(tmpdir(), 'office-pi-protocol-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const executable = join(cwd, 'test-pi.cjs');
  const extension = join(cwd, 'test-provider.mjs');
  await writeFile(extension, 'export default function () {}');
  await writeFile(executable, [
    '#!/usr/bin/env node',
    "const {readFileSync} = require('node:fs');",
    "const args = process.argv.slice(2);",
    "if (!['--no-tools', '--no-extensions', '--no-mcp'].every(flag => args.includes(flag))) process.exit(3);",
    "if (!readFileSync(args[args.indexOf('--append-system-prompt') + 1], 'utf8').includes('工作风格：精确')) process.exit(4);",
    "const prompt = readFileSync(0, 'utf8');",
    "const failed = prompt === 'fail';",
    "const extensions = args.filter(arg => arg === '--extension');",
    "if (extensions.length !== (failed ? 0 : 1)) process.exit(5);",
    "if (!failed && !args[args.indexOf('--extension') + 1].endsWith('/test-provider.mjs')) process.exit(6);",
    "const send = event => process.stdout.write(JSON.stringify(event) + '\\n');",
    "const result = '已核对' + String.fromCodePoint(0x2028) + '交付';",
    "const text = prompt === 'comment' ? result + '\\nOFFICE_COMMENT ' + JSON.stringify({text:'@管理员 需要确认'}) : result;",
    "send({type:'turn_start'});",
    "send({type:'message_update', assistantMessageEvent:{type:'text_delta', delta:text}});",
    "send({type:'message_end', message:{role:'assistant', stopReason:failed?'error':'stop',",
    "  errorMessage:failed?'模型断开':undefined, content:[{type:'text',text}],",
    "  usage:{input:9, output:3, cacheRead:2, cacheWrite:1, totalTokens:15}}});",
  ].join('\n'), {mode: 0o700});
  const agent = {name:'Pi 测试', role:'worker', personality:'精确', skills:[]};
  const events = [];
  const run = (prompt, piProviderExtension, tools) => piRuntime({
    cwd, executable, piProviderExtension, tools, run:{agent,prompt,kind:'task'}, signal:new AbortController().signal,
    emit:(type, payload) => events.push({type, payload}),
  });
  await run('pass', extension);
  assert.equal(events.find(event => event.type === 'message.delta').payload.text, '已核对\u2028交付');
  assert.deepEqual(events.find(event => event.type === 'usage.updated').payload, {
    totalTokens:15, inputTokens:9, outputTokens:3, cachedInputTokens:2, cacheWriteInputTokens:1,
  });
  assert.equal(events.at(-1).type, 'message.final');
  assert.equal(events.filter(event => event.type === 'runtime.first_output').length, 1);
  assert.equal(events[0].type, 'runtime.input');
  events.length = 0;
  const calls = [];
  await run('comment', extension, {call:input => { calls.push(input); return {success:true}; }});
  assert.deepEqual(calls, [{callId:'pi-comment-1', tool:'office_post_comment', arguments:{text:'@管理员 需要确认'}}]);
  assert.equal(events.at(-1).payload.text, '已核对\u2028交付');
  events.length = 0;
  await assert.rejects(run('fail'), /模型断开/);
  assert.equal(events.some(event => event.type === 'message.final'), false);
  await assert.rejects(run('pass', './test-provider.mjs'), /绝对路径/);
  await assert.rejects(run('pass', join(cwd, 'missing.mjs')), /入口文件不可用/);
});

test('Execution traces preserve queued prompts, recover old milestones and pair tool durations', t => {
  const {store, office} = setup(t);
  const agent = office.saveAgent({name: '复核员', runtime: 'pi', personality: '逐字核对', scope: '验证交付'});
  const task = office.saveTask({title: '复核', assigneeId: agent.id, description: '测试 ya29.TEST_TOKEN_FOR_REDACTION'});
  const run = office.enqueueTask(task.id);
  office.saveAgent({...agent, personality: '修改后的配置'});
  assert.match(run.instructions, /逐字核对/);
  assert.doesNotMatch(run.instructions, /office 工具/);
  assert.doesNotMatch(runTrace(run, store.runObservations(run.id)).prompt.input, /TEST_TOKEN/);
  office.startRun(run.id);
  office.report(run.id, 'run.activity', {label: '等待 Pi 模型响应'});
  office.report(run.id, 'tool.started', {id: 'check', label: '核验'});
  office.report(run.id, 'tool.completed', {id: 'check', label: '核验', exitCode: 0});
  office.report(run.id, 'message.delta', {text: '首次输出'});
  store.tx(() => {
    for (let index = 0; index < 301; index++) store.event('message.delta', {text: '后续'}, run);
  });
  const finished = office.finish(run.id, 'completed');
  const observations = store.runObservations(run.id);
  const legacy = {...finished};
  delete legacy.instructions;
  const trace = runTrace(legacy, observations);
  assert.equal(store.timeline(run.id).some(event => event.type === 'tool.started'), false);
  assert.equal(trace.prompt.reconstructed, true);
  assert.match(trace.prompt.instructions, /逐字核对/);
  assert.deepEqual(trace.stages.map(stage => stage.label),
    ['排队', '启动至运行器回合', '等待首段可见文本', '输出至结束']);
  assert.ok(trace.tools[0].start <= trace.tools[0].end);
  assert.equal(trace.tools[0].status, 'completed');
  assert.equal(trace.tools[0].exitCode, 0);
});

test('Third participant joins the current round; closing stops the outstanding turn', t => {
  const {office, store, create} = setup(t);
  const [a,b,c] = ['A','B','C'].map(name => create(name, 'worker', 'demo'));
  const discussion = office.startConversation({topic: '接口评审', participantIds: [a.id,b.id]});
  assert.equal(discussion.mode, 'face_to_face');
  office.startRun(discussion.currentRunId);
  const meeting = office.updateConversation(discussion.id, 'add', {agentId: c.id});
  assert.equal(meeting.currentRunId, discussion.currentRunId);
  assert.equal(meeting.mode, 'meeting_room');
  office.report(discussion.currentRunId, 'message.final', {text: 'A 的建议'});
  office.finish(discussion.currentRunId, 'completed');
  const current = store.get('conversation', discussion.id);
  assert.equal(store.get('run', current.currentRunId).agentId, b.id);
  const closed = office.updateConversation(discussion.id, 'close', {});
  assert.equal(closed.currentRunId, null);
  assert.equal(closed.status, 'closed');
  assert.equal(store.get('run', current.currentRunId).status, 'cancelled');
  assert.equal(store.list('run').length, 2);
});

test('Company tools enforce role boundaries and replay one mutation for a repeated call id', t => {
  const {office, store, create, task} = setup(t);
  const hr = create('人事', 'hr');
  const run = office.startRun(office.enqueueTask(task(hr).id).id);
  const tools = companyTools(store, office, run);
  const request = {
    callId: 'create-1', tool: 'office_hire',
    arguments: {name: '工程师', scope: '实现功能', personality: '简洁', role: 'finance', sandbox: 'workspace-write'},
  };
  const result = tools.call(request);
  assert.equal(result.success, true);
  assert.deepEqual(tools.call(request), result);
  const employees = store.list('agent');
  assert.equal(employees.length, 2);
  assert.equal(employees[1].role, 'worker');
  assert.equal(employees[1].sandbox, 'read-only');
  assert.equal(tools.call({callId: 'finance-1', tool: 'office_set_budget', arguments: {}}).success, false);
  office.stop(run.id);
  assert.equal(tools.call({...request, callId: 'after-stop'}).success, false);
});

test('Codex protocol translates streamed activities and accounts a real-shaped tool response', async t => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const {createScheduler} = await import('../src/scheduler.js');
  const {store, office, create, task} = setup(t);
  const data = await mkdtemp(join(tmpdir(), 'office-protocol-'));
  const executable = join(data, 'mock-codex');
  await writeFile(executable, `#!/usr/bin/env node
const {createInterface} = require('node:readline');
const lines = createInterface({input: process.stdin});
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const notify = (method, params) => send({method, params: {threadId: 'thread', turnId: 'turn', ...params}});
const item = {id:'tool-item', type:'dynamicToolCall', tool:'office_hire'};
lines.on('line', line => {
  const {id, method, params, result} = JSON.parse(line);
  if (method === 'initialize') send({id, result:{}});
  if (method === 'thread/start') {
    if (!params.dynamicTools.some(spec => spec.name === 'office_hire')) process.exit(2);
    if (!params.developerInstructions.includes('本地 Agent 公司员工 人事')) process.exit(4);
    send({id, result:{thread:{id:'thread'}}});
  }
  if (method === 'turn/start') {
    send({id, result:{turn:{id:'turn'}}});
    notify('turn/started', {turn:{id:'turn'}});
    notify('item/started', {item});
    send({id:'invoke', method:'item/tool/call', params:{threadId:'thread', turnId:'turn',
      callId:'call', tool:'office_hire', arguments:{name:'协议员工', personality:'简洁', scope:'测试'}}});
  }
  if (id === 'invoke') {
    if (!result?.success) process.exit(3);
    notify('item/completed', {item:{...item, status:'completed'}});
    notify('item/agentMessage/delta', {delta:'已创建'});
    notify('item/completed', {item:{id:'answer', type:'agentMessage', phase:'final_answer', text:'已创建员工'}});
    notify('turn/completed', {turn:{id:'turn', status:'completed'}});
    notify('thread/tokenUsage/updated', {tokenUsage:{total:{totalTokens:42, inputTokens:30, outputTokens:12}}});
  }
});
`, {mode: 0o700});
  const scheduler = createScheduler({store, office, data, concurrency: 1, executable});
  // Run cleanup before setup's database cleanup.
  try {
    const run = office.enqueueTask(task(create('人事', 'hr')).id);
    const result = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('protocol timeout')), 5000);
      store.stream.on('event', event => {
        if (event.run_id !== run.id || !['run.completed', 'run.failed'].includes(event.type)) return;
        clearTimeout(deadline);
        resolve(store.get('run', run.id));
      });
    });
    assert.equal(result.status, 'completed', result.error);
    assert.equal(result.output, '已创建员工');
    assert.equal(office.ledger()[0].spent, 42);
    assert.equal(store.list('agent').at(-1).name, '协议员工');
    assert.deepEqual(store.timeline(run.id).filter(event => event.type.startsWith('tool.')).map(event => event.type),
      ['tool.started', 'tool.completed']);
    const trace = runTrace(result, store.runObservations(run.id));
    assert.equal(trace.prompt.reconstructed, false);
    assert.equal(trace.prompt.instructions, result.instructions);
    assert.ok(trace.prompt.submittedAt);
    assert.deepEqual(trace.stages.map(stage => stage.label),
      ['排队', '启动与提交', '运行器接收', '等待首段可见文本', '输出及后续执行', '收尾与归档']);
  } finally {
    await scheduler.close();
    await rm(data, {recursive: true, force: true});
  }
});
