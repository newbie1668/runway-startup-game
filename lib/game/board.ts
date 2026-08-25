/**
 * Static 3D London miniature — land, river, parks, buildings, landmarks.
 *
 * Look: yU+co Silicon Valley titles (dense low-poly daylight diorama).
 * Geography: scored OSM extract footprints painted as yU+co clay;
 * Thames / parks / hub heroes stay authored. Not Mapbox, not /sim.
 */

import * as THREE from 'three';
import { HUBS } from './content';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  AREA_LABELS,
  CANAL,
  CITY_BLOCKS,
  type CityBlock,
  DOCKS,
  LANDMARKS,
  PARKS,
  THAMES,
  centerWorld,
  distToSegment,
  isInPark,
  lngLatInThamesWater,
  project,
  type Landmark,
  type LandmarkKind,
  type LngLat,
  type WorldPoint,
} from './geo';
import { parseOsmClay, type BrickStock, type OsmClay } from './osmClay';
import type { HubId } from './types';

export const LAND_Y = 0.32;

/** Site-true clay — not a terracotta wash. */
const SITE = {
  glass: 0x8ea8b4,
  stone: 0xd6d0c6,
  brick: 0xb45c45,
  fill: 0xe7dfd2,
} as const;

const THAMES_WORLD: WorldPoint[] = THAMES.map(project);

const CLAY = { roughness: 0.9, metalness: 0.02 } as const;
const CANDY = [0xe11d48, 0x0d9488, 0xf59e0b, 0x2563eb, 0xf8fafc, 0x111827, 0xda291c] as const;

function clayGrain(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(32, 32);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 168 + ((i * 17 + 11) % 62);
    img.data[i] = n;
    img.data[i + 1] = n;
    img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let CLAY_GRAIN: THREE.CanvasTexture | null = null;

function clayMat(color: number, extras: Record<string, number> = {}) {
  if (typeof document !== 'undefined' && !CLAY_GRAIN) CLAY_GRAIN = clayGrain();
  return new THREE.MeshStandardMaterial({
    color,
    ...CLAY,
    ...extras,
    flatShading: true,
    ...(CLAY_GRAIN
      ? { bumpMap: CLAY_GRAIN, bumpScale: extras.bumpScale ?? 0.045, roughnessMap: CLAY_GRAIN }
      : {}),
  });
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

function addCrane(group: THREE.Group, at: THREE.Vector3, yaw: number, s = 1) {
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffee33, toneMapped: false });
  const cabMat = new THREE.MeshBasicMaterial({ color: 0x3b3f45, toneMapped: false });
  const hookMat = new THREE.MeshBasicMaterial({ color: 0xda291c, toneMapped: false });
  const mastH = 9.2 * s;
  const thick = 0.55 * s;
  const cx = Math.cos(yaw);
  const sz = Math.sin(yaw);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(thick, mastH, thick), yellow);
  mast.position.set(at.x, LAND_Y + mastH / 2, at.z);
  const mastB = new THREE.Mesh(new THREE.BoxGeometry(thick * 0.42, mastH, thick * 1.15), yellow);
  mastB.position.copy(mast.position);
  const jibLen = 7.4 * s;
  const jib = new THREE.Mesh(new THREE.BoxGeometry(jibLen, thick * 0.72, thick * 0.72), yellow);
  jib.position.set(
    at.x + cx * jibLen * 0.38,
    LAND_Y + mastH + thick * 0.1,
    at.z + sz * jibLen * 0.38,
  );
  jib.rotation.y = yaw;
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(2.6 * s, thick * 0.85, thick * 0.85),
    yellow,
  );
  counter.position.set(at.x - cx * 1.5 * s, LAND_Y + mastH + thick * 0.1, at.z - sz * 1.5 * s);
  counter.rotation.y = yaw;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.05 * s, 0.85 * s, 1.15 * s), cabMat);
  cab.position.set(at.x + cx * 0.55 * s, LAND_Y + mastH - 0.7 * s, at.z + sz * 0.55 * s);
  cab.rotation.y = yaw;
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 1.35 * s, 0.38 * s), hookMat);
  hook.position.set(at.x + cx * jibLen * 0.68, LAND_Y + mastH - 1.4 * s, at.z + sz * jibLen * 0.68);
  mast.castShadow = jib.castShadow = true;
  group.add(mast, mastB, jib, counter, cab, hook);
}

function makeBus(body: THREE.Material, band: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.15, 1.2), body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.62, 0.32, 1.24), band);
  stripe.position.y = 0.16;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.14, 1.08), band);
  roof.position.y = 0.62;
  g.add(hull, stripe, roof);
  return g;
}

function addRoofJunk(group: THREE.Group, at: THREE.Vector3, kind: 'ac' | 'tank' | 'chimney') {
  if (kind === 'ac') {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 1.85, 3.2),
      new THREE.MeshBasicMaterial({ color: 0xf3efe6, toneMapped: false }),
    );
    box.position.copy(at);
    const fan = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.62, 2.05),
      new THREE.MeshBasicMaterial({ color: 0x7a828c, toneMapped: false }),
    );
    fan.position.set(at.x, at.y + 1.15, at.z);
    group.add(box, fan);
    return;
  }
  if (kind === 'tank') {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.55, 3.4, 10),
      new THREE.MeshBasicMaterial({ color: 0x3aa0b8, toneMapped: false }),
    );
    tank.position.copy(at);
    group.add(tank);
    return;
  }
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.78, 6.2, 8),
    new THREE.MeshBasicMaterial({ color: 0x6b5348, toneMapped: false }),
  );
  stack.position.copy(at);
  group.add(stack);
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

function ringToShapePts(ring: readonly LngLat[]): Array<{ x: number; y: number }> {
  return ring.map((ll) => {
    const { x, z } = centerWorld(project(ll));
    return { x, y: -z };
  });
}

function shapeFromPts(pts: Array<{ x: number; y: number }>): THREE.Shape {
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.y);
    else shape.lineTo(p.x, p.y);
  });
  shape.closePath();
  return shape;
}

