/**
 * RUNWAY — one-time Overpass → binary city pipeline.
 *
 * Run: `pnpm tsx scripts/fetch-geodata.ts`            (full fetch + process + write)
 *      `pnpm tsx scripts/fetch-geodata.ts --verify`   (decode the committed .bin, no network)
 *
 * Fetches OSM building footprints, streets, parks and water for the exact
 * geo.ts bbox from the public Overpass API, simplifies/triangulates them
 * offline, and writes public/map/london-city.bin + .stats.json. This is the
 * ONLY place the game's geodata touches a network — the shipped app fetches
 * the committed .bin as a same-origin static asset and never calls Overpass.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import earcut from 'earcut';
import { METERS_TO_WORLD, WORLD, project } from '../lib/game/geo';
import {
  decodeCity,
  encodeCity,
  quantizeX,
  quantizeY,
  type CityBuilding,
  type CityData,
  type CityPoly,
  type CityRoad,
} from '../lib/game/render3d/format';
import { classifyBuilding } from '../lib/game/render3d/buildingStyle';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'scripts/.geocache');
const OUT_BIN = path.join(ROOT, 'public/map/london-city.bin');
const OUT_STATS = path.join(ROOT, 'public/map/london-city.stats.json');

const BBOX: BBox = { s: 51.452, w: -0.265, n: 51.552, e: 0.065 };
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const BACKOFFS_MS = [5000, 15000, 45000];
const REQUEST_TIMEOUT_MS = 200_000;
const INTER_REQUEST_SLEEP_MS = 2000;
// Some tiles (esp. the dense historic core) time out on both mirrors as one
// query. Below this span, stop subdividing and report the failure per spec.
const MIN_SPLIT_SPAN_DEG = 0.004; // ~440m at this latitude

const BUILDING_TILE_COLS = 10;
const BUILDING_TILE_ROWS = 4;
const ROAD_TILE_COLS = 2;
const ROAD_TILE_ROWS = 2;

// Real London data blew past the spec's [30,40,50,65] steps (182,897 buildings
// / 8.01 MB at floor=65) — extending per the plan's "Hard gate ≤ 8 MB, else
// raise thresholds" instruction.
const ADAPTIVE_AREA_FLOORS = [30, 40, 50, 65, 90, 120, 160, 220];
const MIN_BUILDING_AREA_M2 = ADAPTIVE_AREA_FLOORS[0];
const MAX_BUILDINGS = 130_000;
const BUILDING_SIMPLIFY_EPS_M = 1.2;
const MAX_BUILDING_VERTS = 250;

const MIN_PARK_AREA_M2 = 8_000;
const MIN_WATER_AREA_M2 = 10_000;
const PARK_WATER_SIMPLIFY_EPS_M = 3;
const ROAD_SIMPLIFY_EPS_M = 2;

const CHUNK_COLS = 8;
const CHUNK_ROWS = 6;
const MAJOR_HEIGHT_M = 20;
const MAJOR_AREA_M2 = 700;

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const M2_PER_WORLD2 = 1 / (METERS_TO_WORLD * METERS_TO_WORLD);

// ---------------------------------------------------------------------------
// Overpass response shapes
// ---------------------------------------------------------------------------

interface BBox {
  s: number;
  w: number;
  n: number;
  e: number;
}

interface LatLon {
  lat: number;
  lon: number;
}

interface OverpassMember {
  type: string;
  ref: number;
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

interface OverpassResponse {
  elements: OverpassElement[];
}

// ---------------------------------------------------------------------------
// Geometry helpers (world-space, i.e. post project())
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

function shoelaceAreaM2(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2) * M2_PER_WORLD2;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function douglasPeuckerOpen(points: Pt[], epsWorld: number): Pt[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let idx = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > epsWorld) {
    const left = douglasPeuckerOpen(points.slice(0, idx + 1), epsWorld);
    const right = douglasPeuckerOpen(points.slice(idx), epsWorld);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function dedupeConsecutive(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-9) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) out.pop();
  }
  return out;
}

/** Simplify a closed ring by anchoring the seam and running DP around it. */
function simplifyRing(ring: Pt[], epsMeters: number): Pt[] {
  const epsWorld = epsMeters * METERS_TO_WORLD;
  const closed = douglasPeuckerOpen([...ring, ring[0]], epsWorld);
  return dedupeConsecutive(closed.slice(0, -1));
}

