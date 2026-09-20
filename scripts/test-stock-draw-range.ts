import assert from 'node:assert/strict';
import { createStockDrawRangeJob, type DrawRangeResult, type IndexArray } from '../lib/game/render3d/stockDrawRange';

function triplesOf(ix: IndexArray): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ix.length; i += 3) out.push([ix[i]!, ix[i + 1]!, ix[i + 2]!]);
  return out;
}
function sortedTriples(ix: IndexArray): number[][] {
  return triplesOf(ix).map((t) => [...t]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
}
function drain<T extends IndexArray>(job: ReturnType<typeof createStockDrawRangeJob<T>>): void {
  let complete = false;
  for (let i = 0; i < 1000 && !(complete = job.step()); i++);
  assert.equal(complete, true, 'bounded drain completes');
}

// Six discriminating triangles, each on its own vertices. Direction +z culls a
// triangle only when dot(n, d) > epsilon * |n| with n = (b-a) x (c-a).
const P: number[] = [];
const v = (x: number, y: number, z: number): number => { P.push(x, y, z); return P.length / 3 - 1; };
const BACK = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];        // n = +z: definite backface
const FRONT = [v(2, 0, 0), v(2, 1, 0), v(3, 0, 0)];       // n = -z: kept front
const EDGE = [v(4, 0, 0), v(5, 0, 0), v(4, 0, 1)];        // n = -y: dot = 0, kept
const DEGEN = [v(6, 0, 0), v(6, 0, 0), v(6, 0, 0)];       // |n| = 0, kept
const NEAR = [v(7, 0, 0), v(8, 0, 0), v(7, 1, 60)];       // |cos| ~ 0.0167 < 0.02, kept
const BACK2 = [v(9, 0, 0), v(10, 0, 0), v(9, 1, 0)];      // n = +z: definite backface
const positions = new Float32Array(P);
const sourceIndex = new Uint16Array([...BACK, ...FRONT, ...EDGE, ...DEGEN, ...NEAR, ...BACK2]);
const sourceSnapshot = Uint16Array.from(sourceIndex);

function run<T extends IndexArray>(index: T, direction: { x: number; y: number; z: number }, extra: Partial<Parameters<typeof createStockDrawRangeJob<T>>[0]> = {}): { result: DrawRangeResult<T> | null | undefined; calls: number } {
  let result: DrawRangeResult<T> | null | undefined;
  let calls = 0;
  drain(createStockDrawRangeJob<T>({
    id: 'job', generation: 1, essential: true, positions, index, direction,
    now: () => 0, onReady: (r) => { calls++; result = r; }, ...extra,
  }));
  return { result, calls };
}

// Exact classification and a stable complete partition, normalized direction.
{
  const { result, calls } = run(sourceIndex, { x: 0, y: 0, z: 1 });
  assert.equal(calls, 1, 'onReady fires exactly once');
  assert.ok(result);
  assert.equal(result.count, 12, 'four kept triples');
  assert.ok(result.index instanceof Uint16Array);
  assert.equal(result.index.length, sourceIndex.length);
  assert.deepEqual(triplesOf(result.index), [FRONT, EDGE, DEGEN, NEAR, BACK, BACK2],
    'kept triples first and rejected triples second, each in original order');
  assert.deepEqual(sortedTriples(result.index), sortedTriples(sourceIndex), 'multiset equality');
  assert.deepEqual(Array.from(sourceIndex), Array.from(sourceSnapshot), 'source never mutated');
}

// Non-normalized direction classifies identically after internal normalization.
{
  const scaled = run(sourceIndex, { x: 0, y: 0, z: 7 }).result;
  const unit = run(sourceIndex, { x: 0, y: 0, z: 1 }).result;
  assert.deepEqual(Array.from(scaled!.index), Array.from(unit!.index));
  assert.equal(scaled!.count, unit!.count);
  const tilted = run(sourceIndex, { x: 0, y: 0.999, z: 0.05 });
  assert.ok(tilted.result);
}

// Uint32 constructor and length preserved.
{
  const wide = new Uint32Array(sourceIndex);
  const { result } = run(wide, { x: 0, y: 0, z: 1 });
  assert.ok(result!.index instanceof Uint32Array);
  assert.equal(result!.index.length, wide.length);
  assert.deepEqual(triplesOf(result!.index), [FRONT, EDGE, DEGEN, NEAR, BACK, BACK2]);
}

