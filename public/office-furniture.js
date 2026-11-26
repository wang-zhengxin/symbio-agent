// Shared catalog, collision validator, and 2D A* grid pathfinder for 3D office placement.
// Pure ESM with zero DOM/Three dependencies so both Node (server/tests) and browser can import it.

export const gridStep = 0.5;
export const validRotations = [0, 90, 180, 270];
export const doorWidth = 1.4;
export const wallSnapRadius = 0.85;
export const customCanvasBounds = {minX: -12, maxX: 12, minZ: -10, maxZ: 10};
export const wallPalette = {sage: '灰绿墙', slate: '岩蓝墙', warm: '暖米墙', plum: '雾紫墙'};
export const floorPalette = {carpet: '编织地毯', wood: '暖橡木', stone: '浅灰石', sage: '灰绿砖'};
export const rugPalette = {sand: '暖沙地毯', sage: '苔绿地毯', slate: '雾蓝地毯', terracotta: '陶土地毯'};

export const furnitureCatalog = [
  {
    type: 'desk',
    name: '工位桌椅',
    category: 'seat',
    width: 2.2,
    depth: 1.7,
    seatOffset: [0, 0.66],
    description: '可分配给智能体或真人员工的完整 3D 工位',
  },
  {
    type: 'boss_desk',
    name: '老板办公桌',
    category: 'zone',
    width: 2.3,
    depth: 1.9,
    seatOffset: [0, -0.78],
    description: '独立行政办公桌，管理员自动入座',
  },
  {
    type: 'reception',
    name: '前台接待台',
    category: 'zone',
    width: 2.4,
    depth: 1.4,
    seatOffset: [0, -0.32],
    description: '弧形接待台，前台自动入座',
  },
  {
    type: 'meeting_table',
    name: '会议长桌',
    category: 'zone',
    width: 3.2,
    depth: 2.3,
    description: '6 人评审会议桌，多人讨论自动入座',
  },
  {
    type: 'break_table',
    name: '休息长桌',
    category: 'zone',
    width: 3.4,
    depth: 2.1,
    description: '6 人休闲长桌，空闲成员随机错峰休息',
  },
  {
    type: 'plant',
    name: '绿植盆栽',
    category: 'decor',
    width: 0.85,
    depth: 0.85,
    description: '室内阔叶盆栽，点缀过道与角落',
  },
  {
    type: 'bookcase',
    name: '木质书架',
    category: 'decor',
    width: 1.9,
    depth: 0.6,
    description: '多层开放式书柜与资料架',
  },
  {
    type: 'partition',
    name: '磨砂隔断',
    category: 'decor',
    width: 2.0,
    depth: 0.28,
    description: '半高隐私屏风，划分功能微区',
  },
  {
    type: 'cafe_table',
    name: '休闲圆桌',
    category: 'decor',
    width: 1.9,
    depth: 1.1,
    description: '双人洽谈圆桌配两把休闲椅',
  },
  {
    type: 'sofa',
    name: '双人沙发',
    category: 'decor',
    width: 1.85,
    depth: 0.9,
    description: '暖灰布艺休息沙发',
  },
  {
    type: 'whiteboard',
    name: '移动白板',
    category: 'decor',
    width: 1.5,
    depth: 0.5,
    description: '带滑轮的双面讨论白板',
  },
  {
    type: 'server_rack',
    name: 'AI 机柜',
    category: 'decor',
    width: 0.9,
    depth: 0.9,
    description: '算力节点机柜与状态指示灯',
  },
  {
    type: 'coffee_station',
    name: '迷你咖啡台',
    category: 'decor',
    width: 1.3,
    depth: 0.75,
    description: '便携咖啡机与杯具边柜',
  },
];

export const furnitureByType = Object.fromEntries(furnitureCatalog.map(item => [item.type, item]));

export const snapGrid = value => Math.round(value / gridStep) * gridStep;

export function normalizeRotation(deg) {
  const normalized = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
  return validRotations.includes(normalized) ? normalized : 0;
}

export function rotationRadians(deg) {
  return (normalizeRotation(deg) * Math.PI) / 180;
}

export function rotateOffset(dx, dz, deg) {
  const rad = rotationRadians(deg);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Matches Three.js Object3D rotation.y convention:
  // x' = x*cos(a) + z*sin(a), z' = -x*sin(a) + z*cos(a)
  return [dx * c + dz * s, -dx * s + dz * c];
}

export function itemFootprint(item, pad = 0) {
  const spec = furnitureByType[item.type];
  if (!spec) return null;
  const rot = normalizeRotation(item.rotation);
  const rotated = rot === 90 || rot === 270;
  const w = (rotated ? spec.depth : spec.width) / 2 + pad;
  const d = (rotated ? spec.width : spec.depth) / 2 + pad;
  return {minX: item.x - w, maxX: item.x + w, minZ: item.z - d, maxZ: item.z + d};
}

export function customDeskSeatPose(item) {
  const spec = furnitureByType.desk;
  const [dx, dz] = rotateOffset(spec.seatOffset[0], spec.seatOffset[1], item.rotation);
  const [ex, ez] = rotateOffset(spec.seatOffset[0], spec.seatOffset[1] + 0.72, item.rotation);
  const angle = Math.PI + rotationRadians(item.rotation);
  return {
    x: item.x + dx,
    z: item.z + dz,
    angle,
    seated: true,
    area: 'desk',
    exit: [{x: item.x + ex, z: item.z + ez}],
  };
}

