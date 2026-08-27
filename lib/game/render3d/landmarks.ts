/**
 * RUNWAY — procedural landmark geometry.
 *
 * Each builder returns a THREE.Group anchored at the landmark's ground
 * point (0,0,0 in local space — the caller positions the group at
 * project(at)). Heights use HEIGHT_SCALE (same style exaggeration as
 * buildings); footprint/thickness dimensions stay at real-world scale.
 * No shadow maps, no postprocessing — glow is emissive-only, matching the
 * rest of the city.
 */

import * as THREE from 'three';
import { METERS_TO_WORLD } from '../geo';
import type { LandmarkKind } from '../geo';
import { HEIGHT_SCALE } from './cityBuilder';
import { createDiagridTexture } from './textures';

/** Name used to find the rotating wheel sub-group for the frame()-driven spin. */
export const EYE_WHEEL_NAME = 'eyeWheel';

function m(meters: number): number {
  return meters * METERS_TO_WORLD;
}
function h(meters: number): number {
  return meters * METERS_TO_WORLD * HEIGHT_SCALE;
}

/** Translate a THREE-centered geometry (spans -height/2..+height/2) so it sits base-at-zero. */
function baseAtGround<T extends THREE.BufferGeometry>(geometry: T, height: number): T {
  geometry.translate(0, height / 2, 0);
  return geometry;
}

function emissiveMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

function glassMaterial(color: number, edgeColor: number): [THREE.MeshPhongMaterial, THREE.LineBasicMaterial] {
  return [
    new THREE.MeshPhongMaterial({ color, shininess: 70, specular: edgeColor }),
    new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.5 }),
  ];
}

function addEdges(mesh: THREE.Mesh, lineMaterial: THREE.LineBasicMaterial): void {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), lineMaterial);
  mesh.add(edges);
}

function buildShard(): THREE.Group {
  const group = new THREE.Group();
  const height = h(310);
  const profile: THREE.Vector2[] = [];
  const segments = 18;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r = m(22) * (1 - t) ** 1.15 + m(1.6);
    profile.push(new THREE.Vector2(r, t * height));
  }
  const geometry = new THREE.LatheGeometry(profile, 6);
  const [material, edgeMaterial] = glassMaterial(0x16223d, 0x9fc4ff);
  const mesh = new THREE.Mesh(geometry, material);
  addEdges(mesh, edgeMaterial);
  group.add(mesh);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(m(2.2), 8, 8), emissiveMaterial(0xffffff));
  tip.position.set(0, height, 0);
  group.add(tip);
  return group;
}

function buildGherkin(): THREE.Group {
  const group = new THREE.Group();
  const height = h(180);
  const maxR = m(28);
  const profile: THREE.Vector2[] = [];
  const segments = 16;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const rise = Math.min(1, t / 0.4);
    const fall = Math.max(0, (1 - t) / (1 - 0.4));
    const shape = Math.min(Math.sin((rise * Math.PI) / 2), Math.sin((fall * Math.PI) / 2));
    profile.push(new THREE.Vector2(Math.max(0, shape * maxR), t * height));
  }
  const geometry = new THREE.LatheGeometry(profile, 24);
  const diagrid = createDiagridTexture();
  const material = new THREE.MeshLambertMaterial({
    color: 0x14303a,
    emissive: 0xffffff,
    emissiveMap: diagrid,
    emissiveIntensity: 0.6,
  });
  group.add(new THREE.Mesh(geometry, material));
  return group;
}

