/**
 * Bake-time unique street meshes for noticed Cheapside buildings.
 *
 * Kansas pipeline, offline at play time:
 *   OSM address / Wikipedia at bake time → stand-out features → unique mesh.
 * Runtime only matches a committed pin to the footprint centroid.
 *
 * Pins from Overpass + enwiki (No 1 Poultry, The Ned, St Stephen Walbrook,
 * Magistrates' Court, 1 Old Jewry, Mansion House, 33 Gresham Street,
 * Bloomberg London, Bank of England). No live fetch in the client.
 */

import { METERS_TO_WORLD } from '../geo';
import { insetRingTowardCentroid, scaleToward } from './footprint';
import type { PlanMetrics, UniqueStockRecipe } from './uniqueStock';

export type StreetUniqueId =
  | 'no-1-poultry'
  | 'the-ned'
  | 'walbrook'
  | 'magistrates'
  | 'old-jewry'
  | 'mansion-house'
  | 'gresham-33'
  | 'bloomberg'
  | 'bank-england';

export type StreetUniquePin = {
  id: StreetUniqueId;
  lng: number;
  lat: number;
  matchM: number;
};

/** OSM way centres from the Cheapside bake query. Tight radii so one pin owns one plate. */
export const STREET_UNIQUE_PINS: readonly StreetUniquePin[] = [
  { id: 'no-1-poultry', lng: -0.09075, lat: 51.51332, matchM: 22 },
  { id: 'the-ned', lng: -0.09008, lat: 51.51372, matchM: 18 },
  { id: 'walbrook', lng: -0.08983, lat: 51.51262, matchM: 18 },
  { id: 'magistrates', lng: -0.09014, lat: 51.51305, matchM: 16 },
  { id: 'old-jewry', lng: -0.09077, lat: 51.51381, matchM: 16 },
  { id: 'mansion-house', lng: -0.08948, lat: 51.51297, matchM: 22 },
  { id: 'gresham-33', lng: -0.09065, lat: 51.51399, matchM: 12 },
  { id: 'bloomberg', lng: -0.09141, lat: 51.51242, matchM: 55 },
  { id: 'bank-england', lng: -0.08839, lat: 51.51408, matchM: 70 },
];

export const STREET_UNIQUE_LABEL: Record<StreetUniqueId, { name: string; use: string }> = {
  'no-1-poultry': { name: 'No 1 Poultry', use: 'Stirling' },
  'the-ned': { name: 'The Ned', use: 'Hotel' },
  walbrook: { name: 'St Stephen Walbrook', use: 'Church' },
  magistrates: { name: "Magistrates' Court", use: 'Civic' },
  'old-jewry': { name: '1 Old Jewry', use: 'Office' },
  'mansion-house': { name: 'Mansion House', use: 'Civic' },
  'gresham-33': { name: '33 Gresham Street', use: 'Office' },
  bloomberg: { name: 'Bloomberg London', use: 'Foster' },
  'bank-england': { name: 'Bank of England', use: 'Soane' },
};

/** Rose-pink and buff limestone as modelled masses (wiki Commons still of No 1 Poultry). */
export const POULTRY_BUFF = 0xe8d4a4;
export const POULTRY_PINK = 0xd8a0a8;
export const POULTRY_GLASS = 0x2a4050;
export const POULTRY_SHOP = 0x3a322c;
export const POULTRY_ROOF = 0x5a625c;
export const POULTRY_GRANITE = 0x6a6e6a;
export const POULTRY_WELL = 0x1a1a22;
export const POULTRY_MORTAR = 0x6a5a50;
/** Stirling watch face. Off-white vanished into the pink/buff stripes under Lambert. */
export const POULTRY_CLOCK = 0xffffff;
export const POULTRY_CLOCK_RIM = 0x141210;

/** Lutyens Midland Bank / The Ned. Portland, rusticated base, dark mansard. */
export const NED_STONE = 0xe6dfd0;
export const NED_RUST = 0x7a7064;
export const NED_GLASS = 0x3a5470;
export const NED_MANSARD = 0x4a4038;

/** Wren St Stephen Walbrook — pale stone nave + lead dome. */
export const WALBROOK_STONE = 0xeae4d6;
export const WALBROOK_DOME = 0x8a9088;
export const WALBROOK_DRUM = 0xd8d2c4;
export const WALBROOK_LEAD = 0x6a7068;
export const WALBROOK_GLASS = 0x2c3844;

/** Magistrates' Court — civic cream + brown mansard. */
export const MAG_STONE = 0xddd4c4;
export const MAG_MANSARD = 0x6a4538;
export const MAG_PLINTH = 0x8a8074;
export const MAG_GLASS = 0x3a5068;

/** Sheppard Robson 1 Old Jewry: three interlocking Portland blocks, bronze portal. */
export const JEWRY_STONE = 0xe4ddd0;
export const JEWRY_MID = 0xc8b49a;
export const JEWRY_HIGH = 0xdcd4c6;
export const JEWRY_GLASS = 0x243440;
export const JEWRY_BRONZE = 0x8a6240;
export const JEWRY_SHOP = 0x3a3834;

/** Dance Mansion House: rusticated pedestal, hexastyle Corinthian portico. */
export const MANSION_STONE = 0xe8e0d0;
export const MANSION_RUST = 0xcfc4b0;
export const MANSION_COLUMN = 0xf2eadc;
export const MANSION_ROOF = 0x5a5048;
export const MANSION_GLASS = 0x3a4860;

/** 33 Gresham Street — Portland setback, bronze portal, tall office slots. */
export const GRESHAM_STONE = 0xd8d0c4;
export const GRESHAM_GLASS = 0x2a3848;
export const GRESHAM_BRONZE = 0x6a5840;
export const GRESHAM_ROOF = 0x4a4440;

/** Foster Bloomberg HQ — sandstone, bronze fins, arcade, stepped triangle. */
export const BLOOM_STONE = 0xc4b49a;
export const BLOOM_BRONZE = 0x6a4a28;
export const BLOOM_GLASS = 0x1e2a32;
export const BLOOM_ROOF = 0x4a4844;

/** Soane Bank of England — curtain wall, attic lights, inner garden court. */
export const BANK_STONE = 0xd2c8b8;
export const BANK_GLASS = 0x3a4450;
export const BANK_ROOF = 0x5a5850;
export const BANK_WELL = 0x2a4a38;

export function streetUniqueAt(lng: number, lat: number): StreetUniqueId | null {
  const cos = Math.cos((lat * Math.PI) / 180);
  let best: StreetUniqueId | null = null;
  let bestD = Infinity;
  for (const pin of STREET_UNIQUE_PINS) {
    const dlat = (lat - pin.lat) * 111_320;
    const dlng = (lng - pin.lng) * 111_320 * cos;
    const d = Math.hypot(dlat, dlng);
    if (d <= pin.matchM && d < bestD) {
      bestD = d;
      best = pin.id;
    }
  }
  return best;
}

export type StreetPt = { x: number; z: number };

export type StreetWallOpts = {
  plinth: boolean;
  shop: boolean;
  cornice: boolean;
  doors: boolean;
  windows: boolean;
  stringCourses?: boolean;
  hex?: number;
  bottomHex?: number;
  outset?: number;
};

export type StreetEmit = {
  ring: StreetPt[];
  plan: PlanMetrics;
  heightWorld: number;
  emitRingWalls: (ring: StreetPt[], y0: number, y1: number, opts: StreetWallOpts) => void;
  pushBox: (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    hex: number,
  ) => void;
  pushOrientedBox: (
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
  pushVertex: (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    hex: number,
  ) => number;
  pushTri: (i0: number, i1: number, i2: number) => void;
  outwardNormal: (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
  ) => [number, number];
};

export type StreetRoofEmit = {
  ring: StreetPt[];
  plan: PlanMetrics;
  heightWorld: number;
  emitRoof: (ring: StreetPt[], yAt: (p: StreetPt) => number, hex: number) => void;
  insetRing: (ring: StreetPt[], cx: number, cz: number, scale: number) => StreetPt[];
  pushBox: StreetEmit['pushBox'];
  pushVertex: StreetEmit['pushVertex'];
  pushTri: StreetEmit['pushTri'];
  pushOrientedBox: StreetEmit['pushOrientedBox'];
  outwardNormal: StreetEmit['outwardNormal'];
};

type Edge = {
  i: number;
  a: StreetPt;
  b: StreetPt;
  len: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
};

function m(meters: number): number {
  return meters * METERS_TO_WORLD;
}

function edgesOf(ctx: StreetEmit, ring: StreetPt[]): Edge[] {
  const n = ring.length;
  const out: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const [nx, nz] = ctx.outwardNormal(a.x, a.z, b.x, b.z, ctx.plan.cx, ctx.plan.cz);
    out.push({
      i,
      a,
      b,
      len,
      tx: (b.x - a.x) / len,
      tz: (b.z - a.z) / len,
      nx,
      nz,
    });
  }
  return out;
}

function emitWallQuad(
  ctx: StreetEmit,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  nx: number,
  nz: number,
  hex: number,
): void {
  const i0 = ctx.pushVertex(ax, y0, az, nx, 0, nz, hex);
  const i1 = ctx.pushVertex(bx, y0, bz, nx, 0, nz, hex);
  const i2 = ctx.pushVertex(bx, y1, bz, nx, 0, nz, hex);
  const i3 = ctx.pushVertex(ax, y1, az, nx, 0, nz, hex);
  const dx = bx - ax;
  const dz = bz - az;
  const candX = -dz * (y1 - y0);
  const candZ = dx * (y1 - y0);
  if (candX * nx + candZ * nz < 0) {
    ctx.pushTri(i0, i2, i1);
    ctx.pushTri(i0, i3, i2);
  } else {
    ctx.pushTri(i0, i1, i2);
    ctx.pushTri(i0, i2, i3);
  }
}

