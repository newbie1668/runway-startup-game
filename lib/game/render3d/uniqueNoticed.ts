/**
 * Photo-true unique meshes for named noticed towers the banded baker
 * cannot describe (Kansas: stand-out features in geometry, not a costume
 * on a box). Bake-time and tests share these builders; playtime builds them
 * from code so pale stone is not crushed by the GLB Lambert path.
 */
import * as THREE from 'three';
import { METERS_TO_WORLD } from '../geo';

export const UNIQUE_NOTICED_IDS = [
  'charrington-tower',
  'one-park-drive',
  'newfoundland-quay',
  'hsbc-uk',
  'citi',
] as const;

export type UniqueNoticedId = (typeof UNIQUE_NOTICED_IDS)[number];

export function isUniqueNoticedId(id: string): id is UniqueNoticedId {
  return (UNIQUE_NOTICED_IDS as readonly string[]).includes(id);
}

export interface UniqueNoticedJob {
  id: string;
  heightWorld: number;
  ring: Array<[number, number]>;
}

function paint(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, fog: true });
}

function ringExtents(ring: Array<[number, number]>): {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return {
    cx,
    cz,
    rx: Math.max(0.04, (maxX - minX) / 2),
    rz: Math.max(0.04, (maxZ - minZ) / 2),
  };
}

function addBox(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  name?: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  if (name) mesh.name = name;
  group.add(mesh);
  return mesh;
}

/**
 * SOM peeled-ellipse (Blackwall / New Providence Wharf).
 * Three.js CylinderGeometry theta=0 is +Z; the Thames peel is a ~106° bite
 * around that, not a closed core with a slit on +X.
 */
function buildCharrington(job: UniqueNoticedJob): THREE.Group {
  const group = new THREE.Group();
  group.name = job.id;
  const { cx, cz, rx, rz } = ringExtents(job.ring);
  const H = job.heightWorld;
  const stone = paint(0xf3ece3);
  stone.side = THREE.DoubleSide;
  const glass = paint(0x2c4450);
  glass.side = THREE.DoubleSide;
  const dark = paint(0x2a343c);
  const rxOut = rx * 1.04;
  const rzOut = rz * 1.04;
  const rxIn = rx * 0.7;
  const rzIn = rz * 0.7;
  const bands = 12;
  const peel = 1.85;
  const thetaStart = peel / 2;
  const thetaLength = Math.PI * 2 - peel;
  for (let i = 0; i < bands; i++) {
    const y0 = (i / bands) * H;
    const y1 = ((i + 1) / bands) * H;
    const bandH = y1 - y0;
    const isStone = i % 2 === 0;
    const wallMat = isStone ? stone : glass;
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, bandH * 0.9, 32, 1, true, thetaStart, thetaLength),
      wallMat,
    );
    shell.scale.set(rxOut, 1, rzOut);
    shell.position.set(cx, y0 + bandH / 2, cz);
    if (i === 0) shell.name = `${job.id}-shell`;
    group.add(shell);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, bandH * 0.9, 24, 1, true, thetaStart, thetaLength),
      isStone ? glass : stone,
    );
    inner.scale.set(rxIn, 1, rzIn);
    inner.position.set(cx, y0 + bandH / 2, cz);
    group.add(inner);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, bandH * 0.1, 28), stone);
    floor.scale.set(rxOut * 0.98, 1, rzOut * 0.98);
    floor.position.set(cx, y0 + bandH * 0.05, cz);
    group.add(floor);
    const bal = addBox(
      group,
      rxOut * 1.08,
      bandH * 0.18,
      rzOut * 0.58,
      stone,
      cx,
      y0 + bandH * 0.1,
      cz + rzOut * 0.58,
      i === 0 ? `${job.id}-peel` : undefined,
    );
    if (i !== 0) bal.name = `${job.id}-peel-${i}`;
    for (const sign of [-1, 1]) {
      const edge = sign * (peel / 2);
      addBox(
        group,
        rxOut * 0.1,
        bandH * 0.9,
        rzOut * 0.1,
        stone,
        cx + Math.sin(edge) * rxOut,
        y0 + bandH * 0.05,
        cz + Math.cos(edge) * rzOut,
      );
    }
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, H * 0.025, 24), dark);
  cap.scale.set(rxIn, 1, rzIn);
  cap.position.set(cx, H + H * 0.012, cz);
  cap.name = `${job.id}-cap`;
  group.add(cap);
  return group;
}

