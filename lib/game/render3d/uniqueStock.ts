/**
 * Unique stock massing from THIS footprint.
 *
 * Kansas: each noticed building is a stand-out mesh, not a type costume.
 * Playtime stays offline. The plan comes from the baked OSM ring; silhouette
 * numbers are continuous measures of that ring (apex, notch, aspect), not
 * style + seed % N picking setback vs mansard.
 */

import {
  ROOF_HIPPED,
  STYLE_APARTMENTS,
  STYLE_HOUSE,
  STYLE_INDUSTRIAL,
  STYLE_OFFICE,
  STYLE_RETAIL,
  STYLE_TERRACE,
  STYLE_TOWER,
} from './buildingStyle';
import { convexHull, hullNotchDepthM, type RingPt } from './footprint';

export type UniqueSilhouette =
  | {
      kind: 'wedge-step';
      apexIndex: number;
      steps: number;
      scales: number[];
      t1: number[];
    }
  | { kind: 'courtyard'; wellT: number; wellInsetM: number }
  | { kind: 'ell'; tBreak: number; shortScale: number }
  | { kind: 'bar-ridge'; riseM: number }
  | { kind: 'disk'; bands: number; scales: number[] }
  | { kind: 'asymmetric-setback'; tBreaks: number[]; insetsM: number[] }
  | { kind: 'gable-row'; bays: number }
  | { kind: 'sawtooth'; teeth: number }
  | { kind: 'mansard-plate'; eavesT: number };

export type UniqueFacade =
  | { kind: 'ribbon'; floors: number; bandRatio: number }
  | {
      kind: 'recess';
      pitchU: number;
      pitchV: number;
      colCap: number;
      rowCap: number;
      bakeCap: number;
    }
  | { kind: 'piers'; pitchM: number; depthM: number }
  | { kind: 'bays' }
  | { kind: 'colonnade'; count: number };

export type UniqueRoof =
  | { kind: 'steps' }
  | { kind: 'hip' }
  | { kind: 'gable' }
  | { kind: 'mansard' }
  | { kind: 'barrel' }
  | { kind: 'parapet'; lipM: number };

export type UniquePlant = {
  along: number;
  perp: number;
  wM: number;
  dM: number;
  hM: number;
};

export type UniqueTurret = { vertexIndex: number; rM: number; hFrac: number };

export type UniqueStockRecipe = {
  silhouette: UniqueSilhouette;
  facade: UniqueFacade;
  roof: UniqueRoof;
  plant: UniquePlant | null;
  turret: UniqueTurret | null;
};

export type PlanMetrics = {
  n: number;
  cx: number;
  cz: number;
  areaM2: number;
  perimeterM: number;
  compactness: number;
  aspect: number;
  circularity: number;
  minAngleDeg: number;
  apexIndex: number;
  reflexCount: number;
  notchDepthM: number;
  longestEdgeM: number;
  longestEdgeIndex: number;
  minRM: number;
  maxAlongM: number;
  maxPerpM: number;
  ax: number;
  az: number;
  px: number;
  pz: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function signedArea(ring: readonly RingPt[]): number {
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    acc += a.x * b.z - b.x * a.z;
  }
  return acc / 2;
}

