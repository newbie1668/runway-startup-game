/**
 * RUNWAY — bake-time "noticed tower" factory (SFSIM layer 2, London).
 *
 * Named OSM towers ≥100 m that are not already hand-modelled landmarks:
 *   OSM footprint + Wikimedia thumbnail colours → Blender GLB
 * committed to public/map/noticed/. Runtime only fetch()'s those files.
 *
 * Run: `pnpm bake:noticed`
 *      `pnpm tsx scripts/bake-noticed.ts --dry-run`
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LANDMARKS, METERS_TO_WORLD, project } from '../lib/game/geo';
import { resolveRoofColour, resolveWallColour } from '../lib/game/render3d/osmColour';
import {
  MAX_NOTICED,
  MIN_NOTICED_HEIGHT_M,
  heightFromTags,
  isUsefulName,
  slugify,
  uniqueSlug,
  wikiTitleFromTags,
} from './noticedSelect';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'scripts/.geocache');
const WIKI_CACHE = path.join(CACHE_DIR, 'wiki');
const OUT_DIR = path.join(ROOT, 'public/map/noticed');
const BLENDER = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
const USER_AGENT = 'RunwayStartupGame/0.1 (bake-time noticed-tower photos; +https://github.com/newbie1668/runway-startup-game)';
/** Matches lib/game/render3d/cityBuilder.ts HEIGHT_SCALE. */
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
    while (guard-- > 0 && remaining.length > 0 && !closeEnough(current[0], current[current.length - 1])) {
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
  const names = (await readdir(CACHE_DIR)).filter((n) => n.startsWith('buildings') && n.endsWith('.json'));
  const seen = new Set<string>();
  const out: OverpassElement[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(CACHE_DIR, name), 'utf8')) as { elements?: OverpassElement[] };
    for (const el of raw.elements ?? []) {
      const key = `${el.type}/${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(el);
    }
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
    const heightM = heightFromTags(tags);
    if (heightM < MIN_NOTICED_HEIGHT_M) continue;
    const ring = pickLargestRing(el);
    if (!ring) continue;
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    if (nearLandmark(cx, cz)) continue;
    const maxR = Math.max(...ring.map((p) => Math.hypot(p.x - cx, p.y - cz)));
    const exclusionM = Math.max(40, Math.round(maxR / METERS_TO_WORLD + 12));
    const wallHex = resolveWallColour(tags);
    const roofHex = resolveRoofColour(tags);
    const glass = /glass|mirror/i.test(tags['building:material'] ?? '') || heightM >= 140;
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
      wall: rgbTuple(wallHex, glass ? 0x6a7888 : 0xc4b8a8),
      roof: rgbTuple(roofHex, 0x4a4a4c),
      glass,
      wikiTitle: wikiTitleFromTags(tags) ?? name,
      photo: null,
      seed: el.id,
    };
    byName.set(key, cand);
  }
  return [...byName.values()].sort((a, b) => b.heightM - a.heightM).slice(0, MAX_NOTICED);
}

async function wikiThumbnailUrl(title: string): Promise<string | null> {
  const url =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: '400',
      format: 'json',
      redirects: '1',
    }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
  };
  const pages = Object.values(json.query?.pages ?? {});
  return pages[0]?.thumbnail?.source ?? null;
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

function samplePhoto(photoPath: string): { wall: [number, number, number]; roof: [number, number, number] } | null {
  const py = spawnSync('python3', [path.join(ROOT, 'scripts/sample_photo_colours.py'), photoPath], {
    encoding: 'utf8',
  });
  if (py.status !== 0) return null;
  const m = py.stdout.trim().match(/^(\d+),(\d+),(\d+)\s+(\d+),(\d+),(\d+)$/);
  if (!m) return null;
  const n = m.slice(1).map((s) => Number(s) / 255) as number[];
  return { wall: [n[0], n[1], n[2]], roof: [n[3], n[4], n[5]] };
}

async function attachPhotos(cands: Candidate[]): Promise<void> {
  for (const c of cands) {
    if (!c.wikiTitle) continue;
    try {
      const thumb = await wikiThumbnailUrl(c.wikiTitle);
      if (!thumb) continue;
      const dest = await downloadPhoto(c.id, thumb);
      if (!dest) continue;
      c.photo = dest;
      const sampled = samplePhoto(dest);
      if (sampled) {
        c.wall = sampled.wall;
        c.roof = sampled.roof;
      }
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      console.warn(`  [wiki] ${c.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function runBlender(jobPath: string): void {
  const result = spawnSync(
    BLENDER,
    ['--background', '--python', path.join(ROOT, 'scripts/blender_noticed.py'), '--', jobPath],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`Blender exited ${result.status}`);
  }
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry-run');
  console.log('=== Noticed tower factory ===');
  const elements = await loadBuildingElements();
  console.log(`OSM building elements: ${elements.length}`);
  const cands = collectCandidates(elements);
  console.log(`Selected ${cands.length} towers (≥${MIN_NOTICED_HEIGHT_M} m, not landmarks):`);
  for (const c of cands) console.log(`  ${c.heightM.toFixed(0).padStart(3)} m  ${c.name}`);
  if (dry) return;

  await attachPhotos(cands);
  const withPhoto = cands.filter((c) => c.photo).length;
  console.log(`Wikimedia thumbnails: ${withPhoto}/${cands.length}`);

  await mkdir(OUT_DIR, { recursive: true });
  const job = {
    outDir: OUT_DIR,
    buildings: cands.map((c) => ({
      id: c.id,
      name: c.name,
      heightWorld: c.heightM * METERS_TO_WORLD * HEIGHT_SCALE,
      ring: c.ringLocal,
      wall: c.wall,
      roof: c.roof,
      glass: c.glass,
      seed: c.seed,
      photo: c.photo,
    })),
  };
  const jobPath = path.join(CACHE_DIR, 'noticed-job.json');
  await writeFile(jobPath, JSON.stringify(job));
  runBlender(jobPath);

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
    });
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    hash: createHash('sha1').update(files.map((f) => f.id).join('|')).digest('hex').slice(0, 12),
    files,
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${files.length} GLBs to ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