export function customSpecialSeats(items = []) {
  let bossSeat = null;
  let receptionSeat = null;
  const meetingSeats = [];
  const loungeSeats = [];
  for (const item of items) {
    const rad = rotationRadians(item.rotation);
    const place = (dx, dz, localAngle, area, exitDx = dx, exitDz = dz) => {
      const [wx, wz] = rotateOffset(dx, dz, item.rotation);
      const [ex, ez] = rotateOffset(exitDx, exitDz, item.rotation);
      return {
        x: item.x + wx,
        z: item.z + wz,
        angle: localAngle + rad,
        seated: true,
        area,
        exit: [{x: item.x + ex, z: item.z + ez}],
      };
    };
    if (item.type === 'boss_desk' && !bossSeat) {
      bossSeat = place(0, -0.78, 0, 'private', 0, -1.35);
    } else if (item.type === 'reception' && !receptionSeat) {
      receptionSeat = place(0, -0.32, 0, 'reception', 0, -0.95);
    } else if (item.type === 'meeting_table') {
      for (const ox of [-0.95, 0, 0.95]) {
        meetingSeats.push(place(ox, -0.92, 0, 'meeting', ox, -1.45));
        meetingSeats.push(place(ox, 0.92, Math.PI, 'meeting', ox, 1.45));
      }
    } else if (item.type === 'break_table') {
      for (const ox of [-1.0, 0, 1.0]) {
        loungeSeats.push(place(ox, -0.82, 0, 'lounge', ox, -1.35));
        loungeSeats.push(place(ox, 0.82, Math.PI, 'lounge', ox, 1.35));
      }
    } else if (item.type === 'cafe_table') {
      loungeSeats.push(place(-0.76, 0, Math.PI / 2, 'lounge', -1.25, 0));
      loungeSeats.push(place(0.76, 0, -Math.PI / 2, 'lounge', 1.25, 0));
    } else if (item.type === 'sofa') {
      loungeSeats.push(place(-0.4, 0.12, 0, 'lounge', -0.4, 0.8));
      loungeSeats.push(place(0.4, 0.12, 0, 'lounge', 0.4, 0.8));
    }
  }
  return {bossSeat, receptionSeat, meetingSeats, loungeSeats};
}

export function normalizeFloor(raw) {
  const x1 = snapGrid(Math.min(Number(raw.x1), Number(raw.x2)));
  const x2 = snapGrid(Math.max(Number(raw.x1), Number(raw.x2)));
  const z1 = snapGrid(Math.min(Number(raw.z1), Number(raw.z2)));
  const z2 = snapGrid(Math.max(Number(raw.z1), Number(raw.z2)));
  const material = Object.hasOwn(floorPalette, raw.material) ? raw.material : 'carpet';
  return {id: raw.id, x1, z1, x2, z2, material};
}

export function validateFloorPlacement(raw) {
  const floor = normalizeFloor(raw);
  if (![floor.x1, floor.x2, floor.z1, floor.z2].every(Number.isFinite)) return {ok: false, reason: '地板坐标无效'};
  if (floor.x2 - floor.x1 < 1.0 || floor.z2 - floor.z1 < 1.0) return {ok: false, reason: '地板尺寸至少 1.0×1.0m'};
  if (floor.x1 < customCanvasBounds.minX || floor.x2 > customCanvasBounds.maxX ||
      floor.z1 < customCanvasBounds.minZ || floor.z2 > customCanvasBounds.maxZ) {
    return {ok: false, reason: '地板超出自建画布范围（24×20m）'};
  }
  return {ok: true, floor};
}

export function pointOnCustomFloors(x, z, floors = [], margin = 0.02) {
  return floors.some(f => x >= f.x1 - margin && x <= f.x2 + margin && z >= f.z1 - margin && z <= f.z2 + margin);
}

export function boxCoveredByFloors(box, floors = []) {
  if (!floors.length) return false;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const pts = [
    [cx, cz],
    [box.minX + 0.08, box.minZ + 0.08],
    [box.maxX - 0.08, box.minZ + 0.08],
    [box.minX + 0.08, box.maxZ - 0.08],
    [box.maxX - 0.08, box.maxZ - 0.08],
  ];
  return pts.every(([x, z]) => pointOnCustomFloors(x, z, floors, 0.05));
}

export function boxesOverlap(a, b, epsilon = 0.04) {
  return a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon &&
    a.minZ < b.maxZ - epsilon && a.maxZ > b.minZ + epsilon;
}

const boxFromCenter = (cx, cz, w, d) => ({minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2});
const boxFromWallX = (x1, x2, z, t = 0.36) => ({minX: Math.min(x1, x2) - t / 2, maxX: Math.max(x1, x2) + t / 2, minZ: z - t / 2, maxZ: z + t / 2});
const boxFromWallZ = (z1, z2, x, t = 0.36) => ({minX: x - t / 2, maxX: x + t / 2, minZ: Math.min(z1, z2) - t / 2, maxZ: Math.max(z1, z2) + t / 2});

const baseDesks = [
  [-5.5, -1.65], [-2.65, -1.65], [0.25, -1.65],
  [-5.5, 1.05], [-2.65, 1.05], [0.25, 1.05],
  [5.15, 0.05], [7.85, 0.05], [7.85, -1.8],
  [-2.05, -5.7], [0.85, -5.7],
];

const wingColumnWidth = 2.85;
export const baseOfficeEast = wingCount => 10 + Math.ceil(Math.max(0, wingCount - 12) / 2) * wingColumnWidth;

function extraWingDeskPositions(wingCount) {
  return Array.from({length: Math.max(0, wingCount - 12)}, (_, index) => [
    11.26 + Math.floor(index / 2) * wingColumnWidth,
    index % 2 === 0 ? 1.05 : -1.65,
  ]);
}

