import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCity } from '../lib/game/render3d/format';
import {
  buildWaterEdgeIndex,
  indexedPointInRingSteps,
  type WaterEdgeIndex,
} from '../lib/game/render3d/waterEdgeIndex';
import {
  pointInRing,
  pointOverWater,
  pointOverWaterSteps,
  waterRings,
  waterRingsSteps,
} from '../lib/game/render3d/waterQuery';

function consume<T>(steps: Generator<void, T>): { value: T; units: number } {
  let units = 0;
  let result = steps.next();
  while (!result.done) {
    units++;
    result = steps.next();
  }
  return { value: result.value, units };
}

function cachedEdgeCount(index: WaterEdgeIndex): number {
  if (index.kind === 'leaf') return index.edges.length / 4;
  return cachedEdgeCount(index.left) + cachedEdgeCount(index.right);
}

function cachedCoordinateCount(index: WaterEdgeIndex): number {
  if (index.kind === 'leaf') return index.edges.length;
  return cachedCoordinateCount(index.left) + cachedCoordinateCount(index.right);
}

const bytes = readFileSync('public/map/london-city.bin');
const data = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const rings = waterRings(data);
const cached = consume(waterRingsSteps(data)).value;
let indexedUnits = 0;
let fullEdges = 0;
let cases = 0;
for (const ring of rings) {
  const index = consume(buildWaterEdgeIndex(ring.points)).value;
  const stride = Math.max(1, Math.ceil(ring.points.length / 96));
  for (let i = 0; i < ring.points.length; i += stride) {
    const point = ring.points[i]!;
    const previous = ring.points[(i + ring.points.length - 1) % ring.points.length]!;
    for (const query of [
      point,
      { x: point.x + 1e-10, z: point.z },
      { x: point.x - 1e-10, z: point.z + 1e-10 },
      { x: (point.x + previous.x) / 2, z: (point.z + previous.z) / 2 },
    ]) {
      const result = consume(indexedPointInRingSteps(query.x, query.z, index));
      assert.equal(result.value, pointInRing(query.x, query.z, ring.points));
      indexedUnits += result.units;
      fullEdges += ring.points.length;
      cases++;
    }
  }
}
assert(indexedUnits < fullEdges / 3, 'Query resumptions must fall without changing containment');

let random = 20260917;
const next = (): number => {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  return random / 0x100000000;
};
for (let i = 0; i < 2000; i++) {
  const x = next() * 500;
  const z = next() * 200;
  assert.equal(consume(pointOverWaterSteps(x, z, cached)).value, pointOverWater(x, z, rings));
}

for (const length of [0, 1, 31, 32, 33, 1025, 65535]) {
  let reads = 0;
  const points = Array.from({ length }, (_, i) => ({
    get x() {
      reads++;
      return i % 7;
    },
    get z() {
      reads++;
      return i % 2 === 0 ? -10 : 10;
    },
  }));
  const built = consume(buildWaterEdgeIndex(points));
  assert(built.units <= length * 2 + 1);
  assert.equal(reads, length * 4, 'construction decodes each edge endpoint once');
  assert.equal(cachedEdgeCount(built.value), length, 'leaves retain one cached tuple per edge');
  assert.equal(cachedCoordinateCount(built.value), length * 4, 'leaves retain four coordinates per edge');
  for (const z of [-10, -10 + 1e-12, 0, 10 - 1e-12, 10]) {
    const query = indexedPointInRingSteps(2.5, z, built.value);
    let units = 0;
    for (;;) {
      reads = 0;
      const result = query.next();
      assert.equal(reads, 0, 'indexed queries do not reread source coordinates');
      if (result.done) {
        assert.equal(result.value, pointInRing(2.5, z, points));
        break;
      }
      assert(++units <= length * 2 + 1);
    }
  }
}
console.log(
  `Water edge hierarchy: ${cases} boundary checks, 2000 source queries, zero source-coordinate reads/unit, ${(fullEdges / indexedUnits).toFixed(1)}x fewer resumptions than linear edges`,
);
