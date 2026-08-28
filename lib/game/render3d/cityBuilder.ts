/**
 * RUNWAY — decoded city data -> three.js geometry.
 *
 * Real OSM footprints don't have consistent winding, so wall/roof faces
 * compute their own outward-facing normal (from the footprint centroid) and
 * pick triangle order to match it at build time, rather than assuming a
 * fixed winding convention. This is a one-time streaming-build cost, not a
 * per-frame one.
 */

import * as THREE from 'three';
import { METERS_TO_WORLD, TUBE_LINES, WORLD, project, unproject } from '../geo';
import { HUB_POS } from '../overlay';
import type { HubId } from '../types';
import { dequantizeX, dequantizeY, type CityBuilding, type CityData, type CityPoly, type CityRoad } from './format';
import { fromRgb565, isGenericWallPaint } from './osmColour';
import {
  ROOF_FLAT,
  ROOF_GABLED,
  STYLE_HOUSE,
  STYLE_INDUSTRIAL,
  STYLE_OFFICE,
  STYLE_APARTMENTS,
  STYLE_RETAIL,
  STYLE_TERRACE,
  STYLE_TOWER,
  facadeSlice,
  facadeVForFloors,
  inferRoof,
  resolveStyle,
  restyleForDistrict,
  districtAt,
  extrusionScale,
  wantPodium,
  type DistrictId,
} from './buildingStyle';

export { HEIGHT_SCALE, TOWER_HEIGHT_SCALE, NOTICED_BAKE_HEIGHT_SCALE } from './buildingStyle';

export const CHUNK_COLS = 8;
export const CHUNK_ROWS = 6;
export const CHUNK_COUNT = CHUNK_COLS * CHUNK_ROWS;

