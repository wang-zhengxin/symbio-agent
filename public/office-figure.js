import * as T from '/office-vendor/three.module.min.js';
import { officeStates } from './office-avatars.js';

const sphere = new T.SphereGeometry(.5,12,10);
const cube = new T.BoxGeometry(1,1,1);
const bodyShape = new T.CylinderGeometry(.5,.44,1,8);
const ringShape = new T.RingGeometry(.35,.385,28);
const palette = new Map();

function painted(color) {
  if (!palette.has(color)) palette.set(color,new T.MeshStandardMaterial({color, roughness:.86}));
  return palette.get(color);
}

function part(parent, shape, color, x,y,z,w,h,d) {
  const mesh = new T.Mesh(shape,painted(color));
  mesh.position.set(x,y,z);
  mesh.scale.set(w,h,d);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function joint(parent,x,y,z) {
  const item = new T.Group();
  item.position.set(x,y,z);
  parent.add(item);
  return item;
}

export function createOfficeFigure(avatar) {
  const root = new T.Group();
  const ring = new T.Mesh(ringShape,new T.MeshBasicMaterial({color:officeStates.idle.color, transparent:true, opacity:.75}));
  ring.rotation.x = -Math.PI/2;
  ring.position.y = .043;
  root.add(ring);
  const body = joint(root,0,.7,0);
  const upper = joint(body,0,0,0);
  part(upper,bodyShape,avatar.top,0,.224,0,.38,.42,.228);
  part(upper,sphere,avatar.top,0,.382,0,.38,.16,.23);
  part(upper,bodyShape,avatar.pants,0,-.022,0,.322,.15,.215);
  part(upper,sphere,avatar.skin,0,.448,.006,.125,.15,.126);
  const head = joint(upper,0,.563,.012);
  part(head,sphere,avatar.skin,0,0,0,.248,.29,.237);
  part(head,sphere,avatar.skin,0,-.008,.111,.052,.045,.045);
  for (const side of [-1,1]) {
    part(head,sphere,avatar.skin,side*.125,-.005,0,.056,.085,.047);
    part(head,sphere,0x32302a,side*.045,.013,.107,.024,.028,.014);
    const brow = part(head,cube,avatar.hair,side*.045,.043,.109,.036,.011,.01);
    brow.rotation.z = side*.08;
  }
  part(head,cube,0x72483c,0,-.056,.107,.049,.01,.01);
  part(head,sphere,avatar.hair,0,.085,-.031,.257,avatar.style === 'buzz' ? .133 : .19,.248);
  if (avatar.style === 'curls') {
    for(let i=0;i<7;i++) {
      const a = i*Math.PI/3.5;
      part(head,sphere,avatar.hair,Math.sin(a)*.078,.108,Math.cos(a)*.086-.018,.108,.107,.111);
    }
  } else if (avatar.style === 'bob' || avatar.style === 'bun') {
    part(head,sphere,avatar.hair,0,.007,-.073,.244,.27,.157);
    if (avatar.style === 'bun') part(head,sphere,avatar.hair,0,.068,-.142,.151,.151,.125);
    else for (const side of [-1,1]) part(head,sphere,avatar.hair,side*.108,-.034,-.032,.075,.217,.134);
  } else if (avatar.style !== 'buzz') {
    const fringe = part(head,sphere,avatar.hair,-.034,.097,.045,.195,.083,.154);
    fringe.rotation.z = avatar.style === 'part' ? .24 : -.12;
  }
  if (avatar.accessory === 'glasses') {
    for (const side of [-1,1]) {
      const frame = part(head,ringShape,0x403638,side*.049,.013,.123,.097,.096,.097);
      frame.castShadow = false;
      part(head,cube,0x403638,side*.099,.023,.078,.019,.013,.087);
    }
    part(head,cube,0x403638,0,.024,.125,.044,.01,.01);
  } else if (avatar.accessory === 'tie') {
    for (const side of [-1,1]) part(upper,cube,0xf1e5d7,side*.056,.396,.11,.074,.062,.025).rotation.z = side*.29;
    part(upper,cube,avatar.trim,0,.281,.123,.048,.189,.026).rotation.z = -.04;
  } else if (avatar.accessory === 'layer') {
    part(upper,cube,avatar.trim,0,.26,.115,.113,.277,.022);
    for (const side of [-1,1]) part(upper,cube,avatar.top,side*.065,.283,.13,.029,.25,.021).rotation.z = side*.082;
  } else if (avatar.accessory === 'pocket') {
    part(upper,cube,avatar.trim,.084,.264,.115,.091,.08,.024);
  } else if (avatar.accessory === 'hood') {
    part(upper,sphere,avatar.trim,0,.369,-.106,.256,.163,.163);
    for (const side of [-1,1]) part(upper,cube,avatar.trim,.031*side,.303,.121,.013,.125,.012);
  }
  const arms = [], elbows = [], legs = [], knees = [];
  for(const side of [-1,1]) {
    const arm = joint(upper,side*.18,.369,0);
    const elbow = joint(arm,0,-.191,0);
    part(arm,sphere,avatar.top,0,-.077,0,.126,.24,.132);
    part(elbow,sphere,avatar.top,0,-.053,0,.103,.18,.107);
    part(elbow,sphere,avatar.skin,0,-.144,.009,.091,.107,.093);
    arms.push(arm);
    elbows.push(elbow);
    const leg = joint(body,side*.092,-.052,0);
    const knee = joint(leg,0,-.287,0);
    part(leg,sphere,avatar.pants,0,-.122,0,.153,.345,.151);
    part(knee,sphere,avatar.pants,0,-.12,0,.128,.295,.134);
    part(knee,sphere,0x33343a,0,-.278,.046,.135,.116,.236);
    legs.push(leg);
    knees.push(knee);
  }
  const clipboard = joint(upper,0,.1,.24);
  part(clipboard,cube,0x83684a,0,0,0,.233,.295,.038);
  part(clipboard,cube,0xf5ecdb,0,0,.023,.2,.248,.012);
  for(let line=0;line<3;line++) part(clipboard,cube,0x9a9c8e,0,.045-line*.041,.031,.131,.01,.007);
  clipboard.rotation.x = -.65;

  function pose(state, seated, seconds, walking = false) {
    const tempo = seconds * 6.4;
    const pulse = Math.sin(seconds*2);
    const typing = state === 'working';
    const gesture = state === 'speaking';
    const studying = ['thinking','review'].includes(state);
    const down = state === 'blocked' || state === 'offline' || state === 'stopping';
    seated = seated && !walking;
    body.position.y = (seated ? .519 : .671) + (walking ? Math.abs(Math.sin(tempo))*.049 : pulse*.008);
    upper.rotation.x = seated ? .055 : 0;
    if (down) upper.rotation.x += .13;
    head.rotation.x = down ? .25 : typing ? .115 : studying ? .19 : -.035;
    head.rotation.y = Math.sin(seconds*(gesture ? 2.7 : .91)) * (gesture ? .23 : .1);
    for (const [i, side] of [-1,1].entries()) {
      const stride = Math.sin(tempo) * side;
      const beat = Math.sin(seconds*17 + i*2.6);
      arms[i].rotation.z = side * (seated ? .12 : .14);
      arms[i].rotation.x = walking ? .52*stride : typing && seated ? -.77 + beat*.095 :
        gesture ? -.72 + Math.sin(tempo+i)*.22 : studying ? -.5 : seated ? -.26 : -.035 + pulse*.026;
      elbows[i].rotation.x = walking ? -.16 : typing && seated ? -.77 + beat*.15 :
        gesture ? -.65 + Math.sin(tempo+i)*.24 : studying ? -.95 : seated ? -.65 : -.13;
      if (!walking && state === 'thinking' && i === 1) {
        arms[i].rotation.x = -.42;
        arms[i].rotation.z = -.23;
        elbows[i].rotation.x = -1.89;
      }
      if (!walking && state === 'paused') {
        arms[i].rotation.x = -.23;
        arms[i].rotation.z = -side*.34;
        elbows[i].rotation.x = -.99;
      }
      legs[i].rotation.x = seated ? -1.57 : walking ? -.57*stride : 0;
      knees[i].rotation.x = seated ? 1.56 : walking ? Math.max(0, -.49*stride) : .045;
    }
    clipboard.visible = !walking && (state === 'review' || state === 'queued');
    ring.material.color.set(officeStates[state].color);
    ring.material.opacity = state === 'offline' ? .27 : gesture ? .68 + pulse*.24 : .85;
  }

  return {root, pose, dispose:() => ring.material.dispose()};
}
