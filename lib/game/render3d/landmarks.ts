/**
 * RUNWAY — procedural landmark geometry.
 *
 * Each builder returns a THREE.Group anchored at the landmark's ground
 * point (0,0,0 in local space — the caller positions the group at
 * project(at)). Civic heights use HEIGHT_SCALE; skyscrapers use
 * TOWER_HEIGHT_SCALE so the skyline reads against the terrace grain.
 * Footprint/thickness stays at real-world scale.
 */

import * as THREE from 'three';
import { METERS_TO_WORLD } from '../geo';
import type { LandmarkKind } from '../geo';
import { HEIGHT_SCALE, TOWER_HEIGHT_SCALE } from './buildingStyle';

/** Name used to find the rotating wheel sub-group for the frame()-driven spin. */
export const EYE_WHEEL_NAME = 'eyeWheel';

function m(meters: number): number {
  return meters * METERS_TO_WORLD;
}

/**
 * Landmark bridge decks sit just above OSM carriageways (`ROAD_Y` = 0.14).
 * Using `m(7)` here used to put decks *below* the road ribbons, which read as
 * collapsed / fallen-off spans.
 */
export const LANDMARK_DECK_Y = 0.18;

function h(meters: number): number {
  return meters * METERS_TO_WORLD * HEIGHT_SCALE;
}
function ht(meters: number): number {
  return meters * METERS_TO_WORLD * TOWER_HEIGHT_SCALE;
}

/** Translate a THREE-centered geometry (spans -height/2..+height/2) so it sits base-at-zero. */
function baseAtGround<T extends THREE.BufferGeometry>(geometry: T, height: number): T {
  geometry.translate(0, height / 2, 0);
  return geometry;
}

function emissiveMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

const Y_UP = new THREE.Vector3(0, 1, 0);

/** Bake-safe structural member — LineSegments vanish at city scale; cylinders do not. */
function addCylinderBetween(
  group: THREE.Group,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-5) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), material);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  dir.normalize();
  if (dir.y < -0.999) mesh.rotation.x = Math.PI;
  else if (dir.y < 0.999) mesh.quaternion.setFromUnitVectors(Y_UP, dir);
  group.add(mesh);
}

function addBox(
  group: THREE.Group,
  w: number,
  height: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(baseAtGround(new THREE.BoxGeometry(w, height, d), height), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

type BridgeLamp =
  'westminster' | 'lambeth' | 'albert' | 'tower' | 'blackfriars' | 'stone' | 'white';

const LAMP_CAGE = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
const LAMP_GLOW = emissiveMaterial(0xffe7a8);
const LAMP_GOLD = emissiveMaterial(0xe8c878);

function addLanternHead(group: THREE.Group, x: number, y: number, z: number, scale = 1): void {
  const s = scale;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(m(0.42) * s, m(0.34) * s, m(1.15) * s, 8),
    LAMP_CAGE,
  );
  body.position.set(x, y, z);
  group.add(body);
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(m(0.34) * s, m(0.34) * s, m(0.95) * s, 8),
    LAMP_GLOW,
  );
  glass.position.set(x, y, z);
  group.add(glass);
}

/** Charles Barry triples on Westminster; ornate singles on the other Thames crossings. */
function addBridgeLamp(
  group: THREE.Group,
  x: number,
  deckY: number,
  z: number,
  kind: BridgeLamp,
  paint: THREE.Material,
): void {
  if (kind === 'westminster') {
    const postH = m(6.4);
    const post = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(0.22), m(0.3), postH, 8), postH),
      paint,
    );
    post.position.set(x, deckY, z);
    group.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(m(5.2), m(0.22), m(0.22)), paint);
    arm.position.set(x, deckY + postH, z);
    group.add(arm);
    for (const dx of [-m(2.1), 0, m(2.1)]) {
      addLanternHead(group, x + dx, deckY + postH + m(0.7), z, dx === 0 ? 1.45 : 1.2);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(m(0.2), 6, 6), LAMP_GOLD);
      fin.position.set(x + dx, deckY + postH + m(1.4), z);
      group.add(fin);
    }
    return;
  }
  const postH = kind === 'albert' ? m(5.4) : m(6.0);
  const post = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(0.18), m(0.24), postH, 8), postH),
    paint,
  );
  post.position.set(x, deckY, z);
  group.add(post);
  if (kind === 'lambeth') {
    addLanternHead(group, x, deckY + postH + m(0.65), z, 1.35);
    const pine = new THREE.Mesh(
      baseAtGround(new THREE.ConeGeometry(m(0.4), m(0.9), 8), m(0.9)),
      LAMP_GOLD,
    );
    pine.position.set(x, deckY + postH + m(1.2), z);
    group.add(pine);
    return;
  }
  if (kind === 'albert') {
    for (const dx of [-m(0.7), m(0.7)]) {
      addLanternHead(group, x + dx, deckY + postH + m(0.55), z, 1.15);
    }
    return;
  }
  if (kind === 'tower') {
    addLanternHead(group, x, deckY + postH + m(0.7), z, 1.55);
    const cap = new THREE.Mesh(
      baseAtGround(new THREE.ConeGeometry(m(0.7), m(1.1), 4), m(1.1)),
      LAMP_CAGE,
    );
    cap.position.set(x, deckY + postH + m(1.35), z);
    cap.rotation.y = Math.PI / 4;
    group.add(cap);
    return;
  }
  addLanternHead(group, x, deckY + postH + m(0.6), z, kind === 'blackfriars' ? 1.4 : 1.2);
  const fin = new THREE.Mesh(
    new THREE.SphereGeometry(m(0.2), 6, 6),
    kind === 'blackfriars' ? LAMP_GOLD : LAMP_GLOW,
  );
  fin.position.set(x, deckY + postH + m(1.25), z);
  group.add(fin);
}

function addBridgeLampRow(
  group: THREE.Group,
  length: number,
  width: number,
  deckY: number,
  kind: BridgeLamp,
  paint: THREE.Material,
  spacingM = 11,
  along: 'x' | 'z' = 'x',
): void {
  const n = Math.max(6, Math.round(length / METERS_TO_WORLD / spacingM));
  for (let i = 0; i <= n; i++) {
    const t = (i / n - 0.5) * length * 0.9;
    if (along === 'z') {
      for (const x of [-width / 2, width / 2]) addBridgeLamp(group, x, deckY, t, kind, paint);
    } else {
      for (const z of [-width / 2, width / 2]) addBridgeLamp(group, t, deckY, z, kind, paint);
    }
  }
}

