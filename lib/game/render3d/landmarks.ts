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
import { PARK_Y } from './cityBuilder';
import { ASPHALT } from './palette';

/** Name used to find the rotating wheel sub-group for the frame()-driven spin. */
export const EYE_WHEEL_NAME = 'eyeWheel';

function m(meters: number): number {
  return meters * METERS_TO_WORLD;
}

/**
 * Piers sit in the channel under the OSM asphalt (`ROAD_Y` = 0.14). Taller
 * boxes read as a brown/tan deck from isometric height and hide the road.
 */
export const LANDMARK_DECK_Y = 0.18;
const PIER_H = 0.12;

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

/** Sagging iron chain — short cylinders, never a detached TubeGeometry ribbon. */
function addCatenary(
  group: THREE.Group,
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  radius: number,
  material: THREE.Material,
  segs = 8,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [a.clone()];
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    addCylinderBetween(group, pts[i - 1]!, p, radius, material);
    pts.push(p);
  }
  return pts;
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

/** Triangular gable facing +X. A ConeGeometry reads as a nub on the Mall. */
function addGablePediment(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const hw = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(0, height);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.name = 'pediment';
  group.add(mesh);
  return mesh;
}

/** Kansas cathedral language: glowing recessed ridges, not textured albedo. */
function glowMat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

function glassPane(color = 0x6a8aa0): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, fog: true });
}

/** Grid of blue-tinted rectangles on an axis-aligned façade. */
function addWindowGrid(
  group: THREE.Group,
  width: number,
  height: number,
  cols: number,
  rows: number,
  ox: number,
  y0: number,
  oz: number,
  facing: 'x' | 'z',
  color = 0x6a8aa0,
): void {
  const glass = glassPane(color);
  const paneW = (width / cols) * 0.52;
  const paneH = (height / rows) * 0.55;
  const thick = m(0.32);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = ((c + 0.5) / cols - 0.5) * width;
      const y = y0 + ((r + 0.5) / rows) * height - paneH / 2;
      if (facing === 'z') addBox(group, paneW, paneH, thick, glass, ox + u, y, oz);
      else addBox(group, thick, paneH, paneW, glass, ox, y, oz + u);
    }
  }
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
  group.add(new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0x3d5668 })));

  const mullion = glowMat(0xf4f8fc);
  for (const p of basePts) addCylinderBetween(group, p, apex, m(2.1), mullion);
  for (let f = 1; f <= 10; f++) {
    const t = f / 11;
    const ring = basePts.map(
      (p) =>
        new THREE.Vector3(
          THREE.MathUtils.lerp(p.x, apex.x, t),
          t * bodyH,
          THREE.MathUtils.lerp(p.z, apex.z, t),
        ),
    );
    for (let i = 0; i < 8; i++)
      addCylinderBetween(group, ring[i]!, ring[(i + 1) % 8]!, m(0.85), mullion);
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
  const maxR = m(32);
  const profile: THREE.Vector2[] = [];
  const segments = 24;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    profile.push(new THREE.Vector2(gherkinRadius(t, maxR), t * height));
  }
  const glass = new THREE.MeshLambertMaterial({ color: 0x7a9aa8 });
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 32), glass));

  const steel = glowMat(0xd0e0dc);
  const pane = glassPane(0x4a7080);
  const uSeg = 8;
  const vSeg = 6;
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
        m(1.15),
        steel,
      );
      addCylinderBetween(
        group,
        at((u + 1) / uSeg, v / vSeg),
        at(u / uSeg, (v + 1) / vSeg),
        m(1.15),
        steel,
      );
      const p = at((u + 0.5) / uSeg, (v + 0.45) / vSeg);
      const diamond = new THREE.Mesh(new THREE.PlaneGeometry(m(7.2), m(11)), pane);
      diamond.position.set(p.x * 1.02, p.y, p.z * 1.02);
      diamond.lookAt(p.x * 2, p.y, p.z * 2);
      group.add(diamond);
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
  const steel = new THREE.MeshBasicMaterial({ color: 0xc5d0dc, fog: true });
  const spokeMat = new THREE.MeshBasicMaterial({ color: 0x9aabbd, fog: true });
  const legMat = new THREE.MeshBasicMaterial({ color: 0xb0becb, fog: true });
  const hubAt = new THREE.Vector3(0, hubHeight, 0);

  const axle = new THREE.Mesh(new THREE.CylinderGeometry(m(4.4), m(4.4), m(24), 8), steel);
  axle.rotation.z = Math.PI / 2;
  axle.position.copy(hubAt);
  group.add(axle);
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(m(10), m(10), m(12), 10), steel);
  hubCap.rotation.z = Math.PI / 2;
  hubCap.position.copy(hubAt);
  group.add(hubCap);

  const wheel = new THREE.Group();
  wheel.name = EYE_WHEEL_NAME;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(radius, m(2.6), 5, 20), steel));
  const pods = 16;
  for (let i = 0; i < pods; i++) {
    const angle = (i / pods) * Math.PI * 2;
    const rim = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    addCylinderBetween(wheel, new THREE.Vector3(0, 0, 0), rim, m(0.85), spokeMat);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(m(5.2), m(4.4), m(3.6)), glowMat(0xa8d8ea));
    pod.position.copy(rim);
    wheel.add(pod);
  }
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
  addWindowGrid(group, m(96), h(14), 12, 2, 0, h(4), m(19.2), 'z', 0x6a8aa0);
  addWindowGrid(group, m(96), h(14), 12, 2, 0, h(4), -m(19.2), 'z', 0x6a8aa0);
  addWindowGrid(group, m(56), h(16), 6, 2, m(19.2), h(6), 0, 'x', 0x6a8aa0);
  addWindowGrid(group, m(56), h(16), 6, 2, -m(19.2), h(6), 0, 'x', 0x6a8aa0);
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
  const ridge = glowMat(0xf4eee0);
  const domeY = h(28) + drumH;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    addCylinderBetween(
      group,
      new THREE.Vector3(Math.cos(a) * domeR, domeY, Math.sin(a) * domeR),
      new THREE.Vector3(0, domeY + domeR, 0),
      m(0.55),
      ridge,
    );
  }
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

