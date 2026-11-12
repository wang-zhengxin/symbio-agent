import * as T from '/office-vendor/three.module.min.js';
import { chatTables, desks, extraDesks, meetingTable, officeEast } from './office-presence.js';

const cube = new T.BoxGeometry(1, 1, 1);
const round = new T.CylinderGeometry(.5, .5, 1, 16);
const ball = new T.SphereGeometry(.5, 10, 8);
const cone = new T.CylinderGeometry(.38, .5, 1, 12);

export function officeLights(scene, shadows = false) {
  scene.add(new T.HemisphereLight(0xfff4e6, 0x777d88, 2.15));
  const sun = new T.DirectionalLight(0xffefdb, 2.05);
  sun.position.set(-8, 16, 7);
  if (shadows) {
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, {left:-17, right:17, top:16, bottom:-16, near:1, far:45});
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -.00035;
    sun.shadow.normalBias = .025;
  }
  scene.add(sun);
  const fill = new T.DirectionalLight(0xd5e9ff, .6);
  fill.position.set(7, 7, -11);
  scene.add(fill);
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
  function wallX(x1,x2,z,height,color) {
    const width = x2-x1, x = (x1+x2)/2;
    box(color,x,height/2,z,width,height,.16);
    box(colors.white,x,height+.032,z,width+.04,.064,.22);
    box(colors.edge,x,.085,z+.10,width,.12,.04);
  }
  function wallZ(z1,z2,x,height,color) {
    const depth = z2-z1, z = (z1+z2)/2;
    box(color,x,height/2,z,.16,height,depth);
    box(colors.white,x,height+.032,z,.22,.064,depth+.03);
    box(colors.edge,x+.10,.085,z,.04,.12,depth);
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

  // Model base, carpet and room thresholds.
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
  box(0xc9c3b1,6.44,.009,5.45,6.94,.025,4.98);
  box(0xaaa393,-6.82,.012,-5.74,6.13,.028,4.31);
  box(0xb4b7ae,6.45,.015,-5.87,6.93,.035,4.1);
  box(0x9b9284,-6.85,.02,5.85,5.9,.035,3.63);
  box(0xaaa79b,-2.7,.019,-.2,8.4,.028,5.5);

  wallX(-10,10,-8,2.78,colors.sage);
  wallZ(-8,2.9,-10,2.76,colors.slate);
  wallZ(2.9,7.98,-10,2.1,colors.plum);
  wallZ(-8,-2.95,10,2.28,colors.slate);
  if (east > 10) {
    const width = east-10, center = (east+10)/2;
    box(colors.edge,center,-.29,.1,width,.43,6.1);
    box(colors.dark,center,-.102,.1,width,.166,6.1);
    box(colors.carpet,center,-.014,.1,width,.028,6.1);
    wallX(10,east,-2.95,1.42,colors.sage);
    wallZ(-2.95,3.15,east,.46,colors.sage);
    extraDesks(workstationCount).forEach(([x,z],index) => desk(x,z,desks.length+index));
  } else wallZ(-2.95,2.75,10,.52,colors.sage);
  wallX(-9.9,-5.25,-3.63,2.04,colors.slate);
  wallZ(-7.92,-3.62,-3.6,2.25,colors.slate);
  wallX(3.28,7.73,-3.58,1.86,colors.sage);
  wallZ(-7.92,-3.58,3.28,2.31,colors.slate);
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
  box(colors.wood,8.77,.54,-7.44,2.06,1.06,.95);
  box(colors.gray,8.77,1.1,-7.44,2.13,.11,1);
  box(colors.black,9.21,1.32,-7.48,.54,.37,.62);
  box(colors.warm,8.75,2.01,-7.65,2.03,.57,.58);
  for(let door=0;door<3;door++) box(colors.dark,8.17+.56*door,1.88,-7.341,.12,.025,.025);
  for(let unit=0;unit<2;unit++) {
    const x = 4.12+unit*1.02;
    box(colors.dark,x,1.02,-7.53,.83,2.04,.84);
    box(colors.slate,x,1.26,-7.08,.69,1.25,.06);
    for(let row=0;row<4;row++) for(let col=0;col<3;col++) {
      box([colors.sage,colors.warm,colors.brass,colors.plum][(row+col+unit)%4],
        x-.21+col*.2,.85+row*.25,-7.039,.119,.15,.022);
    }
  }
  table(6.74,-5.44,2.16,.87);
  chair(6.12,-4.75,Math.PI); chair(7.24,-6.12);
  cylinder(colors.paper,6.39,.89,-5.55,.16,.18,.16);
  cylinder(colors.plum,7.02,.89,-5.32,.15,.18,.15);

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
    chair(x-.76,z,Math.PI/2,colors.sage);
    chair(x+.76,z,-Math.PI/2,colors.sage);
    cylinder(colors.paper,x,.79,z-.17,.126,.15,.126);
  }

  // Cutaway meeting room. The gap in the side wall is the entrance.
  wallX(3.22,9.9,2.92,1.17,colors.slate);
  blinds(6.23,.72,3.04,3.91,.75);
  wallZ(3,4.1,3.22,.97,colors.slate);
  wallZ(5.39,7.98,3.22,.76,colors.slate);
  wallZ(2.92,7.95,10,1.08,colors.slate);
  framed(9.87,.74,5.18,'left',1.87,.64,colors.white);
  const {x:mx,z:mz} = meetingTable;
  table(mx,mz,1.79,3.05,.76);
  for (const side of [-1,1]) {
    for(const offset of [-1.05,0,1.05]) {
      chair(mx+side*1.17,mz+offset,-side*Math.PI/2);
      box(colors.paper,mx+side*.5,.844,mz+offset,.32,.024,.27,side*.12);
      box(colors.dark,mx+side*.55,.861,mz+offset+.09,.17,.013,.022,side*.12);
      cylinder(colors.sage,mx+side*.34,.9,mz+offset+.29,.12,.13,.12);
    }
    chair(mx,mz+side*1.92,side>0 ? Math.PI : 0);
  }
  box(colors.gray,8.89,.58,3.62,.76,1.16,.68);
  box(colors.dark,8.89,1.19,3.62,.79,.10,.71);
  box(colors.paper,8.89,1.253,3.64,.49,.037,.32);
  [[-9.24,-7.18],[-9.3,2.78],[1.15,-7.27],[9.26,1.53],[8.94,7.24],[-4.95,7.36]]
    .forEach(([x,z],i) => plant(x,z,0,i%2 ? .92 : 1.3));

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
    shadow.geometry.dispose();
    shadow.material.dispose();
    for(const mesh of scene.children.filter(item => item.isInstancedMesh)) {
      scene.remove(mesh);
      mesh.material.dispose();
      mesh.dispose();
    }
  };
}