function addPointedArchVoid(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  body.position.set(x, y + height / 2, z);
  group.add(body);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(width, width * 0.7, depth), material);
  peak.rotation.z = Math.PI / 4;
  peak.position.set(x, y + height, z);
  group.add(peak);
}

function buildShard(): THREE.Group {
  const group = new THREE.Group();
  const height = ht(310);
  const bodyH = height * 0.88;
  const R = m(36);
  const sx = 0.55;
  const plan: Array<readonly [number, number]> = [
    [0.22, 1],
    [0.74, 0.48],
    [1, 0.02],
    [0.62, -0.54],
    [-0.16, -1],
    [-0.7, -0.44],
    [-1, 0.05],
    [-0.56, 0.6],
  ];
  const apex = new THREE.Vector3(m(2.2), bodyH, m(-1.8));
  const basePts = plan.map(([x, z]) => new THREE.Vector3(x * R * sx, 0, z * R));
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = basePts[i];
    const b = basePts[(i + 1) % 8];
    const o = positions.length / 3;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, apex.x, apex.y, apex.z);
    indices.push(o, o + 1, o + 2);
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bodyGeo.setIndex(indices);
  bodyGeo.computeVertexNormals();
  group.add(new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xb0c4d4 })));

  const mullion = new THREE.MeshLambertMaterial({ color: 0xe4eef6 });
  for (const p of basePts) addCylinderBetween(group, p, apex, m(2.1), mullion);
  for (let f = 1; f <= 7; f++) {
    const t = f / 8;
    const ring = basePts.map(
      (p) =>
        new THREE.Vector3(
          THREE.MathUtils.lerp(p.x, apex.x, t),
          t * bodyH,
          THREE.MathUtils.lerp(p.z, apex.z, t),
        ),
    );
    for (let i = 0; i < 8; i++)
      addCylinderBetween(group, ring[i], ring[(i + 1) % 8], m(1.05), mullion);
  }

  const spireH = height - bodyH;
  const spire = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(0.35), m(1.8), spireH, 6), spireH),
    new THREE.MeshLambertMaterial({ color: 0xc8d4dc }),
  );
  spire.position.set(apex.x, bodyH, apex.z);
  group.add(spire);
  group.rotation.y = 0.38;
  return group;
}

function gherkinRadius(t: number, maxR: number): number {
  const peak = 0.38;
  if (t <= peak) {
    const u = t / peak;
    return maxR * (0.52 + 0.48 * Math.sin((u * Math.PI) / 2));
  }
  const u = (t - peak) / (1 - peak);
  return maxR * Math.max(0.07, Math.cos((u * Math.PI) / 2));
}

function buildGherkin(): THREE.Group {
  const group = new THREE.Group();
  const height = ht(180);
  const maxR = m(28);
  const profile: THREE.Vector2[] = [];
  const segments = 24;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    profile.push(new THREE.Vector2(gherkinRadius(t, maxR), t * height));
  }
  const glass = new THREE.MeshLambertMaterial({ color: 0x8ab0a8 });
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 32), glass));

  const steel = new THREE.MeshLambertMaterial({ color: 0x6a7e78 });
  const uSeg = 8;
  const vSeg = 5;
  const at = (u: number, v: number) => {
    const r = gherkinRadius(v, maxR);
    const a = u * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, v * height, Math.sin(a) * r);
  };
  for (let v = 0; v < vSeg; v++) {
    for (let u = 0; u < uSeg; u++) {
      addCylinderBetween(
        group,
        at(u / uSeg, v / vSeg),
        at((u + 1) / uSeg, (v + 1) / vSeg),
        m(1.35),
        steel,
      );
      addCylinderBetween(
        group,
        at((u + 1) / uSeg, v / vSeg),
        at(u / uSeg, (v + 1) / vSeg),
        m(1.35),
        steel,
      );
    }
  }
  return group;
}

