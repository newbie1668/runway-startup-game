/**
 * Focused tests for the incremental cover spatial index (R5b-4a).
 * Run with: pnpm tsx scripts/test-cover-index.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METERS_TO_WORLD, WORLD } from '../lib/game/geo';
import { createBuildScheduler } from '../lib/game/render3d/buildScheduler';
import type { BoundsXZ, CellId } from '../lib/game/render3d/cityIndex';
import {
  coverForBounds,
  createCoverIndexJob,
  type CoverIndex,
  type CoverLayer,
  type CoverSelection,
} from '../lib/game/render3d/coverIndex';
import {
  decodeCity,
  dequantizeX,
  dequantizeY,
  quantizeX,
  quantizeY,
  type CityData,
  type CityPoly,
  type CityRoad,
} from '../lib/game/render3d/format';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const LAYERS: readonly CoverLayer[] = ['roads', 'parks', 'water'];
const CELL_M = 400;
const CELL_W = CELL_M * METERS_TO_WORLD;
const LARGE_CELL_M = 1600;
const LARGE_CELL_W = LARGE_CELL_M * METERS_TO_WORLD;
const M = METERS_TO_WORLD;

/** Metre coordinate pairs → frozen quantized road record. */
function road(...metres: number[]): CityRoad {
  return Object.freeze({ tier: 2, pts: quantize(metres) });
}
/** Metre coordinate pairs → frozen quantized polygon record (no triangles needed). */
function poly(...metres: number[]): CityPoly {
  return Object.freeze({ verts: quantize(metres), indices: new Uint16Array(0) });
}
function quantize(metres: number[]): Uint16Array {
  const out = new Uint16Array(metres.length);
  for (let i = 0; i < metres.length; i += 2) {
    out[i] = quantizeX(metres[i]! * M);
    out[i + 1] = quantizeY(metres[i + 1]! * M);
  }
  return out;
}
function city(
  roads: readonly CityRoad[] = [],
  parks: readonly CityPoly[] = [],
  water: readonly CityPoly[] = [],
): CityData {
  return Object.freeze({
    buildings: Object.freeze([]),
    roads: Object.freeze([...roads]),
    parks: Object.freeze([...parks]),
    water: Object.freeze([...water]),
  }) as unknown as CityData;
}
/** Query box in metres. */
function boxM(minX: number, minZ: number, maxX: number, maxZ: number): BoundsXZ {
  return { minX: minX * M, minZ: minZ * M, maxX: maxX * M, maxZ: maxZ * M };
}
const WORLD_BOUNDS: BoundsXZ = { minX: 0, minZ: 0, maxX: WORLD.width, maxZ: WORLD.height };
const constantClock = (): number => 0;

function build(
  data: CityData,
  opts: {
    now?: () => number;
    sliceMs?: number;
    cellSizeM?: number;
    maxSteps?: number;
  } = {},
): { index: CoverIndex; steps: number; ready: number } {
  let index: CoverIndex | null = null;
  let ready = 0;
  const job = createCoverIndexJob({
    id: 'cover',
    generation: 1,
    essential: true,
    cityData: data,
    now: opts.now ?? constantClock,
    sliceMs: opts.sliceMs,
    cellSizeM: opts.cellSizeM,
    onReady: (i) => {
      ready += 1;
      index = i;
    },
  });
  let steps = 0;
  const maxSteps = opts.maxSteps ?? 1_000_000;
  while (!job.step()) {
    steps += 1;
    assert.ok(steps < maxSteps, 'index build did not finish within step budget');
  }
  steps += 1;
  assert.ok(index, 'onReady was not invoked');
  return { index, steps, ready };
}

function snapshot(data: CityData): Uint16Array[] {
  return [
    ...data.roads.map((r) => r.pts.slice()),
    ...data.parks.map((p) => p.verts.slice()),
    ...data.water.map((w) => w.verts.slice()),
  ];
}
function assertUnchanged(data: CityData, before: Uint16Array[]): void {
  const after = snapshot(data);
  assert.equal(after.length, before.length);
  after.forEach((arr, i) => assert.deepEqual([...arr], [...before[i]!]));
}

function cellsToObject(index: CoverIndex): Record<string, CoverSelection> {
  const out: Record<string, CoverSelection> = {};
  for (const [id, sel] of index.cells) out[id] = { ...sel };
  return out;
}

