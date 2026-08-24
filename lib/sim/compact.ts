import { OSM_ORIGIN } from './constants';
import { projectLngLat, type Vec2 } from './projection';
import type { LngLat } from './types';

export const COMPACT_MAGIC = 0x53494d31; // 'SIM1'
export const COMPACT_QUANT_M = 0.25;
export const COMPACT_MAX_BYTES = 10 * 1024 * 1024;
export const COMPACT_PUBLIC_PATH = '/sim/london.bin';
export const COMPACT_FILE = 'london.bin';

export const BUILDING_KIND_NAMES = [
  'yes',
  'house',
  'terrace',
  'residential',
  'apartments',
  'office',
  'commercial',
  'retail',
  'industrial',
  'warehouse',
  'church',
  'cathedral',
  'chimney',
  'tower',
  'school',
  'hospital',
  'hotel',
  'civic',
] as const;

export type BuildingKindName = (typeof BUILDING_KIND_NAMES)[number];

const KIND_INDEX = new Map<string, number>(BUILDING_KIND_NAMES.map((name, i) => [name, i]));

export function buildingKindIndex(building: string): number {
  return KIND_INDEX.get(building) ?? 0;
}

export interface PackedBuilding {
  height: number;
  minHeight: number;
  kind: number;
  outer: Vec2[];
  name?: string;
}

export interface PackedRoad {
  width: number;
  /** 0 other, 1 pedestrian, 2 motorway/trunk */
  kind: number;
  points: Vec2[];
}

export interface PackedCover {
  kind: 'park' | 'water';
  outer: Vec2[];
}

export interface PackedCity {
  originLng: number;
  originLat: number;
  quant: number;
  buildings: PackedBuilding[];
  roads: PackedRoad[];
  cover: PackedCover[];
}

class Bytes {
  buf: Uint8Array;
  view: DataView;
  offset = 0;

  constructor(size = 8_000_000) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  private grow(need: number) {
    if (this.offset + need <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.offset + need));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(n: number) {
    this.grow(1);
    this.view.setUint8(this.offset, n);
    this.offset += 1;
  }

  u16(n: number) {
    this.grow(2);
    this.view.setUint16(this.offset, n, true);
    this.offset += 2;
  }

  u32(n: number) {
    this.grow(4);
    this.view.setUint32(this.offset, n, true);
    this.offset += 4;
  }

  i16(n: number) {
    this.grow(2);
    this.view.setInt16(this.offset, n, true);
    this.offset += 2;
  }

  f32(n: number) {
    this.grow(4);
    this.view.setFloat32(this.offset, n, true);
    this.offset += 4;
  }

  bytes(data: Uint8Array) {
    this.grow(data.length);
    this.buf.set(data, this.offset);
    this.offset += data.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.offset);
  }
}

export function quantizeXZ(
  x: number,
  z: number,
  quant = COMPACT_QUANT_M,
): { qx: number; qz: number } {
  const qx = Math.max(-32767, Math.min(32767, Math.round(x / quant)));
  const qz = Math.max(-32767, Math.min(32767, Math.round(z / quant)));
  return { qx, qz };
}

export function dequantizeXZ(qx: number, qz: number, quant = COMPACT_QUANT_M): Vec2 {
  return { x: qx * quant, z: qz * quant };
}

export function packedRoadKind(highway: string): number {
  if (highway === 'pedestrian') return 1;
  if (highway.startsWith('motorway') || highway.startsWith('trunk')) return 2;
  return 0;
}

export function openRing(points: Vec2[]): Vec2[] {
  if (points.length >= 2) {
    const a = points[0];
    const b = points[points.length - 1];
    if (a.x === b.x && a.z === b.z) return points.slice(0, -1);
  }
  return points;
}

export function dedupeRing(points: Vec2[], quant = COMPACT_QUANT_M): Vec2[] {
  const out: Vec2[] = [];
  let lastQx: number | null = null;
  let lastQz: number | null = null;
  for (const p of points) {
    const q = quantizeXZ(p.x, p.z, quant);
    if (q.qx === lastQx && q.qz === lastQz) continue;
    lastQx = q.qx;
    lastQz = q.qz;
    out.push(dequantizeXZ(q.qx, q.qz, quant));
  }
  if (out.length >= 2) {
    const a = quantizeXZ(out[0].x, out[0].z, quant);
    const b = quantizeXZ(out[out.length - 1].x, out[out.length - 1].z, quant);
    if (a.qx === b.qx && a.qz === b.qz) out.pop();
  }
  return out;
}

export function preparePackedRing(
  ring: LngLat[],
  maxVerts: number,
  quant = COMPACT_QUANT_M,
): Vec2[] {
  return dedupeRing(openRing(projectOuter(capRing(ring, maxVerts))), quant);
}

export function capRing(ring: LngLat[], maxVerts: number): LngLat[] {
  if (ring.length <= maxVerts) return ring;
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length <= maxVerts - 1) return closed ? open.concat([open[0]]) : open;
  const keep = Math.max(3, maxVerts - 1);
  const out: LngLat[] = [];
  for (let i = 0; i < keep; i++) {
    const idx = Math.round((i * (open.length - 1)) / (keep - 1));
    out.push(open[idx]);
  }
  if (closed) out.push(out[0]);
  return out;
}

