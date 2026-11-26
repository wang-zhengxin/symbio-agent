import * as T from '/office-vendor/three.module.min.js';
import { breakTable, chatTables, desks, extraDesks, loungeSeats, meetingTable, officeEast } from './office-presence.js';
import { officeWallHeight, wallSections } from './office-walls.js';
import { furnitureByType, rotationRadians, wallAxis, wallSubSegments } from './office-furniture.js';

const cube = new T.BoxGeometry(1, 1, 1);
const round = new T.CylinderGeometry(.5, .5, 1, 16);
const ball = new T.SphereGeometry(.5, 10, 8);
const cone = new T.CylinderGeometry(.38, .5, 1, 12);

const lightKeyframes = [
  {
    hour: 0, phase: 'night', name: '深夜', icon: '☾',
    hemiSky: [66, 88, 132], hemiGround: [42, 50, 68], hemiInt: 1.12,
    sunColor: [152, 188, 255], sunInt: 0.68, sunPos: [9, 14, -6],
    fillColor: [92, 128, 188], fillInt: 0.38,
    lampInt: 3.4, exposure: 1.08,
    glow: [60, 70, 90], paper: [41, 49, 64], edge: [27, 33, 44],
  },
  {
    hour: 5.5, phase: 'dawn', name: '清晨', icon: '◐',
    hemiSky: [255, 214, 192], hemiGround: [108, 108, 126], hemiInt: 1.58,
    sunColor: [255, 180, 128], sunInt: 1.7, sunPos: [15.5, 7.2, 5.5],
    fillColor: [172, 198, 240], fillInt: 0.54,
    lampInt: 0.85, exposure: 1.12,
    glow: [246, 226, 212], paper: [224, 204, 194], edge: [190, 168, 162],
  },
  {
    hour: 9, phase: 'day', name: '上午', icon: '☀',
    hemiSky: [255, 245, 232], hemiGround: [122, 128, 138], hemiInt: 2.12,
    sunColor: [255, 240, 220], sunInt: 2.05, sunPos: [9.5, 14.5, 7],
    fillColor: [208, 230, 255], fillInt: 0.62,
    lampInt: 0.12, exposure: 1.16,
    glow: [247, 236, 222], paper: [232, 219, 203], edge: [195, 173, 152],
  },
  {
    hour: 13, phase: 'day', name: '正午', icon: '☀',
    hemiSky: [255, 250, 242], hemiGround: [132, 138, 145], hemiInt: 2.28,
    sunColor: [255, 248, 236], sunInt: 2.2, sunPos: [-2, 18.5, 8],
    fillColor: [216, 236, 255], fillInt: 0.68,
    lampInt: 0, exposure: 1.18,
    glow: [250, 243, 232], paper: [236, 226, 212], edge: [202, 184, 164],
  },
  {
    hour: 17.5, phase: 'sunset', name: '黄昏', icon: '◐',
    hemiSky: [255, 218, 176], hemiGround: [112, 98, 108], hemiInt: 1.72,
    sunColor: [255, 166, 94], sunInt: 2.18, sunPos: [-15.5, 6.6, 6.2],
    fillColor: [158, 180, 224], fillInt: 0.52,
    lampInt: 1.05, exposure: 1.14,
    glow: [245, 219, 192], paper: [222, 190, 164], edge: [182, 146, 124],
  },
  {
    hour: 20, phase: 'dusk', name: '傍晚', icon: '☾',
    hemiSky: [92, 114, 156], hemiGround: [54, 62, 78], hemiInt: 1.24,
    sunColor: [162, 190, 244], sunInt: 0.82, sunPos: [-10, 10.5, -4],
    fillColor: [98, 130, 186], fillInt: 0.42,
    lampInt: 2.8, exposure: 1.09,
    glow: [78, 88, 108], paper: [55, 63, 79], edge: [37, 43, 56],
  },
];

const lerp = (a, b, t) => a + (b - a) * t;
const lerpVec = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const rgbHex = ([r, g, b]) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
const rgbCss = ([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;

export function officeLightingState(rawHour = 12) {
  const hour = ((Number(rawHour) % 24) + 24) % 24;
  let a = lightKeyframes[lightKeyframes.length - 1];
  let b = lightKeyframes[0];
  let span = 24 - a.hour + b.hour;
  let offset = hour >= a.hour ? hour - a.hour : 24 - a.hour + hour;
  for (let i = 0; i < lightKeyframes.length - 1; i++) {
    const cur = lightKeyframes[i], next = lightKeyframes[i + 1];
    if (hour >= cur.hour && hour < next.hour) {
      a = cur; b = next; span = next.hour - cur.hour; offset = hour - cur.hour;
      break;
    }
  }
  const u = span > 0 ? offset / span : 0;
  const t = u * u * (3 - 2 * u);
  const label = hour >= 5 && hour < 7.5 ? {phase:'dawn', name:'清晨', icon:'◐'}
    : hour >= 7.5 && hour < 11.5 ? {phase:'day', name:'上午', icon:'☀'}
      : hour >= 11.5 && hour < 15.5 ? {phase:'day', name:'正午', icon:'☀'}
        : hour >= 15.5 && hour < 19 ? {phase:'sunset', name:'黄昏', icon:'◐'}
          : hour >= 19 && hour < 21.5 ? {phase:'dusk', name:'傍晚', icon:'☾'}
            : {phase:'night', name:'深夜', icon:'☾'};
  return {
    hour, ...label,
    hemiSky: rgbHex(lerpVec(a.hemiSky, b.hemiSky, t)),
    hemiGround: rgbHex(lerpVec(a.hemiGround, b.hemiGround, t)),
    hemiInt: lerp(a.hemiInt, b.hemiInt, t),
    sunColor: rgbHex(lerpVec(a.sunColor, b.sunColor, t)),
    sunInt: lerp(a.sunInt, b.sunInt, t),
    sunPos: lerpVec(a.sunPos, b.sunPos, t),
    fillColor: rgbHex(lerpVec(a.fillColor, b.fillColor, t)),
    fillInt: lerp(a.fillInt, b.fillInt, t),
    lampInt: lerp(a.lampInt, b.lampInt, t),
    exposure: lerp(a.exposure, b.exposure, t),
    glow: rgbCss(lerpVec(a.glow, b.glow, t)),
    paper: rgbCss(lerpVec(a.paper, b.paper, t)),
    edge: rgbCss(lerpVec(a.edge, b.edge, t)),
  };
}

export function officeLights(scene, shadows = false) {
  const hemi = new T.HemisphereLight(0xfff4e6, 0x777d88, 2.15);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xffefdb, 2.05);
  sun.position.set(-8, 16, 7);
  if (shadows) {
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, {left:-18, right:18, top:16, bottom:-16, near:1, far:55});
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -.00035;
    sun.shadow.normalBias = .025;
  }
  scene.add(sun);
  scene.add(sun.target);
  const fill = new T.DirectionalLight(0xd5e9ff, .6);
  fill.position.set(7, 7, -11);
  scene.add(fill);
  const lamps = shadows ? [
    [-2.6, 3.4, -0.5, 16],
    [6.3, 3.4, -5.6, 13],
    [6.5, 3.4, 5.8, 13],
    [-6.6, 3.2, -5.6, 11],
    [12.5, 3.4, 0, 16],
  ].map(([x, y, z, dist]) => {
    const light = new T.PointLight(0xffc37a, 0, dist, 1.35);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  }) : [];
  function apply(hour = 10, east = 10) {
    const state = officeLightingState(hour);
    const centerX = (east - 10) / 2;
    hemi.color.setHex(state.hemiSky);
    hemi.groundColor.setHex(state.hemiGround);
    hemi.intensity = state.hemiInt;
    sun.color.setHex(state.sunColor);
    sun.intensity = state.sunInt;
    sun.position.set(centerX + state.sunPos[0], state.sunPos[1], state.sunPos[2]);
    sun.target.position.set(centerX, 0, 0);
    sun.target.updateMatrixWorld();
    if (shadows) {
      const halfX = Math.max(18, (east + 10) * .72);
      sun.shadow.camera.left = -halfX;
      sun.shadow.camera.right = halfX;
      sun.shadow.camera.updateProjectionMatrix();
    }
    fill.color.setHex(state.fillColor);
    fill.intensity = state.fillInt;
    lamps.forEach((lamp, idx) => {
      if (idx === 4) {
        lamp.position.x = 10 + Math.max(2.5, (east - 10) * .5);
        lamp.intensity = east > 10 ? state.lampInt * 1.15 : 0;
      } else {
        lamp.intensity = state.lampInt;
      }
    });
    return state;
  }
  return {apply};
}

