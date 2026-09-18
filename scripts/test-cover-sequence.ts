import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CoverPages, sourcePointSequence } from '../lib/game/render3d/coverSequence';
import { decodeCity, dequantizeX, dequantizeY } from '../lib/game/render3d/format';
import { roadCoverContextSteps } from '../lib/game/render3d/cityBuilder';
import {
  pointOverWater,
  pointOverWaterSteps,
  waterRings,
  waterSourceRingsSteps,
} from '../lib/game/render3d/waterQuery';

function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

const pages = new CoverPages<number>();
assert.equal(pages.at(0), undefined);
for (let i = 0; i < 196_609; i++) {
  pages.push(i * 3);
  assert.equal(pages.at(-1), i * 3);
}
for (let i = 0; i < pages.length; i++) assert.equal(pages.at(i), i * 3);
let offset = 0;
for (const value of pages) assert.equal(value, offset++ * 3);
assert.equal(offset, pages.length);
assert.equal(pages.at(pages.length), undefined);
assert.equal(pages.at(-pages.length - 1), undefined);
assert.equal(pages.at(0.5), undefined);

let reads = 0;
const source = new Proxy(new Uint16Array(2_000_000), {
  get(target, key) {
    if (key === 'length') return target.length;
    if (typeof key === 'string' && /^\d+$/.test(key)) {
      reads++;
      return target[Number(key)];
    }
    return Reflect.get(target, key, target);
  },
});
const cursor = sourcePointSequence(source);
assert.equal(reads, 0);
assert.equal(cursor.length, 1_000_000);
assert.deepEqual(cursor.at(999_999), { x: dequantizeX(0), z: dequantizeY(0) });
assert.equal(reads, 2);
assert.equal(Object.isFrozen(cursor), true);
assert.equal(Object.isFrozen(cursor.at(0)), true);
assert.equal(cursor.at(cursor.length), undefined);

const binary = readFileSync(new URL('../public/map/london-city.bin', import.meta.url));
const data = decodeCity(
  binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
);
const rings = finish(waterSourceRingsSteps(data));
assert.equal(finish(waterSourceRingsSteps(data)), rings);
const legacy = waterRings(data);
for (let i = 0; i < rings.length; i++) {
  assert.deepEqual(Array.from(rings[i]!.points), legacy[i]!.points);
  for (const point of legacy[i]!.points) {
    for (const delta of [-1e-12, 0, 1e-12]) {
      assert.equal(
        finish(pointOverWaterSteps(point.x, point.z + delta, rings)),
        pointOverWater(point.x, point.z + delta, legacy),
      );
    }
  }
}
const started = performance.now();
const context = finish(roadCoverContextSteps(data));
assert.equal(
  createHash('sha256').update(JSON.stringify(context)).digest('hex'),
  '2fe9c9ece69868c64047030ba99480b2e5a754c84c4b8de6998a6376c874b7ba',
);
console.log(
  `Cover sequences: radix boundaries, lazy source reads, water parity and accepted road context (${Math.round(performance.now() - started)} ms CPU only)`,
);