export function officeWallBoxes(wingCount = 12) {
  const east = baseOfficeEast(wingCount);
  const walls = [
    boxFromWallX(-10, 10, -8),
    boxFromWallZ(-8, 8, -10),
    boxFromWallZ(-8, -2.95, 10),
    boxFromWallX(-10, -5.25, -3.63),
    boxFromWallZ(-8, -3.63, -3.6),
    boxFromWallX(3.28, 7.73, -3.58),
    boxFromWallZ(-8, -3.58, 3.28),
    boxFromWallX(3.22, 10, 2.92),
    boxFromWallZ(2.92, 4.1, 3.22),
    boxFromWallZ(5.39, 8, 3.22),
    boxFromWallZ(2.92, 8, 10),
    boxFromWallX(-10, 10, 8),
  ];
  if (east > 10) {
    walls.push(
      boxFromWallX(10, east, -2.95),
      boxFromWallX(10, east, 3.15),
      boxFromWallZ(-2.95, 3.15, east),
    );
  } else {
    walls.push(boxFromWallZ(-2.95, 2.92, 10));
  }
  return walls;
}

export function staticFurnitureBoxes(wingCount = 12) {
  const boxes = [
    // Built-in desks (table + chair clearance)
    ...baseDesks.map(([x, z]) => boxFromCenter(x, z + 0.18, 2.25, 1.55)),
    ...extraWingDeskPositions(wingCount).map(([x, z]) => boxFromCenter(x, z + 0.18, 2.25, 1.55)),
    // Boss private office desk & chairs
    boxFromCenter(-6.88, -5.55, 2.35, 2.25),
    // North bookcase
    boxFromCenter(-1.7, -7.6, 2.1, 0.72),
    // Meeting room table & chairs (top-right)
    boxFromCenter(6.35, -5.7, 4.35, 2.75),
    boxFromCenter(9.28, -7.12, 0.9, 0.85),
    // Reception counter & side cabinet
    boxFromCenter(-7.05, 5.75, 3.1, 2.35),
    boxFromCenter(-9.5, 4.83, 0.85, 2.25),
    // Café chat tables
    boxFromCenter(-4.35, 5.65, 2.15, 1.05),
    boxFromCenter(-0.6, 5.65, 2.15, 1.05),
    // Break room vending machines, kitchenette, and 8-seat long table
    boxFromCenter(4.87, 3.55, 2.05, 1.05),
    boxFromCenter(8.15, 3.55, 2.45, 1.1),
    boxFromCenter(6.65, 5.95, 4.75, 2.35),
    // Corner built-in plants
    ...[[-9.24, -7.18], [-9.3, 2.78], [1.15, -7.27], [9.26, 1.53], [9.15, 7.28], [-4.95, 7.36]]
      .map(([x, z]) => boxFromCenter(x, z, 0.85, 0.85)),
  ];
  return boxes;
}

// Doorway clear zones so users cannot accidentally block room entrances.
const doorwayClearBoxes = [
  boxFromCenter(-4.42, -3.63, 1.45, 1.25), // Boss office doorway
  boxFromCenter(8.85, -3.58, 1.65, 1.25),  // Meeting room doorway
  boxFromCenter(3.22, 4.74, 1.25, 1.25),   // Break room doorway
];

export function insideOfficeFloor(box, wingCount = 12) {
  const east = baseOfficeEast(wingCount);
  const inMain = box.minX >= -9.75 && box.maxX <= 9.75 && box.minZ >= -7.75 && box.maxZ <= 7.75;
  if (inMain) return true;
  if (east > 10) {
    const inWing = box.minX >= 9.4 && box.maxX <= east - 0.25 && box.minZ >= -2.7 && box.maxZ <= 2.9;
    const straddlesWing = box.minX >= -9.75 && box.maxX <= east - 0.25 && box.minZ >= -2.7 && box.maxZ <= 2.9;
    if (inWing || straddlesWing) return true;
  }
  return false;
}

export function wallAxis(wall) {
  return Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1) ? 'x' : 'z';
}

export function wallLength(wall) {
  return Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
}

export function normalizeWall(raw) {
  let x1 = snapGrid(Number(raw.x1));
  let z1 = snapGrid(Number(raw.z1));
  let x2 = snapGrid(Number(raw.x2));
  let z2 = snapGrid(Number(raw.z2));
  if (Math.abs(x2 - x1) >= Math.abs(z2 - z1)) {
    z2 = z1;
    if (x1 > x2) [x1, x2] = [x2, x1];
  } else {
    x2 = x1;
    if (z1 > z2) [z1, z2] = [z2, z1];
  }
  const len = Math.hypot(x2 - x1, z2 - z1);
  const color = Object.hasOwn(wallPalette, raw.color) ? raw.color : 'sage';
  const rawDoors = Array.isArray(raw.doors) ? raw.doors : [];
  const doors = [];
  for (const d of rawDoors.map(v => snapGrid(Number(v))).filter(Number.isFinite).sort((a, b) => a - b)) {
    if (d < 0.85 || d > len - 0.85) continue;
    if (doors.some(prev => Math.abs(prev - d) < doorWidth + 0.2)) continue;
    doors.push(d);
  }
  return {id: raw.id, x1, z1, x2, z2, color, doors};
}

export function wallSubSegments(wall) {
  const axis = wallAxis(wall);
  const len = wallLength(wall);
  const half = doorWidth / 2;
  const doors = [...(wall.doors ?? [])].sort((a, b) => a - b);
  const solids = [];
  const lintels = [];
  const doorBoxes = [];
  let cursor = 0;

  const makeSeg = (a, b) => axis === 'x'
    ? {x1: wall.x1 + a, z1: wall.z1, x2: wall.x1 + b, z2: wall.z1, color: wall.color}
    : {x1: wall.x1, z1: wall.z1 + a, x2: wall.x1, z2: wall.z1 + b, color: wall.color};

  for (const offset of doors) {
    const start = Math.max(cursor, offset - half);
    const end = Math.min(len, offset + half);
    if (start - cursor > 0.05) solids.push(makeSeg(cursor, start));
    if (end - start > 0.2) {
      lintels.push(makeSeg(start, end));
      const mid = (start + end) / 2;
      doorBoxes.push(axis === 'x'
        ? boxFromCenter(wall.x1 + mid, wall.z1, end - start, 1.0)
        : boxFromCenter(wall.x1, wall.z1 + mid, 1.0, end - start));
    }
    cursor = Math.max(cursor, end);
  }
  if (len - cursor > 0.05) solids.push(makeSeg(cursor, len));
  return {solids, lintels, doorBoxes};
}

