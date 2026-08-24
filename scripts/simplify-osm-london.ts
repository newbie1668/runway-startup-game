/**
 * Build a few-MB clay-board subset: continuous fabric between RUNWAY hubs,
 * streets, and Thames. The 50MB extract stays local / gitignored.
 *
 * PR #22 should use data/osm-central-london-simplified.geojson.
 *
 * Usage: pnpm simplify:sim
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import {
  BUILDING_DATA_FILE,
  LANDCOVER_DATA_FILE,
  OSM_ATTRIBUTION,
  OSM_BBOX,
  ROADS_DATA_FILE,
  SIMPLIFIED_DATA_FILE,
  SIMPLIFIED_MAX_BYTES,
  SIM_HUBS,
  type SimHubId,
} from '../lib/sim/constants';
import { capRing } from '../lib/sim/compact';
import { projectLngLat, ringAreaM2, roundCoord } from '../lib/sim/projection';
import { simplifyLine, simplifyRing, uniqueRing } from '../lib/sim/simplify';
import type {
  BuildingProperties,
  LandcoverProperties,
  LngLat,
  RoadProperties,
  SimFeature,
  SimProperties,
} from '../lib/sim/types';

const ROOT = process.cwd();
const HUB_CORE_M = 780;
const CORRIDOR_M = 500;
const COORD_DECIMALS = 5;
const ORDINARY_MAX_VERTS = 24;
const LARGE_MAX_VERTS = 40;
const ROAD_MAX_VERTS = 14;
const WATER_MAX_VERTS = 72;
const PARK_MAX_VERTS = 28;
const BUILDING_TOLERANCE = 1.2e-5;
const COVER_TOLERANCE = 5e-5;
const ROAD_TOLERANCE = 2e-5;

const LANDMARK_NAME =
  /shard|st paul|canada square|bishopsgate|battersea power|elizabeth tower|bt tower|st mary axe|fenchurch|palace of westminster|30 st mary/i;

/** Named silhouettes keep full OSM rings — no 10-vert (or 128-vert) cap. */
const SILHOUETTE_LANDMARK =
  /^(the shard|one canada square|22 bishopsgate( tower)?|st\.? paul'?s cathedral|battersea power station|palace of westminster|elizabeth tower|bt tower|30 st mary axe)$/i;

const KEEP_PARK_NAMES = new Set([
  'hyde park',
  'kensington gardens',
  'green park',
  'the green park',
  "st james's park",
  'st james’ park',
  "st. james's park",
  'st. james’ park',
  "regent's park",
  "the regent's park",
  'battersea park',
]);

const EXCLUDED_PARKS =
  /olympic park|queen elizabeth olympic|victoria park|hackney marsh|west ham park|mile end park/i;

const SKIP_ROADS = new Set([
  'service',
  'service_link',
  'residential',
  'unclassified',
  'living_street',
  'primary_link',
  'secondary_link',
  'tertiary_link',
  'trunk_link',
  'motorway_link',
]);

/** Neighbour links so fabric is a connected city, not ten islands. */
const CORRIDORS: [SimHubId, SimHubId][] = [
  ['camden', 'kingscross'],
  ['camden', 'soho'],
  ['kingscross', 'farringdon'],
  ['kingscross', 'soho'],
  ['soho', 'farringdon'],
  ['soho', 'westminster'],
  ['westminster', 'battersea'],
  ['westminster', 'londonbridge'],
  ['westminster', 'city'],
  ['farringdon', 'city'],
  ['farringdon', 'shoreditch'],
  ['shoreditch', 'city'],
  ['city', 'londonbridge'],
  ['city', 'canarywharf'],
  ['londonbridge', 'canarywharf'],
  ['londonbridge', 'battersea'],
];

type XZ = { x: number; z: number };

const hubById = new Map(SIM_HUBS.map((h) => [h.id, { ...h, ...projectLngLat(h.lng, h.lat) }]));

const corridorSegs: { a: XZ; b: XZ }[] = CORRIDORS.map(([idA, idB]) => {
  const a = hubById.get(idA)!;
  const b = hubById.get(idB)!;
  return { a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } };
});

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function inBoard(lng: number, lat: number): boolean {
  return (
    lng >= OSM_BBOX.west && lng <= OSM_BBOX.east && lat >= OSM_BBOX.south && lat <= OSM_BBOX.north
  );
}

/** Stratford / Hackney Wick — east of the central board, north of the Wharf. */
function inNortheastLeak(lng: number, lat: number): boolean {
  return lng > -0.048 && lat > 51.531;
}

