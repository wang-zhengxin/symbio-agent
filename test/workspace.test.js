import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore } from '../src/store.js';
import { createWorkspace } from '../src/workspace.js';
import { createOffice } from '../src/office.js';
import { addWorkstations, backfillWorkstations, removeWorkstations } from '../src/workstations.js';

test('Layout drafts stay private to the editor until publication, and stale writes cannot overwrite them', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const initial = workspace.snapshot().layout;
  const draft = structuredClone(initial.draft);
  draft.zones[0].name = '异步协作区';
  draft.zones[0].x = 24;
  draft.widgets.activity = false;
  const saved = workspace.saveLayout({revision: initial.revision, draft}, false);
  assert.equal(workspace.snapshot().layout.published, null);
  assert.throws(() => workspace.saveLayout({revision: initial.revision, draft}, true), {status: 409});
  const published = workspace.saveLayout({revision: saved.revision, draft}, true);
  draft.zones[0].name = '仍是草稿';
  workspace.saveLayout({revision: published.revision, draft}, false);
  const {layout} = workspace.snapshot();
  assert.equal(layout.published.zones[0].name, '异步协作区');
  assert.equal(layout.published.zones[0].x, 24);
  assert.equal(layout.published.widgets.activity, false);
  assert.equal(layout.draft.zones[0].name, '仍是草稿');
});

test('A human assignment can progress without an Agent run and is preserved during task edits', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const office = createOffice(store);
  const employee = workspace.saveHuman({name: '林远', title: '产品负责人'});
  const task = office.saveTask({title: '确认设计范围', humanId: employee.id});
  const edited = office.saveTask({id: task.id, title: '复核设计范围'});
  assert.equal(edited.humanId, employee.id);
  assert.equal(office.taskStatus(task.id, 'in_progress').status, 'in_progress');
  assert.equal(office.taskStatus(task.id, 'review').status, 'review');
  assert.equal(office.taskStatus(task.id, 'done').status, 'done');
  assert.equal(store.list('run').length, 0);
});

test('Human and Agent profiles retain a selected avatar across edits by older clients', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const office = createOffice(store);
  const human = workspace.saveHuman({name:'林远', title:'产品负责人', avatarId:'analyst'});
  const agent = office.saveAgent({name:'研发', runtime:'demo', avatarId:'engineer'});
  assert.equal(workspace.saveHuman({id:human.id,name:human.name,title:'项目经理'}).avatarId,'analyst');
  assert.equal(office.saveAgent({id:agent.id,name:agent.name,runtime:agent.runtime}).avatarId,'engineer');
  assert.throws(() => office.saveAgent({name:'研发',avatarId:'missing'}), {status:400});
  assert.throws(() => workspace.saveHuman({name:'林远',title:'项目经理',avatarId:'missing'}), {status:400});
});

test('Existing staff and new hires keep unique desks as the shared layout expands', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const office = createOffice(store);
  store.tx(() => store.put('human',{id:'legacy',name:'老员工',title:'设计师'}));
  backfillWorkstations(store);
  const legacy = workspace.snapshot().humans[0];
  assert.equal(legacy.seatIndex,0);
  for (let i=1; i<12; i++) assert.equal(office.saveAgent({name:'Agent ' + i,runtime:'demo'}).seatIndex,i < 11 ? i : i+1);
  assert.equal(workspace.snapshot().workstationCount,13);
  const hire = workspace.saveHuman({name:'新员工',title:'工程师'});
  assert.equal(hire.seatIndex,13);
  assert.equal(workspace.snapshot().workstationCount,14);
  assert.equal(addWorkstations(store,{amount:2}).count,16);
  assert.equal(office.saveAgent({name:'新 Agent',runtime:'demo'}).seatIndex,14);
  assert.equal(workspace.snapshot().workstationCount,16);
  assert.equal(removeWorkstations(store,{amount:1}).count,15);
  assert.throws(() => removeWorkstations(store,{amount:1}), {status:409});
  assert.throws(() => removeWorkstations(store,{index:14}), {status:409});
  assert.equal(addWorkstations(store,{amount:2}).count,17);
  assert.equal(removeWorkstations(store,{index:15}).count,16);
  assert.equal(removeWorkstations(store,{amount:1}).count,15);
  assert.equal(workspace.saveHuman({...legacy,title:'产品设计师'}).seatIndex,0);
});


