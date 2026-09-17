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

export function* pointInRingSteps(
  x: number,
  z: number,
  ring: WaterPoint[],
): Generator<void, boolean> {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x,
      zi = ring[i]!.z,
      xj = ring[j]!.x,
      zj = ring[j]!.z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
    yield;
  }
  return inside;
}

export function* pointOverWaterSteps(
  x: number,
  z: number,
  rings: WaterRing[],
): Generator<void, boolean> {
  for (const ring of rings) {
    yield;
    if (z < ring.minZ || z > ring.maxZ || x < ring.minX || x > ring.maxX) continue;
    if (yield* pointInRingSteps(x, z, ring.points)) return true;
  }
  return false;
}

const incrementalRings = new WeakMap<CityData, WaterRing[]>();

export function* waterRingsSteps(cityData: CityData): Generator<void, WaterRing[]> {
  const cached = incrementalRings.get(cityData);
  if (cached) return cached;
  const rings: WaterRing[] = [];
  for (const poly of cityData.water) {
    const points: WaterPoint[] = [];
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < poly.verts.length; i += 2) {
      const x = dequantizeX(poly.verts[i]!),
        z = dequantizeY(poly.verts[i + 1]!);
      points.push({ x, z });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      yield;
    }
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i]!.x,
        zi = points[i]!.z,
        xj = points[j]!.x,
        zj = points[j]!.z;
      const d = zj - zi,
        denom = d + 1e-12;
      const atI = ((xj - xi) * (zi - zi)) / denom + xi;
      const atJ = ((xj - xi) * (zj - zi)) / denom + xi;
      if (
        !Number.isFinite(d) ||
        !Number.isFinite(denom) ||
        denom === 0 ||
        !Number.isFinite(atI) ||
        !Number.isFinite(atJ)
      ) {
        minX = -Infinity;
        maxX = Infinity;
        break;
      }
      minX = Math.min(minX, atI, atJ);
      maxX = Math.max(maxX, atI, atJ);
      yield;
    }
    if (Number.isFinite(minX) && Number.isFinite(maxX)) {
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(minX), Math.abs(maxX)) * 8;
      minX -= tolerance;
      maxX += tolerance;
    }
    rings.push({ points, minX, maxX, minZ, maxZ });
    yield;
  }
  incrementalRings.set(cityData, rings);
  return rings;
}