const HOUSE_BRICK = [
  0xf0d48a, 0xc43a28, 0xf4eee0, 0x8e2418, 0xd47838, 0x6a3028, 0xc4a060, 0xb85040, 0xd8c4b0, 0x9aada8,
  0xe8b0a8, 0xa8c0d0, 0xf2e6c8, 0x7a3a28, 0xc8d070, 0x5a4038,
].map((c) => new THREE.Color(c));
const TERRACE_BRICK = [
  0xe2a848, 0xc02820, 0xf7f1e4, 0x8a1810, 0xd07030, 0xb84030, 0xd8b070, 0x9a3a28, 0xe8c8b8, 0x7a8a9a,
  0xf0d090, 0x4a6a8a, 0xd4a090, 0x6e3a28, 0xc4b49a, 0xb86840,
].map((c) => new THREE.Color(c));
const APARTMENT_SLATE = [0xe0c8a4, 0xc44030, 0x8a9aaa, 0x7a5040, 0xb84830, 0xd2b896, 0x5a6a78, 0xc89060].map(
  (c) => new THREE.Color(c),
);
const OFFICE_GLASS = [0x6a8aa0, 0xb8c8d4, 0x4a7088, 0xc4b090, 0x5a9aaa, 0x8a9aac, 0xd0c4b0, 0x3a5868].map(
  (c) => new THREE.Color(c),
);
const INDUSTRIAL_DUN = [0xc4a85c, 0x8a5844, 0x5a7860, 0xd4b070, 0x7a4a38, 0x6a6860].map((c) => new THREE.Color(c));
const TOWER_GLASS = [0x5a88a8, 0xc8d4dc, 0x3a6078, 0xa8b8c4, 0x7aa0b0, 0xd0c8b8].map((c) => new THREE.Color(c));
const RETAIL_WARM = [0xe84828, 0xf2d8a8, 0xa02820, 0xd49040, 0x2a6ab4, 0xf0c030].map((c) => new THREE.Color(c));
const CANARY_GLASS = [0x6a8aa8, 0xc8d4dc, 0x3a5870, 0xa8c0d0, 0x5aa0b0, 0xd0d8e0, 0x2a4050, 0x8ab0c0].map(
  (c) => new THREE.Color(c),
);
const CANARY_PODIUM = [0xc4c0b8, 0x9aa4ac, 0xd8d4cc, 0x6a7278].map((c) => new THREE.Color(c));
const CITY_STONE = [0xc4b090, 0x5a88a8, 0xd0c4b0, 0x3a5868, 0xa8b8c4, 0x8a9aaa, 0xe0d8c8].map(
  (c) => new THREE.Color(c),
);
const PORTLAND = [0xe8e2d4, 0xd4cbb8, 0xc8c0b0, 0xb0a898, 0xe0d8c8, 0x9a9488].map((c) => new THREE.Color(c));
const STUCCO_CREAM = [0xf4eee4, 0xe8dcc8, 0xf7f1e4, 0xeee4d4, 0xd8c4b0, 0xc43a28, 0xf0d48a, 0xe2d2c0].map(
  (c) => new THREE.Color(c),
);
const GEORGIAN = [0xc43a28, 0xe8d4b0, 0xb85040, 0xf0d48a, 0x8e2418, 0xd8c4b0, 0xf4eee0].map((c) => new THREE.Color(c));
const STOCK_YELLOW = [0xd2b896, 0xc4a060, 0xb89870, 0xe2c8a0, 0x8a6a48, 0xc8b090].map((c) => new THREE.Color(c));
const SHORE_WAREHOUSE = [0x8e5a3a, 0xc4a060, 0x6a4030, 0xe8b0a8, 0x5a7860, 0xd4b070, 0x3a3c42, 0xc02820].map(
  (c) => new THREE.Color(c),
);
const EAST_SOOT = [0x6a4030, 0xa87850, 0x5a3028, 0x8a5844, 0xb89070, 0x4a3028].map((c) => new THREE.Color(c));
const SOUTH_BANK = [0xb8b0a4, 0x8a3e36, 0x6a8aa0, 0xc4b49a, 0x5a6a78, 0xd0c8b8].map((c) => new THREE.Color(c));
const BATTERSEA_BRICK = [0x8a3e36, 0x6a3028, 0xc4a060, 0x5a88a8, 0xb85040].map((c) => new THREE.Color(c));
const GREENWICH_NAVY = [0xe8dcc8, 0xc4a060, 0x4a6a8a, 0xd4c4b0, 0x8a9aaa].map((c) => new THREE.Color(c));
const BRIXTON_WARM = [0xc02820, 0xd47838, 0xe2a848, 0x8a1810, 0xf0d48a, 0xb84030].map((c) => new THREE.Color(c));
const STRATFORD_NEW = [0xa8c0d0, 0xc8d4dc, 0xe8dcc8, 0x5a88a8, 0xd0c8b8, 0xb8c8d4].map((c) => new THREE.Color(c));
const AO_DARK = new THREE.Color(0x6a5848);
const CORNICE = new THREE.Color(0xe8e0d4);
const DOOR_PAINTS = [0xc41c1c, 0x1a3a6e, 0x1a1a1a, 0x2d5a3d, 0xd4a017, 0x0e6b6b, 0xf4f0e6, 0x6b2d5a].map(
  (c) => new THREE.Color(c),
);
const ROOF_SLATE = new THREE.Color(0x5a6270);
const ROOF_TILE = new THREE.Color(0xc45838);
const ROOF_METAL = new THREE.Color(0x5a5850);
const ROOF_OFFICE = new THREE.Color(0x5c616a);
const SHOP_GLOW = new THREE.Color(0x8a6040);
const HVAC_COLOR = new THREE.Color(0x3a4458);
const CHIMNEY_COLOR = new THREE.Color(0x3a2420);

const ROAD_WIDTHS_M = [11, 8, 5.5];
const SIDEWALK_M = [3.0, 2.4, 1.9];
const ROAD_Y = 0.18;
const SIDEWALK_Y = 0.1;
const SIDEWALK_COLOR = 0xc9bba8;
const ROAD_DASH_M = 8;

const TUBE_WIDTH_M = 4;
const TUBE_Y = 0.25;

const HUB_GLOW_COLOR = 0x7dd3fc;
export const HUB_GLOW_PLAYER_COLOR = 0xf8c33a;
const HUB_GLOW_SIZE_M = 50;
const HUB_GLOW_HEIGHT_M = 8;

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

function jitterColor(c: THREE.Color, seed: number, hueSpread: number): THREE.Color {
  const out = c.clone();
  const u = ((seed >>> 8) & 255) / 255;
  const v = ((seed >>> 16) & 255) / 255;
  const w = ((seed >>> 24) & 255) / 255;
  out.offsetHSL((u - 0.5) * hueSpread, (v - 0.5) * 0.28, (w - 0.5) * 0.1);
  return out;
}

/** Perpendicular to edge a->b that points away from the footprint centroid. */
function outwardNormal(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): [number, number] {
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

export function createBuildingMaterial(
  albedo: THREE.Texture,
  emissiveMap: THREE.Texture,
): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: albedo,
    emissive: 0xffffff,
    emissiveMap,
    emissiveIntensity: 0,
  });
}

