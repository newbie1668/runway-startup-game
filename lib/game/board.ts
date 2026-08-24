/**
 * Static 3D London miniature — land, river, parks, buildings, landmarks.
 *
 * Look: yU+co Silicon Valley titles (dense low-poly daylight diorama).
 * Geography: hand-authored polygons from geo.ts, not Mapbox.
 */

import * as THREE from 'three';
import { HUBS } from './content';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  AREA_LABELS,
  CITY_BLOCKS,
  type CityBlock,
  LANDMARKS,
  PARKS,
  THAMES,
  centerWorld,
  distToSegment,
  isInPark,
  project,
  type Landmark,
  type LandmarkKind,
  type LngLat,
  type WorldPoint,
} from './geo';
import type { HubId } from './types';

export const LAND_Y = 0.32;

const THAMES_WORLD: WorldPoint[] = THAMES.map(project);

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

function addTotem(group: THREE.Group, at: THREE.Vector3, color: number, label: string, h = 1.15) {
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
  g.addColorStop(0, '#efe4d2');
  g.addColorStop(0.45, '#f3eadc');
  g.addColorStop(0.78, '#f6efe4');
  g.addColorStop(1, '#f0eadc');
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

function riverFrame(at: LngLat): { along: THREE.Vector3; across: THREE.Vector3 } {
  const p = project(at);
  let bestI = 1;
  let bestD = Infinity;
  for (let i = 1; i < THAMES_WORLD.length; i++) {
    const d = distToSegment(p, THAMES_WORLD[i - 1], THAMES_WORLD[i]);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const a = centerWorld(THAMES_WORLD[bestI - 1]);
  const b = centerWorld(THAMES_WORLD[bestI]);
  const along = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  const across = new THREE.Vector3(-along.z, 0, along.x);
  return { along, across };
}

function addPart(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  cast = true,
) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addLandmark(group: THREE.Group, lm: Landmark, at: THREE.Vector3) {
  const stone = clayMat(0xf2ebdc, { roughness: 0.68 });
  const cream = clayMat(0xf7f1e4, { roughness: 0.7 });
  const brick = clayMat(0xc4a090, { roughness: 0.74 });
  const dark = clayMat(0x5a616c, { roughness: 0.55, metalness: 0.12 });
  const glass = clayMat(0xb7c9d4, { roughness: 0.42, metalness: 0.08 });
  const gold = clayMat(0xe8c872, { roughness: 0.5, metalness: 0.22 });
  const white = clayMat(0xeef2f5, { roughness: 0.48, metalness: 0.1 });
  const { along, across } = riverFrame(lm.at);
  const kind: LandmarkKind = lm.kind;
  const y0 = LAND_Y;

  if (kind === 'shard') {
    const podium = addPart(
      group,
      new THREE.BoxGeometry(1.7, 0.7, 1.5),
      cream,
      at.x,
      y0 + 0.35,
      at.z,
    );
    podium.rotation.y = 0.38;
    const shaft = addPart(
      group,
      new THREE.ConeGeometry(1.15, 18.4, 4),
      glass,
      at.x,
      y0 + 0.7 + 9.2,
      at.z,
    );
    shaft.rotation.y = 0.38;
    const needle = addPart(
      group,
      new THREE.ConeGeometry(0.18, 2.6, 4),
      white,
      at.x,
      y0 + 19.4,
      at.z,
    );
    needle.rotation.y = 0.38;
    addChip(group, lm.name, at, 20.4);
    return;
  }

  if (kind === 'bigben') {
    const palace = addPart(
      group,
      new THREE.BoxGeometry(1.85, 1.55, 7.4),
      stone,
      at.x + 0.15,
      y0 + 0.78,
      at.z + 2.1,
    );
    palace.rotation.y = Math.atan2(along.x, along.z);
    for (let i = 0; i < 6; i++) {
      const t = (i - 2.5) * 1.05;
      const px = at.x + along.x * t + across.x * 0.55;
      const pz = at.z + along.z * t + across.z * 0.55;
      addPart(group, new THREE.ConeGeometry(0.16, 0.55, 4), stone, px, y0 + 1.85, pz);
    }
    addPart(group, new THREE.BoxGeometry(1.15, 11.2, 1.15), stone, at.x, y0 + 5.6, at.z);
    for (const dir of [
      [0, 0.6],
      [0, -0.6],
      [0.6, 0],
      [-0.6, 0],
    ] as const) {
      const face = addPart(
        group,
        new THREE.CircleGeometry(0.38, 20),
        gold,
        at.x + dir[0],
        y0 + 8.35,
        at.z + dir[1],
        false,
      );
      face.lookAt(at.x + dir[0] * 2, y0 + 8.35, at.z + dir[1] * 2);
      const disc = addPart(
        group,
        new THREE.CircleGeometry(0.26, 16),
        cream,
        at.x + dir[0] * 1.04,
        y0 + 8.35,
        at.z + dir[1] * 1.04,
        false,
      );
      disc.lookAt(at.x + dir[0] * 3, y0 + 8.35, at.z + dir[1] * 3);
    }
    addPart(group, new THREE.BoxGeometry(1.28, 0.7, 1.28), cream, at.x, y0 + 11.55, at.z);
    addPart(group, new THREE.ConeGeometry(0.72, 1.7, 4), dark, at.x, y0 + 12.75, at.z);
    addPart(group, new THREE.CylinderGeometry(0.05, 0.07, 1.3, 6), dark, at.x, y0 + 13.85, at.z);
    addChip(group, lm.name, at, 14.6);
    return;
  }

  if (kind === 'eye') {
    const hub = new THREE.Group();
    hub.position.copy(at);
    hub.position.y = y0 + 3.7;
    hub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.11, 8, 40), white);
    rim.castShadow = true;
    hub.add(rim);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 7.1, 5), dark);
      spoke.rotation.z = a;
      hub.add(spoke);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.22), glass);
      cap.position.set(Math.cos(a) * 3.55, Math.sin(a) * 3.55, 0);
      hub.add(cap);
    }
    group.add(hub);
    const ax = at.x - across.x * 0.9;
    const az = at.z - across.z * 0.9;
    for (const s of [-1.15, 1.15]) {
      const leg = addPart(
        group,
        new THREE.BoxGeometry(0.18, 4.2, 0.18),
        dark,
        ax + along.x * s,
        y0 + 2.1,
        az + along.z * s,
      );
      leg.rotation.z = s > 0 ? -0.28 : 0.28;
    }
    addChip(group, lm.name, at, 8.2);
    return;
  }

  if (kind === 'bttower') {
    addPart(group, new THREE.CylinderGeometry(0.22, 0.42, 3.2, 8), cream, at.x, y0 + 1.6, at.z);
    addPart(group, new THREE.CylinderGeometry(0.16, 0.22, 5.8, 8), dark, at.x, y0 + 6.1, at.z);
    addPart(group, new THREE.CylinderGeometry(0.62, 0.62, 0.22, 12), dark, at.x, y0 + 7.6, at.z);
    addPart(group, new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6), dark, at.x, y0 + 9.4, at.z);
    addChip(group, lm.name, at, 11.0);
    return;
  }

  if (kind === 'stpauls') {
    addPart(group, new THREE.BoxGeometry(4.4, 1.55, 2.35), stone, at.x, y0 + 0.78, at.z);
    addPart(
      group,
      new THREE.BoxGeometry(0.85, 2.6, 0.85),
      stone,
      at.x - 1.7,
      y0 + 2.1,
      at.z - 0.55,
    );
    addPart(
      group,
      new THREE.BoxGeometry(0.85, 2.6, 0.85),
      stone,
      at.x - 1.7,
      y0 + 2.1,
      at.z + 0.55,
    );
    addPart(group, new THREE.ConeGeometry(0.38, 0.7, 4), stone, at.x - 1.7, y0 + 3.7, at.z - 0.55);
    addPart(group, new THREE.ConeGeometry(0.38, 0.7, 4), stone, at.x - 1.7, y0 + 3.7, at.z + 0.55);
    addPart(
      group,
      new THREE.CylinderGeometry(1.35, 1.5, 1.7, 16),
      stone,
      at.x + 0.35,
      y0 + 2.4,
      at.z,
    );
    const dome = addPart(
      group,
      new THREE.SphereGeometry(1.55, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      cream,
      at.x + 0.35,
      y0 + 3.25,
      at.z,
    );
    dome.castShadow = true;
    addPart(
      group,
      new THREE.CylinderGeometry(0.22, 0.28, 1.05, 8),
      stone,
      at.x + 0.35,
      y0 + 5.15,
      at.z,
    );
    addPart(group, new THREE.SphereGeometry(0.18, 10, 8), gold, at.x + 0.35, y0 + 5.8, at.z);
    addChip(group, lm.name, at, 6.6);
    return;
  }

  if (kind === 'towerbridge') {
    const span = 6.4;
    const root = new THREE.Group();
    root.position.copy(at);
    root.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), across);
    const towerH = 7.4;
    for (const sx of [-span / 2, span / 2]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.15, towerH, 1.35), stone);
      t.position.set(sx, towerH / 2, 0);
      t.castShadow = true;
      root.add(t);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.45, 1.55), cream);
      top.position.set(sx, towerH + 0.1, 0);
      root.add(top);
      for (const [px, pz] of [
        [-0.42, -0.48],
        [0.42, -0.48],
        [-0.42, 0.48],
        [0.42, 0.48],
      ]) {
        const pin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.15, 4), stone);
        pin.position.set(sx + px, towerH + 0.85, pz);
        root.add(pin);
      }
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span + 1.6, 0.16, 1.05), dark);
    deck.position.set(0, 1.15, 0);
    root.add(deck);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(span, 0.12, 0.42), dark);
    walk.position.set(0, 5.85, 0);
    root.add(walk);
    const walk2 = new THREE.Mesh(new THREE.BoxGeometry(span, 0.12, 0.42), dark);
    walk2.position.set(0, 5.45, 0);
    root.add(walk2);
    group.add(root);
    addChip(group, lm.name, at, 8.6);
    return;
  }

  if (kind === 'powerstation') {
    addPart(group, new THREE.BoxGeometry(4.6, 1.55, 2.1), brick, at.x, y0 + 0.78, at.z);
    addPart(group, new THREE.BoxGeometry(4.2, 0.35, 2.3), cream, at.x, y0 + 1.65, at.z);
    for (const dx of [-1.45, -0.5, 0.5, 1.45]) {
      addPart(
        group,
        new THREE.CylinderGeometry(0.22, 0.28, 3.4, 10),
        cream,
        at.x + dx,
        y0 + 3.4,
        at.z,
      );
      addPart(
        group,
        new THREE.CylinderGeometry(0.18, 0.22, 0.35, 10),
        dark,
        at.x + dx,
        y0 + 5.2,
        at.z,
      );
    }
    addChip(group, lm.name, at, 5.8);
    return;
  }

  addPart(
    group,
    new THREE.SphereGeometry(2.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    white,
    at.x,
    y0,
    at.z,
  );
  addChip(group, lm.name, at, 3.2);
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

  const groundMat = clayMat(0xf0eadc);
  const bankMat = clayMat(0xcbb89a, { roughness: 0.85 });
  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x3aa8cc,
    roughness: 0.28,
    metalness: 0.04,
  });
  const riverDeepMat = new THREE.MeshStandardMaterial({
    color: 0x247aa3,
    roughness: 0.32,
    metalness: 0.05,
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

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = LAND_Y;
  ground.receiveShadow = true;
  group.add(ground);

  const banks = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 3.7, LAND_Y - 0.02), bankMat);
  banks.receiveShadow = true;
  const river = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 2.7, LAND_Y - 0.06), riverMat);
  river.receiveShadow = true;
  const channel = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 1.15, LAND_Y - 0.08), riverDeepMat);
  group.add(banks, river, channel);

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

  const toneMat: Record<CityBlock['tone'], THREE.MeshStandardMaterial> = {
    glass: clayMat(0xd2e0e8, { roughness: 0.52, metalness: 0.08 }),
    stone: clayMat(0xf0e6d4),
    brick: clayMat(0xd8a48c),
    fill: clayMat(0xe9e0d0),
  };
  const geos: Record<CityBlock['tone'], THREE.BufferGeometry[]> = {
    glass: [],
    stone: [],
    brick: [],
    fill: [],
  };
  const skip = reduced ? 2 : 1;
  CITY_BLOCKS.forEach((block, i) => {
    if (i % skip !== 0) return;
    try {
      const geo = new THREE.ExtrudeGeometry(shapeFromRing(block.ring), {
        depth: block.h,
        bevelEnabled: false,
        curveSegments: 1,
        steps: 1,
      });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, LAND_Y + 0.01, 0);
      geos[block.tone].push(geo);
    } catch {
      /* skip degenerate rings */
    }
  });
  (Object.keys(geos) as CityBlock['tone'][]).forEach((tone) => {
    if (!geos[tone].length) return;
    const merged = mergeGeometries(geos[tone], false);
    geos[tone].forEach((g) => g.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, toneMat[tone]);
    mesh.castShadow = !reduced;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

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
    addLandmark(group, lm, worldTo3(project(lm.at), LAND_Y));
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