export function analyzeFootprint(ring: readonly RingPt[], metersToWorld: number): PlanMetrics {
  const n = ring.length;
  let cx = 0;
  let cz = 0;
  for (const p of ring) {
    cx += p.x;
    cz += p.z;
  }
  cx /= Math.max(1, n);
  cz /= Math.max(1, n);

  const areaWorld = Math.abs(signedArea(ring));
  const areaM2 = areaWorld / (metersToWorld * metersToWorld);
  const ccw = signedArea(ring) > 0;

  let perimeter = 0;
  let minAngleDeg = 180;
  let apexIndex = 0;
  let reflexCount = 0;
  let longestEdgeM = 0;
  let longestEdgeIndex = 0;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n]!;
    const curr = ring[i]!;
    const next = ring[(i + 1) % n]!;
    const inx = curr.x - prev.x;
    const inz = curr.z - prev.z;
    const outx = next.x - curr.x;
    const outz = next.z - curr.z;
    const edgeM = Math.hypot(outx, outz) / metersToWorld;
    perimeter += Math.hypot(outx, outz);
    if (edgeM > longestEdgeM) {
      longestEdgeM = edgeM;
      longestEdgeIndex = i;
    }
    const cross = inx * outz - inz * outx;
    const dot = inx * outx + inz * outz;
    const turn = Math.atan2(ccw ? cross : -cross, dot);
    const interiorDeg = ((Math.PI - turn) * 180) / Math.PI;
    if (interiorDeg < minAngleDeg) {
      minAngleDeg = interiorDeg;
      apexIndex = i;
    }
    if (interiorDeg > 185) reflexCount += 1;
  }
  const perimeterM = perimeter / metersToWorld;
  const compactness = perimeterM > 1e-6 ? (4 * Math.PI * areaM2) / (perimeterM * perimeterM) : 0;

  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  let minR = Infinity;
  const radii: number[] = [];
  for (const p of ring) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    cxx += dx * dx;
    czz += dz * dz;
    cxz += dx * dz;
    const r = Math.hypot(dx, dz);
    radii.push(r);
    if (r < minR) minR = r;
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
  const alen = Math.hypot(ax, az) || 1;
  ax /= alen;
  az /= alen;
  const px = -az;
  const pz = ax;
  let maxAlong = 1e-6;
  let maxPerp = 1e-6;
  for (const p of ring) {
    const along = Math.abs((p.x - cx) * ax + (p.z - cz) * az);
    const perp = Math.abs((p.x - cx) * px + (p.z - cz) * pz);
    if (along > maxAlong) maxAlong = along;
    if (perp > maxPerp) maxPerp = perp;
  }
  const aspect = maxAlong / Math.max(maxPerp, 1e-6);
  let meanR = 0;
  for (const r of radii) meanR += r;
  meanR /= Math.max(1, radii.length);
  let varR = 0;
  for (const r of radii) varR += (r - meanR) * (r - meanR);
  const stdR = Math.sqrt(varR / Math.max(1, radii.length));
  const circularity = meanR > 1e-8 ? 1 - Math.min(1, stdR / meanR) : 0;
  const hull = convexHull(ring);
  const notchDepthM = hullNotchDepthM(ring, hull, metersToWorld);

  return {
    n,
    cx,
    cz,
    areaM2,
    perimeterM,
    compactness,
    aspect,
    circularity,
    minAngleDeg,
    apexIndex,
    reflexCount,
    notchDepthM,
    longestEdgeM,
    longestEdgeIndex,
    minRM: minR / metersToWorld,
    maxAlongM: maxAlong / metersToWorld,
    maxPerpM: maxPerp / metersToWorld,
    ax,
    az,
    px,
    pz,
  };
}

function wedgeScales(steps: number, tip: number): { scales: number[]; t1: number[] } {
  const scales: number[] = [];
  const t1: number[] = [];
  for (let s = 0; s < steps; s++) {
    scales.push(1 - (s / Math.max(1, steps - 1)) * (1 - tip));
    t1.push((s + 1) / steps);
  }
  return { scales, t1 };
}

