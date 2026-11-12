import assert from 'node:assert/strict';
import test from 'node:test';
import { officeOverview } from '../public/overview.js';
import { createOfficeStrolls, officePresence, placeOfficeActors } from '../public/office-presence.js';

test('Overview counts distinct accepted tasks in the display time zone and separates observations from active work', () => {
  const snapshot = {
    agents: [{id: 'a', runtime: 'demo'}, {id: 'b', runtime: 'observed', candidateId: 'process'}],
    machines: [{id: 'remote', status: 'online', processScan: 'unavailable'}],
    candidates: [{id: 'process', machineId: 'remote', kind: 'process', present: true}],
    runs: [
      {id: 'run', kind: 'task', taskId: 'active', status: 'running', agentId: 'a'},
      {id: 'meeting', kind: 'conversation', status: 'running', agentId: 'a'},
    ],
    conversations: [],
    tasks: [
      {id: 'active', status: 'in_progress', dueDate: '2026-11-11'},
      {id: 'review', status: 'review', dueDate: '2026-11-10'},
    ],
  };
  const stats = officeOverview(snapshot, {completions: [
    {task_id: 'done', time: '2026-11-09T16:30:00Z'},
    {task_id: 'done', time: '2026-11-10T00:10:00Z'},
    {task_id: 'prior', time: '2026-11-09T15:30:00Z'},
  ]}, {now: new Date('2026-11-10T01:00:00Z'), timeZone: 'Asia/Shanghai'});
  assert.equal(stats.today, '2026-11-10');
  assert.deepEqual(stats.online.map(agent => agent.id), ['a']);
  assert.equal(stats.taskCount, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.completedYesterday, 1);
  assert.deepEqual(stats.attention.map(item => item.kind), ['review', 'due']);
});

test('Office characters follow live task and conversation state, including the third-person move', () => {
  const agents = [
    {id:'a', name:'A', runtime:'demo', avatarId:'architect'},
    {id:'b', name:'B', runtime:'demo'},
    {id:'c', name:'C', runtime:'demo'},
    {id:'d', name:'D', runtime:'observed', candidateId:'remote-cli'},
  ];
  const snapshot = {agents, humans:[{id:'h', name:'H', availability:'online'}],
    tasks:[{id:'manual',humanId:'h',status:'in_progress'}],
    machines:[{id:'remote',status:'online',processScan:'ok'}],
    candidates:[{id:'remote-cli',machineId:'remote',kind:'installation',present:true}],
    runs:[{id:'r',agentId:'a',status:'running',kind:'task',activity:'等待模型响应'}]};
  const read = () => officePresence(snapshot, officeOverview(snapshot, null));
  let actors = read();
  assert.equal(actors[0].state, 'thinking');
  assert.equal(actors[0].avatar.id, 'architect');
  assert.equal(actors[3].state, 'observed');
  assert.equal(actors[4].state, 'working');
  snapshot.runs[0] = {id:'r',agentId:'a',status:'running',kind:'conversation',conversationId:'chat'};
  snapshot.conversations = [{id:'chat',status:'active',mode:'face_to_face',participantIds:['a','b'],currentRunId:'r'}];
  actors = read();
  assert.deepEqual(actors.slice(0,2).map(actor => actor.state), ['speaking','listening']);
  let positions = placeOfficeActors(actors);
  const [a,b] = ['agent:a','agent:b'].map(key => positions.get(key));
  assert.equal(a.area, 'lounge');
  assert.equal(a.z, b.z);
  assert.equal(Math.abs(a.angle-b.angle), Math.PI);
  snapshot.conversations[0] = {...snapshot.conversations[0],mode:'meeting_room',participantIds:['a','b','c']};
  positions = placeOfficeActors(read());
  const seats = ['a','b','c'].map(id => positions.get('agent:' + id));
  assert.ok(seats.every(seat => seat.area === 'meeting'));
  assert.equal(new Set(seats.map(seat => [seat.x,seat.z].join(','))).size, 3);
});

test('Idle actors sit in their own seats across roster and activity changes', () => {
  const a = {key:'agent:a',state:'idle',seatIndex:0};
  const b = {key:'human:b',state:'idle',seatIndex:1};
  const initial = placeOfficeActors([a,b]);
  assert.ok([...initial.values()].every(seat => seat.area === 'desk' && seat.seated));
  assert.notDeepEqual(initial.get(a.key),initial.get(b.key));
  const changed = placeOfficeActors([{...b,state:'working'},{...a,state:'offline'}, {key:'agent:c',state:'idle',seatIndex:12}],13);
  assert.equal(changed.get(b.key),initial.get(b.key));
  assert.ok(changed.get('agent:c').x > 10 && changed.get('agent:c').seated);
  assert.equal(placeOfficeActors([b,a]).get(a.key),initial.get(a.key));
});

test('Idle breaks wait for the longer interval, use separate spots and end or cancel on activity', () => {
  const stroll = createOfficeStrolls(() => .5);
  const idle = new Set(['a','b']);
  const step = minutes => stroll(idle,minutes*60_000);
  assert.equal(step(0).size,0);
  assert.equal(step(44.99).size,0);
  const visits = step(45);
  assert.equal(visits.size,2);
  assert.notEqual(visits.get('a').position,visits.get('b').position);
  assert.equal(step(52.49).size,2);
  idle.delete('a');
  assert.equal(step(52.49).has('a'),false);
  assert.equal(step(52.5).size,0);
  idle.add('a');
  assert.equal(step(53).size,0);
  assert.equal(step(97.5).has('b'),true);
  assert.equal(step(97.5).has('a'),false);
});
