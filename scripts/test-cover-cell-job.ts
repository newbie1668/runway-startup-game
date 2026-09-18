import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCoverCellJob, type CoverCellReady } from '../lib/game/render3d/coverCellJob';
import { METERS_TO_WORLD } from '../lib/game/geo';
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

function coverSignature(root: THREE.Group): string {
  const streams: unknown[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    assert(!Array.isArray(object.material));
    const material = object.material as THREE.MeshBasicMaterial;
    const index = object.geometry.getIndex();
    assert(index);
    const attributes = Object.keys(object.geometry.attributes).sort();
    const tuples: number[] = [];
    for (let i = 0; i < index.count; i++) {
      const vertex = index.getX(i);
      for (const name of attributes) {
        const attribute = object.geometry.getAttribute(name);
        for (let c = 0; c < attribute.itemSize; c++)
          tuples.push(attribute.getComponent(vertex, c));
      }
    }
    streams.push({
      name: object.name,
      material: {
        type: material.type,
        color: material.color.getHex(),
        vertexColors: material.vertexColors,
        side: material.side,
        renderOrder: object.renderOrder,
      },
      tuples,
    });
  });
  return JSON.stringify(streams);
}

const boundaryWorld = 1600 * METERS_TO_WORLD;
const boundaryData: CityData = {
  buildings: [],
  roads: [
    {
      tier: 1,
      pts: new Uint16Array([
        quantizeX(boundaryWorld - 2),
        quantizeY(1),
        quantizeX(boundaryWorld + 2),
        quantizeY(1),
      ]),
    },
    {
      tier: 1,
      pts: new Uint16Array([quantizeX(100), quantizeY(50), quantizeX(102), quantizeY(50)]),
    },
  ],
  parks: [
    {
      verts: new Uint16Array([
        quantizeX(boundaryWorld - 2),
        quantizeY(-1),
        quantizeX(boundaryWorld + 2),
        quantizeY(-1),
        quantizeX(boundaryWorld + 2),
        quantizeY(3),
        quantizeX(boundaryWorld - 2),
        quantizeY(3),
      ]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    },
    {
      verts: new Uint16Array([
        quantizeX(100),
        quantizeY(50),
        quantizeX(102),
        quantizeY(50),
        quantizeX(102),
        quantizeY(52),
        quantizeX(100),
        quantizeY(52),
      ]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    },
  ],
  water: [],
};
const boundaryBounds = {
  minX: boundaryWorld - 1,
  minZ: 0,
  maxX: boundaryWorld + 1,
  maxZ: 2,
};

function buildBoundary(selection: { roads: number[]; parks: number[] }): CoverCellReady {
  let ready: CoverCellReady | null = null;
  const job = createCoverCellJob({
    id: 'boundary',
    generation: 1,
    essential: true,
    now: () => 0,
    cityData: boundaryData,
    bounds: boundaryBounds,
    selection: { roads: selection.roads, parks: selection.parks, water: [] },
    paintMarks: false,
    onReady: (value) => {
      ready = value;
    },
  });
  while (!job.step()) {}
  assert(ready);
  return ready;
}

const indexedBoundary = buildBoundary({ roads: [0], parks: [0] });
const fullBoundary = buildBoundary({ roads: [0, 1], parks: [0, 1] });
assert.deepEqual(
  coverSignature(indexedBoundary.group),
  coverSignature(fullBoundary.group),
  '1600 m indexed selection preserves ordered material/triangle tuples',
);
const indexedGeometries: THREE.BufferGeometry[] = [];
indexedBoundary.group.traverse((object) => {
  if (object instanceof THREE.Mesh) indexedGeometries.push(object.geometry);
});
let indexedDisposals = 0;
for (const geometry of indexedGeometries)
  geometry.addEventListener('dispose', () => {
    indexedDisposals++;
  });
indexedBoundary.dispose();
assert.equal(indexedDisposals, indexedGeometries.length, 'indexed cover owns its geometry');
fullBoundary.dispose();

console.log('Cover cell publication, ownership transfer and cancellation passed');