/** Ridge along Z, gables facing ±Z (the portal faces). */
function addRidgeRoofZ(
  group: THREE.Group,
  width: number,
  rise: number,
  depth: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const hw = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(0, rise);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.name = 'tb-roof';
  group.add(mesh);
  return mesh;
}

function buildTowerBridge(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'towerbridge';
  const stone = new THREE.MeshLambertMaterial({ color: 0xe6d9c6 });
  const band = new THREE.MeshLambertMaterial({ color: 0xf2ebe0 });
  const iron = new THREE.MeshBasicMaterial({ color: 0x3c4654, fog: true });
  const chainMat = new THREE.MeshBasicMaterial({ color: 0x243040, fog: true });
  const asphalt = new THREE.MeshBasicMaterial({ color: ASPHALT, fog: true });
  const mark = new THREE.MeshBasicMaterial({ color: 0xd8dce0, fog: true });
  const slate = new THREE.MeshLambertMaterial({ color: 0x5c6570 });

  const towerH = h(56);
  const towerZ = m(44);
  const openingW = m(24);
  const legW = m(8);
  const legD = m(11);
  const legX = openingW / 2 + legW / 2;
  const deckY = LANDMARK_DECK_Y;
  const deckW = m(11);
  const deckLen = m(420);
  const deckH = m(1.8);
  const voidH = m(22);
  const archBaseY = deckY + m(14);
  const archPeakY = deckY + voidH + m(10);
  const walkBot = deckY + m(26);
  const walkH = m(3.2);
  const walkW = m(3.8);
  const walkX = m(5.0);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, deckH, deckLen), asphalt);
  deck.name = 'deck';
  deck.position.set(0, deckY - deckH / 2, 0);
  group.add(deck);
  const dashH = m(0.1);
  for (let i = -18; i <= 18; i++) {
    if (i % 2 === 0) continue;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(m(0.55), dashH, m(7)), mark);
    dash.position.set(0, deckY + dashH / 2, i * m(11));
    group.add(dash);
  }

  for (const side of [-1, 1]) {
    const z = side * towerZ;
    const west = addBox(group, legW, towerH, legD, stone, -legX, 0, z);
    const east = addBox(group, legW, towerH, legD, stone, legX, 0, z);
    if (side === 1) {
      west.name = 'tb-leg';
      east.name = 'tb-leg-e';
    }

    for (const zFace of [z - legD / 2, z + legD / 2]) {
      addBox(group, legW + m(0.5), m(1.3), m(0.8), band, -legX, walkBot - m(1.1), zFace);
      addBox(group, legW + m(0.5), m(1.3), m(0.8), band, legX, walkBot - m(1.1), zFace);
      const peak = new THREE.Vector3(0, archPeakY, zFace);
      const left = new THREE.Vector3(-openingW / 2, archBaseY, zFace);
      const right = new THREE.Vector3(openingW / 2, archBaseY, zFace);
      addCylinderBetween(group, left, peak, m(2.1), stone);
      addCylinderBetween(group, right, peak, m(2.1), stone);
      if (side === 1 && zFace === z + legD / 2) {
        const portal = addBox(group, m(2.2), m(2.2), m(2.4), stone, 0, archPeakY - m(1.1), zFace);
        portal.name = 'portal';
      }
    }

    addRidgeRoofZ(group, openingW + legW * 2 + m(1.2), m(16), legD + m(1.6), slate, 0, towerH, z);

    for (const xSign of [-1, 1]) {
      const px = xSign * (openingW / 2 + legW * 0.12);
      addBox(group, m(2.2), h(7), m(2.2), stone, px, towerH, z);
      addBox(group, m(1.5), h(3.2), m(1.5), slate, px, towerH + h(7), z);
    }

    const chainZ = z + side * (legD / 2 + m(0.35));
    for (const x of [-walkX, walkX]) {
      const room = addBox(group, m(2.6), m(3.6), m(2.6), iron, x, walkBot, chainZ);
      if (side === 1 && x > 0) room.name = 'chain';
      const start = new THREE.Vector3(x, walkBot + m(1.8), chainZ);
      const end = new THREE.Vector3(x, deckY + m(0.6), side * m(120));
      const pts = addCatenary(group, start, end, m(7), m(0.45), chainMat, 7);
      for (let i = 1; i < pts.length - 1; i += 2) {
        const p = pts[i]!;
        addCylinderBetween(group, p, new THREE.Vector3(x, deckY + m(0.35), p.z), m(0.22), chainMat);
      }
    }
  }

  const walkLen = towerZ * 2 + legD * 0.55;
  for (const x of [-walkX, walkX]) {
    const walk = addBox(group, walkW, walkH, walkLen, iron, x, walkBot, 0);
    if (x > 0) walk.name = 'walkway';
  }

  const abutmentZ = m(125);
  for (const side of [-1, 1]) {
    const z = side * abutmentZ;
    const abut = addBox(group, m(22), h(9), m(16), stone, 0, 0, z);
    if (side === 1) abut.name = 'abutment';
    const apron = new THREE.Mesh(new THREE.BoxGeometry(m(16), deckH, m(48)), asphalt);
    apron.position.set(0, deckY - deckH / 2, z);
    if (side === 1) apron.name = 'apron';
    group.add(apron);
  }

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
  const wall = new THREE.MeshBasicMaterial({ color: 0xd8d4cc, fog: true });
  const win = new THREE.MeshBasicMaterial({ color: 0x5a7080, fog: true });
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const flare = t0 < 0.42 ? t0 * 0.08 : ((t0 - 0.42) / 0.58) ** 1.55;
    const w = m(24) + flare * m(36);
    const d = m(18) + flare * m(18);
    const geo = new THREE.BoxGeometry(w, (t1 - t0) * height, d);
    geo.translate(0, ((t0 + t1) / 2) * height, 0);
    group.add(new THREE.Mesh(geo, i % 2 === 0 ? wall : win));
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
  const glass = new THREE.MeshBasicMaterial({ color: 0x5a7388, fog: true });
  const steel = new THREE.MeshBasicMaterial({ color: 0xd8e0e8, fog: true });
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
  const glass = new THREE.MeshBasicMaterial({ color: 0x8aa0b0, fog: true });
  const steel = new THREE.MeshBasicMaterial({ color: 0xd6dce4, fog: true });
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

  const capHeight = ht(72);
  const capMat = new THREE.MeshBasicMaterial({ color: 0xf4f8fc, fog: true });
  const cap = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry((width / 2) * Math.SQRT2, capHeight, 4), capHeight),
    capMat,
  );
  cap.position.y = ht(8) + shaftHeight;
  cap.rotation.y = Math.PI / 4;
  cap.name = 'canadasq-pyramid';
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
  const glass = new THREE.MeshBasicMaterial({ color: 0x7a848c, fog: true });
  const stone = new THREE.MeshBasicMaterial({ color: 0xc8bdb0, fog: true });
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

