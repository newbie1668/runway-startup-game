/**
 * RUNWAY — binary codec for the precomputed 3D city.
 *
 * Pure TS, no DOM: `scripts/fetch-geodata.ts` calls `encodeCity()` at build
 * time to produce `public/map/london-city.bin`; `CityRenderer3D` calls
 * `decodeCity()` at runtime to turn the fetched bytes back into typed data
 * `cityBuilder` can hand straight to BufferGeometry.
 *
 * All multi-byte fields are little-endian. Vertex coordinates are quantized
 * to uint16 over the WORLD rectangle (quantizeX/Y below) — sub-metre
 * precision, a fraction of the byte cost of float32.
 */

import { WORLD } from '../geo';

const MAGIC = 0x4c444e31; // 'LDN1'
const VERSION = 1;
const Q = 0xffff;

export interface CityBuilding {
  major: boolean;
  /** Height in metres, 3..255. */
  heightM: number;
  /** 8×6 chunk grid over WORLD, 0..47. */
  chunkId: number;
  /** [x0,y0, x1,y1, ...] quantized over WORLD — the roof footprint. */
  verts: Uint16Array;
  /** Roof triangle indices into `verts`, 3 per triangle. */
  indices: Uint8Array;
}

export interface CityRoad {
  /** 0 = motorway/trunk/primary, 1 = secondary/tertiary, 2 = rest. */
  tier: number;
  /** [x0,y0, x1,y1, ...] quantized over WORLD — the centreline. */
  pts: Uint16Array;
}

export interface CityPoly {
  /** [x0,y0, x1,y1, ...] quantized over WORLD. */
  verts: Uint16Array;
  /** Triangle indices into `verts`, 3 per triangle. */
  indices: Uint16Array;
}

export interface CityData {
  buildings: CityBuilding[];
  roads: CityRoad[];
  parks: CityPoly[];
  water: CityPoly[];
}

/** World x/y (0..WORLD.width/height) → quantized uint16. */
export function quantizeX(worldX: number): number {
  return Math.max(0, Math.min(Q, Math.round((worldX / WORLD.width) * Q)));
}
export function quantizeY(worldY: number): number {
  return Math.max(0, Math.min(Q, Math.round((worldY / WORLD.height) * Q)));
}
/** Quantized uint16 → world x/y. */
export function dequantizeX(q: number): number {
  return (q / Q) * WORLD.width;
}
export function dequantizeY(q: number): number {
  return (q / Q) * WORLD.height;
}

class ByteWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  private len = 0;

  constructor(initialCapacity: number) {
    this.buf = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(this.bytes.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }

  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.len, v);
    this.len += 1;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.len, v, true);
    this.len += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.len, v, true);
    this.len += 4;
  }
  finish(): ArrayBuffer {
    return this.buf.slice(0, this.len);
  }
}

class ByteReader {
  private view: DataView;
  private pos = 0;
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }
  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

function assertFits(vertCount: number, triCount: number, label: string) {
  if (vertCount > 255 || triCount > 255) {
    throw new Error(
      `${label} exceeds uint8 vert/tri budget: verts=${vertCount} tris=${triCount}`,
    );
  }
}

export function encodeCity(data: CityData): ArrayBuffer {
  const w = new ByteWriter(8 << 20);
  w.u32(MAGIC);
  w.u16(VERSION);
  w.u32(data.buildings.length);
  w.u32(data.roads.length);
  w.u16(data.parks.length);
  w.u16(data.water.length);

  for (const b of data.buildings) {
    const vertCount = b.verts.length / 2;
    const triCount = b.indices.length / 3;
    assertFits(vertCount, triCount, 'building');
    w.u8(b.major ? 1 : 0);
    w.u8(b.heightM);
    w.u8(b.chunkId);
    w.u8(vertCount);
    w.u8(triCount);
    for (let i = 0; i < b.verts.length; i++) w.u16(b.verts[i]);
    for (let i = 0; i < b.indices.length; i++) w.u8(b.indices[i]);
  }

  for (const r of data.roads) {
    const ptCount = r.pts.length / 2;
    w.u8(r.tier);
    w.u16(ptCount);
    for (let i = 0; i < r.pts.length; i++) w.u16(r.pts[i]);
  }

  const writePoly = (p: CityPoly) => {
    const vertCount = p.verts.length / 2;
    const triCount = p.indices.length / 3;
    w.u16(vertCount);
    for (let i = 0; i < p.verts.length; i++) w.u16(p.verts[i]);
    w.u16(triCount);
    for (let i = 0; i < p.indices.length; i++) w.u16(p.indices[i]);
  };
  for (const p of data.parks) writePoly(p);
  for (const p of data.water) writePoly(p);

  return w.finish();
}

export function decodeCity(buf: ArrayBuffer): CityData {
  const r = new ByteReader(buf);
  const magic = r.u32();
  if (magic !== MAGIC) throw new Error('london-city.bin: bad magic — file is corrupt or stale');
  const version = r.u16();
  if (version !== VERSION) {
    throw new Error(`london-city.bin: unsupported version ${version} (expected ${VERSION})`);
  }
  const buildingCount = r.u32();
  const roadCount = r.u32();
  const parkCount = r.u16();
  const waterCount = r.u16();

  const buildings: CityBuilding[] = new Array(buildingCount);
  for (let bi = 0; bi < buildingCount; bi++) {
    const tierFlags = r.u8();
    const heightM = r.u8();
    const chunkId = r.u8();
    const vertCount = r.u8();
    const triCount = r.u8();
    const verts = new Uint16Array(vertCount * 2);
    for (let i = 0; i < verts.length; i++) verts[i] = r.u16();
    const indices = new Uint8Array(triCount * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = r.u8();
    buildings[bi] = { major: (tierFlags & 1) === 1, heightM, chunkId, verts, indices };
  }

  const roads: CityRoad[] = new Array(roadCount);
  for (let ri = 0; ri < roadCount; ri++) {
    const tier = r.u8();
    const ptCount = r.u16();
    const pts = new Uint16Array(ptCount * 2);
    for (let i = 0; i < pts.length; i++) pts[i] = r.u16();
    roads[ri] = { tier, pts };
  }

  const readPoly = (): CityPoly => {
    const vertCount = r.u16();
    const verts = new Uint16Array(vertCount * 2);
    for (let i = 0; i < verts.length; i++) verts[i] = r.u16();
    const triCount = r.u16();
    const indices = new Uint16Array(triCount * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = r.u16();
    return { verts, indices };
  };

  const parks: CityPoly[] = new Array(parkCount);
  for (let i = 0; i < parkCount; i++) parks[i] = readPoly();
  const water: CityPoly[] = new Array(waterCount);
  for (let i = 0; i < waterCount; i++) water[i] = readPoly();

  return { buildings, roads, parks, water };
}
