import { executionRuntimes, executionAdapterStatus } from './agent-permissions.js';

// Shared by discovery, the selection UI and server-side onboarding validation.
export function candidateRuntimes(candidate) {
  return candidate?.machineId === 'local' && candidate.kind === 'installation' && executionRuntimes.includes(candidate.provider)
    ? ['observed', candidate.provider] : ['observed'];
}

export function candidateExecutionStatus(candidate) {
  if (!executionRuntimes.includes(candidate?.provider)) return executionAdapterStatus({runtime:'observed'});
  if (candidate.machineId !== 'local') return {label:'远程执行未接入', ready:false,
    detail:'平台已适配本机执行；此远程客户端目前支持采集与任务查询，尚不支持远程派发。'};
  if (candidateRuntimes(candidate).length === 1) return {label:'已适配，待定位 CLI', ready:false,
    detail:'平台已接入此执行适配器，但当前仅发现进程。请安装或配置可执行 CLI 后重新扫描。'};
  return executionAdapterStatus({runtime:candidate.provider});
}

// Employee identity is independent of process identity. PIDs are diagnostics only.
export function discoveryGroups(candidates = [], machines = []) {
  const byMachine = new Map(machines.map(machine => [machine.id, machine]));
  const groups = new Map();
  for (const candidate of candidates) {
    const machine = byMachine.get(candidate.machineId);
    if (!machine || machine.status === 'revoked') continue;
    const key = candidate.machineId + ':' + candidate.provider;
    if (!groups.has(key)) groups.set(key, {key, machine, provider: candidate.provider, candidate: null, processes: [], legacyReviews: []});
    const group = groups.get(key);
    if (candidate.kind === 'process') {
      if (candidate.present) group.processes.push(candidate);
      if (candidate.status === 'review') group.legacyReviews.push(candidate);
    } else group.candidate = candidate;
  }
  return [...groups.values()].filter(group => group.candidate?.present || group.candidate?.status === 'review' ||
    group.processes.length || group.legacyReviews.length).map(group => ({...group,
    processState: group.machine.status !== 'online' ? 'offline' : group.machine.processScan !== 'ok' ? 'unknown' : 'current',
    processes: group.processes.sort((a, b) => a.pid - b.pid),
  })).sort((a, b) => a.machine.name.localeCompare(b.machine.name) || a.provider.localeCompare(b.provider));
}

export function agentRunnerChoices(agent, candidates = [], machines = []) {
  const choices = [];
  for (const candidate of candidates) {
    const machine = machines.find(row => row.id === candidate.machineId);
    if (candidate.kind === 'process' || !machine || machine.status === 'revoked' ||
        (!candidate.present && candidate.id !== agent.runnerCandidateId)) continue;
    const runtime = candidateRuntimes(candidate).at(-1);
    choices.push({value: 'source:' + candidate.id, runtime, provider: candidate.provider,
      candidateId: candidate.id, machine: machine.name, adapter:candidateExecutionStatus(candidate)});
  }
  for (const runtime of ['codex','pi','demo']) {
    if (agent.candidateId && agent.runtime !== runtime) continue;
    if (choices.some(row => row.runtime === runtime)) continue;
    choices.push({value:runtime, runtime, provider:runtime, machine:runtime === 'demo' ? undefined : '本机', adapter:executionAdapterStatus({runtime})});
  }
  // Showing a discovered installation must not silently rebind existing generic employees.
  if (!agent.runnerCandidateId && !agent.candidateId) {
    const current = choices.find(row => row.runtime === agent.runtime);
    if (current) { current.value = agent.runtime; current.candidateId = undefined; }
  }
  // Preserve an observation-only selection for an already enrolled local runner.
  if (agent.runtime === 'observed' && agent.runnerCandidateId) {
    const current = choices.find(row => row.candidateId === agent.runnerCandidateId);
    if (current && current.runtime !== 'observed') choices.push({...current, value: current.value + ':observed', runtime: 'observed',
      adapter:executionAdapterStatus(agent)});
  }
  if (agent.candidateId && !choices.some(row => row.candidateId === agent.runnerCandidateId && row.runtime === agent.runtime)) {
    choices.push({value:agent.runtime, runtime:agent.runtime, provider:agent.provider ?? agent.runtime, current:true,
      adapter:executionAdapterStatus(agent)});
  }
  return choices;
}

export function selectedRunnerChoice(agent, choices) {
  return choices.find(row => row.candidateId === agent.runnerCandidateId && row.runtime === agent.runtime)?.value
    ?? choices.find(row => row.runtime === (agent.runtime ?? 'codex'))?.value ?? choices[0]?.value;
}