function buildBeamBridge(pierColor: number, pierCount: number): THREE.Group {
  const group = new THREE.Group();
  const pierMat = new THREE.MeshLambertMaterial({ color: pierColor });
  const spread = m(170);
  for (let i = 0; i < pierCount; i++) {
    const t = (i + 0.5) / pierCount - 0.5;
    addBox(group, m(5), PIER_H, m(7), pierMat, t * spread, 0, 0);
  }
  return group;
}

function buildWestminsterBr(): THREE.Group {
  return buildBeamBridge(0xc4b9a6, 7);
}
function buildLambethBr(): THREE.Group {
  return buildBeamBridge(0xc4b9a6, 5);
}
function buildWaterlooBr(): THREE.Group {
  return buildBeamBridge(0xb0a898, 5);
}
function buildBlackfriarsBr(): THREE.Group {
  return buildBeamBridge(0xc9a24a, 5);
}
function buildLondonBr(): THREE.Group {
  return buildBeamBridge(0x6e6a64, 3);
}

function buildMillennium(): THREE.Group {
  const group = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0xb8c0c8 });
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
      const end = new THREE.Vector3(side * m(80), LANDMARK_DECK_Y + m(1), z);
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
  return group;
}

function buildHungerford(): THREE.Group {
  const group = new THREE.Group();
  const rail = new THREE.MeshLambertMaterial({ color: 0x5a5048 });
  const spread = m(180);
  for (let i = 0; i < 6; i++) {
    const x = (i / 5 - 0.5) * spread;
    addBox(group, m(5), PIER_H, m(7), rail, x, 0, 0);
  }
  return group;
}

function addCurtain(
  group: THREE.Group,
  innerW: number,
  innerD: number,
  thick: number,
  height: number,
  mat: THREE.Material,
  name: string,
): void {
  const wall = new THREE.Group();
  wall.name = name;
  addBox(wall, innerW + thick * 2, height, thick, mat, 0, 0, -(innerD / 2 + thick / 2));
  addBox(wall, innerW + thick * 2, height, thick, mat, 0, 0, innerD / 2 + thick / 2);
  addBox(wall, thick, height, innerD, mat, -(innerW / 2 + thick / 2), 0, 0);
  addBox(wall, thick, height, innerD, mat, innerW / 2 + thick / 2, 0, 0);
  group.add(wall);
}

function addMerlons(
  group: THREE.Group,
  innerW: number,
  innerD: number,
  thick: number,
  y: number,
  mat: THREE.Material,
  step: number,
): void {
  const outerW = innerW + thick * 2;
  const outerD = innerD + thick * 2;
  const hw = outerW / 2;
  const hd = outerD / 2;
  const merlon = m(2.6);
  const merlonH = h(3.4);
  for (const z of [-hd, hd]) {
    for (let x = -hw + step; x < hw - merlon; x += step) {
      addBox(group, merlon, merlonH, thick * 0.7, mat, x, y, z);
    }
  }
  for (const x of [-hw, hw]) {
    for (let z = -hd + step; z < hd - merlon; z += step) {
      addBox(group, thick * 0.7, merlonH, merlon, mat, x, y, z);
    }
  }
}

function addMuralTower(
  group: THREE.Group,
  x: number,
  z: number,
  r: number,
  height: number,
  stone: THREE.Material,
  roof: THREE.Material,
  square: boolean,
): void {
  if (square) {
    addBox(group, r * 1.7, height, r * 1.7, stone, x, 0, z);
  } else {
    const drum = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(r, r * 1.08, height, 10), height),
      stone,
    );
    drum.position.set(x, 0, z);
    group.add(drum);
  }
  const coneH = height * 0.28;
  const cone = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(r * 1.15, coneH, 8), coneH),
    roof,
  );
  cone.position.set(x, height, z);
  group.add(cone);
}