const colors = {
  wood:0xa37a54, lightWood:0xc6a278, edge:0x82684e, dark:0x333a3c, metal:0x535c5f,
  warm:0xe3d9c7, white:0xeee5d5, slate:0x647d86, sage:0x789087, gray:0xb7bcaf,
  graphite:0x4d535a, plum:0x80748b, carpet:0xaca69a, paper:0xf1e9d8, screen:0x638086,
  leaf:0x516b46, olive:0x71845a, black:0x2a3032, brass:0xc8a370, mint:0x9dafa7,
};

function carpetTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0,0,128,128);
  let seed = 23;
  for (let i = 0; i < 8500; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.13)' : 'rgba(47,38,31,.14)';
    ctx.fillRect(seed & 127, (seed >>> 9) & 127, 1 + (i % 2), 1);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(7, 6);
  return texture;
}

export function buildOffice(scene, workstationCount) {
  const batches = new Map();
  function add(shape, color, x, y, z, width, height, depth, angle = 0) {
    const key = shape.id + ':' + color;
    if (!batches.has(key)) batches.set(key, {shape, color, pieces:[]});
    batches.get(key).pieces.push([x,y,z,width,height,depth,angle]);
  }
  const box = (...args) => add(cube, ...args);
  const cylinder = (...args) => add(round, ...args);
  const sphere = (...args) => add(ball, ...args);
  const plant = (x, z, y = 0, scale = 1) => {
    add(cone, colors.warm, x, y+.22*scale, z, .42*scale, .44*scale, .42*scale);
    cylinder(colors.edge, x, y+.44*scale, z, .36*scale,.04*scale,.36*scale);
    for (let n=0;n<7;n++) {
      const a = n * 2.39;
      const r = .21 * scale;
      sphere(n%2 ? colors.leaf : colors.olive, x + Math.cos(a)*r, y+(.58+(n%3)*.13)*scale,
        z + Math.sin(a)*r, .3*scale,.52*scale,.24*scale,a);
    }
  };
  function framed(x, y, z, face, width = .8, height = .62, color = colors.sage) {
    const angle = face === 'left' ? Math.PI / 2 : 0;
    const dx = face === 'left' ? 1 : 0;
    const dz = 1 - dx;
    box(colors.edge,x,y,z,width,height,.065,angle);
    box(colors.paper,x+.038*dx,y,z+.038*dz,width-.09,height-.09,.025,angle);
    box(color,x+.054*dx,y,z+.054*dz,width-.21,height-.21,.02,angle);
    box(colors.brass,x+.071*dx,y-.08,z+.071*dz,width-.26,.065,.02,angle);
  }
  const walls = [];
  function wallX(x1,x2,z,color) {
    walls.push({x1,x2,z1:z,z2:z,color});
  }
  function wallZ(z1,z2,x,color) {
    walls.push({x1:x,x2:x,z1,z2,color});
  }
  function blinds(x,y,z,width,height,alongZ = false) {
    const angle = alongZ ? Math.PI / 2 : 0;
    box(colors.black,x,y,z,width+.08,height+.1,.09,angle);
    const nudgeX = alongZ ? .055 : 0;
    const nudgeZ = alongZ ? 0 : .055;
    box(colors.white,x+nudgeX,y,z+nudgeZ,width-.06,height-.05,.045,angle);
    for(let row=0;row<12;row++) {
      box(row%2 ? colors.gray : colors.warm,x+nudgeX*1.6,y-height/2+(row+.5)*height/12,
        z+nudgeZ*1.6,width-.085,height/15,.024,angle);
    }
    for(const side of [-1,1]) box(colors.metal,x+nudgeX*2.1 + (alongZ ? 0 : side*width*.29),y,
      z+nudgeZ*2.1 + (alongZ ? side*width*.29 : 0),.022,height,.023,angle);
  }
  function chair(x,z,angle = 0,color = colors.graphite) {
    const along = (dx, dz) => [x + dx*Math.cos(angle) + dz*Math.sin(angle), z - dx*Math.sin(angle) + dz*Math.cos(angle)];
    const item = (paint, dx, y, dz, w,h,d) => {
      const [px,pz] = along(dx,dz);
      box(paint,px,y,pz,w,h,d,angle);
    };
    item(color,0,.47,0,.53,.12,.52);
    item(color,0,.76,-.23,.51,.48,.11);
    item(colors.dark,0,.15,0,.53,.055,.13);
    item(colors.dark,0,.14,0,.12,.055,.53);
    cylinder(colors.metal,x,.27,z,.095,.31,.095);
    for(const side of [-1,1]) item(colors.dark,.28*side,.6,-.025,.06,.065,.39);
  }
  function desk(x,z,index) {
    const tone = index % 2 ? colors.lightWood : colors.wood;
    box(tone,x,.83,z,2.19,.115,1.04);
    box(tone,x+.78,.4,z,.51,.78,.94);
    box(tone,x-.99,.4,z,.11,.78,.94);
    for(let row=0;row<3;row++) {
      box(colors.edge,x+.78,.16+.22*row,z+.48,.43,.012,.03);
      box(colors.dark,x+.78,.21+.22*row,z+.508,.14,.026,.045);
    }
    box(colors.gray,x,1.12,z-.54,2.23,.81,.085);
    box(colors.white,x,1.54,z-.54,2.24,.035,.1);
    if(index<6) {
      box(colors.slate,x-1.09,1.06,z-.11,.085,.7,.93);
      box(colors.white,x-1.09,1.42,z-.11,.103,.036,.96);
    }
    box(colors.warm,x-.12,1.135,z-.24,.63,.47,.42);
    box(colors.dark,x-.12,1.135,z-.014,.515,.355,.05);
    box(index%3 ? colors.screen : colors.mint,x-.12,1.14,z+.015,.45,.28,.025);
    for (let row=0;row<3;row++) {
      box(colors.mint,x-.16,1.08+.055*row,z+.032,.29-row*.035,.013,.008);
    }
    box(colors.warm,x-.12,.913,z+.287,.59,.044,.21);
    for (let row=0;row<3;row++) box(colors.gray,x-.12,.939,z+.224+row*.061,.51,.008,.022);
    box(colors.paper,x+.65,.9,z+.13,.27,.025,.31,.13);
    cylinder(index%2 ? colors.sage : colors.plum,x+.8,.971,z-.27,.13,.16,.13);
    box(colors.warm,x-.76,.962,z-.32,.27,.145,.24);
    box(colors.gray,x-.77,1.045,z-.32,.22,.021,.20);
    chair(x,z+.66,Math.PI);
  }
  function table(x,z,w,d,height = .74) {
    box(colors.lightWood,x,height,z,w,.13,d);
    box(colors.edge,x,height-.076,z,w-.02,.04,d-.02);
    for (const sx of [-1,1]) for(const sz of [-1,1]) {
      box(colors.dark,x+sx*(w/2-.18),(height-.13)/2,z+sz*(d/2-.18),.085,height-.13,.085);
    }
  }
  function deskLamp(x,y,z) {
    cylinder(colors.dark,x,y+.023,z,.29,.045,.29);
    cylinder(colors.dark,x,y+.31,z,.045,.62,.045);
    add(cone,colors.brass,x,y+.64,z,.36,.19,.36);
    cylinder(colors.paper,x,y+.56,z,.29,.06,.29);
  }

  // Model base and unified carpet floor across all rooms and east-wing expansion.
  box(colors.edge,0,-.29,0,20.4,.43,16.4);
  box(colors.dark,0,-.1,0,20.27,.17,16.27);
  const texture = carpetTexture('#b8b0a2');
  const floor = new T.Mesh(new T.PlaneGeometry(20,16), new T.MeshStandardMaterial({map:texture, roughness:1}));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const east = officeEast(workstationCount);
  const shadow = new T.Mesh(new T.PlaneGeometry(east+50,60),new T.ShadowMaterial({opacity:.29}));
  shadow.rotation.x = -Math.PI/2;
  shadow.position.x = (east-10)/2;
  shadow.position.y = -.51;
  shadow.receiveShadow = true;
  scene.add(shadow);

  let wingFloor = null;
  let wingTexture = null;
  wallX(-10,10,-8,colors.sage);
  wallZ(-8,2.9,-10,colors.slate);
  wallZ(2.9,8,-10,colors.plum);
  wallZ(-8,-2.95,10,colors.slate);
  if (east > 10) {
    const width = east-10, center = (east+10)/2;
    box(colors.edge,center,-.29,.1,width,.43,6.1);
    box(colors.dark,center,-.1,.1,width,.17,6.1);
    wingTexture = texture.clone();
    wingTexture.needsUpdate = true;
    wingTexture.repeat.set(7 * width / 20, 6 * 6.1 / 16);
    wingFloor = new T.Mesh(new T.PlaneGeometry(width, 6.1), new T.MeshStandardMaterial({map: wingTexture, roughness: 1}));
    wingFloor.rotation.x = -Math.PI / 2;
    wingFloor.position.set(center, 0, .1);
    wingFloor.receiveShadow = true;
    scene.add(wingFloor);
    wallX(10,east,-2.95,colors.sage);
    wallZ(-2.95,3.15,east,colors.sage);
    extraDesks(workstationCount).forEach(([x,z],index) => desk(x,z,desks.length+index));
  } else wallZ(-2.95,2.92,10,colors.sage);
  wallX(-10,-5.25,-3.63,colors.slate);
  wallZ(-8,-3.63,-3.6,colors.slate);
  wallX(3.28,7.73,-3.58,colors.sage);
  wallZ(-8,-3.58,3.28,colors.slate);
  blinds(-7.25,1.76,-7.85,2.33,1.22);
  blinds(-.34,1.76,-7.85,2.4,1.22);
  blinds(6.75,1.78,-7.85,2.2,1.23);
  blinds(-9.85,1.7,-5.24,2.26,1.16,true);
  blinds(-9.85,1.61,.06,2.35,1.11,true);
  blinds(-7.65,1.39,-3.51,2.91,.91);
  blinds(5.42,1.28,-3.46,2.44,.86);
  framed(-5.18,1.93,-7.85,'back',.68,.58,colors.plum);
  framed(1.38,1.86,-7.85,'back',.67,.53);
  framed(-9.86,1.29,4.69,'left',1.29,.72,colors.plum);
  framed(-9.86,1.34,5.82,'left',.53,.48);
  framed(-9.86,1.83,-2.29,'left',.68,.52,colors.brass);

  // Private office, bookshelves and kitchenette.
  table(-6.88,-5.55,2.15,.96,.82);
  chair(-6.9,-6.45);
  chair(-6.8,-4.6,Math.PI);
  deskLamp(-7.63,.89,-5.82);
  box(colors.paper,-6.52,.91,-5.56,.42,.028,.33,-.12);
  box(colors.dark,-7.17,1.07,-5.66,.67,.36,.09,.16);
  box(colors.screen,-7.17,1.07,-5.59,.57,.27,.02,.16);
  for (let shelf=0;shelf<4;shelf++) {
    box(colors.wood,-1.7,.22+shelf*.47,-7.6,1.85,.08,.52);
    for(let book=0;book<8;book++) {
      box([colors.sage,colors.plum,colors.brass,colors.warm][(book+shelf)%4],-2.46+book*.205,.405+shelf*.47,-7.6,
        .15,.29+(book%3)*.042,.31);
    }
  }
  box(colors.edge,-2.64,.92,-7.6,.095,1.9,.51);
  box(colors.edge,-.78,.92,-7.6,.095,1.9,.51);
  // Top-right room: Meeting room (swapped with the pantry/lounge room).
  const {x:mx, z:mz} = meetingTable;
  table(mx, mz, 3.1, 1.48, .76);
  for (const side of [-1, 1]) {
    for (const offset of [-1.02, 0, 1.02]) {
      chair(mx + offset, mz + side * 1.04, side > 0 ? Math.PI : 0);
      box(colors.paper, mx + offset, .844, mz + side * .42, .32, .024, .26, side * .08);
      box(colors.dark, mx + offset + .08, .861, mz + side * .47, .17, .013, .022, side * .08);
      cylinder(colors.sage, mx + offset + .27, .9, mz + side * .3, .11, .13, .11);
    }
    chair(mx + side * 1.92, mz, -side * Math.PI / 2);
  }
  framed(3.41, 1.48, -5.7, 'left', 1.85, .78, colors.white);
  box(colors.gray, 9.28, .55, -7.12, .72, 1.1, .68);
  box(colors.dark, 9.28, 1.13, -7.12, .75, .09, .71);
  box(colors.paper, 9.28, 1.19, -7.12, .46, .035, .32);

  desks.forEach(([x,z],index) => desk(x,z,index));

  // Reception counter and two small face-to-face tables.
  for(let piece=0;piece<8;piece++) {
    const angle=(piece-3.5)*.195;
    const x=-7.05+1.62*Math.sin(angle), z=4.98+1.62*Math.cos(angle);
    box(colors.wood,x,.46,z,.34,.92,.28,angle);
    box(colors.lightWood,x,.956,z,.41,.11,.61,angle);
  }
  box(colors.dark,-7.11,1.14,6.49,.53,.33,.12);
  box(colors.screen,-7.11,1.15,6.57,.45,.25,.033);
  chair(-7.09,5.45);
  deskLamp(-8.07,.99,6.21);
  box(colors.wood,-9.51,.49,4.83,.65,.98,2.08);
  for(let index=0;index<6;index++) box(index%2 ? colors.slate : colors.warm,-9.5,1.16,4.19+index*.18,.39,.3,.12);
  for(const {x,z} of chatTables) {
    cylinder(colors.lightWood,x,.68,z,.82,.11,.82);
    cylinder(colors.dark,x,.34,z,.14,.65,.14);
    cylinder(colors.dark,x,.055,z,.5,.08,.5);
    cylinder(colors.paper,x,.79,z-.17,.126,.15,.126);
  }
  for (const seat of loungeSeats) chair(seat.x,seat.z,seat.angle,colors.sage);

  // Bottom-right room: Expanded lounge & pantry break room with a long 8-seat communal table.
  wallX(3.22,10,2.92,colors.slate);
  wallZ(2.92,4.1,3.22,colors.slate);
  wallZ(5.39,8,3.22,colors.slate);
  wallZ(2.92,8,10,colors.slate);
  framed(9.87,1.45,5.95,'left',1.87,.68,colors.sage);
  // Two vending machines and kitchenette / coffee bar along the north interior wall.
  for (let unit = 0; unit < 2; unit++) {
    const x = 4.35 + unit * 1.04;
    box(colors.dark, x, 1.02, 3.52, .83, 2.04, .84);
    box(colors.slate, x, 1.26, 3.96, .69, 1.25, .06);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
      box([colors.sage, colors.warm, colors.brass, colors.plum][(row + col + unit) % 4],
        x - .21 + col * .2, .85 + row * .25, 4.00, .119, .15, .022);
    }
  }
  box(colors.wood, 8.15, .54, 3.55, 2.25, 1.06, .92);
  box(colors.gray, 8.15, 1.1, 3.55, 2.32, .11, .98);
  box(colors.black, 8.68, 1.32, 3.52, .54, .37, .60);
  box(colors.warm, 8.15, 2.02, 3.36, 2.22, .56, .56);
  for (let door = 0; door < 3; door++) box(colors.dark, 7.5 + .62 * door, 1.89, 3.66, .12, .025, .025);
  // Long communal break table (chairs are rendered via loungeSeats above).
  const {x: bx, z: bz} = breakTable;
  table(bx, bz, 3.6, 1.15, .74);
  for (const offset of [-1.15, -.15, .95]) {
    cylinder(colors.paper, bx + offset, .85, bz - .22, .14, .16, .14);
    cylinder(colors.plum, bx + offset + .34, .85, bz + .22, .13, .15, .13);
  }
  box(colors.warm, bx - .55, .82, bz + .05, .36, .024, .26, .08);
  box(colors.sage, bx + .55, .82, bz - .05, .34, .024, .24, -.12);
  [[-9.24,-7.18],[-9.3,2.78],[1.15,-7.27],[9.26,1.53],[9.15,7.28],[-4.95,7.36]]
    .forEach(([x,z],i) => plant(x,z,0,i%2 ? .92 : 1.3));

  for (const layer of [
    {thickness:.16, y:officeWallHeight/2, height:officeWallHeight},
    {thickness:.22, y:officeWallHeight+.032, height:.064, color:colors.white},
    {thickness:.24, y:.085, height:.12, color:colors.edge},
  ]) {
    const segments = layer.color === undefined ? walls : walls.map(wall => ({...wall,color:layer.color}));
    for (const {x1,x2,z1,z2,color} of wallSections(segments,layer.thickness)) {
      box(color,(x1+x2)/2,layer.y,(z1+z2)/2,x2-x1,layer.height,z2-z1);
    }
  }

  const matrix = new T.Object3D();
  for(const {shape, color, pieces} of batches.values()) {
    const material = new T.MeshStandardMaterial({color, roughness:.89});
    const mesh = new T.InstancedMesh(shape,material,pieces.length);
    pieces.forEach(([x,y,z,w,h,d,angle],index) => {
      matrix.position.set(x,y,z);
      matrix.scale.set(w,h,d);
      matrix.rotation.y = angle;
      matrix.updateMatrix();
      mesh.setMatrixAt(index,matrix.matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return () => {
    scene.remove(floor,shadow);
    texture.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    if (wingFloor) {
      scene.remove(wingFloor);
      wingFloor.geometry.dispose();
      wingFloor.material.dispose();
      wingTexture?.dispose();
    }
    shadow.geometry.dispose();
    shadow.material.dispose();
    for(const mesh of scene.children.filter(item => item.isInstancedMesh)) {
      scene.remove(mesh);
      mesh.material.dispose();
      mesh.dispose();
    }
  };
}

export function buildEmptyOfficeStage(scene) {
  const shadow = new T.Mesh(new T.PlaneGeometry(64, 64), new T.ShadowMaterial({opacity: .26}));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -.51, 0);
  shadow.receiveShadow = true;
  scene.add(shadow);
  return () => {
    scene.remove(shadow);
    shadow.geometry.dispose();
    shadow.material.dispose();
  };
}

function floorMaterialTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (kind === 'wood') {
    ctx.fillStyle = '#c2a077';
    ctx.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 8; row++) {
      ctx.fillStyle = row % 2 ? 'rgba(128,88,52,.13)' : 'rgba(255,244,225,.12)';
      ctx.fillRect(0, row * 16, 128, 15);
      ctx.fillStyle = 'rgba(84,58,34,.22)';
      ctx.fillRect(0, row * 16 + 15, 128, 1);
      const seam = ((row * 43) % 96) + 16;
      ctx.fillRect(seam, row * 16, 1, 16);
    }
  } else if (kind === 'stone') {
    ctx.fillStyle = '#ccc6bc';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(92,86,78,.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
    ctx.strokeRect(65, 1, 62, 62);
    ctx.strokeRect(1, 65, 62, 62);
    ctx.strokeRect(65, 65, 62, 62);
    let seed = 41;
    for (let i = 0; i < 600; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.16)' : 'rgba(70,66,60,.12)';
      ctx.fillRect(seed & 127, (seed >>> 9) & 127, 2, 2);
    }
  } else if (kind === 'sage') {
    ctx.fillStyle = '#aeb9ae';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(56,74,64,.16)';
    ctx.lineWidth = 2;
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) ctx.strokeRect(x + 1, y + 1, 30, 30);
  } else {
    return carpetTexture('#b8b0a2');
  }
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  return tex;
}

