import assert from 'node:assert/strict';
import { polylineDashes, visitPolylineDashSteps } from '../lib/game/render3d/streetMarks';

const points = Array.from({ length: 512 }, (_, index) => ({
  x: index % 2 ? 10 : -10,
  z: index % 3,
}));
const expected = polylineDashes(points);
let delivered = 0;
const iterator = visitPolylineDashSteps(points, (dash) => {
  assert.deepEqual(dash, expected[delivered], 'streamed dash must preserve coordinates and order');
  delivered++;
});
let units = 0;
for (;;) {
  const before = delivered;
  const step = iterator.next();
  assert(delivered - before <= 1, 'one advancement may deliver at most one dash');
  if (step.done) break;
  assert(++units < 10_000_000, 'stream must terminate');
}
assert.equal(delivered, expected.length, 'streamed dash count must remain exact');
assert(delivered > 100_000, 'fixture must cover high dash expansion');

console.log(`Street marks: ${delivered} exact dashes, one delivered per advancement`);