/** Independent brute-force AABB oracle straight from the source points. */
function featureAabb(points: Uint16Array): BoundsXZ {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < points.length; i += 2) {
    const x = dequantizeX(points[i]!);
    const z = dequantizeY(points[i + 1]!);
    b.minX = Math.min(b.minX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxX = Math.max(b.maxX, x);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}
function oracle(data: CityData, q: BoundsXZ, padM = 0): CoverSelection {
  const pad = padM * M;
  const e = { minX: q.minX - pad, minZ: q.minZ - pad, maxX: q.maxX + pad, maxZ: q.maxZ + pad };
  const hit = (points: Uint16Array): boolean => {
    const b = featureAabb(points);
    return b.maxX >= e.minX && b.minX <= e.maxX && b.maxZ >= e.minZ && b.minZ <= e.maxZ;
  };
  const pick = <T>(records: readonly T[], pts: (r: T) => Uint16Array): number[] =>
    records.map((r, i) => (hit(pts(r)) ? i : -1)).filter((i) => i >= 0);
  return {
    roads: pick(data.roads, (r) => r.pts),
    parks: pick(data.parks, (p) => p.verts),
    water: pick(data.water, (w) => w.verts),
  };
}

/** Proxy that counts numeric-index reads of a typed array without copying it. */
function countingPoints(source: Uint16Array, counter: { reads: number }): Uint16Array {
  return new Proxy(source, {
    get(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) counter.reads += 1;
      return Reflect.get(target, prop);
    },
  });
}
function longRoad(pairs: number): number[] {
  const metres: number[] = [];
  for (let i = 0; i < pairs; i++) metres.push(1000 + i * 2, 1000 + (i % 7) * 3);
  return metres;
}
function isAscendingUnique(list: readonly number[]): boolean {
  return list.every((n, i) => i === 0 || n > list[i - 1]!);
}

console.log('Cover index');

check('empty city publishes an empty index in a single step', () => {
  const data = city();
  const { index, steps, ready } = build(data);
  assert.equal(steps, 1);
  assert.equal(ready, 1);
  assert.equal(index.cellSizeM, CELL_M);
  assert.equal(index.bounds, null);
  assert.equal(index.cells.size, 0);
  assert.deepEqual(index.featureBounds, { roads: [], parks: [], water: [] });
  assert.deepEqual(coverForBounds(index, WORLD_BOUNDS), { roads: [], parks: [], water: [] });
  assert.deepEqual(coverForBounds(index, boxM(-1e9, -1e9, 1e9, 1e9)), {
    roads: [],
    parks: [],
    water: [],
  });
});

check('all three layers indexed with original indices, duplicates kept distinct', () => {
  const r = road(100, 100, 200, 100);
  const p = poly(120, 120, 180, 120, 150, 180);
  const w = poly(5000, 5000, 5100, 5000, 5050, 5100);
  const data = city(
    [r, r, road(9000, 9000, 9100, 9100)],
    [p, poly(5000, 5000, 5100, 5000, 5050, 5100), p],
    [w, w],
  );
  const before = snapshot(data);
  const { index } = build(data);
  assertUnchanged(data, before);
  assert.equal(index.featureBounds.roads.length, 3);
  assert.equal(index.featureBounds.parks.length, 3);
  assert.equal(index.featureBounds.water.length, 2);
  assert.deepEqual(coverForBounds(index, boxM(0, 0, 300, 300)), {
    roads: [0, 1],
    parks: [0, 2],
    water: [],
  });
  assert.deepEqual(coverForBounds(index, boxM(4900, 4900, 5200, 5200)), {
    roads: [],
    parks: [1],
    water: [0, 1],
  });
  assert.deepEqual(coverForBounds(index, WORLD_BOUNDS), {
    roads: [0, 1, 2],
    parks: [0, 1, 2],
    water: [0, 1],
  });
  for (const [, sel] of index.cells)
    for (const layer of LAYERS) assert.ok(isAscendingUnique(sel[layer]), `${layer} bucket order`);
});

