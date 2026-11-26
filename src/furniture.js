import { randomUUID } from 'node:crypto';
import { fail } from './input.js';
import { baseWorkstations, customSeatIndexStart, privateOfficeSeatIndex } from '../public/office-presence.js';
import {
  furnitureByType,
  normalizeFloor,
  normalizeRotation,
  normalizeRug,
  snapGrid,
  validateFloorPlacement,
  validateItemPlacement,
  validateRugPlacement,
  validateWallPlacement,
} from '../public/office-furniture.js';
import { workstationCount } from './workstations.js';

const maxItems = 80;
const maxWalls = 64;
const maxFloors = 32;
const maxRugs = 24;

export function getOfficeDecor(store) {
  const saved = store.get('setting', 'office-items');
  return {
    mode: saved?.mode === 'custom' ? 'custom' : 'default',
    floors: Array.isArray(saved?.floors) ? saved.floors : [],
    items: Array.isArray(saved?.items) ? saved.items : [],
    walls: Array.isArray(saved?.walls) ? saved.walls : [],
    rugs: Array.isArray(saved?.rugs) ? saved.rugs : [],
  };
}

export function listOfficeItems(store) {
  return getOfficeDecor(store).items;
}

function occupiedSeatMap(store) {
  const map = new Map();
  for (const kind of ['agent', 'human']) {
    for (const person of store.list(kind)) {
      if (Number.isInteger(person.seatIndex)) map.set(person.seatIndex, person.name);
    }
  }
  return map;
}

const validId = raw => typeof raw === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(raw);

