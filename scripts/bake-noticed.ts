/**
 * RUNWAY — bake-time "noticed tower" factory (SFSIM layer 2, London).
 *
 * Kansas's pipeline, offline at play time:
 *   named OSM tower → Wikimedia photo + intro ("what stands out") →
 *   unique silhouette bands → Blender (or three.js fallback) GLB
 * committed to public/map/noticed/. Runtime only fetch()'s those files.
 *
 * Run: `pnpm bake:noticed`
 *      `pnpm tsx scripts/bake-noticed.ts --dry-run`
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LANDMARKS, METERS_TO_WORLD, project } from '../lib/game/geo';
import { resolveRoofColour, resolveWallColour } from '../lib/game/render3d/osmColour';
import {
  bandsForShape,
  civicFallbackHeightM,
  civicKindFromTags,
  isCircularShape,
  isCivicShape,
  liftRgb,
  resolveShape,
  roofFromWall,
  tintForShape,
  type NoticedShape,
} from './noticedFeatures';
import { buildNoticedGroup, exportNoticedGlb } from './noticedMesh';
import {
  MAX_NOTICED,
  MAX_NOTICED_CIVIC,
  MAX_NOTICED_TOWERS,
  MIN_CIVIC_HEIGHT_M,
  MIN_NOTICED_HEIGHT_M,
  heightFromTags,
  isUsefulName,
  slugify,
  uniqueSlug,
  wikiTitleFromTags,
} from './noticedSelect';
import { isUniqueNoticedId } from '../lib/game/render3d/uniqueNoticed';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'scripts/.geocache');
const WIKI_CACHE = path.join(CACHE_DIR, 'wiki');
const OUT_DIR = path.join(ROOT, 'public/map/noticed');
const USER_AGENT =
  'RunwayStartupGame/0.1 (bake-time noticed-tower photos; +https://github.com/newbie1668/runway-startup-game)';
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OSM_BBOX = '51.452,-0.265,51.552,0.065';
/** Matches the bake pin in lib/game/render3d/buildingStyle.ts NOTICED_BAKE_HEIGHT_SCALE.
 *  Runtime instantiateNoticed rescales Y to TOWER_HEIGHT_SCALE. */
const HEIGHT_SCALE = 1.5;

interface LatLon {
  lat: number;
  lon: number;
}
interface OverpassMember {
  role: string;
  geometry?: LatLon[];
}
interface OverpassElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: OverpassMember[];
}

interface Candidate {
  id: string;
  name: string;
  heightM: number;
  lng: number;
  lat: number;
  worldX: number;
  worldZ: number;
  ringLocal: Array<[number, number]>;
  exclusionM: number;
  wall: [number, number, number];
  roof: [number, number, number];
  glass: boolean;
  wikiTitle: string | null;
  photo: string | null;
  extract: string;
  shape: NoticedShape;
  civic: NoticedShape | null;
  seed: number;
}

function rgbTuple(hex: number | null, fallback: number): [number, number, number] {
  const c = hex ?? fallback;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

function closeEnough(a: LatLon, b: LatLon): boolean {
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
}

function stitchOuterRings(segments: LatLon[][]): LatLon[][] {
  const remaining = segments.map((s) => s.slice());
  const rings: LatLon[][] = [];
  while (remaining.length) {
    let current = remaining.shift()!;
    let guard = remaining.length + 1;
    while (
      guard-- > 0 &&
      remaining.length > 0 &&
      !closeEnough(current[0], current[current.length - 1])
    ) {
      const tail = current[current.length - 1];
      let joined = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        if (closeEnough(tail, seg[0])) {
          current = current.concat(seg.slice(1));
          remaining.splice(i, 1);
          joined = true;
          break;
        }
        if (closeEnough(tail, seg[seg.length - 1])) {
          current = current.concat(seg.slice(0, -1).reverse());
          remaining.splice(i, 1);
          joined = true;
          break;
        }
      }
      if (!joined) break;
    }
    rings.push(current);
  }
  return rings;
}

