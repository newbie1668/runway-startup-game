import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTreeCoverJob } from '../lib/game/render3d/cityBuilder';
import { decodeCity } from '../lib/game/render3d/format';

const bytes = readFileSync('public/map/london-city.bin');
const city = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
let root: THREE.Group | null = null,
  steps = 0;
const job = createTreeCoverJob({
  id: 'trees',
  generation: 1,
  essential: false,
  cityData: city,
  now: () => 0,
  onReady(group) {
    root = group;
  },
});
while (!job.step()) {
  steps++;
  assert(steps < 10_000_000);
}
assert(root);
const result: THREE.Group = root;
assert.equal(result.children.length, 4);
const expected = [
  [36000, 'ebbbc8e3b6e7ada72987f5c61dff504f95dcd16174696f40df6816580f5da7d9'],
  [21060, 'be652c753ae47dc58a91d08c48a7d50a546d3ebadec327af2457ab5413dd34f8'],
  [21093, '987df1155eef265deb1f1d7c2d6ccdacf07169b25293bd01ae018552fb43242e'],
  [21039, '0a390ddc731a3fe426d4088d2a92a65e86948b29c8672ebf7027b74e74f0d441'],
] as const;
const originals: Float32Array[] = [];
for (let i = 0; i < 4; i++) {
  const hash = createHash('sha256');
  let count = 0;
  const matrices = new Float32Array(expected[i]![0] * 16);
  for (const mesh of result.children[i]!.children) {
    assert(mesh instanceof THREE.InstancedMesh);
    assert(mesh.count <= 1024, 'bounded matrix allocation');
    const values = mesh.instanceMatrix.array;
    hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
    matrices.set(values, count * 16);
    count += mesh.count;
  }
  assert.equal(count, expected[i]![0]);
  assert.equal(hash.digest('hex'), expected[i]![1], 'matrices match buildParkTrees at 81946c1');
  originals.push(matrices);
}
assert(steps > 100, 'placement and emission span multiple slices');
job.cancel();
assert.equal(job.step(), true);

const center = new THREE.Vector3().setFromMatrixPosition(
  new THREE.Matrix4().fromArray(originals[0]!, 200 * 16),
);
const bounds = {
  minX: center.x - 0.5,
  maxX: center.x + 0.5,
  minZ: center.z - 0.5,
  maxZ: center.z + 0.5,
};
let selected: THREE.Group | null = null;
const local = createTreeCoverJob({
  id: 'local-trees',
  generation: 2,
  essential: false,
  cityData: city,
  now: () => 0,
  bounds,
  onReady(group) {
    selected = group;
  },
});
while (!local.step()) {}
assert(selected);
const localResult: THREE.Group = selected;
const positions = new Set<string>();
for (let i = 0; i < originals[0]!.length; i += 16)
  positions.add(Array.from(originals[0]!.subarray(i, i + 16)).join(','));
let localCount = 0;
for (const mesh of localResult.children[0]!.children) {
  assert(mesh instanceof THREE.InstancedMesh);
  for (let i = 0; i < mesh.count; i++) {
    const matrix = mesh.instanceMatrix.array.slice(i * 16, (i + 1) * 16);
    assert(
      positions.has(Array.from(matrix).join(',')),
      'local query preserves original tree transforms',
    );
    assert(matrix[12]! >= bounds.minX && matrix[12]! <= bounds.maxX);
    assert(matrix[14]! >= bounds.minZ && matrix[14]! <= bounds.maxZ);
    localCount++;
  }
}
assert(localCount > 0 && localCount < 36000);

{
  let calls = 0;
  const cancelled = createTreeCoverJob({
    id: 'cancelled',
    generation: 3,
    essential: false,
    cityData: city,
    now: () => 0,
    onReady() {
      calls++;
    },
  });
  assert.equal(cancelled.step(), false);
  cancelled.cancel();
  cancelled.cancel();
  assert.equal(cancelled.step(), true);
  assert.equal(calls, 0);
}

const resources = new Set<{ dispose(): void }>();
for (const group of [result, localResult]) {
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      resources.add(object);
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        resources.add(material);
    }
  });
}
for (const resource of resources) resource.dispose();
console.log(
  'Tree cover jobs: baseline transforms, global cap, bounded pages, local selection and cancellation passed',
);