test('Administrator profiles bind once, reuse matching email, and keep the private office reserved', t => {
  const store = openStore(':memory:');t.after(()=>store.close());
  const workspace = createWorkspace(store);
  const legacy = workspace.saveHuman({name:'旧名字',title:'管理员',email:'boss@example.test'});
  const user = {id:'admin-one',name:'老板账号',role:'admin',email:'boss@example.test'};
  const boss = workspace.ensureAdministrator(user);
  assert.equal(boss.id,legacy.id);
  assert.equal(boss.userId,user.id);
  assert.equal(boss.officeRole,'boss');
  const cursor = store.cursor();
  workspace.ensureAdministrator(user);
  assert.equal(store.cursor(),cursor);
  assert.equal(workspace.snapshot().humans.length,1);
  workspace.ensureAdministrator({...user,name:'新名字'});
  assert.equal(workspace.snapshot().humans[0].name,'新名字');
  workspace.ensureAdministrator({...user,id:'member',role:'member'});
  assert.equal(workspace.snapshot().humans.length,1);
  assert.equal(workspace.saveHuman({...boss,title:'老板'}).userId,user.id);
  store.tx(()=>store.put('agent',{id:'old-seat',name:'旧工位',seatIndex:11}));
  backfillWorkstations(store);
  assert.notEqual(store.get('agent','old-seat').seatIndex,11);
});

test('Clearing initialized staff does not recreate demo employees on restart', t => {
  const store=openStore(':memory:');t.after(()=>store.close());
  const office=createOffice(store);
  office.seed();
  assert.equal(store.list('agent').length,5);
  const teams=store.list('team').length, skills=store.list('skill').length;
  store.tx(()=>{for(const person of store.list('agent'))store.remove('agent',person.id);});
  createOffice(store).seed();
  assert.equal(store.list('agent').length,0);
  assert.equal(store.list('team').length,teams);
  assert.equal(store.list('skill').length,skills);
});

test('Custom 3D furniture placement validates collisions, assigns seats, protects occupied desks, and routes via A*', async t => {
  const {saveOfficeItems} = await import('../src/furniture.js');
  const {findOfficePath, validateItemPlacement} = await import('../public/office-furniture.js');
  const {customSeatIndexStart, placeOfficeActors, workstationLabel} = await import('../public/office-presence.js');
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);
  const office = createOffice(store);

  // Valid custom desk + plant in open central/west corridor
  const saved = saveOfficeItems(store, {
    items: [
      {id: 'desk-1', type: 'desk', x: -8.0, z: -1.5, rotation: 90},
      {id: 'plant-1', type: 'plant', x: -2.0, z: 3.5, rotation: 0},
    ],
  });
  assert.equal(saved.items.length, 2);
  const customDesk = saved.items.find(i => i.id === 'desk-1');
  assert.equal(customDesk.seatIndex, customSeatIndexStart);
  assert.equal(workstationLabel(customDesk.seatIndex), 'D-01');
  assert.equal(workspace.snapshot().officeItems.length, 2);
  assert.equal(workspace.snapshot().workstationCount, 12);
  assert.equal(store.audit()[0].type, 'layout.furniture_saved');

  // Rejects wall collision, doorway obstruction, and overlapping furniture
  assert.equal(validateItemPlacement({type: 'plant', x: -9.9, z: 0, rotation: 0}, saved.items, 12).ok, false);
  assert.equal(validateItemPlacement({type: 'plant', x: 3.2, z: 4.7, rotation: 0}, saved.items, 12).ok, false);
  assert.throws(() => saveOfficeItems(store, {
    items: [
      {id: 'desk-1', type: 'desk', x: -8.0, z: -1.5, rotation: 90},
      {id: 'overlap', type: 'plant', x: -8.0, z: -1.5, rotation: 0},
    ],
  }), {status: 409});

  // Fill built-in 11 desks (0..10); 12th employee takes custom desk D-01 without expanding East Wing
  for (let i = 0; i < 11; i++) office.saveAgent({name: '员工' + i, runtime: 'demo'});
  const customOccupant = office.saveAgent({name: '自由工位员工', runtime: 'demo'});
  assert.equal(customOccupant.seatIndex, customSeatIndexStart);
  assert.equal(workspace.snapshot().workstationCount, 12);

  // Occupied custom desk cannot be deleted, but CAN be rotated/moved while keeping seatIndex
  assert.throws(() => saveOfficeItems(store, {
    items: [{id: 'plant-1', type: 'plant', x: -2.0, z: 3.5, rotation: 0}],
  }), {status: 409});
  const moved = saveOfficeItems(store, {
    items: [
      {id: 'desk-1', type: 'desk', x: -8.0, z: -1.0, rotation: 270},
      {id: 'plant-1', type: 'plant', x: -2.0, z: 3.5, rotation: 0},
    ],
  });
  assert.equal(moved.items[0].seatIndex, customSeatIndexStart);
  const placed = placeOfficeActors([{key: 'agent:' + customOccupant.id, seatIndex: customSeatIndexStart, state: 'idle'}], 12, moved.items);
  const pose = placed.get('agent:' + customOccupant.id);
  assert.equal(pose.area, 'desk');
  assert.ok(Math.abs(pose.z - (-1.0)) < 0.05);

  // A* grid pathfinding routes from central aisle into break room around walls & placed partition
  const path = findOfficePath(
    {x: -2.5, z: 2.3},
    {x: 6.65, z: 5.09, exit: [{x: 6.65, z: 4.55}]},
    12,
    [{id: 'part-1', type: 'partition', x: 0.5, z: 3.5, rotation: 0}],
  );
  assert.ok(path.length >= 3);
  // Final destination matches target
  assert.equal(path.at(-1).x, 6.65);
  assert.equal(path.at(-1).z, 5.09);
  // Path enters break room via west doorway (x ~ 3.22, z in [4.1, 5.39]), not straight through north wall (z = 2.92, x > 4)
  assert.ok(!path.some(pt => pt.x > 4.2 && pt.z > 2.6 && pt.z < 3.25));
});

