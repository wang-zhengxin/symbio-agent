import { redact, runtimeInstructions } from './runtimes.js';

export function runTrace(run, {milestones, tools}) {
  const submitted = milestones['runtime.input'];
  const turn = milestones['run.activity'];
  const firstOutput = milestones['runtime.first_output'] ??
    [milestones['message.delta'], milestones['message.final']].filter(Boolean).sort()[0];
  const finished = milestones['runtime.finished'];
  const stages = [{label: '排队', start: run.createdAt, end: run.startedAt ?? run.endedAt ?? null}];
  if (run.startedAt) {
    const checkpoints = [
      [submitted, '启动与提交'],
      [turn, submitted ? '运行器接收' : '启动至运行器回合'],
      [firstOutput, (turn || submitted) ? '等待首段可见文本' : '启动至首段可见文本'],
      [finished, firstOutput ? '输出及后续执行' : '运行器执行至返回'],
    ];
    let start = run.startedAt;
    for (const [end, label] of checkpoints) {
      if (!end || end < start || (run.endedAt && end > run.endedAt)) continue;
      stages.push({label, start, end});
      start = end;
    }
    const label = finished ? '收尾与归档' : firstOutput ? '输出至结束' :
      (turn || submitted) ? '等待首段可见文本' : '启动与提交';
    stages.push({label, start, end: run.endedAt ?? null});
  }

  const calls = new Map();
  for (const {type, time, payload} of tools.slice(-300)) {
    if (!payload.id) continue;
    const call = calls.get(payload.id);
    const started = type === 'tool.started';
    calls.set(payload.id, {
      id: payload.id, label: redact(payload.label || call?.label || '工具调用'),
      summary: redact(payload.summary || call?.summary),
      exitCode: payload.exitCode ?? call?.exitCode ?? null,
      start: started ? call?.start ?? time : call?.start ?? null,
      end: started ? call?.end ?? null : time,
      status: started ? call?.status ?? (run.endedAt ? 'unreported' : 'running') :
        type === 'tool.failed' ? 'failed' : 'completed',
    });
  }
  return {
    stages, tools: [...calls.values()], toolsTruncated: tools.length > 300,
    prompt: {
      submittedAt: submitted ?? null,
      reconstructed: run.instructions === undefined && ['codex', 'pi'].includes(run.agent.runtime),
      instructions: redact(run.instructions ?? runtimeInstructions(run)),
      input: redact(run.prompt),
    },
  };
}
