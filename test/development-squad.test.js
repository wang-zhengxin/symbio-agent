import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {provisionDevelopmentSquad} from '../scripts/provision-development-squad.mjs';

test('Development squad provisions five assigned staff with distinct desks and preserves existing profiles on rerun', async t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const first = await provisionDevelopmentSquad(store);
  assert.equal(first.team.name, '研发小队');
  assert.equal(first.agents.length, 5);
  assert.equal(first.agents.filter(row => row.role === 'lead').length, 1);
  assert.equal(first.agents.find(row => row.role === 'lead').sandbox, 'read-only');
  assert.equal(new Set(first.agents.map(row => row.seatIndex)).size, 5);
  assert.ok(first.agents.every(row => row.teamId === first.team.id && row.skillIds.length === 2 && row.runtime === 'codex'));
  store.tx(() => store.put('agent', {...first.agents[0], personality: '保留老板的自定义人格'}));
  const second = await provisionDevelopmentSquad(store);
  assert.equal(second.agents[0].personality, '保留老板的自定义人格');
  assert.equal(store.list('agent').length, 5);
  assert.equal(store.list('skill').length, 6);
  assert.equal(store.list('task').length, 0);
  assert.equal(store.list('run').length, 0);
});
