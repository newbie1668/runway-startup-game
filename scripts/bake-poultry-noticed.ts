/**
 * Bake No. 1 Poultry onto the noticed tray from a committed still.
 *
 * OSM stock stays the extruded footprint. This writes one photo-mapped GLB
 * under public/map/noticed/; playtime only instantiates it.
 * Does not run Overpass. Does not rebuild Canary towers.
 *
 * The still is the Bank-junction prow (striped limestone, clock turret).
 * Packed as JPEG-in-GLB so Node does not need a canvas exporter.
 *
 * Run: `pnpm bake:poultry`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import earcut from 'earcut';
import { METERS_TO_WORLD, project, unproject } from '../lib/game/geo';
import { decodeCity, dequantizeX, dequantizeY } from '../lib/game/render3d/format';
import { streetUniqueAt } from '../lib/game/render3d/uniqueStreet';

const ROOT = process.cwd();
const STILL = path.join(ROOT, 'scripts/stills/no-1-poultry.jpg');
const OUT_DIR = path.join(ROOT, 'public/map/noticed');
const CITY_BIN = path.join(ROOT, 'public/map/london-city.bin');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const ID = 'no-1-poultry';
/** Stirling body + clock turret. Playtime does not apply tower Y-scale. */
const HEIGHT_M = 42;
const EXCLUSION_M = 24;
/** citystreet azimuth — camera sits south-southeast, looking north. */
const VIEW_AZ = 0.22;

interface StillSample {
  wall: [number, number, number];
  roof: [number, number, number];
}

interface ManifestFile {
  id: string;
  name: string;
  file: string;
  bytes: number;
  x: number;
  z: number;
  exclusionM: number;
  heightM: number;
  photo: boolean;
  shape: string;
}

interface Manifest {
  generatedAt: string;
  hash: string;
  baker: string;
  files: ManifestFile[];
}

interface Prim {
  pos: number[];
  nrm: number[];
  uv: number[] | null;
  idx: number[];
  color: [number, number, number];
  textured: boolean;
  name: string;
}

function sampleStill(): StillSample {
  const py = spawnSync('python3', [path.join(ROOT, 'scripts/still_rgba.py'), STILL], {
    encoding: 'utf8',
  });
  if (py.status !== 0) {
    throw new Error(`still sample failed: ${py.stderr}`);
  }
  const m = py.stdout.trim().match(/^(\d+),(\d+),(\d+)\s+(\d+),(\d+),(\d+)$/);
  if (!m) throw new Error(`still sample parse failed: ${py.stdout}`);
  const n = m.slice(1).map((s) => Number(s) / 255);
  return {
    wall: [n[0]!, n[1]!, n[2]!],
    roof: [n[3]!, n[4]!, n[5]!],
  };
}

function poultryRing(): { ring: Array<[number, number]>; cx: number; cz: number } {
  const raw = readFileSync(CITY_BIN);
  const city = decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  for (const b of city.buildings) {
    const n = b.verts.length / 2;
    const ring: Array<[number, number]> = [];
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const x = dequantizeX(b.verts[i * 2]!);
      const z = dequantizeY(b.verts[i * 2 + 1]!);
      ring.push([x, z]);
      cx += x;
      cz += z;
    }
    cx /= n;
    cz /= n;
    const [lng, lat] = unproject(cx, cz);
    if (streetUniqueAt(lng, lat) !== ID) continue;
    return {
      ring: ring.map(([x, z]) => [x - cx, z - cz]),
      cx,
      cz,
    };
  }
  const pin = project([-0.09075, 51.51332]);
  const hx = 18 * METERS_TO_WORLD;
  const hz = 14 * METERS_TO_WORLD;
  return {
    ring: [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ],
    cx: pin.x,
    cz: pin.y,
  };
}

