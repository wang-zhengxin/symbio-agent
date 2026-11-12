import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { companyTools } from './company-tools.js';
import { codexRuntime, demoRuntime, piRuntime, redact } from './runtimes.js';

const runtimes = new Map([['codex', codexRuntime], ['pi', piRuntime], ['demo', demoRuntime]]);

async function artifactPaths(root) {
  const files = [];
  async function scan(dir, depth = 0) {
    if (depth > 6 || files.length >= 100) return;
    const entries = await readdir(join(root, dir), {withFileTypes: true});
    for (const entry of entries) {
      if (files.length >= 100) break;
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory()) await scan(path, depth + 1);
    }
  }
  await scan('');
  return files;
}

export function createScheduler({store, office, space, data, concurrency, executable, piExecutable = 'pi', piProviderExtension,
  configuration = () => ({concurrency, timeoutMinutes: 15})}) {
  const workers = new Map();
  let scheduled = false;
  let closing = false;

  function wake() {
    if (scheduled || closing) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      const {concurrency, timeoutMinutes} = configuration();
      if (closing || workers.size >= concurrency) return;
      const busy = new Set([...workers.values()].map(worker => worker.agentId));
      const queued = store.list('run').filter(run => run.status === 'queued');
      for (const run of queued) {
        if (workers.size >= concurrency) break;
        if (busy.has(run.agentId)) continue;
        if (store.get('agent', run.agentId)?.paused) continue;
        const started = office.startRun(run.id);
        if (started.status !== 'running') continue;
        const worker = {agentId: run.agentId, controller: new AbortController()};
        workers.set(run.id, worker);
        busy.add(run.agentId);
        worker.done = execute(started, worker, timeoutMinutes).finally(() => {
          workers.delete(run.id);
          wake();
        });
        worker.done.catch(error => console.error('调度异常', error));
      }
    });
  }

  async function execute(run, {controller}, timeoutMinutes) {
    const cwd = join(data, 'workspaces', run.id);
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMinutes * 60_000);
    const emit = (type, payload) => office.report(run.id, type, payload);
    try {
      await mkdir(cwd, {recursive: true, mode: 0o700});
      emit('run.workspace', {cwd});
      await space?.prepare(run, cwd, controller.signal);
      const runtime = runtimes.get(run.agent.runtime);
      if (!runtime) throw new Error('该员工没有平台执行权限');
      try {
        await runtime({emit, signal: controller.signal, run, cwd,
          executable: run.agent.runtime === 'pi' ? piExecutable : executable, piProviderExtension,
          tools: companyTools(store, office, run)});
      } finally {
        emit('runtime.finished', {});
      }
      const files = await artifactPaths(cwd);
      for (const path of files) emit('artifact.created', {path});
      const delivery = await space?.capture(run, cwd, store.get('run', run.id)?.output, controller.signal);
      if (controller.signal.aborted) throw new Error('执行已中止');
      office.finish(run.id, 'completed', null, delivery);
    } catch (error) {
      const reason = controller.signal.reason;
      if (reason === 'operator') office.finish(run.id, 'cancelled');
      else if (reason === 'shutdown') office.finish(run.id, 'interrupted', '服务已关闭');
      else if (reason === 'timeout') office.finish(run.id, 'failed', `执行超过 ${timeoutMinutes} 分钟`);
      else office.finish(run.id, 'failed', redact(error.message).slice(0, 1800));
    } finally {
      clearTimeout(timeout);
    }
  }

  function onEvent(event) {
    if (event.type === 'run.queued' || event.type === 'agent.dispatch' ||
      (event.type === 'settings.updated' && event.payload.section === 'runtime')) wake();
    if (event.type === 'run.stopping') workers.get(event.run_id)?.controller.abort('operator');
  }
  store.stream.on('event', onEvent);

  return {
    wake,
    recover() {
      for (const run of store.list('run')) {
        if (['running', 'stopping'].includes(run.status)) {
          office.finish(run.id, 'interrupted', '服务重启前未收到执行终态，请检查产出后重试');
        }
      }
      wake();
    },
    async close() {
      closing = true;
      store.stream.off('event', onEvent);
      for (const worker of workers.values()) worker.controller.abort('shutdown');
      await Promise.allSettled([...workers.values()].map(worker => worker.done));
    },
  };
}