function paletteFor(style: number, district: DistrictId): THREE.Color[] {
  switch (district) {
    case 'canary':
      return style === STYLE_TOWER || style === STYLE_OFFICE || style === STYLE_APARTMENTS
        ? CANARY_GLASS
        : CANARY_PODIUM;
    case 'city':
      return style === STYLE_TOWER ? TOWER_GLASS : CITY_STONE;
    case 'westminster':
      return style === STYLE_TOWER ? TOWER_GLASS : PORTLAND;
    case 'westend':
    case 'kensington':
      return style === STYLE_HOUSE || style === STYLE_TERRACE || style === STYLE_OFFICE
        ? STUCCO_CREAM
        : style === STYLE_TOWER
          ? TOWER_GLASS
          : STUCCO_CREAM;
    case 'islington':
      return style === STYLE_TOWER ? TOWER_GLASS : GEORGIAN;
    case 'camden':
      return style === STYLE_TOWER ? TOWER_GLASS : STOCK_YELLOW;
    case 'shoreditch':
      return style === STYLE_TOWER ? TOWER_GLASS : SHORE_WAREHOUSE;
    case 'eastend':
      return style === STYLE_TOWER ? TOWER_GLASS : EAST_SOOT;
    case 'southbank':
      return SOUTH_BANK;
    case 'battersea':
      return style === STYLE_TOWER ? TOWER_GLASS : BATTERSEA_BRICK;
    case 'greenwich':
      return GREENWICH_NAVY;
    case 'south':
      return style === STYLE_TOWER ? TOWER_GLASS : BRIXTON_WARM;
    case 'stratford':
      return style === STYLE_TOWER || style === STYLE_OFFICE ? STRATFORD_NEW : STRATFORD_NEW;
    default:
      break;
  }
  switch (style) {
    case STYLE_HOUSE:
      return HOUSE_BRICK;
    case STYLE_TERRACE:
      return TERRACE_BRICK;
    case STYLE_OFFICE:
      return OFFICE_GLASS;
    case STYLE_INDUSTRIAL:
      return INDUSTRIAL_DUN;
    case STYLE_RETAIL:
      return RETAIL_WARM;
    case STYLE_TOWER:
      return TOWER_GLASS;
    default:
      return APARTMENT_SLATE;
  }
}

function roofTint(style: number, roof: number): THREE.Color {
  if (roof !== ROOF_FLAT) return style === STYLE_HOUSE ? ROOF_TILE : ROOF_SLATE;
  if (style === STYLE_INDUSTRIAL) return ROOF_METAL;
  if (style === STYLE_OFFICE || style === STYLE_TOWER) return ROOF_OFFICE;
  return ROOF_SLATE;
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
    const a = ring[i];
    const b = ring[(i + 1) % n];
    acc += a.x * b.z - b.x * a.z;
  }
  return Math.abs(acc) * 0.5 / (METERS_TO_WORLD * METERS_TO_WORLD);
}

