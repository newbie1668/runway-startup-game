/**
 * F1 — Charlotte Street pilot source audit.
 *
 * Run: `pnpm tsx scripts/audit-street-sources.ts`            (fetch free sources into the cache, then build)
 *      `pnpm tsx scripts/audit-street-sources.ts --offline`  (rebuild the inventory from cached responses only)
 *
 * Builds a per-entity, per-field source-coverage inventory for the 273 m
 * Percy Street – Tottenham Street route from the pinned OpenStreetMap
 * extract (docs/runway-recovery/evidence/F1/map-source.osm.xml.gz) plus a
 * small supplementary extract that closes the pinned source's southern
 * boundary gap, and joins it to free/public sources: Wikimedia Commons
 * geotagged files (which mirror Geograph), Camden's "Trees In Camden" open
 * dataset and Historic England's NHLE listed-building points. Every network
 * response is cached with its URL, retrieval time and SHA-256 so the build
 * step is reproducible offline. Nothing here touches runtime code or assets.
 *
 * Outputs (docs/runway-recovery/evidence/F1/source-audit/):
 *   source-audit.json    machine-readable inventory, matches, control points
 *   source-coverage.md   generated per-entity coverage tables
 *   cache/*.json         raw source responses with retrieval metadata
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const F1_DIR = path.join(ROOT, 'docs/runway-recovery/evidence/F1');
const OUT_DIR = path.join(F1_DIR, 'source-audit');
const CACHE_DIR = path.join(OUT_DIR, 'cache');
const PINNED_OSM = path.join(F1_DIR, 'map-source.osm.xml.gz');
const PINNED_OSM_SHA256 = '17e8d0ca27890f094414bf7d780d4508d5468089b8ee78f862af2feb6faf9972';
const INVENTORY_JSON = path.join(F1_DIR, 'map-inventory.json');

const OFFLINE = process.argv.includes('--offline');
const USER_AGENT =
  'runway-f1-street-source-audit/0.1 (docs research; github.com/newbie1668/runway-startup-game)';

/** Supplementary OSM window covering the 35 m building buffer south/east of the Percy Street junction. */
const SUPPLEMENT_BBOX = { w: -0.1352, s: 51.5175, e: -0.1332, n: 51.5185 };

/** Commons files whose label was already rejected as an identity match by an accepted F1 review (feasibility.md / frontage-source-cards.md). */
const REJECTED_COMMONS_FILES: Record<string, string> = {
  'File:30 Charlotte Street, Fitzrovia, May 2023.jpg':
    'linked Historic England entry 1379038 is 30 Tottenham Street; two-bay brick building conflicts with the 28 Charlotte Street photo (feasibility.md, frontage-source-cards.md)',
};

/** Frontage rule (see source-coverage.md for the prose statement). */
const FRONTAGE_MAX_EDGE_DIST_M = 16; // centreline to facade edge midpoint
const FRONTAGE_MAX_ANGLE_DEG = 30; // facade edge vs. nearest route segment
const FRONTAGE_MIN_EDGE_M = 2;
const FRONTAGE_CHAINAGE_SLACK_M = 6; // include corner plots at the two junctions
const OBJECT_BUFFER_M = 14; // street objects between the two building lines
const PHOTO_ROUTE_BUFFER_M = 45; // camera position considered "on the route"
const PHOTO_FRONTAGE_MATCH_M = 30; // camera position near a frontage midpoint

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface LngLat {
  longitude: number;
  latitude: number;
}
interface XY {
  x: number;
  y: number;
}

const LAT_SCALE = 110_540;
const LON_SCALE = 111_320;

function makeProjector(origin: LngLat) {
  const cos = Math.cos((origin.latitude * Math.PI) / 180);
  return (p: LngLat): XY => ({
    x: (p.longitude - origin.longitude) * LON_SCALE * cos,
    y: (p.latitude - origin.latitude) * LAT_SCALE,
  });
}

interface RouteHit {
  distanceM: number;
  chainageM: number;
  /** +1 = left of travel (west when travelling north), -1 = right (east). */
  side: 1 | -1;
  segmentIndex: number;
}

class Route {
  readonly pts: XY[];
  readonly cum: number[] = [0];
  readonly lengthM: number;
  constructor(pts: XY[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    this.lengthM = this.cum[this.cum.length - 1];
  }
  nearest(p: XY): RouteHit {
    let best: RouteHit = { distanceM: Infinity, chainageM: 0, side: 1, segmentIndex: 0 };
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = a.x + t * dx;
      const qy = a.y + t * dy;
      const d = Math.hypot(p.x - qx, p.y - qy);
      if (d < best.distanceM) {
        const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
        best = {
          distanceM: d,
          chainageM: this.cum[i - 1] + t * Math.sqrt(len2),
          side: cross >= 0 ? 1 : -1,
          segmentIndex: i - 1,
        };
      }
    }
    return best;
  }
  segmentAngleDeg(i: number): number {
    const a = this.pts[i];
    const b = this.pts[i + 1];
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  }
}

function angleDiffDeg(a: number, b: number): number {
  let d = Math.abs((((a - b) % 180) + 180) % 180);
  if (d > 90) d = 180 - d;
  return d;
}

function polygonAreaM2(ring: XY[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++)
    s += ring[i].x * ring[i + 1].y - ring[i + 1].x * ring[i].y;
  return Math.abs(s) / 2;
}

