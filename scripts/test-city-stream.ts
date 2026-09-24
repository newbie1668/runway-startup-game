import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMapDiagnostics } from '../lib/game/mapDiagnostics';
import { createBuildingMaterial } from '../lib/game/render3d/cityBuilder';
import { indexCity, type BoundsXZ, type CellId } from '../lib/game/render3d/cityIndex';
import { CityStream } from '../lib/game/render3d/cityStream';
import { createCoverIndexJob, type CoverIndex } from '../lib/game/render3d/coverIndex';
import { createGeometryTracker } from '../lib/game/render3d/diagnostics';
import {
  quantizeX,
  quantizeY,
  type CityBuilding,
  type CityData,
  type CityPoly,
} from '../lib/game/render3d/format';
import { METERS_TO_WORLD } from '../lib/game/geo';
import { createResourcePool } from '../lib/game/render3d/sceneResources';

function coversCell(mesh: THREE.Mesh, id: CellId): boolean {
  const cellIds = mesh.userData.cellIds as readonly CellId[] | undefined;
  return mesh.userData.cellId === id || (cellIds?.includes(id) ?? false);
}

const coverCellM = Number(process.argv[2] ?? 1600);
assert(Number.isFinite(coverCellM) && coverCellM > 0);

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

function park(x: number, z: number): CityPoly {
  return {
    verts: new Uint16Array([
      quantizeX(x - 2),
      quantizeY(z - 2),
      quantizeX(x + 2),
      quantizeY(z - 2),
      quantizeX(x + 2),
      quantizeY(z + 2),
      quantizeX(x - 2),
      quantizeY(z + 2),
    ]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

const data: CityData = {
  buildings: [building(10, 10), building(60, 10)],
  roads: [
    { tier: 2, pts: new Uint16Array([quantizeX(9), quantizeY(9), quantizeX(11), quantizeY(9)]) },
    { tier: 2, pts: new Uint16Array([quantizeX(59), quantizeY(9), quantizeX(61), quantizeY(9)]) },
  ],
  parks: [park(10, 10), park(60, 10)],
  water: [],
};
const indexed: { value: CoverIndex | null } = { value: null };
const indexJob = createCoverIndexJob({
  id: 'index',
  generation: 0,
  essential: true,
  cityData: data,
  now: () => 0,
  cellSizeM: coverCellM,
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
const firstCoverId = [...indexed.value!.cells.entries()].find(([, selection]) =>
  selection.roads.includes(0),
)![0];
const secondCoverId = [...indexed.value!.cells.entries()].find(([, selection]) =>
  selection.roads.includes(1),
)![0];
if (coverCellM === 1600) {
  assert.notEqual(firstId, firstCoverId, 'stock and cover grids use distinct cell IDs');
  assert.notEqual(secondId, secondCoverId, 'stock and cover grids use distinct cell IDs');
}
const coverWorld = coverCellM * METERS_TO_WORLD;
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
const firstTreeMeshes: THREE.InstancedMesh[] = [];
root.traverse((object) => {
  if (object instanceof THREE.InstancedMesh) firstTreeMeshes.push(object);
});
assert(firstTreeMeshes.length > 0, 'first cover cell publishes tree instances');
const firstTreeBounds = {
  minX: Math.floor(first.minX / coverWorld) * coverWorld,
  minZ: Math.floor(first.minZ / coverWorld) * coverWorld,
  maxX: (Math.floor(first.maxX / coverWorld) + 1) * coverWorld,
  maxZ: (Math.floor(first.maxZ / coverWorld) + 1) * coverWorld,
};
for (const mesh of firstTreeMeshes) {
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    matrix.fromArray(mesh.instanceMatrix.array, i * 16);
    assert(
      matrix.elements[12]! >= firstTreeBounds.minX &&
        matrix.elements[12]! <= firstTreeBounds.maxX &&
        matrix.elements[14]! >= firstTreeBounds.minZ &&
        matrix.elements[14]! <= firstTreeBounds.maxZ,
      'tree instances stay within the requested cover cell',
    );
  }
}
const firstStock = root.children.find((child) => child.userData.cellId === firstId);
assert.ok(firstStock);
assert(firstStock.children.length > 1, 'detailed stock receives its decor before idle');
assert(
  !stream.buildingMeshes().some((mesh) => coversCell(mesh, secondId)),
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
// Shift the view one prefetch ring away: the first cell leaves the visible set but stays inside
// the retain ring, so its stock survives the plan change untouched.
const shifted = { minX: 15, minZ: 8, maxX: 17, maxZ: 11 };
stream.update(shifted);
assert.equal(oldDisposed, 0, 'stock inside the new retain ring survives a plan change');
assert(stream.buildingMeshes().some((mesh) => coversCell(mesh, firstId)));
assert.equal(stream.stagingBytes, 0, 'no stock job has started before a drain');
const second = { minX: 59, minZ: 8, maxX: 61, maxZ: 11 };
const residentBeforeJump = tracker.bytes();
stream.update(second);
assert.equal(oldDisposed, 0, 'stock outside the new retain ring is not evicted speculatively at the plan change');
assert(stream.buildingMeshes().some((mesh) => coversCell(mesh, firstId)), 'old coverage stays useful');
assert.equal(tracker.bytes(), residentBeforeJump, 'the plan change itself frees nothing that fits');
assert.equal(stream.staleStockBytes, oldMesh.geometry.getIndex()!.array.byteLength +
  Object.values(oldMesh.geometry.attributes).reduce((sum, a) => sum + a.array.byteLength, 0),
  'stock outside the retain ring is reported as stale');
assert.equal(evictions, 0);
let jumpFrames = 0;
do {
  stream.drain();
  assert(++jumpFrames < 10_000);
  assert.deepEqual(failures, []);
  if (diagnostics.snapshot().pendingEssentialJobs > 0)
    assert(stream.buildingMeshes().some((mesh) => coversCell(mesh, firstId)),
      'old coverage stays exposed on every frame until the destination coverage settles');
} while (diagnostics.snapshot().pendingEssentialJobs > 0);
assert.equal(oldDisposed, 1, 'stock outside the retain ring leaves when the destination settles');
assert(!stream.buildingMeshes().some((mesh) => coversCell(mesh, firstId)));
assert.equal(stream.staleStockBytes, 0);
assert(evictions > 0, 'settle-time eviction reports its picks');
assert(stream.buildingMeshes().some((mesh) => coversCell(mesh, secondId)));
assert.equal(materialDisposals, 0, 'shared building material survives cell eviction');

const overviewCamera = new THREE.OrthographicCamera();
overviewCamera.position.set(0, 100, 100);
overviewCamera.lookAt(0, 0, 0);
overviewCamera.updateMatrixWorld(true);
stream.prepareDrawRanges(overviewCamera, false);
ready({ minX: 0, minZ: 0, maxX: 80, maxZ: 20 });
assert.equal(stream.stockBuildings, 2, 'overview retains both ordinary buildings');
assert.equal(stream.buildingMeshes().length, 2, 'each owner publishes once');
assert.equal(stream.tileCoveredCells, 2, 'isolated overview cells are covered by their whole tiles');
assert.deepEqual(
  stream.buildingMeshes().map((mesh) => mesh.userData.tileId).sort(),
  ['tile:0,0', 'tile:4,0'],
);
assert(stream.buildingMeshes().some((mesh) => coversCell(mesh, firstId)));
assert(stream.buildingMeshes().some((mesh) => coversCell(mesh, secondId)));
for (const mesh of stream.buildingMeshes())
  assert(mesh.geometry.drawRange.count < mesh.geometry.index!.count,
    'visible overview coverage waits for the stock partition');
ready(first);
for (const mesh of stream.buildingMeshes())
  assert.equal(mesh.geometry.drawRange.count, Infinity, 'detailed replacement restores full geometry');
assert(
  !stream.buildingMeshes().some((mesh) => coversCell(mesh, secondId)),
  'overview residents outside hysteresis are evicted after moving close',
);
assert.equal(stream.tileCoveredCells, 0, 'the dissolved tile is released once its member is detailed');
assert.equal(stream.hiddenCells, 0);
assert(stream.buildingMeshes().some((mesh) => mesh.userData.cellId === firstId));
while (!stream.idle) stream.drain();
const replacement = root.children.find((child) => child.userData.cellId === firstId);
assert.ok(replacement);
assert(replacement.children.length > 1, 'replacement detailed stock receives its decor');
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
assert.equal(stream.residentCells, 0, 'cancellation removes cover and tree residents');
assert.equal(materialDisposals, 0);
resources.dispose();
assert.equal(materialDisposals, 1);

for (const clockStep of [0, 0.01]) {
  let clock = 0;
  const now = (): number => {
    clock += clockStep;
    return clock;
  };
  // One building per 1600m tile (14 x 6 across the world) so 84 overview requests still exceed
  // the per-drain admission cap.
  const many: CityData = {
    buildings: Array.from({ length: 84 }, (_, i) =>
      building(10 + (i % 14) * 14.5, 10 + Math.floor(i / 14) * 14.5),
    ),
    roads: [],
    parks: [],
    water: [],
  };
  const emptyCover: { value: CoverIndex | null } = { value: null };
  const emptyIndexJob = createCoverIndexJob({
    id: 'admission-index',
    generation: 0,
    essential: true,
    cityData: many,
    now: () => 0,
    onReady: (value) => {
      emptyCover.value = value;
    },
  });
  while (!emptyIndexJob.step()) {}
  assert.ok(emptyCover.value);
  const root = new THREE.Group();
  const tracker = createGeometryTracker();
  const resources = createResourcePool();
  const material = createBuildingMaterial();
  resources.retain(material);
  const diagnostics = createMapDiagnostics(1, now);
  diagnostics.selectMode('3d');
  const stream = new CityStream({
    data: many,
    cityIndex: indexCity(many, 400),
    coverIndex: emptyCover.value,
    exclusions: new Set(),
    material,
    root,
    resources,
    tracker,
    diagnostics,
    now,
    onStockDrawn: () => undefined,
    onStockEvicted: () => undefined,
    onFatal: (reason) => assert.fail(reason),
  });
  assert.equal(indexCity(many, 400).cells.size, 84, 'every building owns a distinct source cell');
  stream.update({ minX: 9, minZ: 9, maxX: 200, maxZ: 84 });
  const start = clock;
  stream.drain();
  assert(clock - start < 9, 'admission and generation share the elapsed budget');
  const owners = new Set(
    stream.buildingMeshes().map((mesh) => mesh.userData.tileId ?? mesh.userData.cellId),
  );
  assert.equal(owners.size, stream.buildingMeshes().length, 'each owner publishes one page');
  assert.equal(stream.stockBuildings, owners.size, 'one source per exposed owner');
  if (clockStep === 0) {
    assert(stream.stockBuildings > 4, 'completed batches refill within the same drain');
    assert(stream.stockBuildings <= 64, 'a constant clock still caps admissions');
  }
  assert(stream.stockBuildings < many.buildings.length);
  assert(diagnostics.snapshot().pendingEssentialJobs > 0, 'partial batches cannot settle coverage');
  let frames = 0;
  while (!stream.idle) {
    stream.drain();
    assert(++frames < 500);
  }
  assert.equal(stream.stockBuildings, many.buildings.length);
  assert.equal(stream.tileCoveredCells, 84, 'isolated overview cells stream as whole tiles');
  assert.equal(
    new Set(stream.buildingMeshes().flatMap((mesh) => mesh.userData.sourceBuildingIndices as number[])).size,
    84,
    'every source is exposed exactly once',
  );
  assert.equal(diagnostics.snapshot().pendingEssentialJobs, 0);
  stream.dispose();
  resources.dispose();
  assert.equal(root.children.length, 0);
  assert.equal(tracker.bytes(), 0);
  assert.equal(diagnostics.snapshot().queuedJobs, 0);
}
// Tile <-> cell transitions on a dense synthetic city: 16 x 8 populated 400m cells, so tiles
// (0..3, 0..1) are complete 4x4 blocks. Every frame must expose each source exactly once.
{
  const cellWorld = 400 * METERS_TO_WORLD;
  const columns = 16, rows = 8;
  const gridBuildings = columns * rows;
  // Cell (5,5) carries 40 extra buildings so its stock job spans several slices and its live
  // staging geometry is observable between frames.
  const heavyCellExtras = 40;
  const dense: CityData = {
    buildings: [
      ...Array.from({ length: gridBuildings }, (_, i) =>
        building((i % columns) * cellWorld + cellWorld / 2, Math.floor(i / columns) * cellWorld + cellWorld / 2),
      ),
      ...Array.from({ length: heavyCellExtras }, (_, k) =>
        building(5 * cellWorld + 0.3 + (k % 8) * 0.4, 5 * cellWorld + 0.3 + Math.floor(k / 8) * 0.4),
      ),
    ],
    roads: [],
    parks: [],
    water: [],
  };
  const total = dense.buildings.length;
  const columnOf = (source: number): number => (source < gridBuildings ? source % columns : 5);
  const denseIndex = indexCity(dense, 400);
  assert.equal(denseIndex.cells.size, gridBuildings, 'one populated cell per grid building');
  assert.equal(denseIndex.cells.get('5,5')!.buildingIndices.length, 1 + heavyCellExtras);
  const denseCover: { value: CoverIndex | null } = { value: null };
  const denseCoverJob = createCoverIndexJob({
    id: 'dense-index',
    generation: 0,
    essential: true,
    cityData: dense,
    now: () => 0,
    cellSizeM: coverCellM,
    onReady: (value) => {
      denseCover.value = value;
    },
  });
  while (!denseCoverJob.step()) {}
  assert.ok(denseCover.value);
  const root = new THREE.Group();
  const tracker = createGeometryTracker();
  const resources = createResourcePool();
  const material = createBuildingMaterial();
  resources.retain(material);
  let materialDisposals = 0;
  material.addEventListener('dispose', () => {
    materialDisposals++;
  });
  const diagnostics = createMapDiagnostics(1, () => 0);
  diagnostics.selectMode('3d');
  const failures: string[] = [];
  const evictedPicks: number[] = [];
  // A slowly ticking clock bounds the work per frame so intermediate transition states are observable.
  let clock = 0;
  const stream = new CityStream({
    data: dense,
    cityIndex: denseIndex,
    coverIndex: denseCover.value,
    exclusions: new Set(),
    material,
    root,
    resources,
    tracker,
    diagnostics,
    now: () => (clock += 0.05),
    onStockDrawn: () => undefined,
    onStockEvicted: (picks) => {
      for (const pick of picks) evictedPicks.push(pick.sourceIndex);
    },
    onFatal: (reason) => {
      failures.push(reason);
    },
  });
  const camera = new THREE.OrthographicCamera();
  camera.position.set(0, 100, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const tileOf = (id: CellId): string => {
    const [ix, iz] = id.split(',').map(Number);
    return `tile:${Math.floor(ix! / 4)},${Math.floor(iz! / 4)}`;
  };
  /** Visible source identities, asserting the scene shows each exactly once and picks agree. */
  const exposed = (): Set<number> => {
    const sources: number[] = [];
    for (const mesh of stream.buildingMeshes()) {
      assert.equal(mesh.parent?.parent, root, 'every exposed mesh hangs off the stream root');
      sources.push(...(mesh.userData.sourceBuildingIndices as readonly number[]));
    }
    const unique = new Set(sources);
    assert.equal(unique.size, sources.length, 'no source is exposed twice');
    assert.equal(stream.stockBuildings, sources.length, 'drawn-building count matches exposed sources');
    const picks = [...stream.picks()].map((pick) => pick.sourceIndex);
    assert.equal(new Set(picks).size, picks.length, 'no duplicate picks');
    assert.deepEqual(new Set(picks), unique, 'picks expose exactly the visible sources');
    const inRoot: number[] = [];
    for (const child of root.children) {
      const ids = child.userData.sourceBuildingIndices as readonly number[] | undefined;
      if (ids) inRoot.push(...ids);
    }
    assert.deepEqual(new Set(inRoot), unique, 'hidden replacements never reach the scene root');
    assert.equal(inRoot.length, sources.length);
    return unique;
  };
  let peakStagingBytes = 0;
  let peakCombinedBytes = 0;
  let peakResidentBytes = 0;
  const sampleBytes = (): void => {
    peakStagingBytes = Math.max(peakStagingBytes, stream.stagingBytes);
    peakResidentBytes = Math.max(peakResidentBytes, tracker.bytes());
    peakCombinedBytes = Math.max(peakCombinedBytes, tracker.bytes() + stream.stagingBytes);
  };
  const drainFrame = (): void => {
    stream.drain();
    sampleBytes();
    stream.prepareDrawRanges(camera, false);
    assert.deepEqual(failures, []);
    exposed();
  };
  const settle = (bounds: BoundsXZ, minimum: ReadonlySet<number>): void => {
    stream.update(bounds);
    let frames = 0;
    do {
      drainFrame();
      const visible = exposed();
      for (const source of minimum) assert(visible.has(source), `source ${source} stays visible`);
      assert(++frames < 20_000, 'coverage settles');
    } while (diagnostics.snapshot().pendingEssentialJobs > 0);
  };
  const idle = (): void => {
    let frames = 0;
    while (!stream.idle) {
      drainFrame();
      assert(++frames < 20_000);
    }
    assert.equal(stream.stagingBytes, 0, 'idle streams hold no staging geometry');
  };
  const detailOf = (id: CellId): string | undefined => {
    const mesh = stream.buildingMeshes().find((candidate) => candidate.userData.cellId === id);
    if (!mesh) return undefined;
    return mesh.geometry.getAttribute('normal').array instanceof Int8Array ? 'overview' : 'detailed';
  };
  const tileIds = (): string[] =>
    [...new Set(stream.buildingMeshes().map((mesh) => mesh.userData.tileId as string | undefined))]
      .filter((id): id is string => id !== undefined)
      .sort();
  const cellIds = (): CellId[] =>
    stream.buildingMeshes()
      .map((mesh) => mesh.userData.cellId as CellId | undefined)
      .filter((id): id is CellId => id !== undefined)
      .sort();

  // A: cold overview over the whole city -> eight complete tiles, no per-cell residents.
  const overview = { minX: 2 * cellWorld, minZ: 2 * cellWorld, maxX: 14 * cellWorld, maxZ: 6 * cellWorld };
  settle(overview, new Set());
  idle();
  assert.equal(stream.stockBuildings, total);
  assert.equal(stream.tileCoveredCells, gridBuildings, 'every populated cell is covered by its whole tile');
  assert.deepEqual(cellIds(), [], 'no per-cell overview residents remain beside complete tiles');
  assert.equal(tileIds().length, 8);
  assert.equal(stream.buildingMeshes().length, 8, 'one page per small tile');
  assert.equal(stream.hiddenCells, 0);
  for (const mesh of stream.buildingMeshes()) {
    assert.equal((mesh.userData.cellIds as readonly CellId[]).length, 16);
    assert.ok(mesh.geometry.getIndex()!.array instanceof Uint16Array);
  }
  const steadyOverviewBytes = tracker.bytes();
  assert(steadyOverviewBytes > 0);

  // B: zoom to neighbourhood inside tile (1,1): the tile keeps rendering until all sixteen
  // wanted replacements are staged, then one synchronous cutover swaps them in.
  const inner = {
    minX: 5 * cellWorld + 0.2,
    minZ: 5 * cellWorld + 0.2,
    maxX: 7 * cellWorld - 0.2,
    maxZ: 7 * cellWorld - 0.2,
  };
  const tileMembers = [...denseIndex.cells.values()]
    .filter((cell) => tileOf(cell.id) === 'tile:1,1')
    .map((cell) => cell.id)
    .sort();
  assert.equal(tileMembers.length, 16);
  const all = new Set(dense.buildings.map((_, i) => i));
  const tileSources = new Set(tileMembers.flatMap((id) => denseIndex.cells.get(id)!.buildingIndices));
  assert.equal(tileSources.size, 16 + heavyCellExtras);
  // Retention around the inner view keeps tiles 0..2; tile column 3 (ix 12..15) is outside the
  // retain ring: it stays resident and visible (stale) until its bytes are needed or the new
  // coverage settles, so a quick reversal finds the whole overview intact.
  const innerExposed = new Set([...all].filter((source) => columnOf(source) <= 11));
  const staleColumnBytes = stream.buildingMeshes()
    .filter((mesh) => (mesh.userData.tileId as string).startsWith('tile:3,'))
    .reduce((sum, mesh) => sum + mesh.geometry.getIndex()!.array.byteLength +
      Object.values(mesh.geometry.attributes).reduce((s, a) => s + a.array.byteLength, 0), 0);
  stream.update(inner);
  assert.deepEqual(exposed(), all, 'nothing is evicted speculatively at the plan change');
  assert.equal(tileIds().length, 8);
  assert.equal(tracker.bytes(), steadyOverviewBytes);
  assert.equal(stream.staleStockBytes, staleColumnBytes, 'the far tile column is reported stale');
  let sawHidden = false;
  let sawTileWhileHidden = false;
  let sawStaging = false;
  let frames = 0;
  let peakTransitionBytes = tracker.bytes();
  peakStagingBytes = peakCombinedBytes = 0;
  do {
    drainFrame();
    if (stream.stagingBytes > 0) sawStaging = true;
    peakTransitionBytes = Math.max(peakTransitionBytes, tracker.bytes());
    const visible = exposed();
    if (diagnostics.snapshot().pendingEssentialJobs > 0)
      assert.deepEqual(visible, all, 'every source stays visible on every frame before the new coverage settles');
    for (const source of tileSources) assert(visible.has(source), 'the tile keeps its sources visible during dissolution');
    if (stream.hiddenCells > 0) {
      sawHidden = true;
      if (tileIds().includes('tile:1,1')) sawTileWhileHidden = true;
      assert(
        !cellIds().some((id) => tileOf(id) === 'tile:1,1'),
        'members stay hidden while their tile is still exposed',
      );
    }
    assert(++frames < 20_000);
  } while (diagnostics.snapshot().pendingEssentialJobs > 0);
  assert(sawHidden, 'replacements were staged before the cutover');
  assert(sawTileWhileHidden, 'the old tile stayed exposed while replacements were hidden');
  assert.equal(stream.hiddenCells, 0, 'the cutover publishes every staged replacement');
  assert(!tileIds().includes('tile:1,1'), 'the dissolved tile is released in the cutover');
  assert.deepEqual(cellIds(), tileMembers, 'exactly the sixteen members became per-cell residents');
  assert.equal(stream.tileCoveredCells, 12 * rows - 16, 'retained tile columns 0..2 minus the dissolved tile');
  for (const id of tileMembers) {
    const [ix, iz] = id.split(',').map(Number);
    const detailed = ix! >= 5 && ix! <= 6 && iz! >= 5 && iz! <= 6;
    assert.equal(detailOf(id), detailed ? 'detailed' : 'overview', `cell ${id} carries the wanted detail`);
  }
  assert.deepEqual(exposed(), innerExposed, 'settling the new coverage releases the stale far tile column');
  assert.equal(stream.staleStockBytes, 0);
  assert(peakTransitionBytes > steadyOverviewBytes, 'staged replacements are counted while hidden');
  assert(sawStaging, 'in-flight stock jobs report live staging geometry');
  idle();
  assert.deepEqual(exposed(), innerExposed, 'membership retention evicts only the far tile column');
  const steadyInnerBytes = tracker.bytes();
  assert(peakStagingBytes > 0);
  assert(
    peakTransitionBytes <= steadyOverviewBytes + steadyInnerBytes,
    'resident bytes never exceed the old coverage plus the new steady state when both fit the budget',
  );
  console.log(JSON.stringify({ dissolve: { steadyOverviewBytes, staleColumnBytes, steadyInnerBytes, peakTransitionBytes, peakStagingBytes, peakCombinedBytes } }));
  const dissolvePeakCombinedBytes = peakCombinedBytes;

  // C: cells -> tile: zooming back out publishes the complete tile and releases the sixteen
  // cells in the same cutover, returning to the exact overview steady state.
  settle(overview, tileSources);
  idle();
  assert.deepEqual(exposed(), all);
  assert.deepEqual(cellIds(), []);
  assert.equal(tileIds().length, 8);
  assert.equal(stream.hiddenCells, 0);
  assert.equal(tracker.bytes(), steadyOverviewBytes, 'tile steady state is byte-identical after a round trip');

  // D: reversed transition: interrupt the dissolution once replacements are staged.
  stream.update(inner);
  frames = 0;
  while (stream.hiddenCells === 0) {
    drainFrame();
    assert(++frames < 20_000, 'a replacement is staged');
  }
  assert(tileIds().includes('tile:1,1'));
  assert(stream.hiddenCells < 16, 'reversal happens before the cutover');
  const beforeReversal = exposed();
  assert.deepEqual(beforeReversal, all);
  stream.update(overview);
  assert.equal(stream.hiddenCells, 0, 'unwanted staged replacements are dropped at the reversal, before any drain');
  assert.equal(stream.stagingBytes, 0, 'cancelled replacement jobs release their staging geometry');
  assert.deepEqual(exposed(), beforeReversal, 'the reversal keeps every visible source');
  assert(tileIds().includes('tile:1,1'), 'the useful tile is still exposed after the reversal');
  assert.equal(tracker.bytes(), steadyOverviewBytes, 'a reversal before the cutover is back at the overview steady state at once');
  settle(overview, all);
  assert.equal(stream.stagingBytes, 0, 'no stock is regenerated after a reversal that kept every tile');
  idle();
  assert.deepEqual(cellIds(), []);
  assert.equal(tracker.bytes(), steadyOverviewBytes, 'reversal leaks no staged bytes');

  // D2: reversal sweep, the deterministic equivalent of reversing after 30 ms or 500 ms: reverse
  // after k frames for every k from "before any allocation" past the cutover. Every frame of every
  // sweep exposes every source exactly once; a reversal before the cutover regenerates nothing.
  let cutoverFrame = -1;
  stream.update(inner);
  for (frames = 0; tileIds().includes('tile:1,1'); frames++) {
    drainFrame();
    assert(frames < 20_000, 'the cutover happens');
  }
  cutoverFrame = frames;
  assert(cutoverFrame > 1, 'the dissolution spans several frames');
  settle(overview, all);
  idle();
  assert.equal(tracker.bytes(), steadyOverviewBytes);
  let lossless = 0;
  for (let k = 0; k <= cutoverFrame + 2; k++) {
    stream.update(inner);
    let settled = false;
    for (let i = 0; i < k; i++) {
      drainFrame();
      settled = diagnostics.snapshot().pendingEssentialJobs === 0;
      // The stale far column leaves only in the frame that settles the inner coverage.
      assert.deepEqual(exposed(), settled ? innerExposed : all, `sweep ${k}: frame ${i} keeps every useful source visible`);
    }
    const stagedBeforeReversal = stream.hiddenCells;
    const tileStillExposed = tileIds().includes('tile:1,1');
    const kept = exposed();
    stream.update(overview);
    assert.equal(stream.hiddenCells, 0, `sweep ${k}: staged replacements are dropped at the reversal`);
    assert.equal(stream.stagingBytes, 0, `sweep ${k}: in-flight jobs release staging at the reversal`);
    assert.deepEqual(exposed(), kept, `sweep ${k}: the reversal loses no visible source`);
    if (tileStillExposed) {
      lossless++;
      assert.equal(tracker.bytes(), steadyOverviewBytes, `sweep ${k}: reversal before the cutover is byte-identical`);
      stream.drain();
      assert.equal(stream.stagingBytes, 0, `sweep ${k}: nothing is regenerated`);
    } else {
      assert.deepEqual(cellIds(), tileMembers, `sweep ${k}: the sixteen members cover the tile after the cutover`);
      assert(stagedBeforeReversal === 0);
    }
    settle(overview, kept);
    idle();
    assert.deepEqual(cellIds(), [], `sweep ${k}: the round trip ends on whole tiles`);
    assert.equal(tracker.bytes(), steadyOverviewBytes, `sweep ${k}: the round trip is byte-identical`);
  }
  assert(lossless >= cutoverFrame, 'every reversal before the cutover was lossless');
  console.log(JSON.stringify({ reversalSweep: { cutoverFrame, sweeps: cutoverFrame + 3, lossless } }));

  // E: interrupted cells -> tile: cancel the tile job mid-flight and keep the useful cells.
  settle(inner, tileSources);
  idle();
  assert.deepEqual(cellIds(), tileMembers);
  assert.deepEqual(exposed(), innerExposed);
  assert.equal(tracker.bytes(), steadyInnerBytes);
  stream.update(overview);
  assert.deepEqual(exposed(), innerExposed, 'zooming out evicts nothing: every inner resident is inside the overview retain ring');
  assert.equal(tracker.bytes(), steadyInnerBytes);
  peakStagingBytes = peakCombinedBytes = 0;
  frames = 0;
  while (stream.stagingBytes === 0) {
    drainFrame();
    assert(++frames < 20_000, 'the tile job starts staging');
  }
  assert.deepEqual(exposed(), innerExposed, 'nothing useful is dropped before the tile is ready');
  assert(!tileIds().includes('tile:1,1'), 'the tile job is still in flight');
  assert(diagnostics.snapshot().pendingEssentialJobs > 0);
  stream.update(inner);
  assert.equal(stream.stagingBytes, 0, 'the interrupted tile job releases its staging geometry at the plan change');
  assert.deepEqual(exposed(), innerExposed, 'the interruption keeps every useful cell');
  assert.equal(tracker.bytes(), steadyInnerBytes, 'the interruption evicts nothing inside the retain ring');
  settle(inner, tileSources);
  idle();
  assert.deepEqual(cellIds(), tileMembers, 'cancelled tile publication leaves the cells untouched');
  assert(!tileIds().includes('tile:1,1'));
  assert.equal(tracker.bytes(), steadyInnerBytes);

  // E2: complete the cells -> tile cutover: residents never exceed the old steady state plus the
  // complete tile (published before the cells leave), and staging is fully released once idle.
  peakStagingBytes = peakCombinedBytes = peakResidentBytes = 0;
  settle(overview, tileSources);
  idle();
  assert.equal(tracker.bytes(), steadyOverviewBytes);
  assert(peakStagingBytes > 0);
  assert(
    peakResidentBytes <= steadyInnerBytes + steadyOverviewBytes,
    'cells -> tile keeps residents within the old steady state plus the complete tile',
  );
  assert(peakCombinedBytes <= peakResidentBytes + peakStagingBytes);
  const mergePeakCombinedBytes = peakCombinedBytes;

  // F: distant search during a dissolution: staged replacements for cells nobody wants are
  // dropped, the abandoned tile is evicted by membership retention, nothing stale is revealed.
  settle(overview, tileSources);
  idle();
  stream.update(inner);
  frames = 0;
  while (stream.hiddenCells === 0) {
    drainFrame();
    assert(++frames < 20_000);
  }
  const far = {
    minX: 13 * cellWorld + 0.2,
    minZ: 1 * cellWorld + 0.2,
    maxX: 15 * cellWorld - 0.2,
    maxZ: 3 * cellWorld - 0.2,
  };
  const farVisible = new Set<number>();
  for (const cell of denseIndex.cells.values()) {
    const [ix, iz] = cell.id.split(',').map(Number);
    if (ix! >= 12 && iz! <= 3) for (const source of cell.buildingIndices) farVisible.add(source);
  }
  stream.update(far);
  assert.equal(stream.hiddenCells, 0, 'a distant search drops staged replacements at the plan change');
  assert.equal(stream.stagingBytes, 0, 'a distant search cancels in-flight staging at the plan change');
  assert.deepEqual(exposed(), all, 'the abandoned dissolving tile and the far tiles stay exposed as useful context');
  assert.equal(tileIds().length, 8);
  // Tile column 3 is still resident, so the search dissolves tile 3,0 in place instead of rebuilding it.
  frames = 0;
  do {
    drainFrame();
    if (diagnostics.snapshot().pendingEssentialJobs > 0)
      assert.deepEqual(exposed(), all, 'every source stays visible until the search coverage settles');
    assert(++frames < 20_000);
  } while (diagnostics.snapshot().pendingEssentialJobs > 0);
  idle();
  assert.equal(stream.hiddenCells, 0, 'no staged replacement survives a distant search');
  assert(!tileIds().includes('tile:1,1'), 'the abandoned dissolving tile is evicted by retention at settle');
  assert(!cellIds().some((id) => tileOf(id) === 'tile:1,1'), 'no stale member is revealed');
  assert.deepEqual(tileIds(), ['tile:2,0', 'tile:2,1', 'tile:3,1'], 'tiles inside the search retain ring stay; tile 3,0 dissolved into its members');
  for (const source of farVisible) assert(exposed().has(source));
  assert(cellIds().length > 0);
  for (const id of cellIds()) {
    const [ix, iz] = id.split(',').map(Number);
    assert(ix! >= 12 && iz! <= 3, `per-cell resident ${id} is a member of the dissolved search tile`);
    const detailed = ix! >= 13 && ix! <= 14 && iz! >= 1 && iz! <= 2;
    assert.equal(detailOf(id), detailed ? 'detailed' : 'overview', `member ${id} carries the wanted detail`);
  }
  const evictedSet = new Set(evictedPicks);
  for (const id of tileMembers) assert(evictedSet.has(denseIndex.cells.get(id)!.buildingIndices[0]!), 'evicted picks are reported for every released member');

  // Final cleanup: exactly-once disposal, no shared material disposal by any page owner.
  stream.dispose();
  stream.dispose();
  assert.equal(root.children.length, 0);
  assert.equal(tracker.bytes(), 0);
  assert.equal(stream.stockBuildings, 0);
  assert.equal(stream.hiddenCells, 0);
  assert.equal(stream.tileCoveredCells, 0);
  assert.equal(diagnostics.snapshot().queuedJobs, 0);
  assert.equal(materialDisposals, 0);
  resources.dispose();
  assert.equal(materialDisposals, 1);
  console.log(
    JSON.stringify({
      tileTransition: {
        steadyOverviewBytes,
        staleColumnBytes,
        steadyInnerBytes,
        peakTransitionBytes,
        dissolvePeakCombinedBytes,
        mergePeakCombinedBytes,
      },
    }),
  );
}
// Budget pressure: the same 16 x 8 grid with six buildings per cell, streamed under a resident
// budget lowered (never raised) so that the old overview plus the new neighbourhood cannot fit.
// Stale residents must yield on demand, farthest first, before any retained one; visible coverage
// is never evicted; `tracker + stock staging + draw-range scratch cap <= maxBytes` at every sample.
{
  const cellWorld = 400 * METERS_TO_WORLD;
  const columns = 16, rows = 8, perCell = 6;
  const heavy: CityData = {
    buildings: Array.from({ length: columns * rows * perCell }, (_, i) => {
      const cell = Math.floor(i / perCell), k = i % perCell;
      return building(
        (cell % columns) * cellWorld + 0.3 + (k % 3) * 0.4,
        Math.floor(cell / columns) * cellWorld + 0.3 + Math.floor(k / 3) * 0.4,
      );
    }),
    roads: [],
    parks: [],
    water: [],
  };
  const heavyIndex = indexCity(heavy, 400);
  assert.equal(heavyIndex.cells.size, columns * rows);
  const heavyCover: { value: CoverIndex | null } = { value: null };
  const heavyCoverJob = createCoverIndexJob({
    id: 'heavy-index', generation: 0, essential: true, cityData: heavy, now: () => 0,
    cellSizeM: coverCellM, onReady: (value) => { heavyCover.value = value; },
  });
  while (!heavyCoverJob.step()) {}
  assert.ok(heavyCover.value);
  const all = new Set(heavy.buildings.map((_, i) => i));
  const tileOf = (id: CellId): string => {
    const [ix, iz] = id.split(',').map(Number);
    return `tile:${Math.floor(ix! / 4)},${Math.floor(iz! / 4)}`;
  };
  const sourcesOfTile = (tileId: string): Set<number> =>
    new Set([...heavyIndex.cells.values()].filter((cell) => tileOf(cell.id) === tileId).flatMap((cell) => cell.buildingIndices));
  const geometryBytesOf = (mesh: THREE.Mesh): number =>
    mesh.geometry.getIndex()!.array.byteLength +
    Object.values(mesh.geometry.attributes).reduce((sum, a) => sum + a.array.byteLength, 0);
  const overview = { minX: 2 * cellWorld, minZ: 2 * cellWorld, maxX: 14 * cellWorld, maxZ: 6 * cellWorld };
  const inner = { minX: 5 * cellWorld + 0.2, minZ: 5 * cellWorld + 0.2, maxX: 7 * cellWorld - 0.2, maxZ: 7 * cellWorld - 0.2 };
  const camera = new THREE.OrthographicCamera();
  camera.position.set(0, 100, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  type Harness = {
    stream: CityStream; tracker: ReturnType<typeof createGeometryTracker>; root: THREE.Group;
    resources: ReturnType<typeof createResourcePool>; diagnostics: ReturnType<typeof createMapDiagnostics>;
    failures: string[]; evictions: number[][]; frame(): void; exposed(): Set<number>; tileIds(): string[]; cellIds(): CellId[];
    settle(bounds: BoundsXZ, minimum: ReadonlySet<number>): void; idle(): void; peakHeld(): number; resetPeak(): void;
  };
  const harness = (budget?: { maxBytes: number; backgroundBytes: number }): Harness => {
    const root = new THREE.Group();
    const tracker = createGeometryTracker();
    const resources = createResourcePool();
    const material = createBuildingMaterial();
    resources.retain(material);
    const failures: string[] = [];
    const evictions: number[][] = [];
    let clock = 0;
    let peak = 0;
    let live: CityStream | null = null;
    // Sampled on every clock read, i.e. between job slices and inside drain loops.
    const now = (): number => {
      if (live) peak = Math.max(peak, tracker.bytes() + live.stagingBytes);
      return (clock += 0.05);
    };
    const diagnostics = createMapDiagnostics(1, now);
    diagnostics.selectMode('3d');
    const stream = new CityStream({
      data: heavy, cityIndex: heavyIndex, coverIndex: heavyCover.value!, exclusions: new Set(),
      material, root, resources, tracker, diagnostics, now,
      ...(budget ? { residentBudget: budget } : {}),
      onStockDrawn: () => undefined,
      onStockEvicted: (picks) => { evictions.push(picks.map((pick) => pick.sourceIndex)); },
      onFatal: (reason) => { failures.push(reason); },
    });
    live = stream;
    const exposed = (): Set<number> => {
      const sources = stream.buildingMeshes().flatMap((mesh) => mesh.userData.sourceBuildingIndices as readonly number[]);
      const unique = new Set(sources);
      assert.equal(unique.size, sources.length, 'no source is exposed twice');
      assert.equal(stream.stockBuildings, sources.length);
      const picks = [...stream.picks()].map((pick) => pick.sourceIndex);
      assert.deepEqual(new Set(picks), unique, 'picks expose exactly the visible sources');
      return unique;
    };
    const frame = (): void => {
      stream.drain();
      now();
      stream.prepareDrawRanges(camera, false);
      exposed();
    };
    const settle = (bounds: BoundsXZ, minimum: ReadonlySet<number>): void => {
      stream.update(bounds);
      let frames = 0;
      do {
        frame();
        const visible = exposed();
        for (const source of minimum) assert(visible.has(source), `source ${source} stays visible`);
        assert(++frames < 50_000, 'coverage settles');
      } while (diagnostics.snapshot().pendingEssentialJobs > 0 && failures.length === 0);
    };
    const idle = (): void => {
      let frames = 0;
      while (!stream.idle && failures.length === 0) {
        frame();
        assert(++frames < 50_000);
      }
    };
    return {
      stream, tracker, root, resources, diagnostics, failures, evictions, frame, exposed, settle, idle,
      tileIds: () => [...new Set(stream.buildingMeshes().map((mesh) => mesh.userData.tileId as string | undefined))].filter((id): id is string => id !== undefined).sort(),
      cellIds: () => stream.buildingMeshes().map((mesh) => mesh.userData.cellId as CellId | undefined).filter((id): id is CellId => id !== undefined).sort(),
      peakHeld: () => peak,
      resetPeak: () => { peak = 0; },
    };
  };
  const RESERVE = 256 * 1024; // StockDrawRanges MAX_INDEX_BYTES: the scratch cap reserved by the stream.

  // Reference run under the product budget: measure the steady states and the per-tile bytes.
  const reference = harness();
  reference.settle(overview, new Set());
  reference.idle();
  assert.deepEqual(reference.failures, []);
  assert.deepEqual(reference.exposed(), all);
  assert.equal(reference.tileIds().length, 8);
  const steadyOverviewBytes = reference.tracker.bytes();
  const tileBytes = new Map<string, number>();
  for (const mesh of reference.stream.buildingMeshes())
    tileBytes.set(mesh.userData.tileId as string, (tileBytes.get(mesh.userData.tileId as string) ?? 0) + geometryBytesOf(mesh));
  assert.equal([...tileBytes.values()].reduce((a, b) => a + b, 0), steadyOverviewBytes);
  reference.stream.update(inner);
  assert.equal(reference.stream.staleStockBytes, tileBytes.get('tile:3,0')! + tileBytes.get('tile:3,1')!);
  let cutoverTracker = -1, cutoverStale = -1;
  for (let frames = 0; reference.tileIds().includes('tile:1,1'); frames++) {
    reference.frame();
    assert(frames < 50_000);
  }
  cutoverTracker = reference.tracker.bytes();
  cutoverStale = reference.stream.staleStockBytes;
  assert.equal(cutoverStale, tileBytes.get('tile:3,0')! + tileBytes.get('tile:3,1')!, 'nothing stale was evicted under the product budget');
  while (reference.diagnostics.snapshot().pendingEssentialJobs > 0) reference.frame();
  reference.idle();
  assert.deepEqual(reference.failures, []);
  const steadyInnerBytes = reference.tracker.bytes();
  const referencePeak = reference.peakHeld();
  const innerCells = [...heavyIndex.cells.values()].filter((cell) => tileOf(cell.id) === 'tile:1,1').map((cell) => cell.id).sort();
  const decorated = (h: Harness): CellId[] =>
    h.root.children.filter((child) => child.userData.cellId !== undefined && child.children.length > 1).map((child) => child.userData.cellId as CellId).sort();
  const referenceDecor = decorated(reference);
  assert(referenceDecor.length > 0, 'detailed cells receive decor under the product budget');
  // The return leg: the detailed cells stay visible until their tile lands, so the merge tile's
  // staging is held on top of them. Its peak is the least a ceiling must admit for the round trip.
  reference.resetPeak();
  reference.settle(overview, reference.exposed());
  reference.idle();
  assert.deepEqual(reference.failures, []);
  assert.equal(reference.tracker.bytes(), steadyOverviewBytes);
  const referenceReturnPeak = reference.peakHeld();
  reference.stream.dispose();
  reference.resources.dispose();
  assert(referencePeak > steadyOverviewBytes + tileBytes.get('tile:3,0')!, 'the reference transition holds more than the overview plus one tile');

  // Pressure run: the ceiling admits the overview alone (and the settled round trip) but not the
  // overview plus the whole transition.
  const maxBytes = RESERVE + Math.max(steadyOverviewBytes + Math.floor((referencePeak - steadyOverviewBytes) / 2), referenceReturnPeak);
  assert(maxBytes - RESERVE < referencePeak, 'the lowered ceiling forces eviction during the transition');
  // Background gate between the retained bytes and the total bytes at the cutover: the old
  // `tracker >= background` gate would have skipped every decor job, the stale-excluding one admits them.
  const backgroundBytes = cutoverTracker;
  assert(cutoverTracker - cutoverStale < backgroundBytes && backgroundBytes <= maxBytes);
  const pressured = harness({ maxBytes, backgroundBytes });
  pressured.settle(overview, new Set());
  pressured.idle();
  assert.deepEqual(pressured.failures, []);
  assert.deepEqual(pressured.exposed(), all, 'the overview fits the lowered ceiling');
  assert.equal(pressured.tracker.bytes(), steadyOverviewBytes);
  assert(pressured.peakHeld() + RESERVE <= maxBytes);
  pressured.resetPeak();
  pressured.stream.update(inner);
  assert.deepEqual(pressured.exposed(), all, 'no speculative eviction at the plan change');
  assert.equal(pressured.tracker.bytes(), steadyOverviewBytes);
  const innerSources = sourcesOfTile('tile:1,1');
  const retainedTiles = ['tile:0,0', 'tile:0,1', 'tile:1,0', 'tile:2,0', 'tile:2,1'];
  /** Owner tile of each eviction callback so far, in callback order (the tile 1,1 cutover excluded). */
  const cellOfSource = new Map<number, CellId>();
  for (const cell of heavyIndex.cells.values()) for (const source of cell.buildingIndices) cellOfSource.set(source, cell.id);
  const evictionOrder = (): string[] =>
    pressured.evictions
      .map((sources) => tileOf(cellOfSource.get(sources[0]!)!))
      .filter((tileId) => tileId !== 'tile:1,1');
  assert.equal(pressured.evictions.length, 0);
  let firstEvictionFrame = -1;
  let frames = 0;
  do {
    const before = pressured.evictions.length;
    pressured.frame();
    assert.deepEqual(pressured.failures, []);
    assert(pressured.peakHeld() + RESERVE <= maxBytes, `held ${pressured.peakHeld()} + reserve stays under ${maxBytes}`);
    const visible = pressured.exposed();
    for (const source of innerSources) assert(visible.has(source), 'visible coverage is never evicted for room');
    if (pressured.evictions.length > before && firstEvictionFrame < 0) firstEvictionFrame = frames;
    assert(++frames < 50_000);
  } while (pressured.diagnostics.snapshot().pendingEssentialJobs > 0);
  const order = evictionOrder();
  assert(firstEvictionFrame >= 0 && order.length > 0, 'the lowered ceiling forced on-demand eviction during the transition');
  assert.deepEqual(order.slice(0, 2), ['tile:3,0', 'tile:3,1'], `stale tiles yield first, farthest first (${order.join(' ')})`);
  for (const tileId of order.slice(2)) assert(retainedTiles.includes(tileId), `${tileId} is a retained, non-visible tile`);
  const settledVisible = pressured.exposed();
  for (const id of innerCells) assert(pressured.cellIds().includes(id));
  pressured.idle();
  assert.deepEqual(pressured.failures, []);
  assert(pressured.peakHeld() + RESERVE <= maxBytes);
  assert(pressured.tracker.bytes() + RESERVE <= maxBytes);
  assert.deepEqual(decorated(pressured), referenceDecor, 'stale bytes do not gate decor for the detailed cells');
  assert.equal(pressured.diagnostics.snapshot().errorCount, 0, 'room pressure is never reported as a map error');
  assert(!pressured.tileIds().some((id) => id.startsWith('tile:3,')), 'stale tiles are gone once the coverage settles');
  const pressurePeak = pressured.peakHeld();

  // Reversal right after the first on-demand eviction: nothing else is lost, the round trip is exact.
  pressured.settle(overview, settledVisible);
  pressured.idle();
  assert.deepEqual(pressured.failures, []);
  assert.deepEqual(pressured.exposed(), all, 'the settled round trip restores the whole overview');
  assert.equal(pressured.tracker.bytes(), steadyOverviewBytes, 'the reversed overview is byte-identical');
  pressured.stream.update(inner);
  let reversalFrames = 0;
  while (pressured.tileIds().length === 8) {
    pressured.frame();
    assert(++reversalFrames < 50_000);
  }
  assert(pressured.tileIds().includes('tile:1,1'), 'the reversal happens before the cutover');
  const keptAtReversal = pressured.exposed();
  assert(keptAtReversal.size < all.size && keptAtReversal.size > innerSources.size);
  pressured.stream.update(overview);
  assert.equal(pressured.stream.hiddenCells, 0);
  assert.equal(pressured.stream.stagingBytes, 0);
  assert.deepEqual(pressured.exposed(), keptAtReversal, 'the reversal itself loses nothing');
  pressured.settle(overview, keptAtReversal);
  pressured.idle();
  assert.deepEqual(pressured.exposed(), all, 'only the evicted tiles are regenerated');
  assert.equal(pressured.tracker.bytes(), steadyOverviewBytes);
  assert.deepEqual(pressured.failures, []);
  pressured.stream.dispose();
  assert.equal(pressured.tracker.bytes(), 0);
  assert.equal(pressured.root.children.length, 0);
  pressured.resources.dispose();

  // Too small for the visible overview: the essential job is refused and reported, never over-allocated.
  const starved = harness({ maxBytes: RESERVE + Math.floor(steadyOverviewBytes / 2), backgroundBytes: RESERVE + 1 });
  starved.stream.update(overview);
  frames = 0;
  while (starved.failures.length === 0) {
    starved.frame();
    assert(starved.peakHeld() + RESERVE <= RESERVE + Math.floor(steadyOverviewBytes / 2), 'a refused allocation never crosses the ceiling');
    assert(++frames < 50_000, 'the starved stream reports the refused essential job');
  }
  assert(starved.failures[0]!.startsWith('stream:'), starved.failures[0]);
  starved.stream.dispose();
  assert.equal(starved.tracker.bytes(), 0);
  assert.equal(starved.stream.stagingBytes, 0);
  assert.equal(starved.root.children.length, 0);
  starved.resources.dispose();
  assert.throws(() => harness({ maxBytes: 128 * 1024 * 1024 + 1, backgroundBytes: 1 }), RangeError, 'the ceiling can only be lowered');
  // Prefetch refused for room: with the ceiling just above the visible neighbourhood, background
  // stock jobs cannot all fit. They are deferred quietly, never reported as map errors.
  const roomy = harness();
  roomy.settle(inner, new Set());
  roomy.idle();
  const innerFromScratchBytes = roomy.tracker.bytes();
  roomy.stream.dispose();
  roomy.resources.dispose();
  const tightBytes = RESERVE + Math.floor(steadyInnerBytes * 0.6);
  const tight = harness({ maxBytes: tightBytes, backgroundBytes: tightBytes });
  tight.settle(inner, new Set());
  tight.idle();
  assert.deepEqual(tight.failures, []);
  assert(tight.tracker.bytes() < innerFromScratchBytes, 'the tight ceiling refused some prefetch stock');
  assert(tight.peakHeld() + RESERVE <= tightBytes);
  assert.equal(tight.stream.stagingBytes, 0, 'refused jobs release their staging');
  assert.equal(tight.diagnostics.snapshot().errorCount, 0, 'refused prefetch is deferred, not a map error');
  assert.notEqual(tight.diagnostics.snapshot().state, 'degraded');
  tight.stream.dispose();
  tight.resources.dispose();
  console.log(JSON.stringify({ budgetPressure: { steadyOverviewBytes, steadyInnerBytes, referencePeak, referenceReturnPeak, maxBytes, backgroundBytes, pressurePeak, evictionOrder: order, firstEvictionFrame } }));
}
for (const direction of ['cell-to-tile', 'tile-to-cell']) {
  const cellWorld = 400 * METERS_TO_WORLD;
  const dense: CityData = {
    buildings: Array.from({ length: 16 }, (_, i) =>
      building((i % 4 + 0.5) * cellWorld, (Math.floor(i / 4) + 0.5) * cellWorld),
    ),
    roads: [],
    parks: [],
    water: [],
  };
  const cover: { value: CoverIndex | null } = { value: null };
  const indexJob = createCoverIndexJob({
    id: 'callback-index', generation: 0, essential: true, cityData: dense,
    cellSizeM: coverCellM, now: () => 0, onReady: (value) => { cover.value = value; },
  });
  while (!indexJob.step()) {}
  assert.ok(cover.value);
  const root = new THREE.Group();
  const tracker = createGeometryTracker();
  const resources = createResourcePool();
  const material = createBuildingMaterial();
  resources.retain(material);
  const diagnostics = createMapDiagnostics(1, () => 0);
  let throwing = false;
  let notifications = 0;
  const failures: string[] = [];
  const stream = new CityStream({
    data: dense, cityIndex: indexCity(dense, 400), coverIndex: cover.value,
    exclusions: new Set(), material, root, resources, tracker, diagnostics,
    now: () => 0, onStockDrawn: () => undefined,
    onStockEvicted: () => {
      if (throwing) {
        notifications++;
        throw new Error('host eviction failure');
      }
    },
    onFatal: (reason) => { failures.push(reason); },
  });
  const overview = { minX: 0, minZ: 0, maxX: 200, maxZ: 200 };
  const near = { minX: cellWorld, minZ: cellWorld, maxX: 2 * cellWorld, maxZ: 2 * cellWorld };
  stream.update(direction === 'cell-to-tile' ? near : overview);
  let frames = 0;
  while (!stream.idle) {
    stream.drain();
    assert(++frames < 10_000);
  }
  assert.deepEqual(failures, []);
  const oldMeshes = stream.buildingMeshes();
  const oldGroups = new Set(oldMeshes.map((mesh) => mesh.parent!));
  assert(oldGroups.size > 0);
  assert.equal(stream.tileCoveredCells > 0, direction === 'tile-to-cell');
  const disposals = new Map(oldMeshes.map((mesh) => [mesh.geometry, 0]));
  for (const geometry of disposals.keys())
    geometry.addEventListener('dispose', () => disposals.set(geometry, disposals.get(geometry)! + 1));
  throwing = true;
  stream.update(direction === 'cell-to-tile' ? overview : near);
  frames = 0;
  while (failures.length === 0) {
    stream.drain();
    assert(++frames < 10_000, `${direction} reports the host callback failure`);
  }
  assert(notifications > 0);
  for (const group of oldGroups)
    assert.equal(group.parent, null, `${direction} detaches evicted groups even when the host throws`);
  for (const count of disposals.values()) assert.equal(count, 1);
  assert.throws(() => stream.dispose(), /City stream disposal failed/);
  stream.dispose();
  assert.equal(root.children.length, 0);
  assert.equal(tracker.bytes(), 0);
  assert.equal(stream.stagingBytes, 0);
  assert.equal(stream.stockBuildings, 0);
  for (const count of disposals.values()) assert.equal(count, 1);
  resources.dispose();
}
console.log('Camera streaming, replacement, queue bounds, overview and eviction passed');