function principalAxis(ring: { x: number; z: number }[], cx: number, cz: number): { ax: number; az: number; px: number; pz: number; maxPerp: number } {
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
): THREE.Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pushVertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    color: THREE.Color,
  ): number => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };

  const pushBox = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color) => {
    const hx = sx / 2;
    const hz = sz / 2;
    const faces = [
      { q: [x - hx, y, z + hz, x + hx, y, z + hz, x + hx, y + sy, z + hz, x - hx, y + sy, z + hz], n: [0, 0, 1] },
      { q: [x + hx, y, z - hz, x - hx, y, z - hz, x - hx, y + sy, z - hz, x + hx, y + sy, z - hz], n: [0, 0, -1] },
      { q: [x + hx, y, z + hz, x + hx, y, z - hz, x + hx, y + sy, z - hz, x + hx, y + sy, z + hz], n: [1, 0, 0] },
      { q: [x - hx, y, z - hz, x - hx, y, z + hz, x - hx, y + sy, z + hz, x - hx, y + sy, z - hz], n: [-1, 0, 0] },
      { q: [x - hx, y + sy, z + hz, x + hx, y + sy, z + hz, x + hx, y + sy, z - hz, x - hx, y + sy, z - hz], n: [0, 1, 0] },
    ];
    for (const f of faces) {
      const i0 = pushVertex(f.q[0], f.q[1], f.q[2], f.n[0], f.n[1], f.n[2], 0, 0, color);
      const i1 = pushVertex(f.q[3], f.q[4], f.q[5], f.n[0], f.n[1], f.n[2], 0, 0, color);
      const i2 = pushVertex(f.q[6], f.q[7], f.q[8], f.n[0], f.n[1], f.n[2], 0, 0, color);
      const i3 = pushVertex(f.q[9], f.q[10], f.q[11], f.n[0], f.n[1], f.n[2], 0, 0, color);
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
      const x = dequantizeX(b.verts[i * 2]);
      const z = dequantizeY(b.verts[i * 2 + 1]);
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
    const style = restyleForDistrict(resolveStyle(b.style, b.heightM, areaM2), b.heightM, areaM2, district);
    const storedRoof = b.style === 0 ? inferRoof(style) : b.roof;
    const forceFlat = district === 'canary' || (district === 'city' && b.heightM > 14);
    const terraceDistrict =
      district === 'islington' || district === 'kensington' || district === 'south' || district === 'westend';
    const roof =
      !forceFlat &&
      terraceDistrict &&
      (style === STYLE_TERRACE || style === STYLE_HOUSE) &&
      b.heightM <= 16 &&
      storedRoof === ROOF_FLAT
        ? ROOF_GABLED
        : storedRoof;
    const pal = paletteFor(style, district);
    const seed = hashBuildingIndex(b.heightM, b.chunkId, b.verts, 0x7fffffff, cx, cz);
    const palColor = pal[seed % pal.length];
    const osmWall = fromRgb565(b.wall565);
    const osmRoof = fromRgb565(b.roof565);
    const base =
      osmWall !== null && !isGenericWallPaint(osmWall)
        ? jitterColor(new THREE.Color(osmWall), seed, 0.04)
        : jitterColor(palColor, seed, 0.16);
    const wallBottomColor = base.clone().lerp(AO_DARK, 0.08);
    const roofColor = osmRoof ? new THREE.Color(osmRoof) : roofTint(style, roof);
    const slice = facadeSlice(style, district);
    const vScale = extrusionScale(style, b.heightM, district);
    const heightWorld = b.heightM * METERS_TO_WORLD * vScale;
    const shopM = style === STYLE_RETAIL ? Math.min(4.2, b.heightM * 0.38) : 0;
    const shopWorld = shopM * METERS_TO_WORLD * vScale;
    const plinthWorld =
      shopWorld > 0.02 ? 0 : Math.min(1.15 * METERS_TO_WORLD * vScale, heightWorld * 0.18);
    const corniceWorld = Math.min(0.75 * METERS_TO_WORLD * vScale, heightWorld * 0.12);
    const corniceMix =
      district === 'westminster' || district === 'westend'
        ? 0.52
        : district === 'kensington'
          ? 0.4
          : style === STYLE_HOUSE || style === STYLE_TERRACE
            ? 0.16
            : district === 'shoreditch' || district === 'eastend'
              ? 0.1
              : 0.4;
    const corniceColor = base.clone().lerp(CORNICE, corniceMix);
    const floorWorld = slice.floorM * METERS_TO_WORLD * vScale;
    const podium = wantPodium(style, b.heightM, areaM2, district);
    const podiumWorld = podium ? Math.min(15 * METERS_TO_WORLD * vScale, heightWorld * 0.14) : 0;
    const shaftRing = podium ? insetRing(ring, cx, cz, district === 'canary' ? 0.42 : 0.58) : ring;

    const emitRingWalls = (
      useRing: { x: number; z: number }[],
      y0: number,
      y1: number,
      opts: { plinth: boolean; shop: boolean; cornice: boolean; doors: boolean },
    ) => {
      const count = useRing.length;
      let longestI = 0;
      let longestM = 0;
      for (let i = 0; i < count; i++) {
        const a = useRing[i];
        const bp = useRing[(i + 1) % count];
        const edgeM = Math.hypot(bp.x - a.x, bp.z - a.z) / METERS_TO_WORLD;
        if (edgeM > longestM) {
          longestM = edgeM;
          longestI = i;
        }
      }

      let cumMeters = 0;
      for (let i = 0; i < count; i++) {
        const a = useRing[i];
        const bp = useRing[(i + 1) % count];
        const edgeLenMeters = Math.hypot(bp.x - a.x, bp.z - a.z) / METERS_TO_WORLD;
        const uStart = cumMeters / slice.uPeriodM;
        const uEnd = (cumMeters + edgeLenMeters) / slice.uPeriodM;
        cumMeters += edgeLenMeters;
        const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
        const dx = bp.x - a.x;
        const dz = bp.z - a.z;
        const candX = -dz * (y1 - y0);
        const candZ = dx * (y1 - y0);
        const flip = candX * nx + candZ * nz < 0;

        const emitQuad = (
          qy0: number,
          qy1: number,
          v0: number,
          v1: number,
          c0: THREE.Color,
          c1: THREE.Color,
          inset = 0,
        ) => {
          const ax = a.x + nx * inset;
          const az = a.z + nz * inset;
          const bx = bp.x + nx * inset;
          const bz = bp.z + nz * inset;
          const iBottomA = pushVertex(ax, qy0, az, nx, 0, nz, uStart, v0, c0);
          const iBottomB = pushVertex(bx, qy0, bz, nx, 0, nz, uEnd, v0, c0);
          const iTopA = pushVertex(ax, qy1, az, nx, 0, nz, uStart, v1, c1);
          const iTopB = pushVertex(bx, qy1, bz, nx, 0, nz, uEnd, v1, c1);
          if (!flip) indices.push(iBottomA, iBottomB, iTopB, iBottomA, iTopB, iTopA);
          else indices.push(iBottomA, iTopB, iBottomB, iBottomA, iTopA, iTopB);
        };

        const emitStoreys = (sy0: number, sy1: number, c0: THREE.Color, c1: THREE.Color) => {
          const span = sy1 - sy0;
          if (span <= 1e-5) return;
          let y = sy0;
          let remaining = span / floorWorld;
          while (remaining > 0.05 && y < sy1 - 1e-5) {
            const take = Math.min(slice.rows, remaining);
            const yNext = Math.min(sy1, y + take * floorWorld);
            const { v0, v1 } = facadeVForFloors(style, take, district);
            const t0 = (y - sy0) / span;
            const t1 = (yNext - sy0) / span;
            emitQuad(y, yNext, v0, v1, c0.clone().lerp(c1, t0), c0.clone().lerp(c1, t1));
            remaining -= take;
            y = yNext;
          }
        };

        const plinthTop = opts.plinth ? y0 + plinthWorld : y0;
        const wallTop = Math.max(plinthTop, y1 - (opts.cornice ? corniceWorld : 0));
        if (opts.shop && shopWorld > 0.02 && shopWorld < (y1 - y0) * 0.85) {
          const shopUv = facadeVForFloors(style, 1, district);
          emitQuad(
            y0,
            y0 + shopWorld,
            shopUv.v0,
            shopUv.v1,
            wallBottomColor.clone().lerp(SHOP_GLOW, 0.55),
            SHOP_GLOW,
          );
          emitStoreys(y0 + shopWorld, wallTop, base, base);
        } else if (opts.plinth && plinthWorld > 0.01) {
          emitQuad(y0, plinthTop, 0, 0, wallBottomColor, wallBottomColor);
          emitStoreys(plinthTop, wallTop, wallBottomColor, base);
        } else {
          emitStoreys(y0, wallTop, wallBottomColor, base);
        }
        if (opts.cornice && corniceWorld > 0.008 && wallTop < y1) {
          emitQuad(wallTop, y1, 0, 0, corniceColor, corniceColor, 0.28 * METERS_TO_WORLD);
        }

        const wantDoor =
          opts.doors &&
          i === longestI &&
          longestM >= 4.2 &&
          (style === STYLE_HOUSE || style === STYLE_TERRACE || style === STYLE_RETAIL);
        if (wantDoor) {
          const doorW = Math.min(1.35 * METERS_TO_WORLD, Math.hypot(dx, dz) * 0.24);
          const doorH = Math.min(2.4 * METERS_TO_WORLD * vScale, (y1 - y0) * 0.58);
          const mx = (a.x + bp.x) / 2;
          const mz = (a.z + bp.z) / 2;
          const ox = nx * 0.04 * METERS_TO_WORLD;
          const oz = nz * 0.04 * METERS_TO_WORLD;
          const tx = dx / (Math.hypot(dx, dz) || 1);
          const tz = dz / (Math.hypot(dx, dz) || 1);
          const hx = (tx * doorW) / 2;
          const hz = (tz * doorW) / 2;
          const door = DOOR_PAINTS[seed % DOOR_PAINTS.length];
          const d0 = pushVertex(mx - hx + ox, y0, mz - hz + oz, nx, 0, nz, 0, 0, door);
          const d1 = pushVertex(mx + hx + ox, y0, mz + hz + oz, nx, 0, nz, 0, 0, door);
          const d2 = pushVertex(mx + hx + ox, y0 + doorH, mz + hz + oz, nx, 0, nz, 0, 0, door);
          const d3 = pushVertex(mx - hx + ox, y0 + doorH, mz - hz + oz, nx, 0, nz, 0, 0, door);
          if (!flip) indices.push(d0, d1, d2, d0, d2, d3);
          else indices.push(d0, d2, d1, d0, d3, d2);
        }
      }
    };

    if (podium) {
      emitRingWalls(ring, 0, podiumWorld, { plinth: true, shop: false, cornice: true, doors: true });
      emitRingWalls(shaftRing, podiumWorld, heightWorld, { plinth: false, shop: false, cornice: true, doors: false });
    } else {
      emitRingWalls(ring, 0, heightWorld, {
        plinth: shopWorld <= 0.02,
        shop: shopWorld > 0.02,
        cornice: true,
        doors: true,
      });
    }

    const roofRing = shaftRing;
    const axis = principalAxis(roofRing, cx, cz);
    const widthM = (axis.maxPerp * 2) / METERS_TO_WORLD;
    const pitched = !forceFlat && roof !== ROOF_FLAT && b.heightM <= 22 && widthM < 28 && n <= 12;
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

    const emitRoof = (useRing: { x: number; z: number }[], yAt: (p: { x: number; z: number }) => number, color: THREE.Color) => {
      for (let t = 0; t < b.indices.length; t += 3) {
        const i0 = b.indices[t];
        let i1 = b.indices[t + 1];
        let i2 = b.indices[t + 2];
        const p0 = useRing[i0];
        const p1 = useRing[i1];
        const p2 = useRing[i2];
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
        const q0 = useRing[i0];
        const q1 = useRing[i1];
        const q2 = useRing[i2];
        const v0 = pushVertex(q0.x, yAt(q0), q0.z, nx, ny, nz, 0, 0, color);
        const v1 = pushVertex(q1.x, yAt(q1), q1.z, nx, ny, nz, 0, 0, color);
        const v2 = pushVertex(q2.x, yAt(q2), q2.z, nx, ny, nz, 0, 0, color);
        indices.push(v0, v1, v2);
      }
    };

    if (podium) emitRoof(ring, () => podiumWorld, roofColor.clone().lerp(AO_DARK, 0.12));
    emitRoof(roofRing, roofYAt, roofColor);

    const ridgeY = eavesY + riseWorld;
    if (pitched && (style === STYLE_HOUSE || style === STYLE_TERRACE) && areaM2 < 480) {
      const along = ((hashBuildingIndex(b.heightM, b.chunkId, b.verts, 97, cx, cz) - 48) / 97) * axis.maxPerp * 0.5;
      pushBox(
        cx + axis.ax * along,
        ridgeY - 0.5 * METERS_TO_WORLD,
        cz + axis.az * along,
        1.15 * METERS_TO_WORLD,
        2.6 * METERS_TO_WORLD * vScale,
        1.15 * METERS_TO_WORLD,
        CHIMNEY_COLOR,
      );
    }

    if ((style === STYLE_OFFICE || style === STYLE_TOWER || style === STYLE_APARTMENTS) && b.heightM >= 12 && areaM2 > 160) {
      const s = 3.2 * METERS_TO_WORLD;
      pushBox(cx, eavesY, cz, s, 2.2 * METERS_TO_WORLD * vScale, s * 0.7, HVAC_COLOR);
      if (areaM2 > 320) {
        pushBox(
          cx + axis.ax * s * 1.4,
          eavesY,
          cz + axis.az * s * 1.4,
          s * 0.7,
          1.6 * METERS_TO_WORLD * vScale,
          s * 0.5,
          HVAC_COLOR,
        );
      }
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry);
  mesh.userData.chunkId = chunkId;
  mesh.userData.major = major;
  return mesh;
}

function buildMergedPolyMesh(polys: CityPoly[], color: number, y: number): THREE.Mesh | null {
  let totalVerts = 0;
  let totalTris = 0;
  for (const p of polys) {
    totalVerts += p.verts.length / 2;
    totalTris += p.indices.length / 3;
  }
  if (totalTris === 0) return null;

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalTris * 3);
  let vOff = 0;
  let iOff = 0;
  let vertBase = 0;
  for (const p of polys) {
    const n = p.verts.length / 2;
    for (let i = 0; i < n; i++) {
      positions[vOff++] = dequantizeX(p.verts[i * 2]);
      positions[vOff++] = y;
      positions[vOff++] = dequantizeY(p.verts[i * 2 + 1]);
    }
    for (let i = 0; i < p.indices.length; i++) indices[iOff++] = p.indices[i] + vertBase;
    vertBase += n;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  // Flat unlit ground decal — DoubleSide sidesteps earcut/offline winding entirely.
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

export function buildWater(cityData: CityData): THREE.Mesh | null {
  return buildMergedPolyMesh(cityData.water, 0x5a92b8, 0.05);
}

export function buildParks(cityData: CityData): THREE.Mesh | null {
  return buildMergedPolyMesh(cityData.parks, 0x4a9a52, 0.1);
}

/** Low-poly canopy blobs on parks — the X-post street clip's toy-city trees. */
export function buildParkTrees(cityData: CityData): THREE.Group | null {
  const dummy = new THREE.Object3D();
  const spots: { x: number; z: number; scale: number }[] = [];
  for (const park of cityData.parks) {
    const n = park.verts.length / 2;
    if (n < 3) continue;
    const ring = new Array<{ x: number; z: number }>(n);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const x = dequantizeX(park.verts[i * 2]);
      const z = dequantizeY(park.verts[i * 2 + 1]);
      ring[i] = { x, z };
      cx += x;
      cz += z;
    }
    cx /= n;
    cz /= n;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      acc += a.x * b.z - b.x * a.z;
    }
    const areaM2 = Math.abs(acc) * 0.5 / (METERS_TO_WORLD * METERS_TO_WORLD);
    if (areaM2 < 90) continue;
    const count = Math.min(10, Math.max(1, Math.round(areaM2 / 900)));
    let h = Math.imul(n + 1, 2654435761) ^ park.verts[0];
    for (let t = 0; t < count; t++) {
      h = Math.imul(h, 1103515245) + 12345;
      const ang = ((h >>> 0) / 4294967296) * Math.PI * 2;
      const rad =
        Math.sqrt(((h >>> 8) & 255) / 255) * Math.sqrt(areaM2) * METERS_TO_WORLD * 0.22;
      spots.push({
        x: cx + Math.cos(ang) * rad,
        z: cz + Math.sin(ang) * rad,
        scale: 4.5 + ((h >>> 16) & 7) * 0.55,
      });
    }
  }
  if (spots.length === 0) return null;
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3f9148, flatShading: true });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a30 });
  const canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), canopyMat, spots.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 5), trunkMat, spots.length);
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const r = s.scale * METERS_TO_WORLD;
    dummy.position.set(s.x, r * 0.85, s.z);
    dummy.scale.set(r, r * 0.72, r);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, r * 0.28, s.z);
    dummy.scale.set(r * 0.22, r * 0.55, r * 0.22);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  }
  const group = new THREE.Group();
  group.add(trunks, canopies);
  return group;
}