function shapeFromRing(ring: readonly LngLat[]): THREE.Shape {
  return shapeFromPts(ringToShapePts(ring));
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

/** Per-segment street quads — no miter spikes, readable at board scale. */
function streetRibbon(line: readonly WorldPoint[], halfW: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let v = 0;
  for (let i = 1; i < line.length; i++) {
    const a = centerWorld(line[i - 1]);
    const b = centerWorld(line[i]);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;
    positions.push(
      a.x + nx,
      y,
      a.z + nz,
      a.x - nx,
      y,
      a.z - nz,
      b.x + nx,
      y,
      b.z + nz,
      b.x - nx,
      y,
      b.z - nz,
    );
    indices.push(v, v + 2, v + 1, v + 2, v + 3, v + 1);
    v += 4;
  }
  if (v < 4) return new THREE.BufferGeometry();
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
  g.addColorStop(0, '#f0ebe3');
  g.addColorStop(0.42, '#e6e0d6');
  g.addColorStop(0.78, '#d9d3c8');
  g.addColorStop(1, '#cfc8bc');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addChip(group: THREE.Group, text: string, at: THREE.Vector3, y = 2.2) {
  return;
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
  const stone = clayMat(0xe2c49a, { roughness: 0.68 });
  const cream = clayMat(0xf0e4c8, { roughness: 0.7 });
  const brick = clayMat(0xb45c45, { roughness: 0.74 });
  const dark = clayMat(0x5a616c, { roughness: 0.55, metalness: 0.12 });
  const glass = clayMat(0xb7c9d4, { roughness: 0.42, metalness: 0.08 });
  const gold = clayMat(0xe8c872, { roughness: 0.5, metalness: 0.22 });
  const white = clayMat(0xeef2f5, { roughness: 0.48, metalness: 0.1 });
  const { along, across } = riverFrame(lm.at);
  const kind: LandmarkKind = lm.kind;
  const y0 = LAND_Y;

  if (kind === 'shard') {
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
    const root = new THREE.Group();
    root.position.copy(at);
    root.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), across);
    const windowMat = clayMat(0x3d4a58, { roughness: 0.52 });
    const asphalt = clayMat(0x3b3f45, { roughness: 0.9 });
    const half = 3.35;
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
      return m;
    };
    const gothicTower = (sx: number) => {
      box(sx, 0.82, 0, 2.2, 1.64, 2.5, stone);
      box(sx, 3.2, 0, 1.88, 3.1, 2.08, stone);
      box(sx, 5.75, 0, 1.62, 2.15, 1.82, stone);
      box(sx, 7.4, 0, 1.98, 1.18, 2.18, cream);
      box(sx, 8.42, 0, 1.32, 0.92, 1.42, cream);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.12, 1.9, 4), cream);
      roof.position.set(sx, 9.62, 0);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      root.add(roof);
      for (const [px, pz] of [
        [-0.74, -0.8],
        [0.74, -0.8],
        [-0.74, 0.8],
        [0.74, 0.8],
      ]) {
        box(sx + px, 7.92, pz, 0.28, 1.9, 0.28, stone);
        const pin = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.58, 4), cream);
        pin.position.set(sx + px, 9.08, pz);
        pin.rotation.y = Math.PI / 4;
        root.add(pin);
      }
      box(sx, 4.45, 1.1, 0.58, 1.7, 0.12, windowMat);
      box(sx, 4.45, -1.1, 0.58, 1.7, 0.12, windowMat);
      box(sx, 6.1, 0.98, 0.44, 0.95, 0.1, windowMat);
      box(sx, 6.1, -0.98, 0.44, 0.95, 0.1, windowMat);
    };
    gothicTower(-half);
    gothicTower(half);
    box(0, 1.18, 0, 14.4, 0.22, 1.58, asphalt);
    box(0, 1.36, 0, 13.7, 0.1, 1.38, stone);
    box(-1.18, 1.52, 0, 3.15, 0.22, 1.32, cream);
    box(1.18, 1.52, 0, 3.15, 0.22, 1.32, cream);
    box(0, 1.68, 0, 0.22, 0.14, 1.28, dark);
    box(-half + 1.18, 2.22, 0, 1.12, 1.28, 1.78, stone);
    box(half - 1.18, 2.22, 0, 1.12, 1.28, 1.78, stone);
    const walkW = half * 2 - 1.55;
    box(0, 7.28, -0.54, walkW, 0.95, 0.55, cream);
    box(0, 7.28, 0.54, walkW, 0.95, 0.55, cream);
    box(0, 7.86, 0, walkW + 0.18, 0.22, 1.48, stone);
    box(0, 7.28, -0.8, walkW - 0.25, 0.42, 0.1, windowMat);
    box(0, 7.28, 0.8, walkW - 0.25, 0.42, 0.1, windowMat);
    const chain = (x0: number, y0: number, z: number, x1: number, y1: number) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), dark);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
      m.rotation.z = Math.atan2(dy, dx);
      root.add(m);
    };
    chain(-half - 0.15, 6.35, 0.55, -7.05, 1.48);
    chain(-half - 0.15, 6.35, -0.55, -7.05, 1.48);
    chain(half + 0.15, 6.35, 0.55, 7.05, 1.48);
    chain(half + 0.15, 6.35, -0.55, 7.05, 1.48);
    group.add(root);
    addChip(group, lm.name, at, 8.6);
    return;
  }

  if (kind === 'powerstation') {
    addPart(group, new THREE.BoxGeometry(8.4, 2.6, 4.2), brick, at.x, y0 + 1.3, at.z);
    addPart(group, new THREE.BoxGeometry(7.6, 1.15, 3.6), brick, at.x, y0 + 3.15, at.z);
    addPart(group, new THREE.BoxGeometry(8.0, 0.45, 4.5), cream, at.x, y0 + 2.7, at.z);
    addPart(group, new THREE.BoxGeometry(3.4, 1.8, 3.4), cream, at.x + 0.2, y0 + 4.4, at.z);
    for (const dx of [-2.7, -0.9, 0.9, 2.7]) {
      addPart(
        group,
        new THREE.CylinderGeometry(0.42, 0.52, 7.6, 12),
        cream,
        at.x + dx,
        y0 + 7.4,
        at.z - 0.15,
      );
      addPart(
        group,
        new THREE.CylinderGeometry(0.32, 0.42, 0.55, 12),
        dark,
        at.x + dx,
        y0 + 11.35,
        at.z - 0.15,
      );
    }
    addChip(group, lm.name, at, 12.2);
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

function ll3(lng: number, lat: number, y = LAND_Y): THREE.Vector3 {
  return worldTo3(project([lng, lat]), y);
}

function addBoxLL(
  group: THREE.Group,
  lng: number,
  lat: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  yaw = 0,
) {
  const p = ll3(lng, lat);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(p.x, LAND_Y + h / 2, p.z);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (lngLatInThamesWater(lng, lat)) return mesh;
  group.add(mesh);
  return mesh;
}

function addBarrelShed(
  group: THREE.Group,
  lng: number,
  lat: number,
  len: number,
  width: number,
  h: number,
  yaw: number,
  mat: THREE.Material,
) {
  if (lngLatInThamesWater(lng, lat)) return;
  addBoxLL(group, lng, lat, len, h * 0.62, width, mat, yaw);
  const p = ll3(lng, lat);
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.52, width * 0.52, len, 12, 1, false, 0, Math.PI),
    mat,
  );
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = yaw;
  roof.position.set(p.x, LAND_Y + h * 0.62, p.z);
  roof.castShadow = true;
  group.add(roof);
}