/** Herzog & de Meuron stacked discs with deep horizontal reveals. */
function buildOneParkDrive(job: UniqueNoticedJob): THREE.Group {
  const group = new THREE.Group();
  group.name = job.id;
  const { cx, cz, rx, rz } = ringExtents(job.ring);
  const R = Math.max(rx, rz);
  const H = job.heightWorld;
  const glass = paint(0x8d9aa6);
  const reveal = paint(0x2c343c);
  const discs = [
    { t0: 0, t1: 0.07, s: 1.08 },
    { t0: 0.07, t1: 0.22, s: 1.0 },
    { t0: 0.22, t1: 0.4, s: 0.92 },
    { t0: 0.4, t1: 0.58, s: 0.84 },
    { t0: 0.58, t1: 0.74, s: 0.74 },
    { t0: 0.74, t1: 0.88, s: 0.62 },
    { t0: 0.88, t1: 1, s: 0.5 },
  ];
  discs.forEach((disc, i) => {
    const y0 = disc.t0 * H;
    const y1 = disc.t1 * H;
    const h = y1 - y0;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h * 0.9, 28), glass);
    body.scale.set(R * disc.s, 1, R * disc.s);
    body.position.set(cx, y0 + h * 0.45, cz);
    body.name = `${job.id}-disc-${i}`;
    group.add(body);
    if (i < discs.length - 1) {
      const inset = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h * 0.12, 24), reveal);
      inset.scale.set(R * disc.s * 0.82, 1, R * disc.s * 0.82);
      inset.position.set(cx, y1, cz);
      group.add(inset);
    }
  });
  return group;
}

/** Foster helical wrap: stacked floor plates yaw up the shaft, balcony fins. */
function buildNewfoundland(job: UniqueNoticedJob): THREE.Group {
  const group = new THREE.Group();
  group.name = job.id;
  const { cx, cz, rx, rz } = ringExtents(job.ring);
  const H = job.heightWorld;
  const glass = paint(0x5a7a88);
  const fin = paint(0xd8d4cc);
  const floors = 16;
  for (let i = 0; i < floors; i++) {
    const y0 = (i / floors) * H;
    const y1 = ((i + 1) / floors) * H;
    const h = y1 - y0;
    const yaw = (i / (floors - 1)) * 1.15;
    const taper = 1 - i * 0.018;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h * 0.82, 16), glass);
    plate.scale.set(rx * taper, 1, rz * taper);
    plate.position.set(cx, y0 + h * 0.41, cz);
    plate.rotation.y = yaw;
    if (i === 0) plate.name = `${job.id}-helix`;
    group.add(plate);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, h * 0.1, 16, 1, true), fin);
    lip.scale.set(rx * taper, 1, rz * taper);
    lip.position.set(cx, y0 + h * 0.08, cz);
    lip.rotation.y = yaw;
    group.add(lip);
  }
  return group;
}