function simplifyPath(points: Pt[], epsMeters: number): Pt[] {
  const epsWorld = epsMeters * METERS_TO_WORLD;
  return dedupeConsecutive(douglasPeuckerOpen(points, epsWorld));
}

function centroid(ring: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/** Sutherland–Hodgman clip against the WORLD rectangle (0,0)-(width,height). */
function clipToWorldRect(ring: Pt[]): Pt[] {
  const inside: Array<(p: Pt) => boolean> = [
    (p) => p.x >= 0,
    (p) => p.x <= WORLD.width,
    (p) => p.y >= 0,
    (p) => p.y <= WORLD.height,
  ];
  const intersect = (a: Pt, b: Pt, edge: number): Pt => {
    let t: number;
    if (edge === 0) t = (0 - a.x) / (b.x - a.x);
    else if (edge === 1) t = (WORLD.width - a.x) / (b.x - a.x);
    else if (edge === 2) t = (0 - a.y) / (b.y - a.y);
    else t = (WORLD.height - a.y) / (b.y - a.y);
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  let output = ring;
  for (let e = 0; e < inside.length && output.length > 0; e++) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const curr = input[i];
      const prev = input[(i - 1 + input.length) % input.length];
      const currIn = inside[e](curr);
      const prevIn = inside[e](prev);
      if (currIn) {
        if (!prevIn) output.push(intersect(prev, curr, e));
        output.push(curr);
      } else if (prevIn) {
        output.push(intersect(prev, curr, e));
      }
    }
  }
  return output;
}

function hashHeightSeed(id: number): number {
  let h = (id ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0xffffffff; // 0..1
}

function triangulate(ring: Pt[]): number[] {
  const flat: number[] = [];
  for (const p of ring) flat.push(p.x, p.y);
  return earcut(flat);
}

function closeEnough(a: LatLon, b: LatLon): boolean {
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
}

/** Stitch multipolygon "outer" way segments into closed rings, endpoint-to-endpoint. */
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

function ringsFromElement(el: OverpassElement): Pt[][] {
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

// ---------------------------------------------------------------------------
// Overpass fetch: cache, retry with backoff, mirror switch
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Distinguishes "both mirrors exhausted" from other bugs so callers can subdivide-and-retry. */
class BothMirrorsFailedError extends Error {}

async function readCache(file: string): Promise<OverpassResponse | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as OverpassResponse;
  } catch {
    return null;
  }
}

async function writeCache(file: string, data: OverpassResponse): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

