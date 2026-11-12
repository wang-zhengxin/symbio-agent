import * as T from '/office-vendor/three.module.min.js';
import { officeStates } from './office-avatars.js';
import { createOfficeFigure } from './office-figure.js';
import { buildOffice, officeLights } from './office-model.js';
import { baseWorkstations, createOfficeStrolls, officeEast, placeOfficeActors, workstationLabel } from './office-presence.js';

const clamp = T.MathUtils.clamp;
const tau = Math.PI * 2;
const noMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const head = new T.Vector3();

function newRenderer(shadows = false) {
  const renderer = new T.WebGLRenderer({alpha:true, antialias:true, powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, shadows ? 1.55 : 1.35));
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.17;
  return renderer;
}

function createLabel(layer) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'office-actor-marker';
  button.dataset.action = 'office-person';
  const dot = document.createElement('i');
  const name = document.createElement('span');
  button.append(dot,name);
  layer.append(button);
  return {button, name};
}

function walkPath(from, to) {
  const meetingExit = [{x:4.02,z:4.68},{x:2.14,z:4.68},{x:2.14,z:2.3}];
  const insideMeeting = from.x > 3.22 && from.z > 2.92;
  const leaving = from.area === 'meeting' && insideMeeting && to.area !== 'meeting' ? meetingExit
    : from.area === 'stroll' ? from.exit.filter(point => point.z <= from.z + .1)
      : from.area === 'desk' && from.z <= 2.3 ? from.exit : [];
  const entering = to.area === 'meeting' && !insideMeeting ? meetingExit
    : to.area !== 'meeting' ? to.exit ?? [] : [];
  return [...leaving, ...entering.slice().reverse(), to];
}