function emitWallBand(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  hex: number,
  outset = 0,
): void {
  for (const e of edgesOf(ctx, ring)) {
    emitWallQuad(
      ctx,
      e.a.x + e.nx * outset,
      e.a.z + e.nz * outset,
      e.b.x + e.nx * outset,
      e.b.z + e.nz * outset,
      y0,
      y1,
      e.nx,
      e.nz,
      hex,
    );
  }
}

/** Closed faceted cylinder. Axis-aligned boxes read as stair towers; this does not. */
function pushCylinder(
  ctx: StreetEmit,
  cx: number,
  y0: number,
  cz: number,
  radius: number,
  height: number,
  hex: number,
  segs = 16,
  cap = true,
): void {
  const y1 = y0 + height;
  const capTop: number[] = [];
  const capBot: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * radius;
    const z0 = cz + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius;
    const z1 = cz + Math.sin(a1) * radius;
    const nx = Math.cos((a0 + a1) / 2);
    const nz = Math.sin((a0 + a1) / 2);
    emitWallQuad(ctx, x0, z0, x1, z1, y0, y1, nx, nz, hex);
    if (cap) {
      capTop.push(ctx.pushVertex(x0, y1, z0, 0, 1, 0, hex));
      capBot.push(ctx.pushVertex(x0, y0, z0, 0, -1, 0, hex));
    }
  }
  if (cap) {
    const topC = ctx.pushVertex(cx, y1, cz, 0, 1, 0, hex);
    const botC = ctx.pushVertex(cx, y0, cz, 0, -1, 0, hex);
    for (let i = 0; i < segs; i++) {
      ctx.pushTri(topC, capTop[i]!, capTop[(i + 1) % segs]!);
      ctx.pushTri(botC, capBot[(i + 1) % segs]!, capBot[i]!);
    }
  }
}

function pushDome(
  ctx: StreetEmit,
  cx: number,
  y0: number,
  cz: number,
  radius: number,
  height: number,
  hex: number,
  rings = 7,
  segs = 16,
): void {
  for (let r = 0; r < rings; r++) {
    const t0 = r / rings;
    const t1 = (r + 1) / rings;
    const a0 = t0 * (Math.PI / 2);
    const a1 = t1 * (Math.PI / 2);
    const yA = y0 + Math.sin(a0) * height;
    const yB = y0 + Math.sin(a1) * height;
    const rA = Math.cos(a0) * radius;
    const rB = Math.cos(a1) * radius;
    for (let i = 0; i < segs; i++) {
      const u0 = (i / segs) * Math.PI * 2;
      const u1 = ((i + 1) / segs) * Math.PI * 2;
      const x0 = cx + Math.cos(u0) * rA;
      const z0 = cz + Math.sin(u0) * rA;
      const x1 = cx + Math.cos(u1) * rA;
      const z1 = cz + Math.sin(u1) * rA;
      const x2 = cx + Math.cos(u1) * rB;
      const z2 = cz + Math.sin(u1) * rB;
      const x3 = cx + Math.cos(u0) * rB;
      const z3 = cz + Math.sin(u0) * rB;
      const nx = Math.cos((u0 + u1) / 2) * Math.cos((a0 + a1) / 2);
      const ny = Math.sin((a0 + a1) / 2);
      const nz = Math.sin((u0 + u1) / 2) * Math.cos((a0 + a1) / 2);
      const i0 = ctx.pushVertex(x0, yA, z0, nx, ny, nz, hex);
      const i1 = ctx.pushVertex(x1, yA, z1, nx, ny, nz, hex);
      const i2 = ctx.pushVertex(x2, yB, z2, nx, ny, nz, hex);
      const i3 = ctx.pushVertex(x3, yB, z3, nx, ny, nz, hex);
      ctx.pushTri(i0, i1, i2);
      ctx.pushTri(i0, i2, i3);
    }
  }
}

function pushDisk(
  ctx: StreetEmit,
  cx: number,
  y: number,
  cz: number,
  radius: number,
  hex: number,
  segs = 20,
): void {
  const c = ctx.pushVertex(cx, y, cz, 0, 1, 0, hex);
  const rim: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    rim.push(ctx.pushVertex(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius, 0, 1, 0, hex));
  }
  for (let i = 0; i < segs; i++) {
    ctx.pushTri(c, rim[i]!, rim[(i + 1) % segs]!);
  }
}

function edgePoint(e: Edge, t: number): StreetPt {
  return { x: e.a.x + (e.b.x - e.a.x) * t, z: e.a.z + (e.b.z - e.a.z) * t };
}

type Disk = { x: number; z: number; r: number };

function distPointToSeg(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Wall runs that miss a disk. A cylinder through a roof plane reads as needles. */
function emitEdgeOutsideDisk(
  ctx: StreetEmit,
  e: Edge,
  y0: number,
  y1: number,
  hex: number,
  disk: Disk | null,
): void {
  if (!disk || distPointToSeg(disk.x, disk.z, e.a.x, e.a.z, e.b.x, e.b.z) >= disk.r) {
    emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, hex);
    return;
  }
  const steps = 12;
  let run0 = -1;
  const flush = (t0: number, t1: number) => {
    if (t1 - t0 < 0.03) return;
    const a = edgePoint(e, t0);
    const b = edgePoint(e, t1);
    emitWallQuad(ctx, a.x, a.z, b.x, b.z, y0, y1, e.nx, e.nz, hex);
  };
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const p = edgePoint(e, t);
    const out = Math.hypot(p.x - disk.x, p.z - disk.z) >= disk.r;
    if (out) {
      if (run0 < 0) run0 = t;
    } else if (run0 >= 0) {
      flush(run0, t);
      run0 = -1;
    }
  }
  if (run0 >= 0) flush(run0, 1);
}

function emitBandOutsideDisk(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  hex: number,
  disk: Disk | null,
): void {
  for (const e of edgesOf(ctx, ring)) emitEdgeOutsideDisk(ctx, e, y0, y1, hex, disk);
}

/** Arcade openings sit in the wall plane. Oriented boxes along OSM edges stick through corners. */
function emitArcade(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  disk: Disk | null = null,
): void {
  const lintelH = Math.min(m(1.1), (y1 - y0) * 0.2);
  for (const e of edgesOf(ctx, ring)) {
    if (disk && distPointToSeg(disk.x, disk.z, e.a.x, e.a.z, e.b.x, e.b.z) < disk.r) {
      emitEdgeOutsideDisk(ctx, e, y0, y1, stone, disk);
      continue;
    }
    const edgeM = e.len / METERS_TO_WORLD;
    if (edgeM < 9) {
      emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, stone);
      continue;
    }
    const bays = Math.max(3, Math.min(6, Math.round(edgeM / 7)));
    const pierT = Math.min(0.14, 1.6 / edgeM);
    for (let b = 0; b < bays; b++) {
      const t0 = b / bays;
      const t1 = (b + 1) / bays;
      const left = edgePoint(e, t0);
      const leftIn = edgePoint(e, t0 + pierT);
      const rightIn = edgePoint(e, t1 - pierT);
      const right = edgePoint(e, t1);
      emitWallQuad(ctx, left.x, left.z, leftIn.x, leftIn.z, y0, y1 - lintelH, e.nx, e.nz, stone);
      emitWallQuad(
        ctx,
        rightIn.x,
        rightIn.z,
        right.x,
        right.z,
        y0,
        y1 - lintelH,
        e.nx,
        e.nz,
        stone,
      );
    }
    emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y1 - lintelH, y1, e.nx, e.nz, POULTRY_GRANITE);
  }
}

/** Courtyard well stays inside the plate. A forced 10 m radius punches the facade. */
export function poultryWellR(plan: PlanMetrics): number {
  const fitM = Math.min(plan.minRM, plan.maxPerpM, plan.maxAlongM) * 0.72;
  return Math.min(fitM, 12) * METERS_TO_WORLD;
}

function emitAnnularRoof(
  ctx: StreetRoofEmit,
  outer: StreetPt[],
  inner: StreetPt[],
  y: number,
  hex: number,
): void {
  const n = Math.min(outer.length, inner.length);
  if (n < 3) return;
  for (let i = 0; i < n; i++) {
    const a = outer[i]!;
    const b = outer[(i + 1) % n]!;
    const c = inner[(i + 1) % n]!;
    const d = inner[i]!;
    const i0 = ctx.pushVertex(a.x, y, a.z, 0, 1, 0, hex);
    const i1 = ctx.pushVertex(b.x, y, b.z, 0, 1, 0, hex);
    const i2 = ctx.pushVertex(c.x, y, c.z, 0, 1, 0, hex);
    const i3 = ctx.pushVertex(d.x, y, d.z, 0, 1, 0, hex);
    ctx.pushTri(i0, i1, i2);
    ctx.pushTri(i0, i2, i3);
  }
}

/** Map each outer edge onto the well circle. Skip verts already inside so concave spikes cannot form. */
function emitAnnularRoofRadial(
  ctx: StreetRoofEmit,
  outer: StreetPt[],
  wellR: number,
  y: number,
  hex: number,
  holes: readonly { x: number; z: number; r: number }[] = [],
): void {
  const { cx, cz } = ctx.plan;
  const pad = m(0.4);
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const a = outer[i]!;
    const b = outer[(i + 1) % n]!;
    const ra = Math.hypot(a.x - cx, a.z - cz);
    const rb = Math.hypot(b.x - cx, b.z - cz);
    if (ra <= wellR + pad || rb <= wellR + pad) continue;
    const iax = cx + ((a.x - cx) / ra) * wellR;
    const iaz = cz + ((a.z - cz) / ra) * wellR;
    const ibx = cx + ((b.x - cx) / rb) * wellR;
    const ibz = cz + ((b.z - cz) / rb) * wellR;
    let skip = false;
    for (const h of holes) {
      if (quadHitsDisk(a, b, { x: ibx, z: ibz }, { x: iax, z: iaz }, h)) skip = true;
    }
    if (skip) continue;
    const i0 = ctx.pushVertex(a.x, y, a.z, 0, 1, 0, hex);
    const i1 = ctx.pushVertex(b.x, y, b.z, 0, 1, 0, hex);
    const i2 = ctx.pushVertex(ibx, y, ibz, 0, 1, 0, hex);
    const i3 = ctx.pushVertex(iax, y, iaz, 0, 1, 0, hex);
    ctx.pushTri(i0, i1, i2);
    ctx.pushTri(i0, i2, i3);
  }
}

