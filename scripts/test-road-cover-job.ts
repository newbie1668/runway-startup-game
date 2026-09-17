import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  buildRoads,
  createRoadCoverJob,
  roadCoverContextSteps,
} from '../lib/game/render3d/cityBuilder';
import { COVER_PAGE_INDICES, COVER_PAGE_VERTICES } from '../lib/game/render3d/coverGeometry';
import { decodeCity, quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';

function meshes(root: THREE.Object3D | null): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root?.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

/**
 * Paged output may split one legacy mesh into several fixed-capacity pages, so
 * parity is checked on the logical geometry: for each material stream (same
 * material colour, road tier, render order and metadata, in first-appearance
 * order) the ordered triangle list with every present attribute must match.
 */
type Stream = { key: string; meshes: THREE.Mesh[] };
function streamKey(mesh: THREE.Mesh): string {
  assert(mesh.material instanceof THREE.MeshLambertMaterial);
  return JSON.stringify([
    mesh.material.color.getHex(),
    mesh.material.polygonOffsetFactor,
    mesh.parent?.userData.roadTier ?? null,
    mesh.renderOrder,
    mesh.userData,
    mesh.name,
  ]);
}
function streams(root: THREE.Object3D | null): Stream[] {
  const result: Stream[] = [];
  for (const mesh of meshes(root)) {
    const key = streamKey(mesh);
    const last = result[result.length - 1];
    if (last?.key === key) last.meshes.push(mesh);
    else {
      assert(!result.some((stream) => stream.key === key), `stream ${key} is contiguous`);
      result.push({ key, meshes: [mesh] });
    }
  }
  return result;
}
function triangles(stream: Stream): number[] {
  const out: number[] = [];
  for (const mesh of stream.meshes) {
    const names = Object.keys(mesh.geometry.attributes).sort();
    const index = mesh.geometry.getIndex()!;
    assert.equal(index.count % 3, 0);
    for (let i = 0; i < index.count; i++) {
      const v = index.getX(i);
      for (const name of names) {
        const attribute = mesh.geometry.getAttribute(name);
        assert(v < attribute.count, `${name} index in range`);
        for (let c = 0; c < attribute.itemSize; c++) out.push(attribute.getComponent(v, c));
      }
    }
  }
  return out;
}
function assertPage(mesh: THREE.Mesh): void {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex()!;
  assert(position.count > 0 && position.count <= COVER_PAGE_VERTICES, 'page vertex cap');
  assert(index.count > 0 && index.count <= COVER_PAGE_INDICES, 'page index cap');
  assert(index.array instanceof Uint16Array, 'page-local 16-bit indices');
  const sphere = mesh.geometry.boundingSphere!;
  assert(sphere && mesh.geometry.boundingBox, 'page bounds computed');
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    assert(mesh.geometry.boundingBox!.containsPoint(p), 'bounding box holds every vertex');
    assert(p.distanceTo(sphere.center) <= sphere.radius * (1 + 1e-6), 'sphere holds vertex');
  }
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
const legacyRoot = buildRoads(city);
const after = meshes(output),
  before = meshes(legacyRoot);
const want = streams(legacyRoot),
  got = streams(output);
assert.equal(want.length, before.length, 'each legacy road mesh is its own material stream');
assert.deepEqual(
  got.map((stream) => stream.key),
  want.map((stream) => stream.key),
  'material/tier/render-order stream sequence preserved',
);
assert(after.length > before.length, 'whole-city output is split into pages');
for (let i = 0; i < want.length; i++) {
  const a = want[i]!,
    b = got[i]!;
  const legacy = a.meshes[0]!;
  assert.deepEqual(
    Object.keys(legacy.geometry.attributes).sort(),
    Object.keys(b.meshes[0]!.geometry.attributes).sort(),
    'same attribute set',
  );
  assert.deepEqual(triangles(b), triangles(a), `ordered triangles for ${a.key}`);
  for (const page of b.meshes) {
    assertPage(page);
    assert.equal(page.material, b.meshes[0]!.material, 'one material per stream');
    assert.deepEqual(page.userData, legacy.userData);
    assert.equal(page.renderOrder, legacy.renderOrder);
    assert.equal(page.parent?.userData.roadTier, legacy.parent?.userData.roadTier);
  }
}
const materialsOf = (list: THREE.Mesh[]) => new Set(list.map((mesh) => mesh.material));
assert.equal(materialsOf(after).size, materialsOf(before).size, 'shared materials as legacy');
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
