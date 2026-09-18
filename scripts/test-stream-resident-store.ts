import assert from 'node:assert/strict';
import type { CellId } from '../lib/game/render3d/cityIndex';
import {
  createStreamResidentStore,
  type StreamResident,
} from '../lib/game/render3d/streamResidentStore';

function resident(
  id: CellId,
  events: string[],
  options: { attachError?: Error; disposeError?: Error } = {},
): StreamResident {
  return {
    id,
    attach() {
      events.push(`attach:${id}`);
      if (options.attachError) throw options.attachError;
    },
    dispose() {
      events.push(`dispose:${id}`);
      if (options.disposeError) throw options.disposeError;
    },
  };
}

const events: string[] = [];
const store = createStreamResidentStore();
const firstGeneration = store.beginGeneration();
const old = resident('1,1', events);
assert.equal(store.publish(firstGeneration, old), true);
const replacement = resident('1,1', events);
assert.equal(store.publish(firstGeneration, replacement), true);
assert.equal(store.get('1,1'), replacement);
assert.deepEqual(events, ['attach:1,1', 'attach:1,1', 'dispose:1,1']);

const nextGeneration = store.beginGeneration();
const obsolete = resident('2,2', events);
assert.equal(store.publish(firstGeneration, obsolete), false);
assert.equal(store.get('2,2'), undefined);
assert.equal(events.at(-1), 'dispose:2,2');

const attachFailure = new Error('attach failed');
assert.throws(
  () => store.publish(nextGeneration, resident('1,1', events, { attachError: attachFailure })),
  attachFailure,
);
assert.equal(store.get('1,1'), replacement);
assert.deepEqual(events.slice(-2), ['attach:1,1', 'dispose:1,1']);

assert.equal(store.publish(nextGeneration, resident('2,2', events)), true);
store.evictOutside(new Set<CellId>(['1,1']));
assert.deepEqual(store.ids(), ['1,1']);
assert.equal(events.at(-1), 'dispose:2,2');

const interrupted = resident('3,3', events);
interrupted.attach = () => {
  events.push('attach:3,3');
  store.beginGeneration();
};
assert.equal(store.publish(nextGeneration, interrupted), false);
assert.equal(store.get('3,3'), undefined);
assert.deepEqual(events.slice(-2), ['attach:3,3', 'dispose:3,3']);

const failureEvents: string[] = [];
const failures = createStreamResidentStore();
const generation = failures.beginGeneration();
failures.publish(generation, resident('1,1', failureEvents, { disposeError: new Error('a') }));
failures.publish(generation, resident('2,2', failureEvents, { disposeError: new Error('b') }));
assert.throws(
  () => failures.evictOutside(new Set()),
  (error: unknown) => error instanceof AggregateError && error.errors.length === 2,
);
assert.deepEqual(failures.ids(), []);

store.dispose();
assert.deepEqual(store.ids(), []);
const afterDispose = resident('3,3', events);
assert.equal(store.publish(nextGeneration, afterDispose), false);
assert.equal(events.at(-1), 'dispose:3,3');
assert.throws(() => store.beginGeneration(), /disposed/);
store.dispose();

console.log('Stream generation, atomic replacement, stale publication and eviction passed');