function buildBigBen(): THREE.Group {
  const group = new THREE.Group();
  const limestone = new THREE.MeshLambertMaterial({ color: 0xd4c4a8 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3228 });
  const gold = emissiveMaterial(0xe8c878);
  const clockFace = emissiveMaterial(0xffe9a8);

  const shaftH = h(96);
  addBox(group, m(15), shaftH, m(15), limestone);
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    addBox(
      group,
      dx === 0 ? m(4.5) : m(1.2),
      h(9),
      dz === 0 ? m(4.5) : m(1.2),
      dark,
      dx * m(7.4),
      h(28),
      dz * m(7.4),
    );
    addBox(
      group,
      dx === 0 ? m(4.5) : m(1.2),
      h(9),
      dz === 0 ? m(4.5) : m(1.2),
      dark,
      dx * m(7.4),
      h(50),
      dz * m(7.4),
    );
  }

  const clockH = h(18);
  addBox(group, m(19), clockH, m(19), limestone, 0, shaftH, 0);
  const faceY = shaftH + clockH / 2;
  const offset = m(9.7);
  const faces: Array<[number, number, number, number]> = [
    [0, faceY, offset, 0],
    [offset, faceY, 0, Math.PI / 2],
    [0, faceY, -offset, Math.PI],
    [-offset, faceY, 0, -Math.PI / 2],
  ];
  for (const [x, y, z, rotY] of faces) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(m(9), m(9)), clockFace);
    face.position.set(x, y, z);
    face.rotation.y = rotY;
    group.add(face);
    const hour = new THREE.Mesh(new THREE.BoxGeometry(m(0.5), m(2.8), m(0.3)), dark);
    hour.position.set(x, y + m(0.6), z);
    hour.rotation.y = rotY;
    group.add(hour);
    const minute = new THREE.Mesh(new THREE.BoxGeometry(m(0.4), m(3.6), m(0.3)), dark);
    minute.position.set(x, y + m(0.2), z);
    minute.rotation.z = 0.9;
    minute.rotation.y = rotY;
    group.add(minute);
  }

  const pinH = h(10);
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const pin = new THREE.Mesh(
        baseAtGround(new THREE.CylinderGeometry(m(1.1), m(1.4), pinH, 6), pinH),
        limestone,
      );
      pin.position.set(dx * m(8), shaftH + clockH, dz * m(8));
      group.add(pin);
      const pinRoof = new THREE.Mesh(
        baseAtGround(new THREE.ConeGeometry(m(1.8), h(5), 4), h(5)),
        limestone,
      );
      pinRoof.position.set(dx * m(8), shaftH + clockH + pinH, dz * m(8));
      group.add(pinRoof);
    }
  }

  const spireH = h(28);
  const spire = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(10), spireH, 4), spireH),
    limestone,
  );
  spire.position.y = shaftH + clockH;
  spire.rotation.y = Math.PI / 4;
  group.add(spire);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(m(1.5), 8, 8), gold);
  finial.position.y = shaftH + clockH + spireH;
  group.add(finial);

  // Palace of Westminster — ~266 m river front south of Elizabeth Tower.
  const hallH = h(32);
  addBox(group, m(78), hallH, m(248), limestone, m(-32), 0, m(128));
  addBox(group, m(84), h(7), m(254), limestone, m(-32), hallH, m(128));
  for (let i = 0; i < 14; i++) {
    addBox(group, m(5), h(12), m(2.4), dark, m(10), h(10), m(24 + i * 16));
  }
  const vicH = h(102);
  addBox(group, m(24), vicH, m(24), limestone, m(-32), 0, m(250));
  const vicRoof = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(17), h(24), 4), h(24)),
    limestone,
  );
  vicRoof.position.set(m(-32), vicH, m(250));
  vicRoof.rotation.y = Math.PI / 4;
  group.add(vicRoof);
  const centralH = h(78);
  addBox(group, m(12), centralH * 0.45, m(12), limestone, m(-32), hallH, m(128));
  const centralRoof = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(10), h(20), 4), h(20)),
    limestone,
  );
  centralRoof.position.set(m(-32), hallH + centralH * 0.45, m(128));
  centralRoof.rotation.y = Math.PI / 4;
  group.add(centralRoof);
  return group;
}

function buildLondonEye(): THREE.Group {
  const group = new THREE.Group();
  const radius = h(67);
  const hubHeight = radius;
  const steel = new THREE.MeshLambertMaterial({ color: 0xc5d0dc });
  const spokeMat = new THREE.MeshLambertMaterial({ color: 0x9aabbd });
  const legMat = new THREE.MeshLambertMaterial({ color: 0xb0becb });
  const hubAt = new THREE.Vector3(0, hubHeight, 0);

  // Axle lives on the A-frame (not the spinning wheel) so the centre stays put.
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(m(4.4), m(4.4), m(24), 12), steel);
  axle.rotation.z = Math.PI / 2;
  axle.position.copy(hubAt);
  group.add(axle);
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(m(10), m(10), m(12), 16), steel);
  hubCap.rotation.z = Math.PI / 2;
  hubCap.position.copy(hubAt);
  group.add(hubCap);

  const wheel = new THREE.Group();
  wheel.name = EYE_WHEEL_NAME;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(radius, m(2.6), 8, 48), steel));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, m(1.15), 6, 40), spokeMat));
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2;
    const rim = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    addCylinderBetween(wheel, new THREE.Vector3(0, 0, 0), rim, m(0.7), spokeMat);
  }
  const podMat = emissiveMaterial(0xa8d8ea);
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2;
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(m(2.8), m(3.2), 4, 8), podMat);
    pod.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    wheel.add(pod);
  }
  // Postcard camera looks from the west (`look=eye`); disc in YZ faces ±X.
  wheel.position.copy(hubAt);
  wheel.rotation.y = Math.PI / 2;
  group.add(wheel);

  for (const side of [-1, 1]) {
    addCylinderBetween(group, new THREE.Vector3(-m(26), 0, side * m(22)), hubAt, m(3.8), legMat);
  }
  addCylinderBetween(
    group,
    new THREE.Vector3(-m(26), 0, -m(22)),
    new THREE.Vector3(-m(26), 0, m(22)),
    m(2.6),
    legMat,
  );
  addBox(group, m(32), m(5), m(52), legMat, -m(18), 0, 0);
  addBox(group, m(20), m(6), m(16), legMat, -m(14), 0, 0);
  return group;
}

function buildStPauls(): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xddd6c4 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a453c });
  const gold = emissiveMaterial(0xe8d48a);

  addBox(group, m(115), h(22), m(38), stone, 0, 0, 0);
  addBox(group, m(38), h(28), m(70), stone, 0, 0, 0);
  for (const side of [-1, 1]) {
    addBox(group, m(16), h(52), m(16), stone, side * m(48), 0, 0);
    const roof = new THREE.Mesh(
      baseAtGround(new THREE.ConeGeometry(m(11), h(14), 4), h(14)),
      stone,
    );
    roof.position.set(side * m(48), h(52), 0);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
  }

  const drumH = h(22);
  const drum = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(20), m(20), drumH, 24), drumH),
    stone,
  );
  drum.position.y = h(28);
  group.add(drum);
  const colMat = new THREE.MeshLambertMaterial({ color: 0xe8e2d2 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const col = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(1.1), m(1.1), drumH, 6), drumH),
      colMat,
    );
    col.position.set(Math.cos(a) * m(21.5), h(28), Math.sin(a) * m(21.5));
    group.add(col);
  }

  const domeR = m(24);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(domeR, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    stone,
  );
  dome.position.y = h(28) + drumH;
  group.add(dome);
  addBox(group, m(2.5), h(8), m(8), dark, 0, h(28) + drumH + m(6), domeR * 0.55);

  const lanternH = h(16);
  const lantern = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(4.2), m(4.8), lanternH, 12), lanternH),
    stone,
  );
  lantern.position.y = h(28) + drumH + domeR * 0.62;
  group.add(lantern);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(m(2.2), 8, 8), gold);
  ball.position.y = h(28) + drumH + domeR * 0.62 + lanternH;
  group.add(ball);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(m(0.7), m(7), m(0.7)), gold);
  crossV.position.y = h(28) + drumH + domeR * 0.62 + lanternH + m(5);
  group.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(m(4.5), m(0.7), m(0.7)), gold);
  crossH.position.y = h(28) + drumH + domeR * 0.62 + lanternH + m(4);
  group.add(crossH);
  group.rotation.y = 0.15;
  return group;
}

