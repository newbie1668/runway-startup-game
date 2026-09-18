import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCity, quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';
import {
  riverCrossingSpans,
  roadCoverContextSteps,
  splitRoadRuns,
} from '../lib/game/render3d/cityBuilder';
import { pointOverWater, waterRings, type WaterPoint } from '../lib/game/render3d/waterQuery';

function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

const raw = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
const city = decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const cityCopy = decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const spans = riverCrossingSpans(city);
assert.equal(spans.length, 15);
assert.equal(digest(spans), '449a9b5a9274067f4dfe75f93598a000557c6abbb30c2c777d00d07019abf6a1');
assert.equal(
  digest(finish(roadCoverContextSteps(city))),
  '2fe9c9ece69868c64047030ba99480b2e5a754c84c4b8de6998a6376c874b7ba',
  'full-city crossings and crosswalks preserve the accepted context',
);

const baselinePointInRing = (x: number, z: number, ring: WaterPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const zi = ring[i]!.z;
    const xj = ring[j]!.x;
    const zj = ring[j]!.z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
};
const synthetic: CityData = {
  buildings: [], roads: [], parks: [],
  water: [{ verts: new Uint16Array([
    quantizeX(1), quantizeY(1), quantizeX(5), quantizeY(2),
    quantizeX(5), quantizeY(5), quantizeX(1), quantizeY(5),
  ]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) }],
};
const optimizedRings = waterRings(synthetic);
const ring = optimizedRings[0]!;
for (let x = -1; x <= 7; x += 0.125) {
  for (let z = -1; z <= 7; z += 0.125) {
    assert.equal(pointOverWater(x, z, optimizedRings), baselinePointInRing(x, z, ring.points));
  }
}
assert.equal(pointOverWater(ring.minX, ring.minZ, optimizedRings), baselinePointInRing(ring.minX, ring.minZ, ring.points));
assert.equal(pointOverWater(ring.maxX + Number.EPSILON, 2, optimizedRings), baselinePointInRing(ring.maxX + Number.EPSILON, 2, ring.points));

const sliverCity: CityData = {
  buildings: [], roads: [], parks: [],
  water: [{ verts: new Uint16Array([
    quantizeX(0), quantizeY(0), quantizeX(1000), quantizeY(1000),
    quantizeX(0), quantizeY(1000),
  ]), indices: new Uint16Array([0, 1, 2]) }],
};
const sliverRing = waterRings(sliverCity)[0]!;
const sliverX = -1e-12;
const sliverZ = 1e-13;
assert.equal(baselinePointInRing(sliverX, sliverZ, sliverRing.points), true);
assert.equal(pointOverWater(sliverX, sliverZ, [sliverRing]), true);

// Traversal fixtures use the optimized decoded-ring query itself.
const overWater = (x: number, z: number): boolean => pointOverWater(x, z, optimizedRings);
const interiorRuns = splitRoadRuns(
  [{ x: 0, z: 3 }, { x: 2, z: 3 }, { x: 4, z: 3 }, { x: 6, z: 3 }],
  overWater,
);
assert.equal(interiorRuns.length, 2);
const narrowCity: CityData = {
  buildings: [], roads: [], parks: [],
  water: [{ verts: new Uint16Array([
    quantizeX(2), quantizeY(1), quantizeX(2.1), quantizeY(1),
    quantizeX(2.1), quantizeY(5), quantizeX(2), quantizeY(5),
  ]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) }],
};
const narrowWater = waterRings(narrowCity);
const narrowRuns = splitRoadRuns(
  [{ x: 0, z: 3 }, { x: 4, z: 3 }],
  (x, z) => pointOverWater(x, z, narrowWater),
);
assert.equal(narrowRuns.length, 1);

// Water edges stay governed by the existing predicate, including exact edges.
const edgeWater = (x: number): boolean => x >= 1 && x <= 2;
const edgeRuns = splitRoadRuns(
  [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }],
  edgeWater,
);
assert.equal(edgeRuns.length, 2);
assert.ok(edgeRuns.every((run) => run.pts.every((p) => !edgeWater(p.x))));

const shortEdges = Array.from({ length: 1024 }, (_, i) => ({ x: i * 1e-5, z: 1 }));
for (const wet of [false, true]) {
  let queries = 0;
  const runs = splitRoadRuns(shortEdges, () => {
    queries++;
    return wet;
  });
  assert.equal(queries, shortEdges.length, 'classify each source vertex once');
  assert.deepEqual(runs, wet ? [] : [{ pts: shortEdges, span: false }]);
}

// Returned spans are defensive copies, and a second decoded instance has its own cache entry.
const firstPoint = spans[0]!.pts[0];
spans[0]!.pts[0] = { x: -1, z: -1 };
const again = riverCrossingSpans(city);
assert.deepEqual(again[0]!.pts[0], firstPoint);
assert.deepEqual(again, riverCrossingSpans(cityCopy));
assert.equal(digest(again), '449a9b5a9274067f4dfe75f93598a000557c6abbb30c2c777d00d07019abf6a1');

// Keep the source identity visible in the focused evidence.
assert.equal(createHash('sha256').update(raw).digest('hex'), '6375dd81dfb23a7ef6e312b888c1b0bcf9e26b67978081a48403429221a2a2c0');
console.log(`water-query semantics: ${spans.length} spans, source ${raw.byteLength} bytes`);