function addCylLL(
  group: THREE.Group,
  lng: number,
  lat: number,
  rTop: number,
  rBot: number,
  h: number,
  mat: THREE.Material,
  segs = 14,
) {
  const p = ll3(lng, lat);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), mat);
  mesh.position.set(p.x, LAND_Y + h / 2, p.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (lngLatInThamesWater(lng, lat)) return mesh;
  group.add(mesh);
  return mesh;
}

/** Distinctive clay so each hub reads without a name pill. */
function addNeighbourhoods(
  group: THREE.Group,
  reduced: boolean,
  mats: {
    brick: THREE.Material;
    stone: THREE.Material;
    glass: THREE.Material;
    asphalt: THREE.Material;
    park: THREE.Material;
    dark: THREE.Material;
    cream: THREE.Material;
  },
  osmFabric: boolean,
) {
  const { brick, stone, glass, asphalt, park, dark, cream } = mats;
  const candy = [0xe11d48, 0x2563eb, 0xf59e0b, 0x0d9488, 0xf8fafc, 0x111827];
  const terracotta = clayMat(SITE.brick);
  const roof = clayMat(0x6b4b3e);

  // --- King's Cross: train sheds, St Pancras towers, gasholder ---
  addBarrelShed(group, -0.1258, 51.5318, 11.2, 3.15, 2.45, 0.04, brick);
  addBarrelShed(group, -0.123, 51.5304, 10.4, 2.85, 2.15, 0.04, brick);
  addBoxLL(group, -0.1288, 51.5316, 1.55, 3.4, 1.85, brick, 0.04);
  addBoxLL(group, -0.1296, 51.5326, 0.72, 5.4, 0.72, brick, 0.04);
  addBoxLL(group, -0.128, 51.5326, 0.72, 5.4, 0.72, brick, 0.04);
  addBoxLL(group, -0.1288, 51.5328, 1.85, 1.15, 0.7, roof, 0.04);
  const holder = ll3(-0.1182, 51.5356);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.16, 10, 36), terracotta);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(holder.x, LAND_Y + 1.85, holder.z);
  ring.castShadow = true;
  group.add(ring);
  addCylLL(group, -0.1182, 51.5356, 1.85, 1.85, 0.18, brick, 28).position.y = LAND_Y + 0.12;
  if (!osmFabric) {
    const plaza = addBoxLL(group, -0.1255, 51.5348, 4.2, 0.08, 3.0, cream, 0.1);
    plaza.castShadow = false;
    addBoxLL(group, -0.1206, 51.5332, 5.4, 2.35, 1.25, glass, 0.08);
  }

  // --- Shoreditch: Old Street circus + Boxpark ---
  const round = ll3(-0.0874, 51.5256);
  const island = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.1, 28), park);
  island.position.set(round.x, LAND_Y + 0.05, round.z);
  const curb = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.48, 10, 40), asphalt);
  curb.rotation.x = Math.PI / 2;
  curb.position.set(round.x, LAND_Y + 0.06, round.z);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.08, 8, 32), cream);
  inner.rotation.x = Math.PI / 2;
  inner.position.set(round.x, LAND_Y + 0.08, round.z);
  group.add(island, curb, inner);
  if (!osmFabric) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      addBoxLL(
        group,
        -0.0874 + Math.cos(a) * 0.0036,
        51.5256 + Math.sin(a) * 0.0022,
        1.45,
        1.05 + (i % 3) * 0.28,
        0.92,
        brick,
        -a,
      );
    }
    for (let i = 0; i < (reduced ? 8 : 12); i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const box = addBoxLL(
        group,
        -0.0818 + col * 0.00062,
        51.5224 + row * 0.00055,
        0.55,
        0.34,
        0.28,
        clayMat(candy[i % candy.length]),
        0.18,
      );
      box.position.y = LAND_Y + 0.18 + row * 0.36;
    }
  }

  // --- Soho: terrace square + Centre Point ---
  addBoxLL(group, -0.1298, 51.5166, 1.35, 9.1, 1.35, cream, 0.12);
  addBoxLL(group, -0.1298, 51.5166, 1.55, 0.42, 1.55, dark, 0.12).position.y = LAND_Y + 9.28;
  addBoxLL(group, -0.1298, 51.5166, 1.05, 0.55, 1.05, cream, 0.12).position.y = LAND_Y + 8.55;
  const sohoSq = addBoxLL(group, -0.1355, 51.5132, 4.2, 0.08, 3.6, park, 0);
  sohoSq.castShadow = false;
  if (!osmFabric) {
    for (const [lng, lat, yaw] of [
      [-0.1382, 51.5132, 0.02],
      [-0.1328, 51.5132, 0.02],
      [-0.1355, 51.5152, 1.57],
      [-0.1355, 51.5112, 1.57],
    ] as const) {
      addBoxLL(group, lng, lat, 0.62, 1.65, 3.55, brick, yaw);
      addBoxLL(group, lng, lat, 0.72, 0.26, 3.65, roof, yaw).position.y = LAND_Y + 1.76;
    }
    for (let i = 0; i < 6; i++) {
      addBoxLL(
        group,
        -0.1338 + (i % 3) * 0.00115,
        51.5142 + Math.floor(i / 3) * 0.0007,
        0.42,
        1.15,
        0.95,
        brick,
        0.08,
      );
      addBoxLL(
        group,
        -0.1372 + (i % 3) * 0.00105,
        51.5122 + Math.floor(i / 3) * 0.00065,
        0.38,
        1.05,
        0.88,
        brick,
        -0.06,
      );
    }
  }

  // --- Farringdon: Smithfield halls ---
  if (!osmFabric) {
    for (let i = 0; i < 11; i++) {
      const lng = -0.1072 + i * 0.00098;
      addBoxLL(group, lng, 51.5188, 1.28, 2.95, 3.85, brick, 0);
      const hall = addBoxLL(group, lng, 51.5188, 1.12, 1.25, 3.45, dark, 0);
      hall.rotation.z = 0.72;
      hall.position.y = LAND_Y + 3.15;
      addBoxLL(group, lng, 51.5177, 1.18, 2.45, 3.25, brick, 0);
      const hall2 = addBoxLL(group, lng, 51.5177, 1.02, 1.05, 2.95, dark, 0);
      hall2.rotation.z = 0.72;
      hall2.position.y = LAND_Y + 2.62;
    }
    addBoxLL(group, -0.1024, 51.51825, 0.85, 2.15, 7.8, dark, 0);
    addBoxLL(group, -0.1024, 51.51825, 0.55, 0.22, 7.9, roof, 0).position.y = LAND_Y + 2.28;
    addBoxLL(group, -0.1024, 51.5189, 0.72, 1.85, 0.72, brick, 0);
    addBoxLL(group, -0.1024, 51.5189, 0.22, 1.15, 0.22, dark, 0).position.y = LAND_Y + 2.55;
  }

  // --- Canary Wharf: 1 Canada Square pyramid sitting in the dock basins ---
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x3a96aa,
    roughness: 0.56,
    metalness: 0.02,
  });
  const addBasin = (lng: number, lat: number, w: number, d: number) => {
    if (lngLatInThamesWater(lng, lat)) return;
    const p = ll3(lng, lat);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, d), waterMat);
    mesh.position.set(p.x, LAND_Y + 0.26, p.z);
    mesh.receiveShadow = true;
    group.add(mesh);
    addBoxLL(group, lng, lat + d * 0.00052, w + 0.55, 0.32, 0.32, dark, 0);
    addBoxLL(group, lng, lat - d * 0.00052, w + 0.55, 0.32, 0.32, dark, 0);
    addBoxLL(group, lng + w * 0.00044, lat, 0.32, 0.32, d + 0.45, dark, 0);
    addBoxLL(group, lng - w * 0.00044, lat, 0.32, 0.32, d + 0.45, dark, 0);
  };
  if (!osmFabric) {
    addBasin(-0.0194, 51.5074, 13.2, 3.4);
    addBasin(-0.0194, 51.5034, 12.6, 3.2);
    addBasin(-0.0188, 51.5006, 11.2, 2.8);
    addBasin(-0.0118, 51.5048, 3.6, 6.4);
    addBasin(-0.027, 51.5046, 3.5, 6.2);
  }
  const canadaTower = new THREE.Group();
  const canadaAt = ll3(-0.0194, 51.5049);
  canadaTower.position.set(canadaAt.x, 0, canadaAt.z);
  canadaTower.rotation.y = 0.2;
  const shaftW = 2.55;
  const shaftH = 13.2;
  const canadaShaft = new THREE.Mesh(new THREE.BoxGeometry(shaftW, shaftH, shaftW), glass);
  canadaShaft.position.set(0, LAND_Y + shaftH / 2, 0);
  canadaShaft.castShadow = true;
  canadaShaft.receiveShadow = true;
  canadaTower.add(canadaShaft);
  const capH = 3.7;
  const capR = (shaftW / 2) * Math.SQRT2;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(capR, capH, 4), cream);
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0, LAND_Y + shaftH + capH / 2 - 0.08, 0);
  cap.castShadow = true;
  canadaTower.add(cap);
  group.add(canadaTower);
  if (!osmFabric) {
    addBoxLL(group, -0.0236, 51.5058, 1.35, 8.2, 1.35, glass, 0.08);
    addBoxLL(group, -0.0152, 51.5054, 1.45, 7.2, 1.15, glass, 0.35);
    addBoxLL(group, -0.0216, 51.5022, 1.2, 6.4, 1.2, glass, -0.1);
    addBoxLL(group, -0.0166, 51.5018, 1.45, 5.2, 1.0, glass, 0.15);
    addBoxLL(group, -0.0254, 51.5024, 1.05, 4.8, 1.05, glass, 0.4);
  }

  // --- London Bridge: Borough Market peaks under the Shard ---
  if (!osmFabric) {
    for (let i = 0; i < 12; i++) {
      const lng = -0.0926 + (i % 4) * 0.00085;
      const lat = 51.5052 + Math.floor(i / 4) * 0.00062;
      addBoxLL(group, lng, lat, 1.05, 0.85, 1.05, brick, 0.12);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.85, 4), roof);
      const q = ll3(lng, lat);
      peak.position.set(q.x, LAND_Y + 1.28, q.z);
      peak.rotation.y = 0.8;
      peak.castShadow = true;
      group.add(peak);
    }
  }
  if (!osmFabric) addBarrelShed(group, -0.0864, 51.5038, 6.2, 2.05, 1.85, 1.12, stone);

  // --- Camden: Roundhouse drum + lock horseshoe ---
  const rh = ll3(-0.1494, 51.5431);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.75, 2.35, 22), brick);
  drum.position.set(rh.x, LAND_Y + 1.18, rh.z);
  drum.castShadow = true;
  const cornice = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.12, 8, 28), dark);
  cornice.rotation.x = Math.PI / 2;
  cornice.position.set(rh.x, LAND_Y + 2.28, rh.z);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.55, 0.85, 22), dark);
  cone.position.set(rh.x, LAND_Y + 2.78, rh.z);
  group.add(drum, cornice, cone);
  addCylLL(group, -0.1494, 51.5431, 0.42, 0.5, 0.7, dark, 10).position.y = LAND_Y + 2.55;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    addBoxLL(
      group,
      -0.1494 + Math.cos(a) * 0.00205,
      51.5431 + Math.sin(a) * 0.00128,
      0.22,
      0.72,
      0.16,
      dark,
      -a,
    ).position.y = LAND_Y + 1.15;
  }
  if (!osmFabric) addBoxLL(group, -0.1528, 51.5436, 1.65, 1.15, 0.85, brick, -0.2);
  const lockMat = new THREE.MeshStandardMaterial({
    color: 0x2f9ec6,
    roughness: 0.26,
    metalness: 0.05,
  });
  const lockDeepMat = new THREE.MeshStandardMaterial({
    color: 0x2478a3,
    roughness: 0.32,
    metalness: 0.05,
  });
  const addLockWater = (
    lng: number,
    lat: number,
    w: number,
    d: number,
    yaw: number,
    h = 0.28,
    mat: THREE.MeshStandardMaterial = lockMat,
  ) => {
    const p = ll3(lng, lat);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(p.x, LAND_Y + 0.16, p.z);
    mesh.rotation.y = yaw;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  // Basin east of the drum so a north camera sees lock and Roundhouse side by side.
  addLockWater(-0.1406, 51.5428, 5.6, 3.8, 0.06, 0.3);
  addLockWater(-0.1406, 51.5428, 1.45, 3.2, 0.06, 0.22, lockDeepMat);
  addLockWater(-0.1474, 51.5415, 4.6, 1.15, 0.1, 0.26);
  addLockWater(-0.1358, 51.5422, 3.4, 1.05, -0.16, 0.26);
  addBoxLL(group, -0.1406, 51.5408, 5.8, 0.42, 0.55, stone, 0.06);
  addBoxLL(group, -0.1376, 51.5428, 0.5, 0.42, 3.6, stone, 0.06);
  addBoxLL(group, -0.1436, 51.5428, 0.5, 0.42, 3.6, stone, 0.06);
  addBoxLL(group, -0.1418, 51.5444, 0.34, 1.45, 0.34, stone, 0);
  addBoxLL(group, -0.1394, 51.5444, 0.34, 1.45, 0.34, stone, 0);
  addBoxLL(group, -0.1406, 51.5444, 1.7, 0.95, 0.14, dark, 0);
  addBoxLL(group, -0.1418, 51.5412, 0.34, 1.45, 0.34, stone, 0);
  addBoxLL(group, -0.1394, 51.5412, 0.34, 1.45, 0.34, stone, 0);
  addBoxLL(group, -0.1406, 51.5412, 1.7, 0.95, 0.14, dark, 0);
  if (!osmFabric) {
    for (let i = 0; i < (reduced ? 10 : 16); i++) {
      const t = i / 15;
      const lng = t < 0.45 ? -0.1358 : -0.1388 + (t - 0.45) * 0.006;
      const lat = t < 0.45 ? 51.5452 - t * 0.0065 : 51.5402;
      addBoxLL(
        group,
        lng,
        lat,
        0.52,
        0.48,
        0.4,
        clayMat(candy[i % candy.length]),
        t < 0.45 ? 1.4 : 0.1,
      );
    }
  }
  const lockCut = (
    [
      [-0.1548, 51.5418],
      [-0.15, 51.5415],
      [-0.1464, 51.5417],
      [-0.1406, 51.5428],
      [-0.135, 51.542],
    ] as const
  ).map(([lng, lat]) => project([lng, lat]));
  group.add(new THREE.Mesh(ribbonGeometry(lockCut, 0.95, LAND_Y + 0.14), lockMat));
  group.add(new THREE.Mesh(ribbonGeometry(lockCut, 0.4, LAND_Y + 0.16), lockDeepMat));

  // --- Battersea: riverside circus; chimneys come from the landmark ---
  if (!osmFabric) addBoxLL(group, -0.1408, 51.4836, 4.4, 1.85, 1.15, glass, 0.05);
  const circus = ll3(-0.1378, 51.4796);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.22, 24), cream);
  disc.position.set(circus.x, LAND_Y + 0.14, circus.z);
  group.add(disc);

  // --- City pickle ---
  const gherkin = ll3(-0.0803, 51.5145);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.92, 6.4, 12), glass);
  shaft.position.set(gherkin.x, LAND_Y + 3.3, gherkin.z);
  shaft.castShadow = true;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.64, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    glass,
  );
  dome.position.set(gherkin.x, LAND_Y + 6.5, gherkin.z);
  group.add(shaft, dome);

  if (!osmFabric) {
    // --- South Bank: National Theatre stacks ---
    addBoxLL(group, -0.1148, 51.5073, 2.4, 1.45, 1.9, stone, 0.2);
    addBoxLL(group, -0.1138, 51.507, 1.55, 2.05, 1.35, stone, 0.2);
    addBoxLL(group, -0.0996, 51.5077, 2.7, 1.25, 1.55, brick, 0.15);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 4.2, 8), brick);
    const tate = ll3(-0.0994, 51.5077);
    chimney.position.set(tate.x + 0.7, LAND_Y + 2.7, tate.z);
    chimney.castShadow = true;
    group.add(chimney);
  }

  const gold = clayMat(0xe4c56a, { roughness: 0.48, metalness: 0.18 });

  if (!osmFabric) {
    // --- Westminster spine ---
    addBoxLL(group, -0.1266, 51.5036, 0.85, 1.65, 6.8, stone, 0.08);
    addBoxLL(group, -0.1284, 51.5046, 2.65, 1.25, 1.05, stone, 0.12);
    addCylLL(group, -0.1281, 51.508, 0.18, 0.26, 5.1, stone, 10);
    addCylLL(group, -0.1281, 51.508, 0.36, 0.36, 0.24, gold, 10).position.y = LAND_Y + 5.25;

    // --- British Museum court ---
    addBoxLL(group, -0.1269, 51.5199, 4.4, 1.45, 0.9, stone, 0);
    addBoxLL(group, -0.1285, 51.5188, 0.9, 1.35, 2.65, stone, 0);
    addBoxLL(group, -0.1253, 51.5188, 0.9, 1.35, 2.65, stone, 0);
    addBoxLL(group, -0.1269, 51.5178, 4.4, 1.65, 1.05, stone, 0);
  }

  // --- City: Walkie Talkie, Cheesegrater; Tower of London stays OSM-clipped when fabric is on ---
  addCylLL(group, -0.0837, 51.5115, 1.45, 0.68, 8.8, glass, 10);
  const grater = addBoxLL(group, -0.0821, 51.5139, 1.05, 10.8, 3.05, glass, 0.72);
  grater.rotation.z = 0.22;
  grater.position.y = LAND_Y + 5.4;
  if (!osmFabric) {
    addBoxLL(group, -0.0761, 51.5081, 3.25, 2.25, 2.75, stone, 0.15);
    for (const [dx, dz] of [
      [-0.0011, -0.0008],
      [0.0011, -0.0008],
      [-0.0011, 0.0008],
      [0.0011, 0.0008],
    ] as const) {
      addCylLL(group, -0.0761 + dx, 51.5081 + dz, 0.34, 0.4, 2.85, stone, 8);
    }
    addBarrelShed(group, -0.1142, 51.5034, 7.4, 2.05, 1.95, 0.22, stone);
    addBarrelShed(group, -0.1128, 51.5028, 6.8, 1.85, 1.75, 0.22, stone);
    addBarrelShed(group, -0.1116, 51.5022, 6.2, 1.65, 1.55, 0.22, cream);
    addBoxLL(group, -0.1245, 51.4872, 3.35, 1.65, 2.65, cream, 0.35);
    addBoxLL(group, -0.1245, 51.4872, 2.65, 1.25, 2.15, cream, 0.35).position.y = LAND_Y + 2.25;
    addBoxLL(group, -0.1245, 51.4872, 1.85, 1.05, 1.55, cream, 0.35).position.y = LAND_Y + 3.35;
  }
}

