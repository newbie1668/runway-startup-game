import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCoverCellJob, type CoverCellReady } from '../lib/game/render3d/coverCellJob';
import { quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';

const data: CityData = {
  buildings: [],
  parks: [],
  roads: [],
  water: [
    {
      verts: new Uint16Array([
        quantizeX(10),
        quantizeY(10),
        quantizeX(12),
        quantizeY(10),
        quantizeX(12),
        quantizeY(12),
        quantizeX(10),
        quantizeY(12),
      ]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    },
  ],
};
const base = {
  id: 'cover',
  generation: 1,
  essential: true,
  now: () => 0,
  cityData: data,
  bounds: { minX: 8, minZ: 8, maxX: 16, maxZ: 16 },
  selection: { water: [0], parks: [], roads: [] },
  paintMarks: true,
};
const output: { value: CoverCellReady | null } = { value: null };
const job = createCoverCellJob({
  ...base,
  onReady: (ready) => {
    output.value = ready;
  },
});
let steps = 0;
while (!job.step()) {
  assert(++steps < 10_000);
  assert.equal(output.value, null, 'partial cover layers are never published');
}
assert.ok(output.value);
const ready = output.value;
const geometries = new Set<THREE.BufferGeometry>();
ready.group.traverse((object) => {
  if (object instanceof THREE.Mesh) geometries.add(object.geometry);
});
assert(geometries.size >= 2, 'water and its banks publish together');
let disposals = 0;
for (const geometry of geometries)
  geometry.addEventListener('dispose', () => {
    disposals++;
  });
const parent = new THREE.Group().add(ready.group);
job.cancel();
assert.equal(disposals, 0, 'completed job transfers ownership');
ready.dispose();
ready.dispose();
assert.equal(parent.children.length, 0);
assert.equal(disposals, geometries.size);

const original = THREE.BufferGeometry.prototype.dispose;
const cancelled: THREE.BufferGeometry[] = [];
THREE.BufferGeometry.prototype.dispose = function () {
  cancelled.push(this);
  original.call(this);
};
try {
  const partial = createCoverCellJob({
    ...base,
    onReady: () => assert.fail('cancelled publication'),
  });
  partial.step();
  partial.cancel();
  partial.cancel();
  assert.equal(partial.step(), true);
  assert(cancelled.length > 0);
  assert.equal(cancelled.length, new Set(cancelled).size);
} finally {
  THREE.BufferGeometry.prototype.dispose = original;
}
console.log('Cover cell publication, ownership transfer and cancellation passed');
