/**
 * Static 3D London miniature — land, river, parks, buildings, landmarks.
 *
 * Look: yU+co Silicon Valley titles (dense low-poly daylight diorama).
 * Geography: hand-authored polygons from geo.ts, not Mapbox.
 */

import * as THREE from 'three';
import { HUBS } from './content';
import {
  AREA_LABELS,
  DISTRICTS,
  LAND_NORTH,
  LAND_SOUTH,
  LANDMARKS,
  PARKS,
  THAMES,
  centerWorld,
  distToPolyline,
  isInPark,
  isOnLand,
  project,
  type LandmarkKind,
  type LngLat,
  type WorldPoint,
} from './geo';
import type { HubId } from './types';

export const LAND_Y = 0.32;

const THAMES_WORLD: WorldPoint[] = THAMES.map(project);

const PALETTE = {
  glass: [0xe8eef1, 0xdce6eb, 0xf3f6f8, 0xd0dbe2],
  stone: [0xf7f1e6, 0xefe6d6, 0xfbf6ee, 0xe4dccb],
  brick: [0xe2b6a0, 0xd4a48c, 0xebc4b0, 0xc9927a],
  fill: [0xf3ece0, 0xeae3d6, 0xf8f2e8, 0xe0d8ca],
  roof: [0xd9d0c4, 0xcfc4b6, 0xe2d8cc, 0xc4bbb0],
} as const;

const CLAY = { roughness: 0.9, metalness: 0.02 } as const;
const CANDY = [0xe11d48, 0x0d9488, 0xf59e0b, 0x2563eb, 0xf8fafc, 0x111827, 0xda291c] as const;

function clayMat(color: number, extras: Record<string, number> = {}) {
  return new THREE.MeshStandardMaterial({ color, ...CLAY, ...extras, flatShading: true });
}

function offsetWorld(line: readonly WorldPoint[], dist: number): WorldPoint[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / len) * dist, y: p.y + (dx / len) * dist };
  });
}

function lerpWorld(a: WorldPoint, b: WorldPoint, steps: number): WorldPoint[] {
  const out: WorldPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function sampleRibbon(line: readonly WorldPoint[], spacing: number) {
  const pts: { x: number; z: number; rot: number }[] = [];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = centerWorld(line[i - 1]);
    const b = centerWorld(line[i]);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const rot = Math.atan2(dx, dz);
    let d = spacing - (acc % spacing);
    while (d < len) {
      const t = d / len;
      pts.push({ x: a.x + dx * t, z: a.z + dz * t, rot });
      d += spacing;
    }
    acc += len;
  }
  return pts;
}

function addRoad(
  group: THREE.Group,
  line: readonly WorldPoint[],
  halfW: number,
  asphalt: THREE.Material,
  paint: THREE.Material,
) {
  if (line.length < 2) return;
  const road = new THREE.Mesh(ribbonGeometry(line, halfW, LAND_Y + 0.02), asphalt);
  road.receiveShadow = true;
  const lane = new THREE.Mesh(ribbonGeometry(line, 0.035, LAND_Y + 0.035), paint);
  group.add(road, lane);
}

function addLollipop(
  group: THREE.Group,
  at: THREE.Vector3,
  rnd: () => number,
  trunkMat: THREE.Material,
  leafMat: THREE.Material,
) {
  const h = 0.34 + rnd() * 0.18;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, h, 5), trunkMat);
  trunk.position.set(at.x, LAND_Y + h / 2, at.z);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2 + rnd() * 0.1, 8, 6), leafMat);
  leaf.position.set(at.x, LAND_Y + h + 0.16, at.z);
  leaf.castShadow = true;
  group.add(trunk, leaf);
}

function addCrane(group: THREE.Group, at: THREE.Vector3, yaw: number, mat: THREE.Material) {
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3.6, 0.09), mat);
  mast.position.set(at.x, LAND_Y + 1.8, at.z);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 0.08), mat);
  arm.position.set(at.x + Math.cos(yaw) * 1.1, LAND_Y + 3.5, at.z + Math.sin(yaw) * 1.1);
  arm.rotation.y = yaw;
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), mat);
  hook.position.set(at.x + Math.cos(yaw) * 2.1, LAND_Y + 3.1, at.z + Math.sin(yaw) * 2.1);
  mast.castShadow = arm.castShadow = true;
  group.add(mast, arm, hook);
}