function buildBigBen(): THREE.Group {
  const group = new THREE.Group();
  const shaftHeight = h(85);
  const shaft = new THREE.Mesh(
    baseAtGround(new THREE.BoxGeometry(m(12), shaftHeight, m(12)), shaftHeight),
    new THREE.MeshLambertMaterial({ color: 0x2a2a26 }),
  );
  group.add(shaft);

  const spireHeight = h(18);
  const spire = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(9), spireHeight, 4), spireHeight),
    new THREE.MeshLambertMaterial({ color: 0x2a2a26 }),
  );
  spire.position.y = shaftHeight;
  group.add(spire);

  const faceMaterial = emissiveMaterial(0xffe9a8);
  const faceY = h(78);
  const offset = m(6.2);
  const faces: Array<[number, number, number, number]> = [
    [0, faceY, offset, 0],
    [offset, faceY, 0, Math.PI / 2],
    [0, faceY, -offset, Math.PI],
    [-offset, faceY, 0, -Math.PI / 2],
  ];
  for (const [x, y, z, rotY] of faces) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(m(7), m(7)), faceMaterial);
    face.position.set(x, y, z);
    face.rotation.y = rotY;
    group.add(face);
  }
  return group;
}

function buildLondonEye(): THREE.Group {
  const group = new THREE.Group();
  const radius = h(60);
  const hubHeight = radius; // wheel centre height above ground

  const wheel = new THREE.Group();
  wheel.name = EYE_WHEEL_NAME;

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, m(1.2), 8, 48),
    new THREE.MeshLambertMaterial({ color: 0xaebbd0 }),
  );
  wheel.add(rim);

  const spokeMaterial = new THREE.MeshLambertMaterial({ color: 0x8ea0bd });
  const spokeCount = 32;
  for (let i = 0; i < spokeCount; i++) {
    const angle = (i / spokeCount) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(m(0.4), m(0.4), radius, 6), spokeMaterial);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = angle;
    spoke.position.set(0, 0, 0);
    spoke.translateX(radius / 2);
    wheel.add(spoke);
  }

  const podMaterial = emissiveMaterial(0x7dd3fc);
  const podCount = 16;
  for (let i = 0; i < podCount; i++) {
    const angle = (i / podCount) * Math.PI * 2;
    const pod = new THREE.Mesh(new THREE.SphereGeometry(m(2.2), 8, 6), podMaterial);
    pod.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    wheel.add(pod);
  }

  wheel.position.y = hubHeight;
  group.add(wheel);

  const legMaterial = new THREE.MeshLambertMaterial({ color: 0x8ea0bd });
  const legOffset = m(18);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(m(1.1), m(1.1), hubHeight * 1.05, 6),
      legMaterial,
    );
    leg.position.set(side * legOffset, (hubHeight * 1.05) / 2, m(6));
    leg.rotation.z = side * 0.28;
    group.add(leg);
  }

  return group;
}

function buildStPauls(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: 0xd9d3c0 });

  const naveHeight = h(20);
  const nave = new THREE.Mesh(baseAtGround(new THREE.BoxGeometry(m(75), naveHeight, m(30)), naveHeight), material);
  group.add(nave);

  const drumHeight = h(20);
  const drum = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(18), m(18), drumHeight, 20), drumHeight),
    material,
  );
  drum.position.y = naveHeight;
  group.add(drum);

  const domeRadius = m(22);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(domeRadius, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), material);
  dome.position.y = naveHeight + drumHeight;
  group.add(dome);

  const lanternHeight = h(15);
  const lantern = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(4), m(4), lanternHeight, 12), lanternHeight),
    emissiveMaterial(0xf3ecd6),
  );
  lantern.position.y = naveHeight + drumHeight + domeRadius * 0.55;
  group.add(lantern);

  return group;
}

