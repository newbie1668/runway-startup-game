import assert from 'node:assert/strict';
import { METERS_TO_WORLD } from '../lib/game/geo';
import { CameraRig } from '../lib/game/render3d/cameraRig';
import type { CoverIndex, CoverSelection } from '../lib/game/render3d/coverIndex';
import { cameraGroundBounds, planStreamCoverage } from '../lib/game/render3d/streamCoverage';
import type { CellId, CityCell, CityIndex } from '../lib/game/render3d/cityIndex';

const cityCells = new Map<CellId, CityCell>();
const coverCells = new Map<CellId, CoverSelection>();
const cellWorld = 400 * METERS_TO_WORLD;
for (let x = -2; x <= 4; x++) {
  const id = `${x},0` as CellId;
  cityCells.set(id, {
    id,
    bounds: {
      minX: x * cellWorld,
      minZ: 0,
      maxX: x * cellWorld + cellWorld,
      maxZ: cellWorld,
    },
    buildingIndices: [x + 2],
  });
  coverCells.set(id, { roads: [x + 2], parks: [], water: [] });
}
const city: CityIndex = { cells: cityCells };
const cover: CoverIndex = {
  cellSizeM: 400,
  cells: coverCells,
  featureBounds: { roads: [], parks: [], water: [] },
  bounds: null,
};

const bounds = cameraGroundBounds(
  {
    groundUnproject(x, y) {
      return { x: x === 0 ? 0 : 2, y: y === 0 ? 0 : 2 };
    },
  },
  100,
  80,
);
assert.deepEqual(bounds, { minX: 0, minZ: 0, maxX: 2, maxZ: 2 });
assert.throws(() => cameraGroundBounds({ groundUnproject: () => ({ x: 0, y: 0 }) }, 0, 80));

const rig = new CameraRig();
rig.setViewport(1440, 900);
rig.update({ x: 20, y: 30, zoom: 450 }, Math.PI / 4);
const beforeRender = cameraGroundBounds(rig, 1440, 900);
assert(beforeRender.minX < 20 && beforeRender.maxX > 20);
assert(beforeRender.minZ < 30 && beforeRender.maxZ > 30);
rig.update({ x: 40, y: 60, zoom: 450 }, Math.PI / 4);
const moved = cameraGroundBounds(rig, 1440, 900);
assert(Math.abs(moved.minX - beforeRender.minX - 20) < 1e-9);
assert(Math.abs(moved.minZ - beforeRender.minZ - 30) < 1e-9);

const street = planStreamCoverage(city, cover, bounds);
assert.equal(street.detail, 'street');
assert.deepEqual(street.visibleStock, ['-2,0', '-1,0', '0,0', '1,0'].sort());
assert.deepEqual(street.detailedStock, ['-1,0', '0,0']);
assert.deepEqual(street.prefetchStock, ['2,0']);
assert.deepEqual(street.retainStock, ['-2,0', '0,0', '1,0', '2,0', '3,0', '4,0', '-1,0'].sort());
assert.deepEqual(street.visibleCover, ['-1,0', '0,0']);
assert.deepEqual(street.prefetchCover, ['-2,0', '1,0']);
assert.deepEqual(street.retainCover, ['-2,0', '-1,0', '0,0', '1,0', '2,0', '3,0'].sort());

assert.equal(
  planStreamCoverage(city, cover, { minX: 0, minZ: 0, maxX: 13, maxZ: 2 }).detail,
  'neighbourhood',
);
assert.equal(
  planStreamCoverage(city, cover, { minX: 0, minZ: 0, maxX: 49, maxZ: 2 }).detail,
  'overview',
);

console.log('Camera bounds, stock detail, cover selection, prefetch and hysteresis passed');