export function customWallBoxes(walls = [], thickness = 0.26) {
  const boxes = [];
  for (const wall of walls) {
    const {solids} = wallSubSegments(wall);
    for (const seg of solids) {
      boxes.push(seg.z1 === seg.z2
        ? boxFromWallX(seg.x1, seg.x2, seg.z1, thickness)
        : boxFromWallZ(seg.z1, seg.z2, seg.x1, thickness));
    }
  }
  return boxes;
}

export function customDoorBoxes(walls = []) {
  return walls.flatMap(wall => wallSubSegments(wall).doorBoxes);
}

export function validateDoorPlacement(wall, offset) {
  const len = wallLength(wall);
  const snapped = snapGrid(offset);
  if (len < doorWidth + 0.5) return {ok: false, reason: '墙体过短，至少需 2.0m 才能开门洞'};
  if (snapped < 0.85 || snapped > len - 0.85) return {ok: false, reason: '门洞需距墙端至少 0.85m'};
  if ((wall.doors ?? []).some(d => Math.abs(d - snapped) < doorWidth + 0.25)) {
    return {ok: false, reason: '与已有门洞距离过近'};
  }
  return {ok: true, offset: snapped};
}

export function validateWallPlacement(candidate, existingWalls = [], existingItems = [], wingCount = 12, ignoreId = null, mode = 'default') {
  if (!candidate) return {ok: false, reason: '墙体参数无效'};
  const wall = normalizeWall(candidate);
  const len = wallLength(wall);
  if (!Number.isFinite(len) || len < 1.0) return {ok: false, reason: '墙体长度至少 1.0m'};
  if (len > (mode === 'custom' ? 24 : 18)) return {ok: false, reason: mode === 'custom' ? '单段墙体最长 24m' : '单段墙体最长 18m'};
  const axis = wallAxis(wall);
  const fullBox = axis === 'x'
    ? boxFromWallX(wall.x1, wall.x2, wall.z1, 0.22)
    : boxFromWallZ(wall.z1, wall.z2, wall.x1, 0.22);
  if (mode === 'custom') {
    if (wall.x1 < customCanvasBounds.minX || wall.x2 > customCanvasBounds.maxX ||
        wall.z1 < customCanvasBounds.minZ || wall.z2 > customCanvasBounds.maxZ) {
      return {ok: false, reason: '墙体超出自建画布范围（24×20m）'};
    }
  } else {
    const east = baseOfficeEast(wingCount);
    const inMainWalls = wall.x1 >= -10 && wall.x2 <= 10 && wall.z1 >= -8 && wall.z2 <= 8;
    const inWingWalls = east > 10 && wall.x1 >= -10 && wall.x2 <= east && wall.z1 >= -2.95 && wall.z2 <= 3.15;
    if (!inMainWalls && !inWingWalls) {
      return {ok: false, reason: '墙体超出办公室地面范围'};
    }
    for (const door of doorwayClearBoxes) {
      if (boxesOverlap(fullBox, door, 0.06)) return {ok: false, reason: '请勿封堵房间固有门洞'};
    }
  }
  const solidBoxes = customWallBoxes([wall], 0.24);
  for (const sb of solidBoxes) {
    if (mode !== 'custom') {
      for (const fixed of staticFurnitureBoxes(wingCount)) {
        if (boxesOverlap(sb, fixed, 0.06)) return {ok: false, reason: '墙体穿过已有固定家具'};
      }
    }
    for (const item of existingItems) {
      const ib = itemFootprint(item, 0.02);
      if (ib && boxesOverlap(sb, ib, 0.06)) return {ok: false, reason: '墙体穿过已放置家具'};
    }
  }
  for (const other of existingWalls) {
    if (ignoreId && other.id === ignoreId) continue;
    if (wallAxis(other) === axis) {
      const sameLine = axis === 'x' ? Math.abs(other.z1 - wall.z1) < 0.2 : Math.abs(other.x1 - wall.x1) < 0.2;
      if (sameLine) {
        const [a1, a2] = axis === 'x' ? [wall.x1, wall.x2] : [wall.z1, wall.z2];
        const [b1, b2] = axis === 'x' ? [other.x1, other.x2] : [other.z1, other.z2];
        if (Math.min(a2, b2) - Math.max(a1, b1) > 0.25) return {ok: false, reason: '与已有墙体重合'};
      }
    }
  }
  return {ok: true, wall};
}

function defaultOuterWallSegments(wingCount = 12) {
  const east = baseOfficeEast(wingCount);
  const segs = [
    {x1: -10, z1: -8, x2: 10, z2: -8},
    {x1: -10, z1: 8, x2: 10, z2: 8},
    {x1: -10, z1: -8, x2: -10, z2: 8},
  ];
  if (east > 10) {
    segs.push(
      {x1: 10, z1: -8, x2: 10, z2: -3},
      {x1: 10, z1: 3, x2: 10, z2: 8},
      {x1: 10, z1: -3, x2: east, z2: -3},
      {x1: 10, z1: 3, x2: east, z2: 3},
      {x1: east, z1: -3, x2: east, z2: 3},
    );
  } else {
    segs.push({x1: 10, z1: -8, x2: 10, z2: 8});
  }
  return segs;
}