function buildTowerLondon(): THREE.Group {
  const group = new THREE.Group();
  const keep = new THREE.MeshBasicMaterial({ color: 0xf2e8d6, fog: true });
  const wall = new THREE.MeshBasicMaterial({ color: 0xc4b8a4, fog: true });
  const course = new THREE.MeshBasicMaterial({ color: 0x8e8474, fog: true });
  const dark = new THREE.MeshBasicMaterial({ color: 0x3a342c, fog: true });
  const roof = new THREE.MeshBasicMaterial({ color: 0x6a5848, fog: true });
  const court = new THREE.MeshBasicMaterial({ color: 0xa89e8c, fog: true });

  const outerW = m(118);
  const outerD = m(96);
  const outerThick = m(10);
  const outerH = h(22);
  const innerW = m(62);
  const innerD = m(54);
  const innerThick = m(7);
  const innerH = h(24);

  const cobbles = new THREE.Mesh(
    new THREE.BoxGeometry(outerW + outerThick * 2 + m(36), m(0.5), outerD + outerThick * 2 + m(36)),
    court,
  );
  cobbles.position.y = m(0.24);
  cobbles.name = 'ward-court';
  group.add(cobbles);

  addCurtain(group, outerW, outerD, outerThick, outerH, wall, 'outer-curtain');
  addMerlons(group, outerW, outerD, outerThick, outerH, wall, m(6.5));
  addBox(
    group,
    outerW + outerThick * 2 + m(0.6),
    m(1.4),
    m(1.2),
    course,
    0,
    outerH * 0.55,
    -(outerD / 2 + outerThick / 2),
  );
  addBox(
    group,
    outerW + outerThick * 2 + m(0.6),
    m(1.4),
    m(1.2),
    course,
    0,
    outerH * 0.55,
    outerD / 2 + outerThick / 2,
  );

  const inner = new THREE.Group();
  inner.position.z = m(-4);
  addCurtain(inner, innerW, innerD, innerThick, innerH, wall, 'inner-curtain');
  addMerlons(inner, innerW, innerD, innerThick, innerH, wall, m(6));
  group.add(inner);

  const keepG = new THREE.Group();
  keepG.name = 'white-tower';
  const keepW = m(46);
  const keepD = m(46);
  const keepH = h(40);
  addBox(keepG, keepW, keepH, keepD, keep);
  addBox(keepG, keepW + m(1.2), m(1.6), keepD + m(1.2), course, 0, keepH * 0.38, 0);
  addBox(keepG, keepW + m(1.2), m(1.6), keepD + m(1.2), course, 0, keepH * 0.68, 0);
  for (let i = 0; i < 4; i++) {
    addBox(keepG, m(5.2), h(8), m(2.0), dark, m(-15 + i * 10), h(16), keepD / 2 + m(0.3));
    addBox(keepG, m(5.2), h(8), m(2.0), dark, m(-15 + i * 10), h(16), -(keepD / 2 + m(0.3)));
    addBox(keepG, m(2.0), h(8), m(5.2), dark, keepW / 2 + m(0.3), h(16), m(-15 + i * 10));
    addBox(keepG, m(2.0), h(8), m(5.2), dark, -(keepW / 2 + m(0.3)), h(16), m(-15 + i * 10));
  }

  const turW = m(16);
  const turH = keepH + m(10);
  const corners: Array<[number, number, boolean]> = [
    [-keepW / 2, -keepD / 2, false],
    [keepW / 2, -keepD / 2, true],
    [-keepW / 2, keepD / 2, false],
    [keepW / 2, keepD / 2, false],
  ];
  for (const [x, z, square] of corners) {
    addBox(keepG, turW, turH, turW, keep, x, 0, z);
    if (square) {
      const capH = m(12);
      addBox(keepG, turW * 0.92, capH, turW * 0.92, keep, x, turH, z);
      const py = capH * 0.85;
      const pyramid = new THREE.Mesh(
        baseAtGround(new THREE.ConeGeometry(turW * 0.72, py, 4), py),
        roof,
      );
      pyramid.position.set(x, turH + capH, z);
      pyramid.rotation.y = Math.PI / 4;
      keepG.add(pyramid);
    } else {
      const drumH = m(10);
      const drum = new THREE.Mesh(
        baseAtGround(new THREE.CylinderGeometry(turW * 0.42, turW * 0.46, drumH, 10), drumH),
        keep,
      );
      drum.position.set(x, turH, z);
      keepG.add(drum);
      const coneH = m(11);
      const cone = new THREE.Mesh(
        baseAtGround(new THREE.ConeGeometry(turW * 0.5, coneH, 8), coneH),
        roof,
      );
      cone.position.set(x, turH + drumH, z);
      keepG.add(cone);
    }
  }
  keepG.position.set(0, 0, m(-4));
  group.add(keepG);

  addBox(group, m(28), h(14), m(12), wall, m(-8), 0, m(18));
  addBox(group, m(10), h(18), m(10), wall, m(10), 0, m(18));
  const chapelRoofH = h(8);
  const chapelRoof = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(7), chapelRoofH, 4), chapelRoofH),
    roof,
  );
  chapelRoof.position.set(m(10), h(18), m(18));
  chapelRoof.rotation.y = Math.PI / 4;
  group.add(chapelRoof);

  const outerCorners: Array<[number, number]> = [
    [-(outerW / 2 + outerThick), -(outerD / 2 + outerThick)],
    [outerW / 2 + outerThick, -(outerD / 2 + outerThick)],
    [-(outerW / 2 + outerThick), outerD / 2 + outerThick],
    [outerW / 2 + outerThick, outerD / 2 + outerThick],
  ];
  for (const [x, z] of outerCorners) {
    addMuralTower(group, x, z, m(13), outerH + m(8), wall, roof, false);
  }
  addMuralTower(group, 0, -(outerD / 2 + outerThick), m(12), outerH + m(6), wall, roof, false);
  addMuralTower(group, 0, outerD / 2 + outerThick, m(12), outerH + m(6), wall, roof, false);
  addMuralTower(group, -(outerW / 2 + outerThick), 0, m(12), outerH + m(6), wall, roof, false);
  addMuralTower(group, outerW / 2 + outerThick, 0, m(12), outerH + m(6), wall, roof, false);

  const innerCorners: Array<[number, number]> = [
    [-(innerW / 2 + innerThick), -(innerD / 2 + innerThick) - m(4)],
    [innerW / 2 + innerThick, -(innerD / 2 + innerThick) - m(4)],
    [-(innerW / 2 + innerThick), innerD / 2 + innerThick - m(4)],
    [innerW / 2 + innerThick, innerD / 2 + innerThick - m(4)],
  ];
  for (const [x, z] of innerCorners) {
    addMuralTower(group, x, z, m(10), innerH + m(6), wall, roof, false);
  }

  group.rotation.y = 0.18;
  return group;
}