test('Phase 2 custom orthogonal walls, doorways, and area rugs persist safely and route A* through doorways', async t => {
  const {saveOfficeItems} = await import('../src/furniture.js');
  const {findOfficePath, validateDoorPlacement, wallSubSegments} = await import('../public/office-furniture.js');
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);

  // Draw a 4m east-west custom wall across an open corridor with a centered 1.4m doorway + an area rug
  const saved = saveOfficeItems(store, {
    items: [],
    walls: [{id: 'w1', x1: -2.0, z1: 3.5, x2: 2.0, z2: 3.5, color: 'slate', doors: [2.0]}],
    rugs: [{id: 'r1', x1: -2.0, z1: 4.5, x2: 1.5, z2: 7.0, color: 'sage'}],
  });
  assert.equal(saved.walls.length, 1);
  assert.equal(saved.walls[0].doors.length, 1);
  assert.equal(saved.rugs.length, 1);
  assert.equal(workspace.snapshot().officeWalls.length, 1);
  assert.equal(workspace.snapshot().officeRugs.length, 1);

  // Wall sub-segments split into 2 solid halves and 1 lintel over the 1.4m doorway
  const split = wallSubSegments(saved.walls[0]);
  assert.equal(split.solids.length, 2);
  assert.equal(split.lintels.length, 1);
  assert.equal(validateDoorPlacement(saved.walls[0], 2.0).ok, false); // overlapping existing door
  assert.equal(validateDoorPlacement(saved.walls[0], 0.5).ok, false); // too close to wall end

  // Rejects placing furniture on top of a custom wall or blocking its doorway
  assert.throws(() => saveOfficeItems(store, {
    items: [{id: 'p1', type: 'plant', x: -1.5, z: 3.5, rotation: 0}],
    walls: saved.walls,
    rugs: saved.rugs,
  }), {status: 409});
  assert.throws(() => saveOfficeItems(store, {
    items: [{id: 'p2', type: 'plant', x: 0.0, z: 3.5, rotation: 0}],
    walls: saved.walls,
    rugs: saved.rugs,
  }), {status: 409});

  // Furniture CAN be placed cleanly on top of an area rug
  const onRug = saveOfficeItems(store, {
    items: [{id: 'sofa-1', type: 'sofa', x: 1.0, z: 7.0, rotation: 0}],
    walls: saved.walls,
    rugs: saved.rugs,
  });
  assert.equal(onRug.items.length, 1);

  // A* path from north of custom wall (0, 2.5) to south of custom wall (0, 5.0) walks cleanly through the doorway at x=0, z=3.5
  const throughDoor = findOfficePath({x: 0, z: 2.3}, {x: 0, z: 5.0}, 12, [], saved.walls);
  assert.ok(throughDoor.length >= 2);
  assert.equal(throughDoor.at(-1).z, 5.0);
  // Without doorway, a solid wall forces A* to detour around the wall ends (|x| >= 1.8 near z=3.5)
  const solidWalls = [{...saved.walls[0], doors: []}];
  const aroundWall = findOfficePath({x: 0, z: 2.3}, {x: 0, z: 5.0}, 12, [], solidWalls);
  assert.ok(aroundWall.some(pt => Math.abs(pt.x) >= 1.8));
});

