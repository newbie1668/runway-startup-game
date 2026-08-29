/**
 * Bake-time unique street meshes for noticed Cheapside buildings.
 *
 * Kansas pipeline, offline at play time:
 *   OSM address / Wikipedia at bake time → stand-out features → unique mesh.
 * Runtime only matches a committed pin to the footprint centroid.
 *
 * Pins from Overpass + enwiki (No 1 Poultry, The Ned, St Stephen Walbrook,
 * City of London Magistrates' Court). No live fetch in the client.
 */

import { METERS_TO_WORLD } from '../geo';
import type { PlanMetrics } from './uniqueStock';

export type StreetUniqueId = 'no-1-poultry' | 'the-ned' | 'walbrook' | 'magistrates';

export type StreetUniquePin = {
  id: StreetUniqueId;
  lng: number;
  lat: number;
  matchM: number;
};

/** OSM way centres from the Cheapside bake query. */
export const STREET_UNIQUE_PINS: readonly StreetUniquePin[] = [
  { id: 'no-1-poultry', lng: -0.09075, lat: 51.51332, matchM: 38 },
  { id: 'the-ned', lng: -0.09008, lat: 51.51372, matchM: 38 },
  { id: 'walbrook', lng: -0.08983, lat: 51.51262, matchM: 32 },
  { id: 'magistrates', lng: -0.09014, lat: 51.51305, matchM: 28 },
];

export const STREET_UNIQUE_LABEL: Record<StreetUniqueId, { name: string; use: string }> = {
  'no-1-poultry': { name: 'No 1 Poultry', use: 'Stirling' },
  'the-ned': { name: 'The Ned', use: 'Hotel' },
  walbrook: { name: 'St Stephen Walbrook', use: 'Church' },
  magistrates: { name: "Magistrates' Court", use: 'Civic' },
};

/** Stirling banded sandstone (wiki Commons still of No 1 Poultry). */
export const POULTRY_BUFF = 0xe8d4a4;
export const POULTRY_PINK = 0xc47a58;
export const POULTRY_GLASS = 0x2a4050;
export const POULTRY_SHOP = 0x3a322c;
export const POULTRY_ROOF = 0x5a625c;

/** Lutyens Midland Bank / The Ned. Portland, rusticated base, dark mansard. */
export const NED_STONE = 0xe6dfd0;
export const NED_RUST = 0x7a7064;
export const NED_GLASS = 0x3a5470;
export const NED_MANSARD = 0x4a4038;

/** Wren St Stephen Walbrook — pale stone nave + lead dome. */
export const WALBROOK_STONE = 0xeae4d6;
export const WALBROOK_DOME = 0x8a9088;
export const WALBROOK_DRUM = 0xd8d2c4;

/** Magistrates' Court — civic cream + brown mansard. */
export const MAG_STONE = 0xddd4c4;
export const MAG_MANSARD = 0x6a4538;
export const MAG_PLINTH = 0x8a8074;

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
  outwardNormal: (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
  ) => [number, number];
};

function longestEdges(ring: StreetPt[], take: number): number[] {
  const n = ring.length;
  const edges = Array.from({ length: n }, (_, i) => {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    return { i, len: Math.hypot(b.x - a.x, b.z - a.z) };
  });
  edges.sort((a, b) => b.len - a.len);
  return edges.slice(0, take).map((e) => e.i);
}

function emitGlassSlots(
  ctx: StreetEmit,
  ring: StreetPt[],
  y: number,
  h: number,
  hex: number,
  minEdgeM: number,
): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const bp = ring[(i + 1) % n]!;
    const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
    if (elen / METERS_TO_WORLD < minEdgeM) continue;
    const [nx, nz] = ctx.outwardNormal(a.x, a.z, bp.x, bp.z, ctx.plan.cx, ctx.plan.cz);
    const tx = (bp.x - a.x) / elen;
    const tz = (bp.z - a.z) / elen;
    const depth = 1.05 * METERS_TO_WORLD;
    ctx.pushOrientedBox(
      (a.x + bp.x) / 2 + nx * (depth / 2),
      y,
      (a.z + bp.z) / 2 + nz * (depth / 2),
      elen * 0.88,
      h,
      depth,
      tx,
      tz,
      nx,
      nz,
      hex,
    );
  }
}

