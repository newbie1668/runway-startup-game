/**
 * Measures fixed-capacity cover paging on the committed binary: retained
 * geometry bytes, emitted mesh count (potential draw calls — not rendered
 * calls; nothing is rendered here), triangle count and generation time, for
 * the whole city and a bounded representative selection, against the legacy
 * synchronous builders on the same source records. Output is JSON on stdout.
 *
 *   pnpm tsx scripts/profile-cover-pages.ts
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { METERS_TO_WORLD } from '../lib/game/geo';
import {
  buildParks,
  buildRoads,
  buildWater,
  createParkCoverJob,
  createRoadCoverJob,
} from '../lib/game/render3d/cityBuilder';
import type { BuildJob } from '../lib/game/render3d/buildScheduler';
import type { BoundsXZ } from '../lib/game/render3d/cityIndex';
import {
  decodeCity,
  dequantizeX,
  dequantizeY,
  type CityData,
  type CityPoly,
  type CityRoad,
} from '../lib/game/render3d/format';
import { createWaterCoverJob } from '../lib/game/render3d/waterCoverJob';

type Metrics = {
  meshes: number;
  triangles: number;
  vertices: number;
  geometryBytes: number;
  materials: number;
  ms: number;
  steps?: number;
};

function measure(root: THREE.Object3D | null, ms: number, steps?: number): Metrics {
  const out: Metrics = { meshes: 0, triangles: 0, vertices: 0, geometryBytes: 0, materials: 0, ms };
  if (steps !== undefined) out.steps = steps;
  const materials = new Set<THREE.Material>();
  root?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    out.meshes++;
    const geometry = object.geometry as THREE.BufferGeometry;
    for (const attribute of Object.values(geometry.attributes))
      out.geometryBytes += (attribute as THREE.BufferAttribute).array.byteLength;
    const index = geometry.getIndex();
    if (index) {
      out.geometryBytes += index.array.byteLength;
      out.triangles += index.count / 3;
    }
    out.vertices += geometry.getAttribute('position').count;
    materials.add(object.material as THREE.Material);
  });
  out.materials = materials.size;
  return out;
}

function dispose(root: THREE.Object3D | null): void {
  root?.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
}

function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const value = fn();
  return [value, performance.now() - start];
}

function runJob(make: (onReady: (group: THREE.Group | null) => void) => BuildJob): Metrics {
  let output: THREE.Group | null = null;
  let steps = 0;
  const [, ms] = timed(() => {
    const job = make((group) => {
      output = group;
    });
    while (!job.step()) steps++;
  });
  return measure(output, ms, steps);
}

function polyBounds(poly: CityPoly): BoundsXZ {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < poly.verts.length; i += 2) {
    const x = dequantizeX(poly.verts[i]!),
      z = dequantizeY(poly.verts[i + 1]!);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

function roadBounds(road: CityRoad): BoundsXZ {
  return polyBounds({ verts: road.pts, indices: new Uint16Array(0) });
}

function hits(a: BoundsXZ, b: BoundsXZ, pad: number): boolean {
  return (
    a.minX <= b.maxX + pad &&
    a.maxX >= b.minX - pad &&
    a.minZ <= b.maxZ + pad &&
    a.maxZ >= b.minZ - pad
  );
}

const bytes = readFileSync('public/map/london-city.bin');
const city = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const options = { generation: 1, essential: true, now: () => performance.now() };

const report: Record<string, unknown> = {
  source: {
    roads: city.roads.length,
    parks: city.parks.length,
    water: city.water.length,
    roadPoints: city.roads.reduce((sum, road) => sum + road.pts.length / 2, 0),
  },
};

// Whole city: same source records, same selection, legacy vs paged.
{
  const all = (list: unknown[]) => list.map((_, i) => i);
  const [legacyRoads, roadsMs] = timed(() => buildRoads(city));
  const [legacyParks, parksMs] = timed(() => buildParks(city));
  const [legacyWater, waterMs] = timed(() => buildWater(city));
  report.wholeCity = {
    legacy: {
      roads: measure(legacyRoads, roadsMs),
      parks: measure(legacyParks, parksMs),
      water: measure(legacyWater, waterMs),
    },
    paged: {
      roads: runJob((onReady) =>
        createRoadCoverJob({
          ...options,
          id: 'roads',
          cityData: city,
          roadIndices: all(city.roads),
          onReady,
        }),
      ),
      parks: runJob((onReady) =>
        createParkCoverJob({
          ...options,
          id: 'parks',
          cityData: city,
          parkIndices: all(city.parks),
          onReady,
        }),
      ),
      water: runJob((onReady) =>
        createWaterCoverJob({
          ...options,
          id: 'water',
          cityData: city,
          waterIndices: all(city.water),
          onReady,
        }),
      ),
    },
  };
  dispose(legacyRoads);
  dispose(legacyParks);
  dispose(legacyWater);
}

// Bounded representative selection: one 400 m cover cell in the centre of the
// source rectangle, records selected by AABB overlap with 20 m padding
// (the C3 cover-grid contract). Legacy oracle builds an unclipped city that
// holds only the selected records; paged output is clipped to the cell.
{
  const source = polyBounds({
    verts: Uint16Array.from([0, 0, 65535, 65535]),
    indices: new Uint16Array(0),
  });
  const cell = 400 * METERS_TO_WORLD;
  const cx = (source.minX + source.maxX) / 2,
    cz = (source.minZ + source.maxZ) / 2;
  const bounds: BoundsXZ = {
    minX: cx - cell / 2,
    maxX: cx + cell / 2,
    minZ: cz - cell / 2,
    maxZ: cz + cell / 2,
  };
  const pad = 20 * METERS_TO_WORLD;
  const roadIndices = city.roads.flatMap((road, i) =>
    hits(roadBounds(road), bounds, pad) ? [i] : [],
  );
  const parkIndices = city.parks.flatMap((poly, i) =>
    hits(polyBounds(poly), bounds, pad) ? [i] : [],
  );
  const waterIndices = city.water.flatMap((poly, i) =>
    hits(polyBounds(poly), bounds, pad) ? [i] : [],
  );
  const subset: CityData = {
    buildings: [],
    roads: roadIndices.map((i) => city.roads[i]!),
    parks: parkIndices.map((i) => city.parks[i]!),
    water: waterIndices.map((i) => city.water[i]!),
  };
  const [legacyRoads, roadsMs] = timed(() => buildRoads(subset));
  const [legacyParks, parksMs] = timed(() => buildParks(subset));
  const [legacyWater, waterMs] = timed(() => buildWater(subset));
  // Cold: a fresh CityData identity pays for the shared road/water context;
  // warm: the whole-city runs above already cached it for `city`.
  const coldCity = decodeCity(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const paged = (label: string, cityData: CityData) => ({
    roads: runJob((onReady) =>
      createRoadCoverJob({
        ...options,
        id: `${label}-roads`,
        cityData,
        roadIndices,
        bounds,
        onReady,
      }),
    ),
    parks: runJob((onReady) =>
      createParkCoverJob({
        ...options,
        id: `${label}-parks`,
        cityData,
        parkIndices,
        bounds,
        onReady,
      }),
    ),
    water: runJob((onReady) =>
      createWaterCoverJob({
        ...options,
        id: `${label}-water`,
        cityData,
        waterIndices,
        bounds,
        onReady,
      }),
    ),
  });
  const cold = paged('cell-cold', coldCity);
  const warm = paged('cell-warm', city);
  report.cell400m = {
    bounds,
    selection: { roads: roadIndices.length, parks: parkIndices.length, water: waterIndices.length },
    legacyUnclippedSubset: {
      roads: measure(legacyRoads, roadsMs),
      parks: measure(legacyParks, parksMs),
      water: measure(legacyWater, waterMs),
    },
    pagedClippedColdContext: cold,
    pagedClippedWarmContext: warm,
  };
  dispose(legacyRoads);
  dispose(legacyParks);
  dispose(legacyWater);
}

console.log(JSON.stringify(report, null, 2));