export function saveOfficeItems(store, input) {
  if (!input || !Array.isArray(input.items)) fail('请提供有效的 3D 布置清单');
  if (input.items.length > maxItems) fail(`最多可放置 ${maxItems} 件自定义家具与工位`);
  if (input.mode !== undefined && !['default', 'custom'].includes(input.mode)) fail('无效的空间模式');
  if (input.floors !== undefined && (!Array.isArray(input.floors) || input.floors.length > maxFloors)) {
    fail(`地板区块数量无效，最多 ${maxFloors} 块`);
  }
  if (input.walls !== undefined && (!Array.isArray(input.walls) || input.walls.length > maxWalls)) {
    fail(`自定义墙体数量无效，最多 ${maxWalls} 段`);
  }
  if (input.rugs !== undefined && (!Array.isArray(input.rugs) || input.rugs.length > maxRugs)) {
    fail(`区域地毯数量无效，最多 ${maxRugs} 块`);
  }
  return store.tx(() => {
    const wingCount = workstationCount(store);
    const prevDecor = getOfficeDecor(store);
    const mode = input.mode ?? prevDecor.mode;
    const existing = prevDecor.items;
    const existingById = new Map(existing.map(item => [item.id, item]));
    const occupied = occupiedSeatMap(store);

    // 1. Validate & normalize custom floor slabs
    const rawFloors = input.floors === undefined ? prevDecor.floors : input.floors;
    const floorIds = new Set();
    const finalFloors = [];
    for (const raw of rawFloors) {
      if (!raw || typeof raw !== 'object') fail('地板项格式无效');
      const id = validId(raw.id) && !floorIds.has(raw.id) ? raw.id : randomUUID();
      floorIds.add(id);
      const check = validateFloorPlacement({...raw, id});
      if (!check.ok) fail('自定义地板无效：' + check.reason, 409);
      finalFloors.push({...normalizeFloor(check.floor), id});
    }

    // 2. Validate & normalize walls
    const rawWalls = input.walls === undefined ? prevDecor.walls : input.walls;
    const wallIds = new Set();
    const finalWalls = [];
    for (const raw of rawWalls) {
      if (!raw || typeof raw !== 'object') fail('墙体项格式无效');
      const id = validId(raw.id) && !wallIds.has(raw.id) ? raw.id : randomUUID();
      wallIds.add(id);
      const check = validateWallPlacement({...raw, id}, finalWalls, [], wingCount, null, mode);
      if (!check.ok) fail('自定义墙体无效：' + check.reason, 409);
      finalWalls.push({...check.wall, id});
    }

    // 3. Validate & normalize rugs
    const rawRugs = input.rugs === undefined ? prevDecor.rugs : input.rugs;
    const rugIds = new Set();
    const finalRugs = [];
    for (const raw of rawRugs) {
      if (!raw || typeof raw !== 'object') fail('地毯项格式无效');
      const id = validId(raw.id) && !rugIds.has(raw.id) ? raw.id : randomUUID();
      rugIds.add(id);
      const check = validateRugPlacement({...raw, id}, wingCount, mode, finalFloors);
      if (!check.ok) fail('区域地毯无效：' + check.reason, 409);
      finalRugs.push({...normalizeRug(check.rug), id});
    }

    // 4. Validate items against floor coverage, walls, doorways, and other items
    const usedSeatIndices = new Set([privateOfficeSeatIndex]);
    for (let i = 0; i < wingCount; i++) usedSeatIndices.add(i);

    const incomingIds = new Set();
    const sanitized = [];
    for (const raw of input.items) {
      if (!raw || typeof raw !== 'object') fail('家具项格式无效');
      const type = raw.type;
      if (!furnitureByType[type]) fail('不支持的家具类型：' + String(type));
      const x = Number(raw.x);
      const z = Number(raw.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) fail('家具坐标无效');
      const rotation = normalizeRotation(raw.rotation);
      const prior = typeof raw.id === 'string' && existingById.has(raw.id) ? existingById.get(raw.id) : null;
      if (prior && prior.type !== type) fail('不能更改已有家具的类型');
      const id = prior ? prior.id : (validId(raw.id) && !incomingIds.has(raw.id) ? raw.id : randomUUID());
      if (incomingIds.has(id)) fail('家具标识重复');
      incomingIds.add(id);

      const candidate = {
        id,
        type,
        x: snapGrid(x),
        z: snapGrid(z),
        rotation,
        ...(prior?.seatIndex !== undefined ? {seatIndex: prior.seatIndex} : {}),
      };
      if (candidate.seatIndex !== undefined) usedSeatIndices.add(candidate.seatIndex);
      const check = validateItemPlacement(candidate, sanitized, wingCount, null, finalWalls, mode, finalFloors);
      if (!check.ok) fail(`${furnitureByType[type].name}放置无效：${check.reason}`, 409);
      sanitized.push(candidate);
    }

    // Protect occupied custom desks from being removed
    for (const prev of existing) {
      if (prev.type === 'desk' && prev.seatIndex !== undefined && !incomingIds.has(prev.id)) {
        if (occupied.has(prev.seatIndex)) {
          fail(`自定义工位已有员工「${occupied.get(prev.seatIndex)}」入座，无法删除`, 409);
        }
      }
    }

    // Assign stable seatIndex (>= customSeatIndexStart) for newly added custom desks
    const nextSeat = () => {
      let idx = customSeatIndexStart;
      while (usedSeatIndices.has(idx) || occupied.has(idx)) idx++;
      usedSeatIndices.add(idx);
      return idx;
    };
    const finalItems = sanitized.map(item => (
      item.type === 'desk' && item.seatIndex === undefined
        ? {...item, seatIndex: nextSeat()}
        : item
    ));

    store.put('setting', {
      id: 'office-items',
      mode,
      floors: finalFloors,
      items: finalItems,
      walls: finalWalls,
      rugs: finalRugs,
      updatedAt: new Date().toISOString(),
    });
    store.event('layout.furniture_saved', {
      mode,
      floors: finalFloors.length,
      count: finalItems.length,
      desks: finalItems.filter(item => item.type === 'desk').length,
      walls: finalWalls.length,
      rugs: finalRugs.length,
      name: mode === 'custom'
        ? `自建 3D 空间（墙 ${finalWalls.length} · 地板 ${finalFloors.length} · 摆件 ${finalItems.length}）`
        : `3D 布置（家具 ${finalItems.length} · 墙体 ${finalWalls.length}${finalRugs.length ? ' · 地毯 ' + finalRugs.length : ''}）`,
    });
    return {mode, floors: finalFloors, items: finalItems, walls: finalWalls, rugs: finalRugs};
  });
}