export function createOfficeScene(host, stroll = createOfficeStrolls()) {
  const renderer = newRenderer(true);
  const scene = new T.Scene();
  officeLights(scene,true);
  let disposeOffice, workstationCount, east = 10;
  const camera = new T.OrthographicCamera(-12,12,9,-9,.1,100);
  const target = new T.Vector3(0,.59,0);
  let bounds = [];
  const cameraPoint = new T.Vector3();
  const surface = document.createElement('div');
  surface.className = 'office-webgl';
  const labels = document.createElement('div');
  labels.className = 'office-actor-labels';
  const zoneLabels = document.createElement('div');
  zoneLabels.className = 'office-actor-labels office-layout-zone-labels';
  zoneLabels.setAttribute('aria-label','空间区域');
  renderer.domElement.setAttribute('aria-hidden','true');
  surface.append(renderer.domElement,labels,zoneLabels);
  host.append(surface);

  let yaw = .66, targetYaw = yaw, zoom = 1, width = 1, height = 1, selected, showNames = true;
  let frame, lastTime = 0, changed = true;
  let visits = new Map();
  const records = new Map();
  const zoneMarkers = new Map();
  const idleAtDesk = new Set();
  const none = new Set();
  const ray = new T.Raycaster();
  const pointer = new T.Vector2();

  function fit() {
    const distance = 31 + (east-10)/2;
    camera.position.set(target.x + Math.sin(yaw)*distance,distance*22.7/31,Math.cos(yaw)*distance);
    camera.far = 100 + east;
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let extentX = 0, extentY = 0;
    for (const corner of bounds) {
      cameraPoint.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      extentX = Math.max(extentX,Math.abs(cameraPoint.x));
      extentY = Math.max(extentY,Math.abs(cameraPoint.y));
    }
    const aspect = width/height;
    const half = Math.max(extentY*1.075, extentX/aspect*1.075)/zoom;
    camera.left = -half*aspect;
    camera.right = half*aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
  }

  function resize() {
    const w = surface.clientWidth, h = surface.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(w,h,false);
    fit();
    changed = true;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(surface);
  resize();

  function remove(key, record) {
    scene.remove(record.figure.root);
    record.figure.dispose();
    record.label.button.remove();
    records.delete(key);
  }

  function moveTo(record, destination) {
    const previous = record.destination;
    if (previous.x !== destination.x || previous.z !== destination.z) {
      const {x,z} = record.figure.root.position;
      record.path = walkPath({...previous,x,z},destination);
    }
    record.destination = destination;
    const {button} = record.label;
    const {actor} = record;
    const location = destination.area === 'stroll' ? '休息区' :
      destination.area === 'desk' ? workstationLabel(actor.seatIndex) : '';
    const title = [actor.name,actor.label,location].filter(Boolean).join(' · ');
    button.dataset.area = destination.area;
    button.dataset.moving = String(record.path.length > 0);
    button.setAttribute('aria-label',title);
    button.title = title;
  }

  function update(actors, percentage, selectedKey, count = baseWorkstations) {
    if (count !== workstationCount) {
      disposeOffice?.();
      workstationCount = count;
      surface.dataset.workstations = count;
      east = officeEast(count);
      disposeOffice = buildOffice(scene,count);
      target.x = (east-10)/2;
      bounds = [-10.25,east+.25].flatMap(x => [-8.25,8.25].flatMap(z =>
        [-.5,2.85].map(y => new T.Vector3(x,y,z))));
      fit();
    }
    const positions = placeOfficeActors(actors, count);
    const visible = actors.filter(actor => positions.has(actor.key));
    const keep = new Set(visible.map(actor => actor.key));
    for (const [key, record] of records) if (!keep.has(key)) remove(key,record);
    selected = selectedKey;
    showNames = visible.length < 10;
    idleAtDesk.clear();
    for (const actor of visible) {
      const home = positions.get(actor.key);
      if (home.area === 'desk' && actor.state === 'idle') idleAtDesk.add(actor.key);
      const destination = idleAtDesk.has(actor.key) ? visits.get(actor.key)?.position ?? home : home;
      let record = records.get(actor.key);
      if (record?.avatarId !== actor.avatar.id) {
        if (record) remove(actor.key,record);
        const figure = createOfficeFigure(actor.avatar);
        const label = createLabel(labels);
        figure.root.position.set(destination.x,0,destination.z);
        figure.root.rotation.y = destination.angle;
        scene.add(figure.root);
        record = {figure,label,avatarId:actor.avatar.id,destination,path:[]};
        records.set(actor.key,record);
      }
      record.actor = actor;
      record.home = home;
      moveTo(record,destination);
      const {button,name} = record.label;
      button.dataset.id = actor.key;
      button.dataset.state = actor.state;
      button.setAttribute('aria-pressed',String(actor.key === selected));
      button.style.setProperty('--actor-color',officeStates[actor.state].color);
      if (name.textContent !== actor.name) name.textContent = actor.name;
    }
    if (zoom !== percentage/100) {
      zoom = percentage/100;
      fit();
    }
    changed = true;
    return {visible:visible.length, total:actors.length};
  }

  function updateZones(zones) {
    const keep = new Set(zones.map(zone => zone.id));
    for (const [id, marker] of zoneMarkers) {
      if (keep.has(id)) continue;
      marker.button.remove();
      zoneMarkers.delete(id);
    }
    for (const zone of zones) {
      let marker = zoneMarkers.get(zone.id);
      if (!marker) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'office-layout-zone-marker';
        button.dataset.action = 'ws-zone';
        button.dataset.id = zone.id;
        zoneLabels.append(button);
        marker = {button, point:new T.Vector3()};
        zoneMarkers.set(zone.id,marker);
      }
      marker.point.set(zone.x,1.75,zone.z);
      marker.button.textContent = zone.name;
      marker.button.setAttribute('aria-pressed',String(zone.selected));
      marker.button.dataset.visible = String(zone.visible);
      marker.button.title = zone.visible ? zone.name : zone.name + ' · 已隐藏';
    }
    changed = true;
  }

  renderer.domElement.addEventListener('click', event => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)*2/rect.width-1,1-(event.clientY-rect.top)*2/rect.height);
    ray.setFromCamera(pointer,camera);
    const hit = ray.intersectObjects([...records.values()].map(record => record.figure.root),true)[0];
    if (!hit) return;
    let root = hit.object;
    while (root.parent && root.parent !== scene) root = root.parent;
    [...records.values()].find(record => record.figure.root === root)?.label.button.click();
  });

  function tick(time) {
    frame = requestAnimationFrame(tick);
    if (!surface.isConnected || document.hidden || time-lastTime < 31) return;
    const delta = Math.min((time-lastTime)/1000,.14);
    lastTime = time;
    const reduced = noMotion();
    visits = stroll(reduced ? none : idleAtDesk,time);
    for (const key of idleAtDesk) {
      const record = records.get(key);
      const destination = visits.get(key)?.position ?? record.home;
      if (destination !== record.destination) {
        moveTo(record,destination);
        changed = true;
      }
    }
    if (reduced && !changed) return;
    if (Math.abs(yaw-targetYaw) > .001) {
      yaw = reduced ? targetYaw : T.MathUtils.lerp(yaw,targetYaw,Math.min(1,delta*7));
      fit();
    }
    const markers = [];
    for (const [index,record] of [...records.values()].entries()) {
      const {figure, destination, actor, path, label} = record;
      const {position,rotation} = figure.root;
      let angle = destination.angle;
      if (reduced) {
        path.length = 0;
        position.set(destination.x,0,destination.z);
      } else if (path.length) {
        const next = path[0], dx = next.x-position.x, dz = next.z-position.z;
        const distance = Math.hypot(dx,dz);
        const step = Math.min(distance,delta*(actor.state === 'idle' ? 2.8 : 4.1));
        if (distance > .001) {
          position.x += dx*step/distance;
          position.z += dz*step/distance;
          angle = Math.atan2(dx,dz);
        }
        if (distance-step < .002) path.shift();
      }
      const turn = T.MathUtils.euclideanModulo(angle-rotation.y+Math.PI,tau)-Math.PI;
      rotation.y += turn*(reduced ? 1 : Math.min(1,delta*11));
      figure.pose(actor.state,destination.seated,reduced ? 0 : time/1000 + index*.37,Boolean(path.length));
      label.button.dataset.moving = String(path.length > 0);
      head.set(position.x,(destination.seated && !path.length ? 1.31 : 1.49),position.z).project(camera);
      label.button.hidden = Math.abs(head.x) > .96 || Math.abs(head.y) > .96;
      const x = (head.x+1)*width/2, y = (1-head.y)*height/2;
      label.button.style.translate = x + 'px ' + y + 'px';
      label.button.style.zIndex = actor.key === selected ? 100 : Math.round((head.y*-1+1)*35);
      const important = zoneMarkers.size === 0 && ['speaking','working','blocked','thinking'].includes(actor.state);
      const priority = actor.key === selected ? 2 : important ? 1 : 0;
      markers.push({button:label.button,x,y,priority,name:actor.name});
    }
    const named = [];
    for (const marker of markers.sort((a,b) => b.priority-a.priority)) {
      const halfWidth = Math.min(70, (marker.name.length * 10 + 20) / 2);
      const overlaps = named.some(other => Math.abs(marker.x-other.x) < halfWidth+other.halfWidth+4 &&
        Math.abs(marker.y-other.y) < 19);
      const show = !marker.button.hidden && (marker.priority > 0 || (zoneMarkers.size === 0 && showNames && width > 480)) && !overlaps;
      marker.button.dataset.named = String(show);
      if (show) named.push({...marker,halfWidth});
    }
    for (const {point, button} of zoneMarkers.values()) {
      head.copy(point).project(camera);
      button.hidden = Math.abs(head.x) > .94 || Math.abs(head.y) > .94;
      button.style.translate = (head.x+1)*width/2 + 'px ' + (1-head.y)*height/2 + 'px';
    }
    renderer.render(scene,camera);
    changed = false;
  }
  frame = requestAnimationFrame(tick);
  return {
    mount(next) {
      if (surface.parentNode !== next) next.append(surface);
      resize();
    },
    update,
    updateZones,
    rotate(direction) {
      targetYaw = direction === 0 ? .66 : clamp(targetYaw+direction*.25,.07,1.19);
      changed = true;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const [key, record] of records) remove(key,record);
      disposeOffice?.();
      renderer.dispose();
      renderer.forceContextLoss();
      surface.remove();
    },
  };
}

