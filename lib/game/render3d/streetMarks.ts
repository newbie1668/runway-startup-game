import type { CoverSequence } from './coverSequence';
/**
 * Dashed centre-line math for SFSIM-style roads.
 * Pure TS (no DOM / three.js) so tests and the city builder share it.
 */

import { METERS_TO_WORLD } from '../geo';

export const DASH_LENGTH_M = 4.4;
export const DASH_GAP_M = 3.6;
export const DASH_WIDTH_M = 0.55;
/** Crisp kerb-edge stripes, slightly thinner than the centre dashes. */
export const EDGE_WIDTH_M = 0.22;

export interface PolyPoint {
  x: number;
  z: number;
}

export interface DashSeg {
  a: PolyPoint;
  b: PolyPoint;
}

/**
 * Walk a polyline and emit dash segments in world units.
 * Short crumbs (< 0.4 m) are dropped so hairline dashes don't sparkle.
 */
export function polylineDashes(
  pts: readonly PolyPoint[],
  dashM = DASH_LENGTH_M,
  gapM = DASH_GAP_M,
): DashSeg[] {
  const iterator = polylineDashSteps(pts, dashM, gapM);
  let result = iterator.next();
  while (!result.done) result = iterator.next();
  return result.value;
}

export function* polylineDashSteps(
  pts: readonly PolyPoint[],
  dashM = DASH_LENGTH_M,
  gapM = DASH_GAP_M,
): Generator<void, DashSeg[]> {
  const out: DashSeg[] = [];
  yield* visitPolylineDashSteps(
    pts,
    (dash) => {
      out.push(dash);
    },
    dashM,
    gapM,
  );
  return out;
}

export function* visitPolylineDashSteps(
  pts: CoverSequence<PolyPoint>,
  visit: (dash: DashSeg) => void,
  dashM = DASH_LENGTH_M,
  gapM = DASH_GAP_M,
): Generator<void> {
  if (pts.length < 2) return;
  const dashW = dashM * METERS_TO_WORLD;
  const gapW = gapM * METERS_TO_WORLD;
  const period = dashW + gapW;
  if (period <= 1e-6) return;
  const minLen = 0.4 * METERS_TO_WORLD;
  let inDash = true;
  let remain = dashW;
  for (let i = 0; i < pts.length - 1; i++) {
    yield;
    const a = pts.at(i)!;
    const b = pts.at(i + 1)!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    let local = 0;
    while (local < len) {
      yield;
      if (remain <= 1e-9) {
        inDash = !inDash;
        remain = inDash ? dashW : gapW;
        continue;
      }
      const take = Math.min(remain, len - local);
      if (inDash && take >= minLen) {
        visit({
          a: { x: a.x + ux * local, z: a.z + uz * local },
          b: { x: a.x + ux * (local + take), z: a.z + uz * (local + take) },
        });
        yield;
      }
      local += take;
      remain -= take;
    }
  }
}

/**
 * Parallel copies of segment AB, inset toward the carriageway centre by
 * `inset` world units. Used for white edge lines along both kerbs.
 */
export function segmentEdgeOffsets(
  a: PolyPoint,
  b: PolyPoint,
  inset: number,
): { left: [PolyPoint, PolyPoint]; right: [PolyPoint, PolyPoint] } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * inset;
  const pz = (dx / len) * inset;
  return {
    left: [
      { x: a.x + px, z: a.z + pz },
      { x: b.x + px, z: b.z + pz },
    ],
    right: [
      { x: a.x - px, z: a.z - pz },
      { x: b.x - px, z: b.z - pz },
    ],
  };
}