function firstRing(geometry: { type: string; coordinates: unknown }): LngLat[] | null {
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as LngLat[][];
    return rings[0] ?? null;
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as LngLat[][][];
    let best: LngLat[] | null = null;
    let bestArea = 0;
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer) continue;
      const area = ringAreaM2(outer);
      if (area > bestArea) {
        best = outer;
        bestArea = area;
      }
    }
    return best;
  }
  return null;
}

function firstLine(geometry: { type: string; coordinates: unknown }): LngLat[] | null {
  if (geometry.type === 'LineString') return geometry.coordinates as LngLat[];
  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates as LngLat[][];
    let best: LngLat[] | null = null;
    let bestLen = 0;
    for (const line of lines) {
      if (line.length < 2) continue;
      let len = 0;
      for (let i = 1; i < line.length; i++) {
        const a = projectLngLat(line[i - 1][0], line[i - 1][1]);
        const b = projectLngLat(line[i][0], line[i][1]);
        len += Math.hypot(a.x - b.x, a.z - b.z);
      }
      if (len > bestLen) {
        best = line;
        bestLen = len;
      }
    }
    return best;
  }
  return null;
}

function centroid(ring: LngLat[]): LngLat {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring;
  let lng = 0;
  let lat = 0;
  for (const p of open) {
    lng += p[0];
    lat += p[1];
  }
  const n = Math.max(1, open.length);
  return [lng / n, lat / n];
}

function distToSegment(p: XZ, a: XZ, b: XZ): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  if (len2 < 1) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.z - (a.z + t * vz));
}

function nearestHubDist(lng: number, lat: number): number {
  const p = projectLngLat(lng, lat);
  let best = Infinity;
  for (const hub of hubById.values()) {
    best = Math.min(best, Math.hypot(p.x - hub.x, p.z - hub.z));
  }
  return best;
}

function minCorridorDist(lng: number, lat: number): number {
  const p = projectLngLat(lng, lat);
  let best = Infinity;
  for (const seg of corridorSegs) {
    best = Math.min(best, distToSegment(p, seg.a, seg.b));
  }
  return best;
}

function inFabric(lng: number, lat: number): boolean {
  if (!inBoard(lng, lat) || inNortheastLeak(lng, lat)) return false;
  if (nearestHubDist(lng, lat) <= HUB_CORE_M) return true;
  return minCorridorDist(lng, lat) <= CORRIDOR_M;
}

function quantizeRing(ring: LngLat[]): LngLat[] {
  return uniqueRing(
    ring.map(([lng, lat]) => [roundCoord(lng, COORD_DECIMALS), roundCoord(lat, COORD_DECIMALS)]),
  );
}

function simplifyFootprint(ring: LngLat[], maxVerts: number, tolerance: number): LngLat[] | null {
  const simplified = quantizeRing(capRing(simplifyRing(ring, tolerance), maxVerts));
  return simplified.length >= 4 ? simplified : null;
}

function simplifyLineString(line: LngLat[], maxVerts: number, tolerance: number): LngLat[] | null {
  if (line.length < 2) return null;
  const rd = simplifyLine(line, tolerance);
  const capped = capRing(rd, maxVerts);
  const pts = capped.map(
    ([lng, lat]) => [roundCoord(lng, COORD_DECIMALS), roundCoord(lat, COORD_DECIMALS)] as LngLat,
  );
  const out: LngLat[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out.length >= 2 ? out : null;
}

function isLandmark(feature: SimFeature<BuildingProperties>): boolean {
  if (feature.properties.height >= 70) return true;
  return Boolean(feature.properties.name && LANDMARK_NAME.test(feature.properties.name));
}

function isSilhouetteLandmark(feature: SimFeature<BuildingProperties>): boolean {
  const name = feature.properties.name?.trim() ?? '';
  if (name && SILHOUETTE_LANDMARK.test(name)) return true;
  return feature.properties.height >= 70;
}

function quantizeRings(rings: LngLat[][]): LngLat[][] {
  return rings.map(quantizeRing).filter((ring) => ring.length >= 4);
}

function preserveLandmarkGeometry(
  geometry: SimFeature['geometry'],
): SimFeature<BuildingProperties>['geometry'] | null {
  if (geometry.type === 'Polygon') {
    const rings = quantizeRings(geometry.coordinates as LngLat[][]);
    if (!rings[0]) return null;
    return { type: 'Polygon', coordinates: rings };
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = (geometry.coordinates as LngLat[][][])
      .map(quantizeRings)
      .filter((poly) => poly[0] && poly[0].length >= 4);
    if (!polys.length) return null;
    return { type: 'MultiPolygon', coordinates: polys };
  }
  return null;
}

function buildingMaxVerts(feature: SimFeature<BuildingProperties>, area: number): number {
  if (area > 700 || feature.properties.height >= 40) return LARGE_MAX_VERTS;
  return ORDINARY_MAX_VERTS;
}

function slimBuilding(
  feature: SimFeature<BuildingProperties>,
  geometry: SimFeature<BuildingProperties>['geometry'],
): SimFeature<BuildingProperties> {
  const props: BuildingProperties = {
    osmId: feature.properties.osmId,
    layer: 'building',
    building: feature.properties.building,
    height: feature.properties.height,
    heightSource: feature.properties.heightSource,
  };
  if (feature.properties.name) props.name = feature.properties.name;
  if (feature.properties.minHeight) props.minHeight = feature.properties.minHeight;
  return {
    type: 'Feature',
    properties: props,
    geometry,
  };
}

function slimCover(
  feature: SimFeature<LandcoverProperties>,
  ring: LngLat[],
): SimFeature<LandcoverProperties> {
  const props: LandcoverProperties = {
    osmId: feature.properties.osmId,
    layer: feature.properties.kind,
    kind: feature.properties.kind,
  };
  if (feature.properties.name) props.name = feature.properties.name;
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

function slimRoad(feature: SimFeature<RoadProperties>, line: LngLat[]): SimFeature<RoadProperties> {
  const props: RoadProperties = {
    osmId: feature.properties.osmId,
    layer: 'road',
    highway: feature.properties.highway,
    width: feature.properties.width,
  };
  if (feature.properties.name) props.name = feature.properties.name;
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: line },
  };
}

