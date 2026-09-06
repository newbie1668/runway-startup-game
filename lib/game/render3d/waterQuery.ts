import type { CityData } from './format';
import { dequantizeX, dequantizeY } from './format';

export type WaterPoint = { x: number; z: number };

export type WaterRing = {
  points: WaterPoint[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function pointInRing(x: number, z: number, ring: WaterPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const zi = ring[i]!.z;
    const xj = ring[j]!.x;
    const zj = ring[j]!.z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function ringBounds(points: WaterPoint[]): Omit<WaterRing, 'points'> {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  // The predicate's 1e-12 denominator bias creates a tiny reachable sliver
  // beyond a vertex extremum. Include both historic edge endpoints so the
  // broad phase cannot reject that sliver before the unchanged ray test.
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i]!.x;
    const zi = points[i]!.z;
    const xj = points[j]!.x;
    const zj = points[j]!.z;
    const d = zj - zi;
    const denom = d + 1e-12;
    if (!Number.isFinite(d) || !Number.isFinite(denom) || denom === 0) {
      return { minX: -Infinity, maxX: Infinity, minZ, maxZ };
    }
    const atI = ((xj - xi) * (zi - zi)) / denom + xi;
    const atJ = ((xj - xi) * (zj - zi)) / denom + xi;
    if (!Number.isFinite(atI) || !Number.isFinite(atJ)) {
      return { minX: -Infinity, maxX: Infinity, minZ, maxZ };
    }
    minX = Math.min(minX, atI, atJ);
    maxX = Math.max(maxX, atI, atJ);
  }
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(minX), Math.abs(maxX)) * 8;
  return { minX: minX - tolerance, maxX: maxX + tolerance, minZ, maxZ };
}

export function waterRings(cityData: CityData): WaterRing[] {
  return cityData.water.map((poly) => {
    const n = poly.verts.length / 2;
    const points = new Array<WaterPoint>(n);
    for (let i = 0; i < n; i++) {
      points[i] = { x: dequantizeX(poly.verts[i * 2]!), z: dequantizeY(poly.verts[i * 2 + 1]!) };
    }
    return { points, ...ringBounds(points) };
  });
}

export function pointOverWater(x: number, z: number, rings: WaterRing[]): boolean {
  for (const ring of rings) {
    if (z < ring.minZ || z > ring.maxZ || x < ring.minX || x > ring.maxX) continue;
    if (pointInRing(x, z, ring.points)) return true;
  }
  return false;
}
