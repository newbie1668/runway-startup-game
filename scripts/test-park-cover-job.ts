import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildParks, createParkCoverJob } from '../lib/game/render3d/cityBuilder';
import { clipCoverPolygon } from '../lib/game/render3d/coverClip';
import { COVER_PAGE_INDICES, COVER_PAGE_VERTICES } from '../lib/game/render3d/coverGeometry';
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

/**
 * Paged output splits each legacy park mesh (grass, paths) into fixed-capacity
 * pages, so parity is checked on logical geometry: per material stream (name,
 * material class/colour/vertexColors/side/polygon offset, in order) the ordered
 * triangle list with every present attribute (position, normal, colour) and
 * winding must match, every page index must be valid and every page bounded.
 */
type Stream = { key: string; meshes: THREE.Mesh[] };
function streamKey(mesh: THREE.Mesh): string {
  assert(mesh.material instanceof THREE.MeshBasicMaterial);
  const m = mesh.material;
  return JSON.stringify([
    mesh.name,
    m.color.getHex(),
    m.vertexColors,
    m.side,
    m.polygonOffsetFactor,
    mesh.receiveShadow,
    mesh.renderOrder,
    mesh.userData,
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

const legacyRoot = buildParks(city),
  pagedRoot = build(city);
const before = meshes(legacyRoot),
  after = meshes(pagedRoot);
const want = streams(legacyRoot),
  got = streams(pagedRoot);
assert.equal(want.length, before.length, 'each legacy park mesh is its own material stream');
assert.deepEqual(
  got.map((stream) => stream.key),
  want.map((stream) => stream.key),
  'grass then path stream sequence preserved',
);
assert(after.length > before.length, 'whole-city grass/paths are split into pages');
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
    assert.equal(page.name, legacy.name);
    assert.equal(page.material, b.meshes[0]!.material, 'one material per stream');
  }
}
assert.equal(
  new Set(after.map((mesh) => mesh.material)).size,
  new Set(before.map((mesh) => mesh.material)).size,
  'same number of materials as legacy',
);
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
