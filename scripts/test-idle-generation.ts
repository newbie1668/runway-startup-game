import assert from 'node:assert/strict';
import { createIdleGeneration } from '../lib/game/render3d/idleGeneration';

type Callback = (deadline: { timeRemaining(): number }) => void;

const pending = new Map<number, Callback>();
const cancelled: number[] = [];
let nextHandle = 0;
let work = 3;
let drains = 0;
const generation = createIdleGeneration(
  (callback) => {
    const handle = nextHandle++;
    pending.set(handle, callback);
    return handle;
  },
  (handle) => {
    cancelled.push(handle);
    pending.delete(handle);
  },
  () => work > 0,
  () => {
    drains++;
    work--;
  },
);

function take(): Callback {
  const entry = pending.entries().next().value;
  assert.ok(entry);
  pending.delete(entry[0]);
  return entry[1];
}

generation.wake();
generation.wake();
assert.equal(pending.size, 1, 'one callback, including handle zero');
take()({ timeRemaining: () => 4.9 });
assert.equal(drains, 0, 'insufficient idle time does not borrow from the next frame');
assert.equal(pending.size, 1);
take()({ timeRemaining: () => 100 });
assert.equal(drains, 1, 'one existing bounded drain even with a long idle deadline');
assert.equal(pending.size, 1);
take()({ timeRemaining: () => 5 });
assert.equal(drains, 2);
take()({ timeRemaining: () => 5 });
assert.equal(drains, 3);
assert.equal(pending.size, 0, 'settled generation stops scheduling');

work = 1;
generation.wake();
work = 0;
take()({ timeRemaining: () => 5 });
assert.equal(drains, 3, 'work completed by the animation frame is not repeated');
assert.equal(pending.size, 0);

work = 2;
generation.wake();
const late = [...pending.values()][0]!;
generation.dispose();
generation.dispose();
generation.wake();
late({ timeRemaining: () => 100 });
assert.equal(cancelled.length, 1);
assert.equal(drains, 3, 'late callbacks cannot generate after disposal');
assert.equal(pending.size, 0);

let fatalDrains = 0;
const fatal = createIdleGeneration(
  (callback) => {
    pending.set(0, callback);
    return 0;
  },
  (handle) => pending.delete(handle),
  () => true,
  () => {
    fatalDrains++;
    fatal.dispose();
  },
);
fatal.wake();
take()({ timeRemaining: () => 5 });
assert.equal(fatalDrains, 1);
assert.equal(pending.size, 0, 'fatal teardown during generation cannot reschedule');
console.log('Idle generation deadlines, single drains, wakeup and cancellation passed');