// Over the byte cap: null result, no staging write to the source.
{
  let calls = 0, seen: DrawRangeResult<Uint16Array> | null | undefined;
  const before = Array.from(sourceIndex);
  drain(createStockDrawRangeJob({
    id: 'cap', generation: 1, essential: true, positions, index: sourceIndex,
    direction: { x: 0, y: 0, z: 1 }, now: () => 0, maxIndexBytes: 8,
    onReady: (r) => { calls++; seen = r; },
  }));
  assert.equal(calls, 1);
  assert.equal(seen, null, 'over-cap completes with null');
  assert.deepEqual(Array.from(sourceIndex), before, 'source untouched');
}

// Partial steps under a non-advancing clock: source stays bit-identical and the
// unit cap still bounds each step.
{
  const VERTS = 60_000, TRIS = 20_000;
  const big = new Float32Array(VERTS * 3);
  for (let i = 0; i < VERTS; i++) { big[i * 3] = (i * 37) % 101; big[i * 3 + 1] = (i * 53) % 103; big[i * 3 + 2] = (i * 71) % 107; }
  const bigIndex = new Uint16Array(TRIS * 3);
  for (let t = 0; t < TRIS; t++) for (let k = 0; k < 3; k++) bigIndex[t * 3 + k] = (t * 3 + k) % VERTS;
  const bigBefore = Uint16Array.from(bigIndex);
  let calls = 0;
  const job = createStockDrawRangeJob({
    id: 'big', generation: 1, essential: true, positions: big, index: bigIndex,
    direction: { x: 0, y: 0, z: 1 }, now: () => 0, maxIndexBytes: 1 << 20,
    onReady: () => { calls++; },
  });
  assert.equal(job.step(), false, 'first bounded step is partial');
  assert.deepEqual(Array.from(bigIndex), Array.from(bigBefore), 'source unchanged while paused');
  drain(job);
  assert.equal(calls, 1);
  assert.deepEqual(Array.from(bigIndex), Array.from(bigBefore), 'source unchanged after completion');
  assert.deepEqual(sortedTriples(bigIndex), sortedTriples(bigBefore));

  // Coarse clocks still make bounded progress without changing the source.
  let tickCalls = 0, ticks = 0;
  const starved = createStockDrawRangeJob({
    id: 'starved', generation: 1, essential: true, positions: big, index: bigIndex,
    direction: { x: 0, y: 0, z: 1 }, now: () => (ticks++) * 5, sliceMs: 4, maxIndexBytes: 1 << 20,
    onReady: () => { tickCalls++; },
  });
  for (let i = 0; i < 8; i++) assert.equal(starved.step(), false, 'starved step returns without completing');
  assert.equal(tickCalls, 0);
  assert.deepEqual(Array.from(bigIndex), Array.from(bigBefore), 'source unchanged under starved clock');
  drain(starved);
  assert.equal(tickCalls, 1, 'coarse clock completes exactly once');
  assert.deepEqual(Array.from(bigIndex), Array.from(bigBefore), 'source unchanged after coarse-clock completion');

  // A clock that jumps per step but holds inside a step completes through the
  // finite unit cap in a bounded number of steps.
  let stepTick = 0, stepCalls = 0;
  const coarse = createStockDrawRangeJob({
    id: 'coarse', generation: 1, essential: true, positions: big, index: bigIndex,
    direction: { x: 0, y: 0, z: 1 }, now: () => stepTick, sliceMs: 4, maxIndexBytes: 1 << 20,
    onReady: () => { stepCalls++; },
  });
  let steps = 0;
  while (!coarse.step()) { stepTick += 5; assert.ok(++steps < 100, 'coarse clock still converges'); }
  assert.equal(stepCalls, 1);
  assert.deepEqual(sortedTriples(bigIndex), sortedTriples(bigBefore));
}

// Cancellation before completion produces no callback and is idempotent.
{
  let calls = 0;
  const never = createStockDrawRangeJob({
    id: 'never', generation: 1, essential: true, positions, index: sourceIndex,
    direction: { x: 0, y: 0, z: 1 }, now: () => 0, onReady: () => { calls++; },
  });
  never.cancel();
  assert.equal(never.step(), true);
  never.cancel();
  assert.equal(calls, 0);

  const midIndex = Uint16Array.from({ length: 60_000 }, (_, i) => i % 200);
  const midBefore = midIndex.slice();
  const mid = createStockDrawRangeJob({
    id: 'mid', generation: 1, essential: true, positions: new Float32Array(600), index: midIndex,
    maxIndexBytes: 1 << 20,
    direction: { x: 0, y: 0, z: 1 }, now: () => 0, onReady: () => { calls++; },
  });
  assert.equal(mid.step(), false, 'work started but has not published');
  assert.deepEqual(midIndex, midBefore, 'partial work leaves source unchanged');
  mid.cancel();
  assert.equal(mid.step(), true);
  assert.equal(calls, 0);
  assert.deepEqual(midIndex, midBefore, 'cancellation leaves source unchanged');
}