export function packCity(city: PackedCity): Uint8Array {
  const out = new Bytes();
  out.u32(COMPACT_MAGIC);
  out.f32(city.originLng);
  out.f32(city.originLat);
  out.f32(city.quant);
  out.u32(city.buildings.length);
  out.u32(city.roads.length);
  out.u32(city.cover.length);

  const names: { index: number; name: string }[] = [];

  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    out.u16(Math.max(0, Math.min(65535, Math.round(b.height * 10))));
    out.u16(Math.max(0, Math.min(65535, Math.round(b.minHeight * 10))));
    out.u8(b.kind);
    const n = Math.min(255, b.outer.length);
    out.u8(n);
    for (let v = 0; v < n; v++) {
      const q = quantizeXZ(b.outer[v].x, b.outer[v].z, city.quant);
      out.i16(q.qx);
      out.i16(q.qz);
    }
    if (b.name) names.push({ index: i, name: b.name.slice(0, 80) });
  }

  for (const road of city.roads) {
    out.u8(Math.max(1, Math.min(255, Math.round(road.width))));
    out.u8(road.kind);
    const n = Math.min(255, road.points.length);
    out.u8(n);
    for (let v = 0; v < n; v++) {
      const q = quantizeXZ(road.points[v].x, road.points[v].z, city.quant);
      out.i16(q.qx);
      out.i16(q.qz);
    }
  }

  for (const cover of city.cover) {
    out.u8(cover.kind === 'water' ? 2 : 1);
    const n = Math.min(65535, cover.outer.length);
    out.u16(n);
    for (let v = 0; v < n; v++) {
      const q = quantizeXZ(cover.outer[v].x, cover.outer[v].z, city.quant);
      out.i16(q.qx);
      out.i16(q.qz);
    }
  }

  out.u32(names.length);
  const enc = new TextEncoder();
  for (const row of names) {
    const bytes = enc.encode(row.name);
    out.u32(row.index);
    out.u8(Math.min(255, bytes.length));
    out.bytes(bytes.subarray(0, 255));
  }

  return out.finish();
}

export function unpackCity(buffer: ArrayBuffer | Uint8Array): PackedCity {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const magic = view.getUint32(o, true);
  o += 4;
  if (magic !== COMPACT_MAGIC) throw new Error('Not a SIM1 London mesh');
  const originLng = view.getFloat32(o, true);
  o += 4;
  const originLat = view.getFloat32(o, true);
  o += 4;
  const quant = view.getFloat32(o, true);
  o += 4;
  const buildingCount = view.getUint32(o, true);
  o += 4;
  const roadCount = view.getUint32(o, true);
  o += 4;
  const coverCount = view.getUint32(o, true);
  o += 4;

  const buildings: PackedBuilding[] = [];
  for (let i = 0; i < buildingCount; i++) {
    const height = view.getUint16(o, true) / 10;
    o += 2;
    const minHeight = view.getUint16(o, true) / 10;
    o += 2;
    const kind = view.getUint8(o);
    o += 1;
    const n = view.getUint8(o);
    o += 1;
    const outer: Vec2[] = [];
    for (let v = 0; v < n; v++) {
      const qx = view.getInt16(o, true);
      o += 2;
      const qz = view.getInt16(o, true);
      o += 2;
      outer.push(dequantizeXZ(qx, qz, quant));
    }
    buildings.push({ height, minHeight, kind, outer });
  }

  const roads: PackedRoad[] = [];
  for (let i = 0; i < roadCount; i++) {
    const width = view.getUint8(o);
    o += 1;
    const kind = view.getUint8(o);
    o += 1;
    const n = view.getUint8(o);
    o += 1;
    const points: Vec2[] = [];
    for (let v = 0; v < n; v++) {
      const qx = view.getInt16(o, true);
      o += 2;
      const qz = view.getInt16(o, true);
      o += 2;
      points.push(dequantizeXZ(qx, qz, quant));
    }
    roads.push({ width, kind, points });
  }

  const cover: PackedCover[] = [];
  for (let i = 0; i < coverCount; i++) {
    const kind = view.getUint8(o) === 2 ? 'water' : 'park';
    o += 1;
    const n = view.getUint16(o, true);
    o += 2;
    const outer: Vec2[] = [];
    for (let v = 0; v < n; v++) {
      const qx = view.getInt16(o, true);
      o += 2;
      const qz = view.getInt16(o, true);
      o += 2;
      outer.push(dequantizeXZ(qx, qz, quant));
    }
    cover.push({ kind, outer });
  }

  const nameCount = view.getUint32(o, true);
  o += 4;
  const dec = new TextDecoder();
  for (let i = 0; i < nameCount; i++) {
    const index = view.getUint32(o, true);
    o += 4;
    const len = view.getUint8(o);
    o += 1;
    const name = dec.decode(bytes.subarray(o, o + len));
    o += len;
    if (buildings[index]) buildings[index].name = name;
  }

  return { originLng, originLat, quant, buildings, roads, cover };
}

export function projectOuter(ring: LngLat[]): Vec2[] {
  return ring.map(([lng, lat]) => projectLngLat(lng, lat));
}

export function packedOrigin(): { originLng: number; originLat: number } {
  return { originLng: OSM_ORIGIN.lng, originLat: OSM_ORIGIN.lat };
}
