import assert from 'node:assert/strict';
import {
  drainWithin,
  loadingBudgetMs,
  MAX_LOADING_BUDGET_MS,
  SLICE_MS,
} from '../lib/game/render3d/loadingBudget';

// Budget: half the frame interval, never below one slice or above the long-task-safe cap.
assert.equal(loadingBudgetMs(16.7), 8.35);
assert.equal(loadingBudgetMs(4), SLICE_MS, 'fast frames still get one slice');
assert.equal(loadingBudgetMs(200), MAX_LOADING_BUDGET_MS, 'a 5 fps software renderer is capped');
for (const bad of [0, -5, NaN, Infinity]) assert.equal(loadingBudgetMs(bad), SLICE_MS);

// Each drain advances a fake clock by one full slice: 40 ms admits exactly ten slices.
let clock = 0;
let work = 100;
const drains = drainWithin(40, () => clock, () => work > 0, () => {
  clock += SLICE_MS;
  work--;
});
assert.equal(drains, 10);
assert(clock <= 40, 'no slice starts that could overrun the budget');

// One slice when the budget is a single slice: identical to the steady-state renderer.
clock = 0;
assert.equal(drainWithin(SLICE_MS, () => clock, () => true, () => { clock += 1; }), 1);

// Stops as soon as the work is done.
clock = 0;
work = 3;
assert.equal(drainWithin(40, () => clock, () => work > 0, () => { clock += 1; work--; }), 3);

// A clock that never advances (coarse timers) is bounded by the drain cap.
assert.equal(drainWithin(40, () => 0, () => true, () => undefined), 16);

// A drain that throws propagates after one call; the caller's fallback handling decides.
assert.throws(() => drainWithin(40, () => 0, () => true, () => { throw new Error('boom'); }), /boom/);

console.log('Loading budget checks passed');
