/**
 * Static 3D London miniature — land, river, parks, tube, buildings, landmarks.
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
  TUBE_LINES,
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
  glass: [0xb7c4ce, 0xa8b8c4, 0xc5d0d8, 0x9aafbe],
  stone: [0xe7e2d6, 0xd8d2c4, 0xefeae0, 0xcfc8b8],
  brick: [0xc4a086, 0xb8957a, 0xd0b49a, 0xa67c63],
  fill: [0xe4dfd2, 0xd5d0c4, 0xeee9dd, 0xc8c3b6],
  roof: [0x6d757c, 0x8a6a52, 0x5c6658, 0x7a838c],
} as const;

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
  g.addColorStop(0, '#7eb3d9');
  g.addColorStop(0.45, '#b7d6ea');
  g.addColorStop(0.85, '#e4f1f7');
  g.addColorStop(1, '#f3f7fa');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addLandmark(group: THREE.Group, kind: LandmarkKind, at: THREE.Vector3) {
  const stone = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x8a93a0, roughness: 0.4, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9eb8c6,
    roughness: 0.22,
    metalness: 0.15,
    transparent: true,
    opacity: 0.92,
  });

  if (kind === 'shard') {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.55, 8.4, 4), glass);
    mesh.position.set(at.x, LAND_Y + 4.2, at.z);
    mesh.rotation.y = 0.4;
    mesh.castShadow = true;
    group.add(mesh);
    return;
  }
  if (kind === 'bigben') {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.2, 0.55), stone);
    tower.position.set(at.x, LAND_Y + 2.1, at.z);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.7, 4), dark);
    cap.position.set(at.x, LAND_Y + 4.55, at.z);
    tower.castShadow = cap.castShadow = true;
    group.add(tower, cap);
    return;
  }
  if (kind === 'eye') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.08, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xdfe7ee, metalness: 0.4, roughness: 0.35 }),
    );
    ring.position.set(at.x, LAND_Y + 1.35, at.z);
    ring.rotation.y = 0.6;
    group.add(ring);
    return;
  }
  if (kind === 'bttower') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 4.6, 8), dark);
    stem.position.set(at.x, LAND_Y + 2.3, at.z);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12), dark);
    dish.position.set(at.x, LAND_Y + 3.6, at.z);
    stem.castShadow = true;
    group.add(stem, dish);
    return;
  }
  if (kind === 'stpauls') {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.9, 16), stone);
    drum.position.set(at.x, LAND_Y + 1.1, at.z);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      stone,
    );
    dome.position.set(at.x, LAND_Y + 1.55, at.z);
    drum.castShadow = dome.castShadow = true;
    group.add(drum, dome);
    return;
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    dark,
  );
  dome.position.set(at.x, LAND_Y, at.z);
  group.add(dome);
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

  const landMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: 0.92 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2f7eab,
    roughness: 0.28,
    metalness: 0.12,
  });
  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x3b8fbc,
    roughness: 0.32,
    metalness: 0.08,
  });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x6ea35a, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x5b8f4c,
    roughness: 0.85,
    flatShading: true,
  });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f33, roughness: 0.9 });

  const water = new THREE.Mesh(new THREE.PlaneGeometry(420, 280), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.12;
  water.receiveShadow = true;
  group.add(water);

  group.add(extrudeRing(LAND_NORTH, LAND_Y, landMat), extrudeRing(LAND_SOUTH, LAND_Y, landMat));
  const river = new THREE.Mesh(ribbonGeometry(THAMES_WORLD, 2.15, 0.04), riverMat);
  river.receiveShadow = true;
  group.add(river);

  for (const park of PARKS) {
    const mesh = extrudeRing(park.points, 0.08, parkMat);
    mesh.position.y = LAND_Y - 0.02;
    group.add(mesh);
    const trees = reduced ? 6 : 14;
    for (let i = 0; i < trees; i++) {
      const ll = park.points[Math.floor(rnd() * park.points.length)];
      const jitter: LngLat = [ll[0] + (rnd() - 0.5) * 0.004, ll[1] + (rnd() - 0.5) * 0.003];
      if (!isInPark(jitter[0], jitter[1])) continue;
      const p = worldTo3(project(jitter), LAND_Y);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 5), trunkMat);
      trunk.position.set(p.x, LAND_Y + 0.12, p.z);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22 + rnd() * 0.12, 0.45, 6), leafMat);
      leaf.position.set(p.x, LAND_Y + 0.42, p.z);
      leaf.castShadow = true;
      group.add(trunk, leaf);
    }
  }

  for (const line of TUBE_LINES) {
    const pts = line.points.map((ll) => worldTo3(project(ll), LAND_Y + 0.08));
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(12, pts.length * 6), 0.07, 5, false),
      new THREE.MeshStandardMaterial({ color: line.color, roughness: 0.45 }),
    );
    group.add(tube);
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
      const { x, z } = centerWorld(wp);
      const w = 0.32 + rnd() * (district.tone === 'fill' ? 0.45 : 0.7);
      const d = 0.32 + rnd() * (district.tone === 'fill' ? 0.5 : 0.7);
      const rad = Math.max(w, d) * 0.7;
      if (occupied.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + rad) ** 2 * 0.55)) continue;
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
        rot: (rnd() - 0.5) * 0.12,
        color: pal[Math.floor(rnd() * pal.length)],
        roof: PALETTE.roof[Math.floor(rnd() * PALETTE.roof.length)],
      });
      placed += 1;
    }
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildings = new THREE.InstancedMesh(
    boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.72 }),
    Math.max(1, samples.length),
  );
  buildings.castShadow = !reduced;
  buildings.receiveShadow = true;
  const roofs = new THREE.InstancedMesh(
    boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
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

  for (const lm of LANDMARKS) {
    addLandmark(group, lm.kind, worldTo3(project(lm.at), LAND_Y));
  }

  const craneMat = new THREE.MeshStandardMaterial({ color: 0xe6a817, roughness: 0.5 });
  for (const [lng, lat] of [
    [-0.02, 51.504],
    [-0.016, 51.506],
  ] as LngLat[]) {
    const p = worldTo3(project([lng, lat]), LAND_Y);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.2, 0.08), craneMat);
    mast.position.set(p.x, LAND_Y + 1.6, p.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.07), craneMat);
    arm.position.set(p.x + 0.9, LAND_Y + 3.1, p.z);
    group.add(mast, arm);
  }

  const bus = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.28, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xda291c, roughness: 0.45 }),
  );
  const busOrigin = worldTo3(project([-0.11, 51.503]), LAND_Y + 0.2);
  bus.position.copy(busOrigin);
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
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = '700 22px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(40,48,60,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText(label.text, 128, 40);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    sprite.position.copy(worldTo3(project(label.at), LAND_Y + 0.9));
    sprite.scale.set(8, 2, 1);
    group.add(sprite);
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
