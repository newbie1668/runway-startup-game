/**
 * Bake No. 1 Poultry onto the noticed tray from a committed still.
 *
 * OSM stock stays the extruded footprint. This writes one still-sampled GLB
 * under public/map/noticed/ via the same THREE.GLTFExporter path as the rest
 * of the tray. Playtime only instantiates it.
 *
 * The still is the Bank-junction prow (striped limestone, clock turret).
 * Geometry is local to the OSM centroid; vertex colours come from the still.
 *
 * Run: `pnpm bake:poultry`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import earcut from 'earcut';
import * as THREE from 'three';
import { METERS_TO_WORLD, project, unproject } from '../lib/game/geo';
import { decodeCity, dequantizeX, dequantizeY } from '../lib/game/render3d/format';
import { streetUniqueAt } from '../lib/game/render3d/uniqueStreet';
import { exportNoticedGlb } from './noticedMesh';

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

interface StillPixels {
  w: number;
  h: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pixels: Array<[number, number, number, number, number]>;
  stripes: Array<[number, number, number]>;
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

function loadStill(): StillPixels {
  const py = spawnSync('python3', [path.join(ROOT, 'scripts/still_pixels.py'), STILL, '96'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (py.status !== 0) {
    throw new Error(`still pixels failed: ${py.stderr || py.stdout}`);
  }
  return JSON.parse(py.stdout) as StillPixels;
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

function rgb01(r: number, g: number, b: number): [number, number, number] {
  return [r / 255, g / 255, b / 255];
}

/** Overcast still is dull; lift stone so the bands read at street zoom. */
function liftStone(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx - mn;
  if (sat < 8) return rgb01(r, g, b);
  const warm = r - b;
  let nr = r;
  let ng = g;
  let nb = b;
  if (warm > 4 && r > 55) {
    nr = Math.min(255, Math.round(r * 1.42 + 28));
    ng = Math.min(255, Math.round(g * 1.12 + 14));
    nb = Math.max(0, Math.round(b * 0.82));
  } else if (r > 110 && g > 100 && sat > 8) {
    nr = Math.min(255, Math.round(r + 28));
    ng = Math.min(255, Math.round(g + 22));
    nb = Math.max(0, Math.round(b + 4));
  }
  return rgb01(nr, ng, nb);
}

function stripeAt(stripes: Array<[number, number, number]>, t: number): [number, number, number] {
  if (stripes.length === 0) return [0.88, 0.56, 0.58];
  const i = Math.min(stripes.length - 1, Math.max(0, Math.floor(t * stripes.length)));
  const s = stripes[i]!;
  return liftStone(s[0], s[1], s[2]);
}

function matte(vertexColors: boolean, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    roughness: 0.68,
    vertexColors,
    side: THREE.DoubleSide,
  });
}

function geoFrom(pos: number[], nrm: number[], col: number[], idx: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function buildPhotoMesh(
  still: StillPixels,
  viewX: number,
  viewZ: number,
  rightX: number,
  rightZ: number,
  south: number,
): THREE.Mesh {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bw = still.maxX - still.minX + 1;
  const bh = still.maxY - still.minY + 1;
  const worldH = HEIGHT_M * METERS_TO_WORLD;
  const pixH = worldH / bh;
  const pixW = pixH * 2.35;
  const hx = pixW * 0.52;
  const hy = pixH * 0.52;
  const pad = 0.85 * METERS_TO_WORLD;
  for (const [x, y, r, g, b] of still.pixels) {
    const lx = (x - still.minX + 0.5 - bw / 2) * pixW;
    const ly = (bh - (y - still.minY + 0.5)) * pixH;
    const lz = south + pad;
    const cx = lx * rightX + lz * viewX;
    const cz = lx * rightZ + lz * viewZ;
    const rgb = liftStone(r, g, b);
    const base = pos.length / 3;
    const corners: Array<[number, number, number]> = [
      [cx - rightX * hx, ly - hy, cz - rightZ * hx],
      [cx + rightX * hx, ly - hy, cz + rightZ * hx],
      [cx + rightX * hx, ly + hy, cz + rightZ * hx],
      [cx - rightX * hx, ly + hy, cz - rightZ * hx],
    ];
    for (const p of corners) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(viewX, 0, viewZ);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const mesh = new THREE.Mesh(geoFrom(pos, nrm, col, idx), matte(true));
  mesh.name = 'no-1-poultry-south';
  return mesh;
}

function buildVolume(
  ring: Array<[number, number]>,
  still: StillPixels,
): { body: THREE.Mesh; roof: THREE.Mesh } {
  const r = toCcw(ring);
  const H = HEIGHT_M * METERS_TO_WORLD;
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bands = 24;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1e-6;
    const nx = dz / len;
    const nz = -dx / len;
    for (let k = 0; k < bands; k++) {
      const t0 = k / bands;
      const t1 = (k + 1) / bands;
      const y0 = t0 * H;
      const y1 = t1 * H;
      const rgb = stripeAt(still.stripes, 1 - (t0 + t1) / 2);
      const base = pos.length / 3;
      pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
      for (let v = 0; v < 4; v++) nrm.push(nx, 0, nz);
      for (let v = 0; v < 4; v++) col.push(rgb[0], rgb[1], rgb[2]);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const body = new THREE.Mesh(geoFrom(pos, nrm, col, idx), matte(true));
  body.name = 'no-1-poultry-stone';

  const roofPos: number[] = [];
  const roofNrm: number[] = [];
  const roofCol: number[] = [];
  const roofIdx: number[] = [];
  const flat: number[] = [];
  const roofRgb = stripeAt(still.stripes, 0.55);
  for (const p of r) {
    roofPos.push(p[0], H, p[1]);
    roofNrm.push(0, 1, 0);
    roofCol.push(roofRgb[0], roofRgb[1], roofRgb[2]);
    flat.push(p[0], p[1]);
  }
  const tris = earcut(flat, undefined, 2);
  for (let i = 0; i < tris.length; i += 3) {
    roofIdx.push(tris[i]!, tris[i + 1]!, tris[i + 2]!);
  }
  const roof = new THREE.Mesh(geoFrom(roofPos, roofNrm, roofCol, roofIdx), matte(true));
  roof.name = 'no-1-poultry-roof';
  return { body, roof };
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
  const still = loadStill();
  const { ring, cx, cz } = poultryRing();
  const viewX = Math.sin(VIEW_AZ);
  const viewZ = Math.cos(VIEW_AZ);
  const rightX = Math.cos(VIEW_AZ);
  const rightZ = -Math.sin(VIEW_AZ);
  let south = -Infinity;
  for (const p of ring) {
    south = Math.max(south, p[0] * viewX + p[1] * viewZ);
  }
  const group = new THREE.Group();
  group.name = ID;
  const photo = buildPhotoMesh(still, viewX, viewZ, rightX, rightZ, south);
  const { body, roof } = buildVolume(ring, still);
  group.add(photo, body, roof);
  const buf = await exportNoticedGlb(group);
  const file = `${ID}.glb`;
  await writeFile(path.join(OUT_DIR, file), Buffer.from(buf));
  await patchManifest({
    id: ID,
    name: 'No 1 Poultry',
    file,
    bytes: buf.byteLength,
    x: cx,
    z: cz,
    exclusionM: EXCLUSION_M,
    heightM: HEIGHT_M,
    photo: true,
    shape: 'photo',
  });
  console.log(
    `  ${file}  ${(buf.byteLength / 1024).toFixed(1)} KB  pixels=${still.pixels.length}  at ${cx.toFixed(3)},${cz.toFixed(3)}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