function round(v: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------
// OSM XML
// ---------------------------------------------------------------------------

interface OsmNode extends LngLat {
  id: string;
  version: number;
  timestamp: string;
  tags: Record<string, string>;
}
interface OsmWay {
  id: string;
  version: number;
  timestamp: string;
  nodeRefs: string[];
  tags: Record<string, string>;
}
interface OsmRelation {
  id: string;
  version: number;
  timestamp: string;
  members: { type: string; ref: string; role: string }[];
  tags: Record<string, string>;
}
interface OsmData {
  nodes: Map<string, OsmNode>;
  ways: Map<string, OsmWay>;
  relations: Map<string, OsmRelation>;
}

function attr(src: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(src);
  return m ? decodeXml(m[1]) : undefined;
}

function decodeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** True when an NHLE list-entry name (e.g. "2-6, CHARLOTTE STREET" or "24 AND 26, CHARLOTTE STREET") names this house number on this street. */
function nhleNameCoversAddress(
  name: string,
  housenumber: string | undefined,
  street: string | undefined,
): boolean {
  if (!housenumber || !street) return false;
  if (!name.toUpperCase().includes(street.toUpperCase())) return false;
  const wanted = housenumber
    .split(/[-,;]/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (wanted.length === 0) return false;
  const covered = new Set<number>();
  const streetPart = name.toUpperCase().split(street.toUpperCase())[0];
  for (const m of streetPart.matchAll(/(\d+)\s*(?:-|–|TO)\s*(\d+)|(\d+)/g)) {
    if (m[1] && m[2]) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      for (let n = lo; n <= hi; n += (hi - lo) % 2 === 0 ? 2 : 1) covered.add(n);
    } else if (m[3]) covered.add(Number(m[3]));
  }
  return wanted.every((n) => covered.has(n));
}

function captureYear(date: string | null): number | null {
  const m = date?.match(/\b(1[89]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

function parseTags(body: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const m of body.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g))
    tags[decodeXml(m[1])] = decodeXml(m[2]);
  return tags;
}

function parseOsmXml(xml: string, into: OsmData): void {
  for (const m of xml.matchAll(/<node\s([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const head = m[1];
    const id = attr(head, 'id')!;
    if (into.nodes.has(id)) continue;
    into.nodes.set(id, {
      id,
      version: Number(attr(head, 'version')),
      timestamp: attr(head, 'timestamp') ?? '',
      latitude: Number(attr(head, 'lat')),
      longitude: Number(attr(head, 'lon')),
      tags: parseTags(m[3] ?? ''),
    });
  }
  for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const id = attr(m[1], 'id')!;
    if (into.ways.has(id)) continue;
    into.ways.set(id, {
      id,
      version: Number(attr(m[1], 'version')),
      timestamp: attr(m[1], 'timestamp') ?? '',
      nodeRefs: [...m[2].matchAll(/<nd\s+ref="(\d+)"/g)].map((x) => x[1]),
      tags: parseTags(m[2]),
    });
  }
  for (const m of xml.matchAll(/<relation\s([^>]*?)>([\s\S]*?)<\/relation>/g)) {
    const id = attr(m[1], 'id')!;
    if (into.relations.has(id)) continue;
    into.relations.set(id, {
      id,
      version: Number(attr(m[1], 'version')),
      timestamp: attr(m[1], 'timestamp') ?? '',
      members: [...m[2].matchAll(/<member\s+type="(\w+)"\s+ref="(\d+)"\s+role="([^"]*)"/g)].map(
        (x) => ({
          type: x[1],
          ref: x[2],
          role: x[3],
        }),
      ),
      tags: parseTags(m[2]),
    });
  }
}

// ---------------------------------------------------------------------------
// Cached fetch
// ---------------------------------------------------------------------------

interface CacheEnvelope {
  url: string;
  retrievedAt: string;
  status: number;
  sha256: string;
  body: string;
}

function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

async function cachedFetch(
  name: string,
  url: string,
  init?: RequestInit,
  cacheFailures = false,
): Promise<CacheEnvelope> {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as CacheEnvelope;
  if (OFFLINE) throw new Error(`offline and no cache for ${name} (${url})`);
  let res: Response | null = null;
  let body = '';
  for (const backoffMs of [0, 5000, 20000, 60000]) {
    if (backoffMs) await new Promise((r) => setTimeout(r, backoffMs));
    res = await fetch(url, {
      ...init,
      headers: { 'user-agent': USER_AGENT, ...(init?.headers ?? {}) },
    });
    body = await res.text();
    if (res.status !== 429 && res.status < 500) break;
    console.warn(`${name}: HTTP ${res.status}, retrying`);
  }
  const env: CacheEnvelope = {
    url,
    retrievedAt: new Date().toISOString(),
    status: res!.status,
    sha256: sha256(body),
    body,
  };
  mkdirSync(CACHE_DIR, { recursive: true });
  // Only successful and definitive client responses are cached; transient failures are retried next run.
  if (cacheFailures || (env.status < 500 && env.status !== 429))
    writeFileSync(file, JSON.stringify(env, null, 1));
  console.log(`fetched ${name}: HTTP ${env.status}, ${body.length} bytes`);
  await new Promise((r) => setTimeout(r, 2000));
  return env;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

interface CommonsFile {
  title: string;
  pageUrl: string;
  cameraPosition: LngLat | null;
  objectPosition: LngLat | null;
  captureDate: string | null;
  license: string | null;
  artist: string | null;
  description: string | null;
  categories: string[];
  width: number | null;
  height: number | null;
  mirroredFrom: 'geograph' | null;
}

async function fetchCommons(route: Route, unproject: (p: XY) => LngLat) {
  // Eight geosearch circles (radius 60 m, ~39 m apart) cover the 45 m route band without hitting the 500-result cap; plus the "Charlotte Street, London" category.
  const centres = [0, 1, 2, 3, 4, 5, 6, 7]
    .map((i) => i / 7)
    .map((f) => {
      const target = f * route.lengthM;
      for (let i = 1; i < route.pts.length; i++) {
        if (route.cum[i] >= target) {
          const t = (target - route.cum[i - 1]) / (route.cum[i] - route.cum[i - 1]);
          return unproject({
            x: route.pts[i - 1].x + t * (route.pts[i].x - route.pts[i - 1].x),
            y: route.pts[i - 1].y + t * (route.pts[i].y - route.pts[i - 1].y),
          });
        }
      }
      return unproject(route.pts[route.pts.length - 1]);
    });
  const titles = new Set<string>();
  const geosearchDist = new Map<string, number>();
  const capped: number[] = [];
  for (let i = 0; i < centres.length; i++) {
    const c = centres[i];
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=${c.latitude.toFixed(6)}|${c.longitude.toFixed(6)}` +
      `&gsradius=60&gsnamespace=6&gslimit=500&gsprimary=all&format=json`;
    const env = await cachedFetch(`commons-geosearch-${i}`, url);
    if (env.status !== 200) throw new Error(`commons geosearch ${i}: HTTP ${env.status}`);
    const json = JSON.parse(env.body) as {
      query?: { geosearch: { title: string; dist: number }[] };
    };
    const n = json.query?.geosearch?.length ?? 0;
    if (n >= 500) capped.push(i);
    for (const g of json.query?.geosearch ?? []) {
      titles.add(g.title);
      geosearchDist.set(g.title, Math.min(geosearchDist.get(g.title) ?? Infinity, g.dist));
    }
  }
  const catUrl =
    'https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Charlotte_Street,_London&cmnamespace=6&cmlimit=500&format=json';
  const catEnv = await cachedFetch('commons-category-charlotte-street', catUrl);
  const catJson = JSON.parse(catEnv.body) as { query?: { categorymembers: { title: string }[] } };
  const categoryTitles = new Set((catJson.query?.categorymembers ?? []).map((m) => m.title));
  for (const t of categoryTitles) titles.add(t);

  const files: CommonsFile[] = [];
  const list = [...titles].sort();
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const url =
      'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo|coordinates|categories&iiprop=url|size|extmetadata' +
      '&iiextmetadatafilter=DateTimeOriginal|LicenseShortName|Artist|ImageDescription|ObjectName&coprop=type|dim&coprimary=all&cllimit=50' +
      `&titles=${encodeURIComponent(batch.join('|'))}&format=json`;
    const env = await cachedFetch(`commons-imageinfo-${String(i / 50).padStart(2, '0')}`, url);
    if (env.status !== 200)
      throw new Error(`commons imageinfo batch ${i / 50}: HTTP ${env.status}`);
    const json = JSON.parse(env.body) as {
      query?: {
        pages: Record<
          string,
          {
            title: string;
            imageinfo?: {
              descriptionurl: string;
              width: number;
              height: number;
              extmetadata?: Record<string, { value: string }>;
            }[];
            coordinates?: { lat: number; lon: number; primary?: string; type?: string }[];
            categories?: { title: string }[];
          }
        >;
      };
    };
    for (const page of Object.values(json.query?.pages ?? {})) {
      const ii = page.imageinfo?.[0];
      const meta = ii?.extmetadata ?? {};
      const strip = (v?: string) =>
        v
          ? v
              .replace(/<[^>]+>/g, '')
              .replace(/\s+/g, ' ')
              .trim()
          : null;
      const coords = page.coordinates ?? [];
      const cam =
        coords.find((c) => c.primary !== undefined && c.type !== 'object') ??
        coords.find((c) => c.type !== 'object') ??
        null;
      const obj = coords.find((c) => c.type === 'object') ?? null;
      files.push({
        title: page.title,
        pageUrl:
          ii?.descriptionurl ??
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        cameraPosition: cam ? { latitude: cam.lat, longitude: cam.lon } : null,
        objectPosition: obj ? { latitude: obj.lat, longitude: obj.lon } : null,
        captureDate: strip(meta.DateTimeOriginal?.value),
        license: strip(meta.LicenseShortName?.value),
        artist: strip(meta.Artist?.value),
        description: strip(meta.ImageDescription?.value),
        categories: (page.categories ?? []).map((c) => c.title.replace(/^Category:/, '')),
        width: ii?.width ?? null,
        height: ii?.height ?? null,
        mirroredFrom: /geograph\.org\.uk/i.test(page.title) ? 'geograph' : null,
      });
    }
  }
  return { files, categoryTitles, geosearchDist, centres, capped };
}

interface CamdenTree {
  identifier: string;
  siteName: string;
  commonName: string | null;
  scientificName: string | null;
  heightM: number | null;
  spreadM: number | null;
  maturity: string | null;
  inspectionDate: string | null;
  position: LngLat | null;
  spatialAccuracy: string | null;
}

async function fetchCamdenTrees(): Promise<{ trees: CamdenTree[]; envelope: CacheEnvelope }> {
  const url =
    'https://opendata.camden.gov.uk/resource/csqp-kdss.json?$limit=500&$where=' +
    encodeURIComponent('within_box(location,51.5210,-0.1375,51.5172,-0.1330)');
  const env = await cachedFetch('camden-trees', url);
  const rows = JSON.parse(env.body) as Record<string, string | undefined>[];
  const num = (v?: string) => (v === undefined || v === '' ? null : Number(v));
  return {
    envelope: env,
    trees: rows.map((r) => ({
      identifier: r.identifier ?? '',
      siteName: r.site_name ?? '',
      commonName: r.common_name ?? null,
      scientificName: r.scientific_name ?? null,
      heightM: num(r.height_in_metres),
      spreadM: num(r.spread_in_metres),
      maturity: r.maturity ?? null,
      inspectionDate: r.inspection_date ? r.inspection_date.slice(0, 10) : null,
      position:
        r.latitude && r.longitude
          ? { latitude: Number(r.latitude), longitude: Number(r.longitude) }
          : null,
      spatialAccuracy: r.spatial_accuracy ?? null,
    })),
  };
}

interface NhleEntry {
  listEntry: number;
  name: string;
  grade: string;
  listDate: string | null;
  hyperlink: string;
  position: LngLat | null;
}

async function fetchNhle(): Promise<{ entries: NhleEntry[]; envelope: CacheEnvelope }> {
  const url =
    'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query' +
    '?where=1%3D1&geometry=-0.1375,51.5172,-0.1330,51.5210&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects' +
    '&outFields=ListEntry,Name,Grade,ListDate,hyperlink&outSR=4326&f=json';
  const env = await cachedFetch('nhle-listed-buildings', url);
  const json = JSON.parse(env.body) as {
    features?: {
      attributes: Record<string, string | number | null>;
      geometry?: { points?: number[][]; x?: number; y?: number };
    }[];
  };
  return {
    envelope: env,
    entries: (json.features ?? []).map((f) => {
      const pt =
        f.geometry?.points?.[0] ??
        (f.geometry?.x !== undefined ? [f.geometry.x, f.geometry.y!] : null);
      return {
        listEntry: Number(f.attributes.ListEntry),
        name: String(f.attributes.Name ?? ''),
        grade: String(f.attributes.Grade ?? ''),
        listDate: f.attributes.ListDate
          ? new Date(Number(f.attributes.ListDate)).toISOString().slice(0, 10)
          : null,
        hyperlink: String(
          f.attributes.hyperlink ??
            `https://historicengland.org.uk/listing/the-list/list-entry/${f.attributes.ListEntry}`,
        ),
        position: pt ? { longitude: pt[0], latitude: pt[1] } : null,
      };
    }),
  };
}

