/**
 * RUNWAY — decoded city data -> three.js geometry.
 *
 * Daytime SFSIM look: solid vertex colours, geometric window insets
 * (instanced quads), darker roofs with parapets/clutter, grey streets with
 * white markings, instanced trees. Real OSM footprints keep their own
 * outward-facing normals (winding is inconsistent).
 */

import * as THREE from 'three';
import {
  LANDMARKS,
  METERS_TO_WORLD,
  THAMES_CROSSINGS,
  WORLD,
  isDeckLandmark,
  project,
  thamesTangent,
  unproject,
} from '../geo';
import { HUB_POS } from '../overlay';
import type { HubId } from '../types';
import {
  dequantizeX,
  dequantizeY,
  type CityBuilding,
  type CityData,
  type CityPoly,
  type CityRoad,
} from './format';
import { fromRgb565 } from './osmColour';
import {
  ROOF_FLAT,
  ROOF_GABLED,
  STYLE_HOUSE,
  STYLE_OFFICE,
  STYLE_APARTMENTS,
  STYLE_RETAIL,
  STYLE_TERRACE,
  STYLE_TOWER,
  inferRoof,
  resolveStyle,
  restyleForDistrict,
  districtAt,
  extrusionScale,
  wantBayWindows,
  wantFacadeWindows,
  wantPodium,
  bayCountForEdge,
  facadeWindowRhythm,
  type DistrictId,
} from './buildingStyle';
import * as pal from './palette';
import { DASH_WIDTH_M, EDGE_WIDTH_M, polylineDashes, segmentEdgeOffsets } from './streetMarks';
import { chamferRing } from './footprint';

export { HEIGHT_SCALE, TOWER_HEIGHT_SCALE, NOTICED_BAKE_HEIGHT_SCALE } from './buildingStyle';

export const CHUNK_COLS = 8;
export const CHUNK_ROWS = 6;
export const CHUNK_COUNT = CHUNK_COLS * CHUNK_ROWS;

export const WINDOW_MAX = 720_000;
export const TREE_MAX = 36_000;
export const GROVE_MAX = 2_400;
export const ROOFTOP_MAX = 24_000;

const ROAD_WIDTHS_M = [14, 9.5, 5.8];
/** River-crossing ribbons match a primary street, not a footway. */
const CROSSING_WIDTH_M = 14;
const SIDEWALK_M = [3.6, 2.8, 2.0];
export const ROAD_Y = 0.14;
const SIDEWALK_Y = 0.09;
const MARK_Y = 0.155;
const PARK_Y = 0.08;
const WATER_Y = 0.04;
const WATER_BANK_Y = 0.055;

const HUB_GLOW_COLOR = 0xb8d4e8;
export const HUB_GLOW_PLAYER_COLOR = 0xf0c56a;
const HUB_GLOW_SIZE_M = 36;
const HUB_GLOW_HEIGHT_M = 4;

const tmpColor = new THREE.Color();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();

export type BuildingPick = {
  x: number;
  z: number;
  heightWorld: number;
  heightM: number;
  areaM2: number;
  style: number;
  district: DistrictId;
  label: string;
  address: string;
};

export type CityScratch = {
  windows: number[];
  windowColors: number[];
  picks: BuildingPick[];
  rooftops: number[];
  rooftopColors: number[];
  signs: FacadeSign[];
};

export type FacadeSign = {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  w: number;
  h: number;
  name: string;
};

export function createScratch(): CityScratch {
  return { windows: [], windowColors: [], picks: [], rooftops: [], rooftopColors: [], signs: [] };
}

function hexColor(hex: number): THREE.Color {
  return tmpColor.setHex(hex);
}

function hashBuildingIndex(
  heightM: number,
  chunkId: number,
  verts: Uint16Array,
  mod: number,
  cx = 0,
  cz = 0,
): number {
  let h =
    (Math.imul(chunkId, 2654435761) ^
      Math.imul(heightM, 40503) ^
      Math.imul(Math.round(cx * 400), 97) ^
      Math.imul(Math.round(cz * 400), 193)) |
    0;
  for (let i = 0; i < verts.length; i++) h = (Math.imul(h, 31) + verts[i]) | 0;
  h ^= h >>> 15;
  return Math.abs(h) % mod;
}

function outwardNormal(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): [number, number] {
  let nx = bz - az;
  let nz = -(bx - ax);
  const midX = (ax + bx) / 2;
  const midZ = (az + bz) / 2;
  if (nx * (cx - midX) + nz * (cz - midZ) > 0) {
    nx = -nx;
    nz = -nz;
  }
  const len = Math.hypot(nx, nz) || 1;
  return [nx / len, nz / len];
}

export function createBuildingMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    fog: false,
    flatShading: true,
  });
}

function insetRing(
  ring: { x: number; z: number }[],
  cx: number,
  cz: number,
  scale: number,
): { x: number; z: number }[] {
  return ring.map((p) => ({
    x: cx + (p.x - cx) * scale,
    z: cz + (p.z - cz) * scale,
  }));
}

function footprintAreaM2(ring: { x: number; z: number }[]): number {
  let acc = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    acc += a.x * b.z - b.x * a.z;
  }
  return (Math.abs(acc) * 0.5) / (METERS_TO_WORLD * METERS_TO_WORLD);
}

function principalAxis(
  ring: { x: number; z: number }[],
  cx: number,
  cz: number,
): { ax: number; az: number; px: number; pz: number; maxPerp: number } {
  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (const p of ring) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    cxx += dx * dx;
    czz += dz * dz;
    cxz += dx * dz;
  }
  const trace = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const gap = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const l1 = trace / 2 + gap;
  let ax = cxz;
  let az = l1 - cxx;
  if (Math.abs(ax) + Math.abs(az) < 1e-12) {
    ax = 1;
    az = 0;
  }
  const len = Math.hypot(ax, az) || 1;
  ax /= len;
  az /= len;
  const px = -az;
  const pz = ax;
  let maxPerp = 1e-6;
  for (const p of ring) {
    const d = Math.abs((p.x - cx) * px + (p.z - cz) * pz);
    if (d > maxPerp) maxPerp = d;
  }
  return { ax, az, px, pz, maxPerp };
}

function pushWindowMatrix(
  scratch: CityScratch,
  x: number,
  y: number,
  z: number,
  nx: number,
  nz: number,
  w: number,
  h: number,
  color: number = pal.WINDOW,
): void {
  if (scratch.windows.length / 16 >= WINDOW_MAX) return;
  const yaw = Math.atan2(nx, nz);
  const hy = Math.sin(yaw / 2);
  const hw = Math.cos(yaw / 2);
  tmpQuat.set(0, hy, 0, hw);
  tmpPos.set(x, y, z);
  tmpScale.set(w, h, Math.max(0.12 * METERS_TO_WORLD, 0.004));
  tmpMat.compose(tmpPos, tmpQuat, tmpScale);
  const e = tmpMat.elements;
  for (let i = 0; i < 16; i++) scratch.windows.push(e[i]!);
  scratch.windowColors.push(color);
}

const ROOF_CLUTTER = [pal.HVAC, pal.HVAC_BLACK, pal.HVAC_BLUE, pal.HVAC_RED] as const;

function pushRooftopMatrix(
  scratch: CityScratch,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  color: number = pal.HVAC,
): void {
  if (scratch.rooftops.length / 16 >= ROOFTOP_MAX) return;
  tmpQuat.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  tmpPos.set(x, y + sy / 2, z);
  tmpScale.set(sx, sy, sz);
  tmpMat.compose(tmpPos, tmpQuat, tmpScale);
  const e = tmpMat.elements;
  for (let i = 0; i < 16; i++) scratch.rooftops.push(e[i]!);
  scratch.rooftopColors.push(color);
}