check('repeated build is deterministic', () => {
  const data = city(
    [road(0, 0, 3000, 50), road(700, 700, 720, 3000)],
    [poly(100, 100, 900, 100, 900, 900, 100, 900)],
    [poly(2000, 2000, 2600, 2000, 2300, 2900)],
  );
  const a = build(data).index;
  const b = build(data, { sliceMs: 1 }).index;
  assert.deepEqual(cellsToObject(a), cellsToObject(b));
  assert.deepEqual(a.featureBounds, b.featureBounds);
  assert.deepEqual(a.bounds, b.bounds);
  assert.deepEqual([...a.cells.keys()], [...b.cells.keys()]);
});

check('query arrays are fresh and never alias bucket lists', () => {
  const data = city([road(10, 10, 50, 10)]);
  const { index } = build(data);
  const q = boxM(0, 0, 100, 100);
  const first = coverForBounds(index, q);
  const second = coverForBounds(index, q);
  assert.notEqual(first.roads, second.roads);
  assert.deepEqual(first, second);
  for (const [, sel] of index.cells) {
    assert.notEqual(sel.roads, first.roads);
  }
  (first.roads as number[]).push(999);
  assert.deepEqual(coverForBounds(index, q).roads, [0]);
  assert.deepEqual([...index.cells.values()][0]!.roads, [0]);
});

check('frozen source wrappers build and remain untouched', () => {
  const data = city([road(10, 10, 50, 10)], [poly(0, 0, 60, 0, 30, 60)]);
  assert.ok(
    Object.isFrozen(data) && Object.isFrozen(data.roads[0]) && Object.isFrozen(data.parks[0]),
  );
  const before = snapshot(data);
  const { index } = build(data);
  assertUnchanged(data, before);
  assert.deepEqual(coverForBounds(index, boxM(0, 0, 100, 100)), {
    roads: [0],
    parks: [0],
    water: [],
  });
});

check('crossing road with both endpoints outside the query is selected', () => {
  const data = city([road(0, 1000, 5000, 1000)]);
  const { index } = build(data);
  assert.deepEqual(coverForBounds(index, boxM(2000, 900, 2300, 1100)).roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(2000, 1200, 2300, 1500)).roads, []);
});

check('enclosing polygon with every vertex outside the query is selected', () => {
  const data = city([], [poly(0, 0, 3000, 0, 3000, 3000, 0, 3000)]);
  const { index } = build(data);
  assert.deepEqual(coverForBounds(index, boxM(1400, 1400, 1600, 1600)).parks, [0]);
});

check('disjoint same-bucket AABB candidate is filtered out', () => {
  // Both roads share cell (2,2) [800..1200 m], but only one touches the query.
  const data = city([road(810, 810, 850, 850), road(1100, 1100, 1190, 1190)]);
  const { index } = build(data);
  assert.equal(index.cells.size, 1);
  assert.deepEqual([...index.cells.values()][0]!.roads, [0, 1]);
  assert.deepEqual(coverForBounds(index, boxM(800, 800, 900, 900)).roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(1150, 1150, 1199, 1199)).roads, [1]);
  assert.deepEqual(coverForBounds(index, boxM(900, 900, 1050, 1050)).roads, []);
});

check('exact cell-edge query is inclusive', () => {
  const data = city([road(100, 100, 200, 100)]);
  const { index } = build(data);
  const fb = index.featureBounds.roads[0]!;
  // Query whose max edge equals the feature's min edge exactly, and one on the 400 m grid line.
  assert.deepEqual(
    coverForBounds(index, { minX: 0, minZ: 0, maxX: fb.minX, maxZ: fb.minZ }).roads,
    [0],
  );
  assert.deepEqual(
    coverForBounds(index, { minX: fb.maxX, minZ: fb.maxZ, maxX: 5 * CELL_W, maxZ: 5 * CELL_W })
      .roads,
    [0],
  );
  assert.deepEqual(
    coverForBounds(index, { minX: CELL_W, minZ: CELL_W, maxX: CELL_W, maxZ: CELL_W }).roads,
    [],
  );
  assert.deepEqual(
    coverForBounds(index, { minX: 0, minZ: 0, maxX: CELL_W, maxZ: CELL_W }).roads,
    [0],
  );
});