function pickSilhouette(input: {
  plan: PlanMetrics;
  heightM: number;
  style: number;
  osmRoof: number;
}): UniqueSilhouette {
  const { plan, heightM, style, osmRoof } = input;
  if (style === STYLE_INDUSTRIAL && plan.areaM2 >= 280) {
    return { kind: 'sawtooth', teeth: clamp(Math.round(plan.maxAlongM / 9), 3, 7) };
  }
  const housey =
    style === STYLE_HOUSE ||
    style === STYLE_TERRACE ||
    (style === STYLE_APARTMENTS && heightM <= 16);
  if (housey && heightM <= 18) {
    return {
      kind: 'gable-row',
      bays: clamp(Math.round(plan.longestEdgeM / 6.4), 1, 8),
    };
  }
  if (plan.circularity >= 0.84 && plan.compactness >= 0.76 && plan.n >= 6) {
    const bands = heightM >= 28 ? 4 : 3;
    const scales = Array.from({ length: bands }, (_, i) => 1 - (i / bands) * 0.48);
    return { kind: 'disk', bands, scales };
  }
  if (plan.minAngleDeg <= 72 && plan.compactness <= 0.7 && heightM >= 12 && plan.areaM2 >= 160) {
    const steps = heightM >= 36 ? 4 : heightM >= 22 ? 3 : 2;
    const tip = clamp(0.36 + plan.minAngleDeg / 400, 0.32, 0.52);
    const { scales, t1 } = wedgeScales(steps, tip);
    return { kind: 'wedge-step', apexIndex: plan.apexIndex, steps, scales, t1 };
  }
  if (plan.notchDepthM >= 7 && plan.reflexCount >= 2 && plan.areaM2 >= 260 && plan.n >= 6) {
    return {
      kind: 'courtyard',
      wellT: clamp(0.42 + plan.notchDepthM / 80, 0.38, 0.62),
      wellInsetM: clamp(plan.minRM * 0.38, 4.2, 14),
    };
  }
  if (
    plan.reflexCount >= 1 &&
    plan.n >= 6 &&
    plan.n <= 11 &&
    plan.notchDepthM >= 4 &&
    plan.aspect >= 1.3
  ) {
    return {
      kind: 'ell',
      tBreak: clamp(0.52 + plan.aspect * 0.04, 0.48, 0.72),
      shortScale: clamp(0.62 + plan.compactness * 0.2, 0.58, 0.82),
    };
  }
  if (plan.aspect >= 2.55 && heightM <= 28) {
    return { kind: 'bar-ridge', riseM: clamp(plan.maxPerpM * 0.55, 3.4, 11) };
  }
  if (
    (style === STYLE_OFFICE || style === STYLE_RETAIL || style === STYLE_APARTMENTS) &&
    heightM <= 18 &&
    (osmRoof === ROOF_HIPPED || plan.compactness >= 0.58)
  ) {
    return { kind: 'mansard-plate', eavesT: clamp(0.58 + plan.aspect * 0.03, 0.56, 0.74) };
  }
  if (
    (style === STYLE_OFFICE || style === STYLE_TOWER || style === STYLE_APARTMENTS) &&
    heightM >= 14
  ) {
    const t1 = clamp(0.32 + plan.longestEdgeM / 280, 0.28, 0.46);
    const t2 = clamp(0.58 + plan.aspect * 0.035, 0.54, 0.76);
    const inset1 = clamp(plan.minRM * 0.2, 2.4, 7.2);
    const inset2 = clamp(plan.minRM * 0.38, 4.2, 12);
    const three = heightM >= 28 && plan.areaM2 > 320;
    return {
      kind: 'asymmetric-setback',
      tBreaks: three ? [t1, t2, 1] : [t1, 1],
      insetsM: three ? [inset1, inset2] : [inset1],
    };
  }
  if (style === STYLE_RETAIL && heightM <= 14) {
    return { kind: 'mansard-plate', eavesT: 0.78 };
  }
  return {
    kind: 'gable-row',
    bays: clamp(Math.round(plan.longestEdgeM / 7), 1, 6),
  };
}

function pickFacade(input: {
  plan: PlanMetrics;
  heightM: number;
  style: number;
  silhouette: UniqueSilhouette;
}): UniqueFacade {
  const { plan, heightM, style, silhouette } = input;
  const floors = clamp(Math.round(heightM / 3.45), 2, 11);
  if (silhouette.kind === 'wedge-step' || silhouette.kind === 'disk') {
    return { kind: 'ribbon', floors, bandRatio: silhouette.kind === 'disk' ? 0.5 : 0.4 };
  }
  if (
    style === STYLE_HOUSE ||
    style === STYLE_TERRACE ||
    (style === STYLE_APARTMENTS && heightM <= 22)
  ) {
    return { kind: 'bays' };
  }
  if (plan.longestEdgeM >= 34 && heightM <= 20 && plan.compactness >= 0.4) {
    return { kind: 'colonnade', count: clamp(Math.round(plan.longestEdgeM / 5.5), 4, 12) };
  }
  if (
    heightM >= 24 &&
    plan.compactness >= 0.48 &&
    (style === STYLE_OFFICE || style === STYLE_TOWER)
  ) {
    return { kind: 'ribbon', floors, bandRatio: 0.44 };
  }
  if (plan.aspect >= 2.25 && heightM >= 12) {
    return {
      kind: 'piers',
      pitchM: clamp(plan.longestEdgeM / Math.max(4, Math.round(plan.longestEdgeM / 5.2)), 3.2, 6.4),
      depthM: clamp(1.1 + plan.maxPerpM * 0.04, 1.1, 2.2),
    };
  }
  return { kind: 'ribbon', floors, bandRatio: clamp(0.34 + plan.compactness * 0.12, 0.32, 0.5) };
}

function pickRoof(silhouette: UniqueSilhouette, osmRoof: number): UniqueRoof {
  switch (silhouette.kind) {
    case 'wedge-step':
      return { kind: 'steps' };
    case 'disk':
      return { kind: 'barrel' };
    case 'bar-ridge':
    case 'gable-row':
      return osmRoof === ROOF_HIPPED ? { kind: 'hip' } : { kind: 'gable' };
    case 'sawtooth':
      return { kind: 'parapet', lipM: 1.2 };
    case 'mansard-plate':
    case 'courtyard':
    case 'ell':
      return { kind: 'mansard' };
    case 'asymmetric-setback':
      return { kind: 'parapet', lipM: clamp(1.2 + silhouette.insetsM[0]! * 0.08, 1.2, 2.2) };
  }
  const _never: never = silhouette;
  return _never;
}

