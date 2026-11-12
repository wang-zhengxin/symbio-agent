import { spawn } from 'node:child_process';
import { writeFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

export function redact(value) {
  return String(value ?? '')
    .replace(/\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|xox[baprs]-)[a-zA-Z0-9_-]{12,}/g, '[凭据已遮蔽]')
    .replace(/\b(?:AIza|ya29\.)[a-zA-Z0-9._~-]{15,}/g, '[凭据已遮蔽]')
    .replace(/\b(Bearer\s+)[a-zA-Z0-9._~-]{10,}/gi, '$1[凭据已遮蔽]');
}

const clip = (value, length) => redact(value).slice(0, length);
const activity = {
  commandExecution: '执行命令', fileChange: '修改文件', mcpToolCall: '调用外部工具',
  dynamicToolCall: '调用公司工具', webSearch: '搜索', imageView: '读取图片',
  contextCompaction: '整理上下文', collabToolCall: '协作',
};

export async function demoRuntime({emit, signal, run}) {
  emit('runtime.input', {});
  const plan = [{step: '读取任务', status: 'inProgress'}, {step: '返回演示输出', status: 'pending'}];
  emit('plan.updated', {plan});
  emit('tool.started', {id: 'demo-read', label: '演示 · 读取任务'});
  await delay(650, undefined, {signal});
  emit('tool.completed', {id: 'demo-read', label: '演示 · 读取任务', status: 'completed'});
  emit('plan.updated', {plan: [{...plan[0], status: 'completed'}, {...plan[1], status: 'inProgress'}]});
  for (const text of ['【演示运行】', '已接收任务。', '这段输出用于验证调度与实时事件。']) {
    emit('message.delta', {text});
    await delay(420, undefined, {signal});
  }
  emit('plan.updated', {plan: plan.map(step => ({...step, status: 'completed'}))});
  const output = run.kind === 'comment' ? `【演示回复】${run.agent.name}已收到这条消息。`
    : `【演示运行】${run.agent.name}已完成事件流演示。\n\n${run.prompt.slice(0, 300)}`;
  emit('message.final', {text:output});
}

export function runtimeInstructions(run, runtime = run.agent.runtime) {
  if (!['codex', 'pi'].includes(runtime)) return null;
  const {name, role, personality, scope, skills} = run.agent;
  return [
    `你是本地 Agent 公司员工 ${name}，岗位 ${role}。用中文回复。`,
    run.workspaceContext && `工作区约定：\n${run.workspaceContext}`,
    personality && `工作风格：${personality}`, scope && `职责：${scope}`,
    ...(skills ?? []).filter(Boolean).map(skill => `技能 ${skill.name}：${skill.description}`),
    run.kind === 'conversation' ? '这是讨论发言，只提交意见和结论。'
      : run.kind === 'comment' ? '这是任务讨论中的回复。直接输出要发布的评论正文，不执行原任务，不修改文件。'
        : '在职责内执行任务。完成后汇报结果和验证情况。',
    run.kind === 'task' && runtime === 'codex' && '需要进行公司管理或交接时，使用当前提供的 office 工具。使用 office_task_discussion 可读取执行期间的最新评论。',
    run.kind === 'task' && runtime === 'pi' && '如果需要在任务讨论中发消息，可在最终输出另起一行写 OFFICE_COMMENT {"text":"@同事姓名 消息正文"}。可带 replyToId 回复，或用 parent:true 发送到父任务。每次最多三条，另写正常交付正文。',
  ].filter(Boolean).join('\n');
}