test('From-scratch custom space mode supports wall-first drawing, floor slabs, zone furniture, actor seating, and custom A* pathfinding', async t => {
  const {saveOfficeItems} = await import('../src/furniture.js');
  const {findOfficePath} = await import('../public/office-furniture.js');
  const {placeOfficeActors, customSeatIndexStart} = await import('../public/office-presence.js');
  const store = openStore(':memory:');
  t.after(() => store.close());
  const workspace = createWorkspace(store);

  const perimeterAndDivider = [
    {id: 'w-north', x1: -8, z1: -6, x2: 8, z2: -6, color: 'warm', doors: []},
    {id: 'w-south', x1: -8, z1: 6, x2: 8, z2: 6, color: 'warm', doors: []},
    {id: 'w-west', x1: -8, z1: -6, x2: -8, z2: 6, color: 'warm', doors: []},
    {id: 'w-east', x1: 8, z1: -6, x2: 8, z2: 6, color: 'warm', doors: []},
    {id: 'w-mid', x1: 0, z1: -6, x2: 0, z2: 6, color: 'sage', doors: [6.0]},
  ];

  // Step 1: Draw walls FIRST on blank 24x20m canvas with zero floors
  const wallsOnly = saveOfficeItems(store, {
    mode: 'custom',
    floors: [],
    walls: perimeterAndDivider,
    rugs: [],
    items: [],
  });
  assert.equal(wallsOnly.mode, 'custom');
  assert.equal(wallsOnly.walls.length, 5);
  assert.equal(wallsOnly.floors.length, 0);
  assert.equal(workspace.snapshot().officeMode, 'custom');

  // Step 2 guard: Furniture and rugs are rejected until floor slabs cover their footprint
  assert.throws(() => saveOfficeItems(store, {
    mode: 'custom',
    floors: [],
    walls: perimeterAndDivider,
    rugs: [],
    items: [{id: 'boss-1', type: 'boss_desk', x: -4.0, z: -2.0, rotation: 0}],
  }), /铺设地板/);
  assert.throws(() => saveOfficeItems(store, {
    mode: 'custom',
    floors: [],
    walls: perimeterAndDivider,
    rugs: [{id: 'r-nofloor', x1: -6, z1: -4, x2: -2, z2: 0, color: 'sand'}],
    items: [],
  }), /铺设地板/);

  // Step 2 + 3: Lay two adjacent floor slabs (west wood + east carpet) and place functional zone furniture + custom desk
  const floors = [
    {id: 'f-west', x1: -8, z1: -6, x2: 0, z2: 6, material: 'wood'},
    {id: 'f-east', x1: 0, z1: -6, x2: 8, z2: 6, material: 'carpet'},
  ];
  const built = saveOfficeItems(store, {
    mode: 'custom',
    floors,
    walls: perimeterAndDivider,
    rugs: [{id: 'r-1', x1: 1.5, z1: 1.5, x2: 6.5, z2: 5.0, color: 'sage'}],
    items: [
      {id: 'boss-1', type: 'boss_desk', x: -4.5, z: -2.5, rotation: 0},
      {id: 'desk-1', type: 'desk', x: -4.5, z: 2.5, rotation: 0},
      {id: 'meet-1', type: 'meeting_table', x: 4.0, z: -2.5, rotation: 0},
      {id: 'break-1', type: 'break_table', x: 4.0, z: 3.0, rotation: 0},
    ],
  });
  assert.equal(built.mode, 'custom');
  assert.equal(built.floors.length, 2);
  assert.equal(built.items.length, 4);
  const customDesk = built.items.find(i => i.id === 'desk-1');
  assert.equal(customDesk.seatIndex, customSeatIndexStart);

  // Actors in custom mode automatically sit at boss_desk, meeting_table, and custom desk (even with legacy seatIndex)
  const placed = placeOfficeActors([
    {key: 'human:boss', fixedSeat: 'boss', state: 'idle', order: 0},
    {key: 'agent:a1', seatIndex: 0, state: 'working', order: 1},
    {key: 'agent:m1', seatIndex: 1, mode: 'meeting_room', sessionId: 'c1', state: 'speaking', order: 2},
  ], 12, built.items, 'custom', built.floors);
  assert.equal(placed.get('human:boss')?.area, 'private');
  assert.equal(placed.get('agent:a1')?.area, 'desk');
  assert.equal(placed.get('agent:m1')?.area, 'meeting');

  // Custom-mode A* pathfinding traverses from west floor (-2.5, 0) to east floor (2.5, 0) through divider doorway at x=0, z=0
  const throughMidDoor = findOfficePath({x: -2.5, z: 0}, {x: 2.5, z: 0}, 12, built.items, built.walls, 'custom', built.floors);
  assert.ok(throughMidDoor.length >= 2);
  assert.equal(throughMidDoor.at(-1).x, 2.5);
  assert.ok(throughMidDoor.every(pt => pt.x >= -8 && pt.x <= 8 && pt.z >= -6 && pt.z <= 6));
});

