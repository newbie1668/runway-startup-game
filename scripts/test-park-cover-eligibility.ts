import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildParks, createParkCoverJob } from '../lib/game/render3d/cityBuilder';
import { quantizeX, quantizeY, type CityPoly, type CityData } from '../lib/game/render3d/format';

function square(min: number, max: number): CityPoly {
  return {
    verts: new Uint16Array(
      [min, min, max, min, max, max, min, max].map((value, i) =>
        i % 2 ? quantizeY(value) : quantizeX(value),
      ),
    ),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}
const flooded = square(10, 12),
  dry = square(14, 15);
const source: CityData = { buildings: [], roads: [], water: [square(9, 13)], parks: [flooded] };

function build(cityData: CityData, parkIndices: number[]) {
  const result: { root: THREE.Group | null } = { root: null };
  const job = createParkCoverJob({
    id: 'eligibility',
    generation: 1,
    essential: true,
    now: () => 0,
    cityData,
    parkIndices,
    onReady(root) {
      result.root = root;
    },
  });
  let steps = 0;
  while (!job.step()) assert(++steps < 1_000_000);
  return result.root;
}
assert.equal(buildParks(source), null);
assert.equal(build(source, [0]), null);
assert.equal(build(source, [0]), null, 'cached zero tile count must not permit paths');
const multiple = { ...source, parks: [flooded, dry] };
assert.equal(build(multiple, [0]), null, 'unselected dry park must not permit paths');

function meshes(root: THREE.Object3D | null) {
  const found: THREE.Mesh[] = [];
  root?.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}
const before = meshes(buildParks(multiple)),
  after = meshes(build(multiple, [0, 1]));
assert(before.length > 0);
assert.equal(before.length, after.length);
const resources = new Set<THREE.BufferGeometry | THREE.Material>();
for (let i = 0; i < before.length; i++) {
  for (const name of ['position', 'normal', 'color']) {
    assert.deepEqual(
      after[i]!.geometry.getAttribute(name)?.array,
      before[i]!.geometry.getAttribute(name)?.array,
    );
  }
  assert.deepEqual(after[i]!.geometry.getIndex()!.array, before[i]!.geometry.getIndex()!.array);
  for (const mesh of [before[i]!, after[i]!]) {
    resources.add(mesh.geometry);
    assert(!Array.isArray(mesh.material));
    resources.add(mesh.material);
  }
}
for (const resource of resources) resource.dispose();
console.log('Park grass eligibility, cache and mixed-selection checks passed');
