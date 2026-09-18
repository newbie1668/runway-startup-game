'use strict';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roadCoverContextSteps } from '../lib/game/render3d/cityBuilder';
import { decodeCity, quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';
import { pointOverWaterSteps, waterRingsSteps } from '../lib/game/render3d/waterQuery';

function consume<T>(steps: Generator<void, T>): T {
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

const bytes = readFileSync('public/map/london-city.bin');
const city = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const rings = consume(waterRingsSteps(city));
assert(rings.length > 0);
const ring = rings[0]!,
  point = ring.points[0]!;
const wet = consume(pointOverWaterSteps(point.x, point.z, rings));
assert.throws(() => {
  // @ts-expect-error cached collection is readonly
  rings.length = 0;
}, TypeError);
assert.throws(() => {
  // @ts-expect-error cached bounds are readonly
  ring.minX = 1e20;
}, TypeError);
assert.throws(() => {
  // @ts-expect-error cached points are readonly
  ring.points.push({ x: 0, z: 0 });
}, TypeError);
assert.throws(() => {
  // @ts-expect-error cached coordinates are readonly
  point.x = 1e20;
}, TypeError);
assert.equal(Reflect.deleteProperty(ring.points, '0'), false);
assert.equal(Reflect.defineProperty(rings, '0', { value: null }), false);
assert.equal(Reflect.setPrototypeOf(rings, null), false);
assert.equal(consume(waterRingsSteps(city)), rings);
assert.equal(consume(pointOverWaterSteps(point.x, point.z, rings)), wet);

const context = consume(roadCoverContextSteps(city));
assert(context.crossings.length > 0 && context.crosswalks.length > 0);
const crossing = context.crossings[0]!,
  zebra = context.crosswalks[0]!;
assert.throws(() => {
  // @ts-expect-error cached collection is readonly
  context.crossings.length = 0;
}, TypeError);
assert.throws(() => {
  // @ts-expect-error cached coordinates are readonly
  crossing.pts[0].x = 1e20;
}, TypeError);
assert.throws(() => {
  // @ts-expect-error cached tier is readonly
  crossing.tier = 100;
}, TypeError);
assert.throws(() => {
  // @ts-expect-error cached crossing is readonly
  zebra.x = 1e20;
}, TypeError);
assert.equal(Reflect.set(context.crosswalks, '0', null), false);
assert.equal(Reflect.set(context, 'crossings', []), false);
assert.equal(consume(roadCoverContextSteps(city)), context);

function equalSource(): CityData {
  return {
    buildings: [],
    parks: [],
    water: [
      {
        verts: new Uint16Array([
          quantizeX(9),
          quantizeY(9),
          quantizeX(9.1),
          quantizeY(9),
          quantizeX(9),
          quantizeY(9.1),
        ]),
        indices: new Uint16Array([0, 1, 2]),
      },
    ],
    roads: [
      {
        tier: 0,
        pts: new Uint16Array([quantizeX(10), quantizeY(10), quantizeX(11), quantizeY(10)]),
      },
      {
        tier: 0,
        pts: new Uint16Array([quantizeX(10), quantizeY(10), quantizeX(10), quantizeY(11)]),
      },
    ],
  };
}
const first = equalSource(),
  second = equalSource();
const firstWater = consume(waterRingsSteps(first));
const secondWater = consume(waterRingsSteps(second));
assert.deepEqual(firstWater, secondWater);
assert.notEqual(firstWater, secondWater);
assert.notEqual(firstWater[0]!.points, secondWater[0]!.points);
const firstRoad = consume(roadCoverContextSteps(first));
const secondRoad = consume(roadCoverContextSteps(second));
assert(firstRoad.crosswalks.length > 0);
assert.deepEqual(firstRoad, secondRoad);
assert.notEqual(firstRoad, secondRoad);
assert.notEqual(firstRoad.crosswalks[0], secondRoad.crosswalks[0]);
assert.equal(consume(roadCoverContextSteps(first)), firstRoad);
console.log('Road and water cache ownership, nested mutation and readonly contracts passed');
