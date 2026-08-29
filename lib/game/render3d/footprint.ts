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
