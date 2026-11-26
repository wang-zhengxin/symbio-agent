import { Socket } from 'node:net';
import { createInterface } from 'node:readline';

// The scheduler gives Pi a per-process, inherited pipe. The model sees only tool definitions and results.
export default async function githubExtension(pi) {
  const channel = new Socket({fd:3});
  const frames = createInterface({input:channel});
  const pending = new Map();
  const ready = Promise.withResolvers();
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    const error = new Error('工作台 GitHub 工具连接已关闭');
    ready.reject(error);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    frames.close();
    channel.destroy();
  }

  channel.on('error', close);
  channel.on('close', close);
  frames.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return close(); }
    if (Array.isArray(message.definitions)) ready.resolve(message.definitions);
    const call = pending.get(message.callId);
    if (!call) return;
    pending.delete(message.callId);
    call.resolve(message.result);
  });

  const definitions = await ready.promise;
  channel.unref();
  for (const {name, description, inputSchema} of definitions) {
    pi.registerTool({name, label:name, description, parameters:inputSchema,
      async execute(callId, args, signal) {
        signal?.throwIfAborted();
        if (closed) throw new Error('工作台 GitHub 工具连接已关闭');
        const response = Promise.withResolvers();
        pending.set(callId, response);
        channel.ref();
        const abort = () => response.reject(new Error('GitHub 工具已取消'));
        signal?.addEventListener('abort', abort, {once:true});
        try {
          channel.write(JSON.stringify({callId, tool:name, arguments:args}) + '\n');
          const result = await response.promise;
          if (!result?.success) throw new Error(JSON.parse(result?.contentItems?.[0]?.text ?? '{}').error || 'GitHub 工具调用失败');
          return {content:result.contentItems.map(item => ({type:'text', text:item.text})), details:{}};
        } finally {
          pending.delete(callId);
          if (!pending.size) channel.unref();
          signal?.removeEventListener('abort', abort);
        }
      },
    });
  }
}