function sampleBuildings(
  rows: Array<{
    feature: SimFeature<BuildingProperties>;
    ring: LngLat[];
    area: number;
    landmark: boolean;
    hubDist: number;
  }>,
  cellM: number,
  keepNear: number,
  keepFar: number,
) {
  const bins = new Map<string, typeof rows>();
  const always: typeof rows = [];
  for (const row of rows) {
    if (row.landmark || row.feature.properties.height >= 40) {
      always.push(row);
      continue;
    }
    const p = projectLngLat(centroid(row.ring)[0], centroid(row.ring)[1]);
    const key = `${Math.floor(p.x / cellM)}:${Math.floor(p.z / cellM)}`;
    const list = bins.get(key) ?? [];
    list.push(row);
    bins.set(key, list);
  }
  const picked = new Set<string>();
  const out: typeof rows = [];
  const take = (row: (typeof rows)[number]) => {
    if (picked.has(row.feature.properties.osmId)) return;
    picked.add(row.feature.properties.osmId);
    out.push(row);
  };
  for (const row of always) take(row);
  for (const list of bins.values()) {
    list.sort(
      (a, b) => b.feature.properties.height - a.feature.properties.height || b.area - a.area,
    );
    const n = list[0] && list[0].hubDist <= HUB_CORE_M ? keepNear : keepFar;
    for (const row of list.slice(0, n)) take(row);
  }
  return out;
}