/** One merged, flat-shaded, indexed geometry for every building in (chunkId, major). */
export function buildChunkTier(
  cityData: CityData,
  chunkId: number,
  major: boolean,
  landmarkAnchors: readonly { x: number; y: number; r: number }[] = [],
  scratch?: CityScratch,
): THREE.Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pushVertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    hex: number,
  ): number => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    hexColor(hex);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
    return positions.length / 3 - 1;
  };

  const pushBox = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    hex: number,
  ) => {
    const hx = sx / 2;
    const hz = sz / 2;
    const faces = [
      {
        q: [x - hx, y, z + hz, x + hx, y, z + hz, x + hx, y + sy, z + hz, x - hx, y + sy, z + hz],
        n: [0, 0, 1],
      },
      {
        q: [x + hx, y, z - hz, x - hx, y, z - hz, x - hx, y + sy, z - hz, x + hx, y + sy, z - hz],
        n: [0, 0, -1],
      },
      {
        q: [x + hx, y, z + hz, x + hx, y, z - hz, x + hx, y + sy, z - hz, x + hx, y + sy, z + hz],
        n: [1, 0, 0],
      },
      {
        q: [x - hx, y, z - hz, x - hx, y, z + hz, x - hx, y + sy, z + hz, x - hx, y + sy, z - hz],
        n: [-1, 0, 0],
      },
      {
        q: [
          x - hx,
          y + sy,
          z + hz,
          x + hx,
          y + sy,
          z + hz,
          x + hx,
          y + sy,
          z - hz,
          x - hx,
          y + sy,
          z - hz,
        ],
        n: [0, 1, 0],
      },
    ];
    for (const f of faces) {
      const i0 = pushVertex(f.q[0]!, f.q[1]!, f.q[2]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      const i1 = pushVertex(f.q[3]!, f.q[4]!, f.q[5]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      const i2 = pushVertex(f.q[6]!, f.q[7]!, f.q[8]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      const i3 = pushVertex(f.q[9]!, f.q[10]!, f.q[11]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      indices.push(i0, i1, i2, i0, i2, i3);
    }
  };

  /** Box aligned to wall tangent `tx,tz` and outward normal `nx,nz`. */
  const pushOrientedBox = (
    cx: number,
    y0: number,
    cz: number,
    along: number,
    height: number,
    out: number,
    tx: number,
    tz: number,
    nx: number,
    nz: number,
    hex: number,
  ) => {
    const hx = along / 2;
    const hz = out / 2;
    const y1 = y0 + height;
    const corners = [
      { x: cx - tx * hx - nx * hz, z: cz - tz * hx - nz * hz },
      { x: cx + tx * hx - nx * hz, z: cz + tz * hx - nz * hz },
      { x: cx + tx * hx + nx * hz, z: cz + tz * hx + nz * hz },
      { x: cx - tx * hx + nx * hz, z: cz - tz * hx + nz * hz },
    ];
    const faces: { q: number[]; n: [number, number, number] }[] = [
      {
        q: [
          corners[0]!.x,
          y0,
          corners[0]!.z,
          corners[1]!.x,
          y0,
          corners[1]!.z,
          corners[1]!.x,
          y1,
          corners[1]!.z,
          corners[0]!.x,
          y1,
          corners[0]!.z,
        ],
        n: [-nx, 0, -nz],
      },
      {
        q: [
          corners[2]!.x,
          y0,
          corners[2]!.z,
          corners[3]!.x,
          y0,
          corners[3]!.z,
          corners[3]!.x,
          y1,
          corners[3]!.z,
          corners[2]!.x,
          y1,
          corners[2]!.z,
        ],
        n: [nx, 0, nz],
      },
      {
        q: [
          corners[1]!.x,
          y0,
          corners[1]!.z,
          corners[2]!.x,
          y0,
          corners[2]!.z,
          corners[2]!.x,
          y1,
          corners[2]!.z,
          corners[1]!.x,
          y1,
          corners[1]!.z,
        ],
        n: [tx, 0, tz],
      },
      {
        q: [
          corners[3]!.x,
          y0,
          corners[3]!.z,
          corners[0]!.x,
          y0,
          corners[0]!.z,
          corners[0]!.x,
          y1,
          corners[0]!.z,
          corners[3]!.x,
          y1,
          corners[3]!.z,
        ],
        n: [-tx, 0, -tz],
      },
      {
        q: [
          corners[3]!.x,
          y1,
          corners[3]!.z,
          corners[2]!.x,
          y1,
          corners[2]!.z,
          corners[1]!.x,
          y1,
          corners[1]!.z,
          corners[0]!.x,
          y1,
          corners[0]!.z,
        ],
        n: [0, 1, 0],
      },
    ];
    for (const f of faces) {
      const i0 = pushVertex(f.q[0]!, f.q[1]!, f.q[2]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      const i1 = pushVertex(f.q[3]!, f.q[4]!, f.q[5]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      const i2 = pushVertex(f.q[6]!, f.q[7]!, f.q[8]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      const i3 = pushVertex(f.q[9]!, f.q[10]!, f.q[11]!, f.n[0]!, f.n[1]!, f.n[2]!, hex);
      indices.push(i0, i1, i2, i0, i2, i3);
    }
  };

  for (const b of cityData.buildings as CityBuilding[]) {
    if (b.chunkId !== chunkId || b.major !== major) continue;
    const n = b.verts.length / 2;
    if (n < 3) continue;

    const ring = new Array<{ x: number; z: number }>(n);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const x = dequantizeX(b.verts[i * 2]!);
      const z = dequantizeY(b.verts[i * 2 + 1]!);
      ring[i] = { x, z };
      cx += x;
      cz += z;
    }
    cx /= n;
    cz /= n;

    if (landmarkAnchors.some((a) => Math.hypot(cx - a.x, cz - a.y) < a.r)) continue;

    const areaM2 = footprintAreaM2(ring);
    const [lng, lat] = unproject(cx, cz);
    const district = districtAt(lng, lat);
    const style = restyleForDistrict(
      resolveStyle(b.style, b.heightM, areaM2),
      b.heightM,
      areaM2,
      district,
    );
    const storedRoof = b.style === 0 ? inferRoof(style) : b.roof;
    const forceFlat = district === 'canary' || (district === 'city' && b.heightM > 14);
    const forceGable =
      !forceFlat && (style === STYLE_TERRACE || style === STYLE_HOUSE) && b.heightM <= 16;
    const roof = forceGable && storedRoof === ROOF_FLAT ? ROOF_GABLED : storedRoof;
    const seed = hashBuildingIndex(b.heightM, b.chunkId, b.verts, 0x7fffffff, cx, cz);
    const osmWall = fromRgb565(b.wall565);
    const osmRoof = fromRgb565(b.roof565);
    const baseHex = pal.wallHex(style, district, cx, cz, seed, osmWall);
    const wallBottomHex = pal.mixHex(baseHex, pal.AO_DARK, 0.1);
    const pitchedKind = roof !== ROOF_FLAT;
    const roofHex = osmRoof
      ? pal.clampRoofColour(osmRoof)
      : pal.roofHex(style, pitchedKind && b.heightM <= 22, seed);
    const vScale = extrusionScale(style, b.heightM, district);
    const heightWorld = b.heightM * METERS_TO_WORLD * vScale;
    const shopM = style === STYLE_RETAIL ? Math.min(4.0, b.heightM * 0.36) : 0;
    const shopWorld = shopM * METERS_TO_WORLD * vScale;
    const plinthWorld =
      shopWorld > 0.02 ? 0 : Math.min(0.95 * METERS_TO_WORLD * vScale, heightWorld * 0.14);
    const corniceWorld = Math.min(0.7 * METERS_TO_WORLD * vScale, heightWorld * 0.1);
    const corniceHex = pal.mixHex(
      baseHex,
      pal.CORNICE,
      style === STYLE_HOUSE || style === STYLE_TERRACE ? 0.22 : 0.45,
    );
    const podium = wantPodium(style, b.heightM, areaM2, district);
    const podiumWorld = podium ? Math.min(15 * METERS_TO_WORLD * vScale, heightWorld * 0.14) : 0;
    const chamferAmt =
      (style === STYLE_OFFICE || style === STYLE_RETAIL || style === STYLE_TOWER) &&
      n >= 4 &&
      n <= 16 &&
      seed % 3 !== 1
        ? (1.55 + (seed % 4) * 0.35) * METERS_TO_WORLD
        : 0;
    const wallRing = chamferAmt > 0 ? chamferRing(ring, chamferAmt) : ring;
    const stepped =
      !podium &&
      !pitchedKind &&
      (style === STYLE_OFFICE || style === STYLE_TOWER) &&
      b.heightM >= 16 &&
      areaM2 > 220 &&
      seed % 3 === 0;
    const stepY = stepped ? heightWorld * 0.64 : heightWorld;
    const shaftRing = podium
      ? insetRing(ring, cx, cz, district === 'canary' ? 0.42 : 0.58)
      : stepped
        ? insetRing(ring, cx, cz, 0.7)
        : ring;

    let longestI = 0;
    let longestM = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const bp = ring[(i + 1) % n]!;
      const edgeM = Math.hypot(bp.x - a.x, bp.z - a.z) / METERS_TO_WORLD;
      if (edgeM > longestM) {
        longestM = edgeM;
        longestI = i;
      }
    }

    const emitRingWalls = (
      useRing: { x: number; z: number }[],
      y0: number,
      y1: number,
      opts: { plinth: boolean; shop: boolean; cornice: boolean; doors: boolean; windows: boolean },
    ) => {
      const count = useRing.length;
      for (let i = 0; i < count; i++) {
        const a = useRing[i]!;
        const bp = useRing[(i + 1) % count]!;
        const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
        const dx = bp.x - a.x;
        const dz = bp.z - a.z;
        const candX = -dz * (y1 - y0);
        const candZ = dx * (y1 - y0);
        const flip = candX * nx + candZ * nz < 0;

        const emitQuad = (qy0: number, qy1: number, c0: number, c1: number, alongN = 0) => {
          const ax = a.x + nx * alongN;
          const az = a.z + nz * alongN;
          const bx = bp.x + nx * alongN;
          const bz = bp.z + nz * alongN;
          const iBottomA = pushVertex(ax, qy0, az, nx, 0, nz, c0);
          const iBottomB = pushVertex(bx, qy0, bz, nx, 0, nz, c0);
          const iTopA = pushVertex(ax, qy1, az, nx, 0, nz, c1);
          const iTopB = pushVertex(bx, qy1, bz, nx, 0, nz, c1);
          if (!flip) indices.push(iBottomA, iBottomB, iTopB, iBottomA, iTopB, iTopA);
          else indices.push(iBottomA, iTopB, iBottomB, iBottomA, iTopA, iTopB);
        };

        const plinthTop = opts.plinth ? y0 + plinthWorld : y0;
        const wallTop = Math.max(plinthTop, y1 - (opts.cornice ? corniceWorld : 0));
        if (opts.shop && shopWorld > 0.02 && shopWorld < (y1 - y0) * 0.85) {
          emitQuad(y0, y0 + shopWorld, pal.SHOPFRONT, pal.SHOPFRONT);
          emitQuad(y0 + shopWorld, wallTop, wallBottomHex, baseHex);
        } else if (opts.plinth && plinthWorld > 0.01) {
          emitQuad(y0, plinthTop, wallBottomHex, wallBottomHex);
          emitQuad(plinthTop, wallTop, wallBottomHex, baseHex);
        } else {
          emitQuad(y0, wallTop, wallBottomHex, baseHex);
        }
        if (opts.cornice && corniceWorld > 0.008 && wallTop < y1) {
          emitQuad(wallTop, y1, corniceHex, corniceHex, 0.22 * METERS_TO_WORLD);
        }

        const edgeLenM = Math.hypot(bp.x - a.x, bp.z - a.z) / METERS_TO_WORLD;
        if (
          (style === STYLE_OFFICE || style === STYLE_TOWER) &&
          edgeLenM > 14 &&
          y1 - y0 > 8 * METERS_TO_WORLD
        ) {
          const mid0 = y0 + (y1 - y0) * 0.34;
          const mid1 = y0 + (y1 - y0) * 0.58;
          const recess = pal.mixHex(baseHex, pal.AO_DARK, 0.24);
          emitQuad(mid0, mid1, recess, recess, -0.55 * METERS_TO_WORLD);
        } else if (
          opts.windows &&
          (style === STYLE_HOUSE || style === STYLE_TERRACE || style === STYLE_APARTMENTS) &&
          y1 - y0 > 6 * METERS_TO_WORLD &&
          seed % 3 !== 1
        ) {
          const t = 0.28 + ((seed >>> 5) % 5) * 0.08;
          const bandH = Math.min(2.6 * METERS_TO_WORLD * vScale, (y1 - y0) * 0.18);
          const by0 = y0 + (y1 - y0) * t;
          const bandHex = pal.mixHex(baseHex, pal.WINDOW, 0.2 + ((seed >>> 9) % 4) * 0.05);
          emitQuad(by0, by0 + bandH, bandHex, bandHex, -0.04 * METERS_TO_WORLD);
        }

        const wantDoor =
          opts.doors &&
          i === longestI &&
          longestM >= 4.2 &&
          (style === STYLE_HOUSE || style === STYLE_TERRACE || style === STYLE_RETAIL);
        if (wantDoor) {
          const doorW = Math.min(1.2 * METERS_TO_WORLD, Math.hypot(dx, dz) * 0.22);
          const doorH = Math.min(2.3 * METERS_TO_WORLD * vScale, (y1 - y0) * 0.55);
          const mx = (a.x + bp.x) / 2;
          const mz = (a.z + bp.z) / 2;
          const ox = nx * 0.05 * METERS_TO_WORLD;
          const oz = nz * 0.05 * METERS_TO_WORLD;
          const elen = Math.hypot(dx, dz) || 1;
          const tx = dx / elen;
          const tz = dz / elen;
          const hx = (tx * doorW) / 2;
          const hz = (tz * doorW) / 2;
          const door = pal.doorHex(seed);
          const d0 = pushVertex(mx - hx + ox, y0, mz - hz + oz, nx, 0, nz, door);
          const d1 = pushVertex(mx + hx + ox, y0, mz + hz + oz, nx, 0, nz, door);
          const d2 = pushVertex(mx + hx + ox, y0 + doorH, mz + hz + oz, nx, 0, nz, door);
          const d3 = pushVertex(mx - hx + ox, y0 + doorH, mz - hz + oz, nx, 0, nz, door);
          if (!flip) indices.push(d0, d1, d2, d0, d2, d3);
          else indices.push(d0, d2, d1, d0, d3, d2);
        }

        if (opts.windows && scratch) {
          const spanM = (y1 - y0) / METERS_TO_WORLD;
          if (wantBayWindows(edgeLenM, spanM, style)) {
            emitBayWindows(
              scratch,
              pushOrientedBox,
              a,
              bp,
              nx,
              nz,
              y0,
              y1,
              style,
              vScale,
              shopWorld,
              pal.mixHex(baseHex, pal.CORNICE, 0.12),
              seed,
            );
          } else if (wantFacadeWindows(edgeLenM, spanM, style)) {
            emitFacadeWindows(
              scratch,
              a,
              bp,
              nx,
              nz,
              y0,
              y1,
              style,
              major,
              shopWorld,
              vScale,
              seed,
            );
          }
        }
      }
    };

    if (podium) {
      emitRingWalls(wallRing, 0, podiumWorld, {
        plinth: true,
        shop: false,
        cornice: true,
        doors: true,
        windows: true,
      });
      emitRingWalls(shaftRing, podiumWorld, heightWorld, {
        plinth: false,
        shop: false,
        cornice: true,
        doors: false,
        windows: true,
      });
    } else if (stepped) {
      emitRingWalls(wallRing, 0, stepY, {
        plinth: shopWorld <= 0.02,
        shop: shopWorld > 0.02,
        cornice: true,
        doors: true,
        windows: true,
      });
      emitRingWalls(shaftRing, stepY, heightWorld, {
        plinth: false,
        shop: false,
        cornice: true,
        doors: false,
        windows: true,
      });
    } else {
      emitRingWalls(wallRing, 0, heightWorld, {
        plinth: shopWorld <= 0.02,
        shop: shopWorld > 0.02,
        cornice: true,
        doors: true,
        windows: true,
      });
    }

    const wantAwning =
      (shopWorld > 0.02 || style === STYLE_RETAIL || (style === STYLE_TERRACE && seed % 3 === 0)) &&
      longestM >= 7;
    if (wantAwning) {
      const a = ring[longestI]!;
      const bp = ring[(longestI + 1) % n]!;
      const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
      const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
      const tx = (bp.x - a.x) / elen;
      const tz = (bp.z - a.z) / elen;
      const depth = 1.55 * METERS_TO_WORLD;
      const along = Math.min(elen * 0.72, 8 * METERS_TO_WORLD);
      const yAwn = shopWorld > 0.02 ? shopWorld : 3.1 * METERS_TO_WORLD * vScale;
      pushOrientedBox(
        (a.x + bp.x) / 2 + nx * (depth / 2),
        yAwn,
        (a.z + bp.z) / 2 + nz * (depth / 2),
        along,
        0.22 * METERS_TO_WORLD,
        depth,
        tx,
        tz,
        nx,
        nz,
        pal.awningHex(seed),
      );
    }

    if ((style === STYLE_RETAIL || (style === STYLE_OFFICE && seed % 9 === 0)) && longestM >= 8) {
      const a = ring[longestI]!;
      const bp = ring[(longestI + 1) % n]!;
      const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
      const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
      const tx = (bp.x - a.x) / elen;
      const tz = (bp.z - a.z) / elen;
      const along = Math.min(4.8 * METERS_TO_WORLD, elen * 0.42);
      const ySign =
        (shopWorld > 0.02 ? shopWorld : 4.2 * METERS_TO_WORLD * vScale) + 0.2 * METERS_TO_WORLD;
      const mx = (a.x + bp.x) / 2 + nx * 0.12 * METERS_TO_WORLD;
      const mz = (a.z + bp.z) / 2 + nz * 0.12 * METERS_TO_WORLD;
      pushOrientedBox(
        mx,
        ySign,
        mz,
        along,
        0.85 * METERS_TO_WORLD,
        0.16 * METERS_TO_WORLD,
        tx,
        tz,
        nx,
        nz,
        pal.SIGN_BOARD,
      );
      if (scratch) {
        scratch.signs.push({
          x: mx + nx * 0.1 * METERS_TO_WORLD,
          y: ySign + 0.42 * METERS_TO_WORLD,
          z: mz + nz * 0.1 * METERS_TO_WORLD,
          nx,
          nz,
          w: along * 0.92,
          h: 0.62 * METERS_TO_WORLD,
          name: pal.facadeSignName(seed),
        });
      }
    }

    const roofRing = shaftRing;
    const axis = principalAxis(roofRing, cx, cz);
    const widthM = (axis.maxPerp * 2) / METERS_TO_WORLD;
    const pitched = !forceFlat && pitchedKind && b.heightM <= 22 && widthM < 28 && n <= 12;
    const riseM = pitched ? Math.min(8.5, Math.max(2.4, widthM * 0.36)) : 0;
    const riseWorld = riseM * METERS_TO_WORLD * vScale;
    const eavesY = heightWorld;

    const roofYAt = (p: { x: number; z: number }): number => {
      if (!pitched) return eavesY;
      if (roof === ROOF_GABLED) {
        const d = Math.abs((p.x - cx) * axis.px + (p.z - cz) * axis.pz);
        return eavesY + riseWorld * (1 - Math.min(1, d / axis.maxPerp));
      }
      const d = Math.hypot(p.x - cx, p.z - cz);
      let maxD = 1e-6;
      for (const q of roofRing) maxD = Math.max(maxD, Math.hypot(q.x - cx, q.z - cz));
      return eavesY + riseWorld * (1 - Math.min(1, d / maxD));
    };

    if (pitched) {
      const count = roofRing.length;
      for (let i = 0; i < count; i++) {
        const a = roofRing[i]!;
        const bp = roofRing[(i + 1) % count]!;
        const ya = roofYAt(a);
        const yb = roofYAt(bp);
        if (ya <= eavesY + 1e-4 && yb <= eavesY + 1e-4) continue;
        const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
        const g0 = pushVertex(a.x, eavesY, a.z, nx, 0, nz, baseHex);
        const g1 = pushVertex(bp.x, eavesY, bp.z, nx, 0, nz, baseHex);
        const g2 = pushVertex(bp.x, yb, bp.z, nx, 0, nz, roofHex);
        const g3 = pushVertex(a.x, ya, a.z, nx, 0, nz, roofHex);
        indices.push(g0, g1, g2, g0, g2, g3);
      }
    }

    const emitRoof = (
      useRing: { x: number; z: number }[],
      yAt: (p: { x: number; z: number }) => number,
      hex: number,
    ) => {
      for (let t = 0; t < b.indices.length; t += 3) {
        const i0 = b.indices[t]!;
        let i1 = b.indices[t + 1]!;
        let i2 = b.indices[t + 2]!;
        const p0 = useRing[i0];
        const p1 = useRing[i1];
        const p2 = useRing[i2];
        if (!p0 || !p1 || !p2) continue;
        const y0 = yAt(p0);
        let y1 = yAt(p1);
        let y2 = yAt(p2);
        const axv = p1.x - p0.x;
        const ayv = y1 - y0;
        const azv = p1.z - p0.z;
        const bxv = p2.x - p0.x;
        const byv = y2 - y0;
        const bzv = p2.z - p0.z;
        let nx = ayv * bzv - azv * byv;
        let ny = azv * bxv - axv * bzv;
        let nz = axv * byv - ayv * bxv;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
          const tmp = i1;
          i1 = i2;
          i2 = tmp;
          const ty = y1;
          y1 = y2;
          y2 = ty;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const q0 = useRing[i0]!;
        const q1 = useRing[i1]!;
        const q2 = useRing[i2]!;
        const v0 = pushVertex(q0.x, yAt(q0), q0.z, nx, ny, nz, hex);
        const v1 = pushVertex(q1.x, yAt(q1), q1.z, nx, ny, nz, hex);
        const v2 = pushVertex(q2.x, yAt(q2), q2.z, nx, ny, nz, hex);
        indices.push(v0, v1, v2);
      }
    };

    if (podium) emitRoof(ring, () => podiumWorld, pal.mixHex(roofHex, pal.AO_DARK, 0.18));
    if (stepped) emitRoof(ring, () => stepY, pal.mixHex(roofHex, pal.AO_DARK, 0.12));
    emitRoof(roofRing, roofYAt, roofHex);

    const wantParapet = !pitched && (major || areaM2 > 140) && b.heightM >= 8 && n <= 24;
    if (wantParapet) {
      const lip = 0.9 * METERS_TO_WORLD;
      const inset = 0.35 * METERS_TO_WORLD;
      const thick = 0.28 * METERS_TO_WORLD;
      const count = roofRing.length;
      for (let i = 0; i < count; i++) {
        const a = roofRing[i]!;
        const bp = roofRing[(i + 1) % count]!;
        const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
        const ax = a.x - nx * inset;
        const az = a.z - nz * inset;
        const bx = bp.x - nx * inset;
        const bz = bp.z - nz * inset;
        const y0 = eavesY;
        const y1 = eavesY + lip;
        const i0 = pushVertex(ax, y0, az, nx, 0, nz, roofHex);
        const i1 = pushVertex(bx, y0, bz, nx, 0, nz, roofHex);
        const i2 = pushVertex(bx, y1, bz, nx, 0, nz, pal.CORNICE);
        const i3 = pushVertex(ax, y1, az, nx, 0, nz, pal.CORNICE);
        indices.push(i0, i1, i2, i0, i2, i3);
        const ox = nx * thick;
        const oz = nz * thick;
        const c0 = pushVertex(ax - ox, y1, az - oz, 0, 1, 0, pal.CORNICE);
        const c1 = pushVertex(bx - ox, y1, bz - oz, 0, 1, 0, pal.CORNICE);
        const c2 = pushVertex(bx, y1, bz, 0, 1, 0, pal.CORNICE);
        const c3 = pushVertex(ax, y1, az, 0, 1, 0, pal.CORNICE);
        indices.push(c0, c1, c2, c0, c2, c3);
      }
    }

    const ridgeY = eavesY + riseWorld;
    if (pitched && (style === STYLE_HOUSE || style === STYLE_TERRACE) && areaM2 < 480) {
      const count = areaM2 > 140 ? 3 : 1;
      for (let k = 0; k < count; k++) {
        const along = ((k + 1) / (count + 1) - 0.5) * axis.maxPerp * 1.4;
        pushBox(
          cx + axis.ax * along,
          ridgeY - 0.4 * METERS_TO_WORLD,
          cz + axis.az * along,
          0.9 * METERS_TO_WORLD,
          2.2 * METERS_TO_WORLD * vScale,
          0.9 * METERS_TO_WORLD,
          pal.CHIMNEY,
        );
      }
    }

    if (
      scratch &&
      !pitched &&
      (style === STYLE_OFFICE || style === STYLE_TOWER || style === STYLE_APARTMENTS) &&
      b.heightM >= 12 &&
      areaM2 > 180
    ) {
      const yaw = Math.atan2(axis.ax, axis.az);
      const s = Math.min(5.5, Math.sqrt(areaM2) * 0.12) * METERS_TO_WORLD;
      pushRooftopMatrix(
        scratch,
        cx,
        eavesY,
        cz,
        s * 1.1,
        2.4 * METERS_TO_WORLD * vScale,
        s * 0.75,
        yaw,
        ROOF_CLUTTER[seed % ROOF_CLUTTER.length]!,
      );
      if (areaM2 > 320) {
        pushRooftopMatrix(
          scratch,
          cx + axis.ax * s * 1.6,
          eavesY,
          cz + axis.az * s * 1.6,
          s * 0.7,
          1.5 * METERS_TO_WORLD * vScale,
          s * 0.5,
          yaw,
          ROOF_CLUTTER[(seed + 1) % ROOF_CLUTTER.length]!,
        );
      }
      if (areaM2 > 500 && major) {
        pushRooftopMatrix(
          scratch,
          cx - axis.px * s * 0.9,
          eavesY,
          cz - axis.pz * s * 0.9,
          s * 0.45,
          0.55 * METERS_TO_WORLD,
          s * 0.45,
          yaw,
          ROOF_CLUTTER[(seed + 2) % ROOF_CLUTTER.length]!,
        );
      }
    }

    if (scratch) {
      scratch.picks.push({
        x: cx,
        z: cz,
        heightWorld,
        heightM: b.heightM,
        areaM2,
        style,
        district,
        label: pal.USE_LABEL[style] ?? pal.STYLE_LABEL[style] ?? 'Building',
        address: pal.streetAddress(district, seed),
      });
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.chunkId = chunkId;
  mesh.userData.major = major;
  return mesh;
}

type OrientedBoxFn = (
  cx: number,
  y0: number,
  cz: number,
  along: number,
  height: number,
  out: number,
  tx: number,
  tz: number,
  nx: number,
  nz: number,
  hex: number,
) => void;

function emitBayWindows(
  scratch: CityScratch,
  pushOrientedBox: OrientedBoxFn,
  a: { x: number; z: number },
  bp: { x: number; z: number },
  nx: number,
  nz: number,
  y0: number,
  y1: number,
  style: number,
  vScale: number,
  shopWorld: number,
  wallHex: number,
  seed: number,
): void {
  const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
  const edgeM = elen / METERS_TO_WORLD;
  const count = bayCountForEdge(edgeM);
  const tx = (bp.x - a.x) / elen;
  const tz = (bp.z - a.z) / elen;
  const depth =
    (style === STYLE_APARTMENTS || style === STYLE_OFFICE ? 1.45 : 2.15) * METERS_TO_WORLD;
  const bayW = Math.min(2.6 * METERS_TO_WORLD, elen / (count + 0.6));
  const sill = y0 + (shopWorld > 0.02 ? shopWorld : 0.55 * METERS_TO_WORLD * vScale);
  const head = y1 - 0.45 * METERS_TO_WORLD * vScale;
  const bayH = head - sill;
  if (bayH < 1.8 * METERS_TO_WORLD) return;

  const glass = pal.windowHex(seed);
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const mx = a.x + (bp.x - a.x) * t;
    const mz = a.z + (bp.z - a.z) * t;
    const cx = mx + nx * (depth / 2);
    const cz = mz + nz * (depth / 2);
    pushOrientedBox(cx, sill, cz, bayW, bayH, depth, tx, tz, nx, nz, wallHex);
    const paneW = bayW * 0.62;
    const paneH = Math.min(bayH * 0.42, 2.1 * METERS_TO_WORLD * vScale);
    const frontX = mx + nx * (depth + 0.04 * METERS_TO_WORLD);
    const frontZ = mz + nz * (depth + 0.04 * METERS_TO_WORLD);
    const rows = bayH > 4.2 * METERS_TO_WORLD ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const py = sill + ((r + 0.5) / rows) * bayH;
      pushWindowMatrix(scratch, frontX, py, frontZ, nx, nz, paneW, paneH, glass);
    }
  }
}

function emitFacadeWindows(
  scratch: CityScratch,
  a: { x: number; z: number },
  bp: { x: number; z: number },
  nx: number,
  nz: number,
  y0: number,
  y1: number,
  style: number,
  major: boolean,
  shopWorld: number,
  vScale: number,
  seed: number,
): void {
  const edgeM = Math.hypot(bp.x - a.x, bp.z - a.z) / METERS_TO_WORLD;
  const spanY = y1 - y0;
  const heightM = spanY / METERS_TO_WORLD;
  if (!wantFacadeWindows(edgeM, heightM, style)) return;

  const winStart = y0 + (shopWorld > 0.02 ? shopWorld : 0.7 * METERS_TO_WORLD * vScale);
  const winEnd = y1 - 0.55 * METERS_TO_WORLD * vScale;
  if (winEnd - winStart < 1.6 * METERS_TO_WORLD) return;

  const rhythm = facadeWindowRhythm(style, major, seed);
  const winW = (major ? 2.05 : 1.9) * METERS_TO_WORLD;
  const winH = (major ? 2.4 : 2.2) * METERS_TO_WORLD * Math.min(vScale, 1.8);
  const marginU = 0.5;
  const usableU = edgeM - marginU * 2;
  if (usableU < winW / METERS_TO_WORLD) return;

  let cols = Math.max(1, Math.floor(usableU / rhythm.pitchU));
  let rows = Math.max(1, Math.floor((winEnd - winStart) / (rhythm.pitchV * METERS_TO_WORLD * vScale)));
  cols = Math.min(cols, rhythm.colCap);
  rows = Math.min(rows, rhythm.rowCap);
  const maxCount = major ? 48 : 16;
  if (cols * rows > maxCount) {
    rows = Math.max(1, Math.floor(maxCount / cols));
  }

  const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
  const tx = (bp.x - a.x) / elen;
  const tz = (bp.z - a.z) / elen;
  const inset = -0.08 * METERS_TO_WORLD;
  const u0 = marginU * METERS_TO_WORLD + winW / 2;
  const uSpan = elen - 2 * (marginU * METERS_TO_WORLD);
  const vSpan = winEnd - winStart;
  const glass = pal.windowHex(seed);

  for (let r = 0; r < rows; r++) {
    const y = winStart + ((r + 0.5) / rows) * vSpan;
    for (let c = 0; c < cols; c++) {
      const u = u0 + ((c + 0.5) / cols) * (uSpan - winW);
      const x = a.x + tx * u - nx * inset;
      const z = a.z + tz * u - nz * inset;
      pushWindowMatrix(scratch, x, y, z, nx, nz, winW, winH, glass);
    }
  }
}

export function buildWindowMesh(scratch: CityScratch): THREE.InstancedMesh | null {
  const count = Math.floor(scratch.windows.length / 16);
  if (count === 0) return null;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    m.fromArray(scratch.windows, i * 16);
    mesh.setMatrixAt(i, m);
    c.setHex(scratch.windowColors[i] ?? pal.WINDOW);
    mesh.setColorAt(i, c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function buildRooftopMesh(scratch: CityScratch): THREE.InstancedMesh | null {
  const count = Math.floor(scratch.rooftops.length / 16);
  if (count === 0) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    m.fromArray(scratch.rooftops, i * 16);
    mesh.setMatrixAt(i, m);
    c.setHex(scratch.rooftopColors[i] ?? pal.HVAC);
    mesh.setColorAt(i, c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

const SIGN_MAX = 80;

function makeSignTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a3340';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#e8eef4';
  ctx.font = 'bold 28px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Shared canvas-texture nameplates for occasional façade lettering. */
export function buildFacadeSigns(scratch: CityScratch): THREE.Group | null {
  if (typeof document === 'undefined') return null;
  const signs = scratch.signs.slice(0, SIGN_MAX);
  if (signs.length === 0) return null;
  const group = new THREE.Group();
  const byName = new Map<string, FacadeSign[]>();
  for (const s of signs) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  const dummy = new THREE.Object3D();
  for (const [name, list] of byName) {
    const mat = new THREE.MeshBasicMaterial({
      map: makeSignTexture(name),
      transparent: false,
      fog: false,
      depthWrite: true,
    });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.set(s.w, s.h, 1);
      dummy.lookAt(s.x + s.nx, s.y, s.z + s.nz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  return group;
}

function buildMergedPolyMesh(
  polys: CityPoly[],
  color: number,
  y: number,
  opts: { receiveShadow?: boolean; doubleSide?: boolean; vary?: boolean } = {},
): THREE.Mesh | null {
  let totalVerts = 0;
  let totalTris = 0;
  for (const p of polys) {
    totalVerts += p.verts.length / 2;
    totalTris += p.indices.length / 3;
  }
  if (totalTris === 0) return null;

  const positions = new Float32Array(totalVerts * 3);
  const colors = opts.vary ? new Float32Array(totalVerts * 3) : null;
  const indices = new Uint32Array(totalTris * 3);
  let vOff = 0;
  let cOff = 0;
  let iOff = 0;
  let vertBase = 0;
  const base = new THREE.Color(color);
  const dark = new THREE.Color(color).offsetHSL(0, 0.04, -0.08);
  const lite = new THREE.Color(color).offsetHSL(0.02, -0.02, 0.07);
  for (const p of polys) {
    const n = p.verts.length / 2;
    for (let i = 0; i < n; i++) {
      const x = dequantizeX(p.verts[i * 2]!);
      const z = dequantizeY(p.verts[i * 2 + 1]!);
      positions[vOff++] = x;
      positions[vOff++] = y;
      positions[vOff++] = z;
      if (colors) {
        const h =
          Math.imul(Math.round(x * 40), 374761393) ^ Math.imul(Math.round(z * 40), 668265263);
        const u = ((h >>> 0) % 1000) / 1000;
        const c = u < 0.38 ? dark : u > 0.72 ? lite : base;
        colors[cOff++] = c.r;
        colors[cOff++] = c.g;
        colors[cOff++] = c.b;
      }
    }
    for (let i = 0; i < p.indices.length; i++) indices[iOff++] = p.indices[i]! + vertBase;
    vertBase += n;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({
    color: colors ? 0xffffff : color,
    vertexColors: !!colors,
    side: opts.doubleSide === false ? THREE.FrontSide : THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = opts.receiveShadow !== false;
  mesh.castShadow = false;
  return mesh;
}

export function buildWater(cityData: CityData): THREE.Object3D | null {
  const water = buildMergedPolyMesh(cityData.water, pal.WATER, WATER_Y);
  if (!water) return null;
  const group = new THREE.Group();
  group.add(water);

  const bankPos: number[] = [];
  const bankIdx: number[] = [];
  const halfW = 3.4 * METERS_TO_WORLD;
  for (const poly of cityData.water) {
    const n = poly.verts.length / 2;
    if (n < 3) continue;
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      pts.push({ x: dequantizeX(poly.verts[i * 2]!), z: dequantizeY(poly.verts[i * 2 + 1]!) });
    }
    pts.push(pts[0]!);
    appendRibbon(bankPos, bankIdx, pts, halfW, WATER_BANK_Y);
  }
  if (bankPos.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bankPos, 3));
    g.setIndex(bankIdx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({
        color: pal.WATER_BANK,
        side: THREE.DoubleSide,
        fog: true,
      }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function parkCentroid(
  park: CityPoly,
): { x: number; z: number; ring: { x: number; z: number }[]; areaM2: number } | null {
  const n = park.verts.length / 2;
  if (n < 3) return null;
  const ring = new Array<{ x: number; z: number }>(n);
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const x = dequantizeX(park.verts[i * 2]!);
    const z = dequantizeY(park.verts[i * 2 + 1]!);
    ring[i] = { x, z };
    cx += x;
    cz += z;
  }
  cx /= n;
  cz /= n;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    acc += a.x * b.z - b.x * a.z;
  }
  const areaM2 = (Math.abs(acc) * 0.5) / (METERS_TO_WORLD * METERS_TO_WORLD);
  return { x: cx, z: cz, ring, areaM2 };
}

function parkShadeAt(
  x: number,
  z: number,
  base: THREE.Color,
  dark: THREE.Color,
  lite: THREE.Color,
): THREE.Color {
  const h = Math.imul(Math.round(x * 22), 374761393) ^ Math.imul(Math.round(z * 22), 668265263);
  const u = ((h >>> 0) % 1000) / 1000;
  return u < 0.32 ? dark : u > 0.7 ? lite : base;
}

function emitParkTriangle(
  positions: number[],
  colors: number[],
  indices: number[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  y: number,
  depth: number,
  base: THREE.Color,
  dark: THREE.Color,
  lite: THREE.Color,
): void {
  const areaWorld = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * 0.5;
  const areaM2 = areaWorld / (METERS_TO_WORLD * METERS_TO_WORLD);
  if (depth < 2 && areaM2 > 1600) {
    const mx = (ax + bx + cx) / 3;
    const mz = (az + bz + cz) / 3;
    emitParkTriangle(
      positions,
      colors,
      indices,
      ax,
      az,
      bx,
      bz,
      mx,
      mz,
      y,
      depth + 1,
      base,
      dark,
      lite,
    );
    emitParkTriangle(
      positions,
      colors,
      indices,
      bx,
      bz,
      cx,
      cz,
      mx,
      mz,
      y,
      depth + 1,
      base,
      dark,
      lite,
    );
    emitParkTriangle(
      positions,
      colors,
      indices,
      cx,
      cz,
      ax,
      az,
      mx,
      mz,
      y,
      depth + 1,
      base,
      dark,
      lite,
    );
    return;
  }
  const push = (x: number, z: number): number => {
    const c = parkShadeAt(x, z, base, dark, lite);
    const i = positions.length / 3;
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
    return i;
  };
  const i0 = push(ax, az);
  const i1 = push(bx, bz);
  const i2 = push(cx, cz);
  indices.push(i0, i1, i2);
}

function buildParkGrass(cityData: CityData): THREE.Mesh | null {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color(pal.PARK);
  const dark = new THREE.Color(pal.PARK).offsetHSL(0.02, 0.06, -0.11);
  const lite = new THREE.Color(pal.PARK).offsetHSL(-0.03, -0.04, 0.1);
  for (const p of cityData.parks) {
    const n = p.verts.length / 2;
    if (n < 3) continue;
    const ring: { x: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      ring.push({ x: dequantizeX(p.verts[i * 2]!), z: dequantizeY(p.verts[i * 2 + 1]!) });
    }
    for (let t = 0; t + 2 < p.indices.length; t += 3) {
      const a = ring[p.indices[t]!]!;
      const b = ring[p.indices[t + 1]!]!;
      const c = ring[p.indices[t + 2]!]!;
      if (!a || !b || !c) continue;
      emitParkTriangle(
        positions,
        colors,
        indices,
        a.x,
        a.z,
        b.x,
        b.z,
        c.x,
        c.z,
        PARK_Y,
        0,
        base,
        dark,
        lite,
      );
    }
  }
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export function buildParks(cityData: CityData): THREE.Group | null {
  const grass = buildParkGrass(cityData);
  if (!grass) return null;
  const group = new THREE.Group();
  group.add(grass);

  const pathPos: number[] = [];
  const pathIdx: number[] = [];
  const halfW = 2.8 * METERS_TO_WORLD;
  for (const park of cityData.parks) {
    const info = parkCentroid(park);
    if (!info || info.areaM2 < 18_000) continue;
    const { ring, x: cx, z: cz } = info;
    let maxI = 0;
    let maxD = 0;
    for (let i = 0; i < ring.length; i++) {
      const d = Math.hypot(ring[i]!.x - cx, ring[i]!.z - cz);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    const a = ring[maxI]!;
    const b = ring[(maxI + Math.floor(ring.length / 2)) % ring.length]!;
    const pts = [
      { x: a.x * 0.72 + cx * 0.28, z: a.z * 0.72 + cz * 0.28 },
      { x: cx, z: cz },
      { x: b.x * 0.72 + cx * 0.28, z: b.z * 0.72 + cz * 0.28 },
    ];
    const ribbon = buildRibbonGeometry(pts, halfW, PARK_Y + 0.012);
    const base = pathPos.length / 3;
    for (const v of ribbon.positions) pathPos.push(v);
    for (const i of ribbon.indices) pathIdx.push(i + base);
  }
  if (pathPos.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pathPos, 3));
    g.setIndex(pathIdx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({ color: pal.PARK_PATH, side: THREE.DoubleSide, fog: true }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function mulberry(h: number): number {
  return (Math.imul(h, 1103515245) + 12345) | 0;
}

/** Instanced low-poly trees in parks and along major streets. */
export function buildParkTrees(cityData: CityData): THREE.Group | null {
  const dummy = new THREE.Object3D();
  const spots: { x: number; z: number; scale: number; shade: number; cluster: boolean }[] = [];
  const groves: { x: number; z: number; scale: number; shade: number }[] = [];

  for (const park of cityData.parks) {
    const info = parkCentroid(park);
    if (!info || info.areaM2 < 90) continue;
    const count = Math.min(80, Math.max(3, Math.round(info.areaM2 / 900)));
    let h = Math.imul(info.ring.length + 1, 2654435761) ^ park.verts[0]!;
    for (let t = 0; t < count && spots.length < TREE_MAX; t++) {
      h = mulberry(h);
      const ang = ((h >>> 0) / 4294967296) * Math.PI * 2;
      const rad =
        Math.sqrt(((h >>> 8) & 255) / 255) * Math.sqrt(info.areaM2) * METERS_TO_WORLD * 0.28;
      spots.push({
        x: info.x + Math.cos(ang) * rad,
        z: info.z + Math.sin(ang) * rad,
        scale: 14.5 + ((h >>> 16) & 7) * 0.9,
        shade: (h >>> 20) % 3,
        cluster: false,
      });
    }
    if (info.areaM2 > 8_000) {
      const groveCount = Math.min(36, Math.max(2, Math.round(info.areaM2 / 12_000)));
      for (let t = 0; t < groveCount && groves.length < GROVE_MAX; t++) {
        h = mulberry(h);
        const ang = ((h >>> 0) / 4294967296) * Math.PI * 2;
        const rad =
          Math.sqrt(((h >>> 8) & 255) / 255) * Math.sqrt(info.areaM2) * METERS_TO_WORLD * 0.32;
        groves.push({
          x: info.x + Math.cos(ang) * rad,
          z: info.z + Math.sin(ang) * rad,
          scale: 70 + ((h >>> 16) & 15) * 3.2,
          shade: (h >>> 20) % 3,
        });
      }
    }
  }

  const streetSpacing = [20, 26, 36];
  const rings = waterRings(cityData);
  for (const road of cityData.roads as CityRoad[]) {
    if (road.tier > 2 || spots.length >= TREE_MAX) continue;
    const pts = roadPts(road);
    if (!pts) continue;
    const spacing = streetSpacing[road.tier]! * METERS_TO_WORLD;
    const offset =
      (ROAD_WIDTHS_M[road.tier]! / 2 + SIDEWALK_M[road.tier]! * 0.72) * METERS_TO_WORLD;
    let travelled = 0;
    let nextAt = spacing * (0.4 + (road.pts[0]! % 79) / 200);
    let sign = road.pts[0]! % 2 === 0 ? 1 : -1;
    let h = road.pts[0]! ^ 0x9e3779b9;
    for (let i = 0; i < pts.length - 1 && spots.length < TREE_MAX; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len;
      const pz = dx / len;
      while (nextAt <= travelled + len && spots.length < TREE_MAX) {
        const t = (nextAt - travelled) / len;
        h = mulberry(h);
        if (road.tier === 2 ? ((h >>> 8) & 3) === 0 : ((h >>> 8) & 7) !== 0) {
          const sx = a.x + dx * t + px * offset * sign;
          const sz = a.z + dz * t + pz * offset * sign;
          if (!pointOverWater(sx, sz, rings) && !pointOnPrefabDeck(sx, sz)) {
            spots.push({
              x: sx,
              z: sz,
              scale: 12.4 + ((h >>> 16) & 5) * 0.7,
              shade: (h >>> 22) % 3,
              cluster: true,
            });
          }
        }
        nextAt += spacing;
        sign = -sign;
      }
      travelled += len;
    }
  }

  if (spots.length === 0) return null;

  const canopyGeos = pal.TREE_CANOPY.map(
    (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, fog: true }),
  );
  const counts = [0, 0, 0];
  for (const s of spots) counts[s.shade]! += s.cluster ? 3 : 1;
  const canopies: THREE.InstancedMesh[] = [];
  for (let shade = 0; shade < 3; shade++) {
    if (counts[shade]! <= 0) continue;
    const mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      canopyGeos[shade]!,
      counts[shade]!,
    );
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    canopies[shade] = mesh;
  }
  const cursor = [0, 0, 0];
  const trunkMat = new THREE.MeshLambertMaterial({ color: pal.TREE_TRUNK, fog: true });
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.22, 1, 5),
    trunkMat,
    spots.length,
  );
  trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  trunks.castShadow = true;
  trunks.frustumCulled = false;

  const placeCanopy = (
    shade: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rot: number,
  ) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, rot, 0);
    dummy.updateMatrix();
    const ci = cursor[shade]!;
    canopies[shade]!.setMatrixAt(ci, dummy.matrix);
    cursor[shade] = ci + 1;
  };

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]!;
    const r = s.scale * METERS_TO_WORLD;
    placeCanopy(s.shade, s.x, r * 0.95, s.z, r, r * 0.78, r, ((s.shade + i) * 0.7) % (Math.PI * 2));
    if (s.cluster) {
      const a = i * 1.7;
      placeCanopy(
        s.shade,
        s.x + Math.cos(a) * r * 0.55,
        r * 1.05,
        s.z + Math.sin(a) * r * 0.55,
        r * 0.62,
        r * 0.5,
        r * 0.62,
        a,
      );
      placeCanopy(
        s.shade,
        s.x + Math.cos(a + 2.1) * r * 0.48,
        r * 0.88,
        s.z + Math.sin(a + 2.1) * r * 0.48,
        r * 0.55,
        r * 0.48,
        r * 0.55,
        a + 1.3,
      );
    }
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(s.x, r * 0.28, s.z);
    dummy.scale.set(r * 0.18, r * 0.55, r * 0.18);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  for (const c of canopies) if (c) c.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunks);
  for (const c of canopies) if (c) group.add(c);

  if (groves.length > 0) {
    const groveCounts = [0, 0, 0];
    for (const g of groves) groveCounts[g.shade]! += 1;
    const groveCursor = [0, 0, 0];
    for (let shade = 0; shade < 3; shade++) {
      if (groveCounts[shade]! <= 0) continue;
      const mesh = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        canopyGeos[shade]!,
        groveCounts[shade]!,
      );
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.grove = true;
      mesh.visible = false;
      for (let i = 0; i < groves.length; i++) {
        const s = groves[i]!;
        if (s.shade !== shade) continue;
        const r = s.scale * METERS_TO_WORLD;
        dummy.rotation.set(0, (i * 0.51) % (Math.PI * 2), 0);
        dummy.position.set(s.x, r * 0.42, s.z);
        dummy.scale.set(r, r * 0.38, r);
        dummy.updateMatrix();
        mesh.setMatrixAt(groveCursor[shade]!, dummy.matrix);
        groveCursor[shade]! += 1;
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }
  return group;
}

function buildRibbonGeometry(
  ptsWorld: { x: number; z: number }[],
  halfWidthWorld: number,
  y: number,
): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = ptsWorld.length;
  if (n < 2) return { positions, indices };

  const nx: number[] = new Array(n);
  const nz: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = ptsWorld[Math.max(0, i - 1)]!;
    const next = ptsWorld[Math.min(n - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    nx[i] = (-dz / len) * halfWidthWorld;
    nz[i] = (dx / len) * halfWidthWorld;
  }

  for (let i = 0; i < n - 1; i++) {
    const a = ptsWorld[i]!;
    const b = ptsWorld[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 0.35 * METERS_TO_WORLD) continue;
    const base = positions.length / 3;
    positions.push(
      a.x + nx[i]!,
      y,
      a.z + nz[i]!,
      a.x - nx[i]!,
      y,
      a.z - nz[i]!,
      b.x - nx[i + 1]!,
      y,
      b.z - nz[i + 1]!,
      b.x + nx[i + 1]!,
      y,
      b.z + nz[i + 1]!,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, indices };
}

function roadPts(road: CityRoad): { x: number; z: number }[] | null {
  const n = road.pts.length / 2;
  if (n < 2) return null;
  const pts = new Array<{ x: number; z: number }>(n);
  for (let i = 0; i < n; i++)
    pts[i] = { x: dequantizeX(road.pts[i * 2]!), z: dequantizeY(road.pts[i * 2 + 1]!) };
  return pts;
}

function appendRibbon(
  dstPos: number[],
  dstIdx: number[],
  pts: { x: number; z: number }[],
  halfW: number,
  y: number,
): void {
  const r = buildRibbonGeometry(pts, halfW, y);
  const base = dstPos.length / 3;
  for (const v of r.positions) dstPos.push(v);
  for (const i of r.indices) dstIdx.push(i + base);
}

function addCrosswalk(
  pos: number[],
  idx: number[],
  x: number,
  z: number,
  tx: number,
  tz: number,
  roadHalf: number,
): void {
  const nx = -tz;
  const nz = tx;
  const bars = 6;
  const barW = 0.85 * METERS_TO_WORLD;
  const gap = 1.05 * METERS_TO_WORLD;
  const start = -((bars - 1) / 2) * gap;
  for (let i = 0; i < bars; i++) {
    const along = start + i * gap;
    const cx = x + tx * along;
    const cz = z + tz * along;
    const hx = nx * roadHalf * 0.82;
    const hz = nz * roadHalf * 0.82;
    const wx = tx * barW * 0.5;
    const wz = tz * barW * 0.5;
    const base = pos.length / 3;
    pos.push(
      cx - hx - wx,
      MARK_Y + 0.002,
      cz - hz - wz,
      cx + hx - wx,
      MARK_Y + 0.002,
      cz + hz - wz,
      cx + hx + wx,
      MARK_Y + 0.002,
      cz + hz + wz,
      cx - hx + wx,
      MARK_Y + 0.002,
      cz - hz + wz,
    );
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function pointInRing(x: number, z: number, ring: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const zi = ring[i]!.z;
    const xj = ring[j]!.x;
    const zj = ring[j]!.z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function waterRings(cityData: CityData): { x: number; z: number }[][] {
  return cityData.water.map((poly) => {
    const n = poly.verts.length / 2;
    const ring = new Array<{ x: number; z: number }>(n);
    for (let i = 0; i < n; i++) {
      ring[i] = { x: dequantizeX(poly.verts[i * 2]!), z: dequantizeY(poly.verts[i * 2 + 1]!) };
    }
    return ring;
  });
}

function pointOverWater(x: number, z: number, rings: { x: number; z: number }[][]): boolean {
  for (const ring of rings) {
    if (pointInRing(x, z, ring)) return true;
  }
  return false;
}

function pointOnPrefabDeck(x: number, z: number): boolean {
  for (const landmark of LANDMARKS) {
    if (landmark.kind !== 'oldstreet') continue;
    const at = project(landmark.at);
    const r = (landmark.exclusionM ?? 90) * METERS_TO_WORLD;
    if (Math.hypot(x - at.x, z - at.y) < r) return true;
  }
  return false;
}

/** Consecutive over-water centreline longer than this is a river crossing. */
export const BRIDGE_SPAN_MIN_M = 55;
/** Pull stitch endpoints inland so the ribbon overlaps the shoreline road. */
const LAND_OVERLAP_M = 16;
const CROSSING_STEP_M = 8;
const CROSSING_MAX_M = 480;
const CROSSING_SNAP_M = 52;
const SEED_MATCH_M = 55;

export type RoadRun = { pts: { x: number; z: number }[]; span: boolean };

/**
 * Last dry point along land→wet. Land ribbons stop at the bank instead of
 * leaving a water gap between the OSM dashes and the stitched carriageway.
 */
function shorelinePoint(
  land: { x: number; z: number },
  wet: { x: number; z: number },
  overWater: (x: number, z: number) => boolean,
): { x: number; z: number } | null {
  if (overWater(land.x, land.z)) return null;
  if (Math.hypot(wet.x - land.x, wet.z - land.z) < 3 * METERS_TO_WORLD) return null;
  let x0 = land.x;
  let z0 = land.z;
  let x1 = wet.x;
  let z1 = wet.z;
  for (let i = 0; i < 14; i++) {
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    if (overWater(mx, mz)) {
      x1 = mx;
      z1 = mz;
    } else {
      x0 = mx;
      z0 = mz;
    }
  }
  return { x: x0, z: z0 };
}

/**
 * OSM often puts dry nodes on each bank and none in the channel. Vertex-only
 * wet tests then draw the whole land→land segment as a road (sidewalk tan,
 * miter spikes at the abutment). Sample the edge; a long water run is a span.
 */
function waterChannelOnEdge(
  a: { x: number; z: number },
  b: { x: number; z: number },
  overWater: (x: number, z: number) => boolean,
): { first: { x: number; z: number }; last: { x: number; z: number } } | null {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const minWater = BRIDGE_SPAN_MIN_M * METERS_TO_WORLD;
  if (dist < minWater) return null;
  const step = CROSSING_STEP_M * METERS_TO_WORLD;
  const ux = (b.x - a.x) / dist;
  const uz = (b.z - a.z) / dist;
  let runFirst: { x: number; z: number } | null = null;
  let runLast: { x: number; z: number } | null = null;
  let run = 0;
  let bestRun = 0;
  let bestFirst: { x: number; z: number } | null = null;
  let bestLast: { x: number; z: number } | null = null;
  for (let t = 0; t <= dist; t += step) {
    const p = { x: a.x + ux * t, z: a.z + uz * t };
    if (overWater(p.x, p.z)) {
      run += step;
      if (!runFirst) runFirst = p;
      runLast = p;
      if (run > bestRun) {
        bestRun = run;
        bestFirst = runFirst;
        bestLast = runLast;
      }
    } else {
      run = 0;
      runFirst = null;
    }
  }
  if (bestRun < minWater || !bestFirst || !bestLast) return null;
  return { first: bestFirst, last: bestLast };
}

/** Insert wet markers on dry→dry edges that actually cross a channel. */
function polylineWithWaterBreaks(
  pts: { x: number; z: number }[],
  overWater: (x: number, z: number) => boolean,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) {
      const prev = pts[i - 1]!;
      if (!overWater(prev.x, prev.z) && !overWater(p.x, p.z)) {
        const ch = waterChannelOnEdge(prev, p, overWater);
        if (ch) {
          out.push(ch.first);
          if (Math.hypot(ch.last.x - ch.first.x, ch.last.z - ch.first.z) > METERS_TO_WORLD) {
            out.push(ch.last);
          }
        }
      }
    }
    out.push(p);
  }
  return out;
}

/**
 * Land ribbons only. Wet vertices are dropped — OSM ways over water are
 * spaghetti and explode into abutment triangles when mitred onto the bank.
 * `riverCrossingSpans` draws one clean land-to-land asphalt ribbon instead.
 */
export function splitRoadRuns(
  pts: { x: number; z: number }[],
  overWater: (x: number, z: number) => boolean,
): RoadRun[] {
  if (pts.length < 2) return [];
  const seq = polylineWithWaterBreaks(pts, overWater);
  const wet = seq.map((p) => overWater(p.x, p.z));
  const groups: { start: number; end: number; wet: boolean }[] = [];
  let i = 0;
  while (i < seq.length) {
    const w = wet[i]!;
    let j = i + 1;
    while (j < seq.length && wet[j] === w) j += 1;
    groups.push({ start: i, end: j, wet: w });
    i = j;
  }
  const out: RoadRun[] = [];
  for (let g = 0; g < groups.length; g++) {
    const run = groups[g]!;
    if (run.wet) continue;
    const headWet = g > 0 && groups[g - 1]!.wet;
    const tailWet = g + 1 < groups.length && groups[g + 1]!.wet;
    const slice = seq.slice(run.start, run.end);
    let outPts: { x: number; z: number }[] = [];
    if (slice.length === 1) {
      const land = slice[0]!;
      const wetPt = headWet ? seq[run.start - 1]! : tailWet ? seq[run.end]! : null;
      if (!wetPt) continue;
      const dx = land.x - wetPt.x;
      const dz = land.z - wetPt.z;
      const len = Math.hypot(dx, dz) || 1;
      const inland = {
        x: land.x + (dx / len) * 16 * METERS_TO_WORLD,
        z: land.z + (dz / len) * 16 * METERS_TO_WORLD,
      };
      const shore = shorelinePoint(land, wetPt, overWater) ?? land;
      outPts = [inland, shore];
    } else if (slice.length >= 2) {
      outPts = slice.slice();
      if (headWet) {
        const shore = shorelinePoint(seq[run.start]!, seq[run.start - 1]!, overWater);
        if (shore) outPts = [shore, ...outPts];
      }
      if (tailWet) {
        const shore = shorelinePoint(seq[run.end - 1]!, seq[run.end]!, overWater);
        if (shore) outPts = [...outPts, shore];
      }
    }
    if (outPts.length >= 2) out.push({ pts: outPts, span: false });
  }
  return out;
}

/** OSM land ribbons that still span a channel. Zero after the edge split. */
export function countLandRibbonsOverWater(cityData: CityData): number {
  const rings = waterRings(cityData);
  const over = (x: number, z: number) => pointOverWater(x, z, rings);
  let n = 0;
  for (const road of cityData.roads as CityRoad[]) {
    const pts = roadPts(road);
    if (!pts) continue;
    for (const run of splitRoadRuns(pts, over)) {
      for (let i = 0; i < run.pts.length - 1; i++) {
        if (waterChannelOnEdge(run.pts[i]!, run.pts[i + 1]!, over)) n += 1;
      }
    }
  }
  return n;
}

/** Metres from each stitch end to the nearest OSM land ribbon vertex. */
export function spanEndClearanceM(
  span: CrossingSpan,
  land: readonly { x: number; z: number }[],
): [number, number] {
  let d0 = Infinity;
  let d1 = Infinity;
  for (const p of land) {
    d0 = Math.min(d0, Math.hypot(p.x - span.pts[0].x, p.z - span.pts[0].z));
    d1 = Math.min(d1, Math.hypot(p.x - span.pts[1].x, p.z - span.pts[1].z));
  }
  return [d0 / METERS_TO_WORLD, d1 / METERS_TO_WORLD];
}

export function landRibbonVerts(cityData: CityData): { x: number; z: number }[] {
  const rings = waterRings(cityData);
  const over = (x: number, z: number) => pointOverWater(x, z, rings);
  const land: { x: number; z: number }[] = [];
  for (const road of cityData.roads as CityRoad[]) {
    const pts = roadPts(road);
    if (!pts) continue;
    for (const run of splitRoadRuns(pts, over)) {
      for (const p of run.pts) land.push(p);
    }
  }
  return land;
}

export type RoadApproach = {
  x: number;
  z: number;
  dx: number;
  dz: number;
  tier: number;
};

function approachIfTowardWater(
  end: { x: number; z: number },
  inward: { x: number; z: number },
  tier: number,
  overWater: (x: number, z: number) => boolean,
): RoadApproach | null {
  const dx = end.x - inward.x;
  const dz = end.z - inward.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const probeM = [8, 18, 36];
  let hits = 0;
  for (const m of probeM) {
    if (overWater(end.x + ux * m * METERS_TO_WORLD, end.z + uz * m * METERS_TO_WORLD)) hits += 1;
  }
  if (hits < 2) return null;
  return { x: end.x, z: end.z, dx: ux, dz: uz, tier };
}

export type CrossingSpan = {
  pts: [{ x: number; z: number }, { x: number; z: number }];
  tier: number;
};

function overlapEndpoints(
  a: { x: number; z: number },
  b: { x: number; z: number },
  overWater: (x: number, z: number) => boolean,
): [{ x: number; z: number }, { x: number; z: number }] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const extra = LAND_OVERLAP_M * METERS_TO_WORLD;
  const a0 = { x: a.x - ux * extra, z: a.z - uz * extra };
  const b0 = { x: b.x + ux * extra, z: b.z + uz * extra };
  return [overWater(a0.x, a0.z) ? a : a0, overWater(b0.x, b0.z) ? b : b0];
}

/** Pair land-road stubs that face each other across water into a carriageway span. */
export function stitchWaterSpans(
  approaches: RoadApproach[],
  overWater: (x: number, z: number) => boolean,
): CrossingSpan[] {
  const used = new Set<number>();
  const spans: CrossingSpan[] = [];
  const minD = 60 * METERS_TO_WORLD;
  const maxD = 460 * METERS_TO_WORLD;
  for (let i = 0; i < approaches.length; i++) {
    if (used.has(i)) continue;
    const a = approaches[i]!;
    let best = -1;
    let bestD = Infinity;
    for (let j = i + 1; j < approaches.length; j++) {
      if (used.has(j)) continue;
      const b = approaches[j]!;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < minD || d > maxD) continue;
      if (!overWater((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
      const towardA = (b.x - a.x) * a.dx + (b.z - a.z) * a.dz;
      const towardB = (a.x - b.x) * b.dx + (a.z - b.z) * b.dz;
      if (towardA < 0 || towardB < 0) continue;
      const ux = (b.x - a.x) / d;
      const uz = (b.z - a.z) / d;
      const align = Math.abs(a.dx * ux + a.dz * uz) + Math.abs(b.dx * ux + b.dz * uz);
      if (align < 1.0) continue;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) continue;
    used.add(i);
    used.add(best);
    const b = approaches[best]!;
    spans.push({
      pts: overlapEndpoints({ x: a.x, z: a.z }, { x: b.x, z: b.z }, overWater),
      tier: Math.min(a.tier, b.tier),
    });
  }
  return spans;
}

/** Walk a bank stub across water until land. Null if the water run is too short. */
export function walkAcrossWater(
  a: RoadApproach,
  overWater: (x: number, z: number) => boolean,
  minWaterM = BRIDGE_SPAN_MIN_M,
): { x: number; z: number } | null {
  const step = CROSSING_STEP_M * METERS_TO_WORLD;
  const max = CROSSING_MAX_M * METERS_TO_WORLD;
  const minWater = minWaterM * METERS_TO_WORLD;
  const extra = LAND_OVERLAP_M * METERS_TO_WORLD;
  let x = a.x;
  let z = a.z;
  let dist = 0;
  let seenWater = overWater(x, z);
  let waterRun = seenWater ? minWater : 0;
  while (dist < max) {
    x += a.dx * step;
    z += a.dz * step;
    dist += step;
    if (overWater(x, z)) {
      seenWater = true;
      waterRun += step;
    } else if (seenWater) {
      if (waterRun < minWater) {
        seenWater = false;
        waterRun = 0;
        continue;
      }
      return { x: x + a.dx * extra, z: z + a.dz * extra };
    }
  }
  return null;
}

function distPointToSeg(
  px: number,
  pz: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  let t = ((px - a.x) * abx + (pz - a.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * abx), pz - (a.z + t * abz));
}

/** Snap a walked span onto the OSM stubs so the deck meets the shoreline road. */
function snapSpanToApproaches(
  span: CrossingSpan,
  approaches: RoadApproach[],
  runEnds: { x: number; z: number }[],
  overWater: (x: number, z: number) => boolean,
): CrossingSpan {
  const snapR = 90 * METERS_TO_WORLD;
  const maxPerp = 40 * METERS_TO_WORLD;
  const snapOne = (
    pt: { x: number; z: number },
    far: { x: number; z: number },
  ): { x: number; z: number; tier: number } => {
    const dx = far.x - pt.x;
    const dz = far.z - pt.z;
    const slen = Math.hypot(dx, dz) || 1;
    const ux = dx / slen;
    const uz = dz / slen;
    let bestX = pt.x;
    let bestZ = pt.z;
    let bestD = snapR;
    let bestTier = span.tier;
    for (const a of approaches) {
      const d = Math.hypot(a.x - pt.x, a.z - pt.z);
      if (d >= bestD) continue;
      const toward = (far.x - a.x) * a.dx + (far.z - a.z) * a.dz;
      if (toward < 0) continue;
      const perp = Math.abs((a.x - pt.x) * uz - (a.z - pt.z) * ux);
      if (perp > maxPerp) continue;
      bestD = d;
      bestX = a.x;
      bestZ = a.z;
      bestTier = a.tier;
    }
    for (const e of runEnds) {
      const d = Math.hypot(e.x - pt.x, e.z - pt.z);
      if (d >= bestD) continue;
      if (overWater(e.x, e.z)) continue;
      if (d >= Math.hypot(e.x - far.x, e.z - far.z)) continue;
      const perp = Math.abs((e.x - pt.x) * uz - (e.z - pt.z) * ux);
      if (perp > maxPerp) continue;
      bestD = d;
      bestX = e.x;
      bestZ = e.z;
    }
    return { x: bestX, z: bestZ, tier: bestTier };
  };
  const a = snapOne(span.pts[0], span.pts[1]);
  const b = snapOne(span.pts[1], span.pts[0]);
  const pts = overlapEndpoints({ x: a.x, z: a.z }, { x: b.x, z: b.z }, overWater);
  if (!overWater((pts[0].x + pts[1].x) / 2, (pts[0].z + pts[1].z) / 2)) return span;
  return { pts, tier: Math.min(a.tier, b.tier, span.tier) };
}

function nudgeOntoWater(
  x: number,
  z: number,
  overWater: (x: number, z: number) => boolean,
): { x: number; z: number } {
  if (overWater(x, z)) return { x, z };
  for (const r of [12, 24, 40, 60, 90]) {
    const rad = r * METERS_TO_WORLD;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const px = x + Math.cos(ang) * rad;
      const pz = z + Math.sin(ang) * rad;
      if (overWater(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

function walkFromSeed(
  at: { x: number; y: number },
  lnglat: readonly [number, number],
  overWater: (x: number, z: number) => boolean,
): CrossingSpan | null {
  const t = thamesTangent(lnglat);
  const prefX = -t.y;
  const prefZ = t.x;
  const origin = nudgeOntoWater(at.x, at.y, overWater);
  const dirs: { dx: number; dz: number }[] = [{ dx: prefX, dz: prefZ }];
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI;
    dirs.push({ dx: Math.cos(ang), dz: Math.sin(ang) });
  }
  let best: CrossingSpan | null = null;
  let bestScore = -Infinity;
  for (const dir of dirs) {
    const align = Math.abs(dir.dx * prefX + dir.dz * prefZ);
    if (align < 0.5) continue;
    const fwd = walkAcrossWater(
      { x: origin.x, z: origin.z, dx: dir.dx, dz: dir.dz, tier: 0 },
      overWater,
      40,
    );
    const back = walkAcrossWater(
      { x: origin.x, z: origin.z, dx: -dir.dx, dz: -dir.dz, tier: 0 },
      overWater,
      40,
    );
    if (!fwd || !back) continue;
    const meters = Math.hypot(fwd.x - back.x, fwd.z - back.z) / METERS_TO_WORLD;
    if (meters < BRIDGE_SPAN_MIN_M || meters > CROSSING_MAX_M) continue;
    const midX = (fwd.x + back.x) / 2;
    const midZ = (fwd.z + back.z) / 2;
    if (!overWater(midX, midZ)) continue;
    const abx = fwd.x - back.x;
    const abz = fwd.z - back.z;
    const len2 = abx * abx + abz * abz || 1;
    let t = ((at.x - back.x) * abx + (at.y - back.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const perp = Math.hypot(at.x - (back.x + t * abx), at.y - (back.z + t * abz));
    if (perp > 35 * METERS_TO_WORLD) continue;
    const score = align * 4 - perp / METERS_TO_WORLD / 8 - Math.abs(meters - 280) / 400;
    if (score > bestScore) {
      bestScore = score;
      best = {
        pts: overlapEndpoints({ x: back.x, z: back.z }, { x: fwd.x, z: fwd.z }, overWater),
        tier: 0,
      };
    }
  }
  return best;
}

function dedupeCrossingSpans(spans: CrossingSpan[]): CrossingSpan[] {
  const out: CrossingSpan[] = [];
  const used = new Set<number>();
  const near = 90 * METERS_TO_WORLD;
  for (let i = 0; i < spans.length; i++) {
    if (used.has(i)) continue;
    const keep = spans[i]!;
    const mix = (keep.pts[0].x + keep.pts[1].x) / 2;
    const miz = (keep.pts[0].z + keep.pts[1].z) / 2;
    for (let j = i + 1; j < spans.length; j++) {
      if (used.has(j)) continue;
      const s = spans[j]!;
      const mjx = (s.pts[0].x + s.pts[1].x) / 2;
      const mjz = (s.pts[0].z + s.pts[1].z) / 2;
      if (Math.hypot(mix - mjx, miz - mjz) > near) continue;
      used.add(j);
    }
    out.push(keep);
  }
  return out;
}

/** Land-to-land asphalt spans: walk each stub across water, snap to the far road. */
export function buildCrossingSpans(
  approaches: RoadApproach[],
  overWater: (x: number, z: number) => boolean,
): CrossingSpan[] {
  const used = new Set<number>();
  const raw: CrossingSpan[] = [];
  const snapR = CROSSING_SNAP_M * METERS_TO_WORLD;
  for (let i = 0; i < approaches.length; i++) {
    if (used.has(i)) continue;
    const a = approaches[i]!;
    const far = walkAcrossWater(a, overWater);
    if (!far) continue;
    let best = -1;
    let bestD = snapR;
    for (let j = 0; j < approaches.length; j++) {
      if (j === i || used.has(j)) continue;
      const b = approaches[j]!;
      const d = Math.hypot(b.x - far.x, b.z - far.z);
      if (d >= bestD) continue;
      const toward = (a.x - b.x) * b.dx + (a.z - b.z) * b.dz;
      if (toward < 0) continue;
      bestD = d;
      best = j;
    }
    if (best < 0) continue;
    used.add(best);
    used.add(i);
    const end = approaches[best]!;
    const pts = overlapEndpoints({ x: a.x, z: a.z }, { x: end.x, z: end.z }, overWater);
    if (!overWater((pts[0].x + pts[1].x) / 2, (pts[0].z + pts[1].z) / 2)) continue;
    raw.push({ pts, tier: Math.min(a.tier, end.tier) });
  }
  const leftover = approaches.filter((_, idx) => !used.has(idx));
  raw.push(...stitchWaterSpans(leftover, overWater));
  return dedupeCrossingSpans(raw);
}

function collectRoadApproaches(
  cityData: CityData,
  overWater: (x: number, z: number) => boolean,
): RoadApproach[] {
  const approaches: RoadApproach[] = [];
  for (const road of cityData.roads as CityRoad[]) {
    const pts = roadPts(road);
    if (!pts) continue;
    const runs = splitRoadRuns(pts, overWater);
    for (const run of runs) {
      if (run.pts.length < 2) continue;
      const head = approachIfTowardWater(run.pts[0]!, run.pts[1]!, road.tier, overWater);
      const tail = approachIfTowardWater(
        run.pts[run.pts.length - 1]!,
        run.pts[run.pts.length - 2]!,
        road.tier,
        overWater,
      );
      if (head) approaches.push(head);
      if (tail) approaches.push(tail);
    }
  }
  return approaches;
}

function collectRunEnds(
  cityData: CityData,
  overWater: (x: number, z: number) => boolean,
): { x: number; z: number }[] {
  const ends: { x: number; z: number }[] = [];
  for (const road of cityData.roads as CityRoad[]) {
    const pts = roadPts(road);
    if (!pts) continue;
    for (const run of splitRoadRuns(pts, overWater)) {
      if (run.pts.length < 2) continue;
      ends.push(run.pts[0]!, run.pts[run.pts.length - 1]!);
    }
  }
  return ends;
}

export function riverCrossingSpans(cityData: CityData): CrossingSpan[] {
  const rings = waterRings(cityData);
  const overWater = (x: number, z: number) => pointOverWater(x, z, rings);
  const approaches = collectRoadApproaches(cityData, overWater);
  const runEnds = collectRunEnds(cityData, overWater);
  const fromRoads = buildCrossingSpans(approaches, overWater);
  const seeds = [
    ...LANDMARKS.filter((lm) => isDeckLandmark(lm.kind) && lm.kind !== 'oldstreet'),
    ...THAMES_CROSSINGS,
  ];
  const seeded: CrossingSpan[] = [];
  const matchR = SEED_MATCH_M * METERS_TO_WORLD;
  for (const seed of seeds) {
    const at = project(seed.at);
    const t = thamesTangent(seed.at);
    const cx = -t.y;
    const cz = t.x;
    let picked: CrossingSpan | null = null;
    let pickedScore = -Infinity;
    for (const s of fromRoads) {
      const d = distPointToSeg(at.x, at.y, s.pts[0], s.pts[1]);
      if (d > matchR) continue;
      const dx = s.pts[1].x - s.pts[0].x;
      const dz = s.pts[1].z - s.pts[0].z;
      const len = Math.hypot(dx, dz) || 1;
      const align = Math.abs((dx / len) * cx + (dz / len) * cz);
      if (align < 0.7) continue;
      const score = align * 2 - d / matchR;
      if (score > pickedScore) {
        pickedScore = score;
        picked = s;
      }
    }
    if (!picked) picked = walkFromSeed(at, seed.at, overWater);
    if (!picked) continue;
    seeded.push(snapSpanToApproaches(picked, approaches, runEnds, overWater));
  }
  // Named seeds only. Unseeded OSM stitches were Rotherhithe / Blackwall
  // tunnels, rail decks, and dock leftovers — leftover slabs on the river.
  return dedupeCrossingSpans(seeded);
}

/** Y rotation for a +X-modelled pier group so +X follows the nearest carriageway span. */
export function crossingYawAt(x: number, z: number, spans: CrossingSpan[]): number | null {
  let best: CrossingSpan | null = null;
  let bestD = 80 * METERS_TO_WORLD;
  for (const s of spans) {
    const mx = (s.pts[0].x + s.pts[1].x) / 2;
    const mz = (s.pts[0].z + s.pts[1].z) / 2;
    const d = Math.hypot(mx - x, mz - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best) return null;
  const dx = best.pts[1].x - best.pts[0].x;
  const dz = best.pts[1].z - best.pts[0].z;
  return Math.atan2(-dz, dx);
}

/** One group per tier so minor streets can hide independently at low zoom. */
export function buildRoads(cityData: CityData): THREE.Group | null {
  const group = new THREE.Group();
  const sidewalkMat = new THREE.MeshLambertMaterial({
    color: pal.PAVEMENT,
    side: THREE.DoubleSide,
    fog: true,
  });
  const asphaltMat = new THREE.MeshLambertMaterial({
    color: pal.ASPHALT,
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const markMat = new THREE.MeshLambertMaterial({
    color: pal.MARKING,
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const markPos: number[] = [];
  const markIdx: number[] = [];
  const rings = waterRings(cityData);
  const overWater = (x: number, z: number) => pointOverWater(x, z, rings);

  for (let tier = 0; tier <= 2; tier++) {
    const walkPos: number[] = [];
    const walkIdx: number[] = [];
    const asphPos: number[] = [];
    const asphIdx: number[] = [];
    const halfCarriage = (ROAD_WIDTHS_M[tier]! * METERS_TO_WORLD) / 2;
    const halfWalk = halfCarriage + SIDEWALK_M[tier]! * METERS_TO_WORLD;
    for (const road of cityData.roads as CityRoad[]) {
      if (road.tier !== tier) continue;
      const pts = roadPts(road);
      if (!pts) continue;
      const runs = splitRoadRuns(pts, overWater);
      for (const run of runs) {
        appendRibbon(walkPos, walkIdx, run.pts, halfWalk, SIDEWALK_Y);
        appendRibbon(asphPos, asphIdx, run.pts, halfCarriage, ROAD_Y);
        if (tier <= 1) {
          const dashes = polylineDashes(run.pts);
          const halfDash = (DASH_WIDTH_M * METERS_TO_WORLD) / 2;
          for (const d of dashes) appendRibbon(markPos, markIdx, [d.a, d.b], halfDash, MARK_Y);
          const halfEdge = (EDGE_WIDTH_M * METERS_TO_WORLD) / 2;
          const inset = halfCarriage - 0.28 * METERS_TO_WORLD;
          if (inset > halfEdge) {
            for (let i = 0; i < run.pts.length - 1; i++) {
              const edges = segmentEdgeOffsets(run.pts[i]!, run.pts[i + 1]!, inset);
              appendRibbon(markPos, markIdx, edges.left, halfEdge, MARK_Y);
              appendRibbon(markPos, markIdx, edges.right, halfEdge, MARK_Y);
            }
          }
        }
        if (tier === 0 && run.pts.length >= 2) {
          const a = run.pts[0]!;
          const b = run.pts[1]!;
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          const len = Math.hypot(dx, dz) || 1;
          dx /= len;
          dz /= len;
          addCrosswalk(
            markPos,
            markIdx,
            a.x + dx * 2.5 * METERS_TO_WORLD,
            a.z + dz * 2.5 * METERS_TO_WORLD,
            dx,
            dz,
            halfCarriage,
          );
        }
      }
    }
    if (asphPos.length === 0 && walkPos.length === 0) continue;
    const tierGroup = new THREE.Group();
    tierGroup.userData.roadTier = tier;
    if (walkPos.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(walkPos, 3));
      g.setIndex(walkIdx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, sidewalkMat);
      mesh.receiveShadow = true;
      tierGroup.add(mesh);
    }
    if (asphPos.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(asphPos, 3));
      g.setIndex(asphIdx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, asphaltMat);
      mesh.receiveShadow = true;
      tierGroup.add(mesh);
    }
    group.add(tierGroup);
  }

  const stitches = riverCrossingSpans(cityData);
  if (stitches.length > 0) {
    const stitchPos: number[] = [];
    const stitchIdx: number[] = [];
    for (const span of stitches) {
      const halfCarriage = (CROSSING_WIDTH_M * METERS_TO_WORLD) / 2;
      appendRibbon(stitchPos, stitchIdx, span.pts, halfCarriage, ROAD_Y);
      const dashes = polylineDashes(span.pts);
      const halfDash = (DASH_WIDTH_M * METERS_TO_WORLD) / 2;
      for (const d of dashes) appendRibbon(markPos, markIdx, [d.a, d.b], halfDash, MARK_Y);
      const halfEdge = (EDGE_WIDTH_M * METERS_TO_WORLD) / 2;
      const inset = halfCarriage - 0.28 * METERS_TO_WORLD;
      if (inset > halfEdge && span.pts.length >= 2) {
        const edges = segmentEdgeOffsets(span.pts[0]!, span.pts[1]!, inset);
        appendRibbon(markPos, markIdx, edges.left, halfEdge, MARK_Y);
        appendRibbon(markPos, markIdx, edges.right, halfEdge, MARK_Y);
      }
    }
    if (stitchPos.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(stitchPos, 3));
      g.setIndex(stitchIdx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, asphaltMat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  if (markPos.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(markPos, 3));
    g.setIndex(markIdx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, markMat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.userData.roadMarks = true;
    group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

const LAMP_MAX = 12000;
const LAMP_SPACING_M = [34, 42];

/** Instanced lamp posts along primary/secondary kerbs — unlit street furniture. */
export function buildStreetLamps(cityData: CityData): THREE.Group | null {
  const spots: { x: number; z: number }[] = [];
  const rings = waterRings(cityData);
  for (const road of cityData.roads as CityRoad[]) {
    if (road.tier > 1) continue;
    const pts = roadPts(road);
    if (!pts) continue;
    const spacing = LAMP_SPACING_M[road.tier]! * METERS_TO_WORLD;
    const offset =
      (ROAD_WIDTHS_M[road.tier]! / 2 + SIDEWALK_M[road.tier]! * 0.55) * METERS_TO_WORLD;
    let travelled = 0;
    let nextAt = spacing * (0.35 + (road.pts[0]! % 97) / 200);
    let sign = road.pts[0]! % 2 === 0 ? 1 : -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len;
      const pz = dx / len;
      while (nextAt <= travelled + len && spots.length < LAMP_MAX) {
        const t = (nextAt - travelled) / len;
        const lx = a.x + dx * t + px * offset * sign;
        const lz = a.z + dz * t + pz * offset * sign;
        if (!pointOverWater(lx, lz, rings) && !pointOnPrefabDeck(lx, lz)) {
          spots.push({ x: lx, z: lz });
        }
        nextAt += spacing;
        sign = -sign;
      }
      travelled += len;
      if (spots.length >= LAMP_MAX) break;
    }
    if (spots.length >= LAMP_MAX) break;
  }
  const spans = riverCrossingSpans(cityData);
  for (const span of spans) {
    if (spots.length >= LAMP_MAX) break;
    const a = span.pts[0];
    const b = span.pts[1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const offset =
      (CROSSING_WIDTH_M / 2 + SIDEWALK_M[Math.min(span.tier, 1)]! * 0.4) * METERS_TO_WORLD;
    const spacing = 32 * METERS_TO_WORLD;
    const n = Math.max(2, Math.floor(len / spacing));
    for (let i = 1; i < n && spots.length < LAMP_MAX; i++) {
      const t = i / n;
      const sign = i % 2 === 0 ? 1 : -1;
      spots.push({
        x: a.x + ux * len * t + px * offset * sign,
        z: a.z + uz * len * t + pz * offset * sign,
      });
    }
  }
  if (spots.length === 0) return null;

  const poleH = 6.2 * METERS_TO_WORLD;
  const poleW = 0.16 * METERS_TO_WORLD;
  const poleGeo = new THREE.BoxGeometry(poleW, poleH, poleW);
  poleGeo.translate(0, poleH / 2, 0);
  const headGeo = new THREE.BoxGeometry(poleW * 2.4, poleW * 1.3, poleW * 2.4);
  headGeo.translate(0, poleH + poleW * 0.3, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3c42, fog: true });
  const headMat = new THREE.MeshLambertMaterial({ color: 0x4a4c52, fog: true });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < spots.length; i++) {
    dummy.position.set(spots[i]!.x, 0, spots[i]!.z);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
  }
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  poles.castShadow = true;
  heads.castShadow = true;
  poles.frustumCulled = false;
  heads.frustumCulled = false;
  const group = new THREE.Group();
  group.add(poles, heads);
  return group;
}

/** Daytime city: no neon TfL overlays. Kept as an empty group so call sites stay stable. */
export function buildTubeLines(): THREE.Group {
  return new THREE.Group();
}

export function buildGround(): THREE.Mesh {
  const marginX = WORLD.width * 0.3;
  const marginY = WORLD.height * 0.3;
  const geometry = new THREE.PlaneGeometry(WORLD.width + marginX * 2, WORLD.height + marginY * 2);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshLambertMaterial({ color: pal.GROUND, fog: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(WORLD.width / 2, 0, WORLD.height / 2);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildHubGlows(glowTexture: THREE.Texture): {
  group: THREE.Group;
  sprites: Map<HubId, THREE.Sprite>;
} {
  const group = new THREE.Group();
  const sprites = new Map<HubId, THREE.Sprite>();
  const size = HUB_GLOW_SIZE_M * METERS_TO_WORLD;
  const height = HUB_GLOW_HEIGHT_M * METERS_TO_WORLD;
  for (const hubId of Object.keys(HUB_POS) as HubId[]) {
    const pos = HUB_POS[hubId];
    const material = new THREE.SpriteMaterial({
      map: glowTexture,
      color: HUB_GLOW_COLOR,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size, size, 1);
    sprite.position.set(pos.x, height, pos.y);
    group.add(sprite);
    sprites.set(hubId, sprite);
  }
  return { group, sprites };
}

export function nearestPick(
  picks: BuildingPick[],
  x: number,
  z: number,
  maxDist: number,
): BuildingPick | null {
  let best: BuildingPick | null = null;
  let bestD = maxDist * maxDist;
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i]!;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