check('negative and outside-world queries return empty without huge loops', () => {
  const data = city([road(100, 100, 200, 100)]);
  const { index } = build(data);
  const empty = { roads: [], parks: [], water: [] };
  assert.deepEqual(coverForBounds(index, boxM(-5000, -5000, -1, -1)), empty);
  assert.deepEqual(coverForBounds(index, boxM(1e8, 1e8, 2e8, 2e8)), empty);
  const started = Date.now();
  assert.deepEqual(coverForBounds(index, boxM(-1e12, -1e12, 1e12, 1e12)).roads, [0]);
  assert.deepEqual(
    coverForBounds(index, { minX: -1e300, minZ: -1e300, maxX: 1e300, maxZ: 1e300 }).roads,
    [0],
  );
  assert.ok(Date.now() - started < 1000, 'enormous query must clamp to index bounds');
  assert.deepEqual(coverForBounds(index, { minX: -1, minZ: -1, maxX: 0.5, maxZ: 0.5 }), empty);
});

check('padding is applied in metres', () => {
  const data = city([road(1000, 1000, 1100, 1000)]);
  const { index } = build(data);
  const q = boxM(1150, 900, 1300, 1100);
  assert.deepEqual(coverForBounds(index, q).roads, []);
  assert.deepEqual(coverForBounds(index, q, 40).roads, []);
  assert.deepEqual(coverForBounds(index, q, 60).roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(1300, 1300, 1400, 1400), 200).roads, []);
  assert.deepEqual(coverForBounds(index, boxM(1300, 1300, 1400, 1400), 500).roads, [0]);
});

check('narrow portrait-shaped query spanning many cells in z', () => {
  const roads = [road(0, 3000, 1000, 3000), road(600, 100, 600, 6000), road(2000, 100, 2000, 6000)];
  const { index } = build(city(roads));
  assert.deepEqual(coverForBounds(index, boxM(590, 0, 610, 7000)).roads, [0, 1]);
  assert.deepEqual(coverForBounds(index, boxM(1990, 0, 2010, 7000)).roads, [2]);
});

check('multi-cell record is deduplicated across adjacent cell queries', () => {
  const data = city([road(100, 500, 1500, 500)]);
  const { index } = build(data);
  assert.equal(index.cells.size, 4);
  for (const [, sel] of index.cells) assert.deepEqual(sel.roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(0, 400, 400, 800)).roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(400, 400, 800, 800)).roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(800, 400, 1200, 800)).roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(0, 400, 1600, 800)).roads, [0]);
});

check('cover exists in cells without any building owner', () => {
  const data = city([], [], [poly(4100, 4100, 4300, 4100, 4200, 4300)]);
  assert.equal(data.buildings.length, 0);
  const { index } = build(data);
  assert.deepEqual([...index.cells.keys()], ['10,10' satisfies CellId]);
  assert.deepEqual(coverForBounds(index, boxM(4000, 4000, 4400, 4400)).water, [0]);
});

check('constant clock: constructor reads no coordinates, ≤64 vertex pairs per step', () => {
  const counter = { reads: 0 };
  const pairs = 1200;
  const base = quantize(longRoad(pairs));
  const proxied: CityRoad = { tier: 2, pts: countingPoints(base, counter) };
  const data = city([proxied]);
  let ready = 0;
  const job = createCoverIndexJob({
    id: 'proxy',
    generation: 1,
    essential: false,
    cityData: data,
    now: constantClock,
    onReady: () => {
      ready += 1;
    },
  });
  assert.equal(counter.reads, 0, 'constructor must not read coordinates');
  const perStep: number[] = [];
  let done = false;
  let steps = 0;
  while (!done) {
    const before = counter.reads;
    done = job.step();
    steps += 1;
    perStep.push(counter.reads - before);
    assert.ok(steps < 10_000);
  }
  assert.ok(
    perStep.every((n) => n <= 64 * 2),
    `reads per step ${Math.max(...perStep)}`,
  );
  assert.equal(counter.reads, pairs * 2, 'every coordinate read exactly once');
  // First step: 1 record-setup unit + 63 vertex units.
  assert.equal(perStep[0], 63 * 2);
  assert.ok(steps >= Math.ceil(pairs / 64), `needed ${steps} steps`);
  assert.equal(ready, 1);
});