function signedArea(ring: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function toCcw(ring: Array<[number, number]>): Array<[number, number]> {
  const open =
    ring.length >= 2 &&
    Math.hypot(ring[0]![0] - ring[ring.length - 1]![0], ring[0]![1] - ring[ring.length - 1]![1]) <
      1e-8
      ? ring.slice(0, -1)
      : ring;
  return signedArea(open) < 0 ? open.slice().reverse() : open;
}

function buildPrims(ring: Array<[number, number]>, still: StillSample): Prim[] {
  const r = toCcw(ring);
  const H = HEIGHT_M * METERS_TO_WORLD;
  const viewX = Math.sin(VIEW_AZ);
  const viewZ = Math.cos(VIEW_AZ);
  const rightX = Math.cos(VIEW_AZ);
  const rightZ = -Math.sin(VIEW_AZ);
  const photo: Prim = {
    pos: [],
    nrm: [],
    uv: [],
    idx: [],
    color: [1, 1, 1],
    textured: true,
    name: 'no-1-poultry-south',
  };
  const lime: Prim = {
    pos: [],
    nrm: [],
    uv: null,
    idx: [],
    color: still.wall,
    textured: false,
    name: 'no-1-poultry-stone',
  };
  const faceU: number[] = [];
  const faces: Array<{
    a: [number, number];
    b: [number, number];
    nx: number;
    nz: number;
    photo: boolean;
    u0: number;
    u1: number;
  }> = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1e-6;
    const nx = dz / len;
    const nz = -dx / len;
    const midZ = (a[1] + b[1]) / 2;
    const facing = nx * viewX + nz * viewZ;
    const usePhoto = facing > 0.18 && midZ > -8 * METERS_TO_WORLD;
    const u0 = a[0] * rightX + a[1] * rightZ;
    const u1 = b[0] * rightX + b[1] * rightZ;
    faces.push({ a, b, nx, nz, photo: usePhoto, u0, u1 });
    if (usePhoto) faceU.push(u0, u1);
  }
  const uMin = faceU.length ? Math.min(...faceU) : 0;
  const uMax = faceU.length ? Math.max(...faceU) : 1;
  const uSpan = Math.max(1e-6, uMax - uMin);
  const pushQuad = (prim: Prim, f: (typeof faces)[number], ua?: number, ub?: number) => {
    const base = prim.pos.length / 3;
    prim.pos.push(f.a[0], 0, f.a[1], f.b[0], 0, f.b[1], f.b[0], H, f.b[1], f.a[0], H, f.a[1]);
    for (let k = 0; k < 4; k++) prim.nrm.push(f.nx, 0, f.nz);
    prim.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    if (prim.uv && ua != null && ub != null) prim.uv.push(ua, 0, ub, 0, ub, 1, ua, 1);
  };
  for (const f of faces) {
    if (f.photo) {
      pushQuad(photo, f, (f.u0 - uMin) / uSpan, (f.u1 - uMin) / uSpan);
    } else {
      pushQuad(lime, f);
    }
  }
  const roof: Prim = {
    pos: [],
    nrm: [],
    uv: null,
    idx: [],
    color: still.roof,
    textured: false,
    name: 'no-1-poultry-roof',
  };
  const flat: number[] = [];
  for (const p of r) {
    roof.pos.push(p[0], H, p[1]);
    roof.nrm.push(0, 1, 0);
    flat.push(p[0], p[1]);
  }
  const tris = earcut(flat, undefined, 2);
  for (let i = 0; i < tris.length; i += 3) {
    roof.idx.push(tris[i]!, tris[i + 1]!, tris[i + 2]!);
  }
  return [photo, lime, roof].filter((p) => p.idx.length > 0);
}

function pad4(buf: Buffer): Buffer {
  const n = (4 - (buf.byteLength % 4)) % 4;
  return n === 0 ? buf : Buffer.concat([buf, Buffer.alloc(n, 0x20)]);
}

function padBin(buf: Buffer): Buffer {
  const n = (4 - (buf.byteLength % 4)) % 4;
  return n === 0 ? buf : Buffer.concat([buf, Buffer.alloc(n, 0)]);
}

function minMax3(pos: number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k]!;
      min[k] = Math.min(min[k]!, v);
      max[k] = Math.max(max[k]!, v);
    }
  }
  return { min, max };
}