test('Magnetic wall & floor snapping seals corners cleanly while preserving deliberate gaps', async () => {
  const {snapDrawPoint} = await import('../public/office-furniture.js');
  const {wallSections} = await import('../public/office-walls.js');

  const walls = [
    {id: 'w-north', x1: -6, z1: -5, x2: 6, z2: -5, color: 'sage', doors: []},
    {id: 'w-west', x1: -6, z1: -5, x2: -6, z2: 5, color: 'sage', doors: []},
  ];

  // 1. Start point near existing corner (-6, 5) within snap radius pulls directly to (-6, 5)
  const nearCorner = snapDrawPoint({x: -5.45, z: 4.55}, walls, [], {tool: 'wall', mode: 'custom'});
  assert.equal(nearCorner.x, -6);
  assert.equal(nearCorner.z, 5);
  assert.equal(nearCorner.snapped, 'corner');

  // 2. Start point near wall body (T-junction) snaps flush onto z = -5
  const nearWall = snapDrawPoint({x: 0.12, z: -4.45}, walls, [], {tool: 'wall', mode: 'custom'});
  assert.equal(nearWall.x, 0);
  assert.equal(nearWall.z, -5);
  assert.equal(nearWall.snapped, 'wall');

  // 3. Dragging South wall from (-6, 5) rightwards near x = 6 aligns with North wall's East corner (6, -5)
  const alignBox = snapDrawPoint({x: 5.52, z: 5.1}, walls, [], {tool: 'wall', mode: 'custom', anchor: {x: -6, z: 5}});
  assert.equal(alignBox.x, 6);
  assert.equal(alignBox.z, 5);
  assert.equal(alignBox.snapped, 'align');
  assert.deepEqual(alignBox.guide, {x1: 6, z1: -5, x2: 6, z2: 5});

  // 4. Closing East wall from (6, 5) upwards near North wall snaps directly to corner (6, -5)
  const closeCorner = snapDrawPoint({x: 5.9, z: -4.4}, walls, [], {tool: 'wall', mode: 'custom', anchor: {x: 6, z: 5}});
  assert.equal(closeCorner.x, 6);
  assert.equal(closeCorner.z, -5);
  assert.equal(closeCorner.snapped, 'corner');

  // 5. Deliberate gap (>= 1.0m away) is NOT snapped shut; Alt disableSnap bypasses snapping
  const wideGap = snapDrawPoint({x: -4.5, z: 5.0}, walls, [], {tool: 'wall', mode: 'custom'});
  assert.equal(wideGap.x, -4.5);
  assert.equal(wideGap.snapped, null);
  const bypass = snapDrawPoint({x: -5.45, z: 4.55}, walls, [], {tool: 'wall', mode: 'custom', disableSnap: true});
  assert.equal(bypass.x, -5.5);
  assert.equal(bypass.z, 4.5);
  assert.equal(bypass.snapped, null);

  // 6. Floor tool snaps cleanly to wall corners
  const floorCorner = snapDrawPoint({x: 5.6, z: -4.7}, walls, [], {tool: 'floor', mode: 'custom'});
  assert.equal(floorCorner.x, 6);
  assert.equal(floorCorner.z, -5);
  assert.equal(floorCorner.snapped, 'corner');

  // 7. Merged wallSections at shared corner (-6, -5) completely covers [-6.08, -5.92] x [-5.08, -4.92] with zero gap
  const sections = wallSections(walls, 0.16);
  const coversCorner = sections.some(s => s.x1 <= -6.08 && s.x2 >= -5.92 && s.z1 <= -5.08 && s.z2 >= -4.92);
  assert.equal(coversCorner, true);
});