function addLawn(
  group: THREE.Group,
  w: number,
  d: number,
  x: number,
  z: number,
  color: number,
): THREE.Mesh {
  // Match cityBuilder PARK_Y so this carpet joins OSM Green Park.
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.02, d),
    new THREE.MeshBasicMaterial({
      color,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.position.set(x, PARK_Y, z);
  mesh.name = 'lawn';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  group.add(mesh);
  return mesh;
}

function buildBuckingham(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'buckingham';
  const portland = new THREE.MeshBasicMaterial({ color: 0xeee4d4, fog: true });
  const cream = new THREE.MeshBasicMaterial({ color: 0xe2d4bc, fog: true });
  const rust = new THREE.MeshBasicMaterial({ color: 0xd0c4ae, fog: true });
  const slate = new THREE.MeshBasicMaterial({ color: 0x5a6270, fog: true });
  const dark = new THREE.MeshBasicMaterial({ color: 0x3a3228, fog: true });
  const gold = emissiveMaterial(0xc45a3a);

  // West private garden + north apron toward Green Park. The east Mall
  // parade is gravel in OSM; without these plates look=buckingham is dirt.
  addLawn(group, m(150), m(120), m(-95), m(-10), 0x6ea84c);
  addLawn(group, m(90), m(70), m(-40), m(-20), 0x5a9340);
  addLawn(group, m(110), m(85), m(8), m(-95), 0x6ea84c);
  addLawn(group, m(70), m(55), m(48), m(-70), 0x88bf5e);

  // Solid body. Four wings around a hole is the courtyard doughnut in the still.
  const ns = m(108);
  const ew = m(92);
  const bodyH = h(23);
  addBox(group, ew, bodyH, ns, portland, 0, 0, 0);
  const roof = addBox(group, ew + m(5), m(3.4), ns + m(5), slate, 0, bodyH, 0);
  roof.name = 'palace-roof';

  const frontT = m(16);
  const frontH = h(32);
  const eastX = ew / 2 + frontT / 2 - m(4);
  const east = addBox(group, frontT, frontH, ns, portland, eastX, 0, 0);
  east.name = 'east-front';
  addBox(group, frontT + m(2), h(6), ns, cream, eastX, frontH, 0);
  addBox(group, frontT + m(5), m(2.6), ns + m(3), slate, eastX, frontH + h(6), 0);
  addBox(group, frontT + m(1), h(1.8), ns + m(1), rust, eastX + m(1), h(4), 0);

  for (const z of [-m(47), m(47)]) {
    addBox(group, frontT + m(8), frontH + h(6), m(20), portland, eastX + m(3), 0, z);
    addBox(group, frontT + m(10), m(2.4), m(22), slate, eastX + m(3), frontH + h(6), z);
    addBox(group, m(3.4), h(5.5), m(4.4), rust, eastX + m(3), frontH + h(7), z);
  }

  addBox(group, m(12), h(22), m(38), rust, eastX + m(10), h(5), 0);
  const balcony = addBox(group, m(14), m(1.3), m(40), portland, eastX + m(12), h(20), 0);
  balcony.name = 'balcony';
  for (let i = 0; i < 6; i++) {
    const z = (i - 2.5) * m(5.8);
    const col = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(1.2), m(1.35), h(15), 8), h(15)),
      portland,
    );
    col.name = 'column';
    col.position.set(eastX + m(15), h(5.5), z);
    group.add(col);
  }
  addGablePediment(group, m(40), h(10), m(12), portland, eastX + m(10), h(24), 0);

  const eastFace = eastX + frontT / 2 + m(0.35);
  addWindowGrid(group, ns - m(24), h(18), 17, 3, eastFace, h(6), 0, 'x', 0x2a3c4c);
  addWindowGrid(group, m(14), h(9), 3, 2, eastFace + m(0.2), h(7), m(-47), 'x', 0x2a3c4c);
  addWindowGrid(group, m(14), h(9), 3, 2, eastFace + m(0.2), h(7), m(47), 'x', 0x2a3c4c);
  addWindowGrid(group, ew * 0.72, h(12), 11, 2, 0, h(5), -ns / 2 - m(0.35), 'z', 0x2a3c4c);
  addWindowGrid(group, ew * 0.72, h(12), 11, 2, 0, h(5), ns / 2 + m(0.35), 'z', 0x2a3c4c);

  for (let i = 0; i < 9; i++) {
    addBox(group, m(2.8), h(5), m(3.6), rust, m(8), bodyH + m(3.4), (i - 4) * m(11));
  }

  const flag = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(0.4), m(0.4), h(16), 6), h(16)),
    dark,
  );
  flag.position.set(eastX + m(10), h(24) + h(10), 0);
  group.add(flag);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(m(4.6), m(2.4), m(0.18)), gold);
  cloth.position.set(eastX + m(12.4), h(24) + h(10) + h(12), 0);
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

function buildBritishMuseum(): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe2d8c4 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3630 });
  const glass = 0x6a88a0;
  addBox(group, m(110), h(22), m(36), stone);
  addBox(group, m(36), h(18), m(90), stone, 0, 0, 0);
  addWindowGrid(group, m(96), h(12), 14, 2, 0, h(5), m(18.2), 'z', glass);
  addWindowGrid(group, m(96), h(12), 14, 2, 0, h(5), -m(18.2), 'z', glass);
  const colMat = new THREE.MeshLambertMaterial({ color: 0xf0eadc });
  for (let i = 0; i < 11; i++) {
    const z = (i - 5) * m(6.4);
    const col = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(1.15), m(1.3), h(16), 8), h(16)),
      colMat,
    );
    col.position.set(m(56), h(4), z);
    group.add(col);
  }
  addBox(group, m(8), h(4), m(72), stone, m(56), h(20), 0);
  const ped = new THREE.Mesh(baseAtGround(new THREE.ConeGeometry(m(18), h(7), 3), h(7)), stone);
  ped.position.set(m(56), h(24), 0);
  ped.rotation.y = Math.PI / 2;
  group.add(ped);
  const lantern = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(6), m(7), h(10), 12), h(10)),
    stone,
  );
  lantern.position.y = h(22);
  group.add(lantern);
  const ridge = glowMat(0xf4eee0);
  addBox(group, m(2), h(6), m(18), ridge, m(56.6), h(10), 0);
  addBox(group, m(14), h(8), m(14), dark, 0, h(18), 0);
  group.rotation.y = 0.08;
  return group;
}

