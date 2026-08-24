/**
 * Pack the clay-board GeoJSON into a quantized binary the /sim client fetches.
 * The raw FeatureCollection stays in data/ for PR #22 and is not copied to public/.
 *
 * Usage: pnpm pack:sim
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { BUILDING_DATA_FILE, LANDCOVER_DATA_FILE, ROADS_DATA_FILE } from '../lib/sim/constants';
import {
  COMPACT_FILE,
  COMPACT_MAX_BYTES,
  COMPACT_QUANT_M,
  buildingKindIndex,
  packCity,
  packedOrigin,
  packedRoadKind,
  preparePackedRing,
  type PackedBuilding,
  type PackedCover,
  type PackedRoad,
} from '../lib/sim/compact';
import type {
  BuildingProperties,
  LandcoverProperties,
  LngLat,
  RoadProperties,
  SimFeatureCollection,
} from '../lib/sim/types';

const ROOT = process.cwd();
const SKIP_ROADS = new Set(['service', 'service_link']);

function keepName(name: string | undefined, height: number): string | undefined {
  if (!name) return undefined;
  if (height >= 50) return name;
  if (
    /shard|cathedral|westminster|battersea power|canada square|bishopsgate|st mary axe|fenchurch|bt tower|elizabeth tower/i.test(
      name,
    )
  ) {
    return name;
  }
  return undefined;
}

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
    return polys[0]?.[0] ?? null;
  }
  return null;
}

function firstLine(geometry: { type: string; coordinates: unknown }): LngLat[] | null {
  if (geometry.type === 'LineString') return geometry.coordinates as LngLat[];
  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates as LngLat[][];
    return lines[0] ?? null;
  }
  return null;
}

function writeBin(
  buildings: PackedBuilding[],
  roads: PackedRoad[],
  cover: PackedCover[],
): Uint8Array {
  return packCity({
    ...packedOrigin(),
    quant: COMPACT_QUANT_M,
    buildings,
    roads,
    cover,
  });
}

async function main() {
  const buildingPath = path.join(ROOT, 'data', BUILDING_DATA_FILE);
  const roadPath = path.join(ROOT, 'data', ROADS_DATA_FILE);
  const landPath = path.join(ROOT, 'data', LANDCOVER_DATA_FILE);
  if (!(await exists(buildingPath))) {
    throw new Error(`Missing ${buildingPath} — run pnpm osm:fetch`);
  }

  console.log('Reading GeoJSON extracts…');
  const buildings = JSON.parse(
    await readFile(buildingPath, 'utf8'),
  ) as SimFeatureCollection<BuildingProperties>;
  const roads = JSON.parse(
    await readFile(roadPath, 'utf8'),
  ) as SimFeatureCollection<RoadProperties>;
  const landcover = JSON.parse(
    await readFile(landPath, 'utf8'),
  ) as SimFeatureCollection<LandcoverProperties>;

  const packedBuildings: PackedBuilding[] = [];
  for (const feature of buildings.features) {
    const ring = firstRing(feature.geometry);
    if (!ring) continue;
    const outer = preparePackedRing(ring, 9);
    if (outer.length < 3) continue;
    packedBuildings.push({
      height: feature.properties.height,
      minHeight: feature.properties.minHeight ?? 0,
      kind: buildingKindIndex(feature.properties.building),
      outer,
      name: keepName(feature.properties.name, feature.properties.height),
    });
  }

  const packedRoads: PackedRoad[] = [];
  for (const feature of roads.features) {
    if (SKIP_ROADS.has(feature.properties.highway)) continue;
    const line = firstLine(feature.geometry);
    if (!line || line.length < 2) continue;
    const points = preparePackedRing(line, 14);
    if (points.length < 2) continue;
    packedRoads.push({
      width: feature.properties.width,
      kind: packedRoadKind(feature.properties.highway),
      points,
    });
  }

  const packedCover: PackedCover[] = [];
  for (const feature of landcover.features) {
    const ring = firstRing(feature.geometry);
    if (!ring) continue;
    const max = feature.properties.kind === 'water' ? 48 : 20;
    const outer = preparePackedRing(ring, max);
    if (outer.length < 3) continue;
    packedCover.push({ kind: feature.properties.kind, outer });
  }

  let usedBuildings = packedBuildings;
  let bin = writeBin(usedBuildings, packedRoads, packedCover);

  if (bin.byteLength > COMPACT_MAX_BYTES) {
    console.warn(
      `bin ${(bin.byteLength / 1e6).toFixed(2)} MB over cap, recapping footprints to 6 verts`,
    );
    usedBuildings = packedBuildings.map((b) => ({
      ...b,
      outer:
        b.outer.length <= 6
          ? b.outer
          : b.outer
              .filter((_, i) => i === 0 || i === b.outer.length - 1 || i % 2 === 0)
              .slice(0, 6),
    }));
    bin = writeBin(usedBuildings, packedRoads, packedCover);
  }

  if (bin.byteLength > COMPACT_MAX_BYTES) {
    console.warn(
      `bin ${(bin.byteLength / 1e6).toFixed(2)} MB still over, dropping unnamed houses under 8m`,
    );
    usedBuildings = usedBuildings.filter(
      (b) =>
        b.height >= 8 ||
        Boolean(b.name) ||
        b.kind === buildingKindIndex('office') ||
        b.kind === buildingKindIndex('apartments'),
    );
    bin = writeBin(usedBuildings, packedRoads, packedCover);
  }

  if (bin.byteLength > COMPACT_MAX_BYTES) {
    throw new Error(`Packed mesh is ${bin.byteLength} bytes; cap is ${COMPACT_MAX_BYTES}`);
  }

  const destDir = path.join(ROOT, 'public', 'sim');
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, COMPACT_FILE);
  await writeFile(dest, bin);
  console.log(
    `Wrote ${dest} (${(bin.byteLength / 1e6).toFixed(2)} MB) — ${usedBuildings.length} buildings, ${packedRoads.length} roads, ${packedCover.length} parks/water`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