export function snapDrawPoint(rawPoint, walls = [], floors = [], options = {}) {
  if (!rawPoint || !Number.isFinite(rawPoint.x) || !Number.isFinite(rawPoint.z)) return null;
  const {
    anchor = null,
    tool = 'wall',
    mode = 'custom',
    wingCount = 12,
    radius = wallSnapRadius,
    disableSnap = false,
  } = options;
  const clampPoint = (x, z) => {
    if (mode === 'custom') {
      return {
        x: Math.max(customCanvasBounds.minX, Math.min(customCanvasBounds.maxX, x)),
        z: Math.max(customCanvasBounds.minZ, Math.min(customCanvasBounds.maxZ, z)),
      };
    }
    const east = baseOfficeEast(wingCount);
    return {
      x: Math.max(-10, Math.min(east, x)),
      z: Math.max(-8, Math.min(8, z)),
    };
  };

  if (disableSnap) {
    const clamped = clampPoint(snapGrid(rawPoint.x), snapGrid(rawPoint.z));
    return {...clamped, snapped: null, snapPoint: null, guide: null, label: ''};
  }

  const snapWalls = mode === 'custom' ? walls : [...walls, ...defaultOuterWallSegments(wingCount)];
  const wallEndpoints = [];
  for (const w of snapWalls) {
    wallEndpoints.push({x: w.x1, z: w.z1}, {x: w.x2, z: w.z2});
  }

  if (tool === 'wall') {
    if (!anchor) {
      // 1. Snap start point directly to nearest wall corner/endpoint
      let bestCorner = null;
      let bestCornerDist = radius;
      for (const ep of wallEndpoints) {
        const d = Math.hypot(rawPoint.x - ep.x, rawPoint.z - ep.z);
        if (d <= bestCornerDist) {
          bestCornerDist = d;
          bestCorner = ep;
        }
      }
      if (bestCorner) {
        const pt = clampPoint(bestCorner.x, bestCorner.z);
        return {...pt, snapped: 'corner', snapPoint: pt, guide: null, label: '已吸附墙角'};
      }

      // 2. Snap start point perpendicularly onto an existing wall segment (for clean T-junctions)
      const wallRadius = Math.min(radius, 0.75);
      let bestProj = null;
      let bestProjDist = wallRadius;
      for (const w of snapWalls) {
        const alongX = Math.abs(w.x2 - w.x1) >= Math.abs(w.z2 - w.z1);
        if (alongX) {
          const minX = Math.min(w.x1, w.x2), maxX = Math.max(w.x1, w.x2);
          if (rawPoint.x >= minX - 0.25 && rawPoint.x <= maxX + 0.25) {
            const dist = Math.abs(rawPoint.z - w.z1);
            if (dist <= bestProjDist) {
              bestProjDist = dist;
              const px = Math.max(minX, Math.min(maxX, snapGrid(rawPoint.x)));
              bestProj = {x: px, z: w.z1};
            }
          }
        } else {
          const minZ = Math.min(w.z1, w.z2), maxZ = Math.max(w.z1, w.z2);
          if (rawPoint.z >= minZ - 0.25 && rawPoint.z <= maxZ + 0.25) {
            const dist = Math.abs(rawPoint.x - w.x1);
            if (dist <= bestProjDist) {
              bestProjDist = dist;
              const pz = Math.max(minZ, Math.min(maxZ, snapGrid(rawPoint.z)));
              bestProj = {x: w.x1, z: pz};
            }
          }
        }
      }
      if (bestProj) {
        const pt = clampPoint(bestProj.x, bestProj.z);
        return {...pt, snapped: 'wall', snapPoint: pt, guide: null, label: '已吸附墙面'};
      }

      const fallback = clampPoint(snapGrid(rawPoint.x), snapGrid(rawPoint.z));
      return {...fallback, snapped: null, snapPoint: null, guide: null, label: ''};
    }

    // With anchor: dragging an orthogonal wall from anchor -> end
    const alongX = Math.abs(rawPoint.x - anchor.x) >= Math.abs(rawPoint.z - anchor.z);
    if (alongX) {
      const z = anchor.z;
      // 1. Exact corner on the same horizontal line (or closing onto a vertical wall endpoint)
      let best = null;
      let bestDist = radius;
      for (const ep of wallEndpoints) {
        if (Math.abs(ep.x - anchor.x) < 0.5) continue;
        if (Math.abs(ep.z - z) <= 0.05) {
          const d = Math.abs(rawPoint.x - ep.x);
          if (d <= bestDist) {
            bestDist = d;
            best = {x: ep.x, z, snapped: 'corner', guide: null, label: '已吸附墙角'};
          }
        }
      }
      if (best) {
        const pt = clampPoint(best.x, best.z);
        return {...pt, snapped: best.snapped, snapPoint: pt, guide: null, label: best.label};
      }

      // 2. Meet a perpendicular vertical wall along this horizontal ray (L-corner or T-junction)
      let bestWallHit = null;
      let bestWallDist = radius;
      for (const w of snapWalls) {
        if (Math.abs(w.x2 - w.x1) >= Math.abs(w.z2 - w.z1)) continue; // only vertical walls
        if (Math.abs(w.x1 - anchor.x) < 0.5) continue;
        const minZ = Math.min(w.z1, w.z2), maxZ = Math.max(w.z1, w.z2);
        if (z >= minZ - 0.1 && z <= maxZ + 0.1) {
          const d = Math.abs(rawPoint.x - w.x1);
          if (d <= bestWallDist) {
            bestWallDist = d;
            const atEnd = Math.abs(z - minZ) <= 0.1 || Math.abs(z - maxZ) <= 0.1;
            bestWallHit = {
              x: w.x1, z,
              snapped: atEnd ? 'corner' : 'wall',
              label: atEnd ? '已吸附转角' : '已吸附墙面',
            };
          }
        }
      }
      if (bestWallHit) {
        const pt = clampPoint(bestWallHit.x, bestWallHit.z);
        return {...pt, snapped: bestWallHit.snapped, snapPoint: pt, guide: null, label: bestWallHit.label};
      }

      // 3. Align X with a distant wall endpoint (makes closing rectangular rooms effortless)
      const alignRadius = Math.min(radius, 0.72);
      let bestAlign = null;
      let bestAlignDist = alignRadius;
      for (const ep of wallEndpoints) {
        if (Math.abs(ep.x - anchor.x) < 0.5) continue;
        const d = Math.abs(rawPoint.x - ep.x);
        if (d <= bestAlignDist) {
          bestAlignDist = d;
          bestAlign = ep;
        }
      }
      if (bestAlign) {
        const pt = clampPoint(bestAlign.x, z);
        return {
          ...pt,
          snapped: 'align',
          snapPoint: pt,
          guide: {x1: bestAlign.x, z1: bestAlign.z, x2: pt.x, z2: pt.z},
          label: '已对齐转角',
        };
      }

      const fallback = clampPoint(snapGrid(rawPoint.x), z);
      return {...fallback, snapped: null, snapPoint: null, guide: null, label: ''};
    } else {
      const x = anchor.x;
      // 1. Exact corner on the same vertical line
      let best = null;
      let bestDist = radius;
      for (const ep of wallEndpoints) {
        if (Math.abs(ep.z - anchor.z) < 0.5) continue;
        if (Math.abs(ep.x - x) <= 0.05) {
          const d = Math.abs(rawPoint.z - ep.z);
          if (d <= bestDist) {
            bestDist = d;
            best = {x, z: ep.z, snapped: 'corner', guide: null, label: '已吸附墙角'};
          }
        }
      }
      if (best) {
        const pt = clampPoint(best.x, best.z);
        return {...pt, snapped: best.snapped, snapPoint: pt, guide: null, label: best.label};
      }

      // 2. Meet a perpendicular horizontal wall along this vertical ray
      let bestWallHit = null;
      let bestWallDist = radius;
      for (const w of snapWalls) {
        if (Math.abs(w.x2 - w.x1) < Math.abs(w.z2 - w.z1)) continue; // only horizontal walls
        if (Math.abs(w.z1 - anchor.z) < 0.5) continue;
        const minX = Math.min(w.x1, w.x2), maxX = Math.max(w.x1, w.x2);
        if (x >= minX - 0.1 && x <= maxX + 0.1) {
          const d = Math.abs(rawPoint.z - w.z1);
          if (d <= bestWallDist) {
            bestWallDist = d;
            const atEnd = Math.abs(x - minX) <= 0.1 || Math.abs(x - maxX) <= 0.1;
            bestWallHit = {
              x, z: w.z1,
              snapped: atEnd ? 'corner' : 'wall',
              label: atEnd ? '已吸附转角' : '已吸附墙面',
            };
          }
        }
      }
      if (bestWallHit) {
        const pt = clampPoint(bestWallHit.x, bestWallHit.z);
        return {...pt, snapped: bestWallHit.snapped, snapPoint: pt, guide: null, label: bestWallHit.label};
      }

      // 3. Align Z with a distant wall endpoint
      const alignRadius = Math.min(radius, 0.72);
      let bestAlign = null;
      let bestAlignDist = alignRadius;
      for (const ep of wallEndpoints) {
        if (Math.abs(ep.z - anchor.z) < 0.5) continue;
        const d = Math.abs(rawPoint.z - ep.z);
        if (d <= bestAlignDist) {
          bestAlignDist = d;
          bestAlign = ep;
        }
      }
      if (bestAlign) {
        const pt = clampPoint(x, bestAlign.z);
        return {
          ...pt,
          snapped: 'align',
          snapPoint: pt,
          guide: {x1: bestAlign.x, z1: bestAlign.z, x2: pt.x, z2: pt.z},
          label: '已对齐转角',
        };
      }

      const fallback = clampPoint(x, snapGrid(rawPoint.z));
      return {...fallback, snapped: null, snapPoint: null, guide: null, label: ''};
    }
  }

  // Floor & rug tools: snap to wall endpoints, floor corners, and wall/floor edges
  const corners = [...wallEndpoints];
  const xLines = new Set();
  const zLines = new Set();
  for (const w of snapWalls) {
    if (Math.abs(w.x2 - w.x1) >= Math.abs(w.z2 - w.z1)) zLines.add(w.z1);
    else xLines.add(w.x1);
  }
  for (const f of floors) {
    corners.push({x: f.x1, z: f.z1}, {x: f.x2, z: f.z1}, {x: f.x1, z: f.z2}, {x: f.x2, z: f.z2});
    xLines.add(f.x1); xLines.add(f.x2);
    zLines.add(f.z1); zLines.add(f.z2);
  }
  let bestCorner = null;
  let bestCornerDist = radius;
  for (const c of corners) {
    const d = Math.hypot(rawPoint.x - c.x, rawPoint.z - c.z);
    if (d <= bestCornerDist) {
      bestCornerDist = d;
      bestCorner = c;
    }
  }
  if (bestCorner) {
    const pt = clampPoint(bestCorner.x, bestCorner.z);
    return {...pt, snapped: 'corner', snapPoint: pt, guide: null, label: '已吸附墙角'};
  }
  const edgeRadius = Math.min(radius, 0.65);
  let sx = snapGrid(rawPoint.x), sz = snapGrid(rawPoint.z);
  let snappedAxis = false;
  let bestDx = edgeRadius;
  for (const lx of xLines) {
    const d = Math.abs(rawPoint.x - lx);
    if (d <= bestDx) { bestDx = d; sx = lx; snappedAxis = true; }
  }
  let bestDz = edgeRadius;
  for (const lz of zLines) {
    const d = Math.abs(rawPoint.z - lz);
    if (d <= bestDz) { bestDz = d; sz = lz; snappedAxis = true; }
  }
  const pt = clampPoint(sx, sz);
  return {
    ...pt,
    snapped: snappedAxis ? 'wall' : null,
    snapPoint: snappedAxis ? pt : null,
    guide: null,
    label: snappedAxis ? '已吸附边缘' : '',
  };
}

