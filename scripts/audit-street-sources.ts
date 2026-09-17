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

interface CuratedCommonsObservation {
  osmWays: string[];
  identityBasis: string;
  visible: string;
  limits: string;
}

/** Files manually inspected at their Commons originals; identity is visible in-frame or independently accepted in the F1 cards. */
const CURATED_COMMONS: Record<string, CuratedCommonsObservation> = {
  'File:Carousel & No. 23, Fitzrovia, W1.jpg': {
    osmWays: ['226909126', '425929635', '425929632', '425929636'],
    identityBasis:
      'numbers 21 and 23 are visible; file title and Carousel fascia identify the 19–23 group',
    visible:
      'long pale frontage; numbers 21 and 23; shop signs; upper sash-window rows; dormers, sloping roof edges, chimney stacks/pots and adjoining context',
    limits:
      'oblique perspective; refuse bins/sign partly occlude ground floor; no measured roof depth, metric height, complete side/rear geometry or current 2026 condition',
  },
  'File:Fitzroy Tavern, Fitzrovia, W1.jpg': {
    osmWays: ['138339524'],
    identityBasis:
      '16 Charlotte Street fascia, Fitzroy Tavern signs, and Charlotte/Windmill street plates are visible',
    visible:
      'corner shopfront, red-brick and pale decorative elevations, repeated upper openings, ornate parapet/finials, and a partly tree-obscured Windmill Street side',
    limits:
      'tree hides part of side; roof surface/depth, metric height, rear geometry and current 2026 condition remain unknown',
  },
  'File:Italians, Fitzrovia, W1.jpg': {
    osmWays: ['122020336'],
    identityBasis:
      'The Italians fascia plus Charlotte/Percy street plates identify the corner; OSM names the occupier at 2 Charlotte Street',
    visible:
      'white corner façade, shopfront, upper opening rhythm, parapet/chimneys and Percy Street side elevation',
    limits:
      'exact footprint/address association relies partly on OSM occupier mapping; metric height, roof depth, rear geometry and current 2026 condition remain unknown',
  },
  'File:Vagabond, Fitzrovia, W1 - 2025-07-12.jpg': {
    osmWays: ['226909130'],
    identityBasis:
      'Vagabond fascia and adjoining visible number 23 locate the photographed 25 Charlotte Street frontage',
    visible:
      'shop sign, full three-bay upper brick façade, repeated window rows, parapet/chimneys and adjoining 23 Charlotte Street context',
    limits:
      'street works obscure the ground-floor edge; exact footprint association partly uses OSM occupier mapping; metric height, roof depth, side/rear geometry and current 2026 condition remain unknown',
  },
  'File:26 Charlotte Street, Fitzrovia, May 2022.jpg': {
    osmWays: ['138339533'],
    identityBasis:
      'number 26 is visible and the accepted F1 source card independently reviewed the match',
    visible:
      'pale frontage, three upper bays, three arched ground-floor openings, doors, railings, dormers, chimneys and roof edge',
    limits:
      'roof depth, metric height, side/rear geometry and current 2026 condition remain unknown',
  },
  'File:28 Charlotte Street, Fitzrovia, May 2022.jpg': {
    osmWays: ['138339551'],
    identityBasis: 'accepted F1 source card independently reviewed the address and terrace context',
    visible:
      'brown three-bay brick frontage, upper window rows, pale surrounds/brick heads, shopfront, separate door, railings, adjoining 26 and part of correctly located 30',
    limits: 'roof depth/profile, metric height, rear geometry and current shopfront remain unknown',
  },
  'File:Goode Flowers 2024-05-08.jpg': {
    osmWays: ['138339551'],
    identityBasis:
      'Goode Flowers fascia and visible adjoining 30a; OSM maps Goode Flowers at 28 Charlotte Street',
    visible: 'ground-floor dark shopfront, fascia, awning, openings and pavement edge',
    limits:
      'upper frontage and roof are outside frame; artificial floral display and refuse bags occlude parts; address association partly uses OSM occupier mapping',
  },
};

const KARTAVIEW_FRAME_IDS = ['163252803', '197918957', '1289673597'] as const;
const EA_DSM_WCS =
  'https://environment.data.gov.uk/geoservices/datasets/9ba4d5ac-d596-445a-9056-dae3ddec0178/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=9ba4d5ac-d596-445a-9056-dae3ddec0178__Lidar_Composite_Elevation_LZ_DSM_1m&subset=E(529000,530000)&subset=N(181000,182000)&format=image/tiff';
const EA_DTM_WCS =
  'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m&subset=E(529000,530000)&subset=N(181000,182000)&format=image/tiff';
const EA_SURVEY_BASE =
  'https://environment.data.gov.uk/geoservices/datasets/9f0fa3fc-a860-4729-adc9-47fe53f658d0/ogc/features/v1/collections';
const EA_SURVEY_QUERY = 'bbox=-0.1375,51.5172,-0.1330,51.5210&limit=20&f=application/json';
const CAMDEN_APPRAISAL_URL =
  'https://www.camden.gov.uk/documents/20142/7323179/Charlotte+Street.pdf';

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

interface BinaryCacheEnvelope {
  url: string;
  retrievedAt: string;
  status: number;
  contentType: string | null;
  bytes: number;
  sha256: string;
  file: string;
}