/** James Stirling: pink/buff limestone stripes, prow clock drum, rooftop pavilion. */
function emitPoultryWalls(ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  const bands = 9;
  const shopH = H * 0.16;
  ctx.emitRingWalls(ctx.ring, 0, shopH, {
    plinth: false,
    shop: false,
    cornice: false,
    doors: false,
    windows: false,
    hex: POULTRY_SHOP,
    bottomHex: POULTRY_SHOP,
  });
  for (const i of longestEdges(ctx.ring, 2)) {
    const a = ctx.ring[i]!;
    const bp = ctx.ring[(i + 1) % ctx.ring.length]!;
    const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
    const [nx, nz] = ctx.outwardNormal(a.x, a.z, bp.x, bp.z, ctx.plan.cx, ctx.plan.cz);
    const tx = (bp.x - a.x) / elen;
    const tz = (bp.z - a.z) / elen;
    const bays = Math.max(3, Math.min(7, Math.round(elen / METERS_TO_WORLD / 6)));
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) / bays;
      const mx = a.x + (bp.x - a.x) * t;
      const mz = a.z + (bp.z - a.z) * t;
      ctx.pushOrientedBox(
        mx + nx * 0.7 * METERS_TO_WORLD,
        0.2 * METERS_TO_WORLD,
        mz + nz * 0.7 * METERS_TO_WORLD,
        2.4 * METERS_TO_WORLD,
        shopH * 0.78,
        1.2 * METERS_TO_WORLD,
        tx,
        tz,
        nx,
        nz,
        POULTRY_GLASS,
      );
    }
  }
  const stripeH = (H - shopH) / bands;
  for (let s = 0; s < bands; s++) {
    const y0 = shopH + s * stripeH;
    const y1 = y0 + stripeH;
    const pink = s % 2 === 1;
    ctx.emitRingWalls(ctx.ring, y0, y1, {
      plinth: false,
      shop: false,
      cornice: s === bands - 1,
      doors: false,
      windows: false,
      hex: pink ? POULTRY_PINK : POULTRY_BUFF,
      bottomHex: pink ? POULTRY_PINK : POULTRY_BUFF,
    });
    if (pink && s > 0 && s < bands - 1) {
      emitGlassSlots(ctx, ctx.ring, y0 + stripeH * 0.18, stripeH * 0.55, POULTRY_GLASS, 8);
    }
  }
  const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: ctx.plan.cx, z: ctx.plan.cz };
  const drumR = 5.2 * METERS_TO_WORLD;
  const drumH = H * 1.38;
  ctx.pushBox(apex.x, 0, apex.z, drumR * 2, drumH, drumR * 2, POULTRY_PINK);
  ctx.pushBox(
    apex.x,
    drumH,
    apex.z,
    drumR * 1.15,
    2.4 * METERS_TO_WORLD,
    drumR * 1.15,
    POULTRY_BUFF,
  );
  ctx.pushBox(
    apex.x,
    drumH * 0.62,
    apex.z,
    drumR * 0.7,
    2.2 * METERS_TO_WORLD,
    0.35 * METERS_TO_WORLD,
    POULTRY_GLASS,
  );
}

export function emitStreetUniqueWalls(kind: StreetUniqueId, ctx: StreetEmit): void {
  const H = ctx.heightWorld;
  if (kind === 'no-1-poultry') {
    emitPoultryWalls(ctx);
    return;
  }
  if (kind === 'the-ned') {
    const rustH = H * 0.2;
    const bodyH = H * 0.68;
    ctx.emitRingWalls(ctx.ring, 0, rustH, {
      plinth: true,
      shop: false,
      cornice: true,
      doors: true,
      windows: false,
      hex: NED_RUST,
      bottomHex: NED_RUST,
    });
    ctx.emitRingWalls(ctx.ring, rustH, bodyH, {
      plinth: false,
      shop: false,
      cornice: true,
      doors: false,
      windows: false,
      stringCourses: true,
      hex: NED_STONE,
      bottomHex: NED_STONE,
    });
    const n = ctx.ring.length;
    for (let i = 0; i < n; i++) {
      const a = ctx.ring[i]!;
      const bp = ctx.ring[(i + 1) % n]!;
      const elen = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
      const edgeM = elen / METERS_TO_WORLD;
      if (edgeM < 12) continue;
      const [nx, nz] = ctx.outwardNormal(a.x, a.z, bp.x, bp.z, ctx.plan.cx, ctx.plan.cz);
      const tx = (bp.x - a.x) / elen;
      const tz = (bp.z - a.z) / elen;
      const bays = Math.max(4, Math.min(9, Math.round(edgeM / 5.8)));
      const pierW = 1.15 * METERS_TO_WORLD;
      const depth = 1.35 * METERS_TO_WORLD;
      for (let b = 1; b < bays; b++) {
        const t = b / bays;
        ctx.pushOrientedBox(
          a.x + (bp.x - a.x) * t + nx * (depth / 2),
          rustH,
          a.z + (bp.z - a.z) * t + nz * (depth / 2),
          pierW,
          bodyH - rustH,
          depth,
          tx,
          tz,
          nx,
          nz,
          NED_STONE,
        );
      }
      const slotW = Math.min(2.4 * METERS_TO_WORLD, (elen / (bays + 1)) * 0.55);
      const slotH = (bodyH - rustH) * 0.38;
      for (let b = 0; b < bays; b++) {
        const t = (b + 0.5) / bays;
        for (const row of [0.28, 0.68]) {
          ctx.pushOrientedBox(
            a.x + (bp.x - a.x) * t + nx * 0.85 * METERS_TO_WORLD,
            rustH + (bodyH - rustH) * row - slotH / 2,
            a.z + (bp.z - a.z) * t + nz * 0.85 * METERS_TO_WORLD,
            slotW,
            slotH,
            0.7 * METERS_TO_WORLD,
            tx,
            tz,
            nx,
            nz,
            NED_GLASS,
          );
        }
      }
    }
    ctx.emitRingWalls(ctx.ring, bodyH, H, {
      plinth: false,
      shop: false,
      cornice: false,
      doors: false,
      windows: false,
      hex: NED_MANSARD,
      bottomHex: NED_MANSARD,
    });
    return;
  }
  if (kind === 'walbrook') {
    ctx.emitRingWalls(ctx.ring, 0, H, {
      plinth: true,
      shop: false,
      cornice: true,
      doors: true,
      windows: false,
      hex: WALBROOK_STONE,
      bottomHex: WALBROOK_STONE,
    });
    emitGlassSlots(ctx, ctx.ring, H * 0.28, H * 0.22, 0x3a5470, 6);
    return;
  }
  ctx.emitRingWalls(ctx.ring, 0, H * 0.14, {
    plinth: true,
    shop: false,
    cornice: true,
    doors: true,
    windows: false,
    hex: MAG_PLINTH,
    bottomHex: MAG_PLINTH,
  });
  ctx.emitRingWalls(ctx.ring, H * 0.14, H * 0.68, {
    plinth: false,
    shop: false,
    cornice: true,
    doors: false,
    windows: false,
    hex: MAG_STONE,
    bottomHex: MAG_STONE,
  });
  emitGlassSlots(ctx, ctx.ring, H * 0.32, H * 0.14, 0x3a5470, 8);
  ctx.emitRingWalls(ctx.ring, H * 0.68, H, {
    plinth: false,
    shop: false,
    cornice: false,
    doors: false,
    windows: false,
    hex: MAG_MANSARD,
    bottomHex: MAG_MANSARD,
  });
}

