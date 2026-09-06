import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METERS_TO_WORLD } from '../lib/game/geo';
import { decodeCity } from '../lib/game/render3d/format';
import { riverCrossingSpans, splitRoadRuns } from '../lib/game/render3d/cityBuilder';

const raw = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
const city = decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const cityCopy = decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const crossingShape = (value: ReturnType<typeof riverCrossingSpans>) =>
  value.map((span) => ({ pts: span.pts, tier: span.tier }));

const spans = riverCrossingSpans(city);
assert.equal(spans.length, 15);
assert.equal(digest(crossingShape(spans)), '449a9b5a9274067f4dfe75f93598a000557c6abbb30c2c777d00d07019abf6a1');

// Water edges stay governed by the existing predicate, including exact edges.
const edgeWater = (x: number): boolean => x >= 1 && x <= 2;
const edgeRuns = splitRoadRuns(
  [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }],
  edgeWater,
);
assert.equal(edgeRuns.length, 2);
assert.ok(edgeRuns.every((run) => run.pts.every((p) => !edgeWater(p.x))));

// A wet interior with dry endpoints is split into land approaches.
const interiorRuns = splitRoadRuns(
  [{ x: 0, z: 0 }, { x: 0.5, z: 0 }, { x: 3, z: 0 }, { x: 3.5, z: 0 }],
  (x) => x > 1 && x < 3,
);
assert.equal(interiorRuns.length, 2);
assert.ok(interiorRuns.every((run) => run.pts.length >= 2));

// A channel below the crossing threshold remains a normal land ribbon.
const narrowRuns = splitRoadRuns(
  [{ x: 0, z: 0 }, { x: 0.25, z: 0 }, { x: 0.75, z: 0 }, { x: 1, z: 0 }],
  (x) => x >= 0.45 && x <= 0.55,
);
assert.equal(narrowRuns.length, 1);

// Returned spans are defensive copies, and a second decoded instance has its own cache entry.
const firstPoint = spans[0]!.pts[0];
spans[0]!.pts[0] = { x: -1, z: -1 };
const again = riverCrossingSpans(city);
assert.deepEqual(again[0]!.pts[0], firstPoint);
assert.deepEqual(crossingShape(again), crossingShape(riverCrossingSpans(cityCopy)));
assert.equal(digest(crossingShape(again)), '449a9b5a9274067f4dfe75f93598a000557c6abbb30c2c777d00d07019abf6a1');

// Keep the source identity visible in the focused evidence.
assert.equal(createHash('sha256').update(raw).digest('hex'), '6375dd81dfb23a7ef6e312b888c1b0bcf9e26b67978081a48403429221a2a2c0');
console.log(`water-query semantics: ${spans.length} spans, source ${raw.byteLength} bytes`);
console.log(`METERS_TO_WORLD=${METERS_TO_WORLD}`);