async function overpassFetch(query: string, cacheName: string): Promise<OverpassResponse> {
  const cacheFile = path.join(CACHE_DIR, `${cacheName}.json`);
  const cached = await readCache(cacheFile);
  if (cached) {
    console.log(`  [cache] ${cacheName}: ${cached.elements.length} elements`);
    return cached;
  }

  let mirrorIndex = 0;
  let attemptAtMirror = 0;
  for (;;) {
    const endpoint = MIRRORS[mirrorIndex];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass's Apache front end 406s requests with no Accept header
          // (Node's fetch sends none by default) — curl's defaults work fine.
          Accept: '*/*',
          'User-Agent': 'runway-startup-game geodata fetch (one-time offline script)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (res.status === 429 || res.status === 504) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      const json = (await res.json()) as OverpassResponse;
      await writeCache(cacheFile, json);
      console.log(`  [fetch] ${cacheName} via ${endpoint}: ${json.elements.length} elements`);
      await sleep(INTER_REQUEST_SLEEP_MS);
      return json;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attemptAtMirror++;
      console.warn(`  [warn] ${cacheName} via ${endpoint} failed (${message}), attempt ${attemptAtMirror}/3`);
      if (attemptAtMirror >= 3) {
        mirrorIndex++;
        attemptAtMirror = 0;
        if (mirrorIndex >= MIRRORS.length) {
          throw new BothMirrorsFailedError(`Both Overpass mirrors failed persistently for "${cacheName}".`);
        }
        console.warn(`  [warn] switching to mirror ${MIRRORS[mirrorIndex]}`);
        continue;
      }
      await sleep(BACKOFFS_MS[Math.min(attemptAtMirror - 1, BACKOFFS_MS.length - 1)]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function makeTiles(bbox: BBox, cols: number, rows: number): BBox[] {
  const tiles: BBox[] = [];
  const dw = (bbox.e - bbox.w) / cols;
  const dh = (bbox.n - bbox.s) / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        w: bbox.w + col * dw,
        e: bbox.w + (col + 1) * dw,
        s: bbox.s + row * dh,
        n: bbox.s + (row + 1) * dh,
      });
    }
  }
  return tiles;
}