export function normalizeRug(raw) {
  const x1 = snapGrid(Math.min(Number(raw.x1), Number(raw.x2)));
  const x2 = snapGrid(Math.max(Number(raw.x1), Number(raw.x2)));
  const z1 = snapGrid(Math.min(Number(raw.z1), Number(raw.z2)));
  const z2 = snapGrid(Math.max(Number(raw.z1), Number(raw.z2)));
  const color = Object.hasOwn(rugPalette, raw.color) ? raw.color : 'sand';
  return {id: raw.id, x1, z1, x2, z2, color};
}

export function validateRugPlacement(raw, wingCount = 12, mode = 'default', customFloors = []) {
  const rug = normalizeRug(raw);
  if (![rug.x1, rug.x2, rug.z1, rug.z2].every(Number.isFinite)) return {ok: false, reason: '地毯坐标无效'};
  if (rug.x2 - rug.x1 < 1.0 || rug.z2 - rug.z1 < 1.0) return {ok: false, reason: '地毯尺寸至少 1.0×1.0m'};
  const box = {minX: rug.x1, maxX: rug.x2, minZ: rug.z1, maxZ: rug.z2};
  if (mode === 'custom') {
    if (!boxCoveredByFloors(box, customFloors)) return {ok: false, reason: '请先在该区域铺设地板'};
  } else if (!insideOfficeFloor(box, wingCount)) {
    return {ok: false, reason: '地毯超出办公室地面范围'};
  }
  return {ok: true, rug};
}

