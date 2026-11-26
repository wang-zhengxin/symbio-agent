import * as T from './office-vendor/three.module.min.js';
import { OrbitControls } from './office-vendor/OrbitControls.js';
import { officeStates } from './office-avatars.js';
import { createOfficeFigure } from './office-figure.js';
import {
  buildCustomFloorsGroup, buildCustomFurnitureMesh, buildCustomRugsGroup, buildCustomWallsGroup,
  buildDoorGhostMesh, buildEmptyOfficeStage, buildFloorGhostMesh, buildOffice, buildRugGhostMesh,
  buildSnapIndicatorMesh, buildWallGhostMesh, disposeFurnitureGroup, officeLights,
} from './office-model.js';
import { baseWorkstations, createOfficeStrolls, officeEast, placeOfficeActors, workstationLabel } from './office-presence.js';
import {
  customCanvasBounds, customSpecialSeats, findOfficePath, normalizeFloor, normalizeRug, normalizeWall,
  snapDrawPoint, snapGrid, validateDoorPlacement, validateFloorPlacement, validateItemPlacement,
  validateRugPlacement, validateWallPlacement, wallAxis, wallLength,
} from './office-furniture.js';

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

function walkPath(from, to, count = baseWorkstations, items = [], walls = [], mode = 'default', floors = []) {
  return findOfficePath(from, to, count, items, walls, mode, floors);
}

