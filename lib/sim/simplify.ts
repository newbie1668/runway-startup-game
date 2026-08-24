import type { LngLat } from './types';

function perpendicularDistance(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return Math.hypot(ex, ey);
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker. Keeps the first/last vertex (required for closed rings). */
export function simplifyLine(points: LngLat[], tolerance: number): LngLat[] {
  if (points.length <= 4) return points;
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      index = i;
      maxDist = dist;
    }
  }
  if (maxDist <= tolerance) return [points[0], points[end]];
  const left = simplifyLine(points.slice(0, index + 1), tolerance);
  const right = simplifyLine(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

export function simplifyRing(ring: LngLat[], tolerance: number): LngLat[] {
  if (ring.length <= 6) return ring;
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  const simplified = simplifyLine(open.concat([open[0]]), tolerance);
  if (simplified.length < 4) return ring;
  const last = simplified[simplified.length - 1];
  if (last[0] !== simplified[0][0] || last[1] !== simplified[0][1]) {
    simplified.push(simplified[0]);
  }
  return simplified;
}

export function samePoint(a: LngLat, b: LngLat, eps = 1e-10): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

export function closeRing(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return ring;
  if (samePoint(ring[0], ring[ring.length - 1])) return ring;
  return ring.concat([ring[0]]);
}

export function uniqueRing(ring: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (!prev || !samePoint(prev, p)) out.push(p);
  }
  return closeRing(out);
}