check('full-WORLD AABB feature needs many resumable bucket-insertion steps', () => {
  const full = Object.freeze({
    verts: new Uint16Array([0, 0, 0xffff, 0, 0xffff, 0xffff, 0, 0xffff]),
    indices: new Uint16Array(0),
  });
  const data = city([], [full]);
  const job = createCoverIndexJob({
    id: 'world',
    generation: 1,
    essential: false,
    cityData: data,
    now: constantClock,
    onReady: () => {},
  });
  const cellsX = Math.floor(WORLD.width / CELL_W) + 1;
  const cellsZ = Math.floor(WORLD.height / CELL_W) + 1;
  const expectedCells = cellsX * cellsZ;
  assert.ok(expectedCells > 64 * 4, `world needs ${expectedCells} buckets`);
  assert.equal(job.step(), false, 'a full-world feature cannot complete in one step');
  let steps = 1;
  while (!job.step()) steps += 1;
  steps += 1;
  const minimumSteps = Math.ceil((1 + 4 + expectedCells + 3 + 1) / 64);
  assert.ok(steps >= minimumSteps, `${steps} steps >= ${minimumSteps}`);
  const { index } = build(data);
  assert.equal(index.cells.size, expectedCells);
  for (const [, sel] of index.cells) assert.deepEqual(sel, { roads: [], parks: [0], water: [] });
  assert.deepEqual(index.bounds, { minX: 0, minZ: 0, maxX: WORLD.width, maxZ: WORLD.height });
});

check('incrementing clock exits a slice before exhausting 64 units', () => {
  const counter = { reads: 0 };
  const base = quantize(longRoad(600));
  const data = city([{ tier: 0, pts: countingPoints(base, counter) }]);
  let t = 0;
  const now = (): number => (t += 1);
  const job = createCoverIndexJob({
    id: 'clock',
    generation: 1,
    essential: false,
    cityData: data,
    now,
    sliceMs: 4,
    onReady: () => {},
  });
  const before = counter.reads;
  assert.equal(job.step(), false);
  const firstReads = counter.reads - before;
  assert.ok(firstReads > 0 && firstReads < 64 * 2, `first step read ${firstReads} coordinates`);
  const mid = counter.reads;
  assert.equal(job.step(), false);
  assert.ok(counter.reads > mid, 'subsequent step makes progress');
  assert.ok(counter.reads - mid < 64 * 2);
  let steps = 2;
  while (!job.step()) steps += 1;
  assert.equal(counter.reads, 600 * 2);
  assert.ok(steps > Math.ceil(600 / 64));
});

check('cancellation before, mid-vertex and mid-bucket drops state and never publishes', () => {
  const counter = { reads: 0 };
  const base = quantize(longRoad(500));
  const mk = (onReady: () => void) =>
    createCoverIndexJob({
      id: 'c',
      generation: 1,
      essential: false,
      cityData: city(
        [{ tier: 0, pts: countingPoints(base, counter) }],
        [poly(0, 0, 20000, 0, 20000, 11000, 0, 11000)],
      ),
      now: constantClock,
      onReady,
    });
  let readyCount = 0;
  const initial = mk(() => (readyCount += 1));
  initial.cancel();
  assert.equal(initial.step(), true);
  assert.equal(initial.step(), true);
  initial.cancel();
  assert.equal(counter.reads, 0);

  const midVertex = mk(() => (readyCount += 1));
  assert.equal(midVertex.step(), false);
  const afterOne = counter.reads;
  assert.ok(afterOne > 0);
  midVertex.cancel();
  midVertex.cancel();
  assert.equal(midVertex.step(), true);
  assert.equal(midVertex.step(), true);
  assert.equal(counter.reads, afterOne, 'no reads after cancel');

  const midBucket = mk(() => (readyCount += 1));
  // 500 pairs + setup ≈ 8 steps of vertices, then the world polygon's buckets.
  for (let i = 0; i < 12; i++) assert.equal(midBucket.step(), false);
  assert.equal(counter.reads, afterOne + 500 * 2, 'road fully read before park buckets');
  midBucket.cancel();
  assert.equal(midBucket.step(), true);
  assert.equal(readyCount, 0);
});