function ringsFromElement(el: OverpassElement): Array<Array<{ x: number; y: number }>> {
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 3) return [];
    return [el.geometry.map((g) => project([g.lon, g.lat]))];
  }
  if (el.type === 'relation') {
    const outerSegs = (el.members ?? [])
      .filter((m) => m.role === 'outer' && m.geometry && m.geometry.length >= 2)
      .map((m) => m.geometry!);
    if (outerSegs.length === 0) return [];
    return stitchOuterRings(outerSegs)
      .filter((r) => r.length >= 3)
      .map((r) => r.map((g) => project([g.lon, g.lat])));
  }
  return [];
}

function nearLandmark(x: number, z: number): boolean {
  // Same footprint as a hand-modelled landmark (~15 m in OSM). Neighbours
  // like 8 Bishopsgate (~70 m from 22 Bishopsgate) must still get a factory mesh.
  const r = 35 * METERS_TO_WORLD;
  return LANDMARKS.some((l) => {
    const p = project(l.at);
    return Math.hypot(x - p.x, z - p.y) < r;
  });
}

async function loadBuildingElements(): Promise<OverpassElement[]> {
  let names: string[] = [];
  try {
    names = (await readdir(CACHE_DIR)).filter(
      (n) => n.startsWith('buildings') && n.endsWith('.json'),
    );
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: OverpassElement[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(CACHE_DIR, name), 'utf8')) as {
      elements?: OverpassElement[];
    };
    for (const el of raw.elements ?? []) {
      const key = `${el.type}/${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(el);
    }
  }
  return out;
}

interface ManifestFile {
  id: string;
  name: string;
  file: string;
  x: number;
  z: number;
  exclusionM: number;
  heightM: number;
}

async function loadExistingManifest(): Promise<ManifestFile[]> {
  try {
    const raw = JSON.parse(await readFile(path.join(OUT_DIR, 'manifest.json'), 'utf8')) as {
      files?: ManifestFile[];
    };
    return raw.files ?? [];
  } catch {
    return [];
  }
}

function findElementByName(elements: OverpassElement[], name: string): OverpassElement | null {
  const want = name.toLowerCase();
  let best: OverpassElement | null = null;
  let bestH = -1;
  for (const el of elements) {
    const n = el.tags?.name?.toLowerCase();
    if (n !== want) continue;
    const h = heightFromTags(el.tags ?? {});
    if (h >= bestH) {
      best = el;
      bestH = h;
    }
  }
  return best;
}

async function fetchNamedElements(names: string[]): Promise<OverpassElement[]> {
  const cacheFile = path.join(CACHE_DIR, 'noticed-by-name.json');
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8')) as {
      elements?: OverpassElement[];
    };
    if (cached.elements && cached.elements.length > 0) {
      console.log(`  [cache] noticed-by-name: ${cached.elements.length} elements`);
      return cached.elements;
    }
  } catch {
    // fetch
  }
  const clauses = names.flatMap((name) => {
    const q = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return [
      `  way["building"]["name"="${q}"](${OSM_BBOX});`,
      `  relation["building"]["name"="${q}"](${OSM_BBOX});`,
    ];
  });
  const query = `[out:json][timeout:120];\n(\n${clauses.join('\n')}\n);\nout tags geom;`;
  let lastErr: unknown;
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: OverpassElement[] };
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(json));
      console.log(
        `  [fetch] noticed-by-name via ${endpoint}: ${json.elements?.length ?? 0} elements`,
      );
      return json.elements ?? [];
    } catch (err) {
      lastErr = err;
      console.warn(`  [overpass] ${endpoint}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Overpass failed');
}

function candidatesFromManifest(files: ManifestFile[], elements: OverpassElement[]): Candidate[] {
  const out: Candidate[] = [];
  for (const file of files) {
    const el = findElementByName(elements, file.name);
    if (!el) {
      console.warn(`  [osm] no ring for ${file.name}`);
      continue;
    }
    const ring = pickLargestRing(el);
    if (!ring) continue;
    const tags = el.tags ?? {};
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    const heightM = file.heightM || heightFromTags(tags);
    const wallHex = resolveWallColour(tags);
    const roofHex = resolveRoofColour(tags);
    const civic = civicKindFromTags(tags);
    const glass =
      !civic && (/glass|mirror/i.test(tags['building:material'] ?? '') || heightM >= 140);
    out.push({
      id: file.id,
      name: file.name,
      heightM,
      lng: 0,
      lat: 0,
      worldX: cx,
      worldZ: cz,
      ringLocal: ring.map((p) => [p.x - cx, p.y - cz] as [number, number]),
      exclusionM: file.exclusionM,
      wall: rgbTuple(wallHex, glass ? 0x6a7888 : 0xc4b8a8),
      roof: rgbTuple(roofHex, 0x4a4a4c),
      glass,
      wikiTitle: wikiTitleFromTags(tags) ?? file.name,
      photo: null,
      extract: '',
      shape: civic ?? 'slab',
      civic,
      seed: el.id,
    });
  }
  return out;
}

function pickLargestRing(el: OverpassElement): Array<{ x: number; y: number }> | null {
  let best: Array<{ x: number; y: number }> | null = null;
  let bestArea = 0;
  for (const ring of ringsFromElement(el)) {
    if (ring.length < 3) continue;
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      sum += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(sum / 2);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

function collectCandidates(elements: OverpassElement[]): Candidate[] {
  const byName = new Map<string, Candidate>();
  const usedSlugs = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (tags['building:part']) continue;
    const name = tags.name;
    if (!name || !isUsefulName(name)) continue;
    const civic = civicKindFromTags(tags);
    let heightM = heightFromTags(tags);
    if (civic && heightM < MIN_CIVIC_HEIGHT_M) heightM = civicFallbackHeightM(civic);
    if (!civic && heightM < MIN_NOTICED_HEIGHT_M) continue;
    const ring = pickLargestRing(el);
    if (!ring) continue;
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    if (nearLandmark(cx, cz)) continue;
    const maxR = Math.max(...ring.map((p) => Math.hypot(p.x - cx, p.y - cz)));
    const exclusionM = Math.max(40, Math.round(maxR / METERS_TO_WORLD + 12));
    const wallHex = resolveWallColour(tags);
    const roofHex = resolveRoofColour(tags);
    const glass =
      !civic && (/glass|mirror/i.test(tags['building:material'] ?? '') || heightM >= 140);
    const key = name.toLowerCase();
    const prev = byName.get(key);
    if (prev && prev.heightM >= heightM) continue;
    const cand: Candidate = {
      id: prev?.id ?? uniqueSlug(slugify(name), usedSlugs),
      name,
      heightM,
      lng: 0,
      lat: 0,
      worldX: cx,
      worldZ: cz,
      ringLocal: ring.map((p) => [p.x - cx, p.y - cz] as [number, number]),
      exclusionM,
      wall: rgbTuple(wallHex, glass ? 0x6a7888 : civic ? 0xc4b8a8 : 0xc4b8a8),
      roof: rgbTuple(roofHex, 0x4a4a4c),
      glass,
      wikiTitle: wikiTitleFromTags(tags) ?? name,
      photo: null,
      extract: '',
      shape: civic ?? 'slab',
      civic,
      seed: el.id,
    };
    byName.set(key, cand);
  }
  const all = [...byName.values()];
  const towers = all
    .filter((c) => !c.civic && c.heightM >= MIN_NOTICED_HEIGHT_M)
    .sort((a, b) => b.heightM - a.heightM)
    .slice(0, MAX_NOTICED_TOWERS);
  const civics = all
    .filter((c) => c.civic)
    .sort((a, b) => b.heightM - a.heightM)
    .slice(0, MAX_NOTICED_CIVIC);
  const picked = new Map<string, Candidate>();
  for (const c of [...towers, ...civics]) picked.set(c.id, c);
  return [...picked.values()].sort((a, b) => b.heightM - a.heightM).slice(0, MAX_NOTICED);
}

async function wikiPage(title: string): Promise<{ thumb: string | null; extract: string }> {
  const url =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'pageimages|extracts',
      piprop: 'thumbnail',
      pithumbsize: '400',
      exintro: '1',
      explaintext: '1',
      exchars: '500',
      format: 'json',
      redirects: '1',
    }).toString();
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) return { thumb: null, extract: '' };
  const json = (await res.json()) as {
    query?: { pages?: Record<string, { thumbnail?: { source?: string }; extract?: string }> };
  };
  const page = Object.values(json.query?.pages ?? {})[0];
  return { thumb: page?.thumbnail?.source ?? null, extract: page?.extract ?? '' };
}

