/**
 * RUNWAY — decoded city data -> three.js geometry.
 *
 * Daytime SFSIM look: solid vertex colours, map-scale massing (setbacks,
 * mansards, gables), darker roofs with parapets, grey streets with white
 * markings, instanced trees. Real OSM footprints keep their own
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
  STYLE_HOUSE,
  STYLE_INDUSTRIAL,
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
  wantPodium,
  type DistrictId,
  type StockMassing,
} from './buildingStyle';
import * as pal from './palette';
import { DASH_WIDTH_M, polylineDashes } from './streetMarks';
import { chamferRing, insetRingTowardCentroid, scaleToward } from './footprint';
import {
  analyzeFootprint,
  uniqueStockRecipe,
  type UniqueFacade,
  type UniqueStockRecipe,
} from './uniqueStock';
import {
  emitCheapsideStockWalls,
  emitStreetUniqueRoofs,
  emitStreetUniqueWalls,
  STREET_UNIQUE_LABEL,
  streetUniqueAt,
  type StreetEmit,
} from './uniqueStreet';
import {
  aabbHitsKeep,
  CITYSTREET_AT,
  clipPolylineToKeep,
  inKeepDisk,
  ptsHitKeep,
  type KeepDisk,
} from './lookClip';

export { HEIGHT_SCALE, TOWER_HEIGHT_SCALE, NOTICED_BAKE_HEIGHT_SCALE } from './buildingStyle';

export const CHUNK_COLS = 8;
export const CHUNK_ROWS = 6;
export const CHUNK_COUNT = CHUNK_COLS * CHUNK_ROWS;

export const WINDOW_MAX = 720_000;
export const TREE_MAX = 36_000;

const ROAD_WIDTHS_M = [14, 9.5, 5.8];
/** River-crossing ribbons match a primary street, not a footway. */
const CROSSING_WIDTH_M = 14;
const SIDEWALK_M = [3.6, 2.8, 2.0];
export const ROAD_Y = 0.14;
const SIDEWALK_Y = 0.09;
const MARK_Y = 0.155;
/** Carpet just above GROUND. Not a 12 m plate (0.11 world ≈ Hyde-as-tent). */
export const PARK_Y = 0.028;
const WATER_Y = 0.04;
const WATER_BANK_Y = 0.055;
/** Regular lawn tiles. Smaller gardens need a tighter grid or paving GROUND shows. */
function parkCellWorld(areaM2: number): number {
  if (areaM2 >= 15_000) return 32 * METERS_TO_WORLD;
  return 12 * METERS_TO_WORLD;
}

function landmarkExclusionAt(x: number, z: number): number | null {
  for (const landmark of LANDMARKS) {
    const at = project(landmark.at);
    const r = parkClipRadiusWorld(landmark.kind, landmark.exclusionM);
    const d = Math.hypot(x - at.x, z - at.y);
    if (d < r) return d / METERS_TO_WORLD;
  }
  return null;
}

function towerBridgeWorld(): { x: number; z: number } | null {
  const tb = LANDMARKS.find((l) => l.kind === 'towerbridge');
  if (!tb) return null;
  const at = project(tb.at);
  return { x: at.x, z: at.y };
}

function inTowerBridgeCorridor(x: number, z: number): boolean {
  const at = towerBridgeWorld();
  if (!at) return false;
  const dx = x - at.x;
  const dz = z - at.z;
  return Math.abs(dx) < 55 * METERS_TO_WORLD && Math.abs(dz) < 230 * METERS_TO_WORLD;
}

function nearTowerBridgePrefab(x: number, z: number, radiusM = 80): boolean {
  const at = towerBridgeWorld();
  if (!at) return false;
  return Math.hypot(x - at.x, z - at.z) < radiusM * METERS_TO_WORLD;
}