function buildTowerBridge(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: 0x2f3a4a });
  const accent = emissiveMaterial(0x7dd3fc);

  const towerHeight = h(60);
  const towerHalfSpan = m(30.5);
  for (const side of [-1, 1]) {
    const tower = new THREE.Mesh(
      baseAtGround(new THREE.BoxGeometry(m(14), towerHeight, m(14)), towerHeight),
      material,
    );
    tower.position.set(side * towerHalfSpan, 0, 0);
    group.add(tower);

    const capHeight = h(12);
    const cap = new THREE.Mesh(baseAtGround(new THREE.ConeGeometry(m(10), capHeight, 4), capHeight), material);
    cap.position.set(side * towerHalfSpan, towerHeight, 0);
    group.add(cap);

    const walkway = new THREE.Mesh(new THREE.BoxGeometry(m(6), m(4), m(10)), accent);
    walkway.position.set(side * towerHalfSpan, h(40), 0);
    group.add(walkway);
  }

  const upperWalkway = new THREE.Mesh(new THREE.BoxGeometry(towerHalfSpan * 2, m(3), m(8)), material);
  upperWalkway.position.y = h(40);
  group.add(upperWalkway);

  const roadway = new THREE.Mesh(new THREE.BoxGeometry(towerHalfSpan * 2 + m(20), m(2), m(12)), material);
  roadway.position.y = m(3);
  group.add(roadway);

  const suspensionMaterial = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
  for (const zOffset of [-m(5), m(5)]) {
    for (const dir of [-1, 1]) {
      const start = new THREE.Vector3(dir * (towerHalfSpan + m(20)), m(4), zOffset);
      const mid = new THREE.Vector3(dir * towerHalfSpan * 0.5, m(2), zOffset);
      const end = new THREE.Vector3(0, m(4), zOffset);
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const tube = new THREE.TubeGeometry(curve, 12, m(0.4), 6, false);
      group.add(new THREE.Mesh(tube, suspensionMaterial));
    }
  }

  return group;
}

function buildBtTower(): THREE.Group {
  const group = new THREE.Group();
  const shaftHeight = h(160);
  const shaft = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(8), m(8), shaftHeight, 16), shaftHeight),
    new THREE.MeshLambertMaterial({ color: 0x3a4250 }),
  );
  group.add(shaft);

  const ringMaterial = new THREE.MeshLambertMaterial({ color: 0x4a5568 });
  for (const y of [100, 112, 124]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(m(11), m(11), h(4), 16), ringMaterial);
    ring.position.y = h(y);
    group.add(ring);
  }

  const mastHeight = h(17);
  const mast = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(1.2), m(1.2), mastHeight, 8), mastHeight),
    new THREE.MeshLambertMaterial({ color: 0x3a4250 }),
  );
  mast.position.y = shaftHeight;
  group.add(mast);

  const dotMaterial = emissiveMaterial(0xffffff);
  const dotCount = 12;
  const dotY = h(133);
  for (let i = 0; i < dotCount; i++) {
    const angle = (i / dotCount) * Math.PI * 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(m(0.7), 6, 6), dotMaterial);
    dot.position.set(Math.cos(angle) * m(11.5), dotY, Math.sin(angle) * m(11.5));
    group.add(dot);
  }

  return group;
}

function buildO2(): THREE.Group {
  const group = new THREE.Group();
  const radius = h(190);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
    new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }),
  );
  dome.scale.set(1, 0.35, 1);
  group.add(dome);

  const mastMaterial = emissiveMaterial(0xfbbf24);
  const mastCount = 12;
  const mastHeight = h(95);
  const baseRadius = m(160);
  for (let i = 0; i < mastCount; i++) {
    const angle = (i / mastCount) * Math.PI * 2;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(m(0.8), m(0.8), mastHeight, 6), mastMaterial);
    const baseX = Math.cos(angle) * baseRadius;
    const baseZ = Math.sin(angle) * baseRadius;
    mast.position.set(baseX * 0.6, mastHeight / 2, baseZ * 0.6);
    mast.lookAt(baseX, mastHeight * 0.9, baseZ);
    mast.rotateX(Math.PI / 2);
    group.add(mast);
  }

  return group;
}

function buildWalkie(): THREE.Group {
  const group = new THREE.Group();
  const height = h(160);
  const profile: THREE.Vector2[] = [];
  const segments = 20;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Flared "walkie-talkie" top: slim shaft, swelling in the upper third.
    const flare = t < 0.55 ? 0 : ((t - 0.55) / 0.45) ** 1.35;
    const r = m(14) + flare * m(16);
    profile.push(new THREE.Vector2(r, t * height));
  }
  const geometry = new THREE.LatheGeometry(profile, 24);
  const [material, edgeMaterial] = glassMaterial(0x1a2438, 0x8eb4ff);
  const mesh = new THREE.Mesh(geometry, material);
  addEdges(mesh, edgeMaterial);
  group.add(mesh);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(m(18), m(22), m(4), 24), emissiveMaterial(0x7dd3fc));
  crown.position.y = height - m(2);
  group.add(crown);
  return group;
}