export async function piRuntime({emit, signal, run, cwd, executable, piProviderExtension, tools}) {
  signal.throwIfAborted();
  if (piProviderExtension) {
    if (!isAbsolute(piProviderExtension)) throw new Error('OFFICE_PI_PROVIDER_EXTENSION 必须是扩展入口的绝对路径。');
    const entry = await stat(piProviderExtension).catch(() => null);
    if (!entry?.isFile()) throw new Error('OFFICE_PI_PROVIDER_EXTENSION 指定的扩展入口文件不可用。');
  }
  const promptPath = join(cwd, '.office-pi-instructions');
  await writeFile(promptPath, run.instructions ?? runtimeInstructions(run, 'pi'), {mode: 0o600, flag: 'wx'});
  try {
    signal.throwIfAborted();
    const args = ['--mode', 'json', '--no-session', '--no-tools', '--no-extensions', '--no-mcp',
      '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-approve',
      '--append-system-prompt', promptPath];
    if (piProviderExtension) args.push('--extension', piProviderExtension);
    if (run.agent.model) args.push('--model', run.agent.model);
    const child = spawn(executable, args, {cwd, stdio: ['pipe', 'pipe', 'pipe']});
    let stderr = '';
    let lines = '';
    let pending = '';
    let flushTimer;
    let killTimer;
    let error;
    let message;
    const firstOutput = observeFirstOutput(emit);
    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (pending) emit('message.delta', {text: clip(pending, 20_000)});
      pending = '';
    };
    function abort() {
      if (killTimer) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    }
    function reportUsage(usage) {
      if (!Number.isSafeInteger(usage?.totalTokens) || usage.totalTokens <= 0) return;
      const keys = {totalTokens: 'totalTokens', inputTokens: 'input', outputTokens: 'output',
        cachedInputTokens: 'cacheRead', cacheWriteInputTokens: 'cacheWrite'};
      emit('usage.updated', Object.fromEntries(Object.entries(keys)
        .filter(([, key]) => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
        .map(([name, key]) => [name, usage[key]])));
    }
    function handle(event) {
      switch (event.type) {
        case 'turn_start':
          emit('run.activity', {label: '等待 Pi 模型响应', phase: 'turn_started'});
          break;
        case 'message_update':
          if (event.assistantMessageEvent?.type === 'text_delta') {
            firstOutput(event.assistantMessageEvent.delta);
            pending += event.assistantMessageEvent.delta;
            if (pending.length >= 20_000) flush();
            else if (!flushTimer) flushTimer = setTimeout(flush, 100);
          }
          break;
        case 'message_end':
          if (event.message?.role === 'assistant') {
            message = event.message;
            reportUsage(message.usage);
          }
          break;
        case 'auto_retry_start':
          emit('runtime.error', {summary: clip(event.errorMessage, 1800), willRetry: true});
          break;
      }
    }
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    child.stdout.setEncoding('utf8').on('data', chunk => {
      if (error) return;
      // Pi frames JSON records with LF. JSON strings can contain other line separators.
      const records = (lines + chunk).split('\n');
      lines = records.pop();
      try {
        for (const record of records) if (record.trim()) handle(JSON.parse(record));
        if (lines.length > 4_000_000) throw new Error('Pi 事件超过大小限制');
      } catch (failure) {
        error = failure instanceof SyntaxError ? new Error('Pi 返回了无效的 JSON 事件') : failure;
        abort();
      }
    });
    child.on('error', failure => { error = failure; });
    child.stdin.on('error', failure => { if (failure.code !== 'EPIPE') error = failure; });
    const closed = new Promise(resolve => child.once('close', resolve));
    signal.addEventListener('abort', abort, {once: true});
    try {
      emit('runtime.input', {});
      child.stdin.end(run.prompt);
      const code = await closed;
      signal.throwIfAborted();
      if (error) throw error;
      flush();
      const summary = message?.errorMessage || stderr.trim();
      if (code !== 0 || message?.stopReason !== 'stop') {
        if (/no api key|no models? available|no model (?:found|selected)/i.test(summary)) {
          throw new Error('Pi 未找到当前运行配置可用的模型。请检查 Pi 登录和模型；若登录依赖提供商扩展，请配置 OFFICE_PI_PROVIDER_EXTENSION。');
        }
        throw new Error(clip(summary || `Pi 未正常完成（${message?.stopReason ?? code ?? '信号'}）`, 1800));
      }
      let output = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      if (run.kind === 'task' && tools && output.includes('OFFICE_COMMENT ')) {
        let count = 0;
        output = output.split('\n').filter(line => {
          if (!line.startsWith('OFFICE_COMMENT ')) return true;
          if (++count > 3) return false;
          try {
            const args = JSON.parse(line.slice('OFFICE_COMMENT '.length));
            const result = tools.call({callId:'pi-comment-' + count, tool:'office_post_comment',
              arguments:typeof args?.text === 'string' ? {...args, text:redact(args.text)} : args});
            if (!result.success) throw new Error(JSON.parse(result.contentItems[0].text).error);
          } catch (error) {
            emit('runtime.warning', {summary:'Pi 任务评论未发送：' + clip(error.message, 400)});
          }
          return false;
        }).join('\n');
      }
      if (!output.trim()) throw new Error('Pi 未返回文本交付');
      firstOutput(output);
      emit('message.final', {text: clip(output, 48_000)});
    } finally {
      signal.removeEventListener('abort', abort);
      clearTimeout(flushTimer);
      clearTimeout(killTimer);
    }
  } finally {
    await rm(promptPath, {force: true});
  }
}