check('publication happens once; later step/cancel and reentrant calls are inert', () => {
  const data = city([road(0, 0, 100, 0)], [poly(0, 0, 60, 0, 30, 60)]);
  let ready = 0;
  let reentrantStep: boolean | null = null;
  const holder: { published: CoverIndex | null } = { published: null };
  const job = createCoverIndexJob({
    id: 'p',
    generation: 3,
    essential: true,
    cityData: data,
    now: constantClock,
    onReady: (index) => {
      ready += 1;
      holder.published = index;
      reentrantStep = job.step();
      job.cancel();
      job.cancel();
    },
  });
  assert.equal(job.step(), true);
  assert.equal(ready, 1);
  assert.equal(reentrantStep, true);
  const published = holder.published;
  assert.ok(published);
  const snap = cellsToObject(published);
  const fbSnap = JSON.stringify(published.featureBounds);
  assert.equal(job.step(), true);
  job.cancel();
  assert.equal(job.step(), true);
  assert.equal(ready, 1);
  assert.deepEqual(cellsToObject(published), snap);
  assert.equal(JSON.stringify(published.featureBounds), fbSnap);
  assert.deepEqual(coverForBounds(published, boxM(0, 0, 100, 100)), {
    roads: [0],
    parks: [0],
    water: [],
  });
});

check('falsy thrown callback values are preserved, terminal, and never duplicated', () => {
  for (const thrown of [false, undefined, 0, null, '']) {
    let calls = 0;
    const job = createCoverIndexJob({
      id: 'throw',
      generation: 1,
      essential: false,
      cityData: city([road(0, 0, 100, 0)]),
      now: constantClock,
      onReady: () => {
        calls += 1;
        throw thrown;
      },
    });
    let caught = false;
    let value: unknown = Symbol('unset');
    try {
      job.step();
    } catch (e) {
      caught = true;
      value = e;
    }
    assert.equal(caught, true);
    assert.equal(value, thrown);
    assert.equal(calls, 1);
    assert.equal(job.step(), true);
    assert.equal(job.step(), true);
    assert.equal(calls, 1);
  }
});

check('invalid sliceMs rejected in constructor', () => {
  for (const sliceMs of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(
      () =>
        createCoverIndexJob({
          id: 'x',
          generation: 1,
          essential: false,
          cityData: city(),
          now: constantClock,
          sliceMs,
          onReady: () => {},
        }),
      RangeError,
    );
  }
});

check('invalid cell sizes rejected in constructor', () => {
  for (const cellSizeM of [0, -1, NaN, Infinity, -Infinity, Number.MIN_VALUE]) {
    assert.throws(
      () =>
        createCoverIndexJob({
          id: 'x',
          generation: 1,
          essential: false,
          cityData: city(),
          now: constantClock,
          cellSizeM,
          onReady: () => {},
        }),
      RangeError,
    );
  }
});

check('custom 1600 m grid preserves boundary and enclosing selection', () => {
  const data = city(
    [road(1599, 800, 1601, 800)],
    [poly(0, 0, 3400, 0, 3400, 3400, 0, 3400)],
  );
  const { index, steps } = build(data, { cellSizeM: LARGE_CELL_M });
  assert.equal(index.cellSizeM, LARGE_CELL_M);
  assert.equal(steps, 1);
  assert.deepEqual([...index.cells.keys()].sort(), [
    '0,0',
    '0,1',
    '0,2',
    '1,0',
    '1,1',
    '1,2',
    '2,0',
    '2,1',
    '2,2',
  ]);
  assert.deepEqual(coverForBounds(index, boxM(1599.5, 799, 1600.5, 801)).roads, [0]);
  assert.deepEqual(coverForBounds(index, boxM(1400, 1400, 1800, 1800)).parks, [0]);
  assert.deepEqual(
    coverForBounds(index, {
      minX: LARGE_CELL_W,
      minZ: LARGE_CELL_W,
      maxX: LARGE_CELL_W,
      maxZ: LARGE_CELL_W,
    }),
    { roads: [], parks: [0], water: [] },
  );
});

check('1600 m grid keeps work bounded and cancellation unpublished', () => {
  const widthM = WORLD.width / M;
  const heightM = WORLD.height / M;
  const data = city([], [poly(0, 0, widthM, 0, widthM, heightM, 0, heightM)]);
  let ready = 0;
  const job = createCoverIndexJob({
    id: 'large-grid',
    generation: 1,
    essential: false,
    cityData: data,
    now: constantClock,
    cellSizeM: LARGE_CELL_M,
    onReady: () => {
      ready += 1;
    },
  });
  assert.equal(job.step(), false);
  job.cancel();
  assert.equal(job.step(), true);
  assert.equal(ready, 0);
  const built = build(data, { cellSizeM: LARGE_CELL_M });
  assert.ok(built.steps > 1);
  assert.equal(built.index.cellSizeM, LARGE_CELL_M);
});