export function createOfficeScene(host, stroll = createOfficeStrolls()) {
  const renderer = newRenderer(true);
  const scene = new T.Scene();
  const lights = officeLights(scene,true);
  let disposeOffice, workstationCount, east = 10, lightHour = null, lightZone, lastLightMinute = -1;
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
  const deskLabels = document.createElement('div');
  deskLabels.className = 'office-actor-labels office-desk-labels';
  deskLabels.setAttribute('aria-label','实体工位');
  renderer.domElement.setAttribute('aria-hidden','true');
  surface.append(renderer.domElement,deskLabels,labels,zoneLabels);
  host.append(surface);

  let zoom = 1, width = 1, height = 1, selected, showNames = true;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.minPolarAngle = .04;
  controls.maxPolarAngle = Math.PI / 2 - .04;
  controls.minZoom = .35;
  controls.maxZoom = 4;
  controls.screenSpacePanning = true;
  let frame, lastTime = 0, changed = true;
  let visits = new Map();
  const records = new Map();
  const zoneMarkers = new Map();
  const deskMarkers = new Map();
  const idleAtDesk = new Set();
  let reservedLounge = [];
  const none = new Set();
  const ray = new T.Raycaster();
  const pointer = new T.Vector2();
  const floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const floorHit = new T.Vector3();
  let officeMode = 'default';
  let officeFloors = [];
  let officeItems = [];
  let officeWalls = [];
  let officeRugs = [];
  const customMeshes = new Map();
  let customFloorsGroup = null, customFloorsSig = '';
  let customWallsGroup = null, customWallsSig = '';
  let customRugsGroup = null, customRugsSig = '';
  let designState = {
    active: false, mode: 'default', tool: 'select', placingType: null, placingRotation: 0,
    wallColor: 'sage', floorMaterial: 'carpet', rugColor: 'sand', selected: null,
    floors: [], items: [], walls: [], rugs: [], wingCount: baseWorkstations,
  };
  let gridHelper = null;
  let ghostMesh = null;
  let ghostSig = '';
  let snapMarker = null;
  let snapSig = '';
  let dragItem = null;
  let drawAnchor = null;
  let dragMovedDraw = false;
  const designHint = document.createElement('div');
  designHint.className = 'office-design-hint';
  designHint.hidden = true;
  surface.append(designHint);
  controls.addEventListener('change', () => { changed = true; });

  function resetView() {
    const distance = 31 + (east-10)/2;
    controls.target.copy(target);
    camera.position.set(target.x + Math.sin(.66)*distance,distance*22.7/31,Math.cos(.66)*distance);
    camera.zoom = zoom;
    controls.update();
    fit();
  }

  function fit() {
    camera.far = 100 + east;
    camera.updateMatrixWorld();
    let extentX = 0, extentY = 0;
    for (const corner of bounds) {
      cameraPoint.copy(corner).sub(target).applyQuaternion(camera.quaternion.clone().invert());
      extentX = Math.max(extentX,Math.abs(cameraPoint.x));
      extentY = Math.max(extentY,Math.abs(cameraPoint.y));
    }
    const aspect = width/height;
    const half = Math.max(extentY*1.075, extentX/aspect*1.075, 1);
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
      record.path = walkPath({...previous,x,z}, destination, workstationCount ?? baseWorkstations, officeItems, officeWalls, officeMode, officeFloors);
    }
    record.destination = destination;
    const {button} = record.label;
    const {actor} = record;
    const location = destination.area === 'private' ? '独立办公室' : destination.area === 'reception' ? '前台座位' :
      destination.area === 'stroll' ? (destination.seated ? '休息区 · 坐下休息' : '休息区 · 散步') :
      destination.area === 'desk' ? workstationLabel(actor.seatIndex) : '';
    const title = [actor.name,actor.label,actor.title,location].filter(Boolean).join(' · ');
    button.dataset.area = destination.area;
    button.dataset.moving = String(record.path.length > 0);
    button.setAttribute('aria-label',title);
    button.title = title;
  }

  function syncCustomItems(items = [], selected = null) {
    officeItems = Array.isArray(items) ? items : [];
    const selectedItemId = selected?.kind === 'item' ? selected.id : null;
    const keep = new Set(officeItems.map(item => item.id));
    for (const [id, entry] of customMeshes) {
      if (keep.has(id)) continue;
      scene.remove(entry.group);
      disposeFurnitureGroup(entry.group);
      customMeshes.delete(id);
    }
    for (const item of officeItems) {
      const isSelected = Boolean(designState.active && selectedItemId === item.id);
      const sig = `${item.type}:${item.x}:${item.z}:${item.rotation}:${isSelected ? 1 : 0}`;
      const existing = customMeshes.get(item.id);
      if (existing?.sig === sig) continue;
      if (existing) {
        scene.remove(existing.group);
        disposeFurnitureGroup(existing.group);
      }
      const group = buildCustomFurnitureMesh(item, {selected: isSelected});
      scene.add(group);
      customMeshes.set(item.id, {group, sig});
    }
    changed = true;
  }

  function syncCustomWalls(walls = [], selected = null) {
    officeWalls = Array.isArray(walls) ? walls : [];
    const selectedWallId = designState.active && selected?.kind === 'wall' ? selected.id : null;
    const sig = JSON.stringify([officeWalls, selectedWallId]);
    if (sig === customWallsSig) return;
    if (customWallsGroup) {
      scene.remove(customWallsGroup);
      disposeFurnitureGroup(customWallsGroup);
      customWallsGroup = null;
    }
    if (officeWalls.length) {
      customWallsGroup = buildCustomWallsGroup(officeWalls, selectedWallId);
      scene.add(customWallsGroup);
    }
    customWallsSig = sig;
    changed = true;
  }

  function syncCustomFloors(floors = [], selected = null) {
    officeFloors = Array.isArray(floors) ? floors : [];
    const selectedFloorId = designState.active && selected?.kind === 'floor' ? selected.id : null;
    const sig = JSON.stringify([officeMode, officeFloors, selectedFloorId]);
    if (sig === customFloorsSig) return;
    if (customFloorsGroup) {
      scene.remove(customFloorsGroup);
      disposeFurnitureGroup(customFloorsGroup);
      customFloorsGroup = null;
    }
    if (officeMode === 'custom' && officeFloors.length) {
      customFloorsGroup = buildCustomFloorsGroup(officeFloors, selectedFloorId);
      scene.add(customFloorsGroup);
    }
    customFloorsSig = sig;
    changed = true;
  }

  function syncCustomRugs(rugs = [], selected = null) {
    officeRugs = Array.isArray(rugs) ? rugs : [];
    const selectedRugId = designState.active && selected?.kind === 'rug' ? selected.id : null;
    const sig = JSON.stringify([officeRugs, selectedRugId]);
    if (sig === customRugsSig) return;
    if (customRugsGroup) {
      scene.remove(customRugsGroup);
      disposeFurnitureGroup(customRugsGroup);
      customRugsGroup = null;
    }
    if (officeRugs.length) {
      customRugsGroup = buildCustomRugsGroup(officeRugs, selectedRugId);
      scene.add(customRugsGroup);
    }
    customRugsSig = sig;
    changed = true;
  }

  function clearSnapIndicator() {
    if (snapMarker) {
      scene.remove(snapMarker);
      disposeFurnitureGroup(snapMarker);
      snapMarker = null;
      snapSig = '';
      changed = true;
    }
  }

  function showSnapIndicator(snap) {
    if (!snap?.snapPoint) {
      clearSnapIndicator();
      return;
    }
    const g = snap.guide;
    const sig = `${snap.snapped}:${snap.snapPoint.x}:${snap.snapPoint.z}:${g ? `${g.x1},${g.z1},${g.x2},${g.z2}` : ''}`;
    if (snapMarker && snapSig === sig) return;
    clearSnapIndicator();
    snapMarker = buildSnapIndicatorMesh(snap);
    snapSig = sig;
    scene.add(snapMarker);
    changed = true;
  }

  function clearGhost() {
    if (ghostMesh) {
      scene.remove(ghostMesh);
      disposeFurnitureGroup(ghostMesh);
      ghostMesh = null;
      ghostSig = '';
      changed = true;
    }
    clearSnapIndicator();
    designHint.hidden = true;
    designHint.dataset.tone = '';
  }

  function setHint(text, ok = false) {
    if (!text) { designHint.hidden = true; return; }
    designHint.hidden = false;
    designHint.dataset.tone = ok ? 'ok' : 'warn';
    designHint.textContent = text;
  }

  function replaceGhost(mesh, sig) {
    if (ghostMesh) {
      scene.remove(ghostMesh);
      disposeFurnitureGroup(ghostMesh);
    }
    ghostMesh = mesh;
    ghostSig = sig;
    scene.add(ghostMesh);
    changed = true;
  }

  function showGhost(candidate, valid, reason) {
    const mode = valid ? 'valid' : 'invalid';
    const sig = `item:${candidate.type}:${candidate.rotation}:${mode}`;
    if (!ghostMesh || ghostSig !== sig) {
      replaceGhost(buildCustomFurnitureMesh(candidate, {ghost: mode}), sig);
    }
    ghostMesh.position.set(candidate.x, 0, candidate.z);
    setHint(valid ? '' : reason, false);
    changed = true;
  }

  function showWallGhost(wall, valid, hintText) {
    const sig = `wall:${wall.x1}:${wall.z1}:${wall.x2}:${wall.z2}:${valid ? 1 : 0}`;
    if (!ghostMesh || ghostSig !== sig) {
      replaceGhost(buildWallGhostMesh(wall, valid), sig);
    }
    setHint(hintText, valid);
  }

  function showDoorGhost(wall, offset, valid, hintText) {
    const sig = `door:${wall.id}:${offset}:${valid ? 1 : 0}`;
    if (!ghostMesh || ghostSig !== sig) {
      replaceGhost(buildDoorGhostMesh(wall, offset, valid), sig);
    }
    setHint(hintText, valid);
  }

  function showRugGhost(rug, valid, hintText) {
    const sig = `rug:${rug.x1}:${rug.z1}:${rug.x2}:${rug.z2}:${valid ? 1 : 0}`;
    if (!ghostMesh || ghostSig !== sig) {
      replaceGhost(buildRugGhostMesh(rug, valid), sig);
    }
    setHint(hintText, valid);
  }

  function showFloorGhost(floor, valid, hintText) {
    const sig = `floor:${floor.x1}:${floor.z1}:${floor.x2}:${floor.z2}:${valid ? 1 : 0}`;
    if (!ghostMesh || ghostSig !== sig) {
      replaceGhost(buildFloorGhostMesh(floor, valid), sig);
    }
    setHint(hintText, valid);
  }

  let gridModeKey = '';
  function syncGrid() {
    const shouldShow = Boolean(designState.active);
    const wantKey = shouldShow ? `${officeMode}:${east}` : '';
    if (gridHelper && gridModeKey !== wantKey) {
      scene.remove(gridHelper);
      gridHelper.geometry.dispose();
      gridHelper.material.dispose();
      gridHelper = null;
      gridModeKey = '';
      changed = true;
    }
    if (shouldShow && !gridHelper) {
      const verts = [];
      const y = 0.025;
      const pushLine = (x1, z1, x2, z2) => verts.push(x1, y, z1, x2, y, z2);
      if (officeMode === 'custom') {
        const {minX, maxX, minZ, maxZ} = customCanvasBounds;
        for (let x = minX; x <= maxX; x += 0.5) pushLine(x, minZ, x, maxZ);
        for (let z = minZ; z <= maxZ; z += 0.5) pushLine(minX, z, maxX, z);
      } else {
        for (let x = -9.5; x <= 9.5; x += 0.5) pushLine(x, -7.85, x, 7.85);
        for (let z = -7.5; z <= 7.5; z += 0.5) pushLine(-9.85, z, 9.85, z);
        if (east > 10) {
          for (let x = 10; x <= east - 0.15; x += 0.5) pushLine(x, -2.85, x, 3.05);
          for (let z = -2.5; z <= 3.0; z += 0.5) pushLine(9.85, z, east - 0.15, z);
        }
      }
      const geom = new T.BufferGeometry();
      geom.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
      const mat = new T.LineBasicMaterial({color: officeMode === 'custom' ? 0x62746c : 0x6c665c, transparent: true, opacity: officeMode === 'custom' ? 0.3 : 0.24});
      gridHelper = new T.LineSegments(geom, mat);
      scene.add(gridHelper);
      gridModeKey = wantKey;
      changed = true;
    }
  }

  function rebuildBaseArchitecture(count, mode) {
    disposeOffice?.();
    workstationCount = count;
    officeMode = mode;
    surface.dataset.workstations = count;
    surface.dataset.mode = mode;
    if (mode === 'custom') {
      east = 12;
      disposeOffice = buildEmptyOfficeStage(scene);
      target.x = 0;
      bounds = [customCanvasBounds.minX - 0.5, customCanvasBounds.maxX + 0.5].flatMap(x =>
        [customCanvasBounds.minZ - 0.5, customCanvasBounds.maxZ + 0.5].flatMap(z =>
          [-.5, 2.85].map(y => new T.Vector3(x, y, z))));
    } else {
      east = officeEast(count);
      disposeOffice = buildOffice(scene, count);
      target.x = (east - 10) / 2;
      bounds = [-10.25, east + .25].flatMap(x => [-8.25, 8.25].flatMap(z =>
        [-.5, 2.85].map(y => new T.Vector3(x, y, z))));
    }
    syncGrid();
    resetView();
  }

  function setDesignMode(config) {
    const next = config?.active ? config : {
      active: false, mode: officeMode, tool: 'select', placingType: null, placingRotation: 0,
      wallColor: 'sage', floorMaterial: 'carpet', rugColor: 'sand', selected: null,
      floors: officeFloors, items: officeItems, walls: officeWalls, rugs: officeRugs, wingCount: workstationCount ?? baseWorkstations,
    };
    const toolChanged = designState.tool !== next.tool || designState.placingType !== next.placingType || designState.mode !== next.mode;
    designState = next;
    surface.dataset.design = String(Boolean(next.active));
    surface.dataset.placing = String(Boolean(next.active && next.tool !== 'select'));
    if (next.mode && next.mode !== officeMode) {
      rebuildBaseArchitecture(workstationCount ?? baseWorkstations, next.mode);
    }
    if (!next.active || toolChanged) {
      drawAnchor = null;
      dragMovedDraw = false;
      controls.enabled = true;
      clearGhost();
    }
    syncGrid();
    syncCustomFloors(next.floors ?? officeFloors, next.selected ?? null);
    syncCustomItems(next.items ?? officeItems, next.selected ?? null);
    syncCustomWalls(next.walls ?? officeWalls, next.selected ?? null);
    syncCustomRugs(next.rugs ?? officeRugs, next.selected ?? null);
    labels.hidden = Boolean(next.active) || deskMarkers.size > 0;
    changed = true;
  }

  function resolveHour() {
    if (Number.isFinite(lightHour)) return lightHour;
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      ...(lightZone ? {timeZone: lightZone} : {}),
    }).formatToParts(new Date());
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 12);
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    return h + m / 60;
  }

  function applyLighting(force = false) {
    const hour = resolveHour();
    const minuteBucket = Math.floor(hour * 60);
    if (!force && minuteBucket === lastLightMinute) return;
    lastLightMinute = minuteBucket;
    const state = lights.apply(hour, east);
    renderer.toneMappingExposure = state.exposure;
    const stage = surface.closest('.office-map-stage, .symbio-layout-stage-3d, .symbio-workstation-preview');
    if (stage) {
      stage.dataset.dayPhase = state.phase;
      stage.style.setProperty('--scene-glow', state.glow);
      stage.style.setProperty('--scene-paper', state.paper);
      stage.style.setProperty('--scene-edge', state.edge);
    }
    const badge = document.getElementById('office-lighting-label');
    if (badge) {
      badge.textContent = `${state.icon} ${state.name}${Number.isFinite(lightHour) ? '（预览）' : ' · 实时光影'}`;
    }
    changed = true;
  }

  function update(actors, percentage, selectedKey, count = baseWorkstations, lighting = {}, items = officeItems, walls = officeWalls, rugs = officeRugs, mode = officeMode, floors = officeFloors) {
    lightHour = Number.isFinite(lighting.hour) ? lighting.hour : null;
    lightZone = lighting.timeZone || undefined;
    const nextMode = mode === 'custom' ? 'custom' : 'default';
    if (count !== workstationCount || nextMode !== officeMode) {
      rebuildBaseArchitecture(count, nextMode);
    }
    const sel = designState.active ? designState.selected : null;
    syncCustomFloors(floors, sel);
    syncCustomItems(items, sel);
    syncCustomWalls(walls, sel);
    syncCustomRugs(rugs, sel);
    applyLighting(true);
    const positions = placeOfficeActors(actors, count, officeItems, officeMode, officeFloors);
    reservedLounge = [...positions.values()].filter(position => position.area === 'lounge');
    const customBreaks = officeMode === 'custom'
      ? customSpecialSeats(officeItems).loungeSeats.map(seat => ({...seat, area: 'stroll'}))
      : null;
    const visible = actors.filter(actor => positions.has(actor.key));
    const keep = new Set(visible.map(actor => actor.key));
    for (const [key, record] of records) if (!keep.has(key)) remove(key,record);
    selected = selectedKey;
    showNames = visible.length < 10;
    idleAtDesk.clear();
    for (const actor of visible) {
      const home = positions.get(actor.key);
      if (home.area === 'desk' && actor.state === 'idle') idleAtDesk.add(actor.key);
    }
    visits = stroll(noMotion() ? none : idleAtDesk, performance.now(), reservedLounge, customBreaks);
    for (const actor of visible) {
      const home = positions.get(actor.key);
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
      camera.zoom = clamp(camera.zoom * (percentage/100) / zoom, controls.minZoom, controls.maxZoom);
      zoom = percentage/100;
      camera.updateProjectionMatrix();
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
      marker.button.textContent = zone.label ?? zone.name;
      marker.button.setAttribute('aria-pressed',String(zone.selected));
      marker.button.dataset.visible = String(zone.visible);
      marker.button.title = zone.title ?? (zone.visible ? zone.name : zone.name + ' · 已隐藏');
    }
    changed = true;
  }

  function updateDesks(items = []) {
    const keep = new Set(items.map(item => item.id));
    for (const [id, marker] of deskMarkers) {
      if (keep.has(id)) continue;
      marker.node.remove();
      deskMarkers.delete(id);
    }
    for (const item of items) {
      let marker = deskMarkers.get(item.id);
      if (!marker) {
        const node = document.createElement(item.actorKey ? 'button' : 'span');
        if (item.actorKey) {
          node.type = 'button';
          node.dataset.action = 'office-person';
        }
        node.className = 'office-desk-pin';
        deskLabels.append(node);
        marker = {node, point: new T.Vector3(), isButton: Boolean(item.actorKey)};
        deskMarkers.set(item.id, marker);
      } else if (marker.isButton !== Boolean(item.actorKey)) {
        marker.node.remove();
        const node = document.createElement(item.actorKey ? 'button' : 'span');
        if (item.actorKey) {
          node.type = 'button';
          node.dataset.action = 'office-person';
        }
        node.className = 'office-desk-pin';
        deskLabels.append(node);
        marker = {node, point: new T.Vector3(), isButton: Boolean(item.actorKey)};
        deskMarkers.set(item.id, marker);
      }
      marker.point.set(item.x, 1.04, item.z);
      marker.node.innerHTML = '';
      const code = document.createElement('strong');
      code.textContent = item.code;
      marker.node.append(code);
      if (item.occupant) {
        const who = document.createElement('span');
        who.textContent = item.occupant;
        marker.node.append(who);
      }
      marker.node.dataset.occupied = String(Boolean(item.actorKey));
      if (item.actorKey) {
        marker.node.dataset.id = item.actorKey;
        marker.node.setAttribute('aria-pressed', String(item.selected));
      }
      marker.node.title = item.title ?? item.code;
    }
    labels.hidden = deskMarkers.size > 0;
    changed = true;
  }

  function raycastFloorRaw(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) * 2 / rect.width - 1, 1 - (event.clientY - rect.top) * 2 / rect.height);
    ray.setFromCamera(pointer, camera);
    return ray.ray.intersectPlane(floorPlane, floorHit) ? {x: floorHit.x, z: floorHit.z} : null;
  }

  function raycastFloor(event) {
    const raw = raycastFloorRaw(event);
    return raw ? {x: snapGrid(raw.x), z: snapGrid(raw.z)} : null;
  }

  function resolveDrawPoint(event, tool, anchor = null) {
    const raw = raycastFloorRaw(event);
    if (!raw) return null;
    return snapDrawPoint(raw, officeWalls, officeFloors, {
      anchor,
      tool,
      mode: officeMode,
      wingCount: workstationCount ?? baseWorkstations,
      disableSnap: Boolean(event.altKey),
    });
  }

  function hitDesignTarget(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) * 2 / rect.width - 1, 1 - (event.clientY - rect.top) * 2 / rect.height);
    ray.setFromCamera(pointer, camera);
    const itemTargets = [...customMeshes.values()].map(entry => entry.group);
    const itemHit = ray.intersectObjects(itemTargets, true)[0];
    if (itemHit) {
      let node = itemHit.object;
      while (node && !node.userData?.officeItemId) node = node.parent;
      if (node?.userData?.officeItemId) return {kind: 'item', id: node.userData.officeItemId};
    }
    if (customWallsGroup) {
      const wallHit = ray.intersectObjects([customWallsGroup], true)[0];
      if (wallHit) {
        let node = wallHit.object;
        while (node && !node.userData?.officeWallId) node = node.parent;
        if (node?.userData?.officeWallId) return {kind: 'wall', id: node.userData.officeWallId, point: wallHit.point};
      }
    }
    if (customRugsGroup) {
      const rugHit = ray.intersectObjects([customRugsGroup], true)[0];
      if (rugHit) {
        let node = rugHit.object;
        while (node && !node.userData?.officeRugId) node = node.parent;
        if (node?.userData?.officeRugId) return {kind: 'rug', id: node.userData.officeRugId};
      }
    }
    if (customFloorsGroup) {
      const floorHit = ray.intersectObjects([customFloorsGroup], true)[0];
      if (floorHit) {
        let node = floorHit.object;
        while (node && !node.userData?.officeFloorId) node = node.parent;
        if (node?.userData?.officeFloorId) return {kind: 'floor', id: node.userData.officeFloorId};
      }
    }
    return null;
  }

  function nearestWallForDoor(event) {
    const target = hitDesignTarget(event);
    const pt = target?.kind === 'wall' && target.point ? target.point : raycastFloor(event);
    if (!pt || !officeWalls.length) return null;
    let chosen = target?.kind === 'wall' ? officeWalls.find(w => w.id === target.id) : null;
    if (!chosen) {
      let bestDist = 0.75;
      for (const wall of officeWalls) {
        const alongX = wallAxis(wall) === 'x';
        const dist = alongX
          ? (pt.x >= wall.x1 - 0.3 && pt.x <= wall.x2 + 0.3 ? Math.abs(pt.z - wall.z1) : Infinity)
          : (pt.z >= wall.z1 - 0.3 && pt.z <= wall.z2 + 0.3 ? Math.abs(pt.x - wall.x1) : Infinity);
        if (dist < bestDist) { bestDist = dist; chosen = wall; }
      }
    }
    if (!chosen) return null;
    const alongX = wallAxis(chosen) === 'x';
    const rawOffset = alongX ? pt.x - chosen.x1 : pt.z - chosen.z1;
    const offset = snapGrid(rawOffset);
    return {wall: chosen, offset};
  }

  let press, dragged = false;
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (designState.active) {
      const tool = designState.tool;
      if (tool === 'select') {
        const hit = hitDesignTarget(event);
        if (hit?.kind === 'item') {
          const item = officeItems.find(entry => entry.id === hit.id);
          if (item) {
            dragItem = {id: item.id, type: item.type, rotation: item.rotation, origX: item.x, origZ: item.z, x: item.x, z: item.z, valid: true, moved: false};
            controls.enabled = false;
            designState.onSelect?.({kind: 'item', id: item.id});
            event.stopPropagation();
            return;
          }
        }
      } else if (tool === 'wall' || tool === 'rug' || tool === 'floor') {
        const pt = resolveDrawPoint(event, tool, drawAnchor);
        if (pt) {
          if (!drawAnchor) {
            drawAnchor = {x: pt.x, z: pt.z};
            dragMovedDraw = false;
            controls.enabled = false;
          }
          event.stopPropagation();
          return;
        }
      }
    }
    dragged = Boolean(press);
    press = {x:event.clientX, y:event.clientY};
  });

  renderer.domElement.addEventListener('pointermove', event => {
    if (designState.active && dragItem) {
      const pt = raycastFloor(event);
      if (!pt) return;
      if (pt.x !== dragItem.x || pt.z !== dragItem.z) {
        dragItem.x = pt.x;
        dragItem.z = pt.z;
        dragItem.moved = true;
        const check = validateItemPlacement(dragItem, officeItems, workstationCount ?? baseWorkstations, dragItem.id, officeWalls, officeMode, officeFloors);
        dragItem.valid = check.ok;
        showGhost(dragItem, check.ok, check.reason);
      }
      return;
    }
    if (designState.active) {
      const tool = designState.tool;
      if (tool === 'place' && designState.placingType) {
        const pt = raycastFloor(event);
        if (!pt) return;
        const candidate = {type: designState.placingType, x: pt.x, z: pt.z, rotation: designState.placingRotation ?? 0};
        const check = validateItemPlacement(candidate, officeItems, workstationCount ?? baseWorkstations, null, officeWalls, officeMode, officeFloors);
        showGhost(candidate, check.ok, check.reason);
        return;
      }
      if (tool === 'wall') {
        const pt = resolveDrawPoint(event, 'wall', drawAnchor);
        if (!pt) return;
        showSnapIndicator(pt);
        const snapTag = pt.label ? `${pt.label} · ` : '';
        if (!drawAnchor) {
          showWallGhost({x1: pt.x, z1: pt.z, x2: pt.x, z2: pt.z}, true, `${snapTag}点击并拖拽绘制墙面（靠近墙角自动吸附）`);
        } else {
          if (Math.hypot(pt.x - drawAnchor.x, pt.z - drawAnchor.z) >= 0.5) dragMovedDraw = true;
          const draft = normalizeWall({x1: drawAnchor.x, z1: drawAnchor.z, x2: pt.x, z2: pt.z, color: designState.wallColor});
          const len = wallLength(draft);
          const check = validateWallPlacement(draft, officeWalls, officeItems, workstationCount ?? baseWorkstations, null, officeMode);
          showWallGhost(draft, check.ok, check.ok ? `${snapTag}墙长 ${len.toFixed(1)}m · 松开或点击完成` : check.reason);
        }
        return;
      }
      if (tool === 'floor') {
        const pt = resolveDrawPoint(event, 'floor', drawAnchor);
        if (!pt) return;
        showSnapIndicator(pt);
        const snapTag = pt.label ? `${pt.label} · ` : '';
        if (!drawAnchor) {
          showFloorGhost({x1: pt.x - 0.5, z1: pt.z - 0.5, x2: pt.x + 0.5, z2: pt.z + 0.5}, true, `${snapTag}点击并拖拽铺设地板区块`);
        } else {
          if (Math.hypot(pt.x - drawAnchor.x, pt.z - drawAnchor.z) >= 0.5) dragMovedDraw = true;
          const draft = normalizeFloor({x1: drawAnchor.x, z1: drawAnchor.z, x2: pt.x, z2: pt.z, material: designState.floorMaterial});
          const check = validateFloorPlacement(draft);
          const w = (draft.x2 - draft.x1).toFixed(1), d = (draft.z2 - draft.z1).toFixed(1);
          showFloorGhost(draft, check.ok, check.ok ? `${snapTag}地板 ${w}×${d}m · 松开或点击完成` : check.reason);
        }
        return;
      }
      if (tool === 'door') {
        const match = nearestWallForDoor(event);
        if (!match) { clearGhost(); setHint('将光标移至自定义墙体上点击开门洞', true); return; }
        const check = validateDoorPlacement(match.wall, match.offset);
        showDoorGhost(match.wall, match.offset, check.ok, check.ok ? '点击此处开 1.4m 门洞' : check.reason);
        return;
      }
      if (tool === 'rug') {
        const pt = resolveDrawPoint(event, 'rug', drawAnchor);
        if (!pt) return;
        showSnapIndicator(pt);
        const snapTag = pt.label ? `${pt.label} · ` : '';
        if (!drawAnchor) {
          showRugGhost({x1: pt.x - 0.5, z1: pt.z - 0.5, x2: pt.x + 0.5, z2: pt.z + 0.5}, true, `${snapTag}点击并拖拽铺设区域地毯`);
        } else {
          if (Math.hypot(pt.x - drawAnchor.x, pt.z - drawAnchor.z) >= 0.5) dragMovedDraw = true;
          const draft = normalizeRug({x1: drawAnchor.x, z1: drawAnchor.z, x2: pt.x, z2: pt.z, color: designState.rugColor});
          const check = validateRugPlacement(draft, workstationCount ?? baseWorkstations, officeMode, officeFloors);
          const w = (draft.x2 - draft.x1).toFixed(1), d = (draft.z2 - draft.z1).toFixed(1);
          showRugGhost(draft, check.ok, check.ok ? `${snapTag}地毯 ${w}×${d}m · 松开或点击完成` : check.reason);
        }
        return;
      }
    }
    if (press && Math.hypot(event.clientX-press.x,event.clientY-press.y) > 5) dragged = true;
  });

  renderer.domElement.addEventListener('pointerleave', () => {
    if (designState.active && !dragItem && !drawAnchor) clearGhost();
  });

  const finishDrag = () => {
    if (!dragItem) return;
    const finished = dragItem;
    dragItem = null;
    controls.enabled = true;
    clearGhost();
    if (finished.moved && finished.valid && (finished.x !== finished.origX || finished.z !== finished.origZ)) {
      designState.onMove?.(finished.id, finished.x, finished.z);
    }
  };

  const commitDraw = pt => {
    if (!drawAnchor || !pt) return;
    const tool = designState.tool;
    if (tool === 'wall') {
      const draft = normalizeWall({x1: drawAnchor.x, z1: drawAnchor.z, x2: pt.x, z2: pt.z, color: designState.wallColor});
      const check = validateWallPlacement(draft, officeWalls, officeItems, workstationCount ?? baseWorkstations, null, officeMode);
      if (check.ok) designState.onAddWall?.(check.wall);
      else setHint(check.reason, false);
    } else if (tool === 'floor') {
      const draft = normalizeFloor({x1: drawAnchor.x, z1: drawAnchor.z, x2: pt.x, z2: pt.z, material: designState.floorMaterial});
      const check = validateFloorPlacement(draft);
      if (check.ok) designState.onAddFloor?.(check.floor);
      else setHint(check.reason, false);
    } else if (tool === 'rug') {
      const draft = normalizeRug({x1: drawAnchor.x, z1: drawAnchor.z, x2: pt.x, z2: pt.z, color: designState.rugColor});
      const check = validateRugPlacement(draft, workstationCount ?? baseWorkstations, officeMode, officeFloors);
      if (check.ok) designState.onAddRug?.(check.rug);
      else setHint(check.reason, false);
    }
    drawAnchor = null;
    dragMovedDraw = false;
    controls.enabled = true;
    clearGhost();
  };

  renderer.domElement.addEventListener('pointerup', event => {
    if (dragItem) { finishDrag(); return; }
    if (designState.active && drawAnchor && (designState.tool === 'wall' || designState.tool === 'rug' || designState.tool === 'floor')) {
      const pt = resolveDrawPoint(event, designState.tool, drawAnchor);
      if (dragMovedDraw && pt) {
        commitDraw(pt);
        dragged = true;
        setTimeout(() => { dragged = false; }, 0);
      } else {
        controls.enabled = true;
      }
      return;
    }
    press = undefined;
  });
  renderer.domElement.addEventListener('pointercancel', () => {
    if (dragItem) { finishDrag(); return; }
    if (drawAnchor) { drawAnchor = null; dragMovedDraw = false; controls.enabled = true; clearGhost(); return; }
    press = undefined;
    dragged = true;
  });
  renderer.domElement.addEventListener('click', event => {
    if (dragged) return;
    if (designState.active) {
      const tool = designState.tool;
      if (tool === 'place' && designState.placingType) {
        const pt = raycastFloor(event);
        if (!pt) return;
        const candidate = {type: designState.placingType, x: pt.x, z: pt.z, rotation: designState.placingRotation ?? 0};
        const check = validateItemPlacement(candidate, officeItems, workstationCount ?? baseWorkstations, null, officeWalls, officeMode, officeFloors);
        if (check.ok) designState.onPlace?.(candidate);
        else showGhost(candidate, false, check.reason);
        return;
      }
      if ((tool === 'wall' || tool === 'rug' || tool === 'floor') && drawAnchor) {
        const pt = resolveDrawPoint(event, tool, drawAnchor);
        if (pt && Math.hypot(pt.x - drawAnchor.x, pt.z - drawAnchor.z) >= 0.5) commitDraw(pt);
        return;
      }
      if (tool === 'door') {
        const match = nearestWallForDoor(event);
        if (!match) return;
        const check = validateDoorPlacement(match.wall, match.offset);
        if (check.ok) {
          designState.onAddDoor?.(match.wall.id, check.offset);
          clearGhost();
        } else {
          showDoorGhost(match.wall, match.offset, false, check.reason);
        }
        return;
      }
      if (tool === 'erase-wall') {
        const hit = hitDesignTarget(event);
        if (hit?.kind === 'wall') designState.onDeleteWall?.(hit.id);
        return;
      }
      if (tool === 'erase-floor') {
        const hit = hitDesignTarget(event);
        if (hit?.kind === 'floor') designState.onDeleteFloor?.(hit.id);
        return;
      }
      const hit = hitDesignTarget(event);
      designState.onSelect?.(hit ? {kind: hit.kind, id: hit.id} : null);
      return;
    }
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
    applyLighting(false);
    const reduced = noMotion();
    const customBreaks = officeMode === 'custom'
      ? customSpecialSeats(officeItems).loungeSeats.map(seat => ({...seat, area: 'stroll'}))
      : null;
    visits = stroll(reduced ? none : idleAtDesk, time, reservedLounge, customBreaks);
    for (const key of idleAtDesk) {
      const record = records.get(key);
      const destination = visits.get(key)?.position ?? record.home;
      if (destination !== record.destination) {
        moveTo(record,destination);
        changed = true;
      }
    }
    if (reduced && !changed) return;
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
      const important = Boolean(actor.fixedSeat) || (zoneMarkers.size === 0 && ['speaking','working','blocked','thinking'].includes(actor.state));
      const priority = actor.key === selected ? 2 : important ? 1 : 0;
      markers.push({button:label.button,x,y,priority,name:actor.name});
    }
    const named = [];
    for (const marker of markers.sort((a,b) => b.priority-a.priority)) {
      const halfWidth = Math.min(70, (marker.name.length * 10 + 20) / 2);
      const overlaps = named.some(other => Math.abs(marker.x-other.x) < halfWidth+other.halfWidth+4 &&
        Math.abs(marker.y-other.y) < 19);
      const show = !marker.button.hidden && (marker.priority > 0 || (zoneMarkers.size === 0 && deskMarkers.size === 0 && showNames && width > 480)) && !overlaps;
      marker.button.dataset.named = String(show);
      if (show) named.push({...marker,halfWidth});
    }
    for (const {point, button} of zoneMarkers.values()) {
      head.copy(point).project(camera);
      button.hidden = Math.abs(head.x) > .94 || Math.abs(head.y) > .94;
      button.style.translate = (head.x+1)*width/2 + 'px ' + (1-head.y)*height/2 + 'px';
    }
    for (const {point, node} of deskMarkers.values()) {
      head.copy(point).project(camera);
      node.hidden = Math.abs(head.x) > .95 || Math.abs(head.y) > .95;
      node.style.translate = (head.x+1)*width/2 + 'px ' + (1-head.y)*height/2 + 'px';
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
    updateDesks,
    setDesignMode,
    rotate(direction) {
      if (direction === 0) resetView();
      else {
        camera.position.sub(controls.target).applyAxisAngle(new T.Vector3(0,1,0),direction*.25).add(controls.target);
        controls.update();
      }
      changed = true;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      clearGhost();
      if (gridHelper) {
        scene.remove(gridHelper);
        gridHelper.geometry.dispose();
        gridHelper.material.dispose();
        gridHelper = null;
      }
      for (const entry of customMeshes.values()) {
        scene.remove(entry.group);
        disposeFurnitureGroup(entry.group);
      }
      customMeshes.clear();
      if (customFloorsGroup) {
        scene.remove(customFloorsGroup);
        disposeFurnitureGroup(customFloorsGroup);
        customFloorsGroup = null;
      }
      if (customWallsGroup) {
        scene.remove(customWallsGroup);
        disposeFurnitureGroup(customWallsGroup);
        customWallsGroup = null;
      }
      if (customRugsGroup) {
        scene.remove(customRugsGroup);
        disposeFurnitureGroup(customRugsGroup);
        customRugsGroup = null;
      }
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