function buildAllSouls(): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe8dfcc });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
  const naveH = h(18);
  addBox(group, m(22), naveH, m(38), stone, 0, 0, m(-8));
  addWindowGrid(group, m(30), h(10), 5, 2, 0, h(5), m(11), 'z', 0x5a7090);
  const drumH = h(14);
  const drum = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(9), m(9), drumH, 16), drumH),
    stone,
  );
  drum.position.set(0, naveH, m(14));
  group.add(drum);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const col = new THREE.Mesh(
      baseAtGround(new THREE.CylinderGeometry(m(0.7), m(0.8), drumH, 6), drumH),
      stone,
    );
    col.position.set(Math.cos(a) * m(10.2), naveH, m(14) + Math.sin(a) * m(10.2));
    group.add(col);
  }
  const spireH = h(42);
  const spire = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(6.5), spireH, 8), spireH),
    stone,
  );
  spire.position.set(0, naveH + drumH, m(14));
  group.add(spire);
  const needle = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(1.4), h(16), 6), h(16)),
    glowMat(0xf2ead8),
  );
  needle.position.set(0, naveH + drumH + spireH, m(14));
  group.add(needle);
  addBox(group, m(3), h(4), m(2), dark, 0, h(6), m(23));
  return group;
}

function buildGoodgeSt(): THREE.Group {
  const group = new THREE.Group();
  const oxblood = new THREE.MeshLambertMaterial({ color: 0x6a2428 });
  const cream = new THREE.MeshLambertMaterial({ color: 0xe4d8c4 });
  const roof = new THREE.MeshLambertMaterial({ color: 0x4a4540 });
  addBox(group, m(28), h(9), m(16), oxblood);
  addBox(group, m(30), h(1.2), m(18), cream, 0, h(9), 0);
  addWindowGrid(group, m(22), h(5.5), 5, 1, 0, h(2.2), m(8.2), 'z', 0x2a3040);
  for (const x of [-m(8), 0, m(8)]) {
    addBox(group, m(3.2), h(4.2), m(0.6), cream, x, h(2.4), m(8.4));
  }
  const drumH = h(6);
  const drum = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(5.5), m(5.5), drumH, 14), drumH),
    oxblood,
  );
  drum.position.set(m(10), h(9), 0);
  group.add(drum);
  const lid = new THREE.Mesh(
    baseAtGround(new THREE.ConeGeometry(m(6.2), h(3.5), 14), h(3.5)),
    roof,
  );
  lid.position.set(m(10), h(9) + drumH, 0);
  group.add(lid);
  addBox(group, m(8), h(3.2), m(2.2), glowMat(0x1a1a1c), 0, h(5.5), m(8.5));
  return group;
}

function buildStCharles(): THREE.Group {
  const group = new THREE.Group();
  const cream = new THREE.MeshLambertMaterial({ color: 0xe6dcc8 });
  const brick = new THREE.MeshLambertMaterial({ color: 0x8a5648 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3c3830 });
  addBox(group, m(18), h(16), m(32), cream);
  addWindowGrid(group, m(26), h(9), 4, 2, 0, h(4), m(9.2), 'z', 0x5a7090);
  addBox(group, m(20), h(4), m(8), cream, 0, h(16), 0);
  const towerH = h(28);
  addBox(group, m(8), towerH, m(8), cream, 0, 0, m(-18));
  addBox(group, m(9), h(2), m(9), brick, 0, towerH, m(-18));
  const cap = new THREE.Mesh(baseAtGround(new THREE.ConeGeometry(m(5.2), h(8), 4), h(8)), brick);
  cap.position.set(0, towerH + h(2), m(-18));
  cap.rotation.y = Math.PI / 4;
  group.add(cap);
  addBox(group, m(2.2), h(3.5), m(1.4), dark, 0, h(7), m(16.2));
  addBox(group, m(1.1), h(6), m(1.1), glowMat(0xf0ead8), 0, towerH + h(8), m(-18));
  return group;
}

function buildNationalTheatre(): THREE.Group {
  const group = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ color: 0x9a968c });
  const dark = new THREE.MeshLambertMaterial({ color: 0x5a5852 });
  addBox(group, m(70), h(12), m(48), concrete);
  addBox(group, m(52), h(10), m(36), concrete, m(-4), h(12), m(-4));
  addBox(group, m(28), h(22), m(22), concrete, m(-18), h(22), m(8));
  addBox(group, m(18), h(16), m(16), concrete, m(16), h(22), m(-10));
  addWindowGrid(group, m(40), h(8), 8, 2, 0, h(3), m(24.2), 'z', 0x3a4a58);
  addBox(group, m(36), h(2.2), m(8), dark, 0, h(10), m(22));
  addBox(group, m(24), h(1.6), m(24), glowMat(0xc8c0b0), m(-18), h(42), m(8));
  addBox(group, m(14), h(1.4), m(14), glowMat(0xc8c0b0), m(16), h(36), m(-10));
  group.rotation.y = -0.35;
  return group;
}

function buildTateModern(): THREE.Group {
  const group = new THREE.Group();
  const brick = new THREE.MeshLambertMaterial({ color: 0x8a4e42 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3834 });
  const hallH = h(32);
  addBox(group, m(80), hallH, m(32), brick);
  addWindowGrid(group, m(68), h(20), 10, 4, 0, h(6), m(16.2), 'z', 0x2a3848);
  addWindowGrid(group, m(68), h(20), 10, 4, 0, h(6), -m(16.2), 'z', 0x2a3848);
  addBox(group, m(82), h(4), m(10), dark, 0, hallH, 0);
  const stackH = h(55);
  const stack = new THREE.Mesh(
    baseAtGround(new THREE.BoxGeometry(m(14), stackH, m(14)), stackH),
    brick,
  );
  stack.position.set(m(-28), 0, 0);
  group.add(stack);
  addBox(group, m(16), h(3), m(16), dark, m(-28), stackH, 0);
  addBox(group, m(18), h(8), m(18), glowMat(0xd8c8b0), m(22), hallH, 0);
  group.rotation.y = 0.2;
  return group;
}

