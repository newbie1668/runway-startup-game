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

/** Magistrates' Court — civic cream + brown mansard. */
export const MAG_STONE = 0xddd4c4;
export const MAG_MANSARD = 0x6a4538;
export const MAG_PLINTH = 0x8a8074;

/** Sheppard Robson 1 Old Jewry: three interlocking Portland blocks, bronze fins. */
export const JEWRY_STONE = 0xe4ddd0;
export const JEWRY_GLASS = 0x243440;
export const JEWRY_BRONZE = 0x8a6240;
export const JEWRY_SHOP = 0x3a3834;

/** Dance Mansion House: rusticated pedestal, hexastyle Corinthian portico. */
export const MANSION_STONE = 0xe8e0d0;
export const MANSION_RUST = 0xcfc4b0;
export const MANSION_COLUMN = 0xf2eadc;
export const MANSION_ROOF = 0x5a5048;

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

function longestEdges(ring: StreetPt[], take: number): number[] {
  const n = ring.length;
  const ranked = Array.from({ length: n }, (_, i) => {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    return { i, len: Math.hypot(b.x - a.x, b.z - a.z) };
  });
  ranked.sort((a, b) => b.len - a.len);
  return ranked.slice(0, take).map((e) => e.i);
}

function scaleRing(ring: StreetPt[], cx: number, cz: number, scale: number): StreetPt[] {
  return ring.map((p) => ({ x: cx + (p.x - cx) * scale, z: cz + (p.z - cz) * scale }));
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

function emitMullions(
  ctx: StreetEmit,
  e: Edge,
  y0: number,
  y1: number,
  count: number,
  depth: number,
  hex: number,
): void {
  const h = y1 - y0;
  if (h < m(1.2) || count < 2) return;
  const along = Math.min(m(0.32), e.len * 0.04);
  for (let i = 1; i < count; i++) {
    const t = i / count;
    ctx.pushOrientedBox(
      e.a.x + (e.b.x - e.a.x) * t + e.nx * (depth * 0.55),
      y0,
      e.a.z + (e.b.z - e.a.z) * t + e.nz * (depth * 0.55),
      along,
      h,
      depth,
      e.tx,
      e.tz,
      e.nx,
      e.nz,
      hex,
    );
  }
}

/**
 * Projecting stone course + recessed glazed slot with mullions.
 * Flat paint stripes are a fail; this is 3D reveal depth.
 */
function emitRevealedStorey(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
  glass: number,
): void {
  const span = y1 - y0;
  const sill = span * 0.16;
  const head = span * 0.18;
  const glassY0 = y0 + sill;
  const glassY1 = y1 - head;
  emitWallBand(ctx, ring, y0, glassY0, stone, m(0.55));
  emitWallBand(ctx, ring, glassY0, glassY1, glass, -m(0.85));
  emitWallBand(ctx, ring, glassY1, y1, stone, m(0.7));
  for (const e of edgesOf(ctx, ring)) {
    if (e.len / METERS_TO_WORLD < 8) continue;
    const bays = Math.max(3, Math.min(9, Math.round(e.len / METERS_TO_WORLD / 4.2)));
    emitMullions(ctx, e, glassY0, glassY1, bays, m(1.15), stone);
  }
}

/** Ground arcade: piers + lintel, no wall in the bay (opening, not a painted slot). */
function emitArcade(
  ctx: StreetEmit,
  ring: StreetPt[],
  y0: number,
  y1: number,
  stone: number,
): void {
  const lintelH = Math.min(m(1.1), (y1 - y0) * 0.22);
  for (const e of edgesOf(ctx, ring)) {
    const edgeM = e.len / METERS_TO_WORLD;
    if (edgeM < 9) {
      emitWallQuad(ctx, e.a.x, e.a.z, e.b.x, e.b.z, y0, y1, e.nx, e.nz, stone);
      continue;
    }
    const bays = Math.max(3, Math.min(7, Math.round(edgeM / 6.2)));
    const pierW = Math.min(m(1.7), e.len / (bays * 3.2));
    const depth = m(1.9);
    for (let b = 0; b <= bays; b++) {
      const t = b / bays;
      ctx.pushOrientedBox(
        e.a.x + (e.b.x - e.a.x) * t + e.nx * (depth / 2),
        y0,
        e.a.z + (e.b.z - e.a.z) * t + e.nz * (depth / 2),
        pierW,
        y1 - y0 - lintelH,
        depth,
        e.tx,
        e.tz,
        e.nx,
        e.nz,
        stone,
      );
    }
    ctx.pushOrientedBox(
      (e.a.x + e.b.x) / 2 + e.nx * (depth / 2),
      y1 - lintelH,
      (e.a.z + e.b.z) / 2 + e.nz * (depth / 2),
      e.len * 0.96,
      lintelH,
      depth * 1.12,
      e.tx,
      e.tz,
      e.nx,
      e.nz,
      POULTRY_GRANITE,
    );
  }
}

function emitProwArch(ctx: StreetEmit, apex: StreetPt, H: number): void {
  const dirx = ctx.plan.cx - apex.x;
  const dirz = ctx.plan.cz - apex.z;
  const dlen = Math.hypot(dirx, dirz) || 1;
  const ox = -dirx / dlen;
  const oz = -dirz / dlen;
  const px = -oz;
  const pz = ox;
  const archH = H * 0.38;
  const half = m(2.6);
  const depth = m(2.4);
  const pierW = m(1.35);
  ctx.pushOrientedBox(
    apex.x + ox * (depth / 2) - px * (half - pierW / 2),
    0,
    apex.z + oz * (depth / 2) - pz * (half - pierW / 2),
    pierW,
    archH,
    depth,
    px,
    pz,
    ox,
    oz,
    POULTRY_PINK,
  );
  ctx.pushOrientedBox(
    apex.x + ox * (depth / 2) + px * (half - pierW / 2),
    0,
    apex.z + oz * (depth / 2) + pz * (half - pierW / 2),
    pierW,
    archH,
    depth,
    px,
    pz,
    ox,
    oz,
    POULTRY_BUFF,
  );
  ctx.pushOrientedBox(
    apex.x + ox * (depth / 2),
    archH * 0.78,
    apex.z + oz * (depth / 2),
    half * 2,
    archH * 0.22,
    depth,
    px,
    pz,
    ox,
    oz,
    POULTRY_BUFF,
  );
  ctx.pushOrientedBox(
    apex.x + ox * m(0.4),
    archH * 0.12,
    apex.z + oz * m(0.4),
    half * 1.15,
    archH * 0.62,
    m(0.45),
    px,
    pz,
    ox,
    oz,
    POULTRY_GLASS,
  );
  const vH = H * 0.16;
  ctx.pushOrientedBox(
    apex.x + ox * m(0.9),
    archH,
    apex.z + oz * m(0.9),
    m(3.4),
    vH,
    m(1.6),
    px,
    pz,
    ox,
    oz,
    POULTRY_GLASS,
  );
}

function emitPoultryWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  const arcadeH = H * 0.2;
  const inner = insetRingTowardCentroid(ctx.ring, cx, cz, m(3.2));
  emitArcade(ctx, ctx.ring, 0, arcadeH, POULTRY_BUFF);
  emitWallBand(ctx, inner, 0, arcadeH, POULTRY_SHOP, 0);
  const storeys = 5;
  const storeyH = (H - arcadeH) / storeys;
  for (let s = 0; s < storeys; s++) {
    const y0 = arcadeH + s * storeyH;
    const stone = s % 2 === 0 ? POULTRY_BUFF : POULTRY_PINK;
    emitRevealedStorey(ctx, ctx.ring, y0, y0 + storeyH, stone, POULTRY_GLASS);
  }
  for (const i of longestEdges(ctx.ring, 2)) {
    const e = edgesOf(ctx, ctx.ring)[i];
    if (!e || e.len / METERS_TO_WORLD < 18) continue;
    const midX = (e.a.x + e.b.x) / 2;
    const midZ = (e.a.z + e.b.z) / 2;
    const wedgeH = H * 0.42;
    ctx.pushOrientedBox(
      midX + e.nx * m(0.2),
      arcadeH,
      midZ + e.nz * m(0.2),
      Math.min(e.len * 0.28, m(14)),
      wedgeH,
      m(1.8),
      e.tx,
      e.tz,
      e.nx,
      e.nz,
      POULTRY_GLASS,
    );
  }
  const wellR = Math.min(ctx.plan.minRM, 11) * 0.42 * METERS_TO_WORLD;
  pushCylinder(ctx, cx, 0, cz, wellR, H, POULTRY_PINK, 18, false);
  emitWallBand(ctx, scaleRing(ctx.ring, cx, cz, 0.42), 0, H, POULTRY_SHOP, 0);
  const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
  emitProwArch(ctx, apex, H);
  const drumR = m(4.6);
  const drumY0 = H * 0.42;
  const drumH = H * 0.98;
  pushCylinder(ctx, apex.x, drumY0, apex.z, drumR, drumH, POULTRY_PINK, 18, true);
  pushCylinder(ctx, apex.x, drumY0 + drumH, apex.z, drumR * 0.62, m(2.2), POULTRY_BUFF, 14, true);
  const clockY = drumY0 + drumH * 0.55;
  const dirx = cx - apex.x;
  const dirz = cz - apex.z;
  const dlen = Math.hypot(dirx, dirz) || 1;
  const ox = -dirx / dlen;
  const oz = -dirz / dlen;
  const px = -oz;
  const pz = ox;
  ctx.pushOrientedBox(
    apex.x + ox * (drumR + m(0.15)),
    clockY - m(1.6),
    apex.z + oz * (drumR + m(0.15)),
    m(3.2),
    m(3.2),
    m(0.35),
    px,
    pz,
    ox,
    oz,
    POULTRY_GLASS,
  );
  ctx.pushOrientedBox(
    apex.x - ox * (drumR + m(0.15)),
    clockY - m(1.6),
    apex.z - oz * (drumR + m(0.15)),
    m(3.2),
    m(3.2),
    m(0.35),
    px,
    pz,
    ox,
    oz,
    POULTRY_GLASS,
  );
  const deckY = drumY0 + drumH * 0.82;
  ctx.pushOrientedBox(
    apex.x + px * (drumR + m(2.1)),
    deckY,
    apex.z + pz * (drumR + m(2.1)),
    m(6.4),
    m(0.55),
    m(2.6),
    px,
    pz,
    ox,
    oz,
    POULTRY_BUFF,
  );
  ctx.pushOrientedBox(
    apex.x - px * (drumR + m(2.1)),
    deckY,
    apex.z - pz * (drumR + m(2.1)),
    m(6.4),
    m(0.55),
    m(2.6),
    px,
    pz,
    ox,
    oz,
    POULTRY_BUFF,
  );
}

function emitNedWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const rustH = H * 0.22;
  const bodyH = H * 0.72;
  const { cx, cz } = ctx.plan;
  emitWallBand(ctx, ctx.ring, 0, rustH, NED_RUST, 0);
  for (const t of [0.28, 0.55, 0.82]) {
    emitWallBand(ctx, ctx.ring, rustH * t, rustH * t + m(0.45), NED_STONE, m(0.55));
  }
  emitWallBand(ctx, ctx.ring, rustH, bodyH, NED_STONE, 0);
  const long = new Set(longestEdges(ctx.ring, 3));
  for (const e of edgesOf(ctx, ctx.ring)) {
    if (!long.has(e.i) || e.len / METERS_TO_WORLD < 14) continue;
    const bays = Math.max(4, Math.min(8, Math.round(e.len / METERS_TO_WORLD / 6.5)));
    const pierW = m(1.35);
    const depth = m(1.7);
    for (let b = 0; b <= bays; b++) {
      const t = b / bays;
      ctx.pushOrientedBox(
        e.a.x + (e.b.x - e.a.x) * t + e.nx * (depth / 2),
        rustH,
        e.a.z + (e.b.z - e.a.z) * t + e.nz * (depth / 2),
        pierW,
        bodyH - rustH,
        depth,
        e.tx,
        e.tz,
        e.nx,
        e.nz,
        NED_STONE,
      );
    }
    const winW = Math.min(m(2.8), (e.len / (bays + 1)) * 0.62);
    const winH = (bodyH - rustH) * 0.42;
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) / bays;
      ctx.pushOrientedBox(
        e.a.x + (e.b.x - e.a.x) * t + e.nx * m(-0.7),
        rustH + (bodyH - rustH) * 0.22,
        e.a.z + (e.b.z - e.a.z) * t + e.nz * m(-0.7),
        winW,
        winH,
        m(1.4),
        e.tx,
        e.tz,
        e.nx,
        e.nz,
        NED_GLASS,
      );
    }
  }
  emitWallBand(ctx, ctx.ring, bodyH, H, NED_MANSARD, m(-0.4));
  const well = insetRingTowardCentroid(ctx.ring, cx, cz, m(8.5));
  emitWallBand(ctx, well, rustH, H * 0.9, NED_RUST, 0);
}

function emitWalbrookWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  emitWallBand(ctx, ctx.ring, 0, H, WALBROOK_STONE, 0);
  const e = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len)[0];
  if (e && e.len / METERS_TO_WORLD >= 10) {
    const colH = H * 0.62;
    for (const t of [0.22, 0.5, 0.78]) {
      pushCylinder(
        ctx,
        e.a.x + (e.b.x - e.a.x) * t + e.nx * m(1.1),
        0,
        e.a.z + (e.b.z - e.a.z) * t + e.nz * m(1.1),
        m(0.55),
        colH,
        WALBROOK_DRUM,
        10,
        true,
      );
    }
    ctx.pushOrientedBox(
      (e.a.x + e.b.x) / 2 + e.nx * m(1.1),
      colH,
      (e.a.z + e.b.z) / 2 + e.nz * m(1.1),
      e.len * 0.62,
      m(0.7),
      m(2.2),
      e.tx,
      e.tz,
      e.nx,
      e.nz,
      WALBROOK_STONE,
    );
  }
}

function emitMagistratesWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  emitWallBand(ctx, ctx.ring, 0, H * 0.16, MAG_PLINTH, m(0.35));
  emitWallBand(ctx, ctx.ring, H * 0.16, H * 0.68, MAG_STONE, 0);
  const e = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len)[0];
  if (e && e.len / METERS_TO_WORLD >= 12) {
    const colH = H * 0.42;
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      pushCylinder(
        ctx,
        e.a.x + (e.b.x - e.a.x) * t + e.nx * m(1.2),
        H * 0.16,
        e.a.z + (e.b.z - e.a.z) * t + e.nz * m(1.2),
        m(0.48),
        colH,
        MAG_STONE,
        10,
        true,
      );
    }
    ctx.pushOrientedBox(
      (e.a.x + e.b.x) / 2 + e.nx * m(-0.6),
      H * 0.28,
      (e.a.z + e.b.z) / 2 + e.nz * m(-0.6),
      e.len * 0.72,
      H * 0.18,
      m(1.1),
      e.tx,
      e.tz,
      e.nx,
      e.nz,
      0x3a5470,
    );
  }
  emitWallBand(ctx, ctx.ring, H * 0.68, H, MAG_MANSARD, m(-0.5));
}

function emitOldJewryWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
  const shopH = H * 0.14;
  emitWallBand(ctx, ctx.ring, 0, shopH, JEWRY_SHOP, 0);
  for (const e of edgesOf(ctx, ctx.ring)) {
    if (e.len / METERS_TO_WORLD < 8) continue;
    const bays = Math.max(2, Math.min(5, Math.round(e.len / METERS_TO_WORLD / 7)));
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) / bays;
      ctx.pushOrientedBox(
        e.a.x + (e.b.x - e.a.x) * t + e.nx * m(0.8),
        m(0.25),
        e.a.z + (e.b.z - e.a.z) * t + e.nz * m(0.8),
        m(2.8),
        shopH * 0.78,
        m(1.4),
        e.tx,
        e.tz,
        e.nx,
        e.nz,
        JEWRY_GLASS,
      );
    }
  }
  emitWallBand(ctx, ctx.ring, shopH, H * 0.55, JEWRY_STONE, 0);
  const blockB = scaleToward(ctx.ring, apex.x, apex.z, 0.78);
  emitWallBand(ctx, blockB, H * 0.55, H * 0.82, JEWRY_STONE, 0);
  const blockC = scaleToward(ctx.ring, cx, cz, 0.62);
  emitWallBand(ctx, blockC, H * 0.82, H, JEWRY_STONE, 0);

  const ranked = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len);
  const deep = ranked[0];
  const mid = ranked[1];
  const flush = ranked[2];
  if (deep) emitDeepReveals(ctx, deep, shopH, H * 0.55, m(1.35));
  if (mid) emitDeepReveals(ctx, mid, shopH, H * 0.55, m(0.65));
  if (flush) {
    emitEdgeWall(ctx, flush, shopH, H * 0.55, JEWRY_GLASS, m(-0.12));
  }
  if (mid) emitBronzeLouvres(ctx, mid, shopH, H * 0.78);
}