function segmentHitsTowerBridge(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const at = towerBridgeWorld();
  if (!at) return false;
  if (distPointToSeg(at.x, at.z, a, b) < 70 * METERS_TO_WORLD) return true;
  if (inTowerBridgeCorridor(a.x, a.z) || inTowerBridgeCorridor(b.x, b.z)) return true;
  for (let s = 1; s < 8; s++) {
    const t = s / 8;
    if (inTowerBridgeCorridor(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return true;
  }
  return false;
}

function runTouchesTowerBridge(pts: { x: number; z: number }[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentHitsTowerBridge(pts[i]!, pts[i + 1]!)) return true;
  }
  return pts.some((p) => nearTowerBridgePrefab(p.x, p.z) || inTowerBridgeCorridor(p.x, p.z));
}

function lcyWorld(): { x: number; z: number; yaw: number } | null {
  const lm = LANDMARKS.find((l) => l.kind === 'lcy');
  if (!lm) return null;
  const at = project(lm.at);
  return { x: at.x, z: at.y, yaw: lm.yaw ?? 0 };
}

function lcyLocal(x: number, z: number): { lx: number; lz: number } | null {
  const at = lcyWorld();
  if (!at) return null;
  const dx = x - at.x;
  const dz = z - at.z;
  const c = Math.cos(at.yaw);
  const s = Math.sin(at.yaw);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

function nearLondonCityAirport(x: number, z: number, padM = 0): boolean {
  const p = lcyLocal(x, z);
  if (!p) return false;
  const pad = padM * METERS_TO_WORLD;
  return (
    Math.abs(p.lx) < 820 * METERS_TO_WORLD + pad &&
    p.lz > -80 * METERS_TO_WORLD - pad &&
    p.lz < 210 * METERS_TO_WORLD + pad
  );
}

function onLcyRunway(x: number, z: number): boolean {
  const p = lcyLocal(x, z);
  if (!p) return false;
  return Math.abs(p.lx) < 820 * METERS_TO_WORLD && Math.abs(p.lz) < 55 * METERS_TO_WORLD;
}

export function onLondonCityAirportSpit(x: number, z: number): boolean {
  return nearLondonCityAirport(x, z);
}

function parkClipRadiusWorld(
  kind: (typeof LANDMARKS)[number]['kind'],
  exclusionM?: number,
): number {
  if (kind === 'towerlondon') return (exclusionM ?? 155) * METERS_TO_WORLD;
  if (kind === 'lcy') return 90 * METERS_TO_WORLD;
  return Math.min(72, exclusionM ?? 72) * METERS_TO_WORLD;
}

function triangleHitsExclusion(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const mx = (ax + bx + cx) / 3;
  const mz = (az + bz + cz) / 3;
  if (nearLondonCityAirport(mx, mz)) return true;
  if (
    nearLondonCityAirport(ax, az) ||
    nearLondonCityAirport(bx, bz) ||
    nearLondonCityAirport(cx, cz)
  ) {
    return true;
  }
  for (const landmark of LANDMARKS) {
    const at = project(landmark.at);
    const r = parkClipRadiusWorld(landmark.kind, landmark.exclusionM);
    if (Math.hypot(mx - at.x, mz - at.y) < r) return true;
    // Fortress / runway: punch overlapping fans. Civic palaces must not
    // drop Green Park because one giant OSM triangle grazes the building.
    if (landmark.kind !== 'towerlondon' && landmark.kind !== 'lcy') continue;
    const tri = [
      { x: ax, z: az },
      { x: bx, z: bz },
      { x: cx, z: cz },
    ];
    if (pointInRing(at.x, at.y, tri)) return true;
    if (distPointToSeg(at.x, at.y, tri[0]!, tri[1]!) < r * 0.45) return true;
    if (distPointToSeg(at.x, at.y, tri[1]!, tri[2]!) < r * 0.45) return true;
    if (distPointToSeg(at.x, at.y, tri[2]!, tri[0]!) < r * 0.45) return true;
  }
  return false;
}

const HUB_GLOW_COLOR = 0xb8d4e8;
export const HUB_GLOW_PLAYER_COLOR = 0xf0c56a;
const HUB_GLOW_SIZE_M = 36;
const HUB_GLOW_HEIGHT_M = 4;

const tmpColor = new THREE.Color();

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

function massingFromRecipe(recipe: UniqueStockRecipe): StockMassing {
  switch (recipe.silhouette.kind) {
    case 'wedge-step':
    case 'asymmetric-setback':
    case 'ell':
      return 'setback';
    case 'courtyard':
    case 'mansard-plate':
      return 'mansard';
    case 'bar-ridge':
    case 'gable-row':
      return recipe.roof.kind === 'hip' ? 'hip' : 'gable';
    case 'sawtooth':
      return 'sawtooth';
    case 'disk':
      return 'slab';
  }
  const _never: never = recipe.silhouette;
  return _never;
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

/** One merged, flat-shaded, indexed geometry for every building in (chunkId, major). */
export function buildChunkTier(
  cityData: CityData,
  chunkId: number,
  major: boolean,
  landmarkAnchors: readonly { x: number; y: number; r: number }[] = [],
  scratch?: CityScratch,
  keep: KeepDisk | null = null,
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

  const citystreetPt = project(CITYSTREET_AT);

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

    if (!inKeepDisk(cx, cz, keep, 120 * METERS_TO_WORLD)) continue;
    if (landmarkAnchors.some((a) => Math.hypot(cx - a.x, cz - a.y) < a.r)) continue;
    if (nearLondonCityAirport(cx, cz, 10) || ring.some((p) => nearLondonCityAirport(p.x, p.z, 10)))
      continue;

    const areaM2 = footprintAreaM2(ring);
    const [lng, lat] = unproject(cx, cz);
    const streetKind = streetUniqueAt(lng, lat);
    const district = districtAt(lng, lat);
    const distStreetM = Math.hypot(cx - citystreetPt.x, cz - citystreetPt.y) / METERS_TO_WORLD;
    const cheapsideNotice =
      !streetKind && district === 'city' && distStreetM < 280 && areaM2 >= 160 && b.heightM >= 8;
    const style = restyleForDistrict(
      resolveStyle(b.style, b.heightM, areaM2),
      b.heightM,
      areaM2,
      district,
    );
    const storedRoof = b.style === 0 ? inferRoof(style) : b.roof;
    const seed = hashBuildingIndex(b.heightM, b.chunkId, b.verts, 0x7fffffff, cx, cz);
    const plan = analyzeFootprint(ring, METERS_TO_WORLD);
    const recipe = uniqueStockRecipe({
      plan,
      heightM: b.heightM,
      style,
      osmRoof: storedRoof,
    });
    const massing = massingFromRecipe(recipe);
    const osmWall = fromRgb565(b.wall565);
    const osmRoof = fromRgb565(b.roof565);
    const baseHex = pal.wallHex(style, district, cx, cz, seed, osmWall);
    const wallBottomHex = pal.mixHex(baseHex, pal.AO_DARK, 0.1);
    const pitchedKind =
      recipe.roof.kind === 'gable' ||
      recipe.roof.kind === 'hip' ||
      recipe.roof.kind === 'mansard' ||
      recipe.roof.kind === 'barrel';
    const roofHex = osmRoof
      ? pal.clampRoofColour(osmRoof)
      : pal.roofHex(style, pitchedKind && b.heightM <= 22, seed);
    const vScale = extrusionScale(style, b.heightM, district);
    const heightWorld = b.heightM * METERS_TO_WORLD * vScale;
    const shopM = style === STYLE_RETAIL ? Math.min(4.0, b.heightM * 0.36) : 0;
    const shopWorld = shopM * METERS_TO_WORLD * vScale;
    const plinthWorld = shopWorld > 0.02 ? 0 : Math.min(4.2 * METERS_TO_WORLD, heightWorld * 0.22);
    const corniceWorld = Math.min(1.6 * METERS_TO_WORLD, heightWorld * 0.12);
    const corniceHex = pal.mixHex(
      baseHex,
      pal.CORNICE,
      style === STYLE_HOUSE || style === STYLE_TERRACE ? 0.22 : 0.45,
    );
    const podium = wantPodium(style, b.heightM, areaM2, district);
    const podiumWorld = podium ? Math.min(15 * METERS_TO_WORLD * vScale, heightWorld * 0.14) : 0;
    const keepApex =
      !!streetKind ||
      recipe.silhouette.kind === 'wedge-step' ||
      recipe.silhouette.kind === 'courtyard' ||
      recipe.silhouette.kind === 'disk';
    const chamferAmt =
      !keepApex &&
      (massing === 'slab' || massing === 'parapet' || massing === 'setback') &&
      (style === STYLE_OFFICE || style === STYLE_RETAIL || style === STYLE_TOWER) &&
      n >= 4 &&
      n <= 16 &&
      plan.minAngleDeg > 78
        ? Math.min(2.6, Math.max(1.2, 1.4 + plan.minRM * 0.08)) * METERS_TO_WORLD
        : 0;
    const wallRing = chamferAmt > 0 ? chamferRing(ring, chamferAmt) : ring;
    const shaftRing = podium ? insetRing(ring, cx, cz, district === 'canary' ? 0.42 : 0.58) : ring;

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
      opts: {
        plinth: boolean;
        shop: boolean;
        cornice: boolean;
        doors: boolean;
        windows: boolean;
        sashes?: boolean;
        stringCourses?: boolean;
        hex?: number;
        bottomHex?: number;
        facade?: UniqueFacade;
        outset?: number;
      },
    ) => {
      const faceHex = opts.hex ?? baseHex;
      const faceBottom = opts.bottomHex ?? wallBottomHex;
      const bandOut = opts.outset ?? 0;
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
        const edgeLenM = Math.hypot(bp.x - a.x, bp.z - a.z) / METERS_TO_WORLD;
        const spanM = (y1 - y0) / METERS_TO_WORLD;
        const face = opts.facade ?? recipe.facade;
        const glass = pal.windowHex(seed);
        const inPlane =
          opts.windows &&
          edgeLenM >= 4.2 &&
          spanM > 6 &&
          (face.kind === 'ribbon' ||
            face.kind === 'piers' ||
            face.kind === 'colonnade' ||
            face.kind === 'bays' ||
            face.kind === 'recess');

        const emitSeg = (t0: number, t1: number, qy0: number, qy1: number, hex: number) => {
          const ax = a.x + dx * t0 + nx * bandOut;
          const az = a.z + dz * t0 + nz * bandOut;
          const bx = a.x + dx * t1 + nx * bandOut;
          const bz = a.z + dz * t1 + nz * bandOut;
          const iBottomA = pushVertex(ax, qy0, az, nx, 0, nz, hex);
          const iBottomB = pushVertex(bx, qy0, bz, nx, 0, nz, hex);
          const iTopA = pushVertex(ax, qy1, az, nx, 0, nz, hex);
          const iTopB = pushVertex(bx, qy1, bz, nx, 0, nz, hex);
          if (!flip) indices.push(iBottomA, iBottomB, iTopB, iBottomA, iTopB, iTopA);
          else indices.push(iBottomA, iTopB, iBottomB, iBottomA, iTopA, iTopB);
        };

        const body0 =
          opts.shop && shopWorld > 0.02 && shopWorld < (y1 - y0) * 0.85
            ? y0 + shopWorld
            : opts.plinth && plinthWorld > 0.01
              ? plinthTop
              : y0;
        if (body0 > y0 + 1e-6) {
          const baseC =
            opts.shop && shopWorld > 0.02 && shopWorld < (y1 - y0) * 0.85
              ? pal.SHOPFRONT
              : faceBottom;
          emitQuad(y0, body0, baseC, baseC, bandOut);
        }

        const paintPunched = (pitchM: number, rows: number, winU: number, winV: number) => {
          const nRows = Math.max(1, rows);
          const span = Math.max(wallTop - body0, 1e-6);
          const rowH = span / nRows;
          const bays = Math.max(2, Math.min(14, Math.round(edgeLenM / pitchM)));
          const uPad = (1 - Math.min(0.8, Math.max(0.3, winU))) / 2;
          const vPad = (1 - Math.min(0.8, Math.max(0.3, winV))) / 2;
          for (let b = 0; b < bays; b++) {
            const t0 = b / bays;
            const t1 = (b + 1) / bays;
            const w0 = t0 + (t1 - t0) * uPad;
            const w1 = t1 - (t1 - t0) * uPad;
            emitSeg(t0, w0, body0, wallTop, faceHex);
            emitSeg(w1, t1, body0, wallTop, faceHex);
            for (let r = 0; r < nRows; r++) {
              const ry0 = body0 + r * rowH;
              const ry1 = ry0 + rowH;
              const sill = ry0 + rowH * vPad;
              const head = ry1 - rowH * vPad;
              emitSeg(w0, w1, ry0, sill, faceHex);
              emitSeg(w0, w1, sill, head, glass);
              emitSeg(w0, w1, head, ry1, faceHex);
            }
          }
        };

        if (inPlane && face.kind === 'ribbon') {
          const nFloors = Math.max(2, Math.min(face.floors, 6));
          const span = Math.max(wallTop - body0, 1e-6);
          const weights: number[] = [];
          for (let f = 0; f < nFloors; f++) {
            weights.push(1.45 - (f / Math.max(1, nFloors - 1)) * 0.7);
          }
          const sum = weights.reduce((a, b) => a + b, 0);
          let y = body0;
          for (let f = 0; f < nFloors; f++) {
            const h = (weights[f]! / sum) * span;
            const gH = h * face.bandRatio;
            const sill = (h - gH) * 0.38;
            emitQuad(y, y + sill, faceBottom, faceHex, bandOut);
            emitQuad(y + sill, y + sill + gH, glass, glass, bandOut);
            emitQuad(y + sill + gH, y + h, faceHex, faceHex, bandOut);
            y += h;
          }
        } else if (inPlane && face.kind === 'piers') {
          paintPunched(face.pitchM, spanM > 12 ? 3 : 2, 0.58, 0.52);
        } else if (inPlane && face.kind === 'colonnade') {
          const nCol = Math.max(3, Math.min(face.count, 10));
          const colT = Math.min(0.08, 1.1 / edgeLenM);
          const colH = Math.min(wallTop - body0, 9.5 * METERS_TO_WORLD);
          const lintel = body0 + colH;
          const colHex = pal.mixHex(faceHex, pal.AO_DARK, 0.35);
          for (let c = 0; c < nCol; c++) {
            const t = (c + 0.5) / nCol;
            emitSeg(Math.max(0, t - colT), Math.min(1, t + colT), body0, lintel, colHex);
          }
          emitQuad(lintel, wallTop, colHex, colHex, bandOut);
          for (let c = 0; c < nCol - 1; c++) {
            const t0 = (c + 0.5) / nCol + colT;
            const t1 = (c + 1.5) / nCol - colT;
            if (t1 - t0 < 0.02) continue;
            emitSeg(t0, t1, body0, lintel, glass);
          }
        } else if (inPlane && face.kind === 'bays') {
          paintPunched(Math.max(3.8, edgeLenM / 5), spanM > 10 ? 3 : 2, 0.62, 0.55);
        } else if (inPlane && face.kind === 'recess') {
          paintPunched(
            face.pitchU,
            Math.min(face.rowCap, Math.max(2, Math.round(spanM / face.pitchV))),
            0.6,
            0.55,
          );
        } else if (opts.shop && shopWorld > 0.02 && shopWorld < (y1 - y0) * 0.85) {
          emitQuad(y0 + shopWorld, wallTop, faceBottom, faceHex, bandOut);
        } else if (opts.plinth && plinthWorld > 0.01) {
          emitQuad(plinthTop, wallTop, faceBottom, faceHex, bandOut);
        } else {
          emitQuad(y0, wallTop, faceBottom, faceHex, bandOut);
        }
        if (opts.cornice && corniceWorld > 0.008 && wallTop < y1) {
          emitQuad(wallTop, y1, corniceHex, corniceHex, bandOut);
        }

        if (opts.stringCourses && y1 - y0 > 9 * METERS_TO_WORLD && edgeLenM > 8) {
          const courseH = Math.min(1.7 * METERS_TO_WORLD, (y1 - y0) * 0.12);
          const cHex = pal.mixHex(faceHex, pal.CORNICE, 0.38);
          for (const t of [0.32, 0.6]) {
            const cy0 = y0 + (y1 - y0) * t;
            emitQuad(cy0, cy0 + courseH, cHex, cHex, bandOut);
          }
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

        if (opts.sashes && opts.windows && edgeLenM >= 4.4 && y1 - y0 > 5.2 * METERS_TO_WORLD) {
          const shopTop =
            opts.shop && shopWorld > 0.02 ? y0 + shopWorld : y0 + 0.85 * METERS_TO_WORLD * vScale;
          const head = y1 - 0.55 * METERS_TO_WORLD * vScale;
          const stack = head - shopTop;
          if (stack > 1.8 * METERS_TO_WORLD) {
            const residential =
              style === STYLE_HOUSE || style === STYLE_TERRACE || style === STYLE_APARTMENTS;
            const houses =
              residential && edgeLenM >= 16 ? Math.max(2, Math.round(edgeLenM / 6.5)) : 1;
            let floors = Math.min(
              residential ? 4 : 7,
              Math.max(1, Math.floor(stack / (3.15 * METERS_TO_WORLD * vScale))),
            );
            let bays = residential
              ? houses > 1
                ? 2
                : Math.min(4, Math.max(1, Math.floor(edgeLenM / 3.6)))
              : Math.min(8, Math.max(2, Math.floor(edgeLenM / 4.2)));
            while (houses * floors * bays > 36 && floors > 1) floors -= 1;
            while (houses * floors * bays > 36 && bays > 1) bays -= 1;
            const elen = Math.hypot(dx, dz) || 1;
            const alongN = -0.48 * METERS_TO_WORLD;
            const winW = (residential ? 2.15 : 2.55) * METERS_TO_WORLD;
            const winH = Math.min(
              (stack / floors) * 0.68,
              (residential ? 2.45 : 2.7) * METERS_TO_WORLD * Math.min(vScale, 1.7),
            );
            if (houses > 1) {
              const ribHex = pal.mixHex(baseHex, pal.AO_DARK, 0.5);
              const half = 0.48 * METERS_TO_WORLD;
              const ox = nx * -0.32 * METERS_TO_WORLD;
              const oz = nz * -0.32 * METERS_TO_WORLD;
              const tx = dx / elen;
              const tz = dz / elen;
              for (let hse = 1; hse < houses; hse++) {
                const t = hse / houses;
                const mx = a.x + dx * t;
                const mz = a.z + dz * t;
                const hx = tx * half;
                const hz = tz * half;
                const p0 = pushVertex(mx - hx + ox, y0, mz - hz + oz, nx, 0, nz, ribHex);
                const p1 = pushVertex(mx + hx + ox, y0, mz + hz + oz, nx, 0, nz, ribHex);
                const p2 = pushVertex(mx + hx + ox, y1, mz + hz + oz, nx, 0, nz, ribHex);
                const p3 = pushVertex(mx - hx + ox, y1, mz - hz + oz, nx, 0, nz, ribHex);
                if (!flip) indices.push(p0, p1, p2, p0, p2, p3);
                else indices.push(p0, p2, p1, p0, p3, p2);
              }
            }
            for (let hse = 0; hse < houses; hse++) {
              const pane = pal.windowHex(seed + hse * 17);
              const u0 = (hse / houses) * elen;
              const spanU = elen / houses;
              for (let c = 0; c < bays; c++) {
                const u = u0 + ((c + 1) / (bays + 1)) * spanU;
                for (let r = 0; r < floors; r++) {
                  const yMid = shopTop + ((r + 0.5) / floors) * stack;
                  const half = winW / 2;
                  const t0 = (u - half) / elen;
                  const t1 = (u + half) / elen;
                  if (t0 < 0.03 || t1 > 0.97) continue;
                  const x0 = a.x + dx * t0 + nx * alongN;
                  const z0 = a.z + dz * t0 + nz * alongN;
                  const x1 = a.x + dx * t1 + nx * alongN;
                  const z1 = a.z + dz * t1 + nz * alongN;
                  const ySill = yMid - winH / 2;
                  const yHead = yMid + winH / 2;
                  const s0 = pushVertex(x0, ySill, z0, nx, 0, nz, pane);
                  const s1 = pushVertex(x1, ySill, z1, nx, 0, nz, pane);
                  const s2 = pushVertex(x1, yHead, z1, nx, 0, nz, pane);
                  const s3 = pushVertex(x0, yHead, z0, nx, 0, nz, pane);
                  if (!flip) indices.push(s0, s1, s2, s0, s2, s3);
                  else indices.push(s0, s2, s1, s0, s3, s2);
                }
              }
            }
          }
        }
      }
    };

    const bodyY0 = podium ? podiumWorld : 0;
    const bodySpan = Math.max(heightWorld - bodyY0, 4 * METERS_TO_WORLD);
    const setSil = recipe.silhouette;
    const setbackSteps =
      setSil.kind === 'asymmetric-setback'
        ? setSil.tBreaks.length
        : massing === 'setback' && b.heightM >= 30
          ? 3
          : 2;
    const setT1 =
      setSil.kind === 'asymmetric-setback' ? setSil.tBreaks[0]! : 0.38 + plan.longestEdgeM / 280;
    const setT2 =
      setSil.kind === 'asymmetric-setback' && setSil.tBreaks.length > 2
        ? setSil.tBreaks[1]!
        : 0.64 + plan.aspect * 0.03;
    const setbackYA = bodyY0 + bodySpan * Math.min(0.72, Math.max(0.26, setT1));
    const setbackYB =
      setbackSteps >= 3
        ? bodyY0 + bodySpan * Math.min(0.88, Math.max(setT1 + 0.12, setT2))
        : heightWorld;
    const insetM1 =
      (setSil.kind === 'asymmetric-setback'
        ? setSil.insetsM[0]!
        : Math.min(7.2, Math.max(2.4, plan.minRM * 0.2))) * METERS_TO_WORLD;
    const insetM2 =
      (setSil.kind === 'asymmetric-setback' && setSil.insetsM[1] !== undefined
        ? setSil.insetsM[1]
        : Math.min(12, Math.max(4.2, plan.minRM * 0.38))) * METERS_TO_WORLD;
    const setbackRoof1 = insetRingTowardCentroid(ring, cx, cz, insetM1);
    const setbackRoof2 = insetRingTowardCentroid(ring, cx, cz, insetM2);
    const setbackWall1 =
      chamferAmt > 0 ? chamferRing(setbackRoof1, chamferAmt * 0.55) : setbackRoof1;
    const setbackWall2 =
      chamferAmt > 0 ? chamferRing(setbackRoof2, chamferAmt * 0.4) : setbackRoof2;
    const mansardEaves =
      bodyY0 +
      bodySpan *
        (setSil.kind === 'mansard-plate'
          ? setSil.eavesT
          : setSil.kind === 'courtyard'
            ? Math.min(0.78, 0.62 + setSil.wellT * 0.2)
            : massing === 'mansard'
              ? Math.min(0.76, 0.6 + plan.compactness * 0.12)
              : 1);

    const stampWindows = style !== STYLE_INDUSTRIAL;
    const houseCourse = style === STYLE_HOUSE || style === STYLE_TERRACE;
    const streetEmit: StreetEmit = {
      ring,
      plan,
      heightWorld,
      emitRingWalls: (useRing, y0, y1, opts) => {
        emitRingWalls(useRing, y0, y1, opts);
      },
      pushBox,
      pushOrientedBox,
      pushVertex,
      pushTri: (i0, i1, i2) => {
        indices.push(i0, i1, i2);
      },
      outwardNormal,
    };

    if (streetKind) {
      emitStreetUniqueWalls(streetKind, streetEmit);
    } else if (cheapsideNotice) {
      emitCheapsideStockWalls(streetEmit, recipe.silhouette, baseHex, pal.windowHex(seed));
    } else {
      const facadeOpts = { facade: recipe.facade };
      if (podium) {
        emitRingWalls(wallRing, 0, podiumWorld, {
          plinth: true,
          shop: false,
          cornice: true,
          doors: true,
          windows: stampWindows,
          stringCourses: false,
          ...facadeOpts,
        });
      }

      if (setSil.kind === 'wedge-step') {
        const apex = ring[setSil.apexIndex] ?? { x: cx, z: cz };
        let yPrev = bodyY0;
        for (let s = 0; s < setSil.steps; s++) {
          const y1 = bodyY0 + bodySpan * setSil.t1[s]!;
          const stepRing = scaleToward(wallRing, apex.x, apex.z, setSil.scales[s]!);
          emitRingWalls(s === 0 && !podium ? wallRing : stepRing, yPrev, y1, {
            plinth: s === 0 && !podium && shopWorld <= 0.02,
            shop: s === 0 && !podium && shopWorld > 0.02,
            cornice: true,
            doors: s === 0 && !podium,
            windows: stampWindows,
            stringCourses: houseCourse && s === 0,
            ...facadeOpts,
          });
          yPrev = y1;
        }
      } else if (setSil.kind === 'disk') {
        let yPrev = bodyY0;
        for (let s = 0; s < setSil.bands; s++) {
          const y1 = bodyY0 + bodySpan * ((s + 1) / setSil.bands);
          const bandRing = insetRing(ring, cx, cz, setSil.scales[s]!);
          emitRingWalls(s === 0 && !podium ? wallRing : bandRing, yPrev, y1, {
            plinth: s === 0 && !podium && shopWorld <= 0.02,
            shop: s === 0 && !podium && shopWorld > 0.02,
            cornice: true,
            doors: s === 0 && !podium,
            windows: stampWindows,
            stringCourses: false,
            ...facadeOpts,
          });
          yPrev = y1;
        }
      } else if (setSil.kind === 'ell') {
        const splitY = bodyY0 + bodySpan * setSil.tBreak;
        emitRingWalls(podium ? shaftRing : wallRing, bodyY0, splitY, {
          plinth: !podium && shopWorld <= 0.02,
          shop: !podium && shopWorld > 0.02,
          cornice: true,
          doors: !podium,
          windows: stampWindows,
          stringCourses: houseCourse,
          ...facadeOpts,
        });
        const headRing = insetRing(ring, cx, cz, setSil.shortScale);
        emitRingWalls(headRing, splitY, heightWorld, {
          plinth: false,
          shop: false,
          cornice: true,
          doors: false,
          windows: stampWindows,
          ...facadeOpts,
        });
      } else if (massing === 'setback') {
        emitRingWalls(podium ? shaftRing : wallRing, bodyY0, setbackYA, {
          plinth: !podium && shopWorld <= 0.02,
          shop: !podium && shopWorld > 0.02,
          cornice: true,
          doors: !podium,
          windows: stampWindows,
          stringCourses: houseCourse,
          ...facadeOpts,
        });
        emitRingWalls(setbackWall1, setbackYA, setbackYB, {
          plinth: false,
          shop: false,
          cornice: true,
          doors: false,
          windows: stampWindows,
          ...facadeOpts,
        });
        if (setbackSteps >= 3) {
          emitRingWalls(setbackWall2, setbackYB, heightWorld, {
            plinth: false,
            shop: false,
            cornice: true,
            doors: false,
            windows: stampWindows,
            ...facadeOpts,
          });
        }
      } else if (massing === 'mansard') {
        emitRingWalls(podium ? shaftRing : wallRing, bodyY0, mansardEaves, {
          plinth: !podium && shopWorld <= 0.02,
          shop: !podium && shopWorld > 0.02,
          cornice: true,
          doors: !podium,
          windows: stampWindows,
          stringCourses: houseCourse,
          ...facadeOpts,
        });
      } else {
        emitRingWalls(podium ? shaftRing : wallRing, bodyY0, heightWorld, {
          plinth: !podium && shopWorld <= 0.02,
          shop: !podium && shopWorld > 0.02,
          cornice: true,
          doors: !podium,
          windows: stampWindows,
          stringCourses:
            houseCourse && (massing === 'parapet' || massing === 'slab' || massing === 'sawtooth'),
          ...facadeOpts,
        });
      }
    }

    const wantSign =
      !streetKind &&
      !cheapsideNotice &&
      (style === STYLE_RETAIL || (style === STYLE_OFFICE && seed % 9 === 0)) &&
      longestM >= 8;
    if (wantSign && scratch) {
      const a = ring[longestI]!;
      const bp = ring[(longestI + 1) % n]!;
      const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
      const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
      const along = Math.min(4.8 * METERS_TO_WORLD, elen * 0.42);
      const ySign =
        (shopWorld > 0.02 ? shopWorld : 4.2 * METERS_TO_WORLD * vScale) + 0.2 * METERS_TO_WORLD;
      const mx = (a.x + bp.x) / 2 + nx * 0.12 * METERS_TO_WORLD;
      const mz = (a.z + bp.z) / 2 + nz * 0.12 * METERS_TO_WORLD;
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

    const roofRing = massing === 'setback' || !podium ? ring : shaftRing;
    const axis = principalAxis(ring, cx, cz);
    const pitched = pitchedKind && n <= 24;
    const eavesY = massing === 'mansard' ? mansardEaves : heightWorld;
    const riseWorld = pitched
      ? massing === 'mansard'
        ? Math.max(heightWorld - eavesY, 5.5 * METERS_TO_WORLD)
        : Math.min(12 * METERS_TO_WORLD, Math.max(4.2 * METERS_TO_WORLD, axis.maxPerp * 0.95))
      : 0;
    const gableRoof = massing === 'gable';

    const roofYAt = (p: { x: number; z: number }): number => {
      if (!pitched) return eavesY;
      if (gableRoof) {
        const d = Math.abs((p.x - cx) * axis.px + (p.z - cz) * axis.pz);
        return eavesY + riseWorld * (1 - Math.min(1, d / axis.maxPerp));
      }
      const d = Math.hypot(p.x - cx, p.z - cz);
      let maxD = 1e-6;
      for (const q of roofRing) maxD = Math.max(maxD, Math.hypot(q.x - cx, q.z - cz));
      return eavesY + riseWorld * (1 - Math.min(1, d / maxD));
    };

    if (pitched && !streetKind) {
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

    if (streetKind) {
      emitStreetUniqueRoofs(streetKind, {
        ring,
        plan,
        heightWorld,
        emitRoof,
        insetRing,
        pushBox,
        pushVertex,
        pushTri: (i0, i1, i2) => {
          indices.push(i0, i1, i2);
        },
        pushOrientedBox,
        outwardNormal,
      });
    } else {
      if (podium) emitRoof(ring, () => podiumWorld, pal.mixHex(roofHex, pal.AO_DARK, 0.18));
      if (setSil.kind === 'wedge-step') {
        const apex = ring[setSil.apexIndex] ?? { x: cx, z: cz };
        for (let s = 0; s < setSil.steps; s++) {
          const y1 = bodyY0 + bodySpan * setSil.t1[s]!;
          const stepRing = scaleToward(ring, apex.x, apex.z, setSil.scales[s]!);
          emitRoof(
            stepRing,
            () => y1,
            s === setSil.steps - 1 ? roofHex : pal.mixHex(roofHex, pal.AO_DARK, 0.12),
          );
        }
      } else if (setSil.kind === 'disk') {
        for (let s = 0; s < setSil.bands; s++) {
          const y1 = bodyY0 + bodySpan * ((s + 1) / setSil.bands);
          const bandRing = insetRing(ring, cx, cz, setSil.scales[s]!);
          emitRoof(
            bandRing,
            () => y1,
            s === setSil.bands - 1 ? roofHex : pal.mixHex(roofHex, pal.AO_DARK, 0.1),
          );
        }
      } else if (setSil.kind === 'ell') {
        const splitY = bodyY0 + bodySpan * setSil.tBreak;
        emitRoof(ring, () => splitY, pal.mixHex(roofHex, pal.AO_DARK, 0.12));
        emitRoof(insetRing(ring, cx, cz, setSil.shortScale), () => heightWorld, roofHex);
      } else if (massing === 'setback') {
        emitRoof(
          podium ? shaftRing : ring,
          () => setbackYA,
          pal.mixHex(roofHex, pal.AO_DARK, 0.14),
        );
        if (setbackSteps >= 3) {
          emitRoof(setbackRoof1, () => setbackYB, pal.mixHex(roofHex, pal.AO_DARK, 0.08));
          emitRoof(setbackRoof2, () => heightWorld, roofHex);
        } else {
          emitRoof(setbackRoof1, () => heightWorld, roofHex);
        }
      } else {
        emitRoof(roofRing, roofYAt, roofHex);
      }
    }

    const wantParapet =
      !streetKind &&
      !pitched &&
      recipe.roof.kind === 'parapet' &&
      (major || areaM2 > 140) &&
      b.heightM >= 8 &&
      n <= 24;
    if (wantParapet) {
      const lip = 1.6 * METERS_TO_WORLD;
      const inset = 0.35 * METERS_TO_WORLD;
      const thick = 0.55 * METERS_TO_WORLD;
      const capRing =
        massing === 'setback' ? (setbackSteps === 3 ? setbackRoof2 : setbackRoof1) : roofRing;
      const count = capRing.length;
      for (let i = 0; i < count; i++) {
        const a = capRing[i]!;
        const bp = capRing[(i + 1) % count]!;
        const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
        const ax = a.x - nx * inset;
        const az = a.z - nz * inset;
        const bx = bp.x - nx * inset;
        const bz = bp.z - nz * inset;
        const y0 = heightWorld;
        const y1 = heightWorld + lip;
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

    if (
      !streetKind &&
      (massing === 'gable' || massing === 'hip') &&
      (style === STYLE_HOUSE || style === STYLE_TERRACE)
    ) {
      const houses = longestM >= 14 ? Math.max(2, Math.round(longestM / 6.5)) : 0;
      if (houses >= 2) {
        const front = ring[longestI]!;
        const back = ring[(longestI + 1) % n]!;
        const [nx, nz] = outwardNormal(front.x, front.z, back.x, back.z, cx, cz);
        const elen = Math.hypot(back.x - front.x, back.z - front.z) || 1;
        const tx = (back.x - front.x) / elen;
        const tz = (back.z - front.z) / elen;
        const ribHex = pal.mixHex(baseHex, pal.AO_DARK, 0.42);
        const half = 0.22 * METERS_TO_WORLD;
        for (let hse = 1; hse < houses; hse++) {
          const t = hse / houses;
          const mx = front.x + (back.x - front.x) * t;
          const mz = front.z + (back.z - front.z) * t;
          const hx = tx * half;
          const hz = tz * half;
          const p0 = pushVertex(mx - hx, 0, mz - hz, nx, 0, nz, ribHex);
          const p1 = pushVertex(mx + hx, 0, mz + hz, nx, 0, nz, ribHex);
          const p2 = pushVertex(mx + hx, heightWorld, mz + hz, nx, 0, nz, ribHex);
          const p3 = pushVertex(mx - hx, heightWorld, mz - hz, nx, 0, nz, ribHex);
          indices.push(p0, p1, p2, p0, p2, p3);
        }
      }
    }

    if (scratch) {
      const named = streetKind ? STREET_UNIQUE_LABEL[streetKind] : null;
      scratch.picks.push({
        x: cx,
        z: cz,
        heightWorld,
        heightM: b.heightM,
        areaM2,
        style,
        district,
        label: named?.use ?? pal.USE_LABEL[style] ?? pal.STYLE_LABEL[style] ?? 'Building',
        address: named?.name ?? pal.streetAddress(district, seed),
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
  mesh.frustumCulled = false;
  mesh.userData.chunkId = chunkId;
  mesh.userData.major = major;
  return mesh;
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

function polyBBox(p: CityPoly): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const n = p.verts.length / 2;
  for (let i = 0; i < n; i++) {
    const x = dequantizeX(p.verts[i * 2]!);
    const z = dequantizeY(p.verts[i * 2 + 1]!);
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

function shadeAt(
  x: number,
  z: number,
  base: THREE.Color,
  dark: THREE.Color,
  lite: THREE.Color,
): THREE.Color {
  const h = Math.imul(Math.round(x * 40), 374761393) ^ Math.imul(Math.round(z * 40), 668265263);
  const u = ((h >>> 0) % 1000) / 1000;
  if (u < 0.38) return dark;
  if (u > 0.72) return lite;
  return base;
}

function finishPolyMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  colors: ArrayLike<number> | null,
  color: number,
  opts: { receiveShadow?: boolean; doubleSide?: boolean },
): THREE.Mesh | null {
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      positions instanceof Float32Array ? positions : new Float32Array(positions),
      3,
    ),
  );
  if (colors) {
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(
        colors instanceof Float32Array ? colors : new Float32Array(colors),
        3,
      ),
    );
  }
  geometry.setIndex(
    new THREE.BufferAttribute(
      indices instanceof Uint32Array ? indices : new Uint32Array(indices),
      1,
    ),
  );
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

function buildMergedPolyMesh(
  polys: CityPoly[],
  color: number,
  y: number,
  opts: {
    receiveShadow?: boolean;
    doubleSide?: boolean;
    vary?: boolean;
    keep?: KeepDisk | null;
  } = {},
): THREE.Mesh | null {
  const keep = opts.keep ?? null;
  const base = new THREE.Color(color);
  const dark = new THREE.Color(color).offsetHSL(0, 0.04, -0.08);
  const lite = new THREE.Color(color).offsetHSL(0.02, -0.02, 0.07);

  if (keep) {
    const positions: number[] = [];
    const colorArr: number[] | null = opts.vary ? [] : null;
    const indices: number[] = [];
    for (const p of polys) {
      const box = polyBBox(p);
      if (!aabbHitsKeep(box.minX, box.minZ, box.maxX, box.maxZ, keep)) continue;
      const n = p.verts.length / 2;
      const xs = new Array<number>(n);
      const zs = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        xs[i] = dequantizeX(p.verts[i * 2]!);
        zs[i] = dequantizeY(p.verts[i * 2 + 1]!);
      }
      const used = new Int32Array(n).fill(-1);
      const mapVert = (i: number): number => {
        const cached = used[i]!;
        if (cached >= 0) return cached;
        const x = xs[i]!;
        const z = zs[i]!;
        const idx = positions.length / 3;
        used[i] = idx;
        positions.push(x, y, z);
        if (colorArr) {
          const c = shadeAt(x, z, base, dark, lite);
          colorArr.push(c.r, c.g, c.b);
        }
        return idx;
      };
      for (let t = 0; t + 2 < p.indices.length; t += 3) {
        const ia = p.indices[t]!;
        const ib = p.indices[t + 1]!;
        const ic = p.indices[t + 2]!;
        if (
          !inKeepDisk(xs[ia]!, zs[ia]!, keep) ||
          !inKeepDisk(xs[ib]!, zs[ib]!, keep) ||
          !inKeepDisk(xs[ic]!, zs[ic]!, keep)
        ) {
          continue;
        }
        indices.push(mapVert(ia), mapVert(ib), mapVert(ic));
      }
    }
    return finishPolyMesh(positions, indices, colorArr, color, opts);
  }

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
  for (const p of polys) {
    const n = p.verts.length / 2;
    for (let i = 0; i < n; i++) {
      const x = dequantizeX(p.verts[i * 2]!);
      const z = dequantizeY(p.verts[i * 2 + 1]!);
      positions[vOff++] = x;
      positions[vOff++] = y;
      positions[vOff++] = z;
      if (colors) {
        const c = shadeAt(x, z, base, dark, lite);
        colors[cOff++] = c.r;
        colors[cOff++] = c.g;
        colors[cOff++] = c.b;
      }
    }
    for (let i = 0; i < p.indices.length; i++) indices[iOff++] = p.indices[i]! + vertBase;
    vertBase += n;
  }

  return finishPolyMesh(positions, indices, colors, color, opts);
}

export function buildWater(
  cityData: CityData,
  keep: KeepDisk | null = null,
): THREE.Object3D | null {
  const water = buildMergedPolyMesh(cityData.water, pal.WATER, WATER_Y, { keep });
  const group = new THREE.Group();
  if (water) group.add(water);

  const bankPos: number[] = [];
  const bankIdx: number[] = [];
  const halfW = 3.4 * METERS_TO_WORLD;
  const pad = 40 * METERS_TO_WORLD;
  for (const poly of cityData.water) {
    const n = poly.verts.length / 2;
    if (n < 3) continue;
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      pts.push({ x: dequantizeX(poly.verts[i * 2]!), z: dequantizeY(poly.verts[i * 2 + 1]!) });
    }
    pts.push(pts[0]!);
    for (const run of clipPolylineToKeep(pts, keep, pad)) {
      appendRibbon(bankPos, bankIdx, run, halfW, WATER_BANK_Y);
    }
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
  return group.children.length > 0 ? group : null;
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
  // One sample per cell. High-frequency hashes on fan verts were the creases.
  const u = 0.5 + 0.26 * Math.sin(x * 9.4 + z * 5.1) + 0.14 * Math.sin(x * 3.7 - z * 8.2);
  if (u < 0.4) return dark;
  if (u > 0.6) return lite;
  return base;
}

function emitParkVerts(
  positions: number[],
  colors: number[],
  indices: number[],
  verts: { x: number; z: number }[],
  y: number,
  shade: THREE.Color,
): void {
  const cross =
    (verts[1]!.x - verts[0]!.x) * (verts[2]!.z - verts[0]!.z) -
    (verts[1]!.z - verts[0]!.z) * (verts[2]!.x - verts[0]!.x);
  const order = cross < 0 ? [0, 2, 1] : [0, 1, 2];
  const base = positions.length / 3;
  for (const i of order) {
    const v = verts[i]!;
    positions.push(v.x, y, v.z);
    colors.push(shade.r, shade.g, shade.b);
  }
  indices.push(base, base + 1, base + 2);
}

function emitParkQuad(
  positions: number[],
  colors: number[],
  indices: number[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  shade: THREE.Color,
): void {
  emitParkVerts(
    positions,
    colors,
    indices,
    [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
    ],
    y,
    shade,
  );
  emitParkVerts(
    positions,
    colors,
    indices,
    [
      { x: x0, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 },
    ],
    y,
    shade,
  );
}

function ringHitsKeep(ring: { x: number; z: number }[], keep: KeepDisk | null): boolean {
  if (!keep) return true;
  const pad = 80 * METERS_TO_WORLD;
  for (const p of ring) {
    if (inKeepDisk(p.x, p.z, keep, pad)) return true;
  }
  return false;
}

function fillParkGrid(
  positions: number[],
  colors: number[],
  indices: number[],
  ring: { x: number; z: number }[],
  water: { x: number; z: number }[][],
  y: number,
  base: THREE.Color,
  dark: THREE.Color,
  lite: THREE.Color,
  keep: KeepDisk | null,
  cell: number,
): number {
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (const p of ring) {
    if (p.x < minx) minx = p.x;
    if (p.x > maxx) maxx = p.x;
    if (p.z < minz) minz = p.z;
    if (p.z > maxz) maxz = p.z;
  }
  if (keep) {
    minx = Math.max(minx, keep.x - keep.r);
    maxx = Math.min(maxx, keep.x + keep.r);
    minz = Math.max(minz, keep.z - keep.r);
    maxz = Math.min(maxz, keep.z + keep.r);
  }
  if (!(maxx > minx && maxz > minz)) return 0;
  let added = 0;
  for (let x0 = minx; x0 < maxx; x0 += cell) {
    const x1 = x0 + cell;
    for (let z0 = minz; z0 < maxz; z0 += cell) {
      const z1 = z0 + cell;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      const cornersIn =
        (pointInRing(x0, z0, ring) ? 1 : 0) +
        (pointInRing(x1, z0, ring) ? 1 : 0) +
        (pointInRing(x1, z1, ring) ? 1 : 0) +
        (pointInRing(x0, z1, ring) ? 1 : 0);
      const tight = cell < 18 * METERS_TO_WORLD;
      if (!pointInRing(cx, cz, ring) && (!tight || cornersIn < 2)) continue;
      if (keep && !inKeepDisk(cx, cz, keep)) continue;
      if (pointOverWater(cx, cz, water)) continue;
      if (
        landmarkExclusionAt(cx, cz) !== null ||
        landmarkExclusionAt(x0, z0) !== null ||
        landmarkExclusionAt(x1, z0) !== null ||
        landmarkExclusionAt(x1, z1) !== null ||
        landmarkExclusionAt(x0, z1) !== null
      ) {
        continue;
      }
      if (triangleHitsExclusion(x0, z0, x1, z0, x1, z1)) continue;
      if (triangleHitsExclusion(x0, z0, x1, z1, x0, z1)) continue;
      emitParkQuad(
        positions,
        colors,
        indices,
        x0,
        z0,
        x1,
        z1,
        y,
        parkShadeAt(cx, cz, base, dark, lite),
      );
      added += 1;
    }
  }
  return added;
}

function emitOsmParkTris(
  positions: number[],
  colors: number[],
  indices: number[],
  ring: { x: number; z: number }[],
  park: CityPoly,
  water: { x: number; z: number }[][],
  y: number,
  base: THREE.Color,
  dark: THREE.Color,
  lite: THREE.Color,
  keep: KeepDisk | null,
): void {
  for (let t = 0; t + 2 < park.indices.length; t += 3) {
    const a = ring[park.indices[t]!]!;
    const b = ring[park.indices[t + 1]!]!;
    const c = ring[park.indices[t + 2]!]!;
    if (!a || !b || !c) continue;
    const mx = (a.x + b.x + c.x) / 3;
    const mz = (a.z + b.z + c.z) / 3;
    const longest = Math.max(
      Math.hypot(a.x - b.x, a.z - b.z),
      Math.hypot(b.x - c.x, b.z - c.z),
      Math.hypot(c.x - a.x, c.z - a.z),
    );
    if (longest > 50 * METERS_TO_WORLD) continue;
    if (triangleHitsExclusion(a.x, a.z, b.x, b.z, c.x, c.z)) continue;
    if (pointOverWater(mx, mz, water)) continue;
    if (
      keep &&
      (!inKeepDisk(a.x, a.z, keep) || !inKeepDisk(b.x, b.z, keep) || !inKeepDisk(c.x, c.z, keep))
    ) {
      continue;
    }
    emitParkVerts(positions, colors, indices, [a, b, c], y, parkShadeAt(mx, mz, base, dark, lite));
  }
}

function buildParkGrass(cityData: CityData, keep: KeepDisk | null = null): THREE.Mesh | null {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color(0x6ea84c);
  const dark = new THREE.Color(0x5a9340);
  const lite = new THREE.Color(0x88bf5e);
  const water = waterRings(cityData);
  for (const p of cityData.parks) {
    const info = parkCentroid(p);
    if (!info) continue;
    if (!ringHitsKeep(info.ring, keep)) continue;
    const cell = parkCellWorld(info.areaM2);
    const tiled = fillParkGrid(
      positions,
      colors,
      indices,
      info.ring,
      water,
      PARK_Y,
      base,
      dark,
      lite,
      keep,
      cell,
    );
    const cellM = cell / METERS_TO_WORLD;
    if (tiled === 0 || tiled * cellM * cellM < info.areaM2 * 0.25) {
      emitOsmParkTris(
        positions,
        colors,
        indices,
        info.ring,
        p,
        water,
        PARK_Y,
        base,
        dark,
        lite,
        keep,
      );
    }
  }
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const normals = new Float32Array((positions.length / 3) * 3);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.FrontSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.name = 'grass';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}

export function buildParks(cityData: CityData, keep: KeepDisk | null = null): THREE.Group | null {
  const grass = buildParkGrass(cityData, keep);
  if (!grass) return null;
  const group = new THREE.Group();
  group.add(grass);

  const pathPos: number[] = [];
  const pathIdx: number[] = [];
  const halfW = 2.8 * METERS_TO_WORLD;
  for (const park of cityData.parks) {
    const info = parkCentroid(park);
    if (!info || info.areaM2 < 18_000) continue;
    if (!inKeepDisk(info.x, info.z, keep)) continue;
    if (landmarkExclusionAt(info.x, info.z) !== null) continue;
    if (nearLondonCityAirport(info.x, info.z)) continue;
    if (info.ring.some((p) => nearLondonCityAirport(p.x, p.z))) continue;
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
    for (const run of clipPolylineToKeep(pts, keep)) {
      const ribbon = buildRibbonGeometry(run, halfW, PARK_Y + 0.012);
      const base = pathPos.length / 3;
      for (const v of ribbon.positions) pathPos.push(v);
      for (const i of ribbon.indices) pathIdx.push(i + base);
    }
  }
  if (pathPos.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pathPos, 3));
    g.setIndex(pathIdx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ color: pal.PARK_PATH, side: THREE.DoubleSide, fog: true }),
    );
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
}

function mulberry(h: number): number {
  return (Math.imul(h, 1103515245) + 12345) | 0;
}

/** Instanced low-poly trees in parks and along major streets. */
export function buildParkTrees(
  cityData: CityData,
  keep: KeepDisk | null = null,
): THREE.Group | null {
  const dummy = new THREE.Object3D();
  const spots: { x: number; z: number; scale: number; shade: number; cluster: boolean }[] = [];

  for (const park of cityData.parks) {
    const info = parkCentroid(park);
    if (!info || info.areaM2 < 90) continue;
    if (!inKeepDisk(info.x, info.z, keep, 80 * METERS_TO_WORLD)) continue;
    const count = Math.min(80, Math.max(3, Math.round(info.areaM2 / 900)));
    let h = Math.imul(info.ring.length + 1, 2654435761) ^ park.verts[0]!;
    let placed = 0;
    for (let t = 0; t < count * 5 && spots.length < TREE_MAX && placed < count; t++) {
      h = mulberry(h);
      const ang = ((h >>> 0) / 4294967296) * Math.PI * 2;
      const rad =
        Math.sqrt(((h >>> 8) & 255) / 255) * Math.sqrt(info.areaM2) * METERS_TO_WORLD * 0.28;
      const x = info.x + Math.cos(ang) * rad;
      const z = info.z + Math.sin(ang) * rad;
      if (!inKeepDisk(x, z, keep)) continue;
      if (!pointInRing(x, z, info.ring)) continue;
      if (landmarkExclusionAt(x, z) !== null) continue;
      if (nearLondonCityAirport(x, z)) continue;
      spots.push({
        x,
        z,
        scale: 14.5 + ((h >>> 16) & 7) * 0.9,
        shade: (h >>> 20) % 3,
        cluster: false,
      });
      placed += 1;
    }
  }

  const streetSpacing = [20, 26, 36];
  const rings = waterRings(cityData);
  for (const road of cityData.roads as CityRoad[]) {
    if (road.tier > 2 || spots.length >= TREE_MAX) continue;
    const pts = roadPts(road);
    if (!pts) continue;
    if (!ptsHitKeep(pts, keep, 40 * METERS_TO_WORLD)) continue;
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
          if (
            !pointOverWater(sx, sz, rings) &&
            !pointOnPrefabDeck(sx, sz) &&
            !nearLondonCityAirport(sx, sz)
          ) {
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
    mesh.castShadow = false;
    mesh.receiveShadow = false;
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
  if (inTowerBridgeCorridor(x, z) || nearTowerBridgePrefab(x, z)) return true;
  if (onLcyRunway(x, z)) return true;
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
    ...LANDMARKS.filter(
      (lm) => isDeckLandmark(lm.kind) && lm.kind !== 'oldstreet' && lm.kind !== 'towerbridge',
    ),
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

function skipRoadVertex(x: number, z: number): boolean {
  return inTowerBridgeCorridor(x, z) || nearTowerBridgePrefab(x, z) || onLcyRunway(x, z);
}

function clipRibbonPts(pts: { x: number; z: number }[]): { x: number; z: number }[][] {
  const runs: { x: number; z: number }[][] = [];
  let cur: { x: number; z: number }[] = [];
  const keepSeg = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    !segmentHitsTowerBridge(a, b) && !onLcyRunway(a.x, a.z) && !onLcyRunway(b.x, b.z);
  for (const p of pts) {
    if (cur.length === 0) {
      if (!skipRoadVertex(p.x, p.z)) cur.push(p);
      continue;
    }
    const prev = cur[cur.length - 1]!;
    if (keepSeg(prev, p)) {
      cur.push(p);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = skipRoadVertex(p.x, p.z) ? [] : [p];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

export type PlannedCrosswalk = {
  x: number;
  z: number;
  dx: number;
  dz: number;
  half: number;
};

/** One zebra per junction cluster — not one per approach, which stacks at 4-ways. */
export function plannedCrosswalks(cityData: CityData): PlannedCrosswalk[] {
  const rings = waterRings(cityData);
  const overWater = (x: number, z: number) => pointOverWater(x, z, rings);
  type End = { x: number; z: number; dx: number; dz: number; runLen: number };
  const ends: End[] = [];
  const half0 = (ROAD_WIDTHS_M[0]! * METERS_TO_WORLD) / 2;
  const minRun = 28 * METERS_TO_WORLD;
  for (const road of cityData.roads as CityRoad[]) {
    if (road.tier !== 0) continue;
    const pts = roadPts(road);
    if (!pts) continue;
    for (const run of splitRoadRuns(pts, overWater)) {
      if (run.pts.length < 2) continue;
      let runLen = 0;
      for (let i = 0; i < run.pts.length - 1; i++) {
        runLen += Math.hypot(run.pts[i + 1]!.x - run.pts[i]!.x, run.pts[i + 1]!.z - run.pts[i]!.z);
      }
      if (runLen < minRun) continue;
      const pushEnd = (a: { x: number; z: number }, b: { x: number; z: number }) => {
        if (skipRoadVertex(a.x, a.z)) return;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        ends.push({ x: a.x, z: a.z, dx, dz, runLen });
      };
      pushEnd(run.pts[0]!, run.pts[1]!);
      pushEnd(run.pts[run.pts.length - 1]!, run.pts[run.pts.length - 2]!);
    }
  }

  const junctionR = 16 * METERS_TO_WORLD;
  const hashCell = 16 * METERS_TO_WORLD;
  const grid = new Map<string, number[]>();
  const cellKey = (x: number, z: number): string =>
    `${Math.round(x / hashCell)}:${Math.round(z / hashCell)}`;
  for (let i = 0; i < ends.length; i++) {
    const k = cellKey(ends[i]!.x, ends[i]!.z);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }

  const nearby = (i: number): number[] => {
    const e = ends[i]!;
    const cx = Math.round(e.x / hashCell);
    const cz = Math.round(e.z / hashCell);
    const hit: number[] = [];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const bucket = grid.get(`${gx}:${gz}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i) continue;
          if (Math.hypot(ends[j]!.x - e.x, ends[j]!.z - e.z) < junctionR) hit.push(j);
        }
      }
    }
    return hit;
  };

  const parent = ends.map((_, i) => i);
  const find = (i: number): number => {
    let p = i;
    while (parent[p] !== p) p = parent[p]!;
    let x = i;
    while (x !== p) {
      const n = parent[x]!;
      parent[x] = p;
      x = n;
    }
    return p;
  };
  for (let i = 0; i < ends.length; i++) {
    for (const j of nearby(i)) {
      const pa = find(i);
      const pb = find(j);
      if (pa !== pb) parent[pa] = pb;
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < ends.length; i++) {
    const root = find(i);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(i);
    else clusters.set(root, [i]);
  }

  const setback = 14 * METERS_TO_WORLD;
  const candidates: PlannedCrosswalk[] = [];
  for (const idxs of clusters.values()) {
    if (idxs.length < 2) continue;
    let crossing = false;
    for (let a = 0; a < idxs.length && !crossing; a++) {
      const ea = ends[idxs[a]!]!;
      for (let b = a + 1; b < idxs.length; b++) {
        const eb = ends[idxs[b]!]!;
        const dot = ea.dx * eb.dx + ea.dz * eb.dz;
        if (Math.abs(dot) < 0.55) {
          crossing = true;
          break;
        }
      }
    }
    if (!crossing) continue;
    const ranked = idxs
      .map((i) => ends[i]!)
      .filter((e) => e.runLen >= setback + 8 * METERS_TO_WORLD)
      .sort((a, b) => b.runLen - a.runLen);
    const best = ranked[0];
    if (!best) continue;
    const x = best.x + best.dx * setback;
    const z = best.z + best.dz * setback;
    if (skipRoadVertex(x, z)) continue;
    candidates.push({ x, z, dx: best.dx, dz: best.dz, half: half0 });
  }

  const minSep = 28 * METERS_TO_WORLD;
  const kept: PlannedCrosswalk[] = [];
  for (const e of candidates) {
    if (kept.some((k) => Math.hypot(k.x - e.x, k.z - e.z) < minSep)) continue;
    kept.push(e);
  }
  return kept;
}

/** One group per tier so minor streets can hide independently at low zoom. */
export function buildRoads(
  cityData: CityData,
  keep: KeepDisk | null = null,
  paintMarks = true,
): THREE.Group | null {
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
  const zebras = paintMarks ? plannedCrosswalks(cityData) : [];
  const roadPad = 80 * METERS_TO_WORLD;

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
      if (!ptsHitKeep(pts, keep, roadPad)) continue;
      const runs = splitRoadRuns(pts, overWater);
      for (const run of runs) {
        for (const piece of clipRibbonPts(run.pts)) {
          for (const clipped of clipPolylineToKeep(piece, keep, roadPad)) {
            appendRibbon(walkPos, walkIdx, clipped, halfWalk, SIDEWALK_Y);
            appendRibbon(asphPos, asphIdx, clipped, halfCarriage, ROAD_Y);
            if (paintMarks && tier <= 1) {
              const dashes = polylineDashes(clipped);
              const halfDash = (DASH_WIDTH_M * METERS_TO_WORLD) / 2;
              for (const d of dashes) appendRibbon(markPos, markIdx, [d.a, d.b], halfDash, MARK_Y);
            }
          }
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
      if (runTouchesTowerBridge(span.pts)) continue;
      for (const clipped of clipPolylineToKeep(span.pts, keep, roadPad)) {
        if (clipped.length < 2) continue;
        const halfCarriage = (CROSSING_WIDTH_M * METERS_TO_WORLD) / 2;
        appendRibbon(stitchPos, stitchIdx, clipped, halfCarriage, ROAD_Y);
        if (paintMarks) {
          const dashes = polylineDashes(clipped);
          const halfDash = (DASH_WIDTH_M * METERS_TO_WORLD) / 2;
          for (const d of dashes) appendRibbon(markPos, markIdx, [d.a, d.b], halfDash, MARK_Y);
        }
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

  for (const zebra of zebras) {
    if (!inKeepDisk(zebra.x, zebra.z, keep, roadPad)) continue;
    addCrosswalk(markPos, markIdx, zebra.x, zebra.z, zebra.dx, zebra.dz, zebra.half);
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

export function buildGround(keep: KeepDisk | null = null): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: pal.GROUND,
    fog: true,
  });
  if (keep) {
    const size = keep.r * 2;
    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ground';
    mesh.position.set(keep.x, 0, keep.z);
    mesh.receiveShadow = false;
    return mesh;
  }
  const marginX = WORLD.width * 0.3;
  const marginY = WORLD.height * 0.3;
  const geometry = new THREE.PlaneGeometry(WORLD.width + marginX * 2, WORLD.height + marginY * 2);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground';
  mesh.position.set(WORLD.width / 2, 0, WORLD.height / 2);
  mesh.receiveShadow = false;
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