function emitInPlanePortal(
  ctx: StreetEmit,
  e: Edge,
  y0: number,
  y1: number,
  frame: number,
  glass: number,
): void {
  const jamb = 0.04;
  const t0 = 0.36;
  const t1 = 0.64;
  const head = Math.min(m(0.75), (y1 - y0) * 0.2);
  const left = edgePoint(e, t0);
  const leftIn = edgePoint(e, t0 + jamb);
  const rightIn = edgePoint(e, t1 - jamb);
  const right = edgePoint(e, t1);
  emitWallQuad(ctx, left.x, left.z, leftIn.x, leftIn.z, y0, y1, e.nx, e.nz, frame);
  emitWallQuad(ctx, rightIn.x, rightIn.z, right.x, right.z, y0, y1, e.nx, e.nz, frame);
  emitWallQuad(ctx, left.x, left.z, right.x, right.z, y1 - head, y1, e.nx, e.nz, frame);
  emitWallQuad(ctx, leftIn.x, leftIn.z, rightIn.x, rightIn.z, y0, y1 - head, e.nx, e.nz, glass);
}

function emitRustication(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  courses: number,
  disk: Disk | null = null,
): void {
  const n = Math.max(2, courses);
  const h = (y1 - y0) / n;
  const mortar = 0x3a3330;
  for (let i = 0; i < n; i++) {
    const a = y0 + i * h;
    emitBandOutsideDisk(ctx, ring, a, a + h * 0.86, stone, disk);
    emitBandOutsideDisk(ctx, ring, a + h * 0.86, a + h, mortar, disk);
  }
}

function emitNaveSlots(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  glass: number,
  nWindows: number,
): void {
  const edges = edgesOf(ctx, ring);
  const ranked = [...edges].sort((a, b) => b.len - a.len);
  const windowed = new Set(ranked.slice(0, 2));
  for (const e of edges) {
    if (!windowed.has(e) || e.len < m(8)) {
      emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, stone);
      continue;
    }
    const n = Math.max(2, Math.min(nWindows, Math.round(e.len / m(7))));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const left = edgePoint(e, t0);
      const right = edgePoint(e, t1);
      const w0 = edgePoint(e, t0 + (t1 - t0) * 0.28);
      const w1 = edgePoint(e, t1 - (t1 - t0) * 0.28);
      emitWallQuad(ctx, left.x, left.z, w0.x, w0.z, y0, y1, e.nx, e.nz, stone);
      emitWallQuad(ctx, w1.x, w1.z, right.x, right.z, y0, y1, e.nx, e.nz, stone);
      const sill = y0 + (y1 - y0) * 0.12;
      const head = y0 + (y1 - y0) * 0.88;
      emitWallQuad(ctx, w0.x, w0.z, w1.x, w1.z, y0, sill, e.nx, e.nz, stone);
      emitWallQuad(ctx, w0.x, w0.z, w1.x, w1.z, sill, head, e.nx, e.nz, glass);
      emitWallQuad(ctx, w0.x, w0.z, w1.x, w1.z, head, y1, e.nx, e.nz, stone);
    }
  }
}

/** Tall bronze/stone blades in the wall plane. Oriented boxes along OSM edges clip. */
function emitVerticalFins(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  accent: number,
  pitchM: number,
): void {
  const span = y1 - y0;
  const sill = y0 + span * 0.06;
  const head = y0 + span * 0.94;
  for (const e of edgesOf(ctx, ring)) {
    const edgeM = e.len / METERS_TO_WORLD;
    if (edgeM < 7) {
      emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, stone);
      continue;
    }
    const bays = Math.max(4, Math.min(22, Math.round(edgeM / pitchM)));
    for (let b = 0; b < bays; b++) {
      const t0 = b / bays;
      const t1 = (b + 1) / bays;
      const left = edgePoint(e, t0);
      const right = edgePoint(e, t1);
      const fin0 = edgePoint(e, t0 + (t1 - t0) * 0.36);
      const fin1 = edgePoint(e, t1 - (t1 - t0) * 0.36);
      emitWallQuad(ctx, left.x, left.z, fin0.x, fin0.z, y0, y1, e.nx, e.nz, stone);
      emitWallQuad(ctx, fin1.x, fin1.z, right.x, right.z, y0, y1, e.nx, e.nz, stone);
      emitWallQuad(ctx, fin0.x, fin0.z, fin1.x, fin1.z, y0, sill, e.nx, e.nz, stone);
      emitWallQuad(ctx, fin0.x, fin0.z, fin1.x, fin1.z, sill, head, e.nx, e.nz, accent);
      emitWallQuad(ctx, fin0.x, fin0.z, fin1.x, fin1.z, head, y1, e.nx, e.nz, stone);
    }
  }
}

function emitEdgeSlots(
  ctx: StreetEmit,
  e: Edge,
  y0: number,
  y1: number,
  stone: number,
  glass: number,
  pitchM: number,
  nRows: number,
  winU: number,
  winV: number,
): void {
  const nRowsN = Math.max(1, nRows);
  const span = y1 - y0;
  const rowH = span / nRowsN;
  const uPad = (1 - Math.min(0.82, Math.max(0.28, winU))) / 2;
  const vPad = (1 - Math.min(0.82, Math.max(0.28, winV))) / 2;
  const edgeM = e.len / METERS_TO_WORLD;
  if (edgeM < 4.2) {
    emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, stone);
    return;
  }
  const bays = edgeM < 6.2 ? 1 : Math.max(2, Math.min(16, Math.round(edgeM / pitchM)));
  for (let b = 0; b < bays; b++) {
    const t0 = b / bays;
    const t1 = (b + 1) / bays;
    const left = edgePoint(e, t0);
    const right = edgePoint(e, t1);
    const w0 = edgePoint(e, t0 + (t1 - t0) * uPad);
    const w1 = edgePoint(e, t1 - (t1 - t0) * uPad);
    emitWallQuad(ctx, left.x, left.z, w0.x, w0.z, y0, y1, e.nx, e.nz, stone);
    emitWallQuad(ctx, w1.x, w1.z, right.x, right.z, y0, y1, e.nx, e.nz, stone);
    for (let r = 0; r < nRowsN; r++) {
      const ry0 = y0 + r * rowH;
      const ry1 = ry0 + rowH;
      const sill = ry0 + rowH * vPad;
      const head = ry1 - rowH * vPad;
      emitWallQuad(ctx, w0.x, w0.z, w1.x, w1.z, ry0, sill, e.nx, e.nz, stone);
      emitWallQuad(ctx, w0.x, w0.z, w1.x, w1.z, sill, head, e.nx, e.nz, glass);
      emitWallQuad(ctx, w0.x, w0.z, w1.x, w1.z, head, ry1, e.nx, e.nz, stone);
    }
  }
}

function emitLongestSlots(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  glass: number,
  nEdges: number,
  pitchM: number,
  nRows: number,
  winU: number,
  winV: number,
): void {
  const edges = edgesOf(ctx, ring);
  const ranked = [...edges].sort((a, b) => b.len - a.len);
  const windowed = new Set(ranked.slice(0, Math.max(1, nEdges)));
  for (const e of edges) {
    if (!windowed.has(e)) {
      emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, stone);
      continue;
    }
    emitEdgeSlots(ctx, e, y0, y1, stone, glass, pitchM, nRows, winU, winV);
  }
}

/** Every adequate edge gets THIS plate's bay rhythm. Longest-only left blank flanks. */
function emitPlateSlots(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  glass: number,
  pitchM: number,
  nRows: number,
  winU: number,
  winV: number,
  disk: Disk | null = null,
): void {
  for (const e of edgesOf(ctx, ring)) {
    if (disk && distPointToSeg(disk.x, disk.z, e.a.x, e.a.z, e.b.x, e.b.z) < disk.r) {
      emitEdgeOutsideDisk(ctx, e, y0, y1, stone, disk);
      continue;
    }
    emitEdgeSlots(ctx, e, y0, y1, stone, glass, pitchM, nRows, winU, winV);
  }
}

function plateRhythm(
  plan: PlanMetrics,
  heightWorld: number,
  storey = 0,
): { pitchM: number; rows: number; winU: number; winV: number } {
  const hM = heightWorld / METERS_TO_WORLD;
  const pitchM = Math.max(
    3.15,
    Math.min(10.4, 3.05 + ((plan.longestEdgeM * 0.173 + plan.n * 0.31 + storey * 0.9) % 5.8)),
  );
  const rows = Math.max(1, Math.min(6, Math.round(hM / (3.2 + plan.compactness * 1.35)) - storey));
  const winU = Math.max(
    0.32,
    Math.min(0.48, 0.34 + plan.compactness * 0.12 + (plan.longestEdgeIndex % 3) * 0.03),
  );
  const winV = Math.max(
    0.4,
    Math.min(0.52, 0.42 + Math.min(0.08, plan.minRM / 200) + (plan.apexIndex % 4) * 0.02),
  );
  return { pitchM, rows, winU, winV };
}

function porticoPoint(e: Edge, t: number, out: number): StreetPt {
  return {
    x: e.a.x + (e.b.x - e.a.x) * t + e.nx * out,
    z: e.a.z + (e.b.z - e.a.z) * t + e.nz * out,
  };
}

function pointInTri(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const sign = (x1: number, z1: number, x2: number, z2: number, x3: number, z3: number) =>
    (x1 - x3) * (z2 - z3) - (x2 - x3) * (z1 - z3);
  const b1 = sign(px, pz, ax, az, bx, bz) < 0;
  const b2 = sign(px, pz, bx, bz, cx, cz) < 0;
  const b3 = sign(px, pz, cx, cz, ax, az) < 0;
  return b1 === b2 && b2 === b3;
}