export function createFigurePreview(host) {
  const renderer = newRenderer();
  const scene = new T.Scene();
  officeLights(scene);
  const camera = new T.OrthographicCamera(-.88,.88,.88,-.88,.1,20);
  camera.position.set(2.3,1.56,4.8);
  camera.lookAt(0,.71,0);
  renderer.setSize(152,152,false);
  renderer.domElement.setAttribute('aria-hidden','true');
  host.append(renderer.domElement);
  const chair = new T.Group();
  const chairGeometry = new T.BoxGeometry(1,1,1);
  const fabric = new T.MeshStandardMaterial({color:0x69746f});
  const metal = new T.MeshStandardMaterial({color:0x3d4442});
  for (const [x,y,z,w,h,d,material] of [
    [0,.46,-.02,.51,.1,.48,fabric], [0,.715,-.24,.49,.41,.085,fabric],
    [0,.24,-.03,.065,.39,.065,metal], [0,.067,-.03,.48,.05,.1,metal],
    [0,.065,-.03,.1,.05,.47,metal],
  ]) {
    const piece = new T.Mesh(chairGeometry,material);
    piece.position.set(x,y,z);
    piece.scale.set(w,h,d);
    chair.add(piece);
  }
  scene.add(chair);
  let figure, state = 'idle', frame, last = 0;
  let avatarId;
  function preview(avatar,nextState) {
    if (avatarId !== avatar.id) {
      if (figure) {
        scene.remove(figure.root);
        figure.dispose();
      }
      figure = createOfficeFigure(avatar);
      scene.add(figure.root);
      avatarId = avatar.id;
    }
    state = nextState;
    chair.visible = ['idle','working','thinking','speaking','listening','review','stopping','blocked'].includes(state);
    figure.pose(state,chair.visible,0);
    renderer.render(scene,camera);
  }
  function draw(time) {
    frame = requestAnimationFrame(draw);
    if (!figure || !host.isConnected || document.hidden || noMotion() || time-last < 45) return;
    last = time;
    figure.root.rotation.y = -.13 + Math.sin(time/2400)*.34;
    chair.rotation.y = figure.root.rotation.y;
    figure.pose(state,chair.visible,time/1000);
    renderer.render(scene,camera);
  }
  frame = requestAnimationFrame(draw);
  return {
    preview,
    dispose() {
      cancelAnimationFrame(frame);
      figure?.dispose();
      chairGeometry.dispose();
      fabric.dispose();
      metal.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
