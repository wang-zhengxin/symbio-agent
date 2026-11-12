import { officeStates, resolveAvatar } from './office-avatars.js';

const activeRun = run => ['running', 'stopping'].includes(run?.status);
const byOwner = (rows, owner, matches) => {
  const index = new Map();
  for (const row of rows) {
    const key = owner(row);
    if (key && !index.has(key) && matches(row)) index.set(key, row);
  }
  return index;
};

export function officePresence(snapshot, overview) {
  const {agents = [], humans = [], tasks = [], runs = [], candidates = []} = snapshot;
  const online = new Set(overview.online.map(person => person.id));
  const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const runById = new Map(runs.map(run => [run.id, run]));
  const current = byOwner(runs, run => run.agentId, activeRun);
  const queued = byOwner(runs, run => run.agentId, run => run.status === 'queued');
  const agentBlocked = byOwner(tasks, task => task.assigneeId, task => task.status === 'blocked');
  const agentReview = byOwner(tasks, task => task.assigneeId, task => task.status === 'review');
  const humanWorking = byOwner(tasks, task => task.humanId, task => task.status === 'in_progress');
  const humanAttention = byOwner(tasks, task => task.humanId, task => ['review','blocked'].includes(task.status));
  const sessions = new Map();
  for (const conversation of overview.liveConversations) {
    for (const id of conversation.participantIds) {
      const existing = sessions.get(id);
      if (!existing || current.get(id)?.conversationId === conversation.id) sessions.set(id, conversation);
    }
  }

  function agentStatus(agent) {
    const session = sessions.get(agent.id);
    const run = current.get(agent.id);
    if (session && (!run || run.conversationId === session.id)) {
      const speaker = runById.get(session.currentRunId);
      const speaking = activeRun(speaker) && speaker.agentId === agent.id;
      return {
        state:speaking ? 'speaking' : 'listening', runId:speaking ? speaker.id : undefined,
        detail:session.topic, taskId:session.taskId, sessionId:session.id, mode:session.mode,
        order:session.participantIds.indexOf(agent.id),
      };
    }
    if (run) {
      const state = run.status === 'stopping' ? 'stopping' : /等待.*模型|等待.*响应/.test(run.activity ?? '') ? 'thinking' : 'working';
      return {state, runId:run.id, taskId:run.taskId, detail:run.activity};
    }
    const blocked = agentBlocked.get(agent.id);
    if (blocked) return {state:'blocked', taskId:blocked.id};
    if (agent.paused) return {state:'paused'};
    const waiting = queued.get(agent.id);
    if (waiting) return {state:'queued', runId:waiting.id, taskId:waiting.taskId};
    const review = agentReview.get(agent.id);
    if (review) return {state:'review', taskId:review.id};
    if (online.has(agent.id)) {
      return agent.runtime === 'observed'
        ? {state:'observed', detail:candidateById.get(agent.candidateId)?.kind === 'process' ? '已检测到进程' : '已检测到安装'}
        : {state:'idle'};
    }
    return {state:'offline'};
  }

  function humanStatus(person) {
    const task = humanWorking.get(person.id) ?? humanAttention.get(person.id);
    if (task) return {taskId:task.id, state:({in_progress:'working', review:'review', blocked:'blocked'})[task.status]};
    return {state:person.availability === 'online' ? 'idle' : 'offline'};
  }

  function actor(person, kind, status) {
    return {...status, key:kind + ':' + person.id, name:person.name, kind, profileId:person.id,
      avatar:resolveAvatar(person), label:officeStates[status.state].name,
      title:taskById.get(status.taskId)?.title, seatIndex:person.seatIndex};
  }
  return [...agents.map(person => actor(person, 'agent', agentStatus(person))),
    ...humans.map(person => actor(person, 'human', humanStatus(person)))];
}

// The furniture model and character placement share these floor coordinates.
export const desks = [
  [-5.5, -1.65], [-2.65, -1.65], [.25, -1.65],
  [-5.5, 1.05], [-2.65, 1.05], [.25, 1.05],
  [5.15, -.65], [7.85, -.65], [7.85, -2.5],
  [-2.05, -5.7], [.85, -5.7],
];
export const meetingTable = {x:6.45, z:5.55};
export const chatTables = [{x:-4.35,z:5.65}, {x:-.6,z:5.65}];
const loungeEntrance = {x:1.61,z:3.8};
const loungeWalks = [
  {x:.98,z:6.66,angle:-.75,exit:[{x:1.48,z:5.35},loungeEntrance]},
  {x:-2.26,z:6.93,angle:2.1,exit:[{x:1.48,z:6.93},loungeEntrance]},
  {x:-4.3,z:7.12,angle:2.6,exit:[{x:1.48,z:7.12},loungeEntrance]},
  {x:-2.55,z:4.48,angle:.55,exit:[{x:1.48,z:4.48},loungeEntrance]},
].map(spot => ({...spot,seated:false,area:'stroll'}));

const aisleZ = 2.3;
const deskSeats = desks.map(([x, z]) => {
  const aisleX = x >= 7 ? 6.49 : x + 1.42;
  const seatZ = z + .66;
  const exit = [{x:aisleX,z:seatZ}];
  if (z < -4) exit.push({x:aisleX,z:-3.12},{x:1.83,z:-3.12},{x:1.83,z:aisleZ});
  else exit.push({x:aisleX,z:aisleZ});
  return {x, z:seatZ, angle:Math.PI, seated:true, area:'desk', exit};
});
deskSeats.push({x:-6.9, z:-6.45, angle:0, seated:true, area:'desk',
  exit:[{x:-4.43,z:-6.45},{x:-4.43,z:-3.12},{x:-4.07,z:-3.12},{x:-4.07,z:aisleZ}]});