function buildRibbonGeometry(
  ptsWorld: { x: number; z: number }[],
  halfWidthWorld: number,
  y: number,
): { positions: number[]; uvs: number[]; indices: number[] } {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const uScale = 1 / (ROAD_DASH_M * METERS_TO_WORLD);
  let travelled = 0;
  for (let i = 0; i < ptsWorld.length - 1; i++) {
    const a = ptsWorld[i];
    const bp = ptsWorld[i + 1];
    const dx = bp.x - a.x;
    const dz = bp.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * halfWidthWorld;
    const pz = (dx / len) * halfWidthWorld;
    const u0 = travelled * uScale;
    const u1 = (travelled + len) * uScale;
    travelled += len;
    const base = positions.length / 3;
    positions.push(
      a.x + px,
      y,
      a.z + pz,
      a.x - px,
      y,
      a.z - pz,
      bp.x - px,
      y,
      bp.z - pz,
      bp.x + px,
      y,
      bp.z + pz,
    );
    uvs.push(u0, 1, u0, 0, u1, 0, u1, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, uvs, indices };
}

function roadPts(road: CityRoad): { x: number; z: number }[] | null {
  const n = road.pts.length / 2;
  if (n < 2) return null;
  const pts = new Array<{ x: number; z: number }>(n);
  for (let i = 0; i < n; i++) pts[i] = { x: dequantizeX(road.pts[i * 2]), z: dequantizeY(road.pts[i * 2 + 1]) };
  return pts;
}

/** One group per tier so minor streets can hide independently at low zoom. */
export function buildRoads(cityData: CityData, roadTexture: THREE.Texture): THREE.Group | null {
  const group = new THREE.Group();
  const sidewalkMat = new THREE.MeshBasicMaterial({
    color: SIDEWALK_COLOR,
    side: THREE.DoubleSide,
  });
  for (let tier = 0; tier <= 2; tier++) {
    const walkPos: number[] = [];
    const walkIdx: number[] = [];
    const asphPos: number[] = [];
    const asphUv: number[] = [];
    const asphIdx: number[] = [];
    const halfCarriage = (ROAD_WIDTHS_M[tier] * METERS_TO_WORLD) / 2;
    const halfWalk = halfCarriage + SIDEWALK_M[tier] * METERS_TO_WORLD;
    for (const road of cityData.roads as CityRoad[]) {
      if (road.tier !== tier) continue;
      const pts = roadPts(road);
      if (!pts) continue;
      const walk = buildRibbonGeometry(pts, halfWalk, SIDEWALK_Y);
      const walkBase = walkPos.length / 3;
      for (const v of walk.positions) walkPos.push(v);
      for (const i of walk.indices) walkIdx.push(i + walkBase);
      const asph = buildRibbonGeometry(pts, halfCarriage, ROAD_Y);
      const asphBase = asphPos.length / 3;
      for (const v of asph.positions) asphPos.push(v);
      for (const v of asph.uvs) asphUv.push(v);
      for (const i of asph.indices) asphIdx.push(i + asphBase);
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
      tierGroup.add(new THREE.Mesh(g, sidewalkMat));
    }
    if (asphPos.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(asphPos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(asphUv, 2));
      g.setIndex(asphIdx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mat = new THREE.MeshLambertMaterial({
        map: roadTexture,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      tierGroup.add(new THREE.Mesh(g, mat));
    }
    group.add(tierGroup);
  }
  return group.children.length > 0 ? group : null;
}

const LAMP_MAX = 18000;
const LAMP_SPACING_M = [30, 38];

/** Instanced lamp posts along primary/secondary kerbs — visible at neighbourhood zoom and closer. */
export function buildStreetLamps(cityData: CityData): THREE.Group | null {
  const spots: { x: number; z: number }[] = [];
  for (const road of cityData.roads as CityRoad[]) {
    if (road.tier > 1) continue;
    const pts = roadPts(road);
    if (!pts) continue;
    const spacing = LAMP_SPACING_M[road.tier] * METERS_TO_WORLD;
    const offset = (ROAD_WIDTHS_M[road.tier] / 2 + SIDEWALK_M[road.tier] * 0.55) * METERS_TO_WORLD;
    let travelled = 0;
    let nextAt = spacing * (0.35 + (road.pts[0] % 97) / 200);
    let sign = road.pts[0] % 2 === 0 ? 1 : -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len;
      const pz = dx / len;
      while (nextAt <= travelled + len && spots.length < LAMP_MAX) {
        const t = (nextAt - travelled) / len;
        spots.push({ x: a.x + dx * t + px * offset * sign, z: a.z + dz * t + pz * offset * sign });
        nextAt += spacing;
        sign = -sign;
      }
      travelled += len;
      if (spots.length >= LAMP_MAX) break;
    }
    if (spots.length >= LAMP_MAX) break;
  }
  if (spots.length === 0) return null;

  const poleH = 6.8 * METERS_TO_WORLD;
  const poleW = 0.18 * METERS_TO_WORLD;
  const poleGeo = new THREE.BoxGeometry(poleW, poleH, poleW);
  poleGeo.translate(0, poleH / 2, 0);
  const headGeo = new THREE.BoxGeometry(poleW * 3.2, poleW * 1.6, poleW * 3.2);
  headGeo.translate(0, poleH + poleW * 0.4, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x1a1c24 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffd089 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < spots.length; i++) {
    dummy.position.set(spots[i].x, 0, spots[i].z);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
  }
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  poles.frustumCulled = false;
  heads.frustumCulled = false;
  const group = new THREE.Group();
  group.add(poles, heads);
  return group;
}

export function buildTubeLines(): THREE.Group {
  const group = new THREE.Group();
  const halfW = (TUBE_WIDTH_M * METERS_TO_WORLD) / 2;
  for (const line of TUBE_LINES) {
    const pts = line.points.map((p) => {
      const w = project(p);
      return { x: w.x, z: w.y };
    });
    const { positions, indices } = buildRibbonGeometry(pts, halfW, TUBE_Y);
    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({
      color: line.color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}

export function buildGround(): THREE.Mesh {
  const marginX = WORLD.width * 0.3;
  const marginY = WORLD.height * 0.3;
  const geometry = new THREE.PlaneGeometry(WORLD.width + marginX * 2, WORLD.height + marginY * 2);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xbdb6a8 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(WORLD.width / 2, 0, WORLD.height / 2);
  return mesh;
}

export function buildHubGlows(glowTexture: THREE.Texture): { group: THREE.Group; sprites: Map<HubId, THREE.Sprite> } {
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
      blending: THREE.AdditiveBlending,
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