check('malformed records rejected lazily when reached, with layer/index', () => {
  const cases: { data: CityData; re: RegExp }[] = [
    { data: city([Object.freeze({ tier: 0, pts: new Uint16Array([1, 2]) })]), re: /roads 0/ },
    { data: city([Object.freeze({ tier: 0, pts: new Uint16Array([1, 2, 3]) })]), re: /roads 0/ },
    { data: city([road(0, 0, 1, 1)], [poly(0, 0, 1, 1)]), re: /parks 0/ },
    { data: city([], [], [poly(0, 0, 1, 1, 2, 2), poly(0, 0, 1, 1)]), re: /water 1/ },
    {
      data: city(
        [],
        [],
        [{ verts: new Uint16Array([0, 0, 1, 1, 2, 2, 3]), indices: new Uint16Array(0) }],
      ),
      re: /water 0/,
    },
    { data: city([{ tier: 0 } as unknown as CityRoad]), re: /roads 0/ },
  ];
  for (const { data, re } of cases) {
    let ready = 0;
    const job = createCoverIndexJob({
      id: 'bad',
      generation: 1,
      essential: false,
      cityData: data,
      now: constantClock,
      onReady: () => (ready += 1),
    });
    let steps = 0;
    assert.throws(
      () => {
        for (;;) {
          steps += 1;
          if (job.step()) return;
        }
      },
      (e: unknown) => e instanceof RangeError && re.test(e.message),
    );
    assert.equal(job.step(), true);
    assert.equal(ready, 0);
    assert.ok(steps >= 1);
  }
  // Not eagerly validated: a bad record behind a long one only fails once reached.
  const lazy = city([
    road(...longRoad(300)),
    Object.freeze({ tier: 0, pts: new Uint16Array([1, 2]) }),
  ]);
  const job = createCoverIndexJob({
    id: 'lazy',
    generation: 1,
    essential: false,
    cityData: lazy,
    now: constantClock,
    onReady: () => {},
  });
  assert.equal(job.step(), false);
  assert.equal(job.step(), false);
  assert.throws(
    () => {
      while (!job.step()) {
        /* advance until the malformed record is reached */
      }
    },
    (e: unknown) => e instanceof RangeError && /roads 1/.test(e.message),
  );
  assert.equal(job.step(), true);
});

check('clock failures are preserved exactly and terminal', () => {
  const data = city([road(...longRoad(200))]);
  for (const thrown of [new Error('clock'), null, 0, false]) {
    const job = createCoverIndexJob({
      id: 'clk',
      generation: 1,
      essential: false,
      cityData: data,
      now: () => {
        throw thrown;
      },
      onReady: () => assert.fail('must not publish'),
    });
    let value: unknown = Symbol('unset');
    try {
      job.step();
    } catch (e) {
      value = e;
    }
    assert.equal(value, thrown);
    assert.equal(job.step(), true);
  }
  // Failure between units (after the first successful now()).
  let calls = 0;
  const job = createCoverIndexJob({
    id: 'clk2',
    generation: 1,
    essential: false,
    cityData: data,
    now: () => {
      calls += 1;
      if (calls === 3) throw undefined;
      return 0;
    },
    onReady: () => assert.fail('must not publish'),
  });
  let caught = false;
  let value: unknown = 1;
  try {
    job.step();
  } catch (e) {
    caught = true;
    value = e;
  }
  assert.equal(caught, true);
  assert.equal(value, undefined);
  assert.equal(job.step(), true);
  assert.equal(calls, 3);
});

check('coverForBounds validates bounds, padding and overflow', () => {
  const { index } = build(city([road(0, 0, 100, 0)]));
  const bad: BoundsXZ[] = [
    { minX: NaN, minZ: 0, maxX: 1, maxZ: 1 },
    { minX: 0, minZ: 0, maxX: Infinity, maxZ: 1 },
    { minX: 2, minZ: 0, maxX: 1, maxZ: 1 },
    { minX: 0, minZ: 2, maxX: 1, maxZ: 1 },
  ];
  for (const b of bad) assert.throws(() => coverForBounds(index, b), RangeError);
  const ok = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  for (const pad of [-1, NaN, Infinity])
    assert.throws(() => coverForBounds(index, ok, pad), RangeError);
  assert.throws(
    () =>
      coverForBounds(
        index,
        { minX: 0, minZ: 0, maxX: Number.MAX_VALUE, maxZ: 1 },
        Number.MAX_VALUE,
      ),
    /overflow/,
  );
  assert.deepEqual(coverForBounds(index, ok, 0).roads, [0]);
});

