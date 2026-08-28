/**
 * Dashed centre-line math for SFSIM-style roads.
 * Pure TS (no DOM / three.js) so tests and the city builder share it.
 */

import { METERS_TO_WORLD } from '../geo';

export const DASH_LENGTH_M = 4.4;
export const DASH_GAP_M = 3.6;
export const DASH_WIDTH_M = 0.55;

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
  if (pts.length < 2) return [];
  const dashW = dashM * METERS_TO_WORLD;
  const gapW = gapM * METERS_TO_WORLD;
  const period = dashW + gapW;
  if (period <= 1e-6) return [];
  const minLen = 0.4 * METERS_TO_WORLD;
  const out: DashSeg[] = [];
  let inDash = true;
  let remain = dashW;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    let local = 0;
    while (local < len) {
      if (remain <= 1e-9) {
        inDash = !inDash;
        remain = inDash ? dashW : gapW;
        continue;
      }
      const take = Math.min(remain, len - local);
      if (inDash && take >= minLen) {
        out.push({
          a: { x: a.x + ux * local, z: a.z + uz * local },
          b: { x: a.x + ux * (local + take), z: a.z + uz * (local + take) },
        });
      }
      local += take;
      remain -= take;
    }
  }
  return out;
}
