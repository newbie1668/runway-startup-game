import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { METERS_TO_WORLD } from '../lib/game/geo';
import { quantizeX, quantizeY, decodeCity } from '../lib/game/render3d/format';
import { indexCity, type BoundsXZ, type CityIndex } from '../lib/game/render3d/cityIndex';
import { cellsForBounds, coverageDelta } from '../lib/game/render3d/coverage';
import type { CityData } from '../lib/game/render3d/format';

const building = (points: readonly [number, number][]) => ({
  major: false,
  heightM: 10,
  chunkId: 0,
  style: 0,
  roof: 0,
  wall565: 0,
  roof565: 0,
  verts: Uint16Array.from(points.flatMap(([x, z]) => [quantizeX(x), quantizeY(z)])),
  indices: new Uint8Array([0, 1, 2]),
});
const emptyData = (): CityData => ({ buildings: [], roads: [], parks: [], water: [] });

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('City index and coverage');
check('empty data produces an empty stable index', () => {
  const index = indexCity(emptyData(), 400);
  assert.equal(index.cells.size, 0);
  assert.deepEqual(cellsForBounds(index, { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, 0), []);
});
check('rejects invalid cell sizes and malformed footprints', () => {
  assert.throws(() => indexCity(emptyData(), 0), RangeError);
  assert.throws(() => indexCity(emptyData(), Number.NaN), RangeError);
  assert.throws(() => indexCity(emptyData(), Number.MIN_VALUE), RangeError);
  const malformed = emptyData();
  malformed.buildings.push({
    ...building([
      [1, 1],
      [2, 2],
    ]),
    verts: new Uint16Array([1, 2, 3, 4]),
  });
  assert.throws(() => indexCity(malformed, 400), RangeError);
});
check('validates query bounds and padding', () => {
  const index = indexCity(emptyData(), 400);
  assert.throws(() => cellsForBounds(index, { minX: 1, minZ: 0, maxX: 0, maxZ: 1 }, 0), RangeError);
  assert.throws(
    () => cellsForBounds(index, { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, -1),
    RangeError,
  );
  assert.throws(
    () => cellsForBounds(index, { minX: Infinity, minZ: 0, maxX: 1, maxZ: 1 }, 0),
    RangeError,
  );
});
check('assigns by arithmetic vertex centroid and expands owner bounds', () => {
  const size = 400;
  const cell = size * METERS_TO_WORLD;
  const data = emptyData();
  data.buildings.push(
    building([
      [cell * 0.8, 0.1],
      [cell * 1.2, 0.1],
      [cell * 0.8, 0.2],
    ]),
  );
  const before = data.buildings[0]!.verts.slice();
  const index = indexCity(data, size);
  assert.deepEqual([...index.cells.keys()], ['0,0']);
  assert.deepEqual(index.cells.get('0,0')!.buildingIndices, [0]);
  assert.ok(index.cells.get('0,0')!.bounds.maxX > cell);
  assert.deepEqual(data.buildings[0]!.verts, before);
  assert.deepEqual(cellsForBounds(index, { minX: cell, minZ: 0, maxX: cell, maxZ: 1 }, 0), ['0,0']);
});
check('output is deterministic and delta is deduplicated and sorted', () => {
  const data = emptyData();
  data.buildings.push(
    building([
      [2, 2],
      [3, 2],
      [2, 3],
    ]),
    building([
      [1, 1],
      [2, 1],
      [1, 2],
    ]),
  );
  const a = indexCity(data, 400);
  const b = indexCity(data, 400);
  assert.deepEqual([...a.cells.entries()], [...b.cells.entries()]);
  assert.deepEqual(coverageDelta(new Set(['0,0', '1,0']), ['1,0', '2,0', '2,0']), {
    add: ['2,0'],
    keep: ['1,0'],
    remove: ['0,0'],
  });
});
check('negative-coordinate selector handles edge-touching bounds', () => {
  const index: CityIndex = {
    cells: new Map([
      [
        '-1,-1',
        { id: '-1,-1', bounds: { minX: -10, minZ: -10, maxX: 0, maxZ: 0 }, buildingIndices: [] },
      ],
    ]),
  };
  const bounds: BoundsXZ = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  assert.deepEqual(cellsForBounds(index, bounds, 0), ['-1,-1']);
});
check('every committed binary building has exactly one owner cell', () => {
  const started = performance.now();
  const bytes = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const data = decodeCity(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const index = indexCity(data, 400);
  const owners = index.cells;
  assert.equal(data.buildings.length, 113_569);
  const seen = new Set<number>();
  for (const cell of owners.values())
    for (const buildingIndex of cell.buildingIndices) {
      assert.ok(!seen.has(buildingIndex), `duplicate owner for building ${buildingIndex}`);
      seen.add(buildingIndex);
    }
  assert.equal(seen.size, data.buildings.length);
  console.log(
    `  binary buildings=${data.buildings.length} cells=${owners.size} indexMs=${(performance.now() - started).toFixed(1)}`,
  );
});

console.log(`Passed ${passed} city coverage checks`);