/** Like cachedFetch, but keeps the response bytes in a sidecar file (rasters, PDFs) with a JSON envelope. */
async function cachedFetchBinary(
  name: string,
  url: string,
  extension: string,
): Promise<{ envelope: BinaryCacheEnvelope; data: Buffer }> {
  const metaFile = path.join(CACHE_DIR, `${name}.meta.json`);
  const dataFile = path.join(CACHE_DIR, `${name}.${extension}`);
  if (existsSync(metaFile) && existsSync(dataFile)) {
    const envelope = JSON.parse(readFileSync(metaFile, 'utf8')) as BinaryCacheEnvelope;
    const data = readFileSync(dataFile);
    const actual = sha256(data);
    if (actual !== envelope.sha256)
      throw new Error(`cache hash mismatch for ${name}: ${actual} != ${envelope.sha256}`);
    return { envelope, data };
  }
  if (OFFLINE) throw new Error(`offline and no cache for ${name} (${url})`);
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  const data = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) throw new Error(`${name}: HTTP ${res.status} (${data.length} bytes)`);
  const envelope: BinaryCacheEnvelope = {
    url,
    retrievedAt: new Date().toISOString(),
    status: res.status,
    contentType: res.headers.get('content-type'),
    bytes: data.length,
    sha256: sha256(data),
    file: path.basename(dataFile),
  };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(dataFile, data);
  writeFileSync(metaFile, JSON.stringify(envelope, null, 1));
  console.log(`fetched ${name}: HTTP ${res.status}, ${data.length} bytes`);
  await new Promise((r) => setTimeout(r, 2000));
  return { envelope, data };
}

// ---------------------------------------------------------------------------
// British National Grid (EPSG:27700) from WGS84, for reading EA rasters.
// Standard OSGB Helmert (7-parameter) + Airy 1830 transverse Mercator; the
// Helmert step itself is only good to a few metres, so the residual against
// Camden's published easting/northing pairs is measured and reported.
// ---------------------------------------------------------------------------

interface EastNorth {
  e: number;
  n: number;
}

function wgs84ToBng(p: LngLat): EastNorth {
  const rad = Math.PI / 180;
  // WGS84 (GRS80) geodetic -> cartesian
  const a1 = 6378137;
  const f1 = 1 / 298.257223563;
  const e1sq = 2 * f1 - f1 * f1;
  const lat = p.latitude * rad;
  const lon = p.longitude * rad;
  const nu1 = a1 / Math.sqrt(1 - e1sq * Math.sin(lat) ** 2);
  let x = nu1 * Math.cos(lat) * Math.cos(lon);
  let y = nu1 * Math.cos(lat) * Math.sin(lon);
  let z = nu1 * (1 - e1sq) * Math.sin(lat);
  // Helmert WGS84 -> OSGB36 (OS Guide to coordinate systems, table 4)
  const tx = -446.448;
  const ty = 125.157;
  const tz = -542.06;
  const s = 20.4894e-6;
  const rx = (-0.1502 / 3600) * rad;
  const ry = (-0.247 / 3600) * rad;
  const rz = (-0.8421 / 3600) * rad;
  const x2 = tx + (1 + s) * x - rz * y + ry * z;
  const y2 = ty + rz * x + (1 + s) * y - rx * z;
  const z2 = tz - ry * x + rx * y + (1 + s) * z;
  x = x2;
  y = y2;
  z = z2;
  // cartesian -> Airy 1830 geodetic
  const a = 6377563.396;
  const b = 6356256.909;
  const esq = (a * a - b * b) / (a * a);
  const pr = Math.hypot(x, y);
  let phi = Math.atan2(z, pr * (1 - esq));
  for (let i = 0; i < 10; i++) {
    const nu = a / Math.sqrt(1 - esq * Math.sin(phi) ** 2);
    phi = Math.atan2(z + esq * nu * Math.sin(phi), pr);
  }
  const lam = Math.atan2(y, x);
  // Airy 1830 geodetic -> National Grid transverse Mercator
  const F0 = 0.9996012717;
  const lat0 = 49 * rad;
  const lon0 = -2 * rad;
  const N0 = -100000;
  const E0 = 400000;
  const n = (a - b) / (a + b);
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const tanP = Math.tan(phi);
  const nu = (a * F0) / Math.sqrt(1 - esq * sinP * sinP);
  const rho = (a * F0 * (1 - esq)) / (1 - esq * sinP * sinP) ** 1.5;
  const eta2 = nu / rho - 1;
  const M =
    b *
    F0 *
    ((1 + n + (5 / 4) * n * n + (5 / 4) * n ** 3) * (phi - lat0) -
      (3 * n + 3 * n * n + (21 / 8) * n ** 3) * Math.sin(phi - lat0) * Math.cos(phi + lat0) +
      ((15 / 8) * n * n + (15 / 8) * n ** 3) *
        Math.sin(2 * (phi - lat0)) *
        Math.cos(2 * (phi + lat0)) -
      (35 / 24) * n ** 3 * Math.sin(3 * (phi - lat0)) * Math.cos(3 * (phi + lat0)));
  const I = M + N0;
  const II = (nu / 2) * sinP * cosP;
  const III = (nu / 24) * sinP * cosP ** 3 * (5 - tanP * tanP + 9 * eta2);
  const IIIA = (nu / 720) * sinP * cosP ** 5 * (61 - 58 * tanP * tanP + tanP ** 4);
  const IV = nu * cosP;
  const V = (nu / 6) * cosP ** 3 * (nu / rho - tanP * tanP);
  const VI =
    (nu / 120) *
    cosP ** 5 *
    (5 - 18 * tanP * tanP + tanP ** 4 + 14 * eta2 - 58 * tanP * tanP * eta2);
  const dl = lam - lon0;
  return {
    n: I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6,
    e: E0 + IV * dl + V * dl ** 3 + VI * dl ** 5,
  };
}

function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Minimal GeoTIFF reader: single-band uncompressed float32 strips, which is
// what the EA WCS returns for format=image/tiff (checked on the cached files).
// ---------------------------------------------------------------------------

interface Raster {
  width: number;
  height: number;
  /** Top-left corner of the top-left pixel (EPSG:27700). */
  originE: number;
  originN: number;
  pixelE: number;
  pixelN: number;
  noData: number | null;
  epsg: number | null;
  values: Float32Array;
}