function buildGrater(): THREE.Group {
  const group = new THREE.Group();
  const height = h(225);
  const depth = m(48);
  const width = m(52);
  // Right-triangular prism: vertical south face, sloped north face — the Cheesegrater wedge.
  const g = new THREE.BufferGeometry();
  const hw = width / 2;
  const hd = depth / 2;
  const p = [
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, // 0-3 base
    -hw, height, -hd, hw, height, -hd, // 4-5 top of vertical face
  ];
  const idx = [
    0, 1, 5, 0, 5, 4, // vertical
    1, 2, 5, 3, 0, 4, // sides (2=base front-right, sloped to 5; 3 to 4)
    3, 4, 5, 3, 5, 2, // sloped
    0, 3, 2, 0, 2, 1, // ground
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const [material, edgeMaterial] = glassMaterial(0x1c283c, 0xa8c4ff);
  const mesh = new THREE.Mesh(g, material);
  addEdges(mesh, edgeMaterial);
  group.add(mesh);
  group.rotation.y = 0.55;
  return group;
}

function buildCanadaSq(): THREE.Group {
  const group = new THREE.Group();
  const shaftHeight = h(200);
  const shaft = new THREE.Mesh(
    baseAtGround(new THREE.BoxGeometry(m(50), shaftHeight, m(50)), shaftHeight),
    new THREE.MeshLambertMaterial({ color: 0x1a2436, emissive: 0x3a5080, emissiveIntensity: 0.25 }),
  );
  group.add(shaft);
  const capHeight = h(28);
  const cap = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(36), capHeight, 4), capHeight),
    emissiveMaterial(0xdce7ff),
  );
  cap.position.y = shaftHeight;
  cap.rotation.y = Math.PI / 4;
  group.add(cap);
  return group;
}

function buildBattersea(): THREE.Group {
  const group = new THREE.Group();
  const brick = new THREE.MeshLambertMaterial({ color: 0x4a2c2c });
  const cream = new THREE.MeshLambertMaterial({ color: 0xd9cbb8 });
  const hallH = h(42);
  const hall = new THREE.Mesh(baseAtGround(new THREE.BoxGeometry(m(160), hallH, m(72)), hallH), brick);
  group.add(hall);
  const hall2 = new THREE.Mesh(baseAtGround(new THREE.BoxGeometry(m(70), hallH * 0.85, m(60)), hallH * 0.85), brick);
  hall2.position.set(m(20), 0, 0);
  group.add(hall2);
  const chimneyH = h(50);
  const spots: Array<[number, number]> = [
    [-55, -22],
    [55, -22],
    [-55, 22],
    [55, 22],
  ];
  for (const [x, z] of spots) {
    const chimney = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(5.5), m(6.5), chimneyH, 14), chimneyH),
      cream,
    );
    chimney.position.set(m(x), hallH, m(z));
    group.add(chimney);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(m(6.2), m(6.2), m(2), 14), cream);
    lip.position.set(m(x), hallH + chimneyH, m(z));
    group.add(lip);
  }
  group.rotation.y = 0.35;
  return group;
}

const BUILDERS: Record<LandmarkKind, () => THREE.Group> = {
  shard: buildShard,
  gherkin: buildGherkin,
  bigben: buildBigBen,
  eye: buildLondonEye,
  stpauls: buildStPauls,
  towerbridge: buildTowerBridge,
  bttower: buildBtTower,
  o2: buildO2,
  walkie: buildWalkie,
  grater: buildGrater,
  canadasq: buildCanadaSq,
  battersea: buildBattersea,
};

export function build(kind: LandmarkKind): THREE.Group {
  return BUILDERS[kind]();
}