async function main() {
  const buildingPath = path.join(ROOT, 'data', BUILDING_DATA_FILE);
  const roadPath = path.join(ROOT, 'data', ROADS_DATA_FILE);
  const landPath = path.join(ROOT, 'data', LANDCOVER_DATA_FILE);
  if (!(await exists(buildingPath))) {
    throw new Error(`Missing ${buildingPath} — run pnpm osm:fetch`);
  }

  console.log('Reading full extract…');
  const buildings = JSON.parse(await readFile(buildingPath, 'utf8')) as {
    features: SimFeature<BuildingProperties>[];
  };
  const roads = (await exists(roadPath))
    ? (JSON.parse(await readFile(roadPath, 'utf8')) as { features: SimFeature<RoadProperties>[] })
    : { features: [] as SimFeature<RoadProperties>[] };
  const landcover = (await exists(landPath))
    ? (JSON.parse(await readFile(landPath, 'utf8')) as {
        features: SimFeature<LandcoverProperties>[];
      })
    : { features: [] as SimFeature<LandcoverProperties>[] };

  const ranked: Array<{
    feature: SimFeature<BuildingProperties>;
    ring: LngLat[];
    area: number;
    landmark: boolean;
    hubDist: number;
  }> = [];
  for (const feature of buildings.features) {
    const ring = firstRing(feature.geometry);
    if (!ring) continue;
    const [lng, lat] = centroid(ring);
    if (!inFabric(lng, lat)) continue;
    const area = ringAreaM2(ring);
    const landmark = isLandmark(feature);
    if (!landmark && area < 28) continue;
    ranked.push({
      feature,
      ring,
      area,
      landmark,
      hubDist: nearestHubDist(lng, lat),
    });
  }

  let selected = ranked;
  const encode = (
    buildingRows: typeof selected,
    roadFeatures: SimFeature<SimProperties>[],
    cover: SimFeature<SimProperties>[],
  ) => {
    const outFeatures: SimFeature<SimProperties>[] = [];
    for (const row of buildingRows) {
      if (isSilhouetteLandmark(row.feature)) {
        const geometry = preserveLandmarkGeometry(row.feature.geometry);
        if (!geometry) continue;
        outFeatures.push(slimBuilding(row.feature, geometry));
        continue;
      }
      const ring = simplifyFootprint(
        row.ring,
        buildingMaxVerts(row.feature, row.area),
        BUILDING_TOLERANCE,
      );
      if (!ring) continue;
      outFeatures.push(slimBuilding(row.feature, { type: 'Polygon', coordinates: [ring] }));
    }
    outFeatures.push(...roadFeatures, ...cover);
    const fc = {
      type: 'FeatureCollection' as const,
      name: 'central-london-clay-simplified',
      attribution: OSM_ATTRIBUTION,
      bbox: [OSM_BBOX.west, OSM_BBOX.south, OSM_BBOX.east, OSM_BBOX.north] as [
        number,
        number,
        number,
        number,
      ],
      generated: new Date().toISOString(),
      meta: {
        featureCount: outFeatures.length,
        source:
          'Simplified OSM fabric (hubs + corridors, streets, Thames) for the clay board (PR #22). Not used by /sim.',
        hubCoreM: HUB_CORE_M,
        corridorM: CORRIDOR_M,
        hubs: SIM_HUBS.map((h) => h.id),
      },
      features: outFeatures,
    };
    return { fc, json: JSON.stringify(fc) };
  };

  const coverOut: SimFeature<SimProperties>[] = [];
  for (const feature of landcover.features) {
    const ring = firstRing(feature.geometry);
    if (!ring) continue;
    const [lng, lat] = centroid(ring);
    if (!inBoard(lng, lat) || inNortheastLeak(lng, lat)) continue;
    const name = feature.properties.name ?? '';
    if (EXCLUDED_PARKS.test(name)) continue;
    const namedThames = /thames/i.test(name);
    const namedPark =
      feature.properties.kind === 'park' && KEEP_PARK_NAMES.has(name.trim().toLowerCase());
    const keepWater =
      feature.properties.kind === 'water' &&
      (namedThames || (inFabric(lng, lat) && ringAreaM2(ring) > 4000));
    if (!keepWater && !namedPark) continue;
    const maxVerts = feature.properties.kind === 'water' ? WATER_MAX_VERTS : PARK_MAX_VERTS;
    const simplified = simplifyFootprint(ring, maxVerts, COVER_TOLERANCE);
    if (!simplified) continue;
    coverOut.push(slimCover(feature, simplified));
  }

  const roadOut: SimFeature<SimProperties>[] = [];
  for (const feature of roads.features) {
    if (SKIP_ROADS.has(feature.properties.highway)) continue;
    const line = firstLine(feature.geometry);
    if (!line || line.length < 2) continue;
    const mid = line[Math.floor(line.length / 2)];
    if (!inFabric(mid[0], mid[1])) continue;
    const simplified = simplifyLineString(line, ROAD_MAX_VERTS, ROAD_TOLERANCE);
    if (!simplified) continue;
    roadOut.push(slimRoad(feature, simplified));
  }

  let packed = encode(selected, roadOut, coverOut);
  if (packed.json.length > SIMPLIFIED_MAX_BYTES) {
    console.warn(`${(packed.json.length / 1e6).toFixed(2)} MB over cap, sampling 70m cells`);
    selected = sampleBuildings(ranked, 70, 3, 2);
    packed = encode(selected, roadOut, coverOut);
  }
  if (packed.json.length > SIMPLIFIED_MAX_BYTES) {
    console.warn(`still ${(packed.json.length / 1e6).toFixed(2)} MB, sampling 95m cells`);
    selected = sampleBuildings(ranked, 95, 2, 1);
    packed = encode(selected, roadOut, coverOut);
  }

  if (packed.json.length > SIMPLIFIED_MAX_BYTES) {
    throw new Error(
      `Simplified extract is ${packed.json.length} bytes; cap is ${SIMPLIFIED_MAX_BYTES}`,
    );
  }

  const dest = path.join(ROOT, 'data', SIMPLIFIED_DATA_FILE);
  await writeFile(dest, packed.json);
  const buildingsKept = packed.fc.features.filter((f) => f.properties.layer === 'building').length;
  const roadsKept = packed.fc.features.filter((f) => f.properties.layer === 'road').length;
  const waterKept = packed.fc.features.filter((f) => f.properties.layer === 'water').length;
  const parkKept = packed.fc.features.filter((f) => f.properties.layer === 'park').length;
  console.log(
    `Wrote ${dest} (${(packed.json.length / 1e6).toFixed(2)} MB) — ${buildingsKept} buildings, ${roadsKept} streets, ${parkKept} parks, ${waterKept} water`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