export type StreetRoofEmit = {
  ring: StreetPt[];
  plan: PlanMetrics;
  heightWorld: number;
  emitRoof: (ring: StreetPt[], yAt: (p: StreetPt) => number, hex: number) => void;
  insetRing: (ring: StreetPt[], cx: number, cz: number, scale: number) => StreetPt[];
  pushBox: StreetEmit['pushBox'];
};

export function emitStreetUniqueRoofs(kind: StreetUniqueId, ctx: StreetRoofEmit): void {
  const H = ctx.heightWorld;
  const { cx, cz } = ctx.plan;
  if (kind === 'no-1-poultry') {
    ctx.emitRoof(ctx.ring, () => H, POULTRY_ROOF);
    const pent = ctx.insetRing(ctx.ring, cx, cz, 0.55);
    ctx.emitRoof(pent, () => H + 4.8 * METERS_TO_WORLD, POULTRY_BUFF);
    const apex = ctx.ring[ctx.plan.apexIndex] ?? { x: cx, z: cz };
    ctx.pushBox(
      apex.x,
      H * 1.38,
      apex.z,
      3.2 * METERS_TO_WORLD,
      3.6 * METERS_TO_WORLD,
      3.2 * METERS_TO_WORLD,
      POULTRY_BUFF,
    );
    return;
  }
  if (kind === 'the-ned') {
    ctx.emitRoof(
      ctx.ring,
      (p) => {
        const d = Math.hypot(p.x - cx, p.z - cz);
        let maxD = 1e-6;
        for (const q of ctx.ring) maxD = Math.max(maxD, Math.hypot(q.x - cx, q.z - cz));
        return H + 6.2 * METERS_TO_WORLD * (1 - Math.min(1, d / maxD));
      },
      NED_MANSARD,
    );
    return;
  }
  if (kind === 'walbrook') {
    ctx.emitRoof(ctx.ring, () => H, WALBROOK_STONE);
    const drum = ctx.insetRing(ctx.ring, cx, cz, 0.42);
    ctx.emitRoof(drum, () => H + 3.2 * METERS_TO_WORLD, WALBROOK_DRUM);
    const domeR = Math.min(ctx.plan.maxAlongM, ctx.plan.maxPerpM) * 0.55 * METERS_TO_WORLD;
    ctx.pushBox(
      cx,
      H + 3.2 * METERS_TO_WORLD,
      cz,
      domeR * 1.6,
      domeR * 0.85,
      domeR * 1.6,
      WALBROOK_DOME,
    );
    ctx.pushBox(
      cx,
      H + 3.2 * METERS_TO_WORLD + domeR * 0.85,
      cz,
      domeR * 0.35,
      2.8 * METERS_TO_WORLD,
      domeR * 0.35,
      WALBROOK_DRUM,
    );
    return;
  }
  ctx.emitRoof(
    ctx.ring,
    (p) => {
      const d = Math.hypot(p.x - cx, p.z - cz);
      let maxD = 1e-6;
      for (const q of ctx.ring) maxD = Math.max(maxD, Math.hypot(q.x - cx, q.z - cz));
      return H * 0.68 + (H * 0.32 + 4.2 * METERS_TO_WORLD) * (1 - Math.min(1, d / maxD));
    },
    MAG_MANSARD,
  );
}