function readGeoTiff(buf: Buffer): Raster {
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('not a classic TIFF');
  const ifd = u32(4);
  const count = u16(ifd);
  const tags = new Map<number, { type: number; count: number; valueOffset: number }>();
  for (let i = 0; i < count; i++) {
    const o = ifd + 2 + i * 12;
    tags.set(u16(o), { type: u16(o + 2), count: u32(o + 4), valueOffset: o + 8 });
  }
  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };
  const values = (tag: number): number[] => {
    const t = tags.get(tag);
    if (!t) return [];
    const size = typeSize[t.type] ?? 1;
    const start = t.count * size <= 4 ? t.valueOffset : u32(t.valueOffset);
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const o = start + i * size;
      if (t.type === 3) out.push(u16(o));
      else if (t.type === 4) out.push(u32(o));
      else if (t.type === 12) out.push(f64(o));
      else if (t.type === 1 || t.type === 2) out.push(buf[o]);
      else throw new Error(`unsupported TIFF type ${t.type} for tag ${tag}`);
    }
    return out;
  };
  const ascii = (tag: number): string | null => {
    const t = tags.get(tag);
    if (!t) return null;
    const start = t.count <= 4 ? t.valueOffset : u32(t.valueOffset);
    return buf.toString('latin1', start, start + t.count).replace(/\0+$/, '');
  };
  const width = values(256)[0];
  const height = values(257)[0];
  const bps = values(258)[0];
  const compression = values(259)[0] ?? 1;
  const sampleFormat = values(339)[0] ?? 1;
  const samplesPerPixel = values(277)[0] ?? 1;
  if (compression !== 1 || bps !== 32 || sampleFormat !== 3 || samplesPerPixel !== 1)
    throw new Error(
      `unsupported GeoTIFF layout: compression ${compression}, ${bps} bps, sampleFormat ${sampleFormat}, spp ${samplesPerPixel}`,
    );
  const out = new Float32Array(width * height);
  const tileOffsets = values(324);
  if (tileOffsets.length) {
    const tileW = values(322)[0];
    const tileH = values(323)[0];
    const tilesAcross = Math.ceil(width / tileW);
    tileOffsets.forEach((offset, t) => {
      const tx = (t % tilesAcross) * tileW;
      const ty = Math.floor(t / tilesAcross) * tileH;
      for (let r = 0; r < tileH && ty + r < height; r++)
        for (let c = 0; c < tileW && tx + c < width; c++) {
          const o = offset + (r * tileW + c) * 4;
          out[(ty + r) * width + tx + c] = le ? buf.readFloatLE(o) : buf.readFloatBE(o);
        }
    });
  } else {
    const stripOffsets = values(273);
    const stripByteCounts = values(279);
    let k = 0;
    for (let s = 0; s < stripOffsets.length; s++) {
      for (let o = stripOffsets[s]; o < stripOffsets[s] + stripByteCounts[s]; o += 4)
        out[k++] = le ? buf.readFloatLE(o) : buf.readFloatBE(o);
    }
    if (k !== width * height) throw new Error(`GeoTIFF sample count ${k} != ${width * height}`);
  }
  const transform = values(34264);
  // ModelTransformation (row-major 4×4) or ModelPixelScale + ModelTiepoint
  const scale = transform.length === 16 ? [transform[0], -transform[5]] : values(33550);
  const tie = transform.length === 16 ? [0, 0, 0, transform[3], transform[7]] : values(33922);
  if (scale.length < 2 || tie.length < 5)
    throw new Error('GeoTIFF lacks ModelTransformation or PixelScale/Tiepoint georeferencing');
  const geoKeys = values(34735);
  let epsg: number | null = null;
  for (let i = 4; i + 3 < geoKeys.length; i += 4)
    if (geoKeys[i] === 3072 && geoKeys[i + 1] === 0) epsg = geoKeys[i + 3];
  const noDataText = ascii(42113);
  return {
    width,
    height,
    originE: tie[3] - tie[0] * scale[0],
    originN: tie[4] + tie[1] * scale[1],
    pixelE: scale[0],
    pixelN: scale[1],
    noData: noDataText === null ? null : Number(noDataText),
    epsg,
    values: out,
  };
}

function rasterAt(r: Raster, p: EastNorth): number | null {
  const col = Math.floor((p.e - r.originE) / r.pixelE);
  const row = Math.floor((r.originN - p.n) / r.pixelN);
  if (col < 0 || row < 0 || col >= r.width || row >= r.height) return null;
  const v = r.values[row * r.width + col];
  if (!Number.isFinite(v) || (r.noData !== null && v === r.noData)) return null;
  return v;
}

