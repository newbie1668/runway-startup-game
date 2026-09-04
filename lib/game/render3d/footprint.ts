/**
 * Footprint helpers for Kansas-style building massing.
 * Pure TS so tests can run without three.js.
 */

export interface RingPt {
  x: number;
  z: number;
}

/**
 * Replace each corner with two points cut `amount` along the incoming and
 * outgoing edges. Right angles become chamfers (the low-poly stand-in for
 * Kansas curved corners). Degenerate cuts fall back to the original vertex.
 */
export function chamferRing(ring: readonly RingPt[], amount: number): RingPt[] {
  const n = ring.length;
  if (n < 4 || amount <= 1e-8) return ring.map((p) => ({ x: p.x, z: p.z }));
  const out: RingPt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n]!;
    const curr = ring[i]!;
    const next = ring[(i + 1) % n]!;
    const inLen = Math.hypot(curr.x - prev.x, curr.z - prev.z);
    const outLen = Math.hypot(next.x - curr.x, next.z - curr.z);
    const cut = Math.min(amount, inLen * 0.32, outLen * 0.32);
    if (cut < amount * 0.25 || inLen < 1e-8 || outLen < 1e-8) {
      out.push({ x: curr.x, z: curr.z });
      continue;
    }
    out.push({
      x: curr.x - ((curr.x - prev.x) / inLen) * cut,
      z: curr.z - ((curr.z - prev.z) / inLen) * cut,
    });
    out.push({
      x: curr.x + ((next.x - curr.x) / outLen) * cut,
      z: curr.z + ((next.z - curr.z) / outLen) * cut,
    });
  }
  return out;
}

/**
 * Wedding-cake inset: scale the ring toward its centroid so each edge pulls
 * in by about `worldInset`. Skinny footprints clamp so the ring cannot invert.
 */
export function insetRingTowardCentroid(
  ring: readonly RingPt[],
  cx: number,
  cz: number,
  worldInset: number,
): RingPt[] {
  if (worldInset <= 1e-8) return ring.map((p) => ({ x: p.x, z: p.z }));
  let minR = Infinity;
  for (const p of ring) {
    const r = Math.hypot(p.x - cx, p.z - cz);
    if (r < minR) minR = r;
  }
  if (!(minR > 1e-8)) return ring.map((p) => ({ x: p.x, z: p.z }));
  const scale = Math.max(0.58, 1 - worldInset / minR);
  return ring.map((p) => ({
    x: cx + (p.x - cx) * scale,
    z: cz + (p.z - cz) * scale,
  }));
}

/** Hyatt-style terraces: shrink the plan toward a stand-out vertex. */
export function scaleToward(
  ring: readonly RingPt[],
  px: number,
  pz: number,
  scale: number,
): RingPt[] {
  return ring.map((p) => ({
    x: px + (p.x - px) * scale,
    z: pz + (p.z - pz) * scale,
  }));
}

function cross(o: RingPt, a: RingPt, b: RingPt): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

/** Monotone-chain convex hull. Needed to find courtyard notches. */
export function convexHull(ring: readonly RingPt[]): RingPt[] {
  if (ring.length < 3) return ring.map((p) => ({ x: p.x, z: p.z }));
  const pts = ring.map((p) => ({ x: p.x, z: p.z })).sort((a, b) => a.x - b.x || a.z - b.z);
  const lower: RingPt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: RingPt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function distToSegmentM(p: RingPt, a: RingPt, b: RingPt, metersToWorld: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-16) return Math.hypot(p.x - a.x, p.z - a.z) / metersToWorld;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) / metersToWorld;
}

/** Deepest courtyard bite: metres from a hull edge to the farthest interior vertex. */
export function hullNotchDepthM(
  ring: readonly RingPt[],
  hull: readonly RingPt[],
  metersToWorld: number,
): number {
  if (hull.length < 3 || ring.length < 4) return 0;
  let maxD = 0;
  for (const p of ring) {
    let minEdge = Infinity;
    for (let i = 0; i < hull.length; i++) {
      const d = distToSegmentM(p, hull[i]!, hull[(i + 1) % hull.length]!, metersToWorld);
      if (d < minEdge) minEdge = d;
    }
    if (minEdge > maxD) maxD = minEdge;
  }
  return maxD;
}