function addDeckSlab(
  group: THREE.Group,
  width: number,
  thick: number,
  length: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thick, length), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
}

function buildTowerBridge(): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 });
  const band = new THREE.MeshLambertMaterial({ color: 0xf4eee4 });
  const iron = new THREE.MeshLambertMaterial({ color: 0x2a5aa8 });
  const asphalt = new THREE.MeshLambertMaterial({ color: 0x5a5c60 });
  const voidMat = new THREE.MeshLambertMaterial({ color: 0x5a5048 });

  const towerHeight = h(65);
  const towerHalfSpan = m(42);
  const shaftW = m(16);
  const wallT = m(3.4);
  const openW = shaftW - wallT * 2;
  const deckY = LANDMARK_DECK_Y;
  const deckThick = m(2.6);
  const deckW = m(12.4);
  const archH = deckY + m(11);
  const walkY = towerHeight * 0.78;
  const approach = towerHalfSpan + m(100);

  for (const side of [-1, 1]) {
    const z = side * towerHalfSpan;
    addBox(group, wallT, archH, shaftW, stone, -shaftW / 2 + wallT / 2, 0, z);
    addBox(group, wallT, archH, shaftW, stone, shaftW / 2 - wallT / 2, 0, z);
    addBox(group, shaftW, towerHeight - archH, shaftW, stone, 0, archH, z);
    addBox(group, shaftW + m(0.6), m(1.1), shaftW + m(0.6), band, 0, h(18), z);
    addBox(group, shaftW + m(0.6), m(1.1), shaftW + m(0.6), band, 0, h(38), z);

    addPointedArchVoid(
      group,
      openW * 0.92,
      m(13),
      m(1.4),
      voidMat,
      0,
      deckY - m(2),
      z - shaftW / 2,
    );
    addPointedArchVoid(
      group,
      openW * 0.92,
      m(13),
      m(1.4),
      voidMat,
      0,
      deckY - m(2),
      z + shaftW / 2,
    );

    for (const xSign of [-1, 1]) {
      for (const wy of [h(28), h(40), h(52)]) {
        addPointedArchVoid(
          group,
          m(3.4),
          h(9),
          m(1.8),
          voidMat,
          xSign * (shaftW / 2 + m(0.15)),
          wy,
          z,
        );
      }
    }

    const gallery = new THREE.Mesh(
      new THREE.BoxGeometry(shaftW + m(2.4), m(3.2), shaftW + m(2.4)),
      iron,
    );
    gallery.position.set(0, walkY, z);
    group.add(gallery);
    const galleryLite = new THREE.Mesh(
      new THREE.BoxGeometry(shaftW + m(2.6), m(1.4), shaftW + m(2.6)),
      band,
    );
    galleryLite.position.set(0, walkY, z);
    group.add(galleryLite);

    const upperH = h(12);
    addBox(group, shaftW * 1.08, upperH, shaftW * 1.08, stone, 0, towerHeight, z);

    const roofH = h(34);
    const roof = new THREE.Mesh(
      baseAtGround(new THREE.ConeGeometry(m(10.5), roofH, 4), roofH),
      new THREE.MeshLambertMaterial({ color: 0xb8a090 }),
    );
    roof.position.set(0, towerHeight + upperH, z);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);

    const pinH = h(16);
    const pinOff = shaftW * 0.48;
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const px = dx * pinOff;
        const pz = z + dz * pinOff;
        const pin = new THREE.Mesh(
          baseAtGround(new THREE.CylinderGeometry(m(1.15), m(1.5), pinH, 8), pinH),
          stone,
        );
        pin.position.set(px, towerHeight + upperH * 0.15, pz);
        group.add(pin);
        const pinRoof = new THREE.Mesh(
          baseAtGround(new THREE.ConeGeometry(m(2.0), h(8), 4), h(8)),
          stone,
        );
        pinRoof.position.set(px, towerHeight + upperH * 0.15 + pinH, pz);
        pinRoof.rotation.y = Math.PI / 4;
        group.add(pinRoof);
      }
    }

    const abutH = Math.max(h(16), deckY + m(6));
    const abutZ = side * (towerHalfSpan + m(78));
    addBox(group, m(16), abutH, m(24), stone, 0, 0, abutZ);
    addPointedArchVoid(group, m(10), m(11), m(12), voidMat, 0, m(3), abutZ);
  }

  const walkLen = towerHalfSpan * 2 - shaftW * 0.35;
  for (const x of [-m(4.0), m(4.0)]) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(m(4.6), m(3.8), walkLen), iron);
    walk.position.set(x, walkY, 0);
    group.add(walk);
    const bays = 10;
    for (let i = 0; i < bays; i++) {
      const bz = ((i + 0.5) / bays - 0.5) * walkLen * 0.92;
      const lite = new THREE.Mesh(new THREE.BoxGeometry(m(4.85), m(1.7), m(3.4)), band);
      lite.position.set(x, walkY, bz);
      group.add(lite);
    }
  }
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    addCylinderBetween(
      group,
      new THREE.Vector3(-m(4.0), walkY - m(1.6), i * m(8)),
      new THREE.Vector3(m(4.0), walkY + m(1.6), i * m(8)),
      m(0.22),
      iron,
    );
  }

  const halfTower = shaftW / 2;
  const inner = towerHalfSpan - halfTower;
  const outer = towerHalfSpan + halfTower;
  addDeckSlab(group, deckW, deckThick, inner * 2, asphalt, 0, deckY, 0);
  for (const side of [-1, 1]) {
    const z0 = side * outer;
    const z1 = side * approach;
    const len = Math.abs(z1 - z0);
    addDeckSlab(group, deckW, deckThick, len, asphalt, 0, deckY, (z0 + z1) / 2);
    addDeckSlab(
      group,
      openW * 0.9,
      deckThick * 0.85,
      shaftW + m(0.6),
      asphalt,
      0,
      deckY,
      side * towerHalfSpan,
    );
  }

  for (const side of [-1, 1]) {
    const towerZ = side * towerHalfSpan;
    const abutmentZ = side * (towerHalfSpan + m(78));
    for (const x of [-m(5.4), m(5.4)]) {
      const start = new THREE.Vector3(x, walkY - m(2), towerZ);
      const end = new THREE.Vector3(x, deckY + m(2.5), abutmentZ);
      const mid = start.clone().lerp(end, 0.48);
      mid.y = deckY + m(8);
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, m(0.55), 6, false), iron));
      for (let k = 1; k <= 5; k++) {
        const p = curve.getPoint(k / 6);
        addCylinderBetween(group, p, new THREE.Vector3(p.x, deckY + m(1.2), p.z), m(0.12), iron);
      }
    }
  }

  addBridgeLampRow(group, approach * 2, deckW, deckY + m(1.4), 'tower', iron, 10, 'z');
  return group;
}