function addTotem(
  group: THREE.Group,
  at: THREE.Vector3,
  color: number,
  label: string,
  h = 1.15,
) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, h, 0.72), clayMat(color));
  body.position.set(at.x, LAND_Y + h / 2 + 0.04, at.z);
  body.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 0.82), clayMat(0xf4eee4));
  cap.position.set(at.x, LAND_Y + h + 0.08, at.z);
  group.add(body, cap);
  addChip(group, label, at, h + 0.7);
}

function addPerson(group: THREE.Group, at: THREE.Vector3, color: number) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.06), clayMat(color));
  body.position.copy(at);
  body.position.y = LAND_Y + 0.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), clayMat(0xf1d4b8));
  head.position.set(at.x, LAND_Y + 0.22, at.z);
  group.add(body, head);
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

export function worldTo3(p: WorldPoint, y = 0): THREE.Vector3 {
  const c = centerWorld(p);
  return new THREE.Vector3(c.x, y, c.z);
}

export function hubPosition(hubId: HubId, y = LAND_Y): THREE.Vector3 {
  const hub = HUBS.find((h) => h.id === hubId)!;
  return worldTo3(project([hub.lng, hub.lat]), y);
}

function shapeFromRing(ring: readonly LngLat[]): THREE.Shape {
  const shape = new THREE.Shape();
  ring.forEach((ll, i) => {
    const { x, z } = centerWorld(project(ll));
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  return shape;
}

function extrudeRing(ring: readonly LngLat[], depth: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shapeFromRing(ring), {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function ribbonGeometry(
  line: readonly WorldPoint[],
  halfW: number,
  y: number,
): THREE.BufferGeometry {
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[i === 0 ? 0 : i - 1];
    const b = line[i === line.length - 1 ? i : i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * halfW;
    const ny = (dx / len) * halfW;
    const c = centerWorld(line[i]);
    left.push(new THREE.Vector3(c.x + nx, y, c.z + ny));
    right.push(new THREE.Vector3(c.x - nx, y, c.z - ny));
  }
  const n = left.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) positions.push(left[i].x, left[i].y, left[i].z);
  for (let i = 0; i < n; i++) positions.push(right[i].x, right[i].y, right[i].z);
  for (let i = 0; i < n - 1; i++) {
    indices.push(i, i + n, i + 1, i + 1, i + n, i + n + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#c5def0');
  g.addColorStop(0.42, '#e4f0f7');
  g.addColorStop(0.78, '#f5f0e6');
  g.addColorStop(1, '#efe6d6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addChip(group: THREE.Group, text: string, at: THREE.Vector3, y = 2.2) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 48);
  ctx.font = '700 20px ui-sans-serif, system-ui';
  const w = Math.min(236, ctx.measureText(text).width + 28);
  ctx.fillStyle = 'rgba(22,24,28,0.88)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 32, 10);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 30);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.position.set(at.x, LAND_Y + y, at.z);
  sprite.scale.set(5.2, 1, 1);
  group.add(sprite);
}

function addLandmark(group: THREE.Group, kind: LandmarkKind, at: THREE.Vector3, name: string) {
  const stone = new THREE.MeshStandardMaterial({ color: 0xf0eadc, roughness: 0.62 });
  const brick = new THREE.MeshStandardMaterial({ color: 0xc4a090, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5c6570, roughness: 0.4, metalness: 0.18 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xc5d4de,
    roughness: 0.18,
    metalness: 0.12,
  });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe8c872, roughness: 0.45, metalness: 0.3 });

  if (kind === 'shard') {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.62, 11.4, 4), glass);
    mesh.position.set(at.x, LAND_Y + 5.7, at.z);
    mesh.rotation.y = 0.38;
    mesh.castShadow = true;
    group.add(mesh);
    addChip(group, name, at, 12.2);
    return;
  }
  if (kind === 'bigben') {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.62, 5.4, 0.62), stone);
    tower.position.set(at.x, LAND_Y + 2.7, at.z);
    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), gold);
    clock.position.set(at.x, LAND_Y + 3.9, at.z + 0.32);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 4), dark);
    cap.position.set(at.x, LAND_Y + 5.85, at.z);
    tower.castShadow = cap.castShadow = true;
    group.add(tower, clock, cap);
    addChip(group, name, at, 7.1);
    return;
  }
  if (kind === 'eye') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.07, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0xe8eef3, metalness: 0.45, roughness: 0.3 }),
    );
    ring.position.set(at.x, LAND_Y + 1.7, at.z);
    ring.rotation.y = 0.55;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.08), dark);
    leg.position.set(at.x, LAND_Y + 0.85, at.z);
    group.add(ring, leg);
    addChip(group, name, at, 3.6);
    return;
  }
  if (kind === 'bttower') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 5.4, 8), dark);
    stem.position.set(at.x, LAND_Y + 2.7, at.z);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.12, 12), dark);
    dish.position.set(at.x, LAND_Y + 4.3, at.z);
    stem.castShadow = true;
    group.add(stem, dish);
    addChip(group, name, at, 5.8);
    return;
  }
  if (kind === 'stpauls') {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 1.1, 16), stone);
    drum.position.set(at.x, LAND_Y + 1.2, at.z);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      stone,
    );
    dome.position.set(at.x, LAND_Y + 1.75, at.z);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.45, 8), stone);
    lantern.position.set(at.x, LAND_Y + 2.85, at.z);
    drum.castShadow = dome.castShadow = true;
    group.add(drum, dome, lantern);
    addChip(group, name, at, 3.6);
    return;
  }
  if (kind === 'towerbridge') {
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.6, 0.42), stone);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.6, 0.42), stone);
    t1.position.set(at.x - 0.85, LAND_Y + 1.3, at.z);
    t2.position.set(at.x + 0.85, LAND_Y + 1.3, at.z);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.18), dark);
    walk.position.set(at.x, LAND_Y + 2.35, at.z);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.42), dark);
    deck.position.set(at.x, LAND_Y + 0.55, at.z);
    t1.castShadow = t2.castShadow = true;
    group.add(t1, t2, walk, deck);
    addChip(group, name, at, 3.3);
    return;
  }
  if (kind === 'powerstation') {
    const hall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.15, 1.15), brick);
    hall.position.set(at.x, LAND_Y + 0.58, at.z);
    hall.castShadow = true;
    group.add(hall);
    for (const dx of [-0.7, -0.25, 0.25, 0.7]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.7, 8), stone);
      stack.position.set(at.x + dx, LAND_Y + 1.55, at.z);
      group.add(stack);
    }
    addChip(group, name, at, 3.1);
    return;
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    dark,
  );
  dome.position.set(at.x, LAND_Y, at.z);
  group.add(dome);
  addChip(group, name, at, 2.4);
}