function buildStPancras(): THREE.Group {
  const group = new THREE.Group();
  const brick = new THREE.MeshLambertMaterial({ color: 0x7a3a34 });
  const stone = new THREE.MeshLambertMaterial({ color: 0xd8cbb8 });
  const slate = new THREE.MeshLambertMaterial({ color: 0x4a5058 });
  addBox(group, m(90), h(22), m(28), brick);
  addWindowGrid(group, m(78), h(14), 12, 3, 0, h(5), m(14.2), 'z', 0x3a4a60);
  addBox(group, m(92), h(10), m(16), slate, 0, h(22), 0);
  const towerH = h(48);
  addBox(group, m(16), towerH, m(16), brick, m(-40), 0, 0);
  addBox(group, m(18), h(4), m(18), stone, m(-40), towerH, 0);
  const roof = new THREE.Mesh(baseAtGround(new THREE.ConeGeometry(m(11), h(16), 4), h(16)), slate);
  roof.position.set(m(-40), towerH + h(4), 0);
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  const clock = new THREE.Mesh(
    new THREE.CylinderGeometry(m(3.2), m(3.2), m(0.8), 16),
    glowMat(0xf0e6d0),
  );
  clock.rotation.x = Math.PI / 2;
  clock.position.set(m(-40), towerH * 0.72, m(8.4));
  group.add(clock);
  for (const x of [m(-20), m(0), m(20), m(38)]) {
    addBox(group, m(3), h(8), m(3), stone, x, h(22), m(8));
  }
  group.rotation.y = 0.12;
  return group;
}

function buildAlbertHall(): THREE.Group {
  const group = new THREE.Group();
  const brick = new THREE.MeshLambertMaterial({ color: 0x8a4a40 });
  const terracotta = new THREE.MeshLambertMaterial({ color: 0xb86848 });
  const iron = new THREE.MeshLambertMaterial({ color: 0x4a545c });
  const drumH = h(22);
  const drum = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(34), m(36), drumH, 24), drumH),
    brick,
  );
  group.add(drum);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(m(36.4), m(36.4), h(3.2), 24), terracotta);
  band.position.y = h(14);
  group.add(band);
  addWindowGrid(group, m(18), h(8), 3, 2, 0, h(6), m(36.2), 'z', 0x3a4860);
  const roof = new THREE.Mesh(
    new THREE.SphereGeometry(m(34), 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
    iron,
  );
  roof.position.y = drumH - m(4);
  group.add(roof);
  const lantern = new THREE.Mesh(
    baseAtGround(new THREE.CylinderGeometry(m(4), m(5), h(6), 10), h(6)),
    terracotta,
  );
  lantern.position.y = drumH + m(18);
  group.add(lantern);
  addBox(group, m(22), h(10), m(8), brick, 0, 0, m(38));
  addBox(group, m(16), h(1.8), m(4), glowMat(0xe8c45a), 0, h(8), m(42));
  return group;
}

/** Chunk 3×5 digit on the runway deck. Rows run along `ax` (approach). `y` is the box centre. */
function addRunwayDigit(
  group: THREE.Group,
  cells: readonly number[],
  x: number,
  z: number,
  ax: number,
  az: number,
  y: number,
  height: number,
  mat: THREE.Material,
): void {
  const col = m(3.6);
  const row = m(4.2);
  const px = -az;
  const pz = ax;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      if (!cells[r * 3 + c]) continue;
      const along = (2 - r) * row;
      const across = (c - 1) * col;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(m(3.4), height, m(4.0)), mat);
      mesh.position.set(x + ax * along + px * across, y, z + az * along + pz * across);
      mesh.name = 'runway-mark';
      group.add(mesh);
    }
  }
}