function bboxArg(b: BBox): string {
  return `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;
}

function buildingsQuery(b: BBox): string {
  const box = bboxArg(b);
  return `[out:json][timeout:180];
( way["building"]["building"!~"^(no|entrance)$"](${box});
  relation["building"]["type"="multipolygon"](${box}); );
out geom qt;`;
}

function roadsQuery(b: BBox): string {
  const box = bboxArg(b);
  return `[out:json][timeout:180];
( way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|residential|unclassified|pedestrian|living_street)$"](${box}); );
out geom qt;`;
}

function parksQuery(b: BBox): string {
  const box = bboxArg(b);
  return `[out:json][timeout:180];
( way["leisure"~"^(park|garden|common|recreation_ground|golf_course)$"](${box});
  relation["leisure"~"^(park|garden|common|recreation_ground|golf_course)$"](${box});
  way["landuse"~"^(grass|meadow|forest|cemetery|allotments)$"](${box});
  relation["landuse"~"^(grass|meadow|forest|cemetery|allotments)$"](${box});
  way["natural"="wood"](${box});
  relation["natural"="wood"](${box}); );
out geom qt;`;
}

function waterQuery(b: BBox): string {
  const box = bboxArg(b);
  return `[out:json][timeout:180];
( way["natural"="water"](${box});
  relation["natural"="water"](${box});
  way["waterway"="riverbank"](${box}); );
out geom qt;`;
}

function mergeElements(responses: OverpassResponse[]): Map<string, OverpassElement> {
  const map = new Map<string, OverpassElement>();
  for (const res of responses) {
    for (const el of res.elements) map.set(`${el.type}/${el.id}`, el);
  }
  return map;
}

/**
 * Fetch one bbox; if it's too heavy for both mirrors, subdivide into 2×2 and
 * retry each quarter (recursively) instead of failing the whole tile. Only
 * bottoms out to a hard failure once a quarter-tile is already at the
 * minimum split size and still fails on both mirrors.
 */
async function fetchBboxWithSplit(
  bbox: BBox,
  queryFn: (b: BBox) => string,
  cacheName: string,
): Promise<OverpassResponse[]> {
  try {
    return [await overpassFetch(queryFn(bbox), cacheName)];
  } catch (err) {
    if (!(err instanceof BothMirrorsFailedError)) throw err;
    if (bbox.n - bbox.s <= MIN_SPLIT_SPAN_DEG && bbox.e - bbox.w <= MIN_SPLIT_SPAN_DEG) {
      throw new Error(
        `Both Overpass mirrors failed persistently for "${cacheName}", even at the minimum tile size. ` +
          `Stopping — do not substitute a keyed/paid service.`,
      );
    }
    console.warn(`  [split] ${cacheName} too heavy for both mirrors — subdividing into quarters.`);
    const quarters = makeTiles(bbox, 2, 2);
    const results: OverpassResponse[] = [];
    for (let i = 0; i < quarters.length; i++) {
      results.push(...(await fetchBboxWithSplit(quarters[i], queryFn, `${cacheName}-${i}`)));
    }
    return results;
  }
}

async function fetchTiledMerged(
  tiles: BBox[],
  queryFn: (b: BBox) => string,
  namePrefix: string,
): Promise<Map<string, OverpassElement>> {
  const responses: OverpassResponse[] = [];
  for (let i = 0; i < tiles.length; i++) {
    console.log(`Fetching ${namePrefix} tile ${i + 1}/${tiles.length}...`);
    const tileName = `${namePrefix}-${String(i).padStart(2, '0')}`;
    responses.push(...(await fetchBboxWithSplit(tiles[i], queryFn, tileName)));
  }
  return mergeElements(responses);
}

// ---------------------------------------------------------------------------
// Per-class extraction/processing
// ---------------------------------------------------------------------------

interface ProcessedBuilding {
  ring: Pt[];
  areaM2: number;
  heightM: number;
  major: boolean;
  chunkId: number;
  style: number;
  roof: number;
}

function extractBuildings(elements: Map<string, OverpassElement>): ProcessedBuilding[] {
  const out: ProcessedBuilding[] = [];
  for (const el of elements.values()) {
    const tags = el.tags ?? {};
    if (tags['building:part']) continue;
    if (el.type === 'way' && (!tags.building || /^(no|entrance)$/.test(tags.building))) continue;
    if (el.type === 'relation' && tags.type !== 'multipolygon') continue;

    for (const rawRing of ringsFromElement(el)) {
      if (shoelaceAreaM2(rawRing) < MIN_BUILDING_AREA_M2) continue;
      const simplified = simplifyRing(rawRing, BUILDING_SIMPLIFY_EPS_M);
      if (simplified.length < 3 || simplified.length > MAX_BUILDING_VERTS) continue;
      const areaM2 = shoelaceAreaM2(simplified);
      if (areaM2 < MIN_BUILDING_AREA_M2) continue;

      const tagHeight = parseFloat(tags.height ?? '');
      const tagLevels = parseFloat(tags['building:levels'] ?? '');
      let heightM: number;
      if (Number.isFinite(tagHeight) && tagHeight > 0) heightM = tagHeight;
      else if (Number.isFinite(tagLevels) && tagLevels > 0) heightM = tagLevels * 3.2 + 3;
      else heightM = 7 + hashHeightSeed(el.id) * 10 + Math.sqrt(areaM2) / 8;
      heightM = Math.max(3, Math.min(255, Math.round(heightM)));

      const c = centroid(simplified);
      const col = Math.max(0, Math.min(CHUNK_COLS - 1, Math.floor((c.x / WORLD.width) * CHUNK_COLS)));
      const row = Math.max(0, Math.min(CHUNK_ROWS - 1, Math.floor((c.y / WORLD.height) * CHUNK_ROWS)));
      const major = heightM >= MAJOR_HEIGHT_M || areaM2 >= MAJOR_AREA_M2;
      const { style, roof } = classifyBuilding(tags, heightM, areaM2);

      out.push({ ring: simplified, areaM2, heightM, major, chunkId: row * CHUNK_COLS + col, style, roof });
    }
  }
  return out;
}

function applyAdaptiveCap(buildings: ProcessedBuilding[]): { kept: ProcessedBuilding[]; floor: number } {
  for (const floor of ADAPTIVE_AREA_FLOORS) {
    const kept = buildings.filter((b) => b.major || b.areaM2 >= floor);
    const isLast = floor === ADAPTIVE_AREA_FLOORS[ADAPTIVE_AREA_FLOORS.length - 1];
    if (kept.length <= MAX_BUILDINGS || isLast) return { kept, floor };
  }
  return { kept: buildings, floor: ADAPTIVE_AREA_FLOORS[0] };
}

function toCityBuilding(b: ProcessedBuilding): CityBuilding {
  const verts = new Uint16Array(b.ring.length * 2);
  for (let i = 0; i < b.ring.length; i++) {
    verts[i * 2] = quantizeX(b.ring[i].x);
    verts[i * 2 + 1] = quantizeY(b.ring[i].y);
  }
  return {
    major: b.major,
    heightM: b.heightM,
    chunkId: b.chunkId,
    style: b.style,
    roof: b.roof,
    verts,
    indices: Uint8Array.from(triangulate(b.ring)),
  };
}

function roadTier(highway: string): number {
  if (/^(motorway|motorway_link|trunk|trunk_link|primary|primary_link)$/.test(highway)) return 0;
  if (/^(secondary|secondary_link|tertiary)$/.test(highway)) return 1;
  return 2;
}

function extractRoads(elements: Map<string, OverpassElement>): CityRoad[] {
  const out: CityRoad[] = [];
  for (const el of elements.values()) {
    if (el.type !== 'way' || !el.tags?.highway || !el.geometry || el.geometry.length < 2) continue;
    const ring = el.geometry.map((g) => project([g.lon, g.lat]));
    const simplified = simplifyPath(ring, ROAD_SIMPLIFY_EPS_M);
    if (simplified.length < 2) continue;
    const pts = new Uint16Array(simplified.length * 2);
    for (let i = 0; i < simplified.length; i++) {
      pts[i * 2] = quantizeX(simplified[i].x);
      pts[i * 2 + 1] = quantizeY(simplified[i].y);
    }
    out.push({ tier: roadTier(el.tags.highway), pts });
  }
  return out;
}

function extractPolys(elements: Map<string, OverpassElement>, minAreaM2: number, clip: boolean): CityPoly[] {
  const out: CityPoly[] = [];
  for (const el of elements.values()) {
    for (const rawRing of ringsFromElement(el)) {
      const ring = clip ? clipToWorldRect(rawRing) : rawRing;
      if (ring.length < 3 || shoelaceAreaM2(ring) < minAreaM2) continue;
      const simplified = simplifyRing(ring, PARK_WATER_SIMPLIFY_EPS_M);
      if (simplified.length < 3 || shoelaceAreaM2(simplified) < minAreaM2) continue;
      const tris = triangulate(simplified);
      if (tris.length === 0) continue;
      const verts = new Uint16Array(simplified.length * 2);
      for (let i = 0; i < simplified.length; i++) {
        verts[i * 2] = quantizeX(simplified[i].x);
        verts[i * 2 + 1] = quantizeY(simplified[i].y);
      }
      out.push({ verts, indices: Uint16Array.from(tris) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printStats(data: CityData, byteLength: number): void {
  const major = data.buildings.filter((b) => b.major).length;
  const byStyle = new Map<number, number>();
  for (const b of data.buildings) byStyle.set(b.style, (byStyle.get(b.style) ?? 0) + 1);
  console.log(`  buildings: ${data.buildings.length} (${major} major, ${data.buildings.length - major} minor)`);
  console.log(
    `  styles: ${[...byStyle.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}`,
  );
  console.log(
    `  roads: ${data.roads.length} (tier0 ${data.roads.filter((r) => r.tier === 0).length}, ` +
      `tier1 ${data.roads.filter((r) => r.tier === 1).length}, tier2 ${data.roads.filter((r) => r.tier === 2).length})`,
  );
  console.log(`  parks: ${data.parks.length}`);
  console.log(`  water: ${data.water.length}`);
  console.log(`  size: ${(byteLength / (1024 * 1024)).toFixed(2)} MB`);
}

function typedArrayReplacer(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value;
}

function deepEqualCityData(a: CityData, b: CityData): boolean {
  return JSON.stringify(a, typedArrayReplacer) === JSON.stringify(b, typedArrayReplacer);
}

async function runVerify(): Promise<void> {
  console.log(`Verifying ${OUT_BIN} (decode only, no network) ...`);
  const buf = await readFile(OUT_BIN);
  const data = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  printStats(data, buf.byteLength);
  console.log('OK.');
}

async function main(): Promise<void> {
  if (process.argv.includes('--verify')) {
    await runVerify();
    return;
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(path.dirname(OUT_BIN), { recursive: true });

  console.log('=== Buildings ===');
  const buildingElements = await fetchTiledMerged(
    makeTiles(BBOX, BUILDING_TILE_COLS, BUILDING_TILE_ROWS),
    buildingsQuery,
    'buildings',
  );
  console.log(`Merged ${buildingElements.size} unique building elements.`);
  const rawBuildings = extractBuildings(buildingElements);
  console.log(`Processed ${rawBuildings.length} candidate building footprints.`);
  const { kept, floor } = applyAdaptiveCap(rawBuildings);
  console.log(`Adaptive area floor: ${floor} m² -> ${kept.length} buildings.`);
  const buildings = kept.map(toCityBuilding);

  console.log('=== Roads ===');
  const roadElements = await fetchTiledMerged(
    makeTiles(BBOX, ROAD_TILE_COLS, ROAD_TILE_ROWS),
    roadsQuery,
    'roads',
  );
  console.log(`Merged ${roadElements.size} unique road elements.`);
  const roads = extractRoads(roadElements);
  console.log(`Processed ${roads.length} roads.`);

  console.log('=== Parks ===');
  const parkElements = mergeElements(await fetchBboxWithSplit(BBOX, parksQuery, 'parks'));
  const parks = extractPolys(parkElements, MIN_PARK_AREA_M2, false);
  console.log(`Processed ${parks.length} parks.`);

  console.log('=== Water ===');
  const waterElements = mergeElements(await fetchBboxWithSplit(BBOX, waterQuery, 'water'));
  const water = extractPolys(waterElements, MIN_WATER_AREA_M2, true);
  console.log(`Processed ${water.length} water polygons.`);

  const data: CityData = { buildings, roads, parks, water };

  console.log('=== Encoding ===');
  const encoded = encodeCity(data);
  if (!deepEqualCityData(data, decodeCity(encoded))) {
    throw new Error('Round-trip verification failed: decode(encode(data)) !== data');
  }
  console.log('Round-trip encode/decode verified.');

  if (encoded.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error(
      `Output is ${(encoded.byteLength / (1024 * 1024)).toFixed(2)} MB, over the 8 MB hard gate. ` +
        `Raise area floors / MAX_BUILDINGS in scripts/fetch-geodata.ts and re-run.`,
    );
  }

  await writeFile(OUT_BIN, Buffer.from(encoded));
  await writeFile(
    OUT_STATS,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        bbox: BBOX,
        endpoints: MIRRORS,
        thresholds: {
          adaptiveAreaFloors: ADAPTIVE_AREA_FLOORS,
          adaptiveAreaFloorUsed: floor,
          maxBuildings: MAX_BUILDINGS,
          minParkAreaM2: MIN_PARK_AREA_M2,
          minWaterAreaM2: MIN_WATER_AREA_M2,
        },
        counts: {
          buildings: buildings.length,
          buildingsMajor: buildings.filter((b) => b.major).length,
          buildingsMinor: buildings.filter((b) => !b.major).length,
          roads: roads.length,
          roadsTier0: roads.filter((r) => r.tier === 0).length,
          roadsTier1: roads.filter((r) => r.tier === 1).length,
          roadsTier2: roads.filter((r) => r.tier === 2).length,
          parks: parks.length,
          water: water.length,
        },
        byteSize: encoded.byteLength,
      },
      null,
      2,
    ),
  );

  console.log('=== Done ===');
  printStats(data, encoded.byteLength);
  console.log(`Wrote ${OUT_BIN}`);
  console.log(`Wrote ${OUT_STATS}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
