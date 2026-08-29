/**
 * Bake-time unique street meshes for noticed Cheapside buildings.
 *
 * Kansas pipeline, offline at play time:
 *   OSM address / Wikipedia at bake time → stand-out features → unique mesh.
 * Runtime only matches a committed pin to the footprint centroid.
 *
 * Pins from Overpass + enwiki (No 1 Poultry, The Ned, St Stephen Walbrook,
 * Magistrates' Court, 1 Old Jewry, Mansion House). No live fetch in the client.
 */

import { METERS_TO_WORLD } from '../geo';
import { insetRingTowardCentroid, scaleToward } from './footprint';
import type { PlanMetrics } from './uniqueStock';

export type StreetUniqueId =
  'no-1-poultry' | 'the-ned' | 'walbrook' | 'magistrates' | 'old-jewry' | 'mansion-house';

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
];

export const STREET_UNIQUE_LABEL: Record<StreetUniqueId, { name: string; use: string }> = {
  'no-1-poultry': { name: 'No 1 Poultry', use: 'Stirling' },
  'the-ned': { name: 'The Ned', use: 'Hotel' },
  walbrook: { name: 'St Stephen Walbrook', use: 'Church' },
  magistrates: { name: "Magistrates' Court", use: 'Civic' },
  'old-jewry': { name: '1 Old Jewry', use: 'Office' },
  'mansion-house': { name: 'Mansion House', use: 'Civic' },
};

/** Stirling banded sandstone (wiki Commons still of No 1 Poultry). */
export const POULTRY_BUFF = 0xe8d4a4;
export const POULTRY_PINK = 0xc47a58;
export const POULTRY_GLASS = 0x2a4050;
export const POULTRY_SHOP = 0x3a322c;
export const POULTRY_ROOF = 0x5a625c;
export const POULTRY_GRANITE = 0x6a6e6a;
export const POULTRY_WELL = 0x1a1a22;

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

/** Corner clock radius. Roof must leave this disk empty or the 20-gon reads as needles. */
export const POULTRY_DRUM_R_M = 6.4;

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

/** Arcade openings sit in the wall plane. Oriented boxes along OSM edges stick through corners. */
function emitArcade(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
): void {
  const lintelH = Math.min(m(1.1), (y1 - y0) * 0.2);
  for (const e of edgesOf(ctx, ring)) {
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
    let skip = false;
    for (const h of holes) {
      if (Math.hypot(a.x - h.x, a.z - h.z) < h.r) skip = true;
      if (Math.hypot(b.x - h.x, b.z - h.z) < h.r) skip = true;
      if (distPointToSeg(h.x, h.z, a.x, a.z, b.x, b.z) < h.r) skip = true;
    }
    if (skip) continue;
    const iax = cx + ((a.x - cx) / ra) * wellR;
    const iaz = cz + ((a.z - cz) / ra) * wellR;
    const ibx = cx + ((b.x - cx) / rb) * wellR;
    const ibz = cz + ((b.z - cz) / rb) * wellR;
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

/** Horizontal storey bands in the wall plane. Wrapping boxes along OSM edges clip at corners. */
function emitRibbonStoreys(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  glass: number,
  floors: number,
  glassRatio: number,
): void {
  const n = Math.max(2, Math.min(floors, 12));
  const span = y1 - y0;
  const g = Math.min(0.72, Math.max(0.28, glassRatio));
  for (let f = 0; f < n; f++) {
    const fy0 = y0 + (f / n) * span;
    const fy1 = y0 + ((f + 1) / n) * span;
    const gH = (fy1 - fy0) * g;
    emitWallBand(ctx, ring, fy0, fy1 - gH, stone, 0);
    emitWallBand(ctx, ring, fy1 - gH, fy1, glass, 0);
  }
}

/**
 * Punched window grid in the wall plane. Each building passes its own pitch and
 * row count so Cheapside does not share one costume.
 */
function emitPunchedGrid(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  glass: number,
  pitchM: number,
  rows: number,
  winU: number,
  winV: number,
  skipI = -1,
): void {
  const nRows = Math.max(1, rows);
  const span = y1 - y0;
  const rowH = span / nRows;
  const uPad = (1 - Math.min(0.82, Math.max(0.28, winU))) / 2;
  const vPad = (1 - Math.min(0.82, Math.max(0.28, winV))) / 2;
  for (const e of edgesOf(ctx, ring)) {
    if (e.i === skipI) continue;
    const edgeM = e.len / METERS_TO_WORLD;
    if (edgeM < 5.2) {
      emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, stone);
      continue;
    }
    const bays = Math.max(2, Math.min(16, Math.round(edgeM / pitchM)));
    for (let b = 0; b < bays; b++) {
      const t0 = b / bays;
      const t1 = (b + 1) / bays;
      const left = edgePoint(e, t0);
      const right = edgePoint(e, t1);
      const w0 = edgePoint(e, t0 + (t1 - t0) * uPad);
      const w1 = edgePoint(e, t1 - (t1 - t0) * uPad);
      emitWallQuad(ctx, left.x, left.z, w0.x, w0.z, y0, y1, e.nx, e.nz, stone);
      emitWallQuad(ctx, w1.x, w1.z, right.x, right.z, y0, y1, e.nx, e.nz, stone);
      for (let r = 0; r < nRows; r++) {
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
}

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

function porticoPoint(e: Edge, t: number, out: number): StreetPt {
  return {
    x: e.a.x + (e.b.x - e.a.x) * t + e.nx * out,
    z: e.a.z + (e.b.z - e.a.z) * t + e.nz * out,
  };
}

function emitPoultryWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  const arcadeH = H * 0.22;
  emitArcade(ctx, ctx.ring, 0, arcadeH, POULTRY_BUFF);
  const bodyM = (H - arcadeH) / METERS_TO_WORLD;
  const storeys = Math.max(5, Math.min(9, Math.round(bodyM / 3.35)));
  emitRibbonStoreys(ctx, ctx.ring, arcadeH, H, POULTRY_BUFF, POULTRY_GLASS, storeys, 0.48);
  const wellR = poultryWellR(ctx.plan);
  pushCylinder(ctx, cx, 0, cz, wellR, H, POULTRY_WELL, 20, false);
  pushDisk(ctx, cx, m(0.35), cz, wellR * 0.98, POULTRY_WELL, 20);
  const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
  const drumR = m(POULTRY_DRUM_R_M);
  const drumY0 = arcadeH;
  const drumH = H * 1.18;
  pushCylinder(ctx, apex.x, drumY0, apex.z, drumR, drumH, POULTRY_PINK, 20, true);
  pushCylinder(ctx, apex.x, drumY0 + drumH, apex.z, drumR * 0.62, m(2.8), POULTRY_BUFF, 14, true);
}

function emitNedWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const rustH = H * 0.22;
  const bodyH = H * 0.72;
  const { cx, cz } = ctx.plan;
  emitPunchedGrid(ctx, ctx.ring, 0, rustH, NED_RUST, NED_GLASS, 4.6, 1, 0.4, 0.48);
  emitPunchedGrid(ctx, ctx.ring, rustH, bodyH, NED_STONE, NED_GLASS, 4.6, 5, 0.52, 0.58);
  const eaves = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.6));
  emitWallBand(ctx, eaves, bodyH, H, NED_MANSARD, 0);
  const well = insetRingTowardCentroid(ctx.ring, cx, cz, m(8.5));
  emitPunchedGrid(ctx, well, rustH, H, NED_RUST, NED_GLASS, 5.4, 4, 0.5, 0.52);
}

function emitWalbrookWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  emitPunchedGrid(ctx, ctx.ring, 0, H, WALBROOK_STONE, WALBROOK_GLASS, 7.6, 1, 0.38, 0.58);
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
  emitPunchedGrid(ctx, ctx.ring, H * 0.16, H * 0.68, MAG_STONE, MAG_GLASS, 3.7, 4, 0.58, 0.55);
  const eaves = insetRingTowardCentroid(ctx.ring, cx, cz, m(1.4));
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
  const portalI = e0?.i ?? -1;
  emitPunchedGrid(ctx, ctx.ring, 0, hA, JEWRY_STONE, JEWRY_GLASS, 3.3, 3, 0.6, 0.55, portalI);
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
    emitPunchedGrid(
      ctx,
      scaleToward(ctx.ring, mid.x, mid.z, 0.55),
      0,
      hB,
      JEWRY_MID,
      JEWRY_GLASS,
      4.0,
      4,
      0.55,
      0.6,
    );
  }
  if (e1) {
    const mid = { x: (e1.a.x + e1.b.x) / 2, z: (e1.a.z + e1.b.z) / 2 };
    emitPunchedGrid(
      ctx,
      scaleToward(ctx.ring, mid.x, mid.z, 0.38),
      0,
      H,
      JEWRY_HIGH,
      JEWRY_GLASS,
      4.8,
      5,
      0.42,
      0.68,
    );
  }
}

function emitMansionWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const rustH = H * 0.28;
  const bodyH = H * 0.78;
  emitPunchedGrid(ctx, ctx.ring, 0, rustH, MANSION_RUST, MANSION_GLASS, 3.5, 2, 0.4, 0.46);
  emitPunchedGrid(ctx, ctx.ring, rustH, bodyH, MANSION_STONE, MANSION_GLASS, 3.5, 4, 0.5, 0.55);
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
    const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
    emitAnnularRoofRadial(ctx, ctx.ring, poultryWellR(ctx.plan), H, POULTRY_ROOF, [
      { x: apex.x, z: apex.z, r: m(POULTRY_DRUM_R_M) + m(0.55) },
    ]);
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
  const _never: never = kind;
  return _never;
}