export interface LondonBoard {
  group: THREE.Group;
  sky: THREE.Texture;
  update: (t: number) => void;
  dispose: () => void;
}

export function buildLondonBoard(reduced: boolean): LondonBoard {
  const group = new THREE.Group();
  const rnd = seeded(20260824);

  const landMat = clayMat(0xf0eadc);
  const groundMat = clayMat(0xe7dfcf);
  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x4aa3cc,
    roughness: 0.22,
    metalness: 0.04,
  });
  const parkMat = clayMat(0x4f9a46);
  const leafMat = clayMat(0x3f8f3a);
  const trunkMat = clayMat(0x7a5533);
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x3b3f45,
    roughness: 0.92,
    metalness: 0,
  });
  const paintMat = new THREE.MeshStandardMaterial({
    color: 0xf5f1e8,
    roughness: 0.55,
    metalness: 0,
  });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 280), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  group.add(ground);

  group.add(extrudeRing(LAND_NORTH, LAND_Y, landMat), extrudeRing(LAND_SOUTH, LAND_Y, landMat));
  const river = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 2.45, 0.05), riverMat);
  river.receiveShadow = true;
  group.add(river);

  for (const park of PARKS) {
    const mesh = extrudeRing(park.points, 0.08, parkMat);
    mesh.position.y = LAND_Y - 0.02;
    group.add(mesh);
    const trees = reduced ? 8 : 22;
    for (let i = 0; i < trees; i++) {
      const ll = park.points[Math.floor(rnd() * park.points.length)];
      const jitter: LngLat = [ll[0] + (rnd() - 0.5) * 0.004, ll[1] + (rnd() - 0.5) * 0.003];
      if (!isInPark(jitter[0], jitter[1])) continue;
      addLollipop(group, worldTo3(project(jitter), LAND_Y), rnd, trunkMat, leafMat);
    }
  }

  type Sample = {
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    rot: number;
    color: number;
    roof: number;
  };
  const samples: Sample[] = [];
  const occupied: { x: number; z: number; r: number }[] = [];
  const countScale = reduced ? 0.42 : 1;

  for (const district of DISTRICTS) {
    const n = Math.round(district.count * countScale);
    const pal = PALETTE[district.tone];
    let placed = 0;
    let guard = 0;
    while (placed < n && guard < n * 18) {
      guard += 1;
      const [lng0, lng1, lat0, lat1] = district.bbox;
      const lng = lng0 + rnd() * (lng1 - lng0);
      const lat = lat0 + rnd() * (lat1 - lat0);
      if (!isOnLand(lng, lat) || isInPark(lng, lat)) continue;
      const wp = project([lng, lat]);
      if (distToPolyline(wp, THAMES_WORLD) < 2.05) continue;
      const raw = centerWorld(wp);
      const cell = district.tone === 'fill' ? 0.85 : 0.55;
      const x = Math.round(raw.x / cell) * cell;
      const z = Math.round(raw.z / cell) * cell;
      const w = 0.38 + rnd() * (district.tone === 'fill' ? 0.55 : 0.85);
      const d = 0.28 + rnd() * (district.tone === 'fill' ? 0.4 : 0.55);
      const rad = Math.max(w, d) * 0.72;
      if (occupied.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + rad) ** 2 * 0.62)) continue;
      const tall = rnd() < district.tall;
      const h0 = district.h[0];
      const span = district.h[1] - district.h[0];
      const h = tall ? h0 + (0.55 + rnd() * 0.45) * span : h0 + Math.pow(rnd(), 1.6) * span * 0.7;
      occupied.push({ x, z, r: rad });
      samples.push({
        x,
        z,
        w,
        d,
        h,
        rot: 0,
        color: pal[Math.floor(rnd() * pal.length)],
        roof: PALETTE.roof[Math.floor(rnd() * PALETTE.roof.length)],
      });
      placed += 1;
    }
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildings = new THREE.InstancedMesh(
    boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.02, flatShading: true }),
    Math.max(1, samples.length),
  );
  buildings.castShadow = !reduced;
  buildings.receiveShadow = true;
  const roofs = new THREE.InstancedMesh(
    boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02, flatShading: true }),
    Math.max(1, samples.length),
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  samples.forEach((s, i) => {
    dummy.position.set(s.x, LAND_Y + s.h / 2, s.z);
    dummy.rotation.set(0, s.rot, 0);
    dummy.scale.set(s.w, s.h, s.d);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);
    buildings.setColorAt(i, color.setHex(s.color));
    dummy.position.y = LAND_Y + s.h + 0.04;
    dummy.scale.set(s.w * 0.92, 0.08, s.d * 0.92);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    roofs.setColorAt(i, color.setHex(s.roof));
  });
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
  if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  group.add(buildings, roofs);

  const solarSamples = samples.filter((s) => s.h > 1.8 && rnd() < (reduced ? 0.08 : 0.16));
  if (solarSamples.length) {
    const solar = new THREE.InstancedMesh(
      boxGeo,
      clayMat(0x1d3b5c, { roughness: 0.35, metalness: 0.18 }),
      solarSamples.length,
    );
    solarSamples.forEach((s, i) => {
      dummy.position.set(s.x, LAND_Y + s.h + 0.09, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.w * 0.72, 0.03, s.d * 0.72);
      dummy.updateMatrix();
      solar.setMatrixAt(i, dummy.matrix);
    });
    group.add(solar);
  }

  const northBank = offsetWorld(THAMES_WORLD, 3.4);
  const southBank = offsetWorld(THAMES_WORLD, -3.4);
  const hubLinks: [HubId, HubId][] = [
    ['camden', 'kingscross'],
    ['kingscross', 'soho'],
    ['soho', 'farringdon'],
    ['farringdon', 'shoreditch'],
    ['shoreditch', 'londonbridge'],
    ['londonbridge', 'canarywharf'],
    ['soho', 'battersea'],
    ['kingscross', 'farringdon'],
  ];
  const roads: WorldPoint[][] = [northBank, southBank];
  for (const [aId, bId] of hubLinks) {
    const a = HUBS.find((h) => h.id === aId)!;
    const b = HUBS.find((h) => h.id === bId)!;
    roads.push(lerpWorld(project([a.lng, a.lat]), project([b.lng, b.lat]), 8));
  }
  for (const road of roads) addRoad(group, road, 0.62, asphaltMat, paintMat);

  const carPts = roads.flatMap((road) => sampleRibbon(road, reduced ? 7.5 : 4.2));
  const carGeo = new THREE.BoxGeometry(0.42, 0.16, 0.22);
  const cars = new THREE.InstancedMesh(carGeo, clayMat(0xe11d48), Math.max(1, carPts.length));
  cars.castShadow = !reduced;
  carPts.forEach((pt, i) => {
    dummy.position.set(pt.x, LAND_Y + 0.14, pt.z);
    dummy.rotation.set(0, pt.rot, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    cars.setMatrixAt(i, dummy.matrix);
    cars.setColorAt(i, color.setHex(CANDY[i % CANDY.length]));
  });
  if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
  group.add(cars);

  for (const lm of LANDMARKS) {
    addLandmark(group, lm.kind, worldTo3(project(lm.at), LAND_Y), lm.name);
  }

  const craneMat = clayMat(0xf5c518, { roughness: 0.45 });
  for (const [lng, lat, yaw] of [
    [-0.02, 51.504, 0.2],
    [-0.016, 51.506, 0.9],
    [-0.026, 51.503, -0.4],
    [-0.148, 51.483, 0.6],
    [-0.08, 51.525, 1.1],
  ] as const) {
    addCrane(group, worldTo3(project([lng, lat]), LAND_Y), yaw, craneMat);
  }

  const gags: { id: HubId; color: number; label: string }[] = [
    { id: 'shoreditch', color: 0xff4e50, label: 'MONZO' },
    { id: 'kingscross', color: 0x5b8def, label: 'DEEPMIND' },
    { id: 'soho', color: 0xe11d74, label: 'MEDIA' },
    { id: 'farringdon', color: 0x1f6b4a, label: 'WISE' },
    { id: 'canarywharf', color: 0x2a63f6, label: 'REVOLUT' },
    { id: 'londonbridge', color: 0xd94a38, label: 'MARKET' },
    { id: 'camden', color: 0x6d4aa8, label: 'LOCK' },
    { id: 'battersea', color: 0x7cb342, label: 'CAMPUS' },
  ];
  for (const gag of gags) {
    const hub = HUBS.find((h) => h.id === gag.id)!;
    const at = worldTo3(project([hub.lng + 0.0018, hub.lat - 0.0012]), LAND_Y);
    addTotem(group, at, gag.color, gag.label, gag.id === 'canarywharf' ? 1.7 : 1.12);
    for (let i = 0; i < (reduced ? 2 : 5); i++) {
      addLollipop(
        group,
        worldTo3(
          project([hub.lng + (rnd() - 0.5) * 0.008, hub.lat + (rnd() - 0.5) * 0.006]),
          LAND_Y,
        ),
        rnd,
        trunkMat,
        leafMat,
      );
    }
    for (let i = 0; i < (reduced ? 3 : 7); i++) {
      addPerson(
        group,
        worldTo3(
          project([hub.lng + (rnd() - 0.5) * 0.005, hub.lat + (rnd() - 0.5) * 0.004]),
          LAND_Y,
        ),
        CANDY[Math.floor(rnd() * 5)],
      );
    }
  }

  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.32, 0.3), clayMat(0xda291c));
  const busOrigin = worldTo3(project([-0.11, 51.503]), LAND_Y + 0.22);
  bus.position.copy(busOrigin);
  bus.castShadow = true;
  group.add(bus);

  const sheds: THREE.Mesh[] = [];
  for (let i = 0; i < (reduced ? 4 : 8); i++) {
    const hub = HUBS[i % HUBS.length];
    const p = worldTo3(
      project([hub.lng + (rnd() - 0.5) * 0.006, hub.lat + (rnd() - 0.5) * 0.004]),
      LAND_Y,
    );
    const shed = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.35, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xf2d36b, roughness: 0.55 }),
    );
    shed.position.set(p.x, LAND_Y + 0.18, p.z);
    shed.userData.phase = rnd() * Math.PI * 2;
    sheds.push(shed);
    group.add(shed);
  }

  for (const label of AREA_LABELS) {
    addChip(group, label.text, worldTo3(project(label.at), LAND_Y), 1.55);
  }

  const sky = makeSkyTexture();

  return {
    group,
    sky,
    update: (t: number) => {
      bus.position.x = busOrigin.x + Math.sin(t * 0.00025) * 6;
      bus.position.z = busOrigin.z + Math.cos(t * 0.00025) * 1.5;
      for (const shed of sheds) {
        const pulse = 0.85 + 0.2 * Math.sin(t * 0.002 + shed.userData.phase);
        shed.scale.set(1, pulse, 1);
        shed.position.y = LAND_Y + 0.18 * pulse;
      }
    },
    dispose: () => {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      sky.dispose();
    },
  };
}