interface ProbeResult {
  name: string;
  url: string;
  status: number | 'not-attempted' | 'error';
  verdict: string;
  retrievedAt: string | null;
}

async function probe(
  name: string,
  url: string,
  verdictFor: (status: number, body: string) => string,
): Promise<ProbeResult> {
  try {
    const env = await cachedFetch(`probe-${name}`, url, undefined, true);
    return {
      name,
      url,
      status: env.status,
      verdict: verdictFor(env.status, env.body),
      retrievedAt: env.retrievedAt,
    };
  } catch (err) {
    return {
      name,
      url,
      status: OFFLINE ? 'not-attempted' : 'error',
      verdict: String(err),
      retrievedAt: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Inventory model
// ---------------------------------------------------------------------------

type EvidenceState = 'map-reported' | 'observed' | 'inferred' | 'unknown';

interface FieldCoverage {
  state: EvidenceState;
  value: string | number | null;
  sources: string[];
  note?: string;
}

interface PhotoMatch {
  title: string;
  pageUrl: string;
  captureDate: string | null;
  license: string | null;
  tier:
    | 'title-address'
    | 'description-address'
    | 'name-match'
    | 'camera-within-30m'
    | 'rejected-by-review';
  rejectionReason?: string;
  cameraDistanceM: number | null;
  needsVisualVerification: true;
}

interface FrontageEntity {
  sourceId: string;
  url: string;
  version: number;
  sourceTimestamp: string;
  address: string | null;
  name: string | null;
  side: 'west' | 'east';
  chainageStartM: number;
  chainageEndM: number;
  frontageLengthM: number;
  facadeDistanceM: number;
  footprintAreaM2: number;
  osmSource: 'pinned' | 'supplement';
  tags: Record<string, string>;
  fields: Record<string, FieldCoverage>;
  photoMatches: PhotoMatch[];
  listedBuilding: {
    listEntry: number;
    grade: string;
    name: string;
    hyperlink: string;
    distanceM: number;
    nameMatchesAddress: boolean;
  } | null;
  missingViews: string[];
}

interface ObjectEntity {
  sourceId: string;
  url: string;
  kind:
    | 'tree'
    | 'crossing'
    | 'sign'
    | 'lamp'
    | 'bench'
    | 'cycle_parking'
    | 'cycle_hire'
    | 'waste_basket'
    | 'artwork'
    | 'motorcycle_parking'
    | 'other';
  side: 'west' | 'east' | 'on-centreline';
  chainageM: number;
  distanceM: number;
  position: LngLat;
  tags: Record<string, string>;
  fields: Record<string, FieldCoverage>;
  camdenMatch: {
    identifier: string;
    commonName: string | null;
    heightM: number | null;
    spreadM: number | null;
    inspectionDate: string | null;
    distanceM: number;
  } | null;
}

function classifyObject(tags: Record<string, string>): ObjectEntity['kind'] | null {
  if (tags.natural === 'tree') return 'tree';
  if (tags.highway === 'crossing') return 'crossing';
  if (tags.highway === 'street_lamp') return 'lamp';
  if (
    tags.traffic_sign ||
    tags.highway === 'give_way' ||
    tags.highway === 'traffic_signals' ||
    tags.highway === 'stop'
  )
    return 'sign';
  if (tags.amenity === 'bench') return 'bench';
  if (tags.amenity === 'bicycle_parking') return 'cycle_parking';
  if (tags.amenity === 'bicycle_rental') return 'cycle_hire';
  if (tags.amenity === 'waste_basket') return 'waste_basket';
  if (tags.amenity === 'motorcycle_parking') return 'motorcycle_parking';
  if (tags.tourism === 'artwork') return 'artwork';
  if (
    tags.amenity === 'post_box' ||
    tags.amenity === 'telephone' ||
    tags.barrier === 'bollard' ||
    tags.emergency === 'fire_hydrant'
  )
    return 'other';
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. Pinned OSM source + route.
  const rawGz = readFileSync(PINNED_OSM);
  const raw = gunzipSync(rawGz);
  const rawSha = sha256(raw);
  if (rawSha !== PINNED_OSM_SHA256) throw new Error(`pinned OSM hash mismatch: ${rawSha}`);
  const inventory = JSON.parse(readFileSync(INVENTORY_JSON, 'utf8')) as {
    route: {
      coordinatesWgs84: LngLat[];
      endpointNodeIds: string[];
      roadWayIds: string[];
      approxCenterlineLengthM: number;
    };
  };
  const osm: OsmData = { nodes: new Map(), ways: new Map(), relations: new Map() };
  parseOsmXml(raw.toString('utf8'), osm);
  const pinnedWayIds = new Set(osm.ways.keys());

  // 2. Supplementary extract for the southern/eastern boundary gap.
  const suppUrl = `https://api.openstreetmap.org/api/0.6/map?bbox=${SUPPLEMENT_BBOX.w},${SUPPLEMENT_BBOX.s},${SUPPLEMENT_BBOX.e},${SUPPLEMENT_BBOX.n}`;
  let supplement: CacheEnvelope | null = null;
  try {
    supplement = await cachedFetch('osm-supplement-south', suppUrl);
    if (supplement.status === 200) parseOsmXml(supplement.body, osm);
  } catch (err) {
    console.warn(`supplement unavailable: ${String(err)}`);
  }

  const origin = inventory.route.coordinatesWgs84[0];
  const project = makeProjector(origin);
  const cos = Math.cos((origin.latitude * Math.PI) / 180);
  const unproject = (p: XY): LngLat => ({
    longitude: origin.longitude + p.x / (LON_SCALE * cos),
    latitude: origin.latitude + p.y / LAT_SCALE,
  });
  const route = new Route(inventory.route.coordinatesWgs84.map(project));
  const sideName = (s: 1 | -1): 'west' | 'east' => (s === 1 ? 'west' : 'east'); // travel is south→north

  // 3. Street-facing frontages.
  const frontages: FrontageEntity[] = [];
  const buildingWaysConsidered: string[] = [];
  const unresolvedBuildingRelations: string[] = [];
  for (const way of osm.ways.values()) {
    if (!way.tags.building && !way.tags['building:part']) continue;
    const ring = way.nodeRefs.map((r) => osm.nodes.get(r)).filter((n): n is OsmNode => !!n);
    if (ring.length < 4 || ring.length !== way.nodeRefs.length) continue;
    const xy = ring.map(project);
    buildingWaysConsidered.push(way.id);
    let facing: { start: number; end: number; dist: number; side: 1 | -1; len: number }[] = [];
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i];
      const b = xy[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < FRONTAGE_MIN_EDGE_M) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const hit = route.nearest(mid);
      if (hit.distanceM > FRONTAGE_MAX_EDGE_DIST_M) continue;
      if (
        hit.chainageM < -FRONTAGE_CHAINAGE_SLACK_M ||
        hit.chainageM > route.lengthM + FRONTAGE_CHAINAGE_SLACK_M
      )
        continue;
      const edgeAngle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (angleDiffDeg(edgeAngle, route.segmentAngleDeg(hit.segmentIndex)) > FRONTAGE_MAX_ANGLE_DEG)
        continue;
      // Reject edges that sit at the ends of the route but project beyond it (clamped hits).
      const ha = route.nearest(a);
      const hb = route.nearest(b);
      if (
        Math.abs(ha.chainageM - hb.chainageM) < 0.5 &&
        (ha.chainageM === 0 || ha.chainageM === route.lengthM)
      )
        continue;
      facing.push({
        start: Math.min(ha.chainageM, hb.chainageM),
        end: Math.max(ha.chainageM, hb.chainageM),
        dist: hit.distanceM,
        side: hit.side,
        len,
      });
    }
    if (facing.length === 0) continue;
    // Keep the dominant side (a corner plot can have edges on both side streets; those are not Charlotte frontages).
    const bySide = new Map<1 | -1, typeof facing>();
    for (const f of facing) bySide.set(f.side, [...(bySide.get(f.side) ?? []), f]);
    const [side, edges] = [...bySide.entries()].sort(
      (p, q) => q[1].reduce((s, e) => s + e.len, 0) - p[1].reduce((s, e) => s + e.len, 0),
    )[0];
    facing = edges;
    const start = Math.min(...facing.map((f) => f.start));
    const end = Math.max(...facing.map((f) => f.end));
    const t = way.tags;
    const address = t['addr:housenumber']
      ? `${t['addr:housenumber']} ${t['addr:street'] ?? ''}`.trim()
      : (t['addr:street'] ?? null);
    const mapField = (key: string, label?: string): FieldCoverage =>
      t[key] !== undefined
        ? { state: 'map-reported', value: t[key], sources: [`osm:way:${way.id}`], note: label }
        : { state: 'unknown', value: null, sources: [], note: label };
    const fields: Record<string, FieldCoverage> = {
      footprint: {
        state: 'map-reported',
        value: `${xy.length - 1} vertices, ${round(polygonAreaM2(xy))} m²`,
        sources: [`osm:way:${way.id}`],
        note: 'provider footprint; imagery alignment not surveyed',
      },
      address: address
        ? { state: 'map-reported', value: address, sources: [`osm:way:${way.id}`] }
        : { state: 'unknown', value: null, sources: [] },
      levels: mapField('building:levels'),
      heightM: mapField('height', 'no measured height source in this audit'),
      roofShape: mapField('roof:shape'),
      roofLevels: mapField('roof:levels'),
      wallMaterial: mapField('building:material'),
      wallColour: mapField('building:colour'),
      buildingParts: {
        state: t['building:part'] ? 'map-reported' : 'unknown',
        value: t['building:part'] ?? null,
        sources: t['building:part'] ? [`osm:way:${way.id}`] : [],
      },
      facadeBaysWindowsDoors: {
        state: 'unknown',
        value: null,
        sources: [],
        note: 'requires an inspected dated street-level view',
      },
      shopfrontCurrent: {
        state: 'unknown',
        value: null,
        sources: [],
        note: 'requires a 2025–2026 dated view',
      },
      roofProfileDepth: {
        state: 'unknown',
        value: null,
        sources: [],
        note: 'requires oblique/aerial or DSM evidence',
      },
      rearSideGeometry: {
        state: 'unknown',
        value: null,
        sources: [],
        note: 'no rear/side view source identified',
      },
    };
    frontages.push({
      sourceId: `osm:way:${way.id}`,
      url: `https://www.openstreetmap.org/way/${way.id}`,
      version: way.version,
      sourceTimestamp: way.timestamp,
      address,
      name: t.name ?? null,
      side: sideName(side),
      chainageStartM: round(start),
      chainageEndM: round(end),
      frontageLengthM: round(facing.reduce((s, f) => s + f.len, 0)),
      facadeDistanceM: round(Math.min(...facing.map((f) => f.dist))),
      footprintAreaM2: round(polygonAreaM2(xy)),
      osmSource: pinnedWayIds.has(way.id) ? 'pinned' : 'supplement',
      tags: t,
      fields,
      photoMatches: [],
      listedBuilding: null,
      missingViews: [],
    });
  }
  frontages.sort((a, b) =>
    a.side === b.side ? a.chainageStartM - b.chainageStartM : a.side === 'west' ? -1 : 1,
  );
  for (const rel of osm.relations.values()) {
    if (!rel.tags.building || rel.tags.type !== 'multipolygon') continue;
    const outer = rel.members
      .filter((m) => m.type === 'way' && m.role === 'outer')
      .map((m) => osm.ways.get(m.ref))
      .filter((w): w is OsmWay => !!w);
    const near = outer.some((w) =>
      w.nodeRefs.some((r) => {
        const n = osm.nodes.get(r);
        return n && route.nearest(project(n)).distanceM <= FRONTAGE_MAX_EDGE_DIST_M + 10;
      }),
    );
    if (near) unresolvedBuildingRelations.push(`osm:relation:${rel.id}`);
  }

  // 4. Street objects between the building lines.
  const objects: ObjectEntity[] = [];
  const crossingWayNodes = new Set<string>();
  for (const way of osm.ways.values())
    if (way.tags.footway === 'crossing') for (const r of way.nodeRefs) crossingWayNodes.add(r);
  for (const node of osm.nodes.values()) {
    const kind = classifyObject(node.tags);
    if (!kind) continue;
    const hit = route.nearest(project(node));
    if (
      hit.distanceM > OBJECT_BUFFER_M ||
      (hit.chainageM <= 0.05 && hit.distanceM > 8) ||
      (hit.chainageM >= route.lengthM - 0.05 && hit.distanceM > 8)
    )
      continue;
    const fields: Record<string, FieldCoverage> = {
      position: {
        state: 'map-reported',
        value: `${node.latitude.toFixed(7)}, ${node.longitude.toFixed(7)}`,
        sources: [`osm:node:${node.id}`],
      },
      type: { state: 'map-reported', value: kind, sources: [`osm:node:${node.id}`] },
      form: {
        state: 'unknown',
        value: null,
        sources: [],
        note: 'species/form/dimensions/colour need a dated instance source',
      },
      currentPresence: {
        state: 'unknown',
        value: null,
        sources: [],
        note: `OSM edit ${node.timestamp.slice(0, 10)} is not an observation date`,
      },
    };
    objects.push({
      sourceId: `osm:node:${node.id}`,
      url: `https://www.openstreetmap.org/node/${node.id}`,
      kind,
      side: hit.distanceM < 1 ? 'on-centreline' : sideName(hit.side),
      chainageM: round(hit.chainageM),
      distanceM: round(hit.distanceM),
      position: { latitude: node.latitude, longitude: node.longitude },
      tags: node.tags,
      fields,
      camdenMatch: null,
    });
  }
  objects.sort((a, b) => a.chainageM - b.chainageM);

  // 5. Sources.
  const commons = await fetchCommons(route, unproject);
  const camden = await fetchCamdenTrees();
  const nhle = await fetchNhle();
  const probes: ProbeResult[] = [
    await probe(
      'mapillary-no-token',
      'https://graph.mapillary.com/images?fields=id,captured_at,geometry&bbox=-0.1366,51.5178,-0.1340,51.5203&limit=1',
      (s) =>
        s === 200
          ? 'reachable without token (unexpected)'
          : `HTTP ${s} without an access token; a free Mapillary developer token is required to enumerate street-level coverage`,
    ),
    await probe(
      'kartaview-nearby',
      'https://api.openstreetcam.org/2.0/photo/?lat=51.5191&lng=-0.1354&radius=150',
      (s, b) =>
        s === 200
          ? `HTTP 200, ${b.length} bytes`
          : `HTTP ${s}; KartaView public API did not return usable coverage for this query`,
    ),
    await probe(
      'geograph-api-key-required',
      'https://api.geograph.org.uk/api/photo/3033698/?format=json',
      (s, b) =>
        s === 200 && !/key/i.test(b.slice(0, 300))
          ? `HTTP 200`
          : `HTTP ${s}: Geograph's own API needs a key (${b.slice(0, 80).replace(/\s+/g, ' ')}); Geograph images are instead reached through their Commons mirrors`,
    ),
    await probe(
      'ea-lidar-dsm-dataset',
      'https://environment.data.gov.uk/dataset/9ba4d5ac-d596-445a-9056-dae3ddec0178',
      (s) =>
        s === 200
          ? 'dataset landing page reachable (OGL metadata); 1 m DSM tiles need the interactive survey download step, not fetched here'
          : `HTTP ${s}`,
    ),
    await probe(
      'camden-conservation-appraisal',
      'https://www.camden.gov.uk/documents/20142/7323179/Charlotte%2BStreet.pdf/9ac63c8a-4be2-2dd3-879d-3553e43317c2',
      (s, b) =>
        s === 200
          ? `HTTP 200, ${b.length} bytes PDF (2008 appraisal; historical context only)`
          : `HTTP ${s}`,
    ),
  ];

  // 6. Join photos to frontages.
  const routePhotos = commons.files
    .map((f) => {
      const pos = f.cameraPosition ?? f.objectPosition;
      const hit = pos ? route.nearest(project(pos)) : null;
      return { file: f, hit };
    })
    .filter((p) => p.hit && p.hit.distanceM <= PHOTO_ROUTE_BUFFER_M);
  // "26 Charlotte Street", "11 and 13 Charlotte Street", "5 Charlotte Street W1": any of the way's house numbers, optionally followed by a range/list, then the street.
  const addrRe = (housenumber: string) => {
    const parts = housenumber
      .split(/[-–,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return new RegExp(
      `(^|\\D)(${parts.join('|')})[a-z]?(\\s*(?:[-–,&]|and)\\s*\\d+[a-z]?)*\\s*,?\\s+Charlotte\\s+St`,
      'i',
    );
  };
  const hitByTitle = new Map(routePhotos.map((p) => [p.file.title, p.hit!]));
  for (const fr of frontages) {
    const num = fr.tags['addr:housenumber'];
    const onCharlotte = fr.tags['addr:street'] === 'Charlotte Street';
    const name = fr.tags.name && fr.tags.name.length >= 5 ? fr.tags.name : null;
    for (const file of commons.files) {
      const hit = hitByTitle.get(file.title) ?? null;
      const mid = { chainage: (fr.chainageStartM + fr.chainageEndM) / 2 };
      const camDist = hit ? Math.abs(hit.chainageM - mid.chainage) : null;
      let tier: PhotoMatch['tier'] | null = null;
      if (num && onCharlotte && addrRe(num).test(file.title)) tier = 'title-address';
      else if (num && onCharlotte && file.description && addrRe(num).test(file.description))
        tier = 'description-address';
      else if (
        name &&
        new RegExp(`(^|\\W)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i').test(
          file.title,
        )
      )
        tier = 'name-match';
      else if (camDist !== null && camDist <= PHOTO_FRONTAGE_MATCH_M) tier = 'camera-within-30m';
      if (!tier) continue;
      if (REJECTED_COMMONS_FILES[file.title] && tier !== 'camera-within-30m')
        tier = 'rejected-by-review';
      else if (REJECTED_COMMONS_FILES[file.title]) continue;
      fr.photoMatches.push({
        title: file.title,
        pageUrl: file.pageUrl,
        captureDate: file.captureDate,
        license: file.license,
        tier,
        cameraDistanceM: camDist === null ? null : round(camDist),
        needsVisualVerification: true,
        ...(tier === 'rejected-by-review'
          ? { rejectionReason: REJECTED_COMMONS_FILES[file.title] }
          : {}),
      });
    }
    const tierRank: Record<PhotoMatch['tier'], number> = {
      'title-address': 0,
      'description-address': 1,
      'name-match': 2,
      'camera-within-30m': 3,
      'rejected-by-review': 4,
    };
    fr.photoMatches.sort((a, b) =>
      a.tier === b.tier
        ? (captureYear(b.captureDate) ?? 0) - (captureYear(a.captureDate) ?? 0)
        : tierRank[a.tier] - tierRank[b.tier],
    );
    const addressed = fr.photoMatches.filter(
      (m) => m.tier === 'title-address' || m.tier === 'description-address',
    );
    const named = fr.photoMatches.filter((m) => m.tier === 'name-match');
    fr.fields.frontageImage = addressed.length
      ? {
          state: 'observed',
          value: `${addressed.length} address-labelled Commons file(s); newest ${addressed[0].captureDate ?? 'undated'}`,
          sources: addressed.map((m) => m.pageUrl),
          note: 'label match only until visually verified against the footprint',
        }
      : named.length
        ? {
            state: 'inferred',
            value: `${named.length} Commons file(s) labelled with the current OSM occupier name "${name}"; newest ${named[0].captureDate ?? 'undated'}`,
            sources: named.map((m) => m.pageUrl),
            note: 'occupier names move; verify the building, not the sign',
          }
        : fr.photoMatches.length
          ? {
              state: 'inferred',
              value: `${fr.photoMatches.length} geotagged file(s) with camera within 30 m of frontage; none labelled with this address`,
              sources: fr.photoMatches.slice(0, 5).map((m) => m.pageUrl),
              note: 'may or may not depict this building',
            }
          : {
              state: 'unknown',
              value: null,
              sources: [],
              note: 'no geotagged or address-labelled Commons file found',
            };
    const newestYear = Math.max(
      0,
      ...fr.photoMatches
        .filter((m) => m.tier !== 'rejected-by-review')
        .map((m) => captureYear(m.captureDate) ?? 0),
    );
    fr.missingViews = [
      ...(addressed.length ? [] : ['address-verified street-level frontage view']),
      ...(newestYear >= 2025 ? [] : ['dated 2025–2026 ground-floor/shopfront view']),
      'roof/oblique or DSM height evidence',
      'rear/side elevation (not required for street view; record as unknown)',
    ];
  }
  // Listed-building join: nearest NHLE point within 20 m of a frontage vertex.
  for (const fr of frontages) {
    const way = osm.ways.get(fr.sourceId.replace('osm:way:', ''))!;
    const ring = way.nodeRefs.map((r) => project(osm.nodes.get(r)!));
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    let best: FrontageEntity['listedBuilding'] = null;
    for (const e of nhle.entries) {
      if (!e.position) continue;
      const p = project(e.position);
      const d = Math.hypot(p.x - cx, p.y - cy);
      const nameMatchesAddress = nhleNameCoversAddress(
        e.name,
        fr.tags['addr:housenumber'],
        fr.tags['addr:street'],
      );
      if (
        (d <= 12 || (nameMatchesAddress && d <= 40)) &&
        (!best ||
          (nameMatchesAddress && !best.nameMatchesAddress) ||
          (nameMatchesAddress === best.nameMatchesAddress && d < best.distanceM))
      ) {
        best = {
          listEntry: e.listEntry,
          grade: e.grade,
          name: e.name,
          hyperlink: e.hyperlink,
          distanceM: round(d),
          nameMatchesAddress,
        };
      }
    }
    fr.listedBuilding = best;
    fr.fields.heritageListing = best
      ? {
          state: best.nameMatchesAddress ? 'observed' : 'inferred',
          value: `NHLE ${best.listEntry} grade ${best.grade}: ${best.name}`,
          sources: [best.hyperlink],
          note: best.nameMatchesAddress
            ? 'list-entry name covers this address; list description gives storeys/materials as written at listing, not current condition'
            : 'nearest NHLE point only; list-entry name does not cover this address, so the join is positional and unverified',
        }
      : {
          state: 'unknown',
          value: null,
          sources: [],
          note: 'no NHLE point within join distance; not proof the building is unlisted',
        };
  }

  // 7. Join OSM trees to Camden records; add Camden-only trees on the route.
  const camdenOnRoute = camden.trees
    .filter((t) => t.position)
    .map((t) => ({ tree: t, hit: route.nearest(project(t.position!)) }))
    .filter(
      (t) =>
        t.hit.distanceM <= OBJECT_BUFFER_M &&
        t.hit.chainageM > 0.05 &&
        t.hit.chainageM < route.lengthM - 0.05,
    );
  const usedCamden = new Set<string>();
  for (const obj of objects) {
    if (obj.kind !== 'tree') continue;
    const p = project(obj.position);
    let best: { t: CamdenTree; d: number } | null = null;
    for (const { tree } of camdenOnRoute) {
      const q = project(tree.position!);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= 8 && (!best || d < best.d)) best = { t: tree, d };
    }
    if (best) {
      usedCamden.add(best.t.identifier);
      obj.camdenMatch = {
        identifier: best.t.identifier,
        commonName: best.t.commonName,
        heightM: best.t.heightM,
        spreadM: best.t.spreadM,
        inspectionDate: best.t.inspectionDate,
        distanceM: round(best.d),
      };
      obj.fields.form = {
        state: 'observed',
        value: `${best.t.commonName ?? 'species unstated'}; height ${best.t.heightM ?? '?'} m; spread ${best.t.spreadM ?? '?'} m; ${best.t.maturity ?? ''}`,
        sources: [`camden:tree:${best.t.identifier}`],
        note: `Camden inspection ${best.t.inspectionDate ?? 'undated'}; canopy shape/trunk not described`,
      };
      obj.fields.currentPresence = {
        state: 'observed',
        value: `inspected ${best.t.inspectionDate ?? 'undated'}`,
        sources: [`camden:tree:${best.t.identifier}`],
      };
    }
  }
  for (const { tree, hit } of camdenOnRoute) {
    if (usedCamden.has(tree.identifier)) continue;
    const isPit = /vacant tree pit/i.test(tree.commonName ?? '');
    objects.push({
      sourceId: `camden:tree:${tree.identifier}`,
      url: 'https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss',
      kind: 'tree',
      side: sideName(hit.side),
      chainageM: round(hit.chainageM),
      distanceM: round(hit.distanceM),
      position: tree.position!,
      tags: {
        site_name: tree.siteName,
        common_name: tree.commonName ?? '',
        spatial_accuracy: tree.spatialAccuracy ?? '',
      },
      fields: {
        position: {
          state: 'observed',
          value: `${tree.position!.latitude}, ${tree.position!.longitude}`,
          sources: [`camden:tree:${tree.identifier}`],
          note: tree.spatialAccuracy ?? undefined,
        },
        type: {
          state: 'observed',
          value: isPit ? 'vacant tree pit (planned planting)' : 'tree',
          sources: [`camden:tree:${tree.identifier}`],
        },
        form: {
          state: isPit ? 'unknown' : 'observed',
          value: isPit
            ? null
            : `${tree.commonName ?? 'species unstated'}; height ${tree.heightM ?? '?'} m; spread ${tree.spreadM ?? '?'} m; ${tree.maturity ?? ''}`,
          sources: [`camden:tree:${tree.identifier}`],
          note: 'canopy shape/trunk not described',
        },
        currentPresence: {
          state: 'observed',
          value: `inspected ${tree.inspectionDate ?? 'undated'}`,
          sources: [`camden:tree:${tree.identifier}`],
          note: 'not in the pinned OSM extract',
        },
      },
      camdenMatch: {
        identifier: tree.identifier,
        commonName: tree.commonName,
        heightM: tree.heightM,
        spreadM: tree.spreadM,
        inspectionDate: tree.inspectionDate,
        distanceM: 0,
      },
    });
  }
  objects.sort((a, b) => a.chainageM - b.chainageM);

  // 8. Control points: same physical object located by two independent sources.
  const controlPoints = objects
    .filter((o) => o.sourceId.startsWith('osm:node:') && o.camdenMatch)
    .map((o) => ({
      kind: 'tree' as const,
      osmNode: o.sourceId,
      osmPosition: o.position,
      camdenIdentifier: o.camdenMatch!.identifier,
      camdenPosition: camden.trees.find((t) => t.identifier === o.camdenMatch!.identifier)!
        .position!,
      offsetM: o.camdenMatch!.distanceM,
      chainageM: o.chainageM,
      sources: [o.url, 'https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss'],
    }));
  const listedControl = frontages
    .filter((f) => f.listedBuilding?.nameMatchesAddress)
    .map((f) => ({
      kind: 'listed-building' as const,
      osmWay: f.sourceId,
      nhleListEntry: f.listedBuilding!.listEntry,
      centroidToNhlePointM: f.listedBuilding!.distanceM,
      address: f.address,
    }));

  // 9. Summary.
  const west = frontages.filter((f) => f.side === 'west');
  const east = frontages.filter((f) => f.side === 'east');
  const summarize = (fs: FrontageEntity[]) => ({
    frontages: fs.length,
    addressLabelledPhoto: fs.filter((f) => f.fields.frontageImage.state === 'observed').length,
    cameraOnlyPhoto: fs.filter((f) => f.fields.frontageImage.state === 'inferred').length,
    noPhoto: fs.filter((f) => f.fields.frontageImage.state === 'unknown').length,
    photoDated2025Plus: fs.filter((f) =>
      f.photoMatches.some((m) => (captureYear(m.captureDate) ?? 0) >= 2025),
    ).length,
    levelsTagged: fs.filter((f) => f.fields.levels.state !== 'unknown').length,
    heightTagged: fs.filter((f) => f.fields.heightM.state !== 'unknown').length,
    roofShapeTagged: fs.filter((f) => f.fields.roofShape.state !== 'unknown').length,
    materialTagged: fs.filter((f) => f.fields.wallMaterial.state !== 'unknown').length,
    listed: fs.filter((f) => f.listedBuilding).length,
  });
  const output = {
    schema: 'runway-f1-street-source-audit/v1',
    recordedAt: new Date().toISOString(),
    mode: OFFLINE ? 'offline-rebuild' : 'fetch-and-build',
    route: {
      ...inventory.route,
      projectedLengthM: round(route.lengthM),
      projection:
        'local equirectangular (111,320 m·cos(lat) per degree lon, 110,540 m per degree lat), origin at Percy Street junction; west = left of south→north travel',
    },
    osmSources: {
      pinned: { file: 'map-source.osm.xml.gz', sha256: rawSha },
      supplement: supplement
        ? {
            url: supplement.url,
            retrievedAt: supplement.retrievedAt,
            status: supplement.status,
            sha256: supplement.sha256,
            bbox: SUPPLEMENT_BBOX,
          }
        : null,
      buildingWaysConsidered: buildingWaysConsidered.length,
      unresolvedBuildingRelationsNearRoute: unresolvedBuildingRelations,
    },
    frontageRule: {
      maxEdgeMidpointDistanceM: FRONTAGE_MAX_EDGE_DIST_M,
      maxEdgeAngleDeg: FRONTAGE_MAX_ANGLE_DEG,
      minEdgeLengthM: FRONTAGE_MIN_EDGE_M,
      chainageSlackM: FRONTAGE_CHAINAGE_SLACK_M,
      note: 'a building way is a street-facing frontage when at least one polygon edge is near-parallel to the centreline, within the distance limit and within the route chainage; the side with more facing length is kept; this is a map-geometry rule, not a survey',
    },
    objectRule: {
      bufferM: OBJECT_BUFFER_M,
      kinds: [
        'tree',
        'crossing',
        'sign',
        'lamp',
        'bench',
        'cycle_parking',
        'cycle_hire',
        'waste_basket',
        'artwork',
        'motorcycle_parking',
        'other',
      ],
    },
    summary: {
      west: summarize(west),
      east: summarize(east),
      total: summarize(frontages),
      objects: Object.fromEntries(
        [...new Set(objects.map((o) => o.kind))].map((k) => [
          k,
          objects.filter((o) => o.kind === k).length,
        ]),
      ),
      osmTreesMatchedToCamden: objects.filter(
        (o) => o.sourceId.startsWith('osm:node:') && o.kind === 'tree' && o.camdenMatch,
      ).length,
      camdenOnlyTrees: objects.filter((o) => o.sourceId.startsWith('camden:')).length,
      commonsFilesConsidered: commons.files.length,
      commonsFilesWithinRouteBuffer: routePhotos.length,
      commonsGeographMirrors: routePhotos.filter((p) => p.file.mirroredFrom === 'geograph').length,
      commonsCategoryMembers: commons.categoryTitles.size,
      nhleEntriesInWindow: nhle.entries.length,
    },
    sources: {
      commons: {
        api: 'https://commons.wikimedia.org/w/api.php (geosearch r=60 m ×8, category members, imageinfo/extmetadata/coordinates)',
        centres: commons.centres,
        geosearchCirclesAtResultCap: commons.capped,
        license:
          'per-file (recorded on each match); Commons files are reference evidence, not shipped textures',
      },
      camdenTrees: {
        url: camden.envelope.url,
        retrievedAt: camden.envelope.retrievedAt,
        sha256: camden.envelope.sha256,
        records: camden.trees.length,
        datasetPage: 'https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss',
        licenceAsPublished:
          'see dataset page (Camden open data; licence text recorded in the report screenshot)',
      },
      nhle: {
        url: nhle.envelope.url,
        retrievedAt: nhle.envelope.retrievedAt,
        sha256: nhle.envelope.sha256,
        records: nhle.entries.length,
        usage: 'Historic England NHLE open data; list-entry hyperlinks retained',
      },
      probes,
    },
    controlPoints: { treePairs: controlPoints, listedBuildingPairs: listedControl },
    frontages,
    objects,
    routePhotos: routePhotos.map(({ file, hit }) => ({
      ...file,
      routeDistanceM: round(hit!.distanceM),
      chainageM: round(hit!.chainageM),
      side: sideName(hit!.side),
    })),
    nhleEntries: nhle.entries,
  };
  writeFileSync(path.join(OUT_DIR, 'source-audit.json'), JSON.stringify(output, null, 1));
  writeFileSync(path.join(OUT_DIR, 'source-coverage.md'), renderMarkdown(output));
  console.log(JSON.stringify(output.summary, null, 1));
  console.log(
    `frontages: west ${west.length}, east ${east.length}; objects ${objects.length}; control tree pairs ${controlPoints.length}; listed pairs ${listedControl.length}`,
  );
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

interface AuditOutput {
  recordedAt: string;
  mode: string;
  route: { projectedLengthM: number; approxCenterlineLengthM: number };
  osmSources: {
    pinned: { sha256: string };
    supplement: { url: string; retrievedAt: string; status: number; sha256: string } | null;
    buildingWaysConsidered: number;
    unresolvedBuildingRelationsNearRoute: string[];
  };
  summary: {
    west: Record<string, number>;
    east: Record<string, number>;
    total: Record<string, number>;
    objects: Record<string, number>;
  };
  sources: {
    probes: ProbeResult[];
    camdenTrees: { url: string; retrievedAt: string; records: number };
    nhle: { retrievedAt: string; records: number };
  };
  controlPoints: {
    treePairs: { osmNode: string; camdenIdentifier: string; offsetM: number; chainageM: number }[];
    listedBuildingPairs: {
      osmWay: string;
      nhleListEntry: number;
      centroidToNhlePointM: number;
      address: string | null;
    }[];
  };
  frontages: FrontageEntity[];
  objects: ObjectEntity[];
  routePhotos: (CommonsFile & { routeDistanceM: number; chainageM: number; side: string })[];
}

function st(f: FieldCoverage): string {
  return f.state === 'unknown'
    ? '—'
    : `${f.state === 'map-reported' ? 'map' : f.state}: ${String(f.value).replace(/\|/g, '/')}`;
}

function renderMarkdown(o: AuditOutput): string {
  const lines: string[] = [];
  lines.push('# Charlotte Street pilot: per-entity source coverage (generated)');
  lines.push('');
  lines.push(
    `Generated ${o.recordedAt} by \`pnpm tsx scripts/audit-street-sources.ts${o.mode === 'offline-rebuild' ? ' --offline' : ''}\`. Do not edit by hand; see [source-audit.json](source-audit.json) for every field, source URL and match tier. "map" = OpenStreetMap tag (edit metadata, not an observation); "observed" = a dated source that describes this specific entity; "inferred" = a nearby source that may depict it; "—" = unknown. Photo matches are label/position joins and still need visual verification against the footprint before any modelling brief.`,
  );
  lines.push('');
  lines.push('## Route, sources and rule');
  lines.push('');
  lines.push(
    `- Route length ${o.route.projectedLengthM} m projected (${o.route.approxCenterlineLengthM} m haversine in the pinned inventory). Pinned OSM SHA-256 \`${o.osmSources.pinned.sha256}\`.`,
  );
  if (o.osmSources.supplement)
    lines.push(
      `- Supplementary OSM extract for the southern boundary gap: ${o.osmSources.supplement.url} (HTTP ${o.osmSources.supplement.status}, retrieved ${o.osmSources.supplement.retrievedAt}, SHA-256 \`${o.osmSources.supplement.sha256}\`).`,
    );
  lines.push(
    `- Building ways considered: ${o.osmSources.buildingWaysConsidered}. Building multipolygon relations near the route left unresolved: ${o.osmSources.unresolvedBuildingRelationsNearRoute.length ? o.osmSources.unresolvedBuildingRelationsNearRoute.join(', ') : 'none'}.`,
  );
  lines.push(
    `- Camden trees: ${o.sources.camdenTrees.records} records in the window, retrieved ${o.sources.camdenTrees.retrievedAt}. NHLE: ${o.sources.nhle.records} listed entries in the window, retrieved ${o.sources.nhle.retrievedAt}.`,
  );
  lines.push('');
  lines.push('| Summary | West side | East side | Total |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const k of Object.keys(o.summary.total))
    lines.push(`| ${k} | ${o.summary.west[k]} | ${o.summary.east[k]} | ${o.summary.total[k]} |`);
  lines.push('');
  lines.push('## Source probes');
  lines.push('');
  lines.push('| Source | HTTP | Verdict |');
  lines.push('| --- | --- | --- |');
  for (const p of o.sources.probes)
    lines.push(`| [${p.name}](${p.url}) | ${p.status} | ${p.verdict.replace(/\|/g, '/')} |`);
  lines.push('');
  lines.push('## Control points');
  lines.push('');
  lines.push(
    'Same physical object positioned by two independent sources (OSM mapper vs Camden tree officer; OSM footprint centroid vs Historic England list point). Offsets bound the positional tolerance a modelling packet may claim.',
  );
  lines.push('');
  lines.push('| Pair | Source A | Source B | Offset (m) | Chainage (m) |');
  lines.push('| --- | --- | --- | ---: | ---: |');
  for (const c of o.controlPoints.treePairs)
    lines.push(
      `| tree | ${c.osmNode} | camden:tree:${c.camdenIdentifier} | ${c.offsetM} | ${c.chainageM} |`,
    );
  for (const c of o.controlPoints.listedBuildingPairs)
    lines.push(
      `| listed building ${c.address ?? ''} | ${c.osmWay} centroid | NHLE ${c.nhleListEntry} point | ${c.centroidToNhlePointM} | — |`,
    );
  lines.push('');
  for (const side of ['west', 'east'] as const) {
    lines.push(`## ${side === 'west' ? 'West' : 'East'} side frontages (south → north)`);
    lines.push('');
    lines.push(
      '| Chainage (m) | OSM way | Address / name | Levels | Height | Roof | Material / colour | Listed | Frontage image | Newest dated view | Missing |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const f of o.frontages.filter((x) => x.side === side)) {
      const newest =
        f.photoMatches
          .map((m) => m.captureDate ?? '')
          .filter(Boolean)
          .sort()
          .pop() ?? '—';
      const img = f.fields.frontageImage;
      const imgCell =
        img.state === 'unknown'
          ? '—'
          : `${img.state}: ${f.photoMatches.filter((m) => m.tier === 'title-address' || m.tier === 'description-address').length} addr / ${f.photoMatches.filter((m) => m.tier === 'name-match').length} name / ${f.photoMatches.length} total`;
      lines.push(
        `| ${f.chainageStartM}–${f.chainageEndM} | [${f.sourceId.replace('osm:way:', '')}](${f.url}) v${f.version}${f.osmSource === 'supplement' ? ' (suppl.)' : ''} | ${f.address ?? '—'}${f.name ? ` / ${f.name}` : ''} | ${st(f.fields.levels)} | ${st(f.fields.heightM)} | ${st(f.fields.roofShape)} | ${f.tags['building:material'] ?? '—'} / ${f.tags['building:colour'] ?? '—'} | ${f.listedBuilding ? `[${f.listedBuilding.listEntry}](${f.listedBuilding.hyperlink}) ${f.listedBuilding.grade}` : '—'} | ${imgCell} | ${newest} | ${f.missingViews.slice(0, 2).join('; ')} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Address-labelled photo matches (need visual verification)');
  lines.push('');
  lines.push('| Frontage | File | Capture date | Licence | Tier |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const f of o.frontages)
    for (const m of f.photoMatches.filter((x) => x.tier !== 'camera-within-30m'))
      lines.push(
        `| ${f.address ?? f.sourceId} | [${m.title.replace(/^File:/, '').replace(/\|/g, '/')}](${m.pageUrl}) | ${m.captureDate ?? '—'} | ${m.license ?? '—'} | ${m.tier}${m.rejectionReason ? `: ${m.rejectionReason}` : ''} |`,
      );
  lines.push('');
  lines.push('## Street objects between the building lines (south → north)');
  lines.push('');
  lines.push('| Chainage (m) | Side | Kind | Source | Form / dimensions | Current presence |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const ob of o.objects)
    lines.push(
      `| ${ob.chainageM} | ${ob.side} | ${ob.kind}${ob.tags.traffic_sign ? ` ${ob.tags.traffic_sign}` : ''}${ob.tags.crossing ? ` (${ob.tags.crossing})` : ''} | [${ob.sourceId}](${ob.url})${ob.camdenMatch && ob.sourceId.startsWith('osm:') ? ` + camden:tree:${ob.camdenMatch.identifier} (${ob.camdenMatch.distanceM} m)` : ''} | ${st(ob.fields.form)} | ${st(ob.fields.currentPresence)} |`,
    );
  lines.push('');
  lines.push('## Geotagged Commons files within 45 m of the centreline');
  lines.push('');
  lines.push('| Chainage (m) | Side | File | Capture date | Licence | Geograph mirror |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of [...o.routePhotos].sort((a, b) => a.chainageM - b.chainageM))
    lines.push(
      `| ${p.chainageM} | ${p.side} | [${p.title.replace(/^File:/, '').replace(/\|/g, '/')}](${p.pageUrl}) | ${p.captureDate ?? '—'} | ${p.license ?? '—'} | ${p.mirroredFrom ? 'yes' : 'no'} |`,
    );
  lines.push('');
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