/** Values of cells whose centres fall inside the ring (ring in EPSG:27700). */
function rasterInsideRing(r: Raster, ring: EastNorth[]): number[] {
  const es = ring.map((p) => p.e);
  const ns = ring.map((p) => p.n);
  const xyRing = ring.map((p) => ({ x: p.e, y: p.n }));
  const out: number[] = [];
  for (let e = Math.floor(Math.min(...es)); e <= Math.ceil(Math.max(...es)); e += r.pixelE)
    for (let n = Math.floor(Math.min(...ns)); n <= Math.ceil(Math.max(...ns)); n += r.pixelN) {
      const centre = { e: e + r.pixelE / 2, n: n + r.pixelN / 2 };
      if (!pointInRing({ x: centre.e, y: centre.n }, xyRing)) continue;
      const v = rasterAt(r, centre);
      if (v !== null) out.push(v);
    }
  return out;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
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
  easting: number | null;
  northing: number | null;
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
      easting: num(r.easting),
      northing: num(r.northing),
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
  artist: string | null;
  evidence: 'candidate' | 'identity-verified' | 'rejected';
  identityBasis?: string;
  visible?: string;
  limits?: string;
  tier:
    | 'title-address'
    | 'description-address'
    | 'name-match'
    | 'camera-within-30m'
    | 'curated-review'
    | 'rejected-by-review';
  rejectionReason?: string;
  cameraDistanceM: number | null;
  needsVisualVerification: boolean;
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
  entityRole: 'building' | 'building-part';
  parentBuilding: string | null;
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
    | 'vacant_tree_pit'
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
  const ringByWay = new Map<string, LngLat[]>();
  for (const way of osm.ways.values()) {
    const ring = way.nodeRefs.map((r) => osm.nodes.get(r)).filter((n): n is OsmNode => !!n);
    if (ring.length === way.nodeRefs.length) ringByWay.set(way.id, ring);
  }
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
      entityRole: t['building:part'] ? 'building-part' : 'building',
      parentBuilding: null,
      tags: t,
      fields,
      photoMatches: [],
      listedBuilding: null,
      missingViews: [],
    });
  }
  // A building:part is an additional geometry record, not an independent building/photographic target.
  for (const part of frontages.filter((f) => f.entityRole === 'building-part')) {
    const partWayId = part.sourceId.replace('osm:way:', '');
    const partRing = ringByWay.get(partWayId)?.map(project) ?? [];
    const centre = {
      x: partRing.reduce((sum, p) => sum + p.x, 0) / partRing.length,
      y: partRing.reduce((sum, p) => sum + p.y, 0) / partRing.length,
    };
    const parent = frontages
      .filter((f) => f.entityRole === 'building' && f.side === part.side)
      .find((f) => {
        const ring = ringByWay.get(f.sourceId.replace('osm:way:', ''))?.map(project) ?? [];
        return ring.length > 2 && pointInRing(centre, ring);
      });
    part.parentBuilding = parent?.sourceId ?? null;
    part.fields.buildingParts.note = parent
      ? `building-part geometry within ${parent.sourceId}; do not count as an independent building or photo target`
      : 'building-part geometry; parent building not resolved by containment';
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
  const camdenMetadata = await cachedFetch(
    'camden-trees-metadata',
    'https://opendata.camden.gov.uk/api/views/csqp-kdss',
  );
  const appraisal = await cachedFetchBinary(
    'camden-charlotte-street-appraisal',
    CAMDEN_APPRAISAL_URL,
    'pdf',
  );
  const dsmFile = await cachedFetchBinary('ea-lidar-dsm-tq2981', EA_DSM_WCS, 'tif');
  const dtmFile = await cachedFetchBinary('ea-lidar-dtm-tq2981', EA_DTM_WCS, 'tif');
  const surveyDsm = await cachedFetch(
    'ea-survey-index-dsm',
    `${EA_SURVEY_BASE}/LIDAR_Composite_1m_Last_Return_DSM_2022_extents/items?${EA_SURVEY_QUERY}`,
  );
  const surveyDtm = await cachedFetch(
    'ea-survey-index-dtm',
    `${EA_SURVEY_BASE}/LIDAR_Composite_1m_DTM_2022_extents/items?${EA_SURVEY_QUERY}`,
  );
  const kartaNearby = await cachedFetch(
    'probe-kartaview-nearby',
    'https://api.openstreetcam.org/2.0/photo/?lat=51.5191&lng=-0.1354&radius=150',
  );
  const kartaFrames = [];
  for (const id of KARTAVIEW_FRAME_IDS) {
    const meta = await cachedFetch(
      `kartaview-frame-${id}`,
      `https://api.openstreetcam.org/2.0/photo/${id}`,
    );
    const parsed = JSON.parse(meta.body) as {
      result?: { data?: { imageProcUrl?: string } };
    };
    const imageUrl = parsed.result?.data?.imageProcUrl;
    if (!imageUrl) throw new Error(`KartaView ${id} has no processed-image URL`);
    const image = await cachedFetchBinary(`kartaview-frame-${id}`, imageUrl, 'jpg');
    kartaFrames.push({ id, meta, image: image.envelope });
  }
  const probes: ProbeResult[] = [
    await probe(
      'mapillary-no-token',
      'https://graph.mapillary.com/images?fields=id,captured_at,geometry&bbox=-0.1366,51.5178,-0.1340,51.5203&limit=1',
      (s) =>
        s === 200
          ? 'reachable without token (unexpected)'
          : `HTTP ${s} without an access token; a free Mapillary developer token is required to enumerate street-level coverage`,
    ),
    {
      name: 'kartaview-nearby',
      url: kartaNearby.url,
      status: kartaNearby.status,
      verdict:
        kartaNearby.status === 200
          ? 'public API returned three frames; originals inspected individually below (radius inclusion is not an identity match)'
          : `HTTP ${kartaNearby.status}`,
      retrievedAt: kartaNearby.retrievedAt,
    },
    await probe(
      'geograph-api-key-required',
      'https://api.geograph.org.uk/api/photo/3033698/?format=json',
      (s, b) =>
        s === 200 && !/key/i.test(b.slice(0, 300))
          ? `HTTP 200`
          : `HTTP ${s}: Geograph's own API needs a key (${b.slice(0, 80).replace(/\s+/g, ' ')}); Geograph images are instead reached through their Commons mirrors`,
    ),
    {
      name: 'ea-lidar-dsm-dtm-wcs',
      url: EA_DSM_WCS,
      status: 200,
      verdict: `public WCS acquired 1 km² 1 m DSM and DTM GeoTIFFs (${dsmFile.envelope.bytes + dtmFile.envelope.bytes} bytes total); grid spacing is not positional or height accuracy`,
      retrievedAt: dsmFile.envelope.retrievedAt,
    },
    {
      name: 'camden-conservation-appraisal',
      url: CAMDEN_APPRAISAL_URL,
      status: appraisal.envelope.status,
      verdict: `direct public PDF acquired (${appraisal.envelope.bytes} bytes); July 2008 appraisal based on early-2007 field survey, historical context rather than current entity condition`,
      retrievedAt: appraisal.envelope.retrievedAt,
    },
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
      else if (CURATED_COMMONS[file.title]?.osmWays.includes(fr.sourceId.replace('osm:way:', '')))
        tier = 'curated-review';
      if (!tier) continue;
      if (REJECTED_COMMONS_FILES[file.title] && tier !== 'camera-within-30m')
        tier = 'rejected-by-review';
      else if (REJECTED_COMMONS_FILES[file.title]) continue;
      const curated = CURATED_COMMONS[file.title];
      const identityVerified =
        curated?.osmWays.includes(fr.sourceId.replace('osm:way:', '')) ?? false;
      fr.photoMatches.push({
        title: file.title,
        pageUrl: file.pageUrl,
        captureDate: file.captureDate,
        license: file.license,
        artist: file.artist,
        tier,
        evidence:
          tier === 'rejected-by-review'
            ? 'rejected'
            : identityVerified
              ? 'identity-verified'
              : 'candidate',
        cameraDistanceM: camDist === null ? null : round(camDist),
        needsVisualVerification: tier !== 'rejected-by-review' && !identityVerified,
        ...(identityVerified && curated
          ? {
              identityBasis: curated.identityBasis,
              visible: curated.visible,
              limits: curated.limits,
            }
          : {}),
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
      'curated-review': 4,
      'rejected-by-review': 5,
    };
    fr.photoMatches.sort((a, b) => {
      const ad = a.captureDate ? Date.parse(a.captureDate) : NaN;
      const bd = b.captureDate ? Date.parse(b.captureDate) : NaN;
      if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return bd - ad;
      if (Number.isFinite(ad) !== Number.isFinite(bd)) return Number.isFinite(bd) ? 1 : -1;
      return tierRank[a.tier] - tierRank[b.tier];
    });
    const addressed = fr.photoMatches.filter(
      (m) => m.tier === 'title-address' || m.tier === 'description-address',
    );
    const named = fr.photoMatches.filter((m) => m.tier === 'name-match');
    const verified = fr.photoMatches.filter((m) => m.evidence === 'identity-verified');
    const newest = (matches: PhotoMatch[]) =>
      [...matches]
        .filter((m) => m.captureDate)
        .sort((a, b) => Date.parse(b.captureDate!) - Date.parse(a.captureDate!))[0];
    fr.fields.frontageImage = verified.length
      ? {
          state: 'observed',
          value: `${verified.length} manually identity-verified Commons observation(s); newest ${newest(verified)?.captureDate ?? 'undated'}`,
          sources: verified.map((m) => m.pageUrl),
          note: verified
            .map((m) => m.visible)
            .filter(Boolean)
            .join('; '),
        }
      : addressed.length
        ? {
            state: 'inferred',
            value: `${addressed.length} address-labelled Commons candidate(s); newest ${newest(addressed)?.captureDate ?? 'undated'}`,
            sources: addressed.map((m) => m.pageUrl),
            note: 'uploader label match only; exact visible identity has not been verified',
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
    const verifiedText = verified.map((m) => `${m.visible} ${m.limits}`).join(' ');
    fr.missingViews = [
      ...(verified.length ? [] : ['identity-verified street-level frontage view']),
      ...(newestYear >= 2025 ? [] : ['dated 2025–2026 ground-floor/shopfront view']),
      ...(/roof|dormer|parapet|chimney/i.test(verifiedText)
        ? ['metric roof depth/profile and height evidence']
        : ['roof/oblique or DSM height evidence']),
      ...(/side elevation/i.test(verifiedText)
        ? ['unoccluded/complete side and rear geometry (record hidden parts unknown)']
        : ['rear/side elevation (not required for street view; record as unknown)']),
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
      const isPit = /vacant tree pit/i.test(best.t.commonName ?? '');
      obj.camdenMatch = {
        identifier: best.t.identifier,
        commonName: best.t.commonName,
        heightM: best.t.heightM,
        spreadM: best.t.spreadM,
        inspectionDate: best.t.inspectionDate,
        distanceM: round(best.d),
      };
      if (isPit) obj.kind = 'vacant_tree_pit';
      obj.fields.type = {
        state: 'observed',
        value: isPit ? 'vacant tree pit (planned: Tulip Tree)' : 'tree',
        sources: [
          `osm:node:${obj.sourceId.replace('osm:node:', '')}`,
          `camden:tree:${best.t.identifier}`,
        ],
        note: isPit
          ? 'OSM retains natural=tree map provenance, but Camden recorded no tree at this joined position on the inspection date'
          : 'OSM tree joined to Camden tree record',
      };
      obj.fields.form = {
        state: isPit ? 'unknown' : 'observed',
        value: isPit
          ? null
          : `${best.t.commonName ?? 'species unstated'}; height ${best.t.heightM ?? '?'} m; spread ${best.t.spreadM ?? '?'} m; ${best.t.maturity ?? ''}`,
        sources: [`camden:tree:${best.t.identifier}`],
        note: isPit
          ? 'no tree form or dimensions apply to a vacant pit'
          : `Camden inspection ${best.t.inspectionDate ?? 'undated'}; canopy shape/trunk not described`,
      };
      obj.fields.presenceAtInspection = {
        state: 'observed',
        value: isPit
          ? `absent (vacant pit), ${best.t.inspectionDate ?? 'undated'}`
          : `present, inspected ${best.t.inspectionDate ?? 'undated'}`,
        sources: [`camden:tree:${best.t.identifier}`],
      };
      obj.fields.currentPresence = {
        state: 'unknown',
        value: null,
        sources: [`camden:tree:${best.t.identifier}`],
        note: `Camden observation is dated ${best.t.inspectionDate ?? 'unknown'}; September 2026 presence is not established`,
      };
    }
  }
  for (const { tree, hit } of camdenOnRoute) {
    if (usedCamden.has(tree.identifier)) continue;
    const isPit = /vacant tree pit/i.test(tree.commonName ?? '');
    objects.push({
      sourceId: `camden:tree:${tree.identifier}`,
      url: 'https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss',
      kind: isPit ? 'vacant_tree_pit' : 'tree',
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
        presenceAtInspection: {
          state: 'observed',
          value: isPit
            ? `absent (vacant pit), ${tree.inspectionDate ?? 'undated'}`
            : `present, inspected ${tree.inspectionDate ?? 'undated'}`,
          sources: [`camden:tree:${tree.identifier}`],
        },
        currentPresence: {
          state: 'unknown',
          value: null,
          sources: [`camden:tree:${tree.identifier}`],
          note: `not in the pinned OSM extract; Camden observation is dated ${tree.inspectionDate ?? 'unknown'}, so September 2026 presence is not established`,
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
    .filter((o) => o.sourceId.startsWith('osm:node:') && o.kind === 'tree' && o.camdenMatch)
    .map((o) => ({
      kind: 'tree' as const,
      osmNode: o.sourceId,
      osmPosition: o.position,
      camdenIdentifier: o.camdenMatch!.identifier,
      camdenPosition: camden.trees.find((t) => t.identifier === o.camdenMatch!.identifier)!
        .position!,
      offsetM: o.camdenMatch!.distanceM,
      chainageM: o.chainageM,
      side: o.side,
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

  // 9. Bounded EA raster sample. Values are evidence about the sample only and
  // are deliberately not written into all frontage height/roof fields.
  const dsm = readGeoTiff(dsmFile.data);
  const dtm = readGeoTiff(dtmFile.data);
  if (
    dsm.width !== dtm.width ||
    dsm.height !== dtm.height ||
    dsm.epsg !== 27700 ||
    dtm.epsg !== 27700
  )
    throw new Error('EA DSM/DTM grids do not share the expected EPSG:27700 1000×1000 layout');
  const bngResiduals = camden.trees
    .filter((t) => t.position && t.easting !== null && t.northing !== null)
    .map((t) => {
      const p = wgs84ToBng(t.position!);
      return Math.hypot(p.e - t.easting!, p.n - t.northing!);
    });
  const sampleWays = ['226909133', '138339533', '138339551'];
  const rasterSamples = sampleWays.map((wayId) => {
    const frontage = frontages.find((f) => f.sourceId === `osm:way:${wayId}`)!;
    const ring = ringByWay.get(wayId)!.map(wgs84ToBng);
    const dsmValues = rasterInsideRing(dsm, ring).sort((a, b) => a - b);
    const dtmValues = rasterInsideRing(dtm, ring).sort((a, b) => a - b);
    const roofP80 = percentile(dsmValues, 0.8);
    const terrainP50 = percentile(dtmValues, 0.5);
    return {
      osmWay: frontage.sourceId,
      address: frontage.address,
      dsmCells: dsmValues.length,
      dtmCells: dtmValues.length,
      dsmP20M_AOD: round(percentile(dsmValues, 0.2), 2),
      dsmP50M_AOD: round(percentile(dsmValues, 0.5), 2),
      dsmP80M_AOD: round(roofP80, 2),
      dtmP50M_AOD: round(terrainP50, 2),
      indicativeP80MinusTerrainM: round(roofP80 - terrainP50, 2),
      method:
        'OSM footprint transformed WGS84→OSGB36/EPSG:27700; uncompressed 1 m cells with centres inside polygon; DSM p20/p50/p80 and DTM p50. P80 limits isolated low cells but does not remove all vegetation/chimney/party-wall/outlier effects.',
      status:
        'bounded inferred sample only; not a surveyed eaves/ridge height, not assigned to the frontage field, and not scaled to other entities',
    };
  });
  type SurveyFeature = {
    id: string;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    properties: {
      sd_flown: string;
      ed_flown: string;
      year: string;
      resolution: number;
      polygon_id: string;
      filename: string;
    };
  };
  const surveyFeatures = (env: CacheEnvelope) =>
    (JSON.parse(env.body) as { features: SurveyFeature[] }).features.map((f) => ({
      id: f.id,
      startFlown: f.properties.sd_flown.slice(0, 10),
      endFlown: f.properties.ed_flown.slice(0, 10),
      year: f.properties.year,
      resolutionM: f.properties.resolution,
      polygonId: f.properties.polygon_id,
      filename: f.properties.filename,
      intersectsAllSampleCentroids: sampleWays.every((wayId) => {
        const ring = ringByWay.get(wayId)!;
        const centre = {
          x: ring.reduce((s, p) => s + p.longitude, 0) / ring.length,
          y: ring.reduce((s, p) => s + p.latitude, 0) / ring.length,
        };
        return pointInRing(
          centre,
          f.geometry.coordinates[0].map(([x, y]) => ({ x, y })),
        );
      }),
    }));

  const kartaAssessments: Record<(typeof KARTAVIEW_FRAME_IDS)[number], string> = {
    '163252803':
      'rejected for route identity: shot 2017-11-14 from about 155 m west of Charlotte Street; view is a landscaped residential courtyard with no Charlotte Street frontage identity',
    '197918957':
      'useful route context: shot 2018-01-17 looking northwest along Charlotte Street; upper façades, multiple street lamps, pollarded/leafless trees, signs and BT Tower visible, but vehicles heavily occlude ground floors and no house number is legible',
    '1289673597':
      'rejected for route-frontage identity: shot 2018-12-30 from Windmill Street looking northwest away from Charlotte Street; street façades and a hanging sign are visible but no Charlotte Street entity is identified',
  };
  const kartaview = kartaFrames.map(({ id, meta, image }) => {
    const d = (
      JSON.parse(meta.body) as {
        result: {
          data: {
            sequenceId: string;
            shotDate: string;
            lat: string;
            lng: string;
            width: string;
            height: string;
            heading: string;
            gpsAccuracy: string | null;
            dateAdded: string;
          };
        };
      }
    ).result.data;
    return {
      frameId: id,
      sequenceId: d.sequenceId,
      shotDate: d.shotDate,
      position: { latitude: Number(d.lat), longitude: Number(d.lng) },
      dimensions: `${d.width}×${d.height}`,
      headingDeg: Number(d.heading),
      gpsAccuracyProviderField: d.gpsAccuracy === null ? null : Number(d.gpsAccuracy),
      uploadDate: d.dateAdded,
      assessment: kartaAssessments[id],
      image,
      rights:
        'KartaView image reuse terms were not established from a provider licence statement in this audit; originals are cached for internal evidence inspection only and are not attached or proposed as shipped assets',
    };
  });

  // 10. Summary.
  const west = frontages.filter((f) => f.side === 'west');
  const east = frontages.filter((f) => f.side === 'east');
  const summarize = (fs: FrontageEntity[]) => ({
    frontageGeometryRecords: fs.length,
    buildingRecords: fs.filter((f) => f.entityRole === 'building').length,
    buildingPartRecords: fs.filter((f) => f.entityRole === 'building-part').length,
    identityVerifiedPhoto: fs.filter((f) => f.fields.frontageImage.state === 'observed').length,
    candidatePhotoOnly: fs.filter((f) => f.fields.frontageImage.state === 'inferred').length,
    noPhoto: fs.filter((f) => f.fields.frontageImage.state === 'unknown').length,
    photoDated2025Plus: fs.filter((f) =>
      f.photoMatches.some((m) => (captureYear(m.captureDate) ?? 0) >= 2025),
    ).length,
    levelsTagged: fs.filter((f) => f.fields.levels.state !== 'unknown').length,
    heightTagged: fs.filter((f) => f.fields.heightM.state !== 'unknown').length,
    roofShapeTagged: fs.filter((f) => f.fields.roofShape.state !== 'unknown').length,
    materialTagged: fs.filter((f) => f.fields.wallMaterial.state !== 'unknown').length,
    nhleAddressVerified: fs.filter((f) => f.listedBuilding?.nameMatchesAddress).length,
    nhlePositionalCandidate: fs.filter(
      (f) => f.listedBuilding && !f.listedBuilding.nameMatchesAddress,
    ).length,
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
      licence: 'OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0',
      licenceUrl: 'https://www.openstreetmap.org/copyright',
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
        'vacant_tree_pit',
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
          'per-file author and licence recorded on each match; any screenshot/derivative remains subject to that file licence and attribution, and no file is proposed as a shipped texture',
      },
      camdenTrees: {
        url: camden.envelope.url,
        retrievedAt: camden.envelope.retrievedAt,
        sha256: camden.envelope.sha256,
        records: camden.trees.length,
        datasetPage: 'https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss',
        metadata: {
          url: camdenMetadata.url,
          retrievedAt: camdenMetadata.retrievedAt,
          sha256: camdenMetadata.sha256,
        },
        licenceAsPublished: 'UK Open Government Licence v3',
        licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        attribution:
          'Contains information from the London Borough of Camden licensed under the Open Government Licence v3.0.',
      },
      nhle: {
        url: nhle.envelope.url,
        retrievedAt: nhle.envelope.retrievedAt,
        sha256: nhle.envelope.sha256,
        records: nhle.entries.length,
        usage:
          'Historic England NHLE open data; list-entry hyperlinks retained. Address-name joins are verified associations; centroid proximity without an address-name match remains a positional candidate, not a listing identity.',
      },
      camdenConservationAppraisal: {
        ...appraisal.envelope,
        adoptionDate: '2008-07-24',
        fieldSurvey: 'early 2007',
        usage:
          'historical conservation-area context only; downloadability does not establish an open image-reuse licence',
        extractedPassages: [
          'PDF p9 §3.6: view south along Charlotte Street to Percy Street; Fitzroy Tavern is a junction landmark',
          'PDF pp9–11 §§3.7–3.16: prevalent townhouse/storey/roof/material/detail/public-realm character',
          'PDF pp19–23 §§6.13–6.27: Charlotte Street building character, mixed-use frontages and larger infill caveats',
        ],
      },
      eaLidar: {
        licence:
          'Environment Agency data is supplied under the Open Government Licence v3 unless stated otherwise in dataset metadata',
        licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        dsm: dsmFile.envelope,
        dtm: dtmFile.envelope,
        grid: {
          epsg: dsm.epsg,
          width: dsm.width,
          height: dsm.height,
          pixelSpacingM: [dsm.pixelE, dsm.pixelN],
          bbox: [
            dsm.originE,
            dsm.originN - dsm.height * dsm.pixelN,
            dsm.originE + dsm.width * dsm.pixelE,
            dsm.originN,
          ],
        },
        transformCheck: {
          camdenCoordinatePairs: bngResiduals.length,
          residualMinM: round(Math.min(...bngResiduals), 2),
          residualMedianM: round(
            percentile(
              [...bngResiduals].sort((a, b) => a - b),
              0.5,
            ),
            2,
          ),
          residualMaxM: round(Math.max(...bngResiduals), 2),
          note: 'residual checks the approximate WGS84→BNG transform against rounded Camden coordinates; it is not a building accuracy estimate',
        },
        surveyIndex: {
          dsm: {
            url: surveyDsm.url,
            sha256: surveyDsm.sha256,
            candidates: surveyFeatures(surveyDsm),
          },
          dtm: {
            url: surveyDtm.url,
            sha256: surveyDtm.sha256,
            candidates: surveyFeatures(surveyDtm),
          },
          note: 'overlapping 2018 and 2020 survey polygons are candidates; the composite response does not expose per-cell source date, so no single observation date is assigned',
        },
        samples: rasterSamples,
        limits:
          '1 m is grid spacing, not universal ±1 m accuracy. EA survey vertical RMSE does not propagate unchanged to roof/eaves/building height. OSM alignment, composite survey selection, DTM interpolation, vegetation, chimneys and roof outliers remain material.',
      },
      kartaview: {
        nearby: {
          url: kartaNearby.url,
          retrievedAt: kartaNearby.retrievedAt,
          sha256: kartaNearby.sha256,
        },
        frames: kartaview,
      },
      probes,
    },
    entityStructure: {
      note: 'frontages are geometry records, not a count of independent buildings or photo targets; contained building:part ways are retained with parent links',
      linkedParts: frontages
        .filter((f) => f.entityRole === 'building-part')
        .map((f) => ({ sourceId: f.sourceId, parentBuilding: f.parentBuilding })),
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
    treePairs: {
      osmNode: string;
      camdenIdentifier: string;
      offsetM: number;
      chainageM: number;
      side: string;
    }[];
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
    `Generated ${o.recordedAt} by \`pnpm tsx scripts/audit-street-sources.ts${o.mode === 'offline-rebuild' ? ' --offline' : ''}\`. Do not edit by hand; see [source-audit.json](source-audit.json) for every field, source URL and match tier. "map" = OpenStreetMap tag (edit metadata, not an observation); "observed" = a dated source manually tied to this entity; "inferred" = a candidate label/position join; "—" = unknown. Each photo match states whether identity was verified, remains a candidate, or was rejected.`,
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
    'Cross-source positional checks (OSM mapper vs Camden tree officer; OSM footprint centroid vs Historic England list point). These offsets show join consistency for the named pairs only; they are not survey accuracy, do not bound route-wide tolerance, and say nothing about canopy, façade or height accuracy.',
  );
  lines.push('');
  lines.push('| Pair | Source A | Source B | Offset (m) | Chainage (m) |');
  lines.push('| --- | --- | --- | ---: | ---: |');
  for (const c of o.controlPoints.treePairs)
    lines.push(
      `| tree (${c.side}) | ${c.osmNode} | camden:tree:${c.camdenIdentifier} | ${c.offsetM} | ${c.chainageM} |`,
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
          .filter((m) => m.evidence !== 'rejected' && m.captureDate)
          .map((m) => m.captureDate!)
          .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? '—';
      const img = f.fields.frontageImage;
      const imgCell =
        img.state === 'unknown'
          ? '—'
          : `${img.state}: ${f.photoMatches.filter((m) => m.tier === 'title-address' || m.tier === 'description-address').length} addr / ${f.photoMatches.filter((m) => m.tier === 'name-match').length} name / ${f.photoMatches.length} total`;
      lines.push(
        `| ${f.chainageStartM}–${f.chainageEndM} | [${f.sourceId.replace('osm:way:', '')}](${f.url}) v${f.version}${f.osmSource === 'supplement' ? ' (suppl.)' : ''}${f.entityRole === 'building-part' ? ` (part of ${f.parentBuilding ?? 'unresolved parent'})` : ''} | ${f.address ?? '—'}${f.name ? ` / ${f.name}` : ''} | ${st(f.fields.levels)} | ${st(f.fields.heightM)} | ${st(f.fields.roofShape)} | ${f.tags['building:material'] ?? '—'} / ${f.tags['building:colour'] ?? '—'} | ${f.listedBuilding ? `[${f.listedBuilding.listEntry}](${f.listedBuilding.hyperlink}) ${f.listedBuilding.grade}` : '—'} | ${imgCell} | ${newest} | ${f.missingViews.slice(0, 2).join('; ')} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Commons photo matches (identity state and per-file rights)');
  lines.push('');
  lines.push('| Frontage | File / author | Capture date | Licence | Identity / tier |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const f of o.frontages)
    for (const m of f.photoMatches.filter((x) => x.tier !== 'camera-within-30m'))
      lines.push(
        `| ${f.address ?? f.sourceId} | [${m.title.replace(/^File:/, '').replace(/\|/g, '/')}](${m.pageUrl}) / ${m.artist ?? 'author not parsed'} | ${m.captureDate ?? '—'} | ${m.license ?? '—'} | ${m.evidence}; ${m.tier}${m.identityBasis ? `; ${m.identityBasis}` : ''}${m.rejectionReason ? `: ${m.rejectionReason}` : ''} |`,
      );
  lines.push('');
  lines.push('## Street objects between the building lines (south → north)');
  lines.push('');
  lines.push(
    '| Chainage (m) | Side | Kind | Source | Form / dimensions | Presence at dated inspection | Current presence |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const ob of o.objects)
    lines.push(
      `| ${ob.chainageM} | ${ob.side} | ${ob.kind}${ob.tags.traffic_sign ? ` ${ob.tags.traffic_sign}` : ''}${ob.tags.crossing ? ` (${ob.tags.crossing})` : ''} | [${ob.sourceId}](${ob.url})${ob.camdenMatch && ob.sourceId.startsWith('osm:') ? ` + camden:tree:${ob.camdenMatch.identifier} (${ob.camdenMatch.distanceM} m)` : ''} | ${st(ob.fields.form)} | ${ob.fields.presenceAtInspection ? st(ob.fields.presenceAtInspection) : '—'} | ${st(ob.fields.currentPresence)} |`,
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