check('large index remains resumable under a constant scheduler clock', () => {
  const s = createBuildScheduler();
  let index: CoverIndex | null = null;
  s.enqueue(
    createCoverIndexJob({
      id: 'sched',
      generation: 1,
      essential: true,
      cityData: city([{ tier: 2, pts: new Uint16Array(600_000) }]),
      now: constantClock,
      onReady: (i) => (index = i),
    }),
  );
  let drains = 0;
  while (!index) {
    const r = s.drain(4, constantClock);
    drains += 1;
    assert.equal(r.failed.length, 0);
    assert.ok(drains < 1000);
  }
  assert.ok(drains > 1, 'a constant-clock drain must not finish the job in one call');
  assert.deepEqual(coverForBounds(index, WORLD_BOUNDS).roads, [0]);
});

check('committed London binary: whole-world query yields every original index once', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const data = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(data.roads.length, 56793);
  assert.equal(data.parks.length, 769);
  assert.equal(data.water.length, 62);
  const before = snapshot(data);
  const { index, steps, ready } = build(data);
  assertUnchanged(data, before);
  assert.equal(ready, 1);
  assert.ok(steps > 1000, `real city build took ${steps} steps`);
  assert.equal(index.featureBounds.roads.length, 56793);
  assert.equal(index.featureBounds.parks.length, 769);
  assert.equal(index.featureBounds.water.length, 62);
  const all = coverForBounds(index, WORLD_BOUNDS);
  const seq = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
  assert.deepEqual(all.roads, seq(56793));
  assert.deepEqual(all.parks, seq(769));
  assert.deepEqual(all.water, seq(62));
  assert.deepEqual(coverForBounds(index, WORLD_BOUNDS, 5000), all);
  for (const [, sel] of index.cells)
    for (const layer of LAYERS) assert.ok(isAscendingUnique(sel[layer]));
  // featureBounds match the independent oracle exactly.
  data.roads.forEach((r, i) => assert.deepEqual(index.featureBounds.roads[i], featureAabb(r.pts)));
  data.water.forEach((w, i) =>
    assert.deepEqual(index.featureBounds.water[i], featureAabb(w.verts)),
  );

  const queries: { q: BoundsXZ; pad: number }[] = [
    { q: boxM(11000, 5000, 12000, 5800), pad: 0 },
    { q: boxM(11000, 5000, 12000, 5800), pad: 150 },
    { q: boxM(7000, 6000, 9500, 6300), pad: 0 },
    { q: boxM(15200, 4400, 15300, 8000), pad: 25 },
    { q: boxM(400, 400, 800, 800), pad: 0 },
    { q: { minX: 3 * CELL_W, minZ: 2 * CELL_W, maxX: 5 * CELL_W, maxZ: 4 * CELL_W }, pad: 0 },
  ];
  let nonEmpty = 0;
  for (const { q, pad } of queries) {
    const got = coverForBounds(index, q, pad);
    const want = oracle(data, q, pad);
    assert.deepEqual(got, want);
    if (got.roads.length + got.parks.length + got.water.length > 0) nonEmpty += 1;
  }
  assert.ok(nonEmpty >= 4, 'local oracle queries should mostly hit real features');
  // A Thames-sized water polygon must be selected by a small view that no vertex lies inside.
  const thames = data.water
    .map((w, i) => ({ i, area: featureAabb(w.verts) }))
    .sort((a, b) => {
      const areaOf = (bb: BoundsXZ) => (bb.maxX - bb.minX) * (bb.maxZ - bb.minZ);
      return areaOf(b.area) - areaOf(a.area);
    })[0]!;
  const cx = (thames.area.minX + thames.area.maxX) / 2;
  const cz = (thames.area.minZ + thames.area.maxZ) / 2;
  const tiny = { minX: cx - 1e-6, minZ: cz - 1e-6, maxX: cx + 1e-6, maxZ: cz + 1e-6 };
  assert.ok(coverForBounds(index, tiny).water.includes(thames.i));
  assert.deepEqual(coverForBounds(index, tiny), oracle(data, tiny));
});

console.log(`\n${passed} cover index checks passed`);