function quadHitsDisk(a: StreetPt, b: StreetPt, c: StreetPt, d: StreetPt, disk: Disk): boolean {
  const r = disk.r;
  if (Math.hypot(a.x - disk.x, a.z - disk.z) < r) return true;
  if (Math.hypot(b.x - disk.x, b.z - disk.z) < r) return true;
  if (Math.hypot(c.x - disk.x, c.z - disk.z) < r) return true;
  if (Math.hypot(d.x - disk.x, d.z - disk.z) < r) return true;
  if (distPointToSeg(disk.x, disk.z, a.x, a.z, b.x, b.z) < r) return true;
  if (distPointToSeg(disk.x, disk.z, b.x, b.z, c.x, c.z) < r) return true;
  if (distPointToSeg(disk.x, disk.z, c.x, c.z, d.x, d.z) < r) return true;
  if (distPointToSeg(disk.x, disk.z, d.x, d.z, a.x, a.z) < r) return true;
  const mx = (a.x + b.x + c.x + d.x) / 4;
  const mz = (a.z + b.z + c.z + d.z) / 4;
  if (Math.hypot(mx - disk.x, mz - disk.z) < r) return true;
  if (pointInTri(disk.x, disk.z, a.x, a.z, b.x, b.z, c.x, c.z)) return true;
  if (pointInTri(disk.x, disk.z, a.x, a.z, c.x, c.z, d.x, d.z)) return true;
  return false;
}

/** One limestone course with a real ledge, not a coplanar stripe. */
function emitLimestoneLedge(
  ctx: StreetEmit,
  e: Edge,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  hex: number,
  out: number,
): void {
  const a = edgePoint(e, t0);
  const b = edgePoint(e, t1);
  const ax = a.x + e.nx * out;
  const az = a.z + e.nz * out;
  const bx = b.x + e.nx * out;
  const bz = b.z + e.nz * out;
  emitWallQuad(ctx, ax, az, bx, bz, y0, y1, e.nx, e.nz, hex);
  if (out < m(0.5)) return;
  const s0 = ctx.pushVertex(ax, y0, az, 0, -1, 0, hex);
  const s1 = ctx.pushVertex(bx, y0, bz, 0, -1, 0, hex);
  const s2 = ctx.pushVertex(b.x, y0, b.z, 0, -1, 0, hex);
  const s3 = ctx.pushVertex(a.x, y0, a.z, 0, -1, 0, hex);
  ctx.pushTri(s0, s1, s2);
  ctx.pushTri(s0, s2, s3);
}

function emitJambReturn(
  ctx: StreetEmit,
  px: number,
  pz: number,
  nx: number,
  nz: number,
  outA: number,
  outB: number,
  y0: number,
  y1: number,
  jx: number,
  jz: number,
  hex: number,
): void {
  emitWallQuad(
    ctx,
    px + nx * outA,
    pz + nz * outA,
    px + nx * outB,
    pz + nz * outB,
    y0,
    y1,
    jx,
    jz,
    hex,
  );
}

function edgeOut(e: Edge, t: number, out: number): { x: number; z: number } {
  const p = edgePoint(e, t);
  return { x: p.x + e.nx * out, z: p.z + e.nz * out };
}

function emitYCap(
  ctx: StreetEmit,
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
  d: { x: number; z: number },
  y: number,
  ny: number,
  stone: number,
): void {
  const i0 = ctx.pushVertex(a.x, y, a.z, 0, ny, 0, stone);
  const i1 = ctx.pushVertex(b.x, y, b.z, 0, ny, 0, stone);
  const i2 = ctx.pushVertex(c.x, y, c.z, 0, ny, 0, stone);
  const i3 = ctx.pushVertex(d.x, y, d.z, 0, ny, 0, stone);
  if (ny > 0) {
    ctx.pushTri(i0, i1, i2);
    ctx.pushTri(i0, i2, i3);
  } else {
    ctx.pushTri(i0, i2, i1);
    ctx.pushTri(i0, i3, i2);
  }
}

function emitYTri(
  ctx: StreetEmit,
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
  y: number,
  ny: number,
  stone: number,
): void {
  const i0 = ctx.pushVertex(a.x, y, a.z, 0, ny, 0, stone);
  const i1 = ctx.pushVertex(b.x, y, b.z, 0, ny, 0, stone);
  const i2 = ctx.pushVertex(c.x, y, c.z, 0, ny, 0, stone);
  if (ny > 0) ctx.pushTri(i0, i1, i2);
  else ctx.pushTri(i0, i2, i1);
}

type FoldedFace = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
};

/** Vertical limestone plane whose outset changes along the edge. Not street-parallel. */
function foldedFace(e: Edge, t0: number, t1: number, out0: number, out1: number): FoldedFace {
  const a = edgeOut(e, t0, out0);
  const b = edgeOut(e, t1, out1);
  let nx = -(b.z - a.z);
  let nz = b.x - a.x;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl;
  nz /= nl;
  if (nx * e.nx + nz * e.nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z, nx, nz };
}

function emitFoldQuad(
  ctx: StreetEmit,
  e: Edge,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  out0: number,
  out1: number,
  hex: number,
): FoldedFace {
  const f = foldedFace(e, t0, t1, out0, out1);
  emitWallQuad(ctx, f.ax, f.az, f.bx, f.bz, y0, y1, f.nx, f.nz, hex);
  return f;
}

/**
 * Storey punch in a raked limestone plane. Glass sits back along the rake
 * normal, not along the street normal (that N-S jamb is a hair stick).
 */
function emitRakePunch(
  ctx: StreetEmit,
  e: Edge,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  out0: number,
  out1: number,
  stone: number,
): void {
  const spanT = t1 - t0;
  const outAt = (t: number) => out0 + (out1 - out0) * ((t - t0) / (spanT || 1));
  const paint = (ta: number, tb: number, ya: number, yb: number, hex: number) =>
    emitFoldQuad(ctx, e, ta, tb, ya, yb, outAt(ta), outAt(tb), hex);
  const yMid = (y0 + y1) / 2;
  const winH = m(3.9);
  const sill = y0 + m(6.4);
  const head = sill + winH;
  if (head + m(1.6) >= y1 || spanT < 0.03) {
    paint(t0, t1, y0, yMid, stone);
    paint(t0, t1, yMid, y1, stone);
    return;
  }
  const pierU = 0.18;
  const tL = t0 + spanT * pierU;
  const tR = t1 - spanT * pierU;
  paint(t0, tL, y0, yMid, stone);
  paint(t0, tL, yMid, y1, stone);
  paint(tR, t1, y0, yMid, stone);
  paint(tR, t1, yMid, y1, stone);
  paint(tL, tR, y0, sill, stone);
  if (yMid > head + m(0.4) && yMid < y1 - m(0.4)) {
    paint(tL, tR, head, yMid, stone);
    paint(tL, tR, yMid, y1, stone);
  } else {
    paint(tL, tR, head, y1, stone);
  }
  const glassIn = m(1.15);
  const tM = (tL + tR) / 2;
  const yM = (sill + head) / 2;
  const whole = foldedFace(e, t0, t1, out0, out1);
  const panes: Array<[number, number, number, number]> = [
    [tL, tM, sill, yM],
    [tM, tR, sill, yM],
    [tL, tM, yM, head],
    [tM, tR, yM, head],
  ];
  for (const [ta, tb, ya, yb] of panes) {
    const g = foldedFace(e, ta, tb, outAt(ta), outAt(tb));
    emitWallQuad(
      ctx,
      g.ax - g.nx * glassIn,
      g.az - g.nz * glassIn,
      g.bx - g.nx * glassIn,
      g.bz - g.nz * glassIn,
      ya,
      yb,
      g.nx,
      g.nz,
      POULTRY_GLASS,
    );
  }
  const pL = edgeOut(e, tL, outAt(tL));
  const pR = edgeOut(e, tR, outAt(tR));
  const rakeDx = whole.bx - whole.ax;
  const rakeDz = whole.bz - whole.az;
  const rakeLen = Math.hypot(rakeDx, rakeDz) || 1;
  const rtx = rakeDx / rakeLen;
  const rtz = rakeDz / rakeLen;
  emitWallQuad(
    ctx,
    pL.x,
    pL.z,
    pL.x - whole.nx * glassIn,
    pL.z - whole.nz * glassIn,
    sill,
    head,
    rtx,
    rtz,
    POULTRY_MORTAR,
  );
  emitWallQuad(
    ctx,
    pR.x,
    pR.z,
    pR.x - whole.nx * glassIn,
    pR.z - whole.nz * glassIn,
    sill,
    head,
    -rtx,
    -rtz,
    POULTRY_MORTAR,
  );
  const sillOut = m(0.35);
  const s0 = {
    x: pL.x + whole.nx * sillOut,
    z: pL.z + whole.nz * sillOut,
  };
  const s1 = {
    x: pR.x + whole.nx * sillOut,
    z: pR.z + whole.nz * sillOut,
  };
  emitWallQuad(ctx, s0.x, s0.z, s1.x, s1.z, sill - m(0.32), sill, whole.nx, whole.nz, stone);
  emitYCap(ctx, s0, s1, pR, pL, sill, -1, stone);
}

/**
 * One limestone fold of the street concertina. Two raked faces meet at an
 * outward ridge. No street-parallel trapezoid front, no N-S side slab (those
 * read as roof fins from the south isometric), no cap above wall height.
 */
function emitProjectingBay(
  ctx: StreetEmit,
  e: Edge,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  stone: number,
): void {
  const out0 = m(0.4);
  const outRidge = m(5.2);
  const tMid = (t0 + t1) / 2;
  emitRakePunch(ctx, e, t0, tMid, y0, y1, out0, outRidge, stone);
  emitRakePunch(ctx, e, tMid, t1, y0, y1, outRidge, out0, stone);
  const a = edgeOut(e, t0, out0);
  const ridge = edgeOut(e, tMid, outRidge);
  const b = edgeOut(e, t1, out0);
  emitYTri(ctx, a, ridge, b, y1, 1, stone);
  emitYTri(ctx, a, b, ridge, y0, -1, stone);
}