/** Foster 8 Canada Square: regular steel grid, set-back plant hat. */
function buildHsbc(job: UniqueNoticedJob): THREE.Group {
  const group = new THREE.Group();
  group.name = job.id;
  const { cx, cz, rx, rz } = ringExtents(job.ring);
  const H = job.heightWorld;
  const w = rx * 2;
  const d = rz * 2;
  const glass = paint(0x4a5c68);
  const steel = paint(0xc8d0d6);
  const dark = paint(0x3a444c);
  addBox(group, w, H * 0.08, d, steel, cx, 0, cz);
  addBox(group, w * 0.96, H * 0.82, d * 0.96, glass, cx, H * 0.08, cz);
  const rows = 16;
  for (let r = 1; r < rows; r++) {
    addBox(group, w * 0.98, H * 0.016, d * 0.98, steel, cx, H * 0.08 + (r / rows) * H * 0.82, cz);
  }
  for (let c = 0; c <= 6; c++) {
    const t = c / 6;
    const x = cx - w * 0.48 + t * w * 0.96;
    const z = cz - d * 0.48 + t * d * 0.96;
    addBox(group, w * 0.018, H * 0.82, d * 0.018, steel, x, H * 0.08, cz + d * 0.49);
    addBox(group, w * 0.018, H * 0.82, d * 0.018, steel, x, H * 0.08, cz - d * 0.49);
    addBox(group, w * 0.018, H * 0.82, d * 0.018, steel, cx + w * 0.49, H * 0.08, z);
    addBox(group, w * 0.018, H * 0.82, d * 0.018, steel, cx - w * 0.49, H * 0.08, z);
  }
  addBox(group, w * 0.55, H * 0.14, d * 0.55, dark, cx, H * 0.86, cz, `${job.id}-hat`);
  addBox(group, w * 0.22, H * 0.06, d * 0.18, steel, cx + w * 0.28, H * 0.94, cz);
  addBox(group, w * 0.22, H * 0.06, d * 0.18, steel, cx - w * 0.28, H * 0.94, cz);
  return group;
}

/** 25 Canada Square: granite plinth, glass shaft, notched river-facing crown. */
function buildCiti(job: UniqueNoticedJob): THREE.Group {
  const group = new THREE.Group();
  group.name = job.id;
  const { cx, cz, rx, rz } = ringExtents(job.ring);
  const H = job.heightWorld;
  const w = rx * 2;
  const d = rz * 2;
  const granite = paint(0x8a8580);
  const glass = paint(0x6a8490);
  const steel = paint(0xb8c4cc);
  addBox(group, w, H * 0.1, d, granite, cx, 0, cz);
  addBox(group, w * 0.94, H * 0.78, d * 0.94, glass, cx, H * 0.1, cz);
  for (let r = 0; r < 12; r++) {
    addBox(group, w * 0.96, H * 0.01, d * 0.96, steel, cx, H * 0.14 + (r / 12) * H * 0.7, cz);
  }
  addBox(group, w * 0.7, H * 0.08, d * 0.7, steel, cx, H * 0.88, cz);
  const notch = addBox(
    group,
    w * 0.55,
    H * 0.16,
    d * 0.38,
    granite,
    cx + w * 0.16,
    H * 0.86,
    cz + d * 0.28,
    `${job.id}-notch`,
  );
  notch.rotation.x = -0.55;
  return group;
}

const BUILDERS: Record<UniqueNoticedId, (job: UniqueNoticedJob) => THREE.Group> = {
  'charrington-tower': buildCharrington,
  'one-park-drive': buildOneParkDrive,
  'newfoundland-quay': buildNewfoundland,
  'hsbc-uk': buildHsbc,
  citi: buildCiti,
};

export function buildUniqueNoticed(job: UniqueNoticedJob): THREE.Group | null {
  if (!isUniqueNoticedId(job.id)) return null;
  return BUILDERS[job.id](job);
}

export function ellipseRing(rx: number, rz: number, n = 28): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * rz];
  });
}

export function rectRing(w: number, d: number): Array<[number, number]> {
  const hw = w / 2;
  const hd = d / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
}

export function metersToWorld(meters: number): number {
  return meters * METERS_TO_WORLD;
}

export function uniquePlanRing(id: UniqueNoticedId): Array<[number, number]> {
  switch (id) {
    case 'charrington-tower':
      return ellipseRing(metersToWorld(16), metersToWorld(12));
    case 'one-park-drive':
      return ellipseRing(metersToWorld(15), metersToWorld(15));
    case 'newfoundland-quay':
      return ellipseRing(metersToWorld(14), metersToWorld(12));
    case 'hsbc-uk':
      return rectRing(metersToWorld(47), metersToWorld(47));
    case 'citi':
      return rectRing(metersToWorld(50), metersToWorld(48));
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
