import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { METERS_TO_WORLD, WORLD } from '../lib/game/geo';
import type { BuildJob } from '../lib/game/render3d/buildScheduler';
import { buildWater } from '../lib/game/render3d/cityBuilder';
import { coverMesh, createCoverJob } from '../lib/game/render3d/coverGeometry';
import {
  decodeCity,
  quantizeX,
  quantizeY,
  type CityData,
  type CityPoly,
} from '../lib/game/render3d/format';
import { createWaterCoverJob } from '../lib/game/render3d/waterCoverJob';

function finish(job: BuildJob): number {
  let steps = 1;
  while (!job.step()) {
    steps++;
    assert(steps < 100_000, 'job must terminate');
  }
  return steps;
}

function polygon(points: number[][]): CityPoly {
  return {
    verts: new Uint16Array(points.flatMap(([x, z]) => [quantizeX(x!), quantizeY(z!)])),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

const city: CityData = {
  buildings: [],
  parks: [],
  roads: [],
  water: [
    polygon([
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ]),
  ],
};
const options = { id: 'water', generation: 1, essential: true, now: () => 0 };

function build(data: CityData): THREE.Group | null {
  let root: THREE.Group | null = null;
  finish(
    createWaterCoverJob({
      ...options,
      cityData: data,
      waterIndices: data.water.map((_, i) => i),
      onReady(group) {
        root = group;
      },
    }),
  );
  return root;
}

function meshes(root: THREE.Object3D | null): THREE.Mesh[] {
  const values: THREE.Mesh[] = [];
  root?.traverse((object) => {
    if (object instanceof THREE.Mesh) values.push(object);
  });
  return values;
}

function dispose(root: THREE.Object3D | null): void {
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  for (const mesh of meshes(root)) {
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      resources.add(material);
  }
  for (const resource of resources) resource.dispose();
}

function equalGeometry(data: CityData): void {
  const old = buildWater(data),
    next = build(data);
  const a = meshes(old),
    b = meshes(next);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    const before = a[i]!,
      after = b[i]!;
    assert.deepEqual(
      after.geometry.getAttribute('position').array,
      before.geometry.getAttribute('position').array,
    );
    const beforeNormal = before.geometry.getAttribute('normal'),
      afterNormal = after.geometry.getAttribute('normal');
    assert.equal(afterNormal.count, beforeNormal.count);
    for (let j = 0; j < beforeNormal.count; j++) {
      assert.deepEqual(
        [afterNormal.getX(j), afterNormal.getY(j), afterNormal.getZ(j)],
        [beforeNormal.getX(j), beforeNormal.getY(j), beforeNormal.getZ(j)],
      );
    }
    assert.deepEqual(
      Array.from(after.geometry.getIndex()!.array),
      Array.from(before.geometry.getIndex()!.array),
    );
    assert.deepEqual(after.geometry.boundingSphere, before.geometry.boundingSphere);
    assert(before.material instanceof THREE.MeshLambertMaterial);
    assert(after.material instanceof THREE.MeshLambertMaterial);
    assert.deepEqual(after.material.color, before.material.color);
  }
  dispose(old);
  dispose(next);
}

equalGeometry(city);
assert.equal(build({ ...city, water: [] }), null);

{
  const bounds = { minX: 12, minZ: 12, maxX: 14, maxZ: 18 };
  let root: THREE.Group | null = null;
  finish(
    createWaterCoverJob({
      ...options,
      cityData: city,
      waterIndices: [0],
      bounds,
      onReady(group) {
        root = group;
      },
    }),
  );
  const output = meshes(root);
  assert.equal(output.length, 1, 'enclosing water covers query without banks from outside');
  const position = output[0]!.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    assert(position.getX(i) >= bounds.minX && position.getX(i) <= bounds.maxX);
    assert(position.getZ(i) >= bounds.minZ && position.getZ(i) <= bounds.maxZ);
  }
  assert.equal(output[0]!.geometry.boundingBox!.min.x, bounds.minX);
  assert.equal(output[0]!.geometry.boundingBox!.max.z, bounds.maxZ);
  dispose(root);
}