export const baseWorkstations = deskSeats.length;
const wingColumnWidth = 2.85;
export const officeEast = count => 10 + Math.ceil(Math.max(0,count-baseWorkstations)/2)*wingColumnWidth;
export const workstationLabel = index => 'W-' + String(index + 1).padStart(2,'0');
export function extraDesks(count) {
  return Array.from({length:Math.max(0,count-baseWorkstations)}, (_, index) => [
    11.26 + Math.floor(index/2)*wingColumnWidth, index % 2 === 0 ? 1.05 : -1.65,
  ]);
}

const meetingSeats = [
  [-1.17,-1.05], [1.17,-1.05], [-1.17,0], [1.17,0],
  [-1.17,1.05], [1.17,1.05], [0,-1.92], [0,1.92],
];
const toward = (x, z, center) => Math.atan2(center.x - x, center.z - z);

export function placeOfficeActors(actors, count = baseWorkstations) {
  const positions = new Map();
  const meetings = new Map();
  const pairs = new Map();
  const lobby = [];
  const seats = [...deskSeats, ...extraDesks(count).map(([x,z]) => ({
    x,z:z+.66,angle:Math.PI,seated:true,area:'desk',
    exit:[{x:x+1.32,z:z+.66},{x:x+1.32,z:aisleZ}],
  }))];
  const home = actor => {
    const seat = seats[actor.seatIndex];
    if (seat && actor.state !== 'offline') positions.set(actor.key, seat);
    else lobby.push(actor);
  };

  for (const actor of actors) {
    if (actor.mode === 'meeting_room' || actor.mode === 'face_to_face') {
      const groups = actor.mode === 'meeting_room' ? meetings : pairs;
      if (!groups.has(actor.sessionId)) groups.set(actor.sessionId, []);
      groups.get(actor.sessionId).push(actor);
    } else home(actor);
  }
  let meetingSeat = 0;
  for (const group of meetings.values()) {
    for (const actor of group.sort((a, b) => a.order - b.order)) {
      const seat = meetingSeats[meetingSeat++];
      if (!seat) { home(actor); continue; }
      const x = meetingTable.x + seat[0], z = meetingTable.z + seat[1];
      positions.set(actor.key, {x, z, angle:toward(x,z,meetingTable), seated:true, area:'meeting'});
    }
  }
  let pairIndex = 0;
  for (const group of pairs.values()) {
    const table = chatTables[pairIndex++];
    if (!table) { group.forEach(home); continue; }
    group.sort((a, b) => a.order - b.order).forEach((actor, index) => {
      const x = table.x + (index ? .76 : -.76);
      positions.set(actor.key, {x, z:table.z, angle:toward(x,table.z,table), seated:true, area:'lounge'});
    });
  }
  const priorities = {speaking:0, listening:1, working:2, thinking:3, blocked:4, stopping:5,
    review:6, observed:7, queued:8, paused:9, idle:10, offline:11};
  // Distinct standing spots along the reception and lounge, outside the circulation aisle.
  const standing = [
    [-7.8,3.4], [-6.4,3.45], [-7.85,6.65], [-6.55,6.85], [-8.8,7.05],
    [-8.65,1.35], [-8.65,2.5], [-8.6,-.45], [-8.65,-1.85], [-8.5,-3.15],
    [-3.2,7.05], [-1.95,7.1], [-.7,7.1], [.6,7.1],
    [-2.7,4.1], [-1.6,4], [-.5,4.02], [.55,4.05],
    [4.05,-2], [4.1,-.65], [3.85,.82], [5.1,1.35], [6.3,1.4], [7.5,1.3],
  ];
  lobby.sort((a, b) => priorities[a.state] - priorities[b.state]).forEach((actor, index) => {
    const spot = standing[index];
    if (spot) positions.set(actor.key, {x:spot[0], z:spot[1], angle:.45, seated:false, area:'lobby'});
  });
  return positions;
}

export function createOfficeStrolls(random = Math.random) {
  const due = new Map();
  const visits = new Map();
  const minute = 60_000;
  const nextVisit = now => now + (30 + random()*30)*minute;

  return function stroll(eligible, now) {
    for (const key of due.keys()) if (!eligible.has(key)) due.delete(key);
    for (const key of eligible) if (!due.has(key)) due.set(key, nextVisit(now));
    for (const [key, visit] of visits) {
      if (!eligible.has(key) || now >= visit.returnAt) {
        visits.delete(key);
        if (eligible.has(key)) due.set(key, nextVisit(now));
      }
    }
    const occupied = new Set([...visits.values()].map(visit => visit.position));
    const available = loungeWalks.filter(position => !occupied.has(position));
    for (const [key, deadline] of due) {
      if (!available.length) break;
      if (deadline > now || visits.has(key)) continue;
      const [position] = available.splice(Math.floor(random()*available.length), 1);
      visits.set(key, {position, returnAt:now + (5 + random()*5)*minute});
    }
    return visits;
  };
}