export function validateItemPlacement(candidate, existingItems = [], wingCount = 12, ignoreId = null, existingWalls = [], mode = 'default', customFloors = []) {
  if (!candidate || !furnitureByType[candidate.type]) return {ok: false, reason: '未知物品类型'};
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) return {ok: false, reason: '坐标无效'};
  const box = itemFootprint(candidate, 0.04);
  if (mode === 'custom') {
    if (!boxCoveredByFloors(box, customFloors)) return {ok: false, reason: '请先在该区域铺设地板'};
  } else {
    if (!insideOfficeFloor(box, wingCount)) return {ok: false, reason: '超出办公室地面范围'};
    for (const wall of officeWallBoxes(wingCount)) {
      if (boxesOverlap(box, wall, 0.02)) return {ok: false, reason: '与墙体冲突'};
    }
    for (const door of doorwayClearBoxes) {
      if (boxesOverlap(box, door, 0.02)) return {ok: false, reason: '请勿遮挡房间门洞'};
    }
    for (const fixed of staticFurnitureBoxes(wingCount)) {
      if (boxesOverlap(box, fixed, 0.06)) return {ok: false, reason: '与已有固定家具重叠'};
    }
  }
  for (const wall of customWallBoxes(existingWalls, 0.28)) {
    if (boxesOverlap(box, wall, 0.02)) return {ok: false, reason: '与自定义墙体冲突'};
  }
  for (const door of customDoorBoxes(existingWalls)) {
    if (boxesOverlap(box, door, 0.02)) return {ok: false, reason: '请勿遮挡门洞通道'};
  }
  for (const other of existingItems) {
    if (ignoreId && other.id === ignoreId) continue;
    const otherBox = itemFootprint(other, 0.04);
    if (otherBox && boxesOverlap(box, otherBox, 0.05)) return {ok: false, reason: '与其他已放置家具重叠'};
  }
  return {ok: true};
}

