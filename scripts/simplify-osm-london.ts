/**
 * Build a few-MB clay-board subset around the RUNWAY hubs + City/Westminster.
 *
 * The full 50MB extract stays local (`pnpm pack:sim` / `pnpm osm:fetch`).
 * PR #22 should use this file, not osm-central-london.geojson.
 *
 * Usage: pnpm simplify:sim
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import {
  BUILDING_DATA_FILE,
  LANDCOVER_DATA_FILE,
  METERS_PER_DEGREE_LAT,
  METERS_PER_DEGREE_LNG,
  OSM_ATTRIBUTION,
  OSM_BBOX,
  SIMPLIFIED_DATA_FILE,
  SIMPLIFIED_MAX_BYTES,
  SIM_HUBS,
} from '../lib/sim/constants';
import { capRing } from '../lib/sim/compact';
import { ringAreaM2, roundCoord } from '../lib/sim/projection';
import { simplifyRing, uniqueRing } from '../lib/sim/simplify';
import type {
  BuildingProperties,
  LandcoverProperties,
  LngLat,
  SimFeature,
  SimProperties,
} from '../lib/sim/types';

const ROOT = process.cwd();
const HUB_RADIUS_M = 520;
const LANDMARK_RADIUS_M = 1200;
const PER_HUB = 420;
const BUILDING_TOLERANCE = 2.5e-5;
const COVER_TOLERANCE = 8e-5;
const COORD_DECIMALS = 5;

const LANDMARK_NAME =
  /shard|st paul|canada square|bishopsgate|battersea power|elizabeth tower|bt tower|st mary axe|fenchurch|palace of westminster|30 st mary/i;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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

function distToHub(lng: number, lat: number, hub: (typeof SIM_HUBS)[number]): number {
  const dx = (lng - hub.lng) * METERS_PER_DEGREE_LNG;
  const dy = (lat - hub.lat) * METERS_PER_DEGREE_LAT;
  return Math.hypot(dx, dy);
}

function nearestHub(lng: number, lat: number): { hub: (typeof SIM_HUBS)[number]; dist: number } {
  let best = { hub: SIM_HUBS[0], dist: Infinity };
  for (const hub of SIM_HUBS) {
    const dist = distToHub(lng, lat, hub);
    if (dist < best.dist) best = { hub, dist };
  }
  return best;
}

function quantizeRing(ring: LngLat[]): LngLat[] {
  const pts: LngLat[] = uniqueRing(
    ring.map(([lng, lat]) => [roundCoord(lng, COORD_DECIMALS), roundCoord(lat, COORD_DECIMALS)]),
  );
  return pts.length >= 4 ? pts : ring;
}

function simplifyFootprint(ring: LngLat[], maxVerts: number, tolerance: number): LngLat[] | null {
  const simplified = quantizeRing(capRing(simplifyRing(ring, tolerance), maxVerts));
  return simplified.length >= 4 ? simplified : null;
}

function slimBuilding(
  feature: SimFeature<BuildingProperties>,
  ring: LngLat[],
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
  if (feature.properties.levels) props.levels = feature.properties.levels;
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [ring] },
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

function isLandmark(feature: SimFeature<BuildingProperties>): boolean {
  if (feature.properties.height >= 70) return true;
  return Boolean(feature.properties.name && LANDMARK_NAME.test(feature.properties.name));
}

async function main() {
  const buildingPath = path.join(ROOT, 'data', BUILDING_DATA_FILE);
  const landPath = path.join(ROOT, 'data', LANDCOVER_DATA_FILE);
  if (!(await exists(buildingPath))) {
    throw new Error(`Missing ${buildingPath} — run pnpm osm:fetch`);
  }

  console.log('Reading full extract…');
  const buildings = JSON.parse(await readFile(buildingPath, 'utf8')) as {
    features: SimFeature<BuildingProperties>[];
  };
  const landcover = (await exists(landPath))
    ? (JSON.parse(await readFile(landPath, 'utf8')) as {
        features: SimFeature<LandcoverProperties>[];
      })
    : { features: [] as SimFeature<LandcoverProperties>[] };

  type Ranked = {
    feature: SimFeature<BuildingProperties>;
    ring: LngLat[];
    hubId: string;
    dist: number;
    area: number;
    landmark: boolean;
  };

  const ranked: Ranked[] = [];
  for (const feature of buildings.features) {
    const ring = firstRing(feature.geometry);
    if (!ring) continue;
    const [lng, lat] = centroid(ring);
    const near = nearestHub(lng, lat);
    const landmark = isLandmark(feature);
    const maxR = landmark ? LANDMARK_RADIUS_M : HUB_RADIUS_M;
    if (near.dist > maxR) continue;
    const area = ringAreaM2(ring);
    if (!landmark && area < 28) continue;
    ranked.push({
      feature,
      ring,
      hubId: near.hub.id,
      dist: near.dist,
      area,
      landmark,
    });
  }

  const picked = new Set<string>();
  const selected: Ranked[] = [];
  const take = (row: Ranked) => {
    if (picked.has(row.feature.properties.osmId)) return;
    picked.add(row.feature.properties.osmId);
    selected.push(row);
  };

  for (const row of ranked) {
    if (row.landmark) take(row);
  }

  for (const hub of SIM_HUBS) {
    const around = ranked
      .filter((row) => row.hubId === hub.id && row.dist <= HUB_RADIUS_M)
      .sort((a, b) => b.feature.properties.height - a.feature.properties.height || a.dist - b.dist);
    let n = 0;
    for (const row of around) {
      if (n >= PER_HUB) break;
      const before = picked.size;
      take(row);
      if (picked.size > before) n += 1;
    }
  }

  const outFeatures: SimFeature<SimProperties>[] = [];
  for (const row of selected) {
    const ring = simplifyFootprint(row.ring, 10, BUILDING_TOLERANCE);
    if (!ring) continue;
    outFeatures.push(slimBuilding(row.feature, ring));
  }

  for (const feature of landcover.features) {
    const ring = firstRing(feature.geometry);
    if (!ring) continue;
    const [lng, lat] = centroid(ring);
    const near = nearestHub(lng, lat);
    const namedThames = /thames/i.test(feature.properties.name ?? '');
    const namedPark =
      feature.properties.kind === 'park' &&
      /hyde park|green park|st james|regent|battersea park|victoria park|olympic park|burgess park/i.test(
        feature.properties.name ?? '',
      );
    const keepWater = feature.properties.kind === 'water' && (namedThames || near.dist <= 800);
    const keepPark = namedPark || (feature.properties.kind === 'park' && near.dist <= 420);
    if (!keepWater && !keepPark) continue;
    const maxVerts = feature.properties.kind === 'water' ? 36 : 16;
    const simplified = simplifyFootprint(ring, maxVerts, COVER_TOLERANCE);
    if (!simplified) continue;
    outFeatures.push(slimCover(feature, simplified));
  }

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
      source: 'Simplified OSM hub-cluster subset for the clay board (PR #22). Not used by /sim.',
      radiusM: HUB_RADIUS_M,
      hubs: SIM_HUBS.map((h) => h.id),
    },
    features: outFeatures,
  };

  let json = JSON.stringify(fc);
  if (json.length > SIMPLIFIED_MAX_BYTES) {
    const trimmed = outFeatures.filter((f) => {
      if (f.properties.layer !== 'building') return true;
      const b = f.properties as BuildingProperties;
      return Boolean(b.name) || b.height >= 10;
    });
    fc.features = trimmed;
    fc.meta.featureCount = trimmed.length;
    json = JSON.stringify(fc);
  }

  if (json.length > SIMPLIFIED_MAX_BYTES) {
    throw new Error(
      `Simplified extract is ${(json.length / 1e6).toFixed(2)} MB; cap is ${SIMPLIFIED_MAX_BYTES} bytes`,
    );
  }

  const dest = path.join(ROOT, 'data', SIMPLIFIED_DATA_FILE);
  await writeFile(dest, json);
  const buildingsKept = fc.features.filter((f) => f.properties.layer === 'building').length;
  const waterKept = fc.features.filter((f) => f.properties.layer === 'water').length;
  const parkKept = fc.features.filter((f) => f.properties.layer === 'park').length;
  console.log(
    `Wrote ${dest} (${(json.length / 1e6).toFixed(2)} MB) — ${buildingsKept} buildings, ${parkKept} parks, ${waterKept} water`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
