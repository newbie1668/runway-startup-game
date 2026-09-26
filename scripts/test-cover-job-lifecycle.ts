import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { BuildJob } from '../lib/game/render3d/buildScheduler';
import { createCoverJob } from '../lib/game/render3d/coverGeometry';
import { quantizeX, quantizeY, type CityPoly } from '../lib/game/render3d/format';
import { createWaterCoverJob } from '../lib/game/render3d/waterCoverJob';

const options = { id: 'lifecycle', generation: 1, essential: true, now: () => 0 };
function resource() {
  return {
    disposals: 0,
    dispose() {
      this.disposals++;
    },
  };
}

{
  const before = resource(),
    after = resource();
  let publications = 0;
  const job = createCoverJob(
    {
      ...options,
      onReady() {
        publications++;
      },
    },
    function* (context) {
      context.own(before);
      assert.doesNotThrow(() => job.cancel());
      context.own(after);
      yield;
      assert.fail('cancelled producer must not resume');
    },
  );
  assert.equal(job.step(), true);
  job.cancel();
  assert.equal(job.step(), true);
  assert.deepEqual([before.disposals, after.disposals, publications], [1, 1, 0]);
}

{
  const square: CityPoly = {
    verts: new Uint16Array(
      [10, 10, 11, 10, 11, 11, 10, 11].map((value, i) =>
        i % 2 ? quantizeY(value) : quantizeX(value),
      ),
    ),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
  const water: CityPoly[] = [];
  let publications = 0;
  Object.defineProperty(water, '0', {
    get() {
      job.cancel();
      return square;
    },
  });
  const job = createWaterCoverJob({
    ...options,
    cityData: { water, parks: [], roads: [], buildings: [] },
    waterIndices: [0],
    onReady() {
      publications++;
    },
  });
  assert.equal(job.step(), true);
  assert.equal(job.step(), true);
  assert.equal(publications, 0);
}

{
  const owned = resource();
  let ticks = 0,
    publications = 0;
  const job = createCoverJob(
    {
      ...options,
      now() {
        if (++ticks === 2) job.cancel();
        return 0;
      },
      onReady() {
        publications++;
      },
    },
    function* (context) {
      context.own(owned);
      yield;
      assert.fail('clock cancellation must not resume producer');
    },
  );
  assert.equal(job.step(), true);
  assert.equal(job.step(), true);
  assert.deepEqual([owned.disposals, publications], [1, 0]);
}

{
  const first = resource(),
    final = resource();
  let time = 0;
  const job = createCoverJob(
    {
      ...options,
      now: () => (time += 4),
      onReady() {
        assert.fail('cancelled job published');
      },
    },
    function* (context) {
      context.own(first);
      try {
        yield;
      } finally {
        context.own(final);
      }
    },
  );
  assert.equal(job.step(), false);
  job.cancel();
  job.cancel();
  assert.equal(job.step(), true);
  assert.deepEqual([first.disposals, final.disposals], [1, 1]);
}

for (const empty of [false, true]) {
  const owned = resource();
  let publications = 0;
  const job: BuildJob = createCoverJob(
    {
      ...options,
      onReady(group) {
        publications++;
        assert.equal(group === null, empty);
        assert.throws(() => job.step(), /Reentrant cover job step/);
      },
    },
    function* (context) {
      context.own(owned);
      if (!empty) context.root.add(new THREE.Object3D());
      yield;
    },
  );
  assert.equal(job.step(), true);
  job.cancel();
  assert.equal(job.step(), true);
  assert.deepEqual([owned.disposals, publications], [empty ? 1 : 0, 1]);
  if (!empty) owned.dispose();
}

console.log('6 adversarial cover lifecycle checks passed');