function emitStirlingElevation(
  ctx: StreetEmit,
  e: Edge,
  tLo: number,
  tHi: number,
  y0: number,
  y1: number,
  stone: number,
  fold: boolean,
): void {
  const spanT = tHi - tLo;
  if (spanT < 0.04) return;
  const edgeM = (e.len * spanT) / METERS_TO_WORLD;
  const outW = m(0.4);
  if (!fold || edgeM < 12) {
    emitLimestoneLedge(ctx, e, tLo, tHi, y0, y1, stone, outW);
    return;
  }
  const nFolds = Math.max(1, Math.min(3, Math.round(edgeM / 16)));
  for (let f = 0; f < nFolds; f++) {
    const t0 = tLo + (spanT * f) / nFolds;
    const t1 = tLo + (spanT * (f + 1)) / nFolds;
    emitProjectingBay(ctx, e, t0, t1, y0, y1, stone);
  }
}

/**
 * Stirling's two-sided watch: a thick disk in a plane, not a vertical shaft.
 * Four clocks on a cylinder is the costume drum.
 */
function emitClockOnFace(
  ctx: StreetEmit,
  px: number,
  py: number,
  pz: number,
  nx: number,
  nz: number,
  faceR: number,
): void {
  const nlen = Math.hypot(nx, nz) || 1;
  nx /= nlen;
  nz /= nlen;
  const tx = -nz;
  const tz = nx;
  const segs = 24;
  const rimW = m(0.7);
  const halfD = m(0.62);
  const faceOut = halfD + m(0.1);

  const ringAt = (out: number, radius: number, hex: number): number[] => {
    const ids: number[] = [];
    const ox = nx * out;
    const oz = nz * out;
    for (let s = 0; s < segs; s++) {
      const t = (s / segs) * Math.PI * 2;
      const cpx = Math.cos(t);
      const spy = Math.sin(t);
      ids.push(
        ctx.pushVertex(
          px + tx * cpx * radius + ox,
          py + spy * radius,
          pz + tz * cpx * radius + oz,
          0,
          1,
          0,
          hex,
        ),
      );
    }
    return ids;
  };

  const emitFace = (out: number, sign: number) => {
    const ox = nx * out;
    const oz = nz * out;
    const c = ctx.pushVertex(px + ox, py, pz + oz, 0, 1, 0, POULTRY_CLOCK);
    const inner = ringAt(out, faceR, POULTRY_CLOCK);
    const outer = ringAt(out, faceR + rimW, POULTRY_CLOCK_RIM);
    for (let s = 0; s < segs; s++) {
      const a = inner[s]!;
      const b = inner[(s + 1) % segs]!;
      if (sign > 0) ctx.pushTri(c, a, b);
      else ctx.pushTri(c, b, a);
      const o0 = outer[s]!;
      const o1 = outer[(s + 1) % segs]!;
      if (sign > 0) {
        ctx.pushTri(a, o0, o1);
        ctx.pushTri(a, o1, b);
      } else {
        ctx.pushTri(a, o1, o0);
        ctx.pushTri(a, b, o1);
      }
    }
    const handOut = out + m(0.14) * sign;
    const hox = nx * handOut;
    const hoz = nz * handOut;
    const hand = (len: number, ang: number, halfW: number) => {
      const tipT = Math.sin(ang) * len;
      const tipY = Math.cos(ang) * len;
      const baseT = Math.cos(ang) * halfW;
      const baseY = -Math.sin(ang) * halfW;
      const i0 = ctx.pushVertex(
        px + tx * -baseT + hox,
        py + -baseY,
        pz + tz * -baseT + hoz,
        0,
        1,
        0,
        POULTRY_CLOCK_RIM,
      );
      const i1 = ctx.pushVertex(
        px + tx * baseT + hox,
        py + baseY,
        pz + tz * baseT + hoz,
        0,
        1,
        0,
        POULTRY_CLOCK_RIM,
      );
      const i2 = ctx.pushVertex(
        px + tx * tipT + hox,
        py + tipY,
        pz + tz * tipT + hoz,
        0,
        1,
        0,
        POULTRY_CLOCK_RIM,
      );
      if (sign > 0) ctx.pushTri(i0, i1, i2);
      else ctx.pushTri(i0, i2, i1);
    };
    hand(faceR * 0.52, Math.PI * 0.33, m(0.28));
    hand(faceR * 0.8, -Math.PI * 0.18, m(0.16));
    for (let h = 0; h < 12; h++) {
      const ang = (h / 12) * Math.PI * 2;
      const cpx = Math.cos(ang);
      const spy = Math.sin(ang);
      const pxT = -spy;
      const pyT = cpx;
      const halfW = h % 3 === 0 ? m(0.22) : m(0.1);
      const r0 = faceR * 0.78;
      const r1 = faceR * 0.96;
      const tick = (r: number, side: number) =>
        ctx.pushVertex(
          px + tx * (cpx * r + pxT * side) + hox,
          py + spy * r + pyT * side,
          pz + tz * (cpx * r + pxT * side) + hoz,
          0,
          1,
          0,
          POULTRY_CLOCK_RIM,
        );
      const t0 = tick(r0, -halfW);
      const t1 = tick(r0, halfW);
      const t2 = tick(r1, halfW);
      const t3 = tick(r1, -halfW);
      if (sign > 0) {
        ctx.pushTri(t0, t1, t2);
        ctx.pushTri(t0, t2, t3);
      } else {
        ctx.pushTri(t0, t2, t1);
        ctx.pushTri(t0, t3, t2);
      }
    }
  };

  emitFace(faceOut, 1);
  emitFace(-faceOut, -1);
  const frontOuter = ringAt(faceOut, faceR + rimW, POULTRY_CLOCK_RIM);
  const backOuter = ringAt(-faceOut, faceR + rimW, POULTRY_CLOCK_RIM);
  for (let s = 0; s < segs; s++) {
    const a = frontOuter[s]!;
    const b = frontOuter[(s + 1) % segs]!;
    const c = backOuter[(s + 1) % segs]!;
    const d = backOuter[s]!;
    ctx.pushTri(a, b, c);
    ctx.pushTri(a, c, d);
  }
}

/** Stirling conning-tower watch: a buff cylinder with horn deck, not a disk on a slab. */
function emitStirlingClockTurret(
  ctx: StreetEmit,
  cx: number,
  y0: number,
  cz: number,
  bx: number,
  bz: number,
): void {
  const turretR = m(4.6);
  const turretH = m(14);
  pushCylinder(ctx, cx, y0, cz, turretR, turretH, POULTRY_BUFF, 20, true);
  const tx = -bz;
  const tz = bx;
  ctx.pushOrientedBox(
    cx,
    y0 + turretH * 0.42,
    cz,
    m(12),
    m(2.2),
    m(4.4),
    tx,
    tz,
    bx,
    bz,
    POULTRY_BUFF,
  );
  const clockY = y0 + turretH * 0.55;
  const faceR = m(3.6);
  emitClockOnFace(
    ctx,
    cx + bx * (turretR + m(0.2)),
    clockY,
    cz + bz * (turretR + m(0.2)),
    bx,
    bz,
    faceR,
  );
}

/** Folded V-curtain: recessed panes + stone mullions, not painted slots. */
function emitProwVGlass(
  ctx: StreetEmit,
  e: Edge,
  apexAtStart: boolean,
  y0: number,
  y1: number,
): void {
  const tLo = apexAtStart ? 0 : 0.62;
  const tHi = apexAtStart ? 0.38 : 1;
  const glassOut = m(-0.5);
  const jambOut = m(0.7);
  const jambU = 0.1;
  emitLimestoneLedge(ctx, e, tLo, tLo + (tHi - tLo) * jambU, y0, y1, POULTRY_BUFF, jambOut);
  emitLimestoneLedge(ctx, e, tHi - (tHi - tLo) * jambU, tHi, y0, y1, POULTRY_BUFF, jambOut);
  const left = edgePoint(e, tLo + (tHi - tLo) * 0.12);
  const right = edgePoint(e, tHi - (tHi - tLo) * 0.12);
  const sill = y0 + (y1 - y0) * 0.06;
  const head = y1 - (y1 - y0) * 0.06;
  const tA = tLo + (tHi - tLo) * 0.12;
  const tB = tHi - (tHi - tLo) * 0.12;
  const tM = (tA + tB) / 2;
  const yM = (sill + head) / 2;
  const panes: [number, number, number, number][] = [
    [tA, tM, sill, yM],
    [tM, tB, sill, yM],
    [tA, tM, yM, head],
    [tM, tB, yM, head],
  ];
  for (const [ta, tb, ya, yb] of panes) {
    const p0 = edgePoint(e, ta);
    const p1 = edgePoint(e, tb);
    emitWallQuad(
      ctx,
      p0.x + e.nx * glassOut,
      p0.z + e.nz * glassOut,
      p1.x + e.nx * glassOut,
      p1.z + e.nz * glassOut,
      ya,
      yb,
      e.nx,
      e.nz,
      POULTRY_GLASS,
    );
  }
  emitJambReturn(
    ctx,
    left.x,
    left.z,
    e.nx,
    e.nz,
    jambOut,
    glassOut,
    sill,
    head,
    e.tx,
    e.tz,
    POULTRY_BUFF,
  );
  emitJambReturn(
    ctx,
    right.x,
    right.z,
    e.nx,
    e.nz,
    jambOut,
    glassOut,
    sill,
    head,
    -e.tx,
    -e.tz,
    POULTRY_BUFF,
  );
}

