import assert from 'node:assert/strict';
import type { CellId } from '../lib/game/render3d/cityIndex';
import type { StockTileId } from '../lib/game/render3d/stockTiles';
import {
  createStreamResidentStore,
  type StreamResident,
} from '../lib/game/render3d/streamResidentStore';

function resident<K extends string = CellId>(
  id: K,
  events: string[],
  options: { attachError?: Error; disposeError?: Error } = {},
): StreamResident<K> {
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

// Typed tile keys: the same lifecycle over a separate store, explicit removal by id, and no
// cross-store aliasing between a tile key and a cell key that happen to share digits.
const tileEvents: string[] = [];
const tiles = createStreamResidentStore<StreamResident<StockTileId>, StockTileId>();
const tileGeneration = tiles.beginGeneration();
const tile = resident<StockTileId>('tile:1,1', tileEvents);
assert.equal(tiles.publish(tileGeneration, tile), true);
assert.equal(tiles.publish(tileGeneration, resident<StockTileId>('tile:2,0', tileEvents)), true);
assert.equal(tiles.get('tile:1,1'), tile);
assert.equal(store.get('1,1'), replacement, 'cell store is unaffected by tile publication');
assert.deepEqual([...tiles.ids()].sort(), ['tile:1,1', 'tile:2,0']);
tiles.evict(['tile:2,0', 'tile:9,9']);
assert.deepEqual(tiles.ids(), ['tile:1,1']);
assert.deepEqual(tileEvents, ['attach:tile:1,1', 'attach:tile:2,0', 'dispose:tile:2,0']);
tiles.evict(['tile:1,1']);
assert.deepEqual(tiles.ids(), []);
assert.equal(tileEvents.at(-1), 'dispose:tile:1,1');
tiles.evict(['tile:1,1']);
assert.equal(tileEvents.length, 4, 'evicting a missing id disposes nothing');
assert.equal(tiles.publish(tileGeneration, tile), true, 'a disposed id can be republished');
tiles.evictOutside(new Set<StockTileId>());
assert.deepEqual(tiles.ids(), []);
tiles.dispose();
assert.equal(tiles.publish(tileGeneration, resident<StockTileId>('tile:1,1', tileEvents)), false);
assert.equal(tileEvents.at(-1), 'dispose:tile:1,1');

store.dispose();
assert.deepEqual(store.ids(), []);
const afterDispose = resident('3,3', events);
assert.equal(store.publish(nextGeneration, afterDispose), false);
assert.equal(events.at(-1), 'dispose:3,3');
assert.throws(() => store.beginGeneration(), /disposed/);
store.dispose();

console.log('Stream generation, atomic replacement, stale publication and eviction passed');
