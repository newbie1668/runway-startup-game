import type { BoundsXZ } from './cityIndex';

export type CoverPoint = { x: number; z: number };

export function clipCoverPolygon(
  polygon: readonly CoverPoint[],
  bounds: BoundsXZ | null,
): readonly CoverPoint[] {
  if (!bounds) return polygon;
  let points: readonly CoverPoint[] = polygon;
  for (const [axis, edge, sign] of [
    ['x', bounds.minX, 1],
    ['x', bounds.maxX, -1],
    ['z', bounds.minZ, 1],
    ['z', bounds.maxZ, -1],
  ] as const) {
    const next: CoverPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!;
      const aIn = (a[axis] - edge) * sign >= 0;
      const bIn = (b[axis] - edge) * sign >= 0;
      if (aIn) next.push(a);
      if (aIn !== bIn) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        next.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    points = next;
  }
  return points;
}

/**
 * Convex pieces of `polygon` inside `bounds`, in fan order. Folded ribbons are
 * clipped per fan triangle so a self-overlapping quad never loses coverage.
 * Each piece has at most `polygon.length + 4` points.
 */
export function* clippedCoverPieces(
  polygon: readonly CoverPoint[],
  bounds: BoundsXZ | null,
): Generator<readonly CoverPoint[], void> {
  if (bounds && polygon.length > 3) {
    for (let i = 1; i < polygon.length - 1; i++) {
      yield* clippedCoverPieces([polygon[0]!, polygon[i]!, polygon[i + 1]!], bounds);
    }
    return;
  }
  const clipped = clipCoverPolygon(polygon, bounds);
  if (clipped.length >= 3) yield clipped;
}
