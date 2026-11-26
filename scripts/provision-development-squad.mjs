import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { runnerConnected } from '../public/discovery-model.js';

export async function provisionDevelopmentSquad(store) {
  const plan = JSON.parse(await readFile(new URL('../config/development-squad.json', import.meta.url), 'utf8'));
  const office = createOffice(store);
  const source = store.list('candidate').find(row => row.machineId === 'local' && row.provider === 'codex' &&
    row.kind === 'installation' && row.present && runnerConnected(row));
  const existingTeam = store.list('team').find(row => row.name === plan.name);
  const needsStaff = plan.members.some(member => !store.list('agent').some(row => row.teamId === existingTeam?.id && row.name === member.name));
  if (needsStaff && !source) throw new Error('请先在发现与接入中接入本机 Codex，再初始化研发小队');
  const team = store.list('team').find(row => row.name === plan.name) ?? office.saveNamed('team', plan);
  const ensureSkill = (name, instructions) => store.list('skill').find(row => row.name === name) ??
    office.saveNamed('skill', {name, description: name, instructions});
  const common = ensureSkill('研发小队 · 协作与交付规范', plan.workflow);
  const agents = plan.members.map(member => {
    const existing = store.list('agent').find(row => row.teamId === team.id && row.name === member.name);
    if (existing) return existing;
    const skill = ensureSkill('研发小队 · ' + member.name + '岗位规范', member.instructions);
    return office.saveManagedAgent({...member, runtime: 'codex', runnerCandidateId:source.id, model: '', teamId: team.id,
      skillIds: [common.id, skill.id], mcpServerIds: []});
  });
  return {team, agents};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply') {
    console.log('用法：node --env-file-if-exists=.env scripts/provision-development-squad.mjs --apply');
    console.log('创建研发小队与五名员工；同名小队内已有的同名员工保持原配置。不启动任务。');
  } else {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const store = openStore(resolve(process.env.OFFICE_DATA_DIR ?? resolve(root, 'data'), 'office.sqlite'));
    try {
      const {team, agents} = await provisionDevelopmentSquad(store);
      console.log(JSON.stringify({team: team.name, agents: agents.map(({id, name, role, runtime, sandbox, seatIndex}) =>
        ({id, name, role, runtime, sandbox, seatIndex}))}, null, 2));
    } finally { store.close(); }
  }
}
