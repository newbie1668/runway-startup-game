import assert from 'node:assert/strict';
import {
  drainWithin,
  LOADING_FRAME_TASK_MS,
  loadingBudgetMs,
  SLICE_MS,
} from '../lib/game/render3d/loadingBudget';

// Budget: half the frame interval, never below one slice, and generation plus the rest of the
// frame's main-thread work stays within the 32 ms loading frame task (below the 50 ms long task).
assert.equal(loadingBudgetMs(16.7, 3), 8.35);
assert.equal(loadingBudgetMs(4, 0), SLICE_MS, 'fast frames still get one slice');
assert.equal(loadingBudgetMs(200, 0), LOADING_FRAME_TASK_MS, 'a 5 fps GPU-bound frame is capped');
assert.equal(loadingBudgetMs(200, 10), LOADING_FRAME_TASK_MS - 10, 'other frame work is subtracted');
assert.equal(loadingBudgetMs(200, 60), SLICE_MS, 'a frame already over the limit gets only one slice');
for (const bad of [0, -5, NaN, Infinity]) assert.equal(loadingBudgetMs(bad, 0), SLICE_MS);
assert.equal(loadingBudgetMs(200, NaN), LOADING_FRAME_TASK_MS, 'unknown other work counts as none');
// No self-feeding: when the interval is dominated by the budget itself, the task cap still binds.
let interval = 16.7;
for (let i = 0; i < 20; i++) {
  const other = 12;
  const budget = loadingBudgetMs(interval, other);
  assert(budget + other <= LOADING_FRAME_TASK_MS || budget === SLICE_MS);
  interval = Math.max(interval, other + budget + 30); // a slow GPU adds 30 ms of waiting per frame
}

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
