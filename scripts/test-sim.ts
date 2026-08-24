import assert from 'node:assert/strict';
import {
  SIM_HUBS,
  OSM_BBOX,
  OSM_ATTRIBUTION,
  METERS_PER_LEVEL,
  OSM_ORIGIN,
  METERS_PER_DEGREE_LAT,
  METERS_PER_DEGREE_LNG,
  SIMPLIFIED_DATA_FILE,
  SIMPLIFIED_MAX_BYTES,
} from '../lib/sim/constants';
import {
  COMPACT_MAX_BYTES,
  COMPACT_QUANT_M,
  buildingKindIndex,
  packCity,
  packedRoadKind,
  unpackCity,
} from '../lib/sim/compact';
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

function closedSquare(
  id: number,
  west: number,
  south: number,
  size = 0.0004,
  tags: Record<string, string> = {},
): OverpassElement {
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

  await checkAsync(
    'extrusion of a real-sized footprint produces a watertight-ish mesh',
    async () => {
      const feature = buildingFeature(
        closedSquare(9, -0.019, 51.505, 0.0006, {
          building: 'office',
          height: '200',
          name: 'One Canada Square',
        }),
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
    },
  );

  check('OSM attribution string is present for the HUD', () => {
    assert.match(OSM_ATTRIBUTION, /OpenStreetMap/);
  });

  check('SIM1 pack/unpack round-trips a quantized footprint', () => {
    const packed = packCity({
      originLng: OSM_ORIGIN.lng,
      originLat: OSM_ORIGIN.lat,
      quant: COMPACT_QUANT_M,
      buildings: [
        {
          height: 310,
          minHeight: 0,
          kind: buildingKindIndex('yes'),
          outer: [
            { x: 10, z: 20 },
            { x: 40, z: 20 },
            { x: 40, z: 80 },
            { x: 10, z: 80 },
          ],
          name: 'The Shard',
        },
      ],
      roads: [
        {
          width: 12,
          kind: packedRoadKind('primary'),
          points: [
            { x: 0, z: 0 },
            { x: 100, z: 0 },
          ],
        },
      ],
      cover: [
        {
          kind: 'water',
          outer: [
            { x: 0, z: 0 },
            { x: 8, z: 0 },
            { x: 4, z: 6 },
          ],
        },
      ],
    });
    const back = unpackCity(packed);
    assert.equal(back.buildings.length, 1);
    assert.equal(back.buildings[0].name, 'The Shard');
    assert.equal(back.buildings[0].height, 310);
    assert.equal(back.roads[0].kind, 0);
    assert.equal(back.cover[0].kind, 'water');
    assert.equal(back.buildings[0].outer.length, 4);
    assert.ok(Math.abs(back.buildings[0].outer[0].x - 10) < COMPACT_QUANT_M);
  });

  await checkAsync(
    'public mesh is a compact SIM1 file under the size cap, not GeoJSON',
    async () => {
      const { existsSync, readFileSync, statSync } = await import('node:fs');
      const { join } = await import('node:path');
      const binPath = join(process.cwd(), 'public', 'sim', 'london.bin');
      const canvasSrc = readFileSync(
        join(process.cwd(), 'components', 'sim', 'SimCanvas.tsx'),
        'utf8',
      );
      assert.doesNotMatch(canvasSrc, /\.geojson/);
      assert.match(canvasSrc, /COMPACT_PUBLIC_PATH/);
      assert.ok(existsSync(binPath), 'run pnpm pack:sim');
      const size = statSync(binPath).size;
      assert.ok(size > 200_000, `mesh too small: ${size}`);
      assert.ok(size <= COMPACT_MAX_BYTES, `mesh ${size} exceeds ${COMPACT_MAX_BYTES}`);
      const city = unpackCity(readFileSync(binPath));
      assert.ok(
        city.buildings.length > 20_000,
        `expected a dense mesh, got ${city.buildings.length} buildings`,
      );
      assert.ok(city.roads.length > 5_000, `expected streets, got ${city.roads.length}`);
      assert.ok(
        city.cover.some((c) => c.kind === 'water'),
        'Thames / water should be packed',
      );
      assert.ok(
        city.buildings.some((b) =>
          /shard|canada square|st paul|battersea|westminster/i.test(b.name ?? ''),
        ),
        'landmark names should survive packing',
      );
    },
  );

  await checkAsync('simplified clay-board GeoJSON is a hub subset under a few MB', async () => {
    const { existsSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const simplifiedPath = join(process.cwd(), 'data', SIMPLIFIED_DATA_FILE);
    const fullPath = join(process.cwd(), 'data', 'osm-central-london.geojson');
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
    assert.match(gitignore, /osm-central-london\.geojson/);
    assert.ok(existsSync(simplifiedPath), 'run pnpm simplify:sim');
    const size = statSync(simplifiedPath).size;
    assert.ok(size > 200_000, `simplified extract too small: ${size}`);
    assert.ok(
      size <= SIMPLIFIED_MAX_BYTES,
      `simplified extract ${size} exceeds ${SIMPLIFIED_MAX_BYTES}`,
    );
    if (existsSync(fullPath)) {
      assert.ok(
        size < statSync(fullPath).size / 5,
        'simplified file should be far smaller than the full extract',
      );
    }
    const fc = JSON.parse(readFileSync(simplifiedPath, 'utf8')) as {
      type: string;
      attribution: string;
      meta: { source: string };
      features: Array<{
        properties: { height?: number; name?: string; layer: string; kind?: string };
        geometry: { type: string; coordinates: number[][][] };
      }>;
    };
    assert.equal(fc.type, 'FeatureCollection');
    assert.match(fc.attribution, /OpenStreetMap/);
    assert.match(fc.meta.source, /clay board|PR #22/i);
    const buildings = fc.features.filter((f) => f.properties.layer === 'building');
    assert.ok(
      buildings.length > 1500 && buildings.length < 20_000,
      `got ${buildings.length} buildings`,
    );
    assert.ok(
      fc.features.some((f) => f.properties.layer === 'water' || f.properties.kind === 'water'),
      'Thames / water should be in the clay subset',
    );
    const blob = readFileSync(simplifiedPath, 'utf8');
    assert.match(
      blob,
      /The Shard|One Canada Square|St Paul|Battersea Power|Palace of Westminster/i,
    );
    const packSrc = readFileSync(join(process.cwd(), 'scripts', 'pack-sim-mesh.ts'), 'utf8');
    assert.match(packSrc, /osm-central-london-simplified\.geojson/);
    for (const hub of SIM_HUBS) {
      let nearby = 0;
      for (const feature of buildings) {
        const ring = feature.geometry.coordinates[0];
        if (!ring?.length) continue;
        const n = ring.length > 1 ? ring.length - 1 : ring.length;
        let lng = 0;
        let lat = 0;
        for (let i = 0; i < n; i++) {
          lng += ring[i][0];
          lat += ring[i][1];
        }
        lng /= n;
        lat /= n;
        const dist = Math.hypot(
          (lng - hub.lng) * METERS_PER_DEGREE_LNG,
          (lat - hub.lat) * METERS_PER_DEGREE_LAT,
        );
        if (dist < 650) nearby += 1;
      }
      assert.ok(nearby >= 80, `${hub.name} should have clustered footprints, got ${nearby}`);
    }
  });

  console.log(`\n${passed} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