function observeFirstOutput(emit) {
  let recorded = false;
  return text => {
    if (recorded || typeof text !== 'string' || !text.trim()) return;
    recorded = true;
    emit('runtime.first_output', {});
  };
}

export async function codexRuntime({emit, signal, run, cwd, tools, executable}) {
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    cwd, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let nextId = 0;
  let threadId;
  let turnId;
  let stopped;
  let finished = false;
  let textBuffer = '';
  let textTimer;
  let killTimer;
  let settleTimer;
  let finalText = '';
  let usage;
  const calls = new Map();
  const firstOutput = observeFirstOutput(emit);
  const lines = createInterface({input: child.stdout});
  const done = Promise.withResolvers();
  // The process can exit during initialize, before the turn waiter is attached.
  done.promise.catch(() => {});
  function flush() {
    clearTimeout(textTimer);
    textTimer = null;
    if (!textBuffer) return;
    const text = clip(textBuffer, 20_000);
    textBuffer = '';
    emit('message.delta', {text});
  }
  function send(data) {
    if (child.stdin.destroyed) throw new Error('Codex 连接已关闭');
    child.stdin.write(JSON.stringify(data) + '\n');
  }
  function request(method, params) {
    const id = ++nextId;
    const pending = Promise.withResolvers();
    calls.set(id, pending);
    try {
      send({id, method, params});
    } catch (error) {
      calls.delete(id);
      pending.reject(error);
    }
    return pending.promise;
  }
  function abort() {
    if (finished || stopped) return;
    stopped = true;
    if (threadId && turnId) request('turn/interrupt', {threadId, turnId}).catch(() => {});
    else child.kill();
    killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
  }
  function processExit(error) {
    for (const call of calls.values()) call.reject(error);
    calls.clear();
    done.reject(error);
  }
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
  child.stdin.on('error', processExit);
  child.once('error', processExit);
  child.once('close', code => processExit(new Error(
    `Codex 进程退出（${code ?? '信号'}）${stderr ? '：' + clip(stderr, 1800).trim() : ''}`)));
  lines.on('line', line => {
    try {
      const msg = JSON.parse(line);
      const p = msg.params ?? {};
      if (!msg.method && Object.hasOwn(msg, 'id')) {
        const call = calls.get(msg.id);
        calls.delete(msg.id);
        if (msg.error) call?.reject(new Error(clip(msg.error.message, 1800)));
        else call?.resolve(msg.result);
        return;
      }
      if (Object.hasOwn(msg, 'id')) {
        if (msg.method === 'item/tool/call' && p.threadId === threadId && !signal.aborted) {
          send({id: msg.id, result: tools.call(p)});
        } else {
          send({id: msg.id, error: {code: -32601, message: '当前运行权限不支持此请求'}});
        }
        return;
      }
      if (p.threadId && threadId && p.threadId !== threadId) return;
      if (p.turnId && turnId && p.turnId !== turnId) return;
      switch (msg.method) {
        case 'turn/started':
          turnId = p.turn.id;
          emit('run.activity', {label: '等待模型响应', phase: 'turn_started'});
          break;
        case 'error':
          emit('runtime.error', {
            summary: clip(p.error?.message ?? 'Codex 运行错误', 1800), willRetry: Boolean(p.willRetry),
          });
          break;
        case 'warning':
        case 'configWarning':
          emit('runtime.warning', {summary: clip(p.message || p.summary, 1200)});
          break;
        case 'turn/plan/updated':
          emit('plan.updated', {plan: (p.plan ?? []).slice(0, 100).map(step => ({
            step: clip(step.step, 1200), status: step.status,
          }))});
          break;
        case 'item/agentMessage/delta':
          firstOutput(p.delta);
          textBuffer += p.delta;
          if (!textTimer) textTimer = setTimeout(flush, 100);
          break;
        case 'item/started':
        case 'item/completed': {
          const item = p.item;
          const label = activity[item.type];
          const completed = msg.method === 'item/completed';
          if (item.type === 'agentMessage' && completed) {
            firstOutput(item.text);
            flush();
            if (!item.phase || item.phase === 'final_answer') finalText = clip(item.text, 48_000);
          }
          if (!label) break;
          const failed = ['failed', 'declined'].includes(item.status) || item.success === false;
          emit(!completed ? 'tool.started' : failed ? 'tool.failed' : 'tool.completed', {
            id: item.id, label, status: item.status ?? (completed ? 'completed' : 'inProgress'),
            summary: clip(item.command || item.tool || item.query || item.changes?.map(change => change.path).join(', '), 1000),
            exitCode: item.exitCode ?? null,
          });
          break;
        }
        case 'thread/tokenUsage/updated': {
          const total = p.tokenUsage?.total;
          if (Number.isSafeInteger(total?.totalTokens) && total.totalTokens >= 0) {
            usage = Object.fromEntries(['totalTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens',
              'reasoningOutputTokens', 'cacheWriteInputTokens']
              .filter(key => Number.isSafeInteger(total[key]) && total[key] >= 0).map(key => [key, total[key]]));
            emit('usage.updated', usage);
          }
          break;
        }
        case 'turn/completed': {
          if (turnId && p.turn.id !== turnId) break;
          finished = true;
          flush();
          if (finalText) emit('message.final', {text: finalText});
          // Allow terminal accounting emitted immediately after turn/completed.
          settleTimer = setTimeout(() => done.resolve(p.turn), 150);
          break;
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) return;
      done.reject(error);
    }
  });
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) abort();
  try {
    await request('initialize', {
      clientInfo: {name: 'agent_office_local', title: 'Agent 公司', version: '0.1.0'},
      capabilities: {experimentalApi: true},
    });
    send({method: 'initialized'});
    const started = await request('thread/start', {
      cwd, ephemeral: true, ...(run.agent.model ? {model: run.agent.model} : {}),
      sandbox: run.kind === 'conversation' ? 'read-only' : run.agent.sandbox,
      approvalPolicy: 'never',
      config: {
        'sandbox_workspace_write.network_access': false,
        'sandbox_workspace_write.writable_roots': [],
        'sandbox_workspace_write.exclude_tmpdir_env_var': true,
        'sandbox_workspace_write.exclude_slash_tmp': true,
      },
      developerInstructions: run.instructions ?? runtimeInstructions(run, 'codex'),
      dynamicTools: tools.definitions,
    });
    threadId = started.thread.id;
    emit('runtime.input', {});
    const response = await request('turn/start', {
      threadId, input: [{type: 'text', text: run.prompt, text_elements: []}],
    });
    turnId = response.turn.id;
    const result = await done.promise;
    if (result.status !== 'completed') {
      throw new Error(clip(result.error?.message ?? `Codex 执行状态：${result.status}`, 1800));
    }
    return usage;
  } finally {
    finished = true;
    signal.removeEventListener('abort', abort);
    clearTimeout(textTimer);
    clearTimeout(killTimer);
    clearTimeout(settleTimer);
    lines.close();
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}
