import { METERS_PER_DEGREE_LAT, METERS_PER_DEGREE_LNG, OSM_ORIGIN } from './constants';

export interface Vec2 {
  x: number;
  z: number;
}

/** Project WGS84 lon/lat into local metres. +X east, +Z north, origin at bbox centre. */
export function projectLngLat(lng: number, lat: number): Vec2 {
  return {
    x: (lng - OSM_ORIGIN.lng) * METERS_PER_DEGREE_LNG,
    z: (lat - OSM_ORIGIN.lat) * METERS_PER_DEGREE_LAT,
  };
}

export function unprojectXZ(x: number, z: number): { lng: number; lat: number } {
  return {
    lng: OSM_ORIGIN.lng + x / METERS_PER_DEGREE_LNG,
    lat: OSM_ORIGIN.lat + z / METERS_PER_DEGREE_LAT,
  };
}

export function roundCoord(n: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function ringAreaM2(ring: ReadonlyArray<readonly [number, number]>): number {
  if (ring.length < 4) return 0;
  let acc = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = projectLngLat(ring[i][0], ring[i][1]);
    const b = projectLngLat(ring[i + 1][0], ring[i + 1][1]);
    acc += a.x * b.z - b.x * a.z;
  }
  return Math.abs(acc) / 2;
}

export function signedAreaXZ(points: readonly Vec2[]): number {
  let acc = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    acc += a.x * b.z - b.x * a.z;
  }
  return acc / 2;
}