function pickPlant(
  plan: PlanMetrics,
  heightM: number,
  silhouette: UniqueSilhouette,
): UniquePlant | null {
  if (silhouette.kind === 'gable-row' || silhouette.kind === 'sawtooth') return null;
  if (heightM < 14 || plan.areaM2 < 140) return null;
  const along = clamp((plan.longestEdgeIndex / Math.max(1, plan.n)) * 1.6 - 0.8, -0.46, 0.46);
  const perp = clamp((plan.apexIndex / Math.max(1, plan.n)) * 1.2 - 0.6, -0.32, 0.32);
  return {
    along,
    perp,
    wM: clamp(Math.sqrt(plan.areaM2) * 0.14, 4.2, 16),
    dM: clamp(Math.sqrt(plan.areaM2) * 0.09, 3.2, 12),
    hM: clamp(heightM * 0.12, 3.2, 8.5),
  };
}

function pickTurret(
  plan: PlanMetrics,
  heightM: number,
  silhouette: UniqueSilhouette,
): UniqueTurret | null {
  if (plan.minAngleDeg >= 68 || heightM < 16) return null;
  if (silhouette.kind === 'gable-row' || silhouette.kind === 'sawtooth') return null;
  if (plan.n > 16) return null;
  return {
    vertexIndex: plan.apexIndex,
    rM: clamp(2.0 + (72 - plan.minAngleDeg) * 0.05, 1.8, 4.2),
    hFrac: clamp(0.16 + (72 - plan.minAngleDeg) / 400, 0.14, 0.28),
  };
}

export function uniqueStockRecipe(input: {
  plan: PlanMetrics;
  heightM: number;
  style: number;
  osmRoof: number;
}): UniqueStockRecipe {
  const silhouette = pickSilhouette(input);
  return {
    silhouette,
    facade: pickFacade({ ...input, silhouette }),
    roof: pickRoof(silhouette, input.osmRoof),
    plant: pickPlant(input.plan, input.heightM, silhouette),
    turret: pickTurret(input.plan, input.heightM, silhouette),
  };
}

/** Stable identity of THIS building's mesh language — tests assert streets don't clone. */
export function recipeFingerprint(recipe: UniqueStockRecipe): string {
  const s = recipe.silhouette;
  const f = recipe.facade;
  const sil =
    s.kind === 'wedge-step'
      ? `${s.kind}:${s.apexIndex}:${s.steps}:${s.scales.map((n) => n.toFixed(2)).join(',')}`
      : s.kind === 'courtyard'
        ? `${s.kind}:${s.wellT.toFixed(2)}:${s.wellInsetM.toFixed(1)}`
        : s.kind === 'ell'
          ? `${s.kind}:${s.tBreak.toFixed(2)}:${s.shortScale.toFixed(2)}`
          : s.kind === 'bar-ridge'
            ? `${s.kind}:${s.riseM.toFixed(1)}`
            : s.kind === 'disk'
              ? `${s.kind}:${s.bands}:${s.scales.map((n) => n.toFixed(2)).join(',')}`
              : s.kind === 'asymmetric-setback'
                ? `${s.kind}:${s.tBreaks.map((n) => n.toFixed(2)).join('/')}:${s.insetsM.map((n) => n.toFixed(1)).join(',')}`
                : s.kind === 'gable-row'
                  ? `${s.kind}:${s.bays}`
                  : s.kind === 'sawtooth'
                    ? `${s.kind}:${s.teeth}`
                    : `${s.kind}:${s.eavesT.toFixed(2)}`;
  const fac =
    f.kind === 'ribbon'
      ? `${f.kind}:${f.floors}:${f.bandRatio.toFixed(2)}`
      : f.kind === 'recess'
        ? `${f.kind}:${f.pitchU.toFixed(2)}x${f.pitchV.toFixed(2)}:${f.colCap}x${f.rowCap}`
        : f.kind === 'piers'
          ? `${f.kind}:${f.pitchM.toFixed(2)}:${f.depthM.toFixed(2)}`
          : f.kind === 'colonnade'
            ? `${f.kind}:${f.count}`
            : f.kind;
  const plant = recipe.plant
    ? `p${recipe.plant.along.toFixed(2)},${recipe.plant.wM.toFixed(1)}`
    : 'p0';
  return `${sil}|${fac}|${recipe.roof.kind}|${plant}`;
}