function buildBtTower(): THREE.Group {
  const group = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ color: 0xd0ccc4 });
  const band = new THREE.MeshLambertMaterial({ color: 0x3a424c });
  const shaftH = ht(155);
  const shaft = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(7.5), m(8.5), shaftH, 16), shaftH),
    concrete,
  );
  group.add(shaft);
  for (const y of [0.22, 0.38, 0.52, 0.66]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(m(8.2), m(8.2), ht(6), 16), band);
    ring.position.y = shaftH * y;
    group.add(ring);
  }
  const drumY = [108, 120, 132];
  for (let i = 0; i < drumY.length; i++) {
    const r = m(13.5 - i * 0.6);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ht(10), 20), band);
    drum.position.y = ht(drumY[i]);
    group.add(drum);
    const lip = new THREE.Mesh(
      new THREE.CylinderGeometry(r + m(1.2), r + m(1.2), ht(1.6), 20),
      concrete,
    );
    lip.position.y = ht(drumY[i]) + ht(5.2);
    group.add(lip);
  }
  const mastH = ht(28);
  const mast = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(0.9), m(2.2), mastH, 8), mastH),
    concrete,
  );
  mast.position.y = shaftH;
  group.add(mast);
  return group;
}

function buildO2(): THREE.Group {
  const group = new THREE.Group();
  const radius = m(185);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshLambertMaterial({ color: 0xd8dee6 }),
  );
  dome.scale.set(1, 0.32 * HEIGHT_SCALE, 1);
  group.add(dome);

  const yellow = emissiveMaterial(0xf5c542);
  const mastH = h(100);
  const baseR = m(155);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const baseX = Math.cos(angle) * baseR;
    const baseZ = Math.sin(angle) * baseR;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(m(1.4), m(1.8), mastH, 6), yellow);
    mast.position.set(baseX * 0.55, mastH / 2, baseZ * 0.55);
    mast.lookAt(baseX * 0.15, mastH * 0.92, baseZ * 0.15);
    mast.rotateX(Math.PI / 2);
    group.add(mast);
    addCylinderBetween(
      group,
      new THREE.Vector3(baseX * 0.15, mastH * 0.85, baseZ * 0.15),
      new THREE.Vector3(baseX * 0.72, m(8), baseZ * 0.72),
      m(0.45),
      yellow,
    );
  }
  return group;
}

function buildWalkie(): THREE.Group {
  const group = new THREE.Group();
  const height = ht(160);
  const glass = new THREE.MeshLambertMaterial({ color: 0x8fa0b0 });
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const flare = t0 < 0.42 ? t0 * 0.08 : ((t0 - 0.42) / 0.58) ** 1.55;
    const w = m(24) + flare * m(36);
    const d = m(18) + flare * m(18);
    const geo = new THREE.BoxGeometry(w, (t1 - t0) * height, d);
    geo.translate(0, ((t0 + t1) / 2) * height, 0);
    group.add(new THREE.Mesh(geo, glass));
  }
  addBox(group, m(58), m(4), m(34), emissiveMaterial(0xf0d090), 0, height - m(4), 0);
  group.rotation.y = 0.35;
  return group;
}

function buildGrater(): THREE.Group {
  const group = new THREE.Group();
  const height = ht(225);
  const depth = m(48);
  const width = m(52);
  const g = new THREE.BufferGeometry();
  const hw = width / 2;
  const hd = depth / 2;
  const p = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, -hw, height, -hd, hw, height, -hd];
  const idx = [0, 1, 5, 0, 5, 4, 1, 2, 5, 3, 0, 4, 3, 4, 5, 3, 5, 2, 0, 3, 2, 0, 2, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const glass = new THREE.MeshLambertMaterial({ color: 0x8aa0b0 });
  const steel = new THREE.MeshLambertMaterial({ color: 0xd0d8e0 });
  group.add(new THREE.Mesh(g, glass));
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    const y = t * height;
    const z1 = -hd;
    const z0 = THREE.MathUtils.lerp(hd, -hd, t);
    addCylinderBetween(
      group,
      new THREE.Vector3(-hw, y, z0),
      new THREE.Vector3(hw, y, z0),
      m(0.7),
      steel,
    );
    addCylinderBetween(
      group,
      new THREE.Vector3(-hw, y, z1),
      new THREE.Vector3(hw, y, z1),
      m(0.55),
      steel,
    );
  }
  group.rotation.y = 0.55;
  return group;
}