function emitEdgeWall(
  ctx: StreetEmit,
  e: Edge,
  y0: number,
  y1: number,
  hex: number,
  outset: number,
): void {
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

function emitDeepReveals(ctx: StreetEmit, e: Edge, y0: number, y1: number, depth: number): void {
  const floors = Math.max(3, Math.min(6, Math.round((y1 - y0) / m(3.4))));
  const bays = Math.max(3, Math.min(7, Math.round(e.len / METERS_TO_WORLD / 4.6)));
  const winW = Math.min(m(2.2), (e.len / (bays + 1)) * 0.55);
  const winH = ((y1 - y0) / floors) * 0.58;
  const frame = JEWRY_STONE;
  for (let r = 0; r < floors; r++) {
    const y = y0 + ((r + 0.5) / floors) * (y1 - y0) - winH / 2;
    for (let c = 0; c < bays; c++) {
      const t = (c + 0.5) / bays;
      const mx = e.a.x + (e.b.x - e.a.x) * t;
      const mz = e.a.z + (e.b.z - e.a.z) * t;
      ctx.pushOrientedBox(
        mx + e.nx * (depth / 2),
        y,
        mz + e.nz * (depth / 2),
        winW + m(0.45),
        winH + m(0.4),
        depth,
        e.tx,
        e.tz,
        e.nx,
        e.nz,
        frame,
      );
      ctx.pushOrientedBox(
        mx + e.nx * (depth * 0.15),
        y + m(0.18),
        mz + e.nz * (depth * 0.15),
        winW,
        winH,
        depth * 0.7,
        e.tx,
        e.tz,
        e.nx,
        e.nz,
        JEWRY_GLASS,
      );
    }
  }
}

function emitBronzeLouvres(ctx: StreetEmit, e: Edge, y0: number, y1: number): void {
  const rows = 7;
  const along = e.len * 0.88;
  for (let r = 0; r < rows; r++) {
    const y = y0 + ((r + 0.5) / rows) * (y1 - y0);
    ctx.pushOrientedBox(
      (e.a.x + e.b.x) / 2 + e.nx * m(1.15),
      y,
      (e.a.z + e.b.z) / 2 + e.nz * m(1.15),
      along,
      m(0.18),
      m(0.85),
      e.tx,
      e.tz,
      e.nx,
      e.nz,
      JEWRY_BRONZE,
    );
  }
}

function emitMansionWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const rustH = H * 0.28;
  const bodyH = H * 0.78;
  emitWallBand(ctx, ctx.ring, 0, rustH, MANSION_RUST, 0);
  for (const t of [0.22, 0.5, 0.78]) {
    emitWallBand(ctx, ctx.ring, rustH * t, rustH * t + m(0.38), MANSION_STONE, m(0.45));
  }
  emitWallBand(ctx, ctx.ring, rustH, bodyH, MANSION_STONE, 0);
  emitWallBand(ctx, ctx.ring, bodyH, H, MANSION_STONE, m(-0.25));
  const e = edgesOf(ctx, ctx.ring).sort((a, b) => b.len - a.len)[0];
  if (!e || e.len / METERS_TO_WORLD < 16) return;
  const colH = bodyH - rustH;
  const colR = m(0.62);
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.7) / 7;
    pushCylinder(
      ctx,
      e.a.x + (e.b.x - e.a.x) * t + e.nx * m(2.1),
      rustH,
      e.a.z + (e.b.z - e.a.z) * t + e.nz * m(2.1),
      colR,
      colH,
      MANSION_COLUMN,
      12,
      true,
    );
    ctx.pushOrientedBox(
      e.a.x + (e.b.x - e.a.x) * t + e.nx * m(2.1),
      rustH + colH,
      e.a.z + (e.b.z - e.a.z) * t + e.nz * m(2.1),
      m(1.5),
      m(0.45),
      m(1.5),
      e.tx,
      e.tz,
      e.nx,
      e.nz,
      MANSION_COLUMN,
    );
  }
  const porticoAlong = e.len * 0.72;
  ctx.pushOrientedBox(
    (e.a.x + e.b.x) / 2 + e.nx * m(2.1),
    rustH + colH,
    (e.a.z + e.b.z) / 2 + e.nz * m(2.1),
    porticoAlong,
    m(0.85),
    m(4.4),
    e.tx,
    e.tz,
    e.nx,
    e.nz,
    MANSION_STONE,
  );
  const pedH = H * 0.22;
  ctx.pushOrientedBox(
    (e.a.x + e.b.x) / 2 + e.nx * m(2.0),
    rustH + colH + m(0.85),
    (e.a.z + e.b.z) / 2 + e.nz * m(2.0),
    porticoAlong,
    pedH * 0.35,
    m(4.2),
    e.tx,
    e.tz,
    e.nx,
    e.nz,
    MANSION_STONE,
  );
  ctx.pushOrientedBox(
    (e.a.x + e.b.x) / 2 + e.nx * m(2.0),
    rustH + colH + m(0.85) + pedH * 0.28,
    (e.a.z + e.b.z) / 2 + e.nz * m(2.0),
    porticoAlong * 0.62,
    pedH * 0.38,
    m(3.4),
    e.tx,
    e.tz,
    e.nx,
    e.nz,
    MANSION_STONE,
  );
  ctx.pushOrientedBox(
    (e.a.x + e.b.x) / 2 + e.nx * m(2.0),
    rustH + colH + m(0.85) + pedH * 0.62,
    (e.a.z + e.b.z) / 2 + e.nz * m(2.0),
    porticoAlong * 0.28,
    pedH * 0.32,
    m(2.4),
    e.tx,
    e.tz,
    e.nx,
    e.nz,
    MANSION_STONE,
  );
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
    const ledge = ctx.insetRing(ctx.ring, cx, cz, 0.88);
    ctx.emitRoof(ledge, () => H, POULTRY_ROOF);
    const pent = ctx.insetRing(ctx.ring, cx, cz, 0.48);
    ctx.emitRoof(pent, () => H + m(3.6), POULTRY_BUFF);
    const wellR = Math.min(ctx.plan.minRM, 11) * 0.42 * METERS_TO_WORLD;
    pushCylinder(asWall, cx, H, cz, wellR * 1.05, m(1.4), POULTRY_PINK, 16, true);
    const tobler = ctx.insetRing(ctx.ring, cx, cz, 0.22);
    ctx.emitRoof(tobler, () => H + m(2.2), POULTRY_GLASS);
    const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
    ctx.pushBox(apex.x, H * 1.4, apex.z, m(3.4), m(2.8), m(3.4), POULTRY_BUFF);
    return;
  }
  if (kind === 'the-ned') {
    ctx.emitRoof(
      ctx.ring,
      (p) => {
        const d = Math.hypot(p.x - cx, p.z - cz);
        let maxD = 1e-6;
        for (const q of ctx.ring) maxD = Math.max(maxD, Math.hypot(q.x - cx, q.z - cz));
        return H + m(6.2) * (1 - Math.min(1, d / maxD));
      },
      NED_MANSARD,
    );
    const well = ctx.insetRing(ctx.ring, cx, cz, 0.42);
    ctx.emitRoof(well, () => H * 0.55, NED_RUST);
    for (const s of [-1, 1]) {
      ctx.pushBox(cx + s * m(8), H + m(4.5), cz + m(4), m(1.6), m(4.8), m(1.6), NED_MANSARD);
      ctx.pushBox(cx + s * m(8), H + m(4.5), cz - m(4), m(1.6), m(4.8), m(1.6), NED_MANSARD);
    }
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
    ctx.emitRoof(
      ctx.ring,
      (p) => {
        const d = Math.hypot(p.x - cx, p.z - cz);
        let maxD = 1e-6;
        for (const q of ctx.ring) maxD = Math.max(maxD, Math.hypot(q.x - cx, q.z - cz));
        return H * 0.68 + (H * 0.32 + m(4.2)) * (1 - Math.min(1, d / maxD));
      },
      MAG_MANSARD,
    );
    return;
  }
  if (kind === 'old-jewry') {
    ctx.emitRoof(ctx.ring, () => H * 0.55, JEWRY_STONE);
    const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
    ctx.emitRoof(scaleToward(ctx.ring, apex.x, apex.z, 0.78), () => H * 0.82, JEWRY_STONE);
    ctx.emitRoof(scaleToward(ctx.ring, cx, cz, 0.62), () => H, JEWRY_STONE);
    ctx.pushBox(cx, H, cz, m(8), m(2.4), m(6), 0x4a504c);
    return;
  }
  if (kind === 'mansion-house') {
    ctx.emitRoof(ctx.ring, () => H, MANSION_ROOF);
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5 - 0.5;
      ctx.pushBox(
        cx + ctx.plan.ax * t * m(14),
        H,
        cz + ctx.plan.az * t * m(14),
        m(1.1),
        m(1.6),
        m(1.1),
        MANSION_STONE,
      );
    }
    return;
  }
  const _never: never = kind;
  return _never;
}
