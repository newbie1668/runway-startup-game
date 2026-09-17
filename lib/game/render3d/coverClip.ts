import type { BoundsXZ } from './cityIndex';

export type CoverPoint = { x: number; z: number };

export function clipCoverPolygon(polygon: CoverPoint[], bounds: BoundsXZ | null): CoverPoint[] {
  if (!bounds) return polygon;
  let points = polygon;
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

export function appendCoverPolygon(
  positions: number[],
  indices: number[],
  polygon: CoverPoint[],
  y: number,
  bounds: BoundsXZ | null,
): number {
  const clipped = clipCoverPolygon(polygon, bounds);
  if (clipped.length < 3) return 0;
  const base = positions.length / 3;
  for (const point of clipped) positions.push(point.x, y, point.z);
  for (let i = 1; i < clipped.length - 1; i++) indices.push(base, base + i, base + i + 1);
  return clipped.length;
}