async function downloadPhoto(slug: string, url: string): Promise<string | null> {
  await mkdir(WIKI_CACHE, { recursive: true });
  const ext = url.includes('.png') ? '.png' : '.jpg';
  const dest = path.join(WIKI_CACHE, `${slug}${ext}`);
  try {
    const existing = await readFile(dest);
    if (existing.byteLength > 1000) return dest;
  } catch {
    // download
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 1000) return null;
  await writeFile(dest, buf);
  return dest;
}

function samplePhoto(
  photoPath: string,
): { wall: [number, number, number]; roof: [number, number, number] } | null {
  const py = spawnSync('python3', [path.join(ROOT, 'scripts/sample_photo_colours.py'), photoPath], {
    encoding: 'utf8',
  });
  if (py.status !== 0) return null;
  const m = py.stdout.trim().match(/^(\d+),(\d+),(\d+)\s+(\d+),(\d+),(\d+)$/);
  if (!m) return null;
  const n = m.slice(1).map((s) => Number(s) / 255) as number[];
  return { wall: [n[0], n[1], n[2]], roof: [n[3], n[4], n[5]] };
}

async function attachWiki(cands: Candidate[]): Promise<void> {
  for (const c of cands) {
    const title = c.wikiTitle ?? c.name;
    try {
      const page = await wikiPage(title);
      c.extract = page.extract;
      if (page.thumb) {
        const dest = await downloadPhoto(c.id, page.thumb);
        if (dest) {
          c.photo = dest;
          const sampled = samplePhoto(dest);
          if (sampled) {
            c.wall = sampled.wall;
            c.roof = sampled.roof;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      console.warn(`  [wiki] ${c.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function assignShapes(cands: Candidate[]): void {
  for (const c of cands) {
    c.shape = c.civic ?? resolveShape(c.id, c.name, c.extract);
    c.wall = tintForShape(c.shape, liftRgb(c.wall));
    c.roof = roofFromWall(c.wall);
    if (isCivicShape(c.shape)) c.glass = false;
  }
}

function blenderBin(): string | null {
  const candidates = [
    process.env.BLENDER,
    '/opt/homebrew/bin/blender',
    '/usr/bin/blender',
    '/usr/local/bin/blender',
  ].filter((x): x is string => !!x);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const which = spawnSync('which', ['blender'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

function runBlender(blender: string, jobPath: string): void {
  const result = spawnSync(
    blender,
    ['--background', '--python', path.join(ROOT, 'scripts/blender_noticed.py'), '--', jobPath],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`Blender exited ${result.status}`);
  }
}

async function bakeWithThree(
  buildings: Array<{
    id: string;
    ring: Array<[number, number]>;
    heightWorld: number;
    wall: [number, number, number];
    roof: [number, number, number];
    glass: boolean;
    seed: number;
    shape: NoticedShape;
    bands: ReturnType<typeof bandsForShape>;
    circular: boolean;
  }>,
  outDir: string,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const b of buildings) {
    const group = buildNoticedGroup(b);
    const buf = await exportNoticedGlb(group);
    await writeFile(path.join(outDir, `${b.id}.glb`), Buffer.from(buf));
    console.log(`  three: ${b.id}  ${(buf.byteLength / 1024).toFixed(1)} KB  ${b.shape}`);
  }
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry-run');
  console.log('=== Noticed tower factory ===');
  let elements = await loadBuildingElements();
  console.log(`OSM building cache: ${elements.length} elements`);
  let cands: Candidate[] = [];
  if (elements.length > 0) {
    cands = collectCandidates(elements);
  } else {
    const manifest = await loadExistingManifest();
    if (manifest.length === 0) {
      console.warn('No geocache and no committed noticed manifest.');
      return;
    }
    console.log(`No geocache; fetching OSM rings for ${manifest.length} committed names`);
    try {
      elements = await fetchNamedElements(manifest.map((f) => f.name));
      cands = candidatesFromManifest(manifest, elements);
    } catch (err) {
      console.warn(`OSM lookup failed: ${err instanceof Error ? err.message : err}`);
      for (const f of manifest) {
        console.log(
          `  ${String(f.heightM).padStart(3)} m  ${f.name}  shape=${resolveShape(f.id, f.name, '')}`,
        );
      }
      if (!dry) {
        console.warn('Skipping GLB rebake — runtime still keeps bake-time façade maps.');
      }
      return;
    }
  }
  console.log(
    `Selected ${cands.length} noticed buildings (towers ≥${MIN_NOTICED_HEIGHT_M} m + civic silhouettes):`,
  );
  if (dry) {
    assignShapes(cands);
    for (const c of cands) {
      console.log(`  ${c.heightM.toFixed(0).padStart(3)} m  ${c.name}  ${c.shape}`);
    }
    return;
  }

  await attachWiki(cands);
  assignShapes(cands);
  const withPhoto = cands.filter((c) => c.photo).length;
  console.log(`Wikimedia thumbnails: ${withPhoto}/${cands.length}`);
  for (const c of cands) {
    console.log(
      `  ${c.heightM.toFixed(0).padStart(3)} m  ${c.name}  ${c.shape}${c.photo ? '  photo' : ''}`,
    );
  }

  const buildings = cands.map((c) => ({
    id: c.id,
    name: c.name,
    heightWorld: c.heightM * METERS_TO_WORLD * HEIGHT_SCALE,
    ring: c.ringLocal,
    wall: c.wall,
    roof: c.roof,
    glass: c.glass,
    seed: c.seed,
    photo: c.photo,
    extract: c.extract.slice(0, 280),
    shape: c.shape,
    bands: bandsForShape(c.shape),
    circular: isCircularShape(c.shape),
  }));

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  const job = { outDir: OUT_DIR, buildings };
  const jobPath = path.join(CACHE_DIR, 'noticed-job.json');
  await writeFile(jobPath, JSON.stringify(job));

  const blender = blenderBin();
  const needsCivicBaker = buildings.some((b) => isCivicShape(b.shape));
  const unique = buildings.filter((b) => isUniqueNoticedId(b.id));
  const generic = buildings.filter((b) => !isUniqueNoticedId(b.id));
  if (blender && !needsCivicBaker) {
    console.log(`Blender: ${blender}`);
    runBlender(blender, jobPath);
  } else {
    if (needsCivicBaker) {
      console.log('Civic silhouettes use the three.js baker (church/station/theatre/civic extras)');
    } else {
      console.log('Blender not found; using three.js noticed baker');
    }
    await bakeWithThree(generic, OUT_DIR);
  }
  if (unique.length > 0) {
    console.log(`Photo-true unique meshes (${unique.map((b) => b.id).join(', ')})`);
    await bakeWithThree(unique, OUT_DIR);
  }

  const files = [];
  for (const c of cands) {
    const file = `${c.id}.glb`;
    let bytes = 0;
    try {
      bytes = (await readFile(path.join(OUT_DIR, file))).byteLength;
    } catch {
      console.warn(`  missing ${file}`);
      continue;
    }
    files.push({
      id: c.id,
      name: c.name,
      file,
      bytes,
      x: c.worldX,
      z: c.worldZ,
      exclusionM: c.exclusionM,
      heightM: Math.round(c.heightM),
      photo: Boolean(c.photo),
      shape: c.shape,
    });
  }
  const poultryGlb = path.join(OUT_DIR, 'no-1-poultry.glb');
  if (existsSync(poultryGlb) && !files.some((f) => f.id === 'no-1-poultry')) {
    const prev = (await loadExistingManifest()).find((f) => f.id === 'no-1-poultry');
    const pin = project([-0.09075, 51.51332]);
    files.push({
      id: 'no-1-poultry',
      name: prev?.name ?? 'No 1 Poultry',
      file: 'no-1-poultry.glb',
      bytes: (await readFile(poultryGlb)).byteLength,
      x: prev?.x ?? pin.x,
      z: prev?.z ?? pin.y,
      exclusionM: prev?.exclusionM ?? 24,
      heightM: prev?.heightM ?? 42,
      photo: true,
      shape: 'photo',
    });
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    hash: createHash('sha1')
      .update(files.map((f) => f.id).join('|'))
      .digest('hex')
      .slice(0, 12),
    baker: blender ? 'blender' : 'three',
    files,
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${files.length} GLBs to ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