{
  let reads = 0;
  const points = new Uint16Array(4000);
  const guarded = new Proxy(points, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, target);
    },
  });
  const data: CityData = {
    ...city,
    water: [{ verts: guarded, indices: new Uint16Array([0, 1, 2]) }],
  };
  let called = 0;
  const job = createWaterCoverJob({
    ...options,
    cityData: data,
    waterIndices: [0],
    onReady() {
      called++;
    },
  });
  assert.equal(reads, 0);
  assert.equal(job.step(), false);
  assert(reads <= 128 && reads > 0, 'one active step has bounded coordinate work');
  job.cancel();
  job.cancel();
  assert.equal(job.step(), true);
  assert.equal(called, 0);
}

{
  let clock = 0,
    units = 0;
  const job = createCoverJob({ ...options, now: () => clock++, onReady() {} }, function* () {
    for (let i = 0; i < 500; i++) {
      units++;
      yield;
    }
  });
  assert.equal(job.step(), false);
  assert(units > 0 && units < 64);
  job.cancel();
}

for (const error of [false, undefined, new Error('callback')]) {
  let called = 0,
    released = 0;
  const parent = new THREE.Group();
  const job = createCoverJob(
    {
      ...options,
      onReady(group) {
        called++;
        assert(group);
        parent.add(group);
        throw error;
      },
    },
    function* (context) {
      const material = context.own(new THREE.MeshBasicMaterial());
      material.addEventListener('dispose', () => released++);
      const mesh = yield* coverMesh(context, [0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2], material);
      assert(mesh);
      mesh.geometry.addEventListener('dispose', () => released++);
      context.root.add(mesh);
    },
  );
  let caught = false;
  try {
    finish(job);
  } catch (value) {
    caught = true;
    assert.equal(value, error);
  }
  assert(caught);
  assert.equal(called, 1);
  assert.equal(released, 2);
  assert.equal(parent.children.length, 0);
  assert.equal(job.step(), true);
  job.cancel();
  assert.equal(called, 1);
  assert.equal(released, 2);
}

{
  let released = 0;
  const job = createCoverJob(
    {
      ...options,
      onReady() {
        job.cancel();
        assert.equal(job.step(), true);
      },
    },
    function* (context) {
      const material = context.own(new THREE.MeshBasicMaterial());
      material.addEventListener('dispose', () => released++);
      const mesh = yield* coverMesh(context, [0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2], material);
      assert(mesh);
      context.root.add(mesh);
    },
  );
  finish(job);
  assert.equal(released, 1);
}

{
  const parent = new THREE.Group();
  const job = createWaterCoverJob({
    ...options,
    cityData: city,
    waterIndices: [0],
    onReady(group) {
      assert(group);
      parent.add(group);
    },
  });
  finish(job);
  let released = 0;
  for (const mesh of meshes(parent)) mesh.geometry.addEventListener('dispose', () => released++);
  job.cancel();
  assert.equal(job.step(), true);
  assert.equal(parent.children.length, 1);
  assert.equal(released, 0);
  dispose(parent);
}

{
  const bytes = readFileSync('public/map/london-city.bin');
  const data = decodeCity(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(data.water.length, 62);
  equalGeometry(data);
  const x = WORLD.width / 2,
    z = WORLD.height / 2,
    pad = 400 * METERS_TO_WORLD;
  const job = createWaterCoverJob({
    ...options,
    cityData: data,
    waterIndices: data.water.map((_, i) => i),
    bounds: { minX: x - pad, minZ: z - pad, maxX: x + pad, maxZ: z + pad },
    onReady: dispose,
  });
  assert(finish(job) > 10, 'real water emits across bounded steps');
}

console.log('Water cover jobs: parity, clipping, slicing, ownership and real binary passed');
