import assert from 'node:assert/strict';
import test from 'node:test';
import { officeOverview } from '../public/overview.js';
import { createOfficeStrolls, loungeSeats, officePresence, placeOfficeActors } from '../public/office-presence.js';

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

test('Idle breaks stagger independently, use separate spots and end or cancel on activity', () => {
  const stroll = createOfficeStrolls(() => .5);
  const idle = new Set(['a','b']);
  const step = minutes => stroll(idle,minutes*60_000);
  assert.equal(step(0).size,0);
  assert.equal(step(15.74).size,0);
  // Even when two actors share the same initial deadline, only one departs and the other is rescheduled independently.
  const first = step(15.75);
  assert.equal(first.size,1);
  const firstKey = [...first.keys()][0];
  const otherKey = firstKey === 'a' ? 'b' : 'a';
  assert.equal(step(20.5).size,1);
  assert.equal(step(21.99).size,1);
  // First actor finishes break at 15.75 + 6.25 = 22.0 min.
  assert.equal(step(22).size,0);
  // Other actor was rescheduled to 15.75 + 17 = 32.75 min.
  assert.equal(step(32.74).size,0);
  const second = step(32.75);
  assert.equal(second.size,1);
  assert.ok(second.has(otherKey));
  assert.ok(second.get(otherKey).position.seated);
  // Becoming busy cancels the active break immediately.
  idle.delete(otherKey);
  assert.equal(step(33).has(otherKey),false);
});

test('Break seats match the furniture and give priority to face-to-face conversations', () => {
  // Give 4 actors distinct staggered initial deadlines so they arrive one by one while earlier ones are still resting.
  const values = [.05,.15,.25,.35, .1,.5,.1, .1,.5,.1, .1,.5,.1, .1,.5,.1];
  const stroll = createOfficeStrolls(() => values.shift() ?? .5);
  const idle = new Set(['a','b','c','d']);
  const meeting = placeOfficeActors([
    {key:'speaker',mode:'face_to_face',sessionId:'chat',order:0},
    {key:'listener',mode:'face_to_face',sessionId:'chat',order:1},
  ]);
  const reserved = [...meeting.values()];
  stroll(idle,0,reserved);
  let visits = new Map();
  for (const minute of [3, 6, 9, 12]) visits = stroll(idle,minute*60_000,reserved);
  const seated = [...visits.values()].filter(visit => visit.position.seated);
  assert.ok(seated.length >= 2);
  for (const {position} of seated) {
    assert.ok(loungeSeats.some(seat => seat.x === position.x && seat.z === position.z && seat.angle === position.angle));
    assert.ok(!reserved.some(seat => seat.x === position.x && seat.z === position.z));
  }
  const resting = [...visits].find(([,visit]) => visit.position.seated);
  const next = stroll(idle,13*60_000,[...reserved,resting[1].position]);
  assert.equal(next.has(resting[0]),false);
});

test('Independent random deadlines never trigger a group wave after a long pause', () => {
  const values = [.05,.45,.85, 0,.2,0,.1, .3,.7, .5, 0,.2,0,.9, .4,.8];
  const stroll = createOfficeStrolls(() => values.shift() ?? .5);
  const idle = new Set(['a','b','c']);
  stroll(idle,0);
  // Actor a's independent deadline is 1.5 + 0.05 * 28.5 = 2.925 min; b & c are much later.
  assert.equal(stroll(idle,2.9*60_000).size,0);
  const first = stroll(idle,3*60_000);
  assert.equal(first.size,1);
  assert.ok(first.has('a'));
  // After a long background pause (t = 120 min), all timers are overdue:
  // only 1 person departs and the others are rescheduled independently into the future (no group wave).
  const resumed = stroll(idle,120*60_000);
  assert.equal(resumed.size,1);
  assert.equal(stroll(idle,121*60_000).size,1);
  assert.equal(stroll(idle,122*60_000).size,1);
  assert.equal(stroll(idle,123*60_000).size,1);
});


test('Reception stays seated and the current administrator occupies the private office', () => {
  const user={id:'admin-a',role:'admin'};
  const snapshot={user,agents:[],humans:[
    {id:'boss-a',userId:'admin-a',officeRole:'boss',name:'A',availability:'online',seatIndex:0},
    {id:'boss-b',userId:'admin-b',officeRole:'boss',name:'B',availability:'online',seatIndex:1},
  ],tasks:[],runs:[]};
  const read=()=>officePresence(snapshot,officeOverview(snapshot,null));
  const actors=read();
  const seats=placeOfficeActors(actors);
  const reception=actors.find(a=>a.key==='system:reception');
  assert.equal(seats.get(reception.key).area,'reception');
  assert.equal(seats.get(reception.key).seated,true);
  assert.equal(seats.get('human:boss-a').area,'private');
  assert.equal(seats.get('human:boss-b').area,'desk');
  snapshot.tasks=[{id:'task',humanId:'boss-a',status:'in_progress'}];
  assert.equal(read().find(a=>a.profileId==='boss-a').taskId,'task');
  assert.equal(placeOfficeActors(read()).get('human:boss-a').area,'private');
  snapshot.user={id:'admin-b',role:'admin'};
  assert.equal(placeOfficeActors(read()).get('human:boss-b').area,'private');
  assert.equal(placeOfficeActors(read()).get('human:boss-a').area,'desk');
});
