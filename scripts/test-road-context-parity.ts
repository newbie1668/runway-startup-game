import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCity, type CityData } from '../lib/game/render3d/format';
import {
  plannedCrosswalks,
  riverCrossingSpans,
  roadCoverContextSteps,
  type CrossingSpan,
  type PlannedCrosswalk,
} from '../lib/game/render3d/cityBuilder';

const raw = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
const fresh = (): CityData =>
  decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

const plain = (spans: readonly { pts: readonly { x: number; z: number }[]; tier: number }[]) =>
  spans.map((s) => ({
    pts: s.pts.map((p) => ({ x: p.x, z: p.z })),
    tier: s.tier,
  }));

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Independent full-scan results from their own decoded city.
const baseCity = fresh();
const baseCrossings: CrossingSpan[] = riverCrossingSpans(baseCity);
const baseCrosswalks: PlannedCrosswalk[] = plannedCrosswalks(baseCity);
assert.equal(baseCrossings.length, 15);
assert.equal(baseCrosswalks.length, 374);
assert.equal(
  digest([plain(baseCrossings), baseCrosswalks]),
  'c53560aad6305f710515e0aab66e954157c6c7cbd5c5bb15e375fe8d6e0a12d1',
  'accepted crossing and crosswalk geometry on the committed city binary',
);

// The single-pass context matches element for element, in order.
const contextCity = fresh();
const context = finish(roadCoverContextSteps(contextCity));
assert.deepEqual(plain(context.crossings), plain(baseCrossings));
assert.deepEqual(
  context.crosswalks.map((c) => ({ ...c })),
  baseCrosswalks.map((c) => ({ ...c })),
);

// Output is frozen, so a stray write cannot corrupt the cached context.
assert.ok(Object.isFrozen(context));
assert.ok(context.crossings.every((s) => Object.isFrozen(s) && Object.isFrozen(s.pts)));
assert.ok(context.crosswalks.every((c) => Object.isFrozen(c)));
const firstZebraX = context.crosswalks[0]!.x;
try {
  (context.crosswalks[0] as PlannedCrosswalk).x = -1;
} catch {
  // strict mode throws; sloppy mode ignores the write
}
assert.equal(context.crosswalks[0]!.x, firstZebraX);

// The context owns its spans: later public calls hand out separate copies.
const laterSpans = riverCrossingSpans(contextCity);
assert.ok(laterSpans.every((span, i) => span !== context.crossings[i]));
laterSpans[0]!.pts[0] = { x: -1, z: -1 };
laterSpans[0]!.tier = 9;
const laterCrosswalks = plannedCrosswalks(contextCity);
laterCrosswalks[0]!.x = -1;
assert.deepEqual(plain(finish(roadCoverContextSteps(contextCity)).crossings), plain(baseCrossings));
assert.deepEqual(plain(context.crossings), plain(baseCrossings));
assert.deepEqual(
  context.crosswalks.map((c) => ({ ...c })),
  baseCrosswalks.map((c) => ({ ...c })),
);

// Warm crossing cache: the context reuses it and still produces the same output.
const warmCity = fresh();
riverCrossingSpans(warmCity);
const warmContext = finish(roadCoverContextSteps(warmCity));
assert.deepEqual(plain(warmContext.crossings), plain(baseCrossings));
assert.deepEqual(
  warmContext.crosswalks.map((c) => ({ ...c })),
  baseCrosswalks.map((c) => ({ ...c })),
);

// Cancelling the generator leaves no partial result behind.
const cancelCity = fresh();
const cancelled = roadCoverContextSteps(cancelCity);
for (let i = 0; i < 5000; i++) assert.equal(cancelled.next().done, false);
assert.deepEqual(cancelled.return(undefined as never), { value: undefined, done: true });
assert.equal(cancelled.next().done, true);
const afterCancel = finish(roadCoverContextSteps(cancelCity));
assert.deepEqual(plain(afterCancel.crossings), plain(baseCrossings));
assert.deepEqual(
  afterCancel.crosswalks.map((c) => ({ ...c })),
  baseCrosswalks.map((c) => ({ ...c })),
);

console.log(
  `road context parity: ${context.crossings.length} crossings, ${context.crosswalks.length} crosswalks`,
);
