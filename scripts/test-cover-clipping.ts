import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { BuildJob } from '../lib/game/render3d/buildScheduler';
import type { BoundsXZ } from '../lib/game/render3d/cityIndex';
import { buildRoads, buildWater, createRoadCoverJob } from '../lib/game/render3d/cityBuilder';
import { quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';
import { createWaterCoverJob } from '../lib/game/render3d/waterCoverJob';

type Point = readonly [number, number];
type Triangle = readonly [Point, Point, Point];
const tolerance = 0.000005;
const options = { id: 'clip', generation: 1, essential: true, now: () => 0 };
const empty: CityData = { buildings: [], roads: [], parks: [], water: [] };

function coordinates(points: readonly Point[]): Uint16Array {
  return new Uint16Array(points.flatMap(([x, z]) => [quantizeX(x), quantizeY(z)]));
}

function complete(make: (onReady: (root: THREE.Group | null) => void) => BuildJob) {
  const result: { root: THREE.Group | null } = { root: null };
  const job = make((root) => {
    result.root = root;
  });
  let count = 0;
  while (!job.step()) assert(++count < 100_000);
  return result.root;
}

function triangles(root: THREE.Object3D | null): Map<number, Triangle[]> {
  const result = new Map<number, Triangle[]>();
  root?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    assert(object.material instanceof THREE.MeshLambertMaterial);
    const color = object.material.color.getHex();
    const list = result.get(color) ?? [];
    const position = object.geometry.getAttribute('position'),
      index = object.geometry.getIndex()!;
    const point = (i: number): Point => [position.getX(i), position.getZ(i)];
    for (let i = 0; i < index.count; i += 3) {
      list.push([point(index.getX(i)), point(index.getX(i + 1)), point(index.getX(i + 2))]);
    }
    result.set(color, list);
  });
  return result;
}

function clearance(triangles: readonly Triangle[], x: number, z: number): number {
  let best = -Infinity;
  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-12) continue;
    let distance = Infinity;
    for (let i = 0; i < 3; i++) {
      const p = triangle[i]!,
        q = triangle[(i + 1) % 3]!;
      distance = Math.min(
        distance,
        (Math.sign(area) * ((q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0]))) /
          Math.hypot(q[0] - p[0], q[1] - p[1]),
      );
    }
    best = Math.max(best, distance);
  }
  return best;
}

function verify(before: THREE.Object3D | null, after: THREE.Object3D | null, bounds: BoundsXZ) {
  const original = triangles(before),
    clipped = triangles(after);
  let covered = 0;
  for (const color of new Set([...original.keys(), ...clipped.keys()])) {
    const source = original.get(color) ?? [],
      output = clipped.get(color) ?? [];
    for (const triangle of output)
      for (const [x, z] of triangle) {
        assert(x >= bounds.minX - tolerance && x <= bounds.maxX + tolerance);
        assert(z >= bounds.minZ - tolerance && z <= bounds.maxZ + tolerance);
      }
    for (let ix = 0; ix < 41; ix++)
      for (let iz = 0; iz < 43; iz++) {
        const x = bounds.minX + ((bounds.maxX - bounds.minX) * (ix + 0.371)) / 41;
        const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * (iz + 0.613)) / 43;
        const expected = clearance(source, x, z),
          actual = clearance(output, x, z);
        if (expected > tolerance) {
          covered++;
          assert(actual >= -tolerance, `missing coverage for ${color} at ${x},${z}`);
        }
        if (actual > tolerance)
          assert(expected >= -tolerance, `extra coverage for ${color} at ${x},${z}`);
      }
  }
  assert(covered > 0, 'fixture must exercise visible interior coverage');
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  for (const root of [before, after])
    root?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      assert(!Array.isArray(object.material));
      resources.add(object.material);
    });
  for (const resource of resources) resource.dispose();
}

const bounds = { minX: 9.95, maxX: 10.02, minZ: 9.94, maxZ: 10.06 };
for (const points of [
  [
    [10, 10],
    [10.03, 10],
    [10, 10.01],
  ],
  [
    [10, 10],
    [10.04, 10],
    [10.001, 10.001],
    [10.02, 10.04],
  ],
  [
    [9.8, 10],
    [10.2, 10],
  ],
] satisfies Point[][]) {
  const data: CityData = { ...empty, roads: [{ pts: coordinates(points), tier: 0 }] };
  const before = buildRoads(data, null, false);
  const after = complete((onReady) =>
    createRoadCoverJob({
      ...options,
      cityData: data,
      roadIndices: [0],
      paintMarks: false,
      bounds,
      roadContext: { crossings: [], crosswalks: [] },
      onReady,
    }),
  );
  verify(before, after, bounds);
}

for (const points of [
  [
    [10, 10],
    [10.03, 10],
    [10, 10.01],
  ],
  [
    [10, 10],
    [10.04, 10],
    [10.001, 10.001],
    [10.02, 10.04],
  ],
] satisfies Point[][]) {
  const indices = points.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3];
  const data: CityData = {
    ...empty,
    water: [{ verts: coordinates(points), indices: new Uint16Array(indices) }],
  };
  const before = buildWater(data);
  const after = complete((onReady) =>
    createWaterCoverJob({
      ...options,
      cityData: data,
      waterIndices: [0],
      bounds,
      onReady,
    }),
  );
  verify(before, after, bounds);
}
console.log('5 road and water clipping occupancy checks passed');
