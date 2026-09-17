import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildParks, createParkCoverJob } from '../lib/game/render3d/cityBuilder';
import { clipCoverPolygon } from '../lib/game/render3d/coverClip';
import {
  decodeCity,
  quantizeX,
  quantizeY,
  type CityData,
  type CityPoly,
} from '../lib/game/render3d/format';
import {
  pointInRing,
  pointInRingSteps,
  pointOverWater,
  pointOverWaterSteps,
  waterRings,
  waterRingsSteps,
} from '../lib/game/render3d/waterQuery';

function consume<T>(steps: Generator<void, T>): T {
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

const bytes = readFileSync('public/map/london-city.bin');
const city = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const rings = consume(waterRingsSteps(city));
assert.deepEqual(rings, waterRings(city));
assert.equal(consume(waterRingsSteps(city)), rings, 'immutable city context reused by identity');
for (const ring of rings) {
  for (const point of [
    ring.points[0]!,
    { x: (ring.minX + ring.maxX) / 2, z: (ring.minZ + ring.maxZ) / 2 },
  ]) {
    assert.equal(
      consume(pointInRingSteps(point.x, point.z, ring.points)),
      pointInRing(point.x, point.z, ring.points),
    );
    assert.equal(
      consume(pointOverWaterSteps(point.x, point.z, rings)),
      pointOverWater(point.x, point.z, rings),
    );
  }
}

function meshes(root: THREE.Object3D | null): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root?.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

function build(
  data: CityData,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null,
): THREE.Group | null {
  let root: THREE.Group | null = null,
    steps = 0;
  const job = createParkCoverJob({
    id: 'parks',
    generation: 1,
    essential: true,
    now: () => 0,
    cityData: data,
    parkIndices: data.parks.map((_, i) => i),
    bounds,
    onReady(group) {
      root = group;
    },
  });
  while (!job.step()) {
    steps++;
    assert(steps < 10_000_000);
  }
  return root;
}

const before = meshes(buildParks(city)),
  after = meshes(build(city));
assert.equal(after.length, before.length);
for (let i = 0; i < before.length; i++) {
  const a = before[i]!,
    b = after[i]!;
  assert.equal(a.name, b.name);
  for (const attribute of Object.keys(a.geometry.attributes))
    assert.deepEqual(
      b.geometry.getAttribute(attribute).array,
      a.geometry.getAttribute(attribute).array,
      attribute,
    );
  assert.deepEqual(
    Array.from(b.geometry.getIndex()!.array),
    Array.from(a.geometry.getIndex()!.array),
  );
  assert.deepEqual(a.geometry.boundingSphere, b.geometry.boundingSphere);
}
for (const mesh of [...before, ...after]) {
  mesh.geometry.dispose();
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    material.dispose();
}

const square: CityPoly = {
  verts: new Uint16Array(
    [
      [10, 10],
      [15, 10],
      [15, 15],
      [10, 15],
    ].flatMap(([x, z]) => [quantizeX(x!), quantizeY(z!)]),
  ),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};
const fixture: CityData = { buildings: [], roads: [], parks: [square], water: [] };
const clipped = meshes(build(fixture, { minX: 11, minZ: 11, maxX: 12, maxZ: 14 }));
assert(clipped.length, 'enclosing park must fill the narrow query');
assert(
  clipped.some((mesh) => mesh.name !== 'grass'),
  'crossing path survives an offscreen park centroid',
);
for (const mesh of clipped) {
  const position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    assert(position.getX(i) >= 11 && position.getX(i) <= 12);
    assert(position.getZ(i) >= 11 && position.getZ(i) <= 14);
  }
}
const garden: CityPoly = {
  verts: new Uint16Array(
    [
      [10, 10],
      [10.3, 10],
      [10.3, 10.3],
      [10, 10.3],
    ].flatMap(([x, z]) => [quantizeX(x!), quantizeY(z!)]),
  ),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};
const gardenCity = { ...fixture, parks: [garden] };
const gardenBounds = { minX: 10.05, minZ: 10.05, maxX: 10.1, maxZ: 10.15 };
const area = (root: THREE.Group | null): number => {
  let total = 0;
  for (const mesh of meshes(root)) {
    if (mesh.name !== 'grass') continue;
    const positions = mesh.geometry.getAttribute('position'),
      indices = mesh.geometry.getIndex()!;
    for (let i = 0; i < indices.count; i += 3) {
      const triangle = [];
      for (let j = i; j < i + 3; j++) {
        const index = indices.getX(j);
        triangle.push({ x: positions.getX(index), z: positions.getZ(index) });
      }
      const polygon = clipCoverPolygon(triangle, gardenBounds);
      let sum = 0;
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j]!,
          b = polygon[(j + 1) % polygon.length]!;
        sum += a.x * b.z - b.x * a.z;
      }
      total += Math.abs(sum) / 2;
    }
  }
  return total;
};
const expectedArea = area(buildParks(gardenCity));
assert(
  Math.abs(area(build(gardenCity, gardenBounds)) - expectedArea) < 1e-6,
  'cold local selection preserves the global fallback decision',
);
assert(
  Math.abs(area(build(gardenCity, gardenBounds)) - expectedArea) < 1e-6,
  'cached local selection preserves the global fallback decision',
);
assert.equal(build({ ...fixture, parks: [] }), null);
console.log(
  'Park cover jobs: full binary parity, water context, clipping and empty selection passed',
);