// Validation and error cleanup.
{
  const base = { id: 'v', generation: 1, essential: true, positions, index: sourceIndex, direction: { x: 0, y: 0, z: 1 }, now: () => 0, onReady: () => {} };
  for (const sliceMs of [0, -1, 5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => createStockDrawRangeJob({ ...base, sliceMs }), RangeError, `sliceMs ${sliceMs}`);
  for (const epsilon of [-0.1, 1, 2, Number.NaN])
    assert.throws(() => createStockDrawRangeJob({ ...base, epsilon }), RangeError, `epsilon ${epsilon}`);
  for (const maxIndexBytes of [0, -4, 1.5, Number.NaN])
    assert.throws(() => createStockDrawRangeJob({ ...base, maxIndexBytes }), RangeError, `maxIndexBytes ${maxIndexBytes}`);
  for (const direction of [{ x: 0, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: 1 }, { x: Number.POSITIVE_INFINITY, y: 0, z: 1 }])
    assert.throws(() => createStockDrawRangeJob({ ...base, direction }), RangeError, `direction ${JSON.stringify(direction)}`);
  assert.throws(() => createStockDrawRangeJob({ ...base, positions: new Float32Array(4) }), RangeError, 'positions not divisible by three');
  assert.throws(() => createStockDrawRangeJob({ ...base, index: new Uint16Array([0, 1, 2, 3]) }), RangeError, 'index not divisible by three');

  // An out-of-bounds index encountered mid-classification fails the step, and
  // cleanup leaves the job terminal and cancellable.
  let calls = 0;
  const bad = createStockDrawRangeJob({
    ...base, id: 'oob', index: new Uint16Array([...BACK, 0, 1, 999]),
    onReady: () => { calls++; },
  });
  assert.throws(() => bad.step(), RangeError);
  assert.equal(calls, 0, 'failed job never calls onReady');
  assert.equal(bad.step(), true, 'failed job is terminal');
  bad.cancel();
}

// Reentrant step is rejected.
{
  const box: { job?: ReturnType<typeof createStockDrawRangeJob<Uint16Array>> } = {};
  box.job = createStockDrawRangeJob({
    id: 'reentrant', generation: 1, essential: true, positions, index: sourceIndex,
    direction: { x: 0, y: 0, z: 1 }, now: () => 0,
    onReady: () => { box.job!.step(); },
  });
  assert.throws(() => box.job!.step(), /Reentrant stock draw range job step/);
}

// Deterministic output and the configured <=4 ms slice bound.
{
  const a = run(sourceIndex, { x: 0, y: 0, z: 1 }, { sliceMs: 4 }).result;
  const b = run(sourceIndex, { x: 0, y: 0, z: 1 }, { sliceMs: 4 }).result;
  assert.deepEqual(Array.from(a!.index), Array.from(b!.index));
  assert.equal(a!.count, b!.count);
  assert.ok(run(sourceIndex, { x: 0, y: 0, z: 1 }, { sliceMs: 0.5 }).result);
}

// Accepted restriction (review §4): repeated stable partitions preserve the
// relative order of same-normal triangle pairs only. Distinct-normal pairs may
// reorder; this test documents the same-normal guarantee across partitions and
// does not claim universal pixel identity.
{
  const Q: number[] = [];
  const q = (x: number, y: number, z: number): number => { Q.push(x, y, z); return Q.length / 3 - 1; };
  const A1 = [q(0, 0, 0), q(1, 0, 0), q(0, 1, 0)];   // n = +z
  const M1 = [q(0, 0, 0), q(0, 1, 0), q(0, 0, 1)];   // n = +x
  const A2 = [q(5, 0, 0), q(6, 0, 0), q(5, 1, 0)];   // n = +z, same normal as A1
  const seqPositions = new Float32Array(Q);
  const seqIndex = new Uint16Array([...A1, ...M1, ...A2]);
  const first = run(seqIndex, { x: 0, y: 0, z: 1 }, { positions: seqPositions }).result!;
  // A1/A2 culled together keep their order inside the tail.
  assert.deepEqual(triplesOf(first.index), [M1, A1, A2]);
  const second = run(first.index, { x: 0, y: 1, z: 0 }, { positions: seqPositions }).result!;
  const order = triplesOf(second.index).map((t) => t[0]!);
  assert.ok(order.indexOf(A1[0]!) < order.indexOf(A2[0]!), 'same-normal pair order survives repartition');
}

console.log('test-stock-draw-range: all assertions passed');