function buildCanadaSq(): THREE.Group {
  const group = new THREE.Group();
  const width = m(47);
  const shaftHeight = ht(190);
  const glass = new THREE.MeshLambertMaterial({ color: 0x8aa0b0 });
  const steel = new THREE.MeshLambertMaterial({ color: 0xd6dce4 });
  addBox(group, m(52), ht(8), m(52), steel);
  const shaft = new THREE.Mesh(
    baseAtGround(new THREE.BoxGeometry(width, shaftHeight, width), shaftHeight),
    glass,
  );
  shaft.position.y = ht(8);
  group.add(shaft);

  const hw = width / 2;
  const cols = 7;
  const rows = 40;
  for (let r = 1; r < rows; r++) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(width + m(0.5), m(0.7), width + m(0.5)),
      steel,
    );
    band.position.y = ht(8) + (r / rows) * shaftHeight;
    group.add(band);
  }
  for (let c = 0; c <= cols; c++) {
    const t = c / cols;
    const x = -hw + t * width;
    const z = -hw + t * width;
    for (const [px, pz, sx, sz] of [
      [x, hw + m(0.15), m(0.75), m(0.75)],
      [x, -hw - m(0.15), m(0.75), m(0.75)],
      [hw + m(0.15), z, m(0.75), m(0.75)],
      [-hw - m(0.15), z, m(0.75), m(0.75)],
    ] as const) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(sx, shaftHeight, sz), steel);
      fin.position.set(px, ht(8) + shaftHeight / 2, pz);
      group.add(fin);
    }
  }

  const capHeight = ht(45);
  const cap = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry((width / 2) * Math.SQRT2, capHeight, 4), capHeight),
    steel,
  );
  cap.position.y = ht(8) + shaftHeight;
  cap.rotation.y = Math.PI / 4;
  group.add(cap);

  const mastH = ht(14);
  const mast = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(0.6), m(1.2), mastH, 8), mastH),
    steel,
  );
  mast.position.y = ht(8) + shaftHeight + capHeight;
  group.add(mast);
  return group;
}

function buildBattersea(): THREE.Group {
  const group = new THREE.Group();
  const brick = new THREE.MeshLambertMaterial({ color: 0x8a3e36 });
  const cream = new THREE.MeshLambertMaterial({ color: 0xeadcc8 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c2018 });
  const hallH = h(44);
  addBox(group, m(168), hallH, m(78), brick);
  addBox(group, m(80), hallH * 0.82, m(62), brick, m(18), 0, 0);
  for (let i = 0; i < 8; i++) {
    addBox(group, m(8), h(16), m(2), dark, m(-70 + i * 20), h(12), m(40));
    addBox(group, m(8), h(16), m(2), dark, m(-70 + i * 20), h(12), m(-40));
  }
  const chimneyH = h(52);
  const spots: Array<[number, number]> = [
    [-58, -24],
    [58, -24],
    [-58, 24],
    [58, 24],
  ];
  for (const [x, z] of spots) {
    const chimney = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(5.8), m(7.2), chimneyH, 16), chimneyH),
      cream,
    );
    chimney.position.set(m(x), hallH, m(z));
    group.add(chimney);
    for (const t of [0.25, 0.5, 0.75]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(m(6.6), m(6.6), m(1.4), 16), cream);
      ring.position.set(m(x), hallH + chimneyH * t, m(z));
      group.add(ring);
    }
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(m(6.8), m(6.8), m(2.4), 16), cream);
    lip.position.set(m(x), hallH + chimneyH, m(z));
    group.add(lip);
  }
  group.rotation.y = 0.4;
  return group;
}

function buildBishop(): THREE.Group {
  const group = new THREE.Group();
  const height = ht(278);
  const glass = new THREE.MeshLambertMaterial({ color: 0x7a8a98 });
  const steel = new THREE.MeshLambertMaterial({ color: 0xc8d2dc });
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const taper = 1 - t0 * 0.28;
    const w = m(44) * taper;
    const d = m(32) * taper;
    const geo = new THREE.BoxGeometry(w, (t1 - t0) * height, d);
    geo.translate(0, ((t0 + t1) / 2) * height, 0);
    group.add(new THREE.Mesh(geo, glass));
  }
  addBox(group, m(16), m(10), m(12), steel, 0, height - m(6), 0);
  group.rotation.y = 0.2;
  return group;
}

function buildHeron(): THREE.Group {
  const group = new THREE.Group();
  const height = ht(230);
  const glass = new THREE.MeshLambertMaterial({ color: 0x7a8ea0 });
  addBox(group, m(34), height, m(26), glass);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(m(40), m(8), m(22)), glass);
  visor.position.set(0, height - m(4), m(8));
  visor.rotation.x = -0.45;
  group.add(visor);
  const mastH = ht(22);
  const mast = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(0.9), m(1.5), mastH, 8), mastH),
    glass,
  );
  mast.position.y = height;
  group.add(mast);
  group.rotation.y = 0.15;
  return group;
}

function buildTower42(): THREE.Group {
  const group = new THREE.Group();
  const height = ht(183);
  const glass = new THREE.MeshLambertMaterial({ color: 0x7a848c });
  const stone = new THREE.MeshLambertMaterial({ color: 0xc8bdb0 });
  addBox(group, m(16), height, m(16), stone);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
    const wing = new THREE.Mesh(
      baseAtGround(new THREE.BoxGeometry(m(30), height * 0.9, m(12)), height * 0.9),
      glass,
    );
    wing.position.set(Math.cos(a) * m(12), 0, Math.sin(a) * m(12));
    wing.rotation.y = a;
    group.add(wing);
  }
  const crown = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(9), m(14), ht(14), 8), ht(14)),
    stone,
  );
  crown.position.y = height * 0.9;
  group.add(crown);
  return group;
}

function buildAbbey(): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd8d0c0 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3c3830 });
  addBox(group, m(110), h(28), m(32), stone);
  addBox(group, m(36), h(36), m(36), stone, m(12), 0, 0);
  for (const side of [-1, 1]) {
    addBox(group, m(14), h(48), m(14), stone, m(-48), 0, side * m(10));
    const roof = new THREE.Mesh(
      baseAtGround(new THREE.ConeGeometry(m(10), h(16), 4), h(16)),
      stone,
    );
    roof.position.set(m(-48), h(48), side * m(10));
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
  }
  addBox(group, m(110), h(8), m(12), stone, 0, h(28), 0);
  for (let i = 0; i < 6; i++) {
    addBox(group, m(3), h(14), m(2), dark, m(-20 + i * 16), h(8), m(16.5));
  }
  const apse = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(16), m(16), h(26), 10), h(26)),
    stone,
  );
  apse.position.set(m(48), 0, 0);
  group.add(apse);
  group.rotation.y = 0.2;
  return group;
}