// 2D A* grid pathfinding over the office floor so walking characters route cleanly
// around walls, built-in furniture, user-placed desks/decor, and custom walls/doorways.
export function findOfficePath(from, to, wingCount = 12, officeItems = [], officeWalls = [], mode = 'default', customFloors = []) {
  if (!from || !to) return [];
  const distDirect = Math.hypot(to.x - from.x, to.z - from.z);
  if (distDirect < 0.35) return [{x: to.x, z: to.z}];

  const cell = 0.5;
  const east = baseOfficeEast(wingCount);
  const minX = mode === 'custom' ? customCanvasBounds.minX : -10;
  const maxX = mode === 'custom' ? customCanvasBounds.maxX : Math.max(10, east);
  const minZ = mode === 'custom' ? customCanvasBounds.minZ : -8;
  const maxZ = mode === 'custom' ? customCanvasBounds.maxZ : 8;
  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxZ - minZ) / cell);

  const toCol = x => Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cell)));
  const toRow = z => Math.max(0, Math.min(rows - 1, Math.floor((z - minZ) / cell)));
  const cellCenter = (c, r) => ({x: minX + (c + 0.5) * cell, z: minZ + (r + 0.5) * cell});

  // Build walkability grid (0 = walkable, 1 = blocked)
  const blocked = new Uint8Array(cols * rows);
  const idx = (c, r) => r * cols + c;

  if (mode === 'custom') {
    blocked.fill(1);
    for (const fl of customFloors) {
      const c0 = toCol(fl.x1 + 0.05);
      const c1 = toCol(fl.x2 - 0.05);
      const r0 = toRow(fl.z1 + 0.05);
      const r1 = toRow(fl.z2 - 0.05);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) blocked[idx(c, r)] = 0;
      }
    }
  } else if (east > 10) {
    for (let r = 0; r < rows; r++) {
      const cz = minZ + (r + 0.5) * cell;
      if (cz < -2.75 || cz > 2.95) {
        for (let c = toCol(10.05); c < cols; c++) blocked[idx(c, r)] = 1;
      }
    }
  }

  const obstacles = [
    ...(mode === 'custom' ? [] : officeWallBoxes(wingCount).map(b => ({minX: b.minX - 0.14, maxX: b.maxX + 0.14, minZ: b.minZ - 0.14, maxZ: b.maxZ + 0.14}))),
    ...customWallBoxes(officeWalls, 0.24).map(b => ({minX: b.minX - 0.12, maxX: b.maxX + 0.12, minZ: b.minZ - 0.12, maxZ: b.maxZ + 0.12})),
    ...(mode === 'custom' ? [] : staticFurnitureBoxes(wingCount).map(b => ({minX: b.minX + 0.08, maxX: b.maxX - 0.08, minZ: b.minZ + 0.08, maxZ: b.maxZ - 0.08}))),
    ...officeItems.map(item => itemFootprint(item, -0.04)).filter(Boolean),
  ];

  for (const box of obstacles) {
    const c0 = toCol(box.minX);
    const c1 = toCol(box.maxX);
    const r0 = toRow(box.minZ);
    const r1 = toRow(box.maxZ);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) blocked[idx(c, r)] = 1;
    }
  }

  // Explicitly ensure built-in and custom doorways stay passable
  const passableDoors = mode === 'custom' ? customDoorBoxes(officeWalls) : [...doorwayClearBoxes, ...customDoorBoxes(officeWalls)];
  for (const door of passableDoors) {
    const c0 = toCol(door.minX + 0.15);
    const c1 = toCol(door.maxX - 0.15);
    const r0 = toRow(door.minZ + 0.15);
    const r1 = toRow(door.maxZ - 0.15);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) blocked[idx(c, r)] = 0;
    }
  }

  // Pick nearest walkable anchor cell for start & goal so seated characters step smoothly out/in
  const startPoint = from.exit?.[0] ?? from;
  const endPoint = to.exit?.[0] ?? to;
  const nearestWalkable = point => {
    const sc = toCol(point.x);
    const sr = toRow(point.z);
    if (!blocked[idx(sc, sr)]) return [sc, sr];
    for (let radius = 1; radius <= 5; radius++) {
      let best = null;
      let bestDist = Infinity;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nc = sc + dc, nr = sr + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          if (blocked[idx(nc, nr)]) continue;
          const d = dc * dc + dr * dr;
          if (d < bestDist) { bestDist = d; best = [nc, nr]; }
        }
      }
      if (best) return best;
    }
    return [sc, sr];
  };

  const [sc, sr] = nearestWalkable(startPoint);
  const [gc, gr] = nearestWalkable(endPoint);
  blocked[idx(sc, sr)] = 0;
  blocked[idx(gc, gr)] = 0;

  // Run A* (8-directional without diagonal corner-cutting)
  const total = cols * rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = [idx(sc, sr)];
  const inOpen = new Uint8Array(total);
  const startIdx = idx(sc, sr);
  const goalIdx = idx(gc, gr);
  gScore[startIdx] = 0;
  fScore[startIdx] = Math.hypot(gc - sc, gr - sr);
  inOpen[startIdx] = 1;

  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  let found = false;
  while (open.length) {
    let bestPos = 0;
    let bestF = fScore[open[0]];
    for (let i = 1; i < open.length; i++) {
      const f = fScore[open[i]];
      if (f < bestF) { bestF = f; bestPos = i; }
    }
    const current = open[bestPos];
    open[bestPos] = open[open.length - 1];
    open.pop();
    inOpen[current] = 0;
    if (current === goalIdx) { found = true; break; }
    closed[current] = 1;
    const cc = current % cols;
    const cr = (current - cc) / cols;

    for (const [dc, dr, cost] of dirs) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = idx(nc, nr);
      if (closed[nIdx] || blocked[nIdx]) continue;
      // Disallow cutting corners diagonally through adjacent blocked cells
      if (dc !== 0 && dr !== 0 && (blocked[idx(cc + dc, cr)] || blocked[idx(cc, cr + dr)])) continue;
      const tentative = gScore[current] + cost;
      if (tentative < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + Math.hypot(gc - nc, gr - nr);
        if (!inOpen[nIdx]) { open.push(nIdx); inOpen[nIdx] = 1; }
      }
    }
  }

  if (!found) {
    // Graceful fallback if unreachable
    return [...(from.exit ?? []), ...(to.exit ?? []).slice().reverse(), to];
  }

  const rawCells = [];
  for (let cur = goalIdx; cur !== -1; cur = cameFrom[cur]) {
    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    rawCells.push(cellCenter(cc, cr));
  }
  rawCells.reverse();

  // Simplify collinear / near-collinear waypoints for smooth walking
  const simplified = [];
  for (let i = 0; i < rawCells.length; i++) {
    const prev = simplified[simplified.length - 1];
    const cur = rawCells[i];
    const next = rawCells[i + 1];
    if (prev && next) {
      const dx1 = cur.x - prev.x, dz1 = cur.z - prev.z;
      const dx2 = next.x - cur.x, dz2 = next.z - cur.z;
      if (Math.abs(dx1 * dz2 - dz1 * dx2) < 0.01) continue;
    }
    simplified.push(cur);
  }

  const result = [];
  if (from.exit?.[0] && Math.hypot(from.exit[0].x - from.x, from.exit[0].z - from.z) > 0.1) {
    result.push({x: from.exit[0].x, z: from.exit[0].z});
  }
  for (const pt of simplified) {
    const last = result[result.length - 1];
    if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) > 0.25) result.push(pt);
  }
  result.push(to);
  return result;
}