function emitApexArch(
  ctx: StreetEmit,
  e: Edge,
  apexAtStart: boolean,
  y0: number,
  y1: number,
): void {
  const t0 = apexAtStart ? 0 : 0.82;
  const t1 = apexAtStart ? 0.18 : 1;
  const a = edgePoint(e, t0);
  const b = edgePoint(e, t1);
  const out0 = m(0.22);
  const out1 = m(-1.35);
  emitWallQuad(
    ctx,
    a.x + e.nx * out1,
    a.z + e.nz * out1,
    b.x + e.nx * out1,
    b.z + e.nz * out1,
    y0,
    y1,
    e.nx,
    e.nz,
    POULTRY_SHOP,
  );
  emitJambReturn(ctx, a.x, a.z, e.nx, e.nz, out0, out1, y0, y1, e.tx, e.tz, POULTRY_GRANITE);
  emitJambReturn(ctx, b.x, b.z, e.nx, e.nz, out0, out1, y0, y1, -e.tx, -e.tz, POULTRY_GRANITE);
  const hx0 = a.x + e.nx * out0;
  const hz0 = a.z + e.nz * out0;
  const hx1 = b.x + e.nx * out0;
  const hz1 = b.z + e.nz * out0;
  const hx2 = b.x + e.nx * out1;
  const hz2 = b.z + e.nz * out1;
  const hx3 = a.x + e.nx * out1;
  const hz3 = a.z + e.nz * out1;
  const i0 = ctx.pushVertex(hx0, y1, hz0, 0, -1, 0, POULTRY_GRANITE);
  const i1 = ctx.pushVertex(hx1, y1, hz1, 0, -1, 0, POULTRY_GRANITE);
  const i2 = ctx.pushVertex(hx2, y1, hz2, 0, -1, 0, POULTRY_GRANITE);
  const i3 = ctx.pushVertex(hx3, y1, hz3, 0, -1, 0, POULTRY_GRANITE);
  ctx.pushTri(i0, i1, i2);
  ctx.pushTri(i0, i2, i3);
}

function emitPoultryWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
  const edges = edgesOf(ctx, ctx.ring);
  const n = edges.length;
  const apexI = ctx.plan.apexIndex;
  const ePrev = edges[(apexI + n - 1) % n]!;
  const eNext = edges[apexI]!;
  const arcadeH = H * 0.15;
  const vTop = Math.max(arcadeH + m(14), H * 0.5);

  emitArcade(ctx, ctx.ring, 0, arcadeH, POULTRY_GRANITE);
  const shop = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.6));
  emitWallBand(ctx, shop, 0, arcadeH * 0.82, POULTRY_SHOP, 0);

  for (const e of edges) {
    // Cheapside-north folds only show as a roof hat from the south camera.
    // Street volume is the south/west edges the isometric actually sees.
    const fold = e.nz > -0.45;
    if (e.i === ePrev.i) {
      emitStirlingElevation(ctx, e, 0, 0.62, arcadeH, H, POULTRY_PINK, fold);
    } else if (e.i === eNext.i) {
      emitStirlingElevation(ctx, e, 0.38, 1, arcadeH, H, POULTRY_PINK, fold);
    } else {
      emitStirlingElevation(ctx, e, 0, 1, arcadeH, H, POULTRY_PINK, fold);
    }
  }
  emitLimestoneLedge(ctx, ePrev, 0.62, 1, vTop, H, POULTRY_PINK, m(0.25));
  emitLimestoneLedge(ctx, eNext, 0, 0.38, vTop, H, POULTRY_PINK, m(0.25));

  const wellR = poultryWellR(ctx.plan);
  pushCylinder(ctx, cx, 0, cz, wellR, H * 0.9, POULTRY_WELL, 16, false);
  pushDisk(ctx, cx, m(0.35), cz, wellR * 0.98, POULTRY_WELL, 16);

  emitApexArch(ctx, ePrev, false, 0, arcadeH * 1.35);
  emitApexArch(ctx, eNext, true, 0, arcadeH * 1.35);
  emitProwVGlass(ctx, ePrev, false, arcadeH, vTop);
  emitProwVGlass(ctx, eNext, true, arcadeH, vTop);
  let bx = ePrev.nx + eNext.nx;
  let bz = ePrev.nz + eNext.nz;
  const bl = Math.hypot(bx, bz) || 1;
  bx /= bl;
  bz /= bl;
  emitStirlingClockTurret(ctx, apex.x + bx * m(0.8), H, apex.z + bz * m(0.8), bx, bz);
}

function emitNedWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const rustH = H * 0.22;
  const pianoH = H * 0.5;
  const bodyH = H * 0.74;
  const { cx, cz } = ctx.plan;
  emitRustication(ctx, ctx.ring, 0, rustH, NED_RUST, 4);
  // Lutyens palazzo: tall piano nobile, then smaller attic, then mansard.
  emitPlateSlots(ctx, ctx.ring, rustH, pianoH, NED_STONE, NED_GLASS, 8.6, 1, 0.34, 0.8);
  emitPlateSlots(ctx, ctx.ring, pianoH, bodyH, NED_STONE, NED_GLASS, 5.4, 2, 0.36, 0.48);
  const eaves = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.8));
  emitWallBand(ctx, eaves, bodyH, H, NED_MANSARD, 0);
  const well = insetRingTowardCentroid(ctx.ring, cx, cz, m(8.5));
  emitRustication(ctx, well, rustH, H, NED_RUST, 4);
}

function emitWalbrookWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  emitNaveSlots(ctx, ctx.ring, 0, H, WALBROOK_STONE, WALBROOK_GLASS, 3);
  const e = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len)[0];
  if (!e || e.len / METERS_TO_WORLD < 10) return;
  const colH = H * 0.62;
  for (const t of [0.22, 0.5, 0.78]) {
    const p = porticoPoint(e, t, m(1.1));
    pushCylinder(ctx, p.x, 0, p.z, m(0.55), colH, WALBROOK_DRUM, 10, true);
  }
}

function emitMagistratesWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  emitWallBand(ctx, ctx.ring, 0, H * 0.16, MAG_PLINTH, 0);
  emitPlateSlots(ctx, ctx.ring, H * 0.16, H * 0.68, MAG_STONE, MAG_GLASS, 6.8, 2, 0.4, 0.62);
  const eaves = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.6));
  emitWallBand(ctx, eaves, H * 0.68, H, MAG_MANSARD, 0);
  const e = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len)[0];
  if (!e || e.len / METERS_TO_WORLD < 12) return;
  const colH = H * 0.42;
  for (let i = 0; i < 4; i++) {
    const p = porticoPoint(e, (i + 0.5) / 4, m(1.2));
    pushCylinder(ctx, p.x, H * 0.16, p.z, m(0.48), colH, MAG_STONE, 10, true);
  }
}

function emitOldJewryWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const hA = H * 0.38;
  const hB = H * 0.72;
  const ranked = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len);
  const e0 = ranked[0];
  const e1 = ranked[1] ?? e0;
  emitRustication(ctx, ctx.ring, 0, hA * 0.22, JEWRY_STONE, 2);
  emitPlateSlots(ctx, ctx.ring, hA * 0.22, hA, JEWRY_STONE, JEWRY_GLASS, 3.2, 2, 0.5, 0.58);
  if (e0) {
    const left = edgePoint(e0, 0);
    const p0 = edgePoint(e0, 0.36);
    const p1 = edgePoint(e0, 0.64);
    const right = edgePoint(e0, 1);
    emitWallQuad(ctx, left.x, left.z, p0.x, p0.z, 0, hA, e0.nx, e0.nz, JEWRY_STONE);
    emitInPlanePortal(ctx, e0, 0, hA * 0.72, JEWRY_BRONZE, JEWRY_GLASS);
    emitWallQuad(ctx, p1.x, p1.z, right.x, right.z, 0, hA, e0.nx, e0.nz, JEWRY_STONE);
    emitWallQuad(ctx, e0.a.x, e0.a.z, e0.b.x, e0.b.z, hA * 0.72, hA, e0.nx, e0.nz, JEWRY_STONE);
  }
  if (e0) {
    const mid = { x: (e0.a.x + e0.b.x) / 2, z: (e0.a.z + e0.b.z) / 2 };
    emitVerticalFins(
      ctx,
      scaleToward(ctx.ring, mid.x, mid.z, 0.55),
      0,
      hB,
      JEWRY_MID,
      JEWRY_GLASS,
      3.6,
    );
  }
  if (e1) {
    const mid = { x: (e1.a.x + e1.b.x) / 2, z: (e1.a.z + e1.b.z) / 2 };
    emitLongestSlots(
      ctx,
      scaleToward(ctx.ring, mid.x, mid.z, 0.38),
      0,
      H,
      JEWRY_HIGH,
      JEWRY_GLASS,
      2,
      5.8,
      1,
      0.3,
      0.78,
    );
  }
}

function emitMansionWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const rustH = H * 0.28;
  const bodyH = H * 0.78;
  emitRustication(ctx, ctx.ring, 0, rustH, MANSION_RUST, 4);
  emitPlateSlots(ctx, ctx.ring, rustH, bodyH, MANSION_STONE, MANSION_GLASS, 8.4, 2, 0.28, 0.52);
  emitWallBand(ctx, ctx.ring, bodyH, H, MANSION_STONE, 0);
  const e = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len)[0];
  if (!e || e.len / METERS_TO_WORLD < 16) return;
  const colH = bodyH - rustH;
  const colR = m(0.62);
  const out = m(2.1);
  for (let i = 0; i < 6; i++) {
    const p = porticoPoint(e, (i + 0.7) / 7, out);
    pushCylinder(ctx, p.x, rustH, p.z, colR, colH, MANSION_COLUMN, 12, true);
    pushCylinder(ctx, p.x, rustH + colH, p.z, colR * 1.35, m(0.4), MANSION_COLUMN, 10, true);
  }
  const p0 = porticoPoint(e, 0.7 / 7, out);
  const p5 = porticoPoint(e, 5.7 / 7, out);
  const yEnt = rustH + colH;
  emitWallQuad(ctx, p0.x, p0.z, p5.x, p5.z, yEnt, yEnt + m(0.9), e.nx, e.nz, MANSION_STONE);
  const mid = porticoPoint(e, 0.5, out);
  const yPeak = yEnt + m(0.9) + H * 0.2;
  const i0 = ctx.pushVertex(p0.x, yEnt + m(0.9), p0.z, e.nx, 0.15, e.nz, MANSION_STONE);
  const i1 = ctx.pushVertex(p5.x, yEnt + m(0.9), p5.z, e.nx, 0.15, e.nz, MANSION_STONE);
  const i2 = ctx.pushVertex(mid.x, yPeak, mid.z, e.nx, 0.35, e.nz, MANSION_STONE);
  ctx.pushTri(i0, i1, i2);
}

function emitGreshamWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  emitRustication(ctx, ctx.ring, 0, H * 0.18, GRESHAM_STONE, 3);
  emitPlateSlots(
    ctx,
    ctx.ring,
    H * 0.18,
    H * 0.42,
    GRESHAM_STONE,
    GRESHAM_GLASS,
    5.2,
    2,
    0.46,
    0.7,
  );
  const mid = insetRingTowardCentroid(ctx.ring, cx, cz, m(2.8));
  emitVerticalFins(ctx, mid, H * 0.42, H * 0.72, GRESHAM_STONE, GRESHAM_GLASS, 4.8);
  const high = insetRingTowardCentroid(ctx.ring, cx, cz, m(5.6));
  emitPlateSlots(ctx, high, H * 0.72, H, GRESHAM_STONE, GRESHAM_GLASS, 6.6, 2, 0.28, 0.55);
  const e = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len)[0];
  if (e) emitInPlanePortal(ctx, e, 0, H * 0.18, GRESHAM_BRONZE, GRESHAM_GLASS);
}

function emitBloombergWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: ctx.plan.cx, z: ctx.plan.cz };
  emitArcade(ctx, ctx.ring, 0, H * 0.14, BLOOM_STONE);
  const t1 = [0.42, 0.7, 1];
  const scales = [1, 0.72, 0.48];
  let yPrev = H * 0.14;
  for (let s = 0; s < 3; s++) {
    const y1 = H * t1[s]!;
    const ring = s === 0 ? ctx.ring : scaleToward(ctx.ring, apex.x, apex.z, scales[s]!);
    emitVerticalFins(ctx, ring, yPrev, y1, BLOOM_STONE, BLOOM_BRONZE, s === 0 ? 5.4 : 4.4);
    yPrev = y1;
  }
}

function emitBankWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  emitRustication(ctx, ctx.ring, 0, H * 0.58, BANK_STONE, 5);
  emitPlateSlots(ctx, ctx.ring, H * 0.16, H * 0.58, BANK_STONE, BANK_GLASS, 14.2, 2, 0.22, 0.38);
  emitPlateSlots(ctx, ctx.ring, H * 0.58, H * 0.88, BANK_STONE, BANK_GLASS, 11.2, 1, 0.26, 0.5);
  emitWallBand(ctx, ctx.ring, H * 0.88, H, BANK_STONE, 0);
  const wellInset = Math.min(planWellInsetM(ctx.plan), 28) * METERS_TO_WORLD;
  const well = insetRingTowardCentroid(ctx.ring, cx, cz, wellInset);
  emitRustication(ctx, well, 0, H * 0.35, BANK_STONE, 3);
  emitWallBand(ctx, well, H * 0.35, H * 0.55, BANK_WELL, 0);
}

function planWellInsetM(plan: PlanMetrics): number {
  return Math.min(plan.minRM * 0.42, Math.min(plan.maxAlongM, plan.maxPerpM) * 0.38);
}

/**
 * Physical bays on THIS front. Flush punched slots on every OSM extrusion
 * is the shared costume the street still failed on.
 */
function emitProjectingBays(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  glass: number,
  pitchM: number,
  nRows: number,
  outM: number,
): void {
  const out = m(Math.min(0.55, Math.max(0.32, outM)));
  const rows = Math.max(2, nRows);
  const top = Math.max(y0 + m(1.6), y1 - m(0.7));
  const span = top - y0;
  const rowH = span / rows;
  const vPad = 0.16;
  const uInset = 0.18;
  for (const e of edgesOf(ctx, ring)) {
    const edgeM = e.len / METERS_TO_WORLD;
    if (edgeM < 6.2) {
      emitEdgeSlots(ctx, e, y0, y1, stone, glass, pitchM, rows, 0.4, 0.5);
      continue;
    }
    const bays = Math.max(2, Math.min(7, Math.round(edgeM / Math.max(4.2, pitchM))));
    for (let b = 0; b < bays; b++) {
      const t0 = b / bays;
      const t1 = (b + 1) / bays;
      const left = edgePoint(e, t0);
      const right = edgePoint(e, t1);
      const u0 = t0 + (t1 - t0) * uInset;
      const u1 = t1 - (t1 - t0) * uInset;
      const p0 = edgePoint(e, u0);
      const p1 = edgePoint(e, u1);
      emitWallQuad(ctx, left.x, left.z, p0.x, p0.z, y0, y1, e.nx, e.nz, stone);
      emitWallQuad(ctx, p1.x, p1.z, right.x, right.z, y0, y1, e.nx, e.nz, stone);
      const midT = (u0 + u1) / 2;
      const flush = midT < 0.08 || midT > 0.92 || (u1 - u0) * edgeM < 2.6;
      const a = flush ? p0 : { x: p0.x + e.nx * out, z: p0.z + e.nz * out };
      const c = flush ? p1 : { x: p1.x + e.nx * out, z: p1.z + e.nz * out };
      if (!flush) {
        emitWallQuad(ctx, p0.x, p0.z, a.x, a.z, y0, top, -e.tx, -e.tz, stone);
        emitWallQuad(ctx, c.x, c.z, p1.x, p1.z, y0, top, e.tx, e.tz, stone);
        emitWallQuad(ctx, p0.x, p0.z, p1.x, p1.z, top, y1, e.nx, e.nz, stone);
      }
      for (let r = 0; r < rows; r++) {
        const ry0 = y0 + r * rowH;
        const ry1 = ry0 + rowH;
        const sill = ry0 + rowH * vPad;
        const head = ry1 - rowH * vPad;
        emitWallQuad(ctx, a.x, a.z, c.x, c.z, ry0, sill, e.nx, e.nz, stone);
        emitWallQuad(ctx, a.x, a.z, c.x, c.z, sill, head, e.nx, e.nz, glass);
        emitWallQuad(ctx, a.x, a.z, c.x, c.z, head, ry1, e.nx, e.nz, stone);
      }
    }
  }
}

function emitRoofKit(ctx: StreetEmit, recipe: UniqueStockRecipe, stone: number): void {
  const { cx, cz, minRM, ax, az, px, pz } = ctx.plan;
  const H = ctx.heightWorld;
  if (recipe.silhouette.kind === 'courtyard') return;
  if (!recipe.plant || minRM <= 6) return;
  const w = m(Math.min(recipe.plant.wM, minRM * 0.45));
  const d = m(Math.min(recipe.plant.dM, minRM * 0.35));
  const h = m(Math.min(recipe.plant.hM, 6.5));
  if (w < m(2.6) || d < m(2.6) || h < m(2.6)) return;
  const x =
    cx + ax * m(recipe.plant.along * minRM * 0.25) + px * m(recipe.plant.perp * minRM * 0.2);
  const z =
    cz + az * m(recipe.plant.along * minRM * 0.25) + pz * m(recipe.plant.perp * minRM * 0.2);
  ctx.pushBox(x, H, z, w, h, d, stone);
}

/**
 * Ordinary Cheapside plates: 3D from THIS footprint's silhouette, bay
 * rhythm and roof plant. Not a ribbon/grid costume on every OSM extrusion.
 * Generic roofs already emit the terrace ledges. Wall caps on those roofs
 * read as hair-thin sticks.
 */