function buildLcy(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lcy';
  const asphalt = new THREE.MeshBasicMaterial({
    color: ASPHALT,
    fog: true,
  });
  const mark = new THREE.MeshBasicMaterial({
    color: 0xe8e6dc,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const concrete = new THREE.MeshLambertMaterial({ color: 0xc8c4b8 });
  const hall = new THREE.MeshLambertMaterial({ color: 0xece8dc });
  const glass = new THREE.MeshBasicMaterial({ color: 0x3a5468, fog: true });
  const cab = new THREE.MeshBasicMaterial({ color: 0x1c2a34, fog: true });
  const dlr = new THREE.MeshLambertMaterial({ color: 0x7a9088 });
  const grass = new THREE.MeshBasicMaterial({ color: 0x6a8a48, fog: true });
  const steel = new THREE.MeshLambertMaterial({ color: 0x8a9096 });

  // Sit on the road deck so the 09/27 strip is not under WATER_Y (0.04).
  const deck = LANDMARK_DECK_Y;
  const rwLen = m(1508);
  const rwW = m(30);
  const rwH = m(0.7);
  const markH = m(0.55);
  // Centre sits fully above the runway slab. A 0.38 m box centred 5 cm
  // above the deck was half inside the asphalt; polygonOffset on the
  // ribbon then ate the rest at viewH 10.2.
  const markY = deck + rwH + markH / 2 + m(0.15);

  const runway = new THREE.Mesh(new THREE.BoxGeometry(rwLen, rwH, rwW), asphalt);
  runway.name = 'runway';
  runway.position.set(0, deck + rwH / 2, 0);
  group.add(runway);
  // North shoulder stays skinny so Royal Albert Dock reads as water on the edge.
  addBox(group, rwLen, m(0.22), m(10), grass, 0, deck, -m(20));
  addBox(group, rwLen * 0.55, m(0.22), m(14), grass, m(80), deck, m(24));
  for (const z of [-m(14.4), m(14.4)]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(rwLen * 0.98, markH, m(2.0)), mark);
    edge.name = 'runway-mark';
    edge.position.set(0, markY, z);
    group.add(edge);
  }
  for (let i = -48; i <= 48; i++) {
    if (i % 2 === 0) continue;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(m(40), markH, m(3.2)), mark);
    dash.name = 'runway-mark';
    dash.position.set(i * m(15), markY, 0);
    group.add(dash);
  }
  for (const side of [-1, 1]) {
    const x0 = side * (rwLen / 2 - m(42));
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(m(32), markH, m(3.2)), mark);
      bar.name = 'runway-mark';
      bar.position.set(x0, markY, (i - 2.5) * m(4.4));
      group.add(bar);
    }
  }

  const zero = [1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1];
  const two = [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1];
  const seven = [1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const nine = [1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1];
  const west = -rwLen / 2 + m(72);
  const east = rwLen / 2 - m(72);
  const g09 = new THREE.Group();
  g09.name = 'mark-09';
  group.add(g09);
  addRunwayDigit(g09, zero, west, -m(8.4), 1, 0, markY, markH, mark);
  addRunwayDigit(g09, nine, west, m(8.4), 1, 0, markY, markH, mark);
  const g27 = new THREE.Group();
  g27.name = 'mark-27';
  group.add(g27);
  addRunwayDigit(g27, two, east, m(8.4), -1, 0, markY, markH, mark);
  addRunwayDigit(g27, seven, east, -m(8.4), -1, 0, markY, markH, mark);

  const apron = new THREE.Mesh(new THREE.BoxGeometry(m(560), m(0.45), m(62)), concrete);
  apron.name = 'apron';
  apron.position.set(m(-40), deck + m(0.22), m(58));
  group.add(apron);
  for (let i = 0; i < 8; i++) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(m(26), m(0.1), m(18)), asphalt);
    stand.position.set(m(-240 + i * 58), deck + m(0.5), m(52));
    group.add(stand);
    const lead = new THREE.Mesh(new THREE.BoxGeometry(m(1.1), m(0.08), m(16)), mark);
    lead.position.set(m(-240 + i * 58), markY, m(38));
    group.add(lead);
  }

  // Long airside pier + west headhouse — LCY's terminal, not a hangar box.
  const pier = addBox(group, m(300), m(7.2), m(16), hall, m(-60), deck, m(92));
  pier.name = 'terminal';
  addBox(group, m(292), m(5.4), m(2.4), glass, m(-60), deck + m(1.4), m(83.5));
  for (let i = 0; i < 10; i++) {
    addBox(group, m(2.2), m(5.6), m(2.6), glass, m(-200 + i * 31), deck + m(1.2), m(84));
  }
  addBox(group, m(88), m(13), m(36), hall, m(-150), deck, m(122));
  addBox(group, m(80), m(8), m(3.2), glass, m(-150), deck + m(2.4), m(140));
  addBox(group, m(90), m(1.6), m(38), hall, m(-150), deck + m(13), m(122));
  for (let i = 0; i < 8; i++) {
    const bridge = addBox(
      group,
      m(3.4),
      m(3.2),
      m(22),
      steel,
      m(-240 + i * 58),
      deck + m(4),
      m(72),
    );
    bridge.name = 'jetbridge';
  }

  // LCY ATC: ribbed shaft with a glass cab cantilevered toward 09/27.
  // East of the pier so the hat does not sit inside the terminal.
  const tx = m(108);
  const tz = m(138);
  const shaftH = h(52);
  addBox(group, m(24), m(9), m(24), concrete, tx, 0, tz);
  const shaft = addBox(group, m(15), shaftH, m(15), concrete, tx, 0, tz);
  shaft.name = 'tower-shaft';
  const rib = new THREE.MeshLambertMaterial({ color: 0xb4b0a6 });
  addBox(group, m(2.2), shaftH, m(17.4), rib, tx, 0, tz);
  addBox(group, m(17.4), shaftH, m(2.2), rib, tx, 0, tz);
  const cabH = h(18);
  const cabBot = shaftH;
  const cabZ = tz - m(12);
  const tower = addBox(group, m(46), cabH, m(34), cab, tx, cabBot, cabZ);
  tower.name = 'tower';
  const glassH = cabH * 0.58;
  const glassBot = cabBot + cabH * 0.2;
  addBox(group, m(47.4), glassH, m(32), glass, tx, glassBot, cabZ);
  addBox(group, m(44), glassH, m(35.6), glass, tx, glassBot, cabZ);
  addBox(group, m(26), cabH * 0.42, m(9), glass, tx, glassBot + glassH * 0.12, cabZ - m(18));
  addBox(group, m(50), m(2.4), m(38), hall, tx, cabBot + cabH, cabZ);
  addBox(group, m(2.2), h(16), m(2.2), steel, tx, cabBot + cabH + m(2.4), cabZ);

  const jet = addBox(group, m(48), m(8), m(22), concrete, m(280), deck, m(78));
  jet.name = 'jetcentre';

  const viaduct = addBox(group, m(200), m(5.5), m(7), dlr, m(-430), m(9), m(138));
  viaduct.name = 'dlr';
  addBox(group, m(52), m(9), m(24), dlr, m(-360), m(9), m(150));
  addBox(group, m(10), m(11), m(10), dlr, m(-510), 0, m(138));
  addBox(group, m(10), m(11), m(10), dlr, m(-350), 0, m(138));
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
  britishmuseum: buildBritishMuseum,
  allsouls: buildAllSouls,
  goodgest: buildGoodgeSt,
  stcharles: buildStCharles,
  nationaltheatre: buildNationalTheatre,
  tatemodern: buildTateModern,
  stpancras: buildStPancras,
  alberthall: buildAlbertHall,
  lcy: buildLcy,
};

export function build(kind: LandmarkKind): THREE.Group {
  return BUILDERS[kind]();
}
