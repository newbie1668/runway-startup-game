import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  buildRoads,
  createRoadCoverJob,
  roadCoverContextSteps,
} from '../lib/game/render3d/cityBuilder';
import { decodeCity, quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';

function meshes(root: THREE.Object3D | null): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root?.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

const bytes = readFileSync('public/map/london-city.bin');
const city = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
let output: THREE.Group | null = null,
  steps = 0;
const job = createRoadCoverJob({
  id: 'roads',
  generation: 1,
  essential: true,
  cityData: city,
  roadIndices: city.roads.map((_, i) => i),
  now: () => 0,
  onReady(group) {
    output = group;
  },
});
while (!job.step()) {
  steps++;
  assert(steps < 10_000_000);
}
assert(steps > 1000, 'whole-city road context and geometry span bounded steps');
const after = meshes(output),
  before = meshes(buildRoads(city));
assert.equal(after.length, before.length);
for (let i = 0; i < before.length; i++) {
  const a = before[i]!,
    b = after[i]!;
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
  assert.deepEqual(b.geometry.boundingSphere, a.geometry.boundingSphere);
  assert.deepEqual(b.userData, a.userData);
  assert.equal(b.renderOrder, a.renderOrder);
  assert(a.material instanceof THREE.MeshLambertMaterial);
  assert(b.material instanceof THREE.MeshLambertMaterial);
  assert.deepEqual(b.material.color, a.material.color);
}
const resources = new Set<{ dispose(): void }>();
for (const mesh of [...before, ...after]) {
  resources.add(mesh.geometry);
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    resources.add(material);
}
for (const resource of resources) resource.dispose();
const context = roadCoverContextSteps(city).next();
assert(context.done, 'completed original city context is reused');

const data: CityData = {
  buildings: [],
  water: [],
  parks: [],
  roads: [
    { tier: 0, pts: new Uint16Array([quantizeX(10), quantizeY(10), quantizeX(20), quantizeY(10)]) },
  ],
};
let local: THREE.Group | null = null;
const crossing = createRoadCoverJob({
  id: 'crossing',
  generation: 2,
  essential: true,
  cityData: data,
  roadIndices: [0],
  now: () => 0,
  bounds: { minX: 12, minZ: 9, maxX: 14, maxZ: 11 },
  roadContext: { crossings: [], crosswalks: [] },
  onReady(group) {
    local = group;
  },
});
while (!crossing.step()) {}
assert(
  meshes(local).length >= 2,
  'road crossing query remains visible with both endpoints outside',
);
for (const mesh of meshes(local)) {
  const position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    assert(position.getX(i) >= 12 && position.getX(i) <= 14);
    assert(position.getZ(i) >= 9 && position.getZ(i) <= 11);
  }
}
let calls = 0,
  reads = 0;
const points = new Uint16Array(4000);
const guarded = new Proxy(points, {
  get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, target);
  },
});
const cancelled = createRoadCoverJob({
  id: 'long-road',
  generation: 3,
  essential: true,
  cityData: { ...data, roads: [{ tier: 0, pts: guarded }] },
  roadIndices: [0],
  now: () => 0,
  roadContext: { crossings: [], crosswalks: [] },
  onReady() {
    calls++;
  },
});
assert.equal(reads, 0);
assert.equal(cancelled.step(), false);
assert(reads > 0 && reads <= 128);
cancelled.cancel();
cancelled.cancel();
assert.equal(cancelled.step(), true);
assert.equal(calls, 0);
console.log(
  'Road cover jobs: full binary parity, cold context, bounded reads, crossing selection and cancellation passed',
);