function buildOldStreet(): THREE.Group {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshLambertMaterial({ color: 0x3a3c42 });
  const paint = new THREE.MeshLambertMaterial({ color: 0xd8d0b8 });
  const grass = new THREE.MeshLambertMaterial({ color: 0x5a7a52 });
  const canopy = new THREE.MeshLambertMaterial({ color: 0xc8d0d6 });
  const r = m(48);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, m(9), 8, 32), asphalt);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = m(1.2);
  group.add(ring);
  const island = new THREE.Mesh(new THREE.CylinderGeometry(m(28), m(28), m(1.4), 24), grass);
  island.position.y = m(0.7);
  group.add(island);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(m(16), m(18), m(4.5), 16), canopy);
  lid.position.y = m(3.2);
  group.add(lid);

  const ads = [0xe23a2b, 0x1a6ad4, 0xf5c230, 0xf4f0e6, 0x2bb673, 0xf27830, 0x4a38c8, 0x1a1a1c];
  const hoardR = m(22);
  const hoardH = m(8);
  const frame = new THREE.Mesh(
    new THREE.CylinderGeometry(hoardR - m(0.4), hoardR - m(0.4), hoardH, 24),
    paint,
  );
  frame.position.y = m(1.4) + hoardH / 2;
  group.add(frame);
  for (let i = 0; i < ads.length; i++) {
    const a = ((i + 0.5) / ads.length) * Math.PI * 2;
    const w = ((2 * Math.PI * hoardR) / ads.length) * 0.92;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(w, hoardH - m(0.8), m(0.55)),
      new THREE.MeshLambertMaterial({ color: ads[i] }),
    );
    panel.position.set(Math.cos(a) * hoardR, m(1.4) + hoardH / 2, Math.sin(a) * hoardR);
    panel.rotation.y = -a + Math.PI / 2;
    group.add(panel);
    const copy = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.62, m(1.4), m(0.58)),
      new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? 0xf8f4ea : 0x111111 }),
    );
    copy.position.set(
      Math.cos(a) * (hoardR + m(0.15)),
      m(1.4) + hoardH * 0.62,
      Math.sin(a) * (hoardR + m(0.15)),
    );
    copy.rotation.y = -a + Math.PI / 2;
    group.add(copy);
  }
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(hoardR + m(0.5), hoardR + m(0.5), m(0.7), 24),
    paint,
  );
  lip.position.y = m(1.4) + hoardH + m(0.2);
  group.add(lip);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const post = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(0.4), m(0.5), m(6), 6), m(6)),
      paint,
    );
    post.position.set(Math.cos(a) * r, m(1.2), Math.sin(a) * r);
    group.add(post);
  }
  return group;
}

function buildBeamBridge(
  paint: number,
  pierColor: number,
  lengthM: number,
  pierCount: number,
  lamp: BridgeLamp,
): THREE.Group {
  const group = new THREE.Group();
  const length = m(lengthM);
  const width = m(22);
  const deckY = LANDMARK_DECK_Y;
  const paintMat = new THREE.MeshLambertMaterial({ color: paint });
  const pierMat = new THREE.MeshLambertMaterial({ color: pierColor });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, m(2.6), width), paintMat);
  deck.position.y = deckY;
  group.add(deck);
  for (const z of [-width / 2, width / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(length, m(1.7), m(0.8)), paintMat);
    wall.position.set(0, deckY + m(1.8), z);
    group.add(wall);
  }
  for (let i = 0; i < pierCount; i++) {
    const t = (i + 0.5) / pierCount - 0.5;
    addBox(group, m(10), deckY, m(16), pierMat, t * length * 0.78, 0, 0);
  }
  addBridgeLampRow(
    group,
    length,
    width,
    deckY + m(1.6),
    lamp,
    paintMat,
    lamp === 'westminster' ? 10 : 12,
  );
  return group;
}

function buildWestminsterBr(): THREE.Group {
  return buildBeamBridge(0x2f6b4f, 0xc4b9a6, 250, 7, 'westminster');
}
function buildLambethBr(): THREE.Group {
  return buildBeamBridge(0x9a2e32, 0xc4b9a6, 240, 5, 'lambeth');
}
function buildWaterlooBr(): THREE.Group {
  return buildBeamBridge(0xc5c0b4, 0xb0a898, 370, 5, 'stone');
}
function buildBlackfriarsBr(): THREE.Group {
  return buildBeamBridge(0x7a3030, 0xc9a24a, 280, 5, 'blackfriars');
}
function buildLondonBr(): THREE.Group {
  return buildBeamBridge(0x8a8680, 0x6e6a64, 262, 3, 'stone');
}

function buildMillennium(): THREE.Group {
  const group = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0xb8c0c8 });
  const length = m(325);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, m(1.4), m(8)), steel);
  deck.position.y = LANDMARK_DECK_Y;
  group.add(deck);
  for (const side of [-1, 1]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(m(1.6), m(3.2), m(18), 8), steel);
    pier.position.set(side * m(70), m(9), 0);
    pier.rotation.z = side * 0.55;
    group.add(pier);
    const yArm = new THREE.Mesh(new THREE.CylinderGeometry(m(1.1), m(1.1), m(22), 6), steel);
    yArm.position.set(side * m(70), m(22), 0);
    yArm.rotation.z = -side * 0.4;
    group.add(yArm);
    for (let i = -4; i <= 4; i++) {
      addCylinderBetween(
        group,
        new THREE.Vector3(side * m(70) - side * m(6), m(30), 0),
        new THREE.Vector3(side * m(20) + i * m(14), LANDMARK_DECK_Y + m(1), 0),
        m(0.28),
        steel,
      );
    }
  }
  return group;
}

function buildAlbertBr(): THREE.Group {
  const group = new THREE.Group();
  const pink = new THREE.MeshLambertMaterial({ color: 0xe8a0b4 });
  const green = new THREE.MeshLambertMaterial({ color: 0x5aa86a });
  const length = m(220);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, m(2.2), m(18)), pink);
  deck.position.y = LANDMARK_DECK_Y;
  group.add(deck);
  for (const side of [-1, 1]) {
    addBox(group, m(10), h(22), m(10), green, side * m(40), 0, 0);
    const spire = new THREE.Mesh(
      baseAtGround(new THREE.ConeGeometry(m(5), h(14), 4), h(14)),
      green,
    );
    spire.position.set(side * m(40), h(22), 0);
    group.add(spire);
    for (const z of [-m(6), m(6)]) {
      const start = new THREE.Vector3(side * m(40), h(20), z);
      const end = new THREE.Vector3(side * m(105), LANDMARK_DECK_Y + m(1), z);
      const mid = start.clone().lerp(end, 0.5);
      mid.y = m(16);
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(
            new THREE.QuadraticBezierCurve3(start, mid, end),
            12,
            m(0.45),
            5,
            false,
          ),
          pink,
        ),
      );
    }
  }
  addBridgeLampRow(group, length, m(18), LANDMARK_DECK_Y + m(1.2), 'albert', pink, 9);
  return group;
}

