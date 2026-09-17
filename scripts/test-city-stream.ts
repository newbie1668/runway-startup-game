import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMapDiagnostics } from '../lib/game/mapDiagnostics';
import { createBuildingMaterial } from '../lib/game/render3d/cityBuilder';
import { indexCity, type BoundsXZ } from '../lib/game/render3d/cityIndex';
import { CityStream } from '../lib/game/render3d/cityStream';
import { createCoverIndexJob, type CoverIndex } from '../lib/game/render3d/coverIndex';
import { createGeometryTracker } from '../lib/game/render3d/diagnostics';
import {
  quantizeX,
  quantizeY,
  type CityBuilding,
  type CityData,
} from '../lib/game/render3d/format';
import { createResourcePool } from '../lib/game/render3d/sceneResources';

function building(x: number, z: number): CityBuilding {
  return {
    major: false,
    heightM: 12,
    chunkId: 0,
    style: 1,
    roof: 0,
    wall565: 0,
    roof565: 0,
    verts: new Uint16Array([
      quantizeX(x),
      quantizeY(z),
      quantizeX(x + 0.2),
      quantizeY(z),
      quantizeX(x + 0.2),
      quantizeY(z + 0.2),
      quantizeX(x),
      quantizeY(z + 0.2),
    ]),
    indices: new Uint8Array([0, 1, 2, 0, 2, 3]),
  };
}

const data: CityData = {
  buildings: [building(10, 10), building(60, 10)],
  roads: [
    { tier: 2, pts: new Uint16Array([quantizeX(9), quantizeY(9), quantizeX(11), quantizeY(9)]) },
    { tier: 2, pts: new Uint16Array([quantizeX(59), quantizeY(9), quantizeX(61), quantizeY(9)]) },
  ],
  parks: [],
  water: [],
};
const indexed: { value: CoverIndex | null } = { value: null };
const indexJob = createCoverIndexJob({
  id: 'index',
  generation: 0,
  essential: true,
  cityData: data,
  now: () => 0,
  onReady: (value) => {
    indexed.value = value;
  },
});
while (!indexJob.step()) {}
assert.ok(indexed.value);
const root = new THREE.Group();
const resources = createResourcePool();
const tracker = createGeometryTracker();
const material = createBuildingMaterial();
resources.retain(material);
let materialDisposals = 0;
material.addEventListener('dispose', () => {
  materialDisposals++;
});
const diagnostics = createMapDiagnostics(1, () => 0);
diagnostics.selectMode('3d');
const failures: string[] = [];
let evictions = 0;
const cityIndex = indexCity(data, 400);
const firstId = [...cityIndex.cells.values()].find((cell) => cell.buildingIndices.includes(0))!.id;
const secondId = [...cityIndex.cells.values()].find((cell) => cell.buildingIndices.includes(1))!.id;
const stream = new CityStream({
  data,
  cityIndex,
  coverIndex: indexed.value,
  exclusions: new Set(),
  material,
  root,
  resources,
  tracker,
  diagnostics,
  now: () => 0,
  onStockDrawn: () => undefined,
  onStockEvicted: () => {
    evictions++;
  },
  onFatal: (reason) => {
    failures.push(reason);
  },
});

function ready(bounds: BoundsXZ): void {
  stream.update(bounds);
  let frames = 0;
  do {
    stream.drain();
    assert(++frames < 10_000, 'visible coverage settles');
    assert.deepEqual(failures, []);
    assert(diagnostics.snapshot().queuedJobs <= 5, 'four jobs plus coverage latch');
  } while (diagnostics.snapshot().pendingEssentialJobs > 0);
}

const first = { minX: 9, minZ: 8, maxX: 11, maxZ: 11 };
ready(first);
let backgroundFrames = 0;
while (!stream.idle) {
  stream.drain();
  assert(++backgroundFrames < 10_000);
}
assert.deepEqual(failures, []);
assert(stream.stockBuildings >= 1);
assert(
  !stream.buildingMeshes().some((mesh) => mesh.userData.cellId === secondId),
  'idle background work never builds stock beyond the prefetch ring',
);
assert(tracker.bytes() > 0);
const oldMesh = stream.buildingMeshes().find((mesh) => mesh.userData.cellId === firstId);
assert.ok(oldMesh);
let oldDisposed = 0;
oldMesh.geometry.addEventListener('dispose', () => {
  oldDisposed++;
});
const pendingBefore = diagnostics.snapshot().queuedJobs;
stream.update({ ...first, minX: 9.1 });
assert.equal(diagnostics.snapshot().queuedJobs, pendingBefore, 'same cells do not restart work');
const second = { minX: 59, minZ: 8, maxX: 61, maxZ: 11 };
stream.update(second);
assert.equal(oldDisposed, 0, 'old useful stock survives a destination change');
ready(second);
assert.equal(oldDisposed, 1, 'obsolete detailed stock is evicted after destination publication');
assert(stream.buildingMeshes().some((mesh) => mesh.userData.cellId === secondId));
assert(evictions > 0);
assert.equal(materialDisposals, 0, 'shared building material survives cell eviction');

ready({ minX: 0, minZ: 0, maxX: 80, maxZ: 20 });
assert.equal(stream.stockBuildings, 2, 'overview retains both ordinary buildings');
assert.equal(stream.buildingMeshes().length, 2, 'each owner cell publishes once');
ready(first);
assert(
  !stream.buildingMeshes().some((mesh) => mesh.userData.cellId === secondId),
  'overview residents outside hysteresis are evicted after moving close',
);
stream.update(first);
stream.drain();
stream.update(second);
stream.drain();
assert.deepEqual(failures, []);
stream.dispose();
stream.dispose();
assert.equal(root.children.length, 0);
assert.equal(tracker.bytes(), 0);
assert.equal(stream.stockBuildings, 0);
assert.equal(diagnostics.snapshot().queuedJobs, 0, 'cancellation removes pending diagnostics');
assert.equal(materialDisposals, 0);
resources.dispose();
assert.equal(materialDisposals, 1);
console.log('Camera streaming, replacement, queue bounds, overview and eviction passed');
