import assert from 'node:assert/strict';
import { SIM_HUBS, OSM_BBOX, OSM_ATTRIBUTION, METERS_PER_LEVEL } from '../lib/sim/constants';
import { resolveHeight, parseMeters, landmarkOverride } from '../lib/sim/height';
import { projectLngLat, unprojectXZ, ringAreaM2 } from '../lib/sim/projection';
import {
  buildingFeature,
  collection,
  landcoverFeature,
  roadFeature,
  type OverpassElement,
} from '../lib/sim/osm-parse';
import { buildingPalette, buildCity } from '../lib/sim/build-city';
import type { BuildingProperties, LandcoverProperties, RoadProperties } from '../lib/sim/types';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function checkAsync(label: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function closedSquare(id: number, west: number, south: number, size = 0.0004, tags: Record<string, string> = {}): OverpassElement {
  const east = west + size;
  const north = south + size;
  return {
    type: 'way',
    id,
    tags,
    geometry: [
      { lon: west, lat: south },
      { lon: east, lat: south },
      { lon: east, lat: north },
      { lon: west, lat: north },
      { lon: west, lat: south },
    ],
  };
}

console.log('Sim-London mesh tests');

async function main() {
check('bbox covers Hyde Park to Docklands and every hub', () => {
  assert.ok(OSM_BBOX.west <= -0.18, 'west should include Hyde Park');
  assert.ok(OSM_BBOX.east >= 0.01, 'east should include Docklands / Isle of Dogs');
  assert.ok(OSM_BBOX.south <= 51.48, 'south should include Battersea');
  assert.ok(OSM_BBOX.north >= 51.539, 'north should include Camden');
  for (const hub of SIM_HUBS) {
    assert.ok(hub.lng >= OSM_BBOX.west && hub.lng <= OSM_BBOX.east, `${hub.name} lng`);
    assert.ok(hub.lat >= OSM_BBOX.south && hub.lat <= OSM_BBOX.north, `${hub.name} lat`);
  }
});

check('eight RUNWAY hubs plus City and Westminster', () => {
  const ids = SIM_HUBS.map((h) => h.id);
  for (const id of [
    'shoreditch',
    'kingscross',
    'soho',
    'farringdon',
    'canarywharf',
    'londonbridge',
    'camden',
    'battersea',
    'city',
    'westminster',
  ]) {
    assert.ok(ids.includes(id as (typeof ids)[number]), id);
  }
  assert.equal(SIM_HUBS.length, 10);
});

check('height from OSM metres, feet, levels, and estimates', () => {
  assert.equal(parseMeters('12.5'), 12.5);
  assert.equal(parseMeters('40 ft')?.toFixed(2), (40 * 0.3048).toFixed(2));
  const levels = resolveHeight({ levels: 10, building: 'apartments' });
  assert.equal(levels.source, 'levels');
  assert.equal(levels.height, 10 * METERS_PER_LEVEL);
  const guessed = resolveHeight({ building: 'house' });
  assert.equal(guessed.source, 'estimate');
  assert.ok(guessed.height > 5 && guessed.height < 12);
  const shard = resolveHeight({ name: 'The Shard', building: 'yes' });
  assert.equal(shard.source, 'landmark');
  assert.ok(shard.height > 300);
  assert.equal(landmarkOverride("St Paul's Cathedral"), 111);
  assert.equal(landmarkOverride("St Paul's Cathedral School"), null);
  assert.equal(landmarkOverride('Battersea Power Station'), 50);
});

check('projection round-trips near the origin', () => {
  const p = projectLngLat(-0.086, 51.503);
  const back = unprojectXZ(p.x, p.z);
  assert.ok(Math.abs(back.lng + 0.086) < 1e-9);
  assert.ok(Math.abs(back.lat - 51.503) < 1e-9);
});

check('building GeoJSON keeps clay-board properties', () => {
  const feature = buildingFeature(
    closedSquare(1, -0.086, 51.503, 0.0005, {
      building: 'office',
      'building:levels': '12',
      name: 'Test Tower',
    }),
  );
  assert.ok(feature);
  assert.equal(feature.geometry.type, 'Polygon');
  assert.equal(feature.properties.layer, 'building');
  assert.equal(feature.properties.name, 'Test Tower');
  assert.equal(feature.properties.osmId, 'way/1');
  assert.equal(feature.properties.levels, 12);
  assert.ok(feature.properties.height > 30);
  assert.ok(Array.isArray(feature.geometry.coordinates[0]));
  const ring = feature.geometry.coordinates[0] as number[][];
  assert.equal(ring[0][0], ring[ring.length - 1][0]);
  assert.ok(ringAreaM2(ring as [number, number][]) > 20);
});

check('roads and Thames-sized water parse from OSM tags', () => {
  const road = roadFeature({
    type: 'way',
    id: 2,
    tags: { highway: 'primary', name: 'Strand' },
    geometry: [
      { lon: -0.12, lat: 51.511 },
      { lon: -0.11, lat: 51.511 },
      { lon: -0.1, lat: 51.511 },
    ],
  });
  assert.ok(road);
  assert.equal(road.properties.highway, 'primary');
  assert.ok(road.properties.width > 8);

  const water = landcoverFeature(
    closedSquare(3, -0.12, 51.5, 0.002, { natural: 'water', name: 'River Thames' }),
  );
  assert.ok(water);
  assert.equal(water.properties.kind, 'water');
});

check('driveways are dropped; named pedestrian streets are kept', () => {
  const driveway = roadFeature({
    type: 'way',
    id: 4,
    tags: { highway: 'service', service: 'driveway' },
    geometry: [
      { lon: -0.1, lat: 51.51 },
      { lon: -0.1005, lat: 51.51 },
    ],
  });
  assert.equal(driveway, null);
  const pedestrian = roadFeature({
    type: 'way',
    id: 5,
    tags: { highway: 'pedestrian', name: 'Carnaby Street' },
    geometry: [
      { lon: -0.138, lat: 51.513 },
      { lon: -0.139, lat: 51.513 },
    ],
  });
  assert.ok(pedestrian);
});

check('landmark palettes distinguish Shard, St Paul, Wharf, Battersea', () => {
  const shard = buildingPalette('yes', 309, 'The Shard', 'way/1');
  const stpaul = buildingPalette('cathedral', 111, "St Paul's Cathedral", 'way/2');
  const wharf = buildingPalette('office', 235, 'One Canada Square', 'way/3');
  const battersea = buildingPalette('yes', 50, 'Battersea Power Station', 'way/4');
  assert.ok(shard.glass > 0.8);
  assert.ok(stpaul.wall[0] > 0.7);
  assert.ok(wharf.wall[2] > wharf.wall[0]);
  assert.ok(battersea.wall[0] > battersea.wall[2]);
});

await checkAsync('extrusion of a real-sized footprint produces a watertight-ish mesh', async () => {
  const feature = buildingFeature(
    closedSquare(9, -0.019, 51.505, 0.0006, { building: 'office', height: '200', name: 'One Canada Square' }),
  )!;
  const emptyRoads = collection('roads', [] as never[]);
  const emptyLand = collection('land', [] as never[]);
  const buildings = collection('b', [feature]);
  const mesh = await buildCity({
    buildings: buildings as ReturnType<typeof collection<BuildingProperties>>,
    roads: emptyRoads as ReturnType<typeof collection<RoadProperties>>,
    landcover: emptyLand as ReturnType<typeof collection<LandcoverProperties>>,
  });
  assert.equal(mesh.stats.buildings, 1);
  assert.ok(mesh.stats.triangles >= 8);
  assert.ok(mesh.pickables.some((p) => p.name.includes('Canada')));
  const chunk = mesh.chunks.find((c) => c.kind === 'building');
  assert.ok(chunk);
  let maxY = 0;
  for (let i = 1; i < chunk.positions.length; i += 3) maxY = Math.max(maxY, chunk.positions[i]);
  assert.ok(maxY > 190, `tower roof should be ~200m, got ${maxY}`);
});

check('OSM attribution string is present for the HUD', () => {
  assert.match(OSM_ATTRIBUTION, /OpenStreetMap/);
});

await checkAsync('cached extract is a clay-board-ready FeatureCollection', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const buildingsPath = join(process.cwd(), 'data', 'osm-central-london.geojson');
  const roadsPath = join(process.cwd(), 'data', 'osm-central-london-roads.geojson');
  const landPath = join(process.cwd(), 'data', 'osm-central-london-landcover.geojson');
  if (!existsSync(buildingsPath)) {
    console.log('  ↷ skip cached extract (run pnpm osm:fetch)');
    return;
  }
  const buildings = JSON.parse(readFileSync(buildingsPath, 'utf8')) as {
    type: string;
    attribution: string;
    features: Array<{ properties: { height: number; osmId: string; layer: string }; geometry: { type: string } }>;
  };
  const roads = JSON.parse(readFileSync(roadsPath, 'utf8')) as { features: unknown[] };
  const land = JSON.parse(readFileSync(landPath, 'utf8')) as {
    features: Array<{ properties: { kind: string } }>;
  };
  assert.equal(buildings.type, 'FeatureCollection');
  assert.match(buildings.attribution, /OpenStreetMap/);
  assert.ok(buildings.features.length > 8000, `expected thousands of footprints, got ${buildings.features.length}`);
  assert.equal(buildings.features[0]?.properties.layer, 'building');
  assert.ok(buildings.features[0]?.properties.height > 0);
  assert.ok(buildings.features[0]?.geometry.type === 'Polygon' || buildings.features[0]?.geometry.type === 'MultiPolygon');
  assert.ok(roads.features.length > 2000, `expected a street network, got ${roads.features.length}`);
  assert.ok(
    land.features.some((f) => f.properties.kind === 'water'),
    'Thames / water polygons should be in the landcover extract',
  );
  const blob = readFileSync(buildingsPath, 'utf8');
  assert.match(blob, /Shard|Canada Square|St Paul|Battersea|Westminster/i);
});

console.log(`\n${passed} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