export function emitCheapsideStockWalls(
  ctx: StreetEmit,
  recipe: UniqueStockRecipe,
  stone: number,
  glass: number,
  heightM: number,
): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  const sil = recipe.silhouette;
  const physicalBays = recipe.facade.kind === 'bays' || sil.kind === 'gable-row' || heightM <= 36;
  const paintBand = (
    ring: StreetPt[],
    y0: number,
    y1: number,
    storey: number,
    forceArcade: boolean,
  ) => {
    const ry = plateRhythm(ctx.plan, H, storey);
    const rows = Math.max(2, ry.rows);
    if (forceArcade) {
      emitArcade(ctx, ring, y0, y1, stone);
      return;
    }
    if (recipe.facade.kind === 'piers') {
      emitVerticalFins(ctx, ring, y0, y1, stone, glass, ry.pitchM);
    } else if (physicalBays) {
      emitProjectingBays(ctx, ring, y0, y1, stone, glass, ry.pitchM, rows, 0.42 + storey * 0.08);
    } else {
      emitPlateSlots(ctx, ring, y0, y1, stone, glass, ry.pitchM, rows, ry.winU, ry.winV);
    }
  };
  const colonnadeBase = recipe.facade.kind === 'colonnade';

  if (sil.kind === 'wedge-step') {
    const apex = ctx.ring[sil.apexIndex] ?? { x: cx, z: cz };
    emitPlateSlots(ctx, ctx.ring, 0, H * 0.12, stone, glass, 5.2, 1, 0.46, 0.42);
    let yPrev = H * 0.12;
    for (let s = 0; s < sil.steps; s++) {
      const y1 = H * sil.t1[s]!;
      const ring = s === 0 ? ctx.ring : scaleToward(ctx.ring, apex.x, apex.z, sil.scales[s]!);
      paintBand(ring, yPrev, y1, s, colonnadeBase && s === 0);
      yPrev = y1;
    }
    emitRoofKit(ctx, recipe, stone);
    return;
  }
  if (sil.kind === 'courtyard') {
    emitPlateSlots(ctx, ctx.ring, 0, H * 0.16, stone, glass, 5.4, 1, 0.48, 0.42);
    paintBand(ctx.ring, H * 0.16, H, 0, colonnadeBase);
    const well = insetRingTowardCentroid(ctx.ring, cx, cz, sil.wellInsetM * METERS_TO_WORLD);
    emitWallBand(ctx, well, 0, H * sil.wellT, stone, 0);
    emitPlateSlots(
      ctx,
      well,
      H * 0.16,
      H * sil.wellT,
      stone,
      glass,
      plateRhythm(ctx.plan, H, 1).pitchM,
      2,
      0.4,
      0.48,
    );
    return;
  }
  if (sil.kind === 'ell') {
    const splitY = H * sil.tBreak;
    emitPlateSlots(ctx, ctx.ring, 0, H * 0.12, stone, glass, 5.2, 1, 0.46, 0.42);
    paintBand(ctx.ring, H * 0.12, splitY, 0, colonnadeBase);
    const head = ctx.ring.map((p) => ({
      x: cx + (p.x - cx) * sil.shortScale,
      z: cz + (p.z - cz) * sil.shortScale,
    }));
    paintBand(head, splitY, H, 1, false);
    emitRoofKit(ctx, recipe, stone);
    return;
  }
  if (sil.kind === 'asymmetric-setback') {
    const yA = H * sil.tBreaks[0]!;
    const yB = H * (sil.tBreaks[1] ?? 0.7);
    emitPlateSlots(ctx, ctx.ring, 0, H * 0.12, stone, glass, 5.4, 1, 0.5, 0.42);
    paintBand(ctx.ring, H * 0.12, yA, 0, colonnadeBase);
    paintBand(ctx.ring, yA, yB, 1, false);
    let prev = ctx.ring;
    let yPrev = yB;
    for (let i = 0; i < sil.insetsM.length; i++) {
      const ring = insetRingTowardCentroid(ctx.ring, cx, cz, sil.insetsM[i]! * METERS_TO_WORLD);
      const y1 =
        i === sil.insetsM.length - 1
          ? H
          : H * (sil.tBreaks[Math.min(i + 2, sil.tBreaks.length - 1)] ?? 1);
      paintBand(ring, yPrev, y1, i + 2, false);
      prev = ring;
      yPrev = y1;
    }
    if (yPrev < H - m(0.4)) {
      emitPlateSlots(ctx, prev, yPrev, H, stone, glass, 5.8, 2, 0.42, 0.48);
    }
    emitRoofKit(ctx, recipe, stone);
    return;
  }
  if (sil.kind === 'disk') {
    emitPlateSlots(ctx, ctx.ring, 0, H * 0.12, stone, glass, 5.2, 1, 0.46, 0.42);
    let yPrev = H * 0.12;
    for (let s = 0; s < sil.bands; s++) {
      const y1 = H * ((s + 1) / sil.bands);
      const ring = insetRingTowardCentroid(
        ctx.ring,
        cx,
        cz,
        (1 - sil.scales[s]!) * ctx.plan.minRM * METERS_TO_WORLD,
      );
      paintBand(s === 0 ? ctx.ring : ring, yPrev, y1, s, colonnadeBase && s === 0);
      yPrev = y1;
    }
    emitRoofKit(ctx, recipe, stone);
    return;
  }
  if (sil.kind === 'gable-row' || sil.kind === 'bar-ridge') {
    const bays = sil.kind === 'gable-row' ? Math.max(1, sil.bays) : 5;
    const pitch = Math.max(3.5, ctx.plan.longestEdgeM / bays);
    emitPlateSlots(ctx, ctx.ring, 0, H * 0.16, stone, glass, pitch, 1, 0.5, 0.42);
    emitProjectingBays(ctx, ctx.ring, H * 0.16, H, stone, glass, pitch, 2, 0.5);
    emitRoofKit(ctx, recipe, stone);
    return;
  }
  if (sil.kind === 'mansard-plate') {
    emitPlateSlots(ctx, ctx.ring, 0, H * 0.16, stone, glass, 5.2, 1, 0.48, 0.42);
    paintBand(ctx.ring, H * 0.16, H * sil.eavesT, 0, colonnadeBase);
    const eaves = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.7));
    emitPlateSlots(ctx, eaves, H * sil.eavesT, H, stone, glass, 4.8, 2, 0.36, 0.48);
    emitRoofKit(ctx, recipe, stone);
    return;
  }
  emitPlateSlots(ctx, ctx.ring, 0, H * 0.14, stone, glass, 5.2, 1, 0.46, 0.42);
  paintBand(ctx.ring, H * 0.14, H, 0, colonnadeBase);
  emitRoofKit(ctx, recipe, stone);
}

export function emitStreetUniqueWalls(kind: StreetUniqueId, ctx: StreetEmit): void {
  if (kind === 'no-1-poultry') {
    emitPoultryWalls(ctx);
    return;
  }
  if (kind === 'the-ned') {
    emitNedWalls(ctx);
    return;
  }
  if (kind === 'walbrook') {
    emitWalbrookWalls(ctx);
    return;
  }
  if (kind === 'magistrates') {
    emitMagistratesWalls(ctx);
    return;
  }
  if (kind === 'old-jewry') {
    emitOldJewryWalls(ctx);
    return;
  }
  if (kind === 'mansion-house') {
    emitMansionWalls(ctx);
    return;
  }
  if (kind === 'gresham-33') {
    emitGreshamWalls(ctx);
    return;
  }
  if (kind === 'bloomberg') {
    emitBloombergWalls(ctx);
    return;
  }
  if (kind === 'bank-england') {
    emitBankWalls(ctx);
    return;
  }
  const _never: never = kind;
  return _never;
}

export function emitStreetUniqueRoofs(kind: StreetUniqueId, ctx: StreetRoofEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  const asWall: StreetEmit = {
    ring: ctx.ring,
    plan: ctx.plan,
    heightWorld: H,
    emitRingWalls: () => undefined,
    pushBox: ctx.pushBox,
    pushOrientedBox: ctx.pushOrientedBox,
    pushVertex: ctx.pushVertex,
    pushTri: ctx.pushTri,
    outwardNormal: ctx.outwardNormal,
  };
  if (kind === 'no-1-poultry') {
    emitAnnularRoofRadial(ctx, ctx.ring, poultryWellR(ctx.plan), H, POULTRY_ROOF);
    return;
  }
  if (kind === 'the-ned') {
    const eaves = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.6));
    const well = insetRingTowardCentroid(ctx.ring, cx, cz, m(8.5));
    emitAnnularRoof(ctx, ctx.ring, eaves, H * 0.72, NED_STONE);
    emitAnnularRoof(ctx, eaves, well, H, NED_MANSARD);
    return;
  }
  if (kind === 'walbrook') {
    ctx.emitRoof(ctx.ring, () => H, WALBROOK_STONE);
    const drumR = Math.min(ctx.plan.maxAlongM, ctx.plan.maxPerpM) * 0.42 * METERS_TO_WORLD;
    const drumH = m(4.2);
    pushCylinder(asWall, cx, H, cz, drumR, drumH, WALBROOK_DRUM, 16, true);
    pushDome(asWall, cx, H + drumH, cz, drumR * 0.98, drumR * 0.92, WALBROOK_DOME, 7, 16);
    pushCylinder(
      asWall,
      cx,
      H + drumH + drumR * 0.85,
      cz,
      drumR * 0.18,
      m(3.2),
      WALBROOK_DRUM,
      10,
      true,
    );
    return;
  }
  if (kind === 'magistrates') {
    const eaves = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.4));
    ctx.emitRoof(ctx.ring, () => H * 0.68, MAG_STONE);
    ctx.emitRoof(eaves, () => H, MAG_MANSARD);
    return;
  }
  if (kind === 'old-jewry') {
    ctx.emitRoof(ctx.ring, () => H * 0.38, JEWRY_STONE);
    const ranked = edgesOf(asWall, ctx.ring).sort((a, b) => b.len - a.len);
    const e0 = ranked[0];
    const e1 = ranked[1] ?? e0;
    if (e0) {
      const mid = { x: (e0.a.x + e0.b.x) / 2, z: (e0.a.z + e0.b.z) / 2 };
      ctx.emitRoof(scaleToward(ctx.ring, mid.x, mid.z, 0.55), () => H * 0.72, JEWRY_MID);
    }
    if (e1) {
      const mid = { x: (e1.a.x + e1.b.x) / 2, z: (e1.a.z + e1.b.z) / 2 };
      ctx.emitRoof(scaleToward(ctx.ring, mid.x, mid.z, 0.38), () => H, JEWRY_HIGH);
    }
    return;
  }
  if (kind === 'mansion-house') {
    ctx.emitRoof(ctx.ring, () => H, MANSION_ROOF);
    return;
  }
  if (kind === 'gresham-33') {
    const { cx: gx, cz: gz } = ctx.plan;
    ctx.emitRoof(ctx.ring, () => H * 0.42, GRESHAM_STONE);
    ctx.emitRoof(insetRingTowardCentroid(ctx.ring, gx, gz, m(2.4)), () => H * 0.72, GRESHAM_STONE);
    ctx.emitRoof(insetRingTowardCentroid(ctx.ring, gx, gz, m(5.2)), () => H, GRESHAM_ROOF);
    return;
  }
  if (kind === 'bloomberg') {
    const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
    ctx.emitRoof(ctx.ring, () => H * 0.42, BLOOM_ROOF);
    ctx.emitRoof(scaleToward(ctx.ring, apex.x, apex.z, 0.76), () => H * 0.7, BLOOM_ROOF);
    ctx.emitRoof(scaleToward(ctx.ring, apex.x, apex.z, 0.54), () => H, BLOOM_STONE);
    return;
  }
  if (kind === 'bank-england') {
    const wellInset = Math.min(planWellInsetM(ctx.plan), 28) * METERS_TO_WORLD;
    const well = insetRingTowardCentroid(ctx.ring, cx, cz, wellInset);
    emitAnnularRoof(ctx, ctx.ring, well, H, BANK_ROOF);
    ctx.emitRoof(well, () => H * 0.35, BANK_WELL);
    return;
  }
  const _never: never = kind;
  return _never;
}