function packGlb(prims: Prim[], jpeg: Buffer): Buffer {
  const binParts: Buffer[] = [];
  const views: Array<{
    buffer: number;
    byteOffset: number;
    byteLength: number;
    target?: number;
  }> = [];
  const accessors: object[] = [];
  const materials: object[] = [];
  const primitives: object[] = [];
  let offset = 0;
  const pushBuf = (buf: Buffer, target?: number): number => {
    const padded = padBin(buf);
    const viewIndex = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.byteLength, target });
    binParts.push(padded);
    offset += padded.byteLength;
    return viewIndex;
  };
  const jpegView = pushBuf(jpeg);
  for (const prim of prims) {
    const pos = Buffer.from(new Float32Array(prim.pos).buffer);
    const nrm = Buffer.from(new Float32Array(prim.nrm).buffer);
    const idx = Buffer.from(new Uint32Array(prim.idx).buffer);
    const posView = pushBuf(pos, 34962);
    const nrmView = pushBuf(nrm, 34962);
    const idxView = pushBuf(idx, 34963);
    const posMm = minMax3(prim.pos);
    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count: prim.pos.length / 3,
      type: 'VEC3',
      min: posMm.min,
      max: posMm.max,
    });
    const nrmAcc = accessors.length;
    accessors.push({
      bufferView: nrmView,
      componentType: 5126,
      count: prim.nrm.length / 3,
      type: 'VEC3',
    });
    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5125,
      count: prim.idx.length,
      type: 'SCALAR',
    });
    const attributes: Record<string, number> = { POSITION: posAcc, NORMAL: nrmAcc };
    if (prim.uv) {
      const uv = Buffer.from(new Float32Array(prim.uv).buffer);
      const uvView = pushBuf(uv, 34962);
      const uvAcc = accessors.length;
      accessors.push({
        bufferView: uvView,
        componentType: 5126,
        count: prim.uv.length / 2,
        type: 'VEC2',
      });
      attributes.TEXCOORD_0 = uvAcc;
    }
    const matIndex = materials.length;
    if (prim.textured) {
      materials.push({
        name: prim.name,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.62,
        },
      });
    } else {
      materials.push({
        name: prim.name,
        pbrMetallicRoughness: {
          baseColorFactor: [...prim.color, 1],
          metallicFactor: 0,
          roughnessFactor: 0.74,
        },
      });
    }
    primitives.push({
      attributes,
      indices: idxAcc,
      material: matIndex,
    });
  }
  const json = {
    asset: { version: '2.0', generator: 'bake-poultry-noticed' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: ID }],
    meshes: [{ name: ID, primitives }],
    materials,
    textures: [{ sampler: 0, source: 0 }],
    images: [{ mimeType: 'image/jpeg', bufferView: jpegView }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json)));
  const binBuf = Buffer.concat(binParts);
  const total = 12 + 8 + jsonBuf.byteLength + 8 + binBuf.byteLength;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.byteLength, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binBuf.byteLength, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHead, jsonBuf, binHead, binBuf]);
}

async function patchManifest(entry: ManifestFile): Promise<void> {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as Manifest;
  } catch {
    manifest = {
      generatedAt: new Date().toISOString(),
      hash: 'poultry',
      baker: 'poultry-still',
      files: [],
    };
  }
  const rest = manifest.files.filter((f) => f.id !== ID);
  rest.push(entry);
  manifest.files = rest;
  manifest.generatedAt = new Date().toISOString();
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
  if (!existsSync(STILL)) throw new Error(`missing still ${STILL}`);
  const still = sampleStill();
  const { ring, cx, cz } = poultryRing();
  const prims = buildPrims(ring, still);
  const jpeg = readFileSync(STILL);
  const glb = packGlb(prims, jpeg);
  const file = `${ID}.glb`;
  await writeFile(path.join(OUT_DIR, file), glb);
  await patchManifest({
    id: ID,
    name: 'No 1 Poultry',
    file,
    bytes: glb.byteLength,
    x: cx,
    z: cz,
    exclusionM: EXCLUSION_M,
    heightM: HEIGHT_M,
    photo: true,
    shape: 'photo',
  });
  console.log(
    `  ${file}  ${(glb.byteLength / 1024).toFixed(1)} KB  prims=${prims.length}  at ${cx.toFixed(3)},${cz.toFixed(3)}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