export function buildCustomFloorsGroup(floors = [], selectedFloorId = null) {
  const group = new T.Group();
  const baseEdgeMat = new T.MeshStandardMaterial({color: colors.edge, roughness: 0.9});
  const baseDarkMat = new T.MeshStandardMaterial({color: colors.dark, roughness: 0.9});
  floors.forEach((floor, idx) => {
    const w = Math.max(0.5, floor.x2 - floor.x1);
    const d = Math.max(0.5, floor.z2 - floor.z1);
    const cx = (floor.x1 + floor.x2) / 2;
    const cz = (floor.z1 + floor.z2) / 2;
    const yLift = idx * 0.002;

    const plinth = new T.Mesh(cube, baseEdgeMat);
    plinth.position.set(cx, -0.29, cz);
    plinth.scale.set(w + 0.24, 0.43, d + 0.24);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    plinth.userData.officeFloorId = floor.id;
    group.add(plinth);

    const trim = new T.Mesh(cube, baseDarkMat);
    trim.position.set(cx, -0.1, cz);
    trim.scale.set(w + 0.12, 0.17, d + 0.12);
    trim.receiveShadow = true;
    trim.userData.officeFloorId = floor.id;
    group.add(trim);

    const tex = floorMaterialTexture(floor.material ?? 'carpet');
    tex.repeat.set(Math.max(1, w * 0.35), Math.max(1, d * 0.35));
    const topGeom = new T.PlaneGeometry(w, d);
    const topMat = new T.MeshStandardMaterial({map: tex, roughness: 0.95});
    const top = new T.Mesh(topGeom, topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.set(cx, yLift, cz);
    top.receiveShadow = true;
    top.userData.officeFloorId = floor.id;
    top.userData.ownedGeometry = true;
    top.userData.ownedTexture = tex;
    group.add(top);

    if (selectedFloorId === floor.id) {
      const outlineGeom = new T.EdgesGeometry(new T.BoxGeometry(w + 0.1, 0.06, d + 0.1));
      const outline = new T.LineSegments(outlineGeom, new T.LineBasicMaterial({color: 0x3d614e}));
      outline.position.set(cx, 0.03 + yLift, cz);
      outline.userData.ownedGeometry = true;
      group.add(outline);
    }
  });
  return group;
}

export function buildFloorGhostMesh(floor, valid = true) {
  const group = new T.Group();
  const hex = valid ? 0x2d8a5b : 0xc94a38;
  const w = Math.max(0.5, Math.abs(floor.x2 - floor.x1));
  const d = Math.max(0.5, Math.abs(floor.z2 - floor.z1));
  const cx = (floor.x1 + floor.x2) / 2;
  const cz = (floor.z1 + floor.z2) / 2;
  const slab = new T.Mesh(cube, new T.MeshBasicMaterial({color: hex, transparent: true, opacity: 0.36, depthWrite: false}));
  slab.position.set(cx, -0.05, cz);
  slab.scale.set(w, 0.14, d);
  group.add(slab);
  const outlineGeom = new T.EdgesGeometry(new T.BoxGeometry(w, 0.16, d));
  const outline = new T.LineSegments(outlineGeom, new T.LineBasicMaterial({color: hex}));
  outline.position.set(cx, -0.04, cz);
  outline.userData.ownedGeometry = true;
  group.add(outline);
  return group;
}

export function disposeFurnitureGroup(group) {
  if (!group) return;
  const materials = new Set();
  const textures = new Set();
  group.traverse(child => {
    if (child.isMesh || child.isLineSegments) {
      if (child.userData?.ownedGeometry) child.geometry?.dispose();
      if (child.userData?.ownedTexture) textures.add(child.userData.ownedTexture);
      if (Array.isArray(child.material)) child.material.forEach(m => materials.add(m));
      else if (child.material) materials.add(child.material);
    }
  });
  for (const tex of textures) tex.dispose();
  for (const mat of materials) mat.dispose();
}

export function buildCustomFurnitureMesh(item, {ghost = null, selected = false} = {}) {
  const group = new T.Group();
  group.position.set(item.x ?? 0, 0, item.z ?? 0);
  group.rotation.y = rotationRadians(item.rotation ?? 0);
  if (item.id) group.userData.officeItemId = item.id;

  const materialCache = new Map();
  const matFor = color => {
    const finalColor = ghost === 'valid' ? 0x2d8a5b : ghost === 'invalid' ? 0xc94a38 : color;
    const key = finalColor + ':' + (ghost ?? 'solid');
    if (!materialCache.has(key)) {
      materialCache.set(key, ghost
        ? new T.MeshStandardMaterial({color: finalColor, roughness: 0.65, transparent: true, opacity: 0.56, depthWrite: false})
        : new T.MeshStandardMaterial({color: finalColor, roughness: 0.88}));
    }
    return materialCache.get(key);
  };

  const part = (geom, color, x, y, z, w, h, d, angle = 0) => {
    const mesh = new T.Mesh(geom, matFor(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.rotation.y = angle;
    if (!ghost) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    if (item.id) mesh.userData.officeItemId = item.id;
    group.add(mesh);
  };
  const box = (...args) => part(cube, ...args);
  const cyl = (...args) => part(round, ...args);
  const sph = (...args) => part(ball, ...args);

  const addChair = (cx, cz, angle = 0, color = colors.graphite) => {
    const along = (dx, dz) => [cx + dx * Math.cos(angle) + dz * Math.sin(angle), cz - dx * Math.sin(angle) + dz * Math.cos(angle)];
    const piece = (paint, dx, y, dz, w, h, d) => {
      const [px, pz] = along(dx, dz);
      box(paint, px, y, pz, w, h, d, angle);
    };
    piece(color, 0, .47, 0, .53, .12, .52);
    piece(color, 0, .76, -.23, .51, .48, .11);
    piece(colors.dark, 0, .15, 0, .53, .055, .13);
    piece(colors.dark, 0, .14, 0, .12, .055, .53);
    cyl(colors.metal, cx, .27, cz, .095, .31, .095);
    for (const side of [-1, 1]) piece(colors.dark, .28 * side, .6, -.025, .06, .065, .39);
  };

  switch (item.type) {
    case 'desk': {
      box(colors.lightWood, 0, .83, 0, 2.16, .115, 1.02);
      box(colors.lightWood, .77, .4, 0, .5, .78, .92);
      box(colors.lightWood, -.97, .4, 0, .11, .78, .92);
      for (let row = 0; row < 3; row++) {
        box(colors.edge, .77, .16 + .22 * row, .47, .42, .012, .03);
        box(colors.dark, .77, .21 + .22 * row, .5, .14, .026, .045);
      }
      box(colors.gray, 0, 1.12, -.53, 2.2, .81, .085);
      box(colors.white, 0, 1.54, -.53, 2.21, .035, .1);
      box(colors.warm, -.12, 1.135, -.24, .63, .47, .42);
      box(colors.dark, -.12, 1.135, -.014, .515, .355, .05);
      box(colors.screen, -.12, 1.14, .015, .45, .28, .025);
      box(colors.warm, -.12, .913, .287, .59, .044, .21);
      box(colors.paper, .65, .9, .13, .27, .025, .31, .13);
      cyl(colors.sage, .8, .971, -.27, .13, .16, .13);
      addChair(0, .66, Math.PI);
      break;
    }
    case 'plant': {
      const s = 1.15;
      part(cone, colors.warm, 0, .22 * s, 0, .44 * s, .44 * s, .44 * s);
      cyl(colors.edge, 0, .44 * s, 0, .37 * s, .04 * s, .37 * s);
      for (let n = 0; n < 7; n++) {
        const a = n * 2.39;
        const r = .21 * s;
        sph(n % 2 ? colors.leaf : colors.olive, Math.cos(a) * r, (.58 + (n % 3) * .13) * s, Math.sin(a) * r,
          .3 * s, .52 * s, .24 * s, a);
      }
      break;
    }
    case 'bookcase': {
      for (let shelf = 0; shelf < 4; shelf++) {
        box(colors.wood, 0, .22 + shelf * .47, 0, 1.82, .08, .5);
        for (let b = 0; b < 7; b++) {
          box([colors.sage, colors.plum, colors.brass, colors.warm][(b + shelf) % 4],
            -.72 + b * .24, .405 + shelf * .47, 0, .15, .29 + (b % 3) * .042, .3);
        }
      }
      box(colors.edge, -.91, .92, 0, .09, 1.88, .5);
      box(colors.edge, .91, .92, 0, .09, 1.88, .5);
      break;
    }
    case 'partition': {
      box(colors.edge, -.96, .82, 0, .08, 1.64, .18);
      box(colors.edge, .96, .82, 0, .08, 1.64, .18);
      box(colors.slate, 0, .45, 0, 1.86, .74, .09);
      box(colors.white, 0, 1.18, 0, 1.86, .72, .07);
      box(colors.lightWood, 0, 1.58, 0, 1.98, .06, .14);
      box(colors.dark, -.96, .04, 0, .12, .08, .36);
      box(colors.dark, .96, .04, 0, .12, .08, .36);
      break;
    }
    case 'cafe_table': {
      cyl(colors.lightWood, 0, .68, 0, .86, .11, .86);
      cyl(colors.dark, 0, .34, 0, .14, .65, .14);
      cyl(colors.dark, 0, .055, 0, .52, .08, .52);
      cyl(colors.paper, 0, .79, -.14, .13, .15, .13);
      addChair(-.76, 0, Math.PI / 2, colors.sage);
      addChair(.76, 0, -Math.PI / 2, colors.sage);
      break;
    }
    case 'sofa': {
      box(colors.edge, 0, .14, 0, 1.78, .12, .82);
      for (const sx of [-.78, .78]) for (const sz of [-.32, .32]) box(colors.dark, sx, .06, sz, .08, .12, .08);
      box(colors.sage, 0, .36, .05, 1.54, .26, .66);
      box(colors.sage, 0, .68, -.28, 1.62, .56, .22);
      box(colors.slate, -.82, .5, .02, .18, .44, .76);
      box(colors.slate, .82, .5, .02, .18, .44, .76);
      box(colors.warm, -.45, .56, -.12, .34, .28, .14, .14);
      box(colors.brass, .46, .56, -.12, .34, .28, .14, -.12);
      break;
    }
    case 'whiteboard': {
      box(colors.dark, -.68, .92, 0, .065, 1.72, .065);
      box(colors.dark, .68, .92, 0, .065, 1.72, .065);
      box(colors.dark, -.68, .08, 0, .08, .08, .46);
      box(colors.dark, .68, .08, 0, .08, .08, .46);
      box(colors.metal, 0, 1.24, 0, 1.38, .92, .07);
      box(colors.white, 0, 1.24, 0, 1.28, .82, .085);
      box(colors.sage, -.22, 1.38, .048, .55, .04, .01);
      box(colors.plum, .18, 1.22, .048, .46, .04, .01);
      box(colors.brass, -.08, 1.06, .048, .64, .04, .01);
      box(colors.edge, 0, .77, .06, 1.1, .04, .1);
      break;
    }
    case 'server_rack': {
      box(colors.black, 0, .96, 0, .82, 1.92, .82);
      box(colors.dark, 0, .96, .4, .7, 1.74, .04);
      for (let slot = 0; slot < 6; slot++) {
        const sy = .28 + slot * .27;
        box(colors.metal, -.04, sy, .425, .52, .16, .02);
        box(slot % 2 ? colors.mint : colors.sage, .26, sy, .43, .055, .055, .02);
      }
      break;
    }
    case 'boss_desk': {
      box(colors.wood, 0, .82, 0, 2.15, .13, .98);
      box(colors.edge, 0, .74, 0, 2.12, .04, .95);
      for (const sx of [-.9, .9]) for (const sz of [-.34, .34]) box(colors.dark, sx, .35, sz, .09, .7, .09);
      box(colors.dark, -.35, 1.07, -.1, .67, .36, .09, .14);
      box(colors.screen, -.35, 1.07, -.03, .57, .27, .02, .14);
      box(colors.paper, .35, .91, .02, .42, .028, .33, -.12);
      cyl(colors.dark, -.82, .91, -.25, .26, .045, .26);
      cyl(colors.dark, -.82, 1.18, -.25, .045, .54, .045);
      part(cone, colors.brass, -.82, 1.48, -.25, .34, .18, .34);
      addChair(0, -.78, 0, colors.graphite);
      addChair(0, .78, Math.PI, colors.slate);
      break;
    }
    case 'reception': {
      for (let piece = 0; piece < 7; piece++) {
        const angle = (piece - 3) * .22;
        const rx = 1.15 * Math.sin(angle);
        const rz = -0.35 + 1.05 * Math.cos(angle);
        box(colors.wood, rx, .46, rz, .34, .92, .28, angle);
        box(colors.lightWood, rx, .95, rz, .4, .11, .56, angle);
      }
      box(colors.dark, 0, 1.14, .65, .52, .32, .12);
      box(colors.screen, 0, 1.15, .72, .44, .24, .03);
      addChair(0, -.32, 0, colors.plum);
      break;
    }
    case 'meeting_table': {
      box(colors.lightWood, 0, .76, 0, 2.95, .13, 1.38);
      box(colors.edge, 0, .68, 0, 2.92, .04, 1.35);
      for (const sx of [-1.25, 1.25]) for (const sz of [-.52, .52]) box(colors.dark, sx, .32, sz, .09, .64, .09);
      for (const ox of [-.95, 0, .95]) {
        addChair(ox, -.92, 0, colors.graphite);
        addChair(ox, .92, Math.PI, colors.graphite);
        box(colors.paper, ox, .84, -.38, .3, .022, .24, .06);
        box(colors.paper, ox, .84, .38, .3, .022, .24, -.06);
      }
      break;
    }
    case 'break_table': {
      box(colors.lightWood, 0, .74, 0, 3.15, .13, 1.12);
      box(colors.edge, 0, .66, 0, 3.12, .04, 1.08);
      for (const sx of [-1.35, 1.35]) for (const sz of [-.42, .42]) box(colors.dark, sx, .31, sz, .09, .62, .09);
      for (const ox of [-1.0, 0, 1.0]) {
        addChair(ox, -.82, 0, colors.sage);
        addChair(ox, .82, Math.PI, colors.sage);
      }
      cyl(colors.paper, -.65, .85, -.12, .14, .16, .14);
      cyl(colors.plum, .45, .85, .14, .13, .15, .13);
      box(colors.warm, 0, .82, 0, .42, .024, .28, .08);
      break;
    }
    case 'coffee_station': {
      box(colors.wood, 0, .48, 0, 1.24, .96, .68);
      box(colors.warm, 0, .99, 0, 1.3, .08, .74);
      box(colors.black, -.26, 1.24, -.04, .44, .42, .42);
      box(colors.metal, -.26, 1.18, .18, .28, .12, .08);
      cyl(colors.paper, .24, 1.11, .08, .13, .16, .13);
      cyl(colors.sage, .42, 1.11, -.08, .13, .16, .13);
      break;
    }
    default:
      box(colors.lightWood, 0, .4, 0, .8, .8, .8);
  }

  const spec = furnitureByType[item.type];
  if (spec && (ghost || selected)) {
    const pad = 0.08;
    const w = spec.width + pad;
    const d = spec.depth + pad;
    const ringColor = ghost === 'invalid' ? 0xc94a38 : ghost === 'valid' ? 0x2d8a5b : 0x3d614e;
    const planeGeom = new T.PlaneGeometry(w, d);
    const planeMat = new T.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: ghost ? 0.24 : 0.16,
      depthWrite: false,
    });
    const padMesh = new T.Mesh(planeGeom, planeMat);
    padMesh.rotation.x = -Math.PI / 2;
    padMesh.position.y = 0.032;
    padMesh.userData.ownedGeometry = true;
    group.add(padMesh);

    const borderGeom = new T.EdgesGeometry(new T.BoxGeometry(w, 0.02, d));
    const borderMat = new T.LineBasicMaterial({color: ringColor});
    const border = new T.LineSegments(borderGeom, borderMat);
    border.position.y = 0.04;
    border.userData.ownedGeometry = true;
    group.add(border);
  }

  return group;
}

const customWallHex = {
  sage: colors.sage,
  slate: colors.slate,
  warm: colors.warm,
  plum: colors.plum,
};

const customRugHex = {
  sand: {fill: 0xd7cab6, border: 0xb7a790},
  sage: {fill: 0xbac7be, border: 0x94a79b},
  slate: {fill: 0xb7c4cb, border: 0x8ea1ad},
  terracotta: {fill: 0xd4b3a3, border: 0xb48c7a},
};

export function buildCustomWallsGroup(walls = [], selectedWallId = null) {
  const group = new T.Group();
  if (!walls.length) return group;

  const matCache = new Map();
  const matFor = color => {
    if (!matCache.has(color)) matCache.set(color, new T.MeshStandardMaterial({color, roughness: 0.89}));
    return matCache.get(color);
  };
  const addBox = (color, x, y, z, w, h, d, wallId = null) => {
    const mesh = new T.Mesh(cube, matFor(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (wallId) mesh.userData.officeWallId = wallId;
    group.add(mesh);
  };

  // Merge all solid ground-level wall sub-segments using wallSections so T/L corners have zero Z-fighting.
  const solidSegments = [];
  for (const wall of walls) {
    const hex = customWallHex[wall.color] ?? colors.sage;
    const {solids, lintels} = wallSubSegments(wall);
    for (const seg of solids) solidSegments.push({...seg, color: hex});

    // Doorway overhead lintels + doorframe jambs
    for (const lintel of lintels) {
      const alongX = lintel.z1 === lintel.z2;
      const cx = (lintel.x1 + lintel.x2) / 2;
      const cz = (lintel.z1 + lintel.z2) / 2;
      const span = Math.hypot(lintel.x2 - lintel.x1, lintel.z2 - lintel.z1);
      const headerH = officeWallHeight - 2.15;
      addBox(hex, cx, 2.15 + headerH / 2, cz, alongX ? span : .16, headerH, alongX ? .16 : span, wall.id);
      addBox(colors.white, cx, officeWallHeight + .032, cz, alongX ? span + .06 : .22, .064, alongX ? .22 : span + .06, wall.id);
      // Timber/dark lintel bar + jambs framing the doorway cleanly
      addBox(colors.edge, cx, 2.13, cz, alongX ? span : .21, .07, alongX ? .21 : span, wall.id);
      addBox(colors.edge, lintel.x1, 1.075, lintel.z1, alongX ? .08 : .21, 2.15, alongX ? .21 : .08, wall.id);
      addBox(colors.edge, lintel.x2, 1.075, lintel.z2, alongX ? .08 : .21, 2.15, alongX ? .21 : .08, wall.id);
    }

    // Invisible full-span raycast proxy per wall so clicking anywhere along the wall selects/edits it cleanly
    const alongX = wallAxis(wall) === 'x';
    const cx = (wall.x1 + wall.x2) / 2;
    const cz = (wall.z1 + wall.z2) / 2;
    const span = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) + 0.22;
    const proxy = new T.Mesh(cube, new T.MeshBasicMaterial({transparent: true, opacity: 0, depthWrite: false}));
    proxy.position.set(cx, officeWallHeight / 2, cz);
    proxy.scale.set(alongX ? span : .36, officeWallHeight + .1, alongX ? .36 : span);
    proxy.userData.officeWallId = wall.id;
    group.add(proxy);

    if (selectedWallId === wall.id) {
      const selW = alongX ? span + 0.08 : 0.34;
      const selD = alongX ? 0.34 : span + 0.08;
      const borderGeom = new T.EdgesGeometry(new T.BoxGeometry(selW, officeWallHeight + 0.14, selD));
      const border = new T.LineSegments(borderGeom, new T.LineBasicMaterial({color: 0x3d614e}));
      border.position.set(cx, officeWallHeight / 2 + 0.04, cz);
      border.userData.ownedGeometry = true;
      group.add(border);
    }
  }

  for (const layer of [
    {thickness: .16, y: officeWallHeight / 2, height: officeWallHeight},
    {thickness: .22, y: officeWallHeight + .032, height: .064, color: colors.white},
    {thickness: .24, y: .085, height: .12, color: colors.edge},
  ]) {
    const segs = layer.color === undefined ? solidSegments : solidSegments.map(seg => ({...seg, color: layer.color}));
    for (const {x1, x2, z1, z2, color} of wallSections(segs, layer.thickness)) {
      addBox(color, (x1 + x2) / 2, layer.y, (z1 + z2) / 2, x2 - x1, layer.height, z2 - z1);
    }
  }

  return group;
}

export function buildWallGhostMesh(wall, valid = true) {
  const group = new T.Group();
  const hex = valid ? 0x2d8a5b : 0xc94a38;
  const mat = new T.MeshStandardMaterial({color: hex, roughness: 0.6, transparent: true, opacity: 0.52, depthWrite: false});
  const alongX = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const span = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  const w = span < 0.1 ? 0.24 : (alongX ? span + 0.16 : 0.18);
  const d = span < 0.1 ? 0.24 : (alongX ? 0.18 : span + 0.16);
  const mesh = new T.Mesh(cube, mat);
  mesh.position.set(cx, officeWallHeight / 2, cz);
  mesh.scale.set(w, officeWallHeight, d);
  group.add(mesh);

  const borderGeom = new T.EdgesGeometry(new T.BoxGeometry(w + 0.04, officeWallHeight + 0.04, d + 0.04));
  const border = new T.LineSegments(borderGeom, new T.LineBasicMaterial({color: hex}));
  border.position.set(cx, officeWallHeight / 2, cz);
  border.userData.ownedGeometry = true;
  group.add(border);
  return group;
}

export function buildDoorGhostMesh(wall, offset, valid = true) {
  const group = new T.Group();
  const hex = valid ? 0x2d8a5b : 0xc94a38;
  const alongX = wallAxis(wall) === 'x';
  const cx = alongX ? wall.x1 + offset : wall.x1;
  const cz = alongX ? wall.z1 : wall.z1 + offset;
  const w = alongX ? 1.4 : 0.34;
  const d = alongX ? 0.34 : 1.4;
  const mesh = new T.Mesh(cube, new T.MeshStandardMaterial({color: hex, roughness: 0.5, transparent: true, opacity: 0.56, depthWrite: false}));
  mesh.position.set(cx, 1.08, cz);
  mesh.scale.set(w, 2.16, d);
  group.add(mesh);
  return group;
}

export function buildCustomRugsGroup(rugs = [], selectedRugId = null) {
  const group = new T.Group();
  for (const rug of rugs) {
    const palette = customRugHex[rug.color] ?? customRugHex.sand;
    const w = Math.max(0.5, rug.x2 - rug.x1);
    const d = Math.max(0.5, rug.z2 - rug.z1);
    const cx = (rug.x1 + rug.x2) / 2;
    const cz = (rug.z1 + rug.z2) / 2;

    const borderMesh = new T.Mesh(cube, new T.MeshStandardMaterial({color: palette.border, roughness: 0.96}));
    borderMesh.position.set(cx, 0.011, cz);
    borderMesh.scale.set(w, 0.02, d);
    borderMesh.receiveShadow = true;
    borderMesh.userData.officeRugId = rug.id;
    group.add(borderMesh);

    const innerMesh = new T.Mesh(cube, new T.MeshStandardMaterial({color: palette.fill, roughness: 0.98}));
    innerMesh.position.set(cx, 0.015, cz);
    innerMesh.scale.set(Math.max(0.3, w - 0.22), 0.018, Math.max(0.3, d - 0.22));
    innerMesh.receiveShadow = true;
    innerMesh.userData.officeRugId = rug.id;
    group.add(innerMesh);

    if (selectedRugId === rug.id) {
      const outlineGeom = new T.EdgesGeometry(new T.BoxGeometry(w + 0.08, 0.04, d + 0.08));
      const outline = new T.LineSegments(outlineGeom, new T.LineBasicMaterial({color: 0x3d614e}));
      outline.position.set(cx, 0.032, cz);
      outline.userData.ownedGeometry = true;
      group.add(outline);
    }
  }
  return group;
}

export function buildRugGhostMesh(rug, valid = true) {
  const group = new T.Group();
  const hex = valid ? 0x2d8a5b : 0xc94a38;
  const w = Math.max(0.5, Math.abs(rug.x2 - rug.x1));
  const d = Math.max(0.5, Math.abs(rug.z2 - rug.z1));
  const cx = (rug.x1 + rug.x2) / 2;
  const cz = (rug.z1 + rug.z2) / 2;
  const mesh = new T.Mesh(cube, new T.MeshBasicMaterial({color: hex, transparent: true, opacity: 0.34, depthWrite: false}));
  mesh.position.set(cx, 0.028, cz);
  mesh.scale.set(w, 0.02, d);
  group.add(mesh);

  const outlineGeom = new T.EdgesGeometry(new T.BoxGeometry(w, 0.03, d));
  const outline = new T.LineSegments(outlineGeom, new T.LineBasicMaterial({color: hex}));
  outline.position.set(cx, 0.035, cz);
  outline.userData.ownedGeometry = true;
  group.add(outline);
  return group;
}

export function buildSnapIndicatorMesh(snap) {
  const group = new T.Group();
  if (!snap?.snapPoint) return group;
  const {x, z} = snap.snapPoint;
  const isAlign = snap.snapped === 'align';
  const ringHex = isAlign ? 0x38bdf8 : 0x22c55e;

  const ringGeom = new T.RingGeometry(0.18, 0.34, 24);
  const ringMat = new T.MeshBasicMaterial({color: ringHex, side: T.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false});
  const ring = new T.Mesh(ringGeom, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.055, z);
  ring.userData.ownedGeometry = true;
  group.add(ring);

  const dotGeom = new T.CircleGeometry(0.11, 16);
  const dotMat = new T.MeshBasicMaterial({color: 0xffffff, side: T.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false});
  const dot = new T.Mesh(dotGeom, dotMat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.set(x, 0.06, z);
  dot.userData.ownedGeometry = true;
  group.add(dot);

  const beacon = new T.Mesh(round, new T.MeshBasicMaterial({color: ringHex, transparent: true, opacity: 0.5, depthWrite: false}));
  beacon.position.set(x, officeWallHeight / 2, z);
  beacon.scale.set(0.08, officeWallHeight + 0.16, 0.08);
  group.add(beacon);

  if (snap.guide) {
    const lineGeom = new T.BufferGeometry().setFromPoints([
      new T.Vector3(snap.guide.x1, 0.07, snap.guide.z1),
      new T.Vector3(snap.guide.x2, 0.07, snap.guide.z2),
    ]);
    const lineMat = new T.LineDashedMaterial({color: ringHex, dashSize: 0.3, gapSize: 0.18, transparent: true, opacity: 0.85});
    const line = new T.Line(lineGeom, lineMat);
    line.computeLineDistances();
    line.userData.ownedGeometry = true;
    group.add(line);
  }
  return group;
}