function mergeChunks(geos: THREE.BufferGeometry[], chunk = 420): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < geos.length; i += chunk) {
    const slice = geos.slice(i, i + chunk);
    const merged = mergeGeometries(slice, false);
    slice.forEach((g) => g.dispose());
    if (merged) parts.push(merged);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const all = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return all;
}

function addOsmFabric(
  group: THREE.Group,
  clay: OsmClay,
  reduced: boolean,
  toneMat: Record<CityBlock['tone'], THREE.Material>,
  _asphalt: THREE.Material,
  _paint: THREE.Material,
  water: THREE.Material,
  waterDeep: THREE.Material,
): WorldPoint[][] {
  const streetMat = new THREE.MeshBasicMaterial({
    color: 0x3b3f45,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  });
  const laneMat = new THREE.MeshBasicMaterial({
    color: 0xf5f1e8,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -12,
    polygonOffsetUnits: -12,
  });

  const geos: Record<CityBlock['tone'], THREE.BufferGeometry[]> = {
    glass: [],
    stone: [],
    brick: [],
    fill: [],
  };
  const brickGeos: Record<BrickStock, THREE.BufferGeometry[]> = {
    yellow: [],
    grey: [],
    dirty: [],
    red: [],
  };
  const crossingGeos: Record<CityBlock['tone'], THREE.BufferGeometry[]> = {
    glass: [],
    stone: [],
    brick: [],
    fill: [],
  };
  const crossingBrickGeos: Record<BrickStock, THREE.BufferGeometry[]> = {
    yellow: [],
    grey: [],
    dirty: [],
    red: [],
  };
  const brickMat: Record<BrickStock, THREE.Material> = {
    yellow: clayMat(0xc9a36a, { roughness: 0.8 }),
    grey: clayMat(0x8e8a84, { roughness: 0.82 }),
    dirty: clayMat(0x6e4a40, { roughness: 0.86 }),
    red: clayMat(0xa66a58, { roughness: 0.8 }),
  };
  const crossingOf = (ring: readonly LngLat[]) => {
    const n =
      ring.length -
      (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
    let lng = 0;
    let lat = 0;
    for (let i = 0; i < n; i++) {
      lng += ring[i][0];
      lat += ring[i][1];
    }
    lng /= n;
    lat /= n;
    return lng > -0.098 && lng < -0.068 && lat > 51.499 && lat < 51.512;
  };
  for (const b of clay.buildings) {
    try {
      const geo = new THREE.ExtrudeGeometry(shapeFromPts(ringToShapePts(b.ring)), {
        depth: b.h,
        bevelEnabled: false,
        curveSegments: 1,
        steps: 1,
      });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, LAND_Y + 0.02, 0);
      const atCrossing = crossingOf(b.ring);
      const destTone = atCrossing ? crossingGeos : geos;
      const destBrick = atCrossing ? crossingBrickGeos : brickGeos;
      if (b.tone === 'brick') destBrick[b.brickStock ?? 'yellow'].push(geo);
      else destTone[b.tone].push(geo);
    } catch {
      /* degenerate footprint */
    }
  }
  const addToneMeshes = (
    buckets: Record<CityBlock['tone'], THREE.BufferGeometry[]>,
    mats: Record<CityBlock['tone'], THREE.Material>,
    order?: number,
  ) => {
    (Object.keys(buckets) as CityBlock['tone'][]).forEach((tone) => {
      const merged = mergeChunks(buckets[tone]);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, mats[tone]);
      mesh.castShadow = !reduced;
      mesh.receiveShadow = true;
      if (order !== undefined) mesh.renderOrder = order;
      group.add(mesh);
    });
  };
  const addBrickMeshes = (
    buckets: Record<BrickStock, THREE.BufferGeometry[]>,
    order?: number,
  ) => {
    (Object.keys(buckets) as BrickStock[]).forEach((stock) => {
      const merged = mergeChunks(buckets[stock]);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, brickMat[stock]);
      mesh.castShadow = !reduced;
      mesh.receiveShadow = true;
      if (order !== undefined) mesh.renderOrder = order;
      group.add(mesh);
    });
  };
  addToneMeshes(geos, toneMat);
  addBrickMeshes(brickGeos);
  // Crossing fabric draws above the fat ribbon so OSM is not sliced into a jagged pile.
  addToneMeshes(crossingGeos, toneMat, 6);
  addBrickMeshes(crossingBrickGeos, 6);

  const roadGeos: THREE.BufferGeometry[] = [];
  const paintGeos: THREE.BufferGeometry[] = [];
  const carLines: WorldPoint[][] = [];
  for (const road of clay.roads) {
    const line: WorldPoint[] = road.line.map(([lng, lat]) => project([lng, lat]));
    carLines.push(line);
    try {
      const street = streetRibbon(line, road.halfW, LAND_Y + 0.16);
      if (street.getAttribute('position') && street.getAttribute('position')!.count >= 4) {
        roadGeos.push(street);
      } else {
        street.dispose();
      }
      if (road.painted) {
        const paintW = Math.min(0.16, Math.max(0.08, road.halfW * 0.12));
        const lane = streetRibbon(line, paintW, LAND_Y + 0.18);
        if (lane.getAttribute('position') && lane.getAttribute('position')!.count >= 4) {
          paintGeos.push(lane);
        } else {
          lane.dispose();
        }
      }
    } catch {
      /* skip */
    }
  }
  const roadMesh = mergeChunks(roadGeos);
  if (roadMesh) {
    roadMesh.computeBoundingSphere();
    const mesh = new THREE.Mesh(roadMesh, streetMat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  const paintMesh = mergeChunks(paintGeos);
  if (paintMesh) {
    paintMesh.computeBoundingSphere();
    const mesh = new THREE.Mesh(paintMesh, laneMat);
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  // London Bridge — one clean deck above the clay ribbon. OSM fragments z-fought.
  const lbDeck = (
    [
      [-0.0879, 51.50535],
      [-0.08772, 51.50655],
      [-0.08758, 51.5075],
      [-0.08768, 51.50875],
    ] as const
  ).map(([lng, lat]) => project([lng, lat]));
  const deckGeo = ribbonGeometry(lbDeck, 1.05, LAND_Y + 0.3);
  const deckMesh = new THREE.Mesh(deckGeo, streetMat);
  deckMesh.receiveShadow = true;
  deckMesh.frustumCulled = false;
  deckMesh.renderOrder = 7;
  group.add(deckMesh);
  const deckLane = new THREE.Mesh(ribbonGeometry(lbDeck, 0.1, LAND_Y + 0.31), laneMat);
  deckLane.receiveShadow = false;
  deckLane.frustumCulled = false;
  deckLane.renderOrder = 8;
  group.add(deckLane);

  for (const w of clay.waters) {
    try {
      const bed = extrudeRing(w.ring, 0.16, waterDeep);
      bed.position.y = LAND_Y + 0.05;
      bed.castShadow = false;
      group.add(bed);
      const pond = extrudeRing(w.ring, 0.11, water);
      pond.position.y = LAND_Y + 0.09;
      pond.castShadow = false;
      group.add(pond);
    } catch {
      /* skip */
    }
  }
  return carLines;
}

export function buildLondonBoard(reduced: boolean, osm: unknown = null): LondonBoard {
  const group = new THREE.Group();
  const rnd = seeded(20260824);

  const groundMat = new THREE.MeshBasicMaterial({ color: 0xd4cdc0, toneMapped: false });
  const bankMat = clayMat(0xc4b496, { roughness: 0.88 });
  bankMat.side = THREE.DoubleSide;
  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x3d9aaf,
    roughness: 0.58,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const riverDeepMat = new THREE.MeshStandardMaterial({
    color: 0x2c7388,
    roughness: 0.6,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const parkMat = clayMat(0x4e9444);
  const leafMat = clayMat(0x3d7e38);
  const trunkMat = clayMat(0x7a5533);
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x3b3f45,
    roughness: 0.92,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
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

  const canalWorld = CANAL.map(project);
  group.add(new THREE.Mesh(ribbonGeometry(canalWorld, 0.62, LAND_Y + 0.05), riverMat));
  group.add(new THREE.Mesh(ribbonGeometry(canalWorld, 0.28, LAND_Y + 0.07), riverDeepMat));
  for (const dock of DOCKS) {
    const camden = dock.name === 'Camden Lock';
    const bed = extrudeRing(dock.ring, camden ? 0.28 : 0.16, riverDeepMat);
    bed.position.y = LAND_Y + (camden ? 0.08 : 0.02);
    bed.castShadow = false;
    group.add(bed);
    const water = extrudeRing(dock.ring, camden ? 0.22 : 0.12, riverMat);
    water.position.y = LAND_Y + (camden ? 0.14 : 0.05);
    water.castShadow = false;
    group.add(water);
  }

  for (const park of PARKS) {
    const mesh = extrudeRing(park.points, 0.08, parkMat);
    mesh.position.y = LAND_Y + 0.02;
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
    glass: clayMat(SITE.glass, { roughness: 0.5, metalness: 0.08 }),
    stone: clayMat(SITE.stone, { roughness: 0.82 }),
    brick: clayMat(SITE.brick, { roughness: 0.78 }),
    fill: clayMat(SITE.fill, { roughness: 0.86 }),
  };
  const geos: Record<CityBlock['tone'], THREE.BufferGeometry[]> = {
    glass: [],
    stone: [],
    brick: [],
    fill: [],
  };
  const osmClay = parseOsmClay(osm, reduced);
  if (osmClay) {
    /* OSM footprints replace the authored grid so inner fabric is real. */
  } else {
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
  }

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
  let roads: WorldPoint[][] = [northBank, southBank];
  if (osmClay && osmClay.roads.length) {
    roads = addOsmFabric(
      group,
      osmClay,
      reduced,
      toneMat,
      asphaltMat,
      paintMat,
      riverMat,
      riverDeepMat,
    );
  } else {
    for (const [aId, bId] of hubLinks) {
      const a = HUBS.find((h) => h.id === aId)!;
      const b = HUBS.find((h) => h.id === bId)!;
      roads.push(lerpWorld(project([a.lng, a.lat]), project([b.lng, b.lat]), 8));
    }
    for (const road of roads) addRoad(group, road, 0.62, asphaltMat, paintMat);
  }

  const banks = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 3.9, LAND_Y + 0.06), bankMat);
  banks.receiveShadow = true;
  const river = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 2.9, LAND_Y + 0.19), riverMat);
  river.receiveShadow = true;
  const channel = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 1.35, LAND_Y + 0.21), riverDeepMat);
  group.add(banks, river, channel);
  const dogs = THAMES.filter((ll) => ll[0] > -0.042);
  if (dogs.length > 1) {
    const dogsWorld = dogs.map(project);
    group.add(new THREE.Mesh(ribbonGeometry(dogsWorld, 3.2, LAND_Y + 0.2), riverMat));
    group.add(new THREE.Mesh(ribbonGeometry(dogsWorld, 1.45, LAND_Y + 0.22), riverDeepMat));
  }

  let carPts = roads.flatMap((road) => sampleRibbon(road, reduced ? 8.5 : 5.6));
  if (carPts.length > 960) {
    const step = Math.ceil(carPts.length / 960);
    carPts = carPts.filter((_, i) => i % step === 0);
  }
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

  addNeighbourhoods(
    group,
    reduced,
    {
      brick: clayMat(SITE.brick),
      stone: clayMat(SITE.stone),
      glass: clayMat(SITE.glass, { roughness: 0.48, metalness: 0.1 }),
      asphalt: asphaltMat,
      park: parkMat,
      dark: clayMat(0x5a616c),
      cream: clayMat(0xf0e4c8),
    },
    !!osmClay,
  );

  for (const [lng, lat, yaw, s] of [
    // No T-cranes on the Canary camera line — pyramid stays first-read.
    // No T-crane on the London Bridge crossing — the yellow mast scored as overlay prisms.
    [-0.148, 51.483, 0.6, 1.5],
    [-0.08, 51.525, 1.1, 1.05],
    [-0.12, 51.518, -0.7, 1.35],
  ] as const) {
    addCrane(group, worldTo3(project([lng, lat]), LAND_Y), yaw, s);
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
      const lng = hub.lng + (rnd() - 0.5) * 0.008;
      const lat = hub.lat + (rnd() - 0.5) * 0.006;
      if (lngLatInThamesWater(lng, lat)) continue;
      addLollipop(group, worldTo3(project([lng, lat]), LAND_Y), rnd, trunkMat, leafMat);
    }
    for (let i = 0; i < (reduced ? 3 : 7); i++) {
      const lng = hub.lng + (rnd() - 0.5) * 0.005;
      const lat = hub.lat + (rnd() - 0.5) * 0.004;
      if (lngLatInThamesWater(lng, lat)) continue;
      addPerson(group, worldTo3(project([lng, lat]), LAND_Y), CANDY[Math.floor(rnd() * 5)]);
    }
  }

  const busMat = new THREE.MeshBasicMaterial({ color: 0xda291c, toneMapped: false });
  const busBand = new THREE.MeshBasicMaterial({ color: 0xf5f1e8, toneMapped: false });
  const busY = LAND_Y + 0.16 + 0.58;
  const busRoutes = roads.map((line) => sampleRibbon(line, 1.05)).filter((pts) => pts.length >= 6);
  const allRoadPts = busRoutes.flat();
  const busStops: LngLat[] = [
    [-0.0874, 51.5256],
    [-0.0194, 51.5044],
    [-0.11, 51.503],
    [-0.09, 51.513],
    [-0.1326, 51.515],
  ];
  const nearestRoad = (lng: number, lat: number) => {
    const c = worldTo3(project([lng, lat]), 0);
    let best = allRoadPts[0];
    let bestD = Infinity;
    for (const p of allRoadPts) {
      const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  if (allRoadPts.length) {
    const count = reduced ? 3 : busStops.length;
    for (let i = 0; i < count; i++) {
      const [lng, lat] = busStops[i];
      const origin = nearestRoad(lng, lat);
      const mesh = makeBus(busMat, busBand);
      mesh.position.set(origin.x, busY, origin.z);
      mesh.rotation.y = origin.rot;
      group.add(mesh);
    }
  }

  const roofKinds = ['ac', 'tank', 'chimney'] as const;
  for (let i = 0; i < (reduced ? 6 : 14); i++) {
    const hub = HUBS[i % HUBS.length];
    if (hub.id === 'canarywharf') continue;
    const p = worldTo3(
      project([hub.lng + (rnd() - 0.5) * 0.0048, hub.lat + (rnd() - 0.5) * 0.0034]),
      LAND_Y,
    );
    // Consume the same rng as before so Camden / Shoreditch junk does not move.
    if (hub.id === 'londonbridge') continue;
    const roofY = LAND_Y + 5.4 + (i % 4) * 1.6;
    addRoofJunk(group, new THREE.Vector3(p.x, roofY, p.z), roofKinds[i % 3]);
  }

  for (const label of AREA_LABELS) {
    addChip(group, label.text, worldTo3(project(label.at), LAND_Y), 1.55);
  }

  const sky = makeSkyTexture();

  return {
    group,
    sky,
    update: (t: number) => {
      void t;
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