function buildHungerford(): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe8e6e0 });
  const rail = new THREE.MeshLambertMaterial({ color: 0x5a5048 });
  const length = m(340);
  const deckY = LANDMARK_DECK_Y;
  const railDeck = new THREE.Mesh(new THREE.BoxGeometry(length, m(2.8), m(12)), rail);
  railDeck.position.y = deckY;
  group.add(railDeck);
  for (const z of [-m(11), m(11)]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(length, m(1.8), m(6.5)), white);
    foot.position.set(0, deckY + m(1.2), z);
    group.add(foot);
  }
  for (let i = 0; i < 6; i++) {
    const x = (i / 5 - 0.5) * length * 0.8;
    addBox(group, m(7), deckY, m(14), rail, x, 0, 0);
  }
  addBridgeLampRow(group, length, m(28), deckY + m(1.6), 'white', white, 14);
  return group;
}

function buildTowerLondon(): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe6e0d0 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a342c });
  const keepH = h(27);
  addBox(group, m(36), keepH, m(32), stone);
  for (const [x, z] of [
    [-16, -14],
    [16, -14],
    [-16, 14],
    [16, 14],
  ] as const) {
    addBox(group, m(8), h(36), m(8), stone, m(x), 0, m(z));
    const turret = new THREE.Mesh(
      baseAtGround(new THREE.ConeGeometry(m(5.5), h(8), 8), h(8)),
      stone,
    );
    turret.position.set(m(x), h(36), m(z));
    group.add(turret);
  }
  for (let i = 0; i < 4; i++) {
    addBox(group, m(4), h(6), m(1.4), dark, m(-10 + i * 7), h(12), m(16.4));
  }
  addBox(group, m(90), h(10), m(70), stone, 0, 0, 0);
  group.rotation.y = 0.2;
  return group;
}

function buildBuckingham(): THREE.Group {
  const group = new THREE.Group();
  const cream = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 });
  const stone = new THREE.MeshLambertMaterial({ color: 0xd8d0c0 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3228 });
  const gold = emissiveMaterial(0xc45a3a);
  const lawn = new THREE.MeshLambertMaterial({ color: 0x5a7a52 });

  // Quadrangle ~110 m N–S (Mall façade) × ~100 m E–W, east front faces +X.
  const facade = m(110);
  const thick = m(22);
  const hallH = h(24);
  const eastH = h(28);
  addBox(group, thick, eastH, facade, cream, m(40), 0, 0);
  addBox(group, thick, hallH, facade * 0.92, cream, m(-40), 0, 0);
  addBox(group, m(82), hallH, thick, cream, 0, 0, m(-44));
  addBox(group, m(82), hallH, thick, cream, 0, 0, m(44));
  const court = new THREE.Mesh(new THREE.BoxGeometry(m(72), m(0.4), m(78)), lawn);
  court.position.set(0, m(0.2), 0);
  group.add(court);

  const portH = h(32);
  addBox(group, m(14), portH, m(36), stone, m(51), 0, 0);
  const ped = new THREE.Mesh(baseAtGround(new THREE.ConeGeometry(m(20), h(5), 3), h(5)), stone);
  ped.position.set(m(51), portH, 0);
  ped.rotation.y = Math.PI / 2;
  group.add(ped);
  for (let i = 0; i < 7; i++) {
    const z = (i - 3) * m(4.8);
    addBox(group, m(1.6), h(20), m(1.6), cream, m(58), h(4), z);
  }
  addBox(group, thick + m(2), h(4), facade, cream, m(40), eastH, 0);
  addBox(group, thick + m(4), eastH + h(3), m(16), cream, m(40), 0, m(-47));
  addBox(group, thick + m(4), eastH + h(3), m(16), cream, m(40), 0, m(47));
  for (const row of [h(8), h(16)]) {
    for (let i = 0; i < 11; i++) {
      addBox(group, m(0.9), h(5), m(3.4), dark, m(51.4), row, m(-50 + i * 10));
    }
  }

  const flag = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(0.35), m(0.35), h(16), 6), h(16)),
    dark,
  );
  flag.position.set(m(52), portH, 0);
  group.add(flag);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(m(4.2), m(2.2), m(0.15)), gold);
  cloth.position.set(m(54.5), portH + h(13), 0);
  group.add(cloth);
  return group;
}

function buildMonument(): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd8d0c0 });
  const gold = emissiveMaterial(0xe8c45a);
  addBox(group, m(12), h(8), m(12), stone);
  const colH = h(55);
  const col = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(2.4), m(2.8), colH, 16), colH),
    stone,
  );
  col.position.y = h(8);
  group.add(col);
  const urn = new THREE.Mesh(new THREE.SphereGeometry(m(2.6), 10, 8), gold);
  urn.position.y = h(8) + colH + m(2);
  group.add(urn);
  const flame = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(1.8), m(4.5), 8), m(4.5)),
    gold,
  );
  flame.position.y = h(8) + colH + m(4);
  group.add(flame);
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
  bishop: buildBishop,
  heron: buildHeron,
  tower42: buildTower42,
  abbey: buildAbbey,
  oldstreet: buildOldStreet,
  westminsterbr: buildWestminsterBr,
  lambethbr: buildLambethBr,
  waterloobr: buildWaterlooBr,
  blackfriarsbr: buildBlackfriarsBr,
  londonbr: buildLondonBr,
  millennium: buildMillennium,
  albertbr: buildAlbertBr,
  hungerford: buildHungerford,
  towerlondon: buildTowerLondon,
  buckingham: buildBuckingham,
  monument: buildMonument,
};

export function build(kind: LandmarkKind): THREE.Group {
  return BUILDERS[kind]();
}
