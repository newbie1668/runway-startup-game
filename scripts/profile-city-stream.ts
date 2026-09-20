import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { project, WORLD } from '../lib/game/geo';
import { createMapDiagnostics } from '../lib/game/mapDiagnostics';
import { createBuildScheduler } from '../lib/game/render3d/buildScheduler';
import { CameraRig } from '../lib/game/render3d/cameraRig';
import { createBuildingMaterial } from '../lib/game/render3d/cityBuilder';
import { indexCity } from '../lib/game/render3d/cityIndex';
import { CityStream } from '../lib/game/render3d/cityStream';
import { createCoverIndexJob, type CoverIndex } from '../lib/game/render3d/coverIndex';
import { createGeometryTracker } from '../lib/game/render3d/diagnostics';
import { decodeCity } from '../lib/game/render3d/format';
import { createResourcePool } from '../lib/game/render3d/sceneResources';
import { cameraGroundBounds } from '../lib/game/render3d/streamCoverage';

const binary = readFileSync('public/map/london-city.bin');
const started = performance.now();
const data = decodeCity(
  binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
);
const decodedMs = performance.now() - started;
const stockStarted = performance.now();
const cityIndex = indexCity(data, 400);
const stockIndexMs = performance.now() - stockStarted;
const coverCellArg = process.argv.find((arg) => arg.startsWith('--cover-cell='));
const coverCellSizeM = coverCellArg ? Number(coverCellArg.slice('--cover-cell='.length)) : 400;
const indexed: { value: CoverIndex | null } = { value: null };
const indexScheduler = createBuildScheduler();
indexScheduler.enqueue(
  createCoverIndexJob({
    id: 'index',
    generation: 0,
    essential: true,
    cityData: data,
    cellSizeM: coverCellSizeM,
    now: () => performance.now(),
    onReady: (value) => {
      indexed.value = value;
    },
  }),
);
let indexFrames = 0;
let maxIndexSliceMs = 0;
while (!indexed.value) {
  const before = performance.now();
  const result = indexScheduler.drain(4, () => performance.now());
  maxIndexSliceMs = Math.max(maxIndexSliceMs, performance.now() - before);
  if (result.failed.length) throw result.failed[0]!.error;
  if (++indexFrames > 100_000) throw new Error('Cover index did not settle');
}
const resources = createResourcePool();
const tracker = createGeometryTracker();
const material = createBuildingMaterial();
resources.retain(material);
const diagnostics = createMapDiagnostics(1, () => performance.now());
diagnostics.selectMode('3d');
const root = new THREE.Group();
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
  now: () => performance.now(),
  onStockDrawn: () => undefined,
  onStockEvicted: () => undefined,
  onFatal: (reason) => {
    throw new Error(reason);
  },
});
const rig = new CameraRig();
rig.setViewport(1440, 900);
const overview = process.argv.includes('--overview');
const drawRanges = process.argv.includes('--draw-ranges');
const cameraArg = process.argv.find((arg) => arg.startsWith('--camera='));
const camera = cameraArg?.slice('--camera='.length).split(',').map(Number);
if (camera && (camera.length !== 4 || !camera.every(Number.isFinite) || camera[2]! <= 0))
  throw new RangeError('--camera requires finite x,y,positive zoom,azimuth');
const center = overview ? { x: WORLD.width / 2, y: WORLD.height / 2 } : project([-0.1358, 51.5196]);
rig.update(
  camera
    ? { x: camera[0]!, y: camera[1]!, zoom: camera[2]! }
    : { ...center, zoom: overview ? 1440 / (WORLD.width * 1.1) : 900 / 1.92 },
  camera ? camera[3]! : overview ? 0 : 0.6,
);
stream.update(cameraGroundBounds(rig, 1440, 900));
let frames = 0;
let firstCoverageFrame: number | null = null;
let maxSliceMs = 0;
let peakBytes = 0;
let lastJobId = '';
const frameLimit = process.argv.includes('--sample') ? 2500 : 100_000;
const streamStarted = performance.now();
while (!stream.idle) {
  const before = performance.now();
  if (drawRanges) stream.prepareDrawRanges(rig.camera, false);
  stream.drain();
  maxSliceMs = Math.max(maxSliceMs, performance.now() - before);
  peakBytes = Math.max(peakBytes, tracker.bytes());
  frames++;
  const lastJob = diagnostics.snapshot().lastJob;
  if (lastJob && lastJob.id !== lastJobId) {
    lastJobId = lastJob.id;
    console.log(
      JSON.stringify({ ...lastJob, frame: frames, geometryMiB: tracker.bytes() / 1024 / 1024 }),
    );
  }
  if (firstCoverageFrame === null && diagnostics.snapshot().pendingEssentialJobs === 0) {
    firstCoverageFrame = frames;
    console.log(
      JSON.stringify({
        stage: 'visible',
        frames,
        elapsedMs: performance.now() - streamStarted,
        buildings: stream.stockBuildings,
        residentCells: stream.residentCells,
        geometryMiB: tracker.bytes() / 1024 / 1024,
      }),
    );
  }
  if (frames > frameLimit) break;
}
const elapsedMs = performance.now() - started;
root.updateMatrixWorld(true);
const frustum = new THREE.Frustum().setFromProjectionMatrix(
  new THREE.Matrix4().multiplyMatrices(rig.camera.projectionMatrix, rig.camera.matrixWorldInverse),
);
const cpuDrawEstimate = {
  stock: { calls: 0, triangles: 0 },
  cover: { calls: 0, triangles: 0 },
  trees: { calls: 0, triangles: 0 },
};
for (const group of root.children) {
  group.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.frustumCulled && !frustum.intersectsObject(object)) return;
    const available = object.geometry.index?.count ?? object.geometry.getAttribute('position').count;
    const count = Math.max(0, Math.min(
      available - object.geometry.drawRange.start,
      object.geometry.drawRange.count,
    ));
    if (count === 0) return;
    const layer = group.userData.cellId
      ? cpuDrawEstimate.stock
      : object instanceof THREE.InstancedMesh
        ? cpuDrawEstimate.trees
        : cpuDrawEstimate.cover;
    layer.calls += Array.isArray(object.material) ? object.geometry.groups.length : 1;
    layer.triangles +=
      (count / 3) *
      (object instanceof THREE.InstancedMesh ? object.count : 1);
  });
}
let stockGuardMeanMs: number | null = null;
if (drawRanges) {
  const guardStarted = performance.now();
  for (let i = 0; i < 120; i++) stream.prepareDrawRanges(rig.camera, false);
  stockGuardMeanMs = (performance.now() - guardStarted) / 120;
}
console.log(
  JSON.stringify(
    {
      mode: camera ? 'custom' : overview ? 'overview' : 'Fitzrovia',
      coverCellSizeM,
      drawRanges,
      stockGuardMeanMs,
      decodedMs,
      stockIndexMs,
      indexFrames,
      maxIndexSliceMs,
      frames,
      firstCoverageFrame,
      maxSliceMs,
      elapsedMs,
      geometryMiB: tracker.bytes() / 1024 / 1024,
      peakGeometryMiB: peakBytes / 1024 / 1024,
      buildings: stream.stockBuildings,
      residentCells: stream.residentCells,
      cpuDrawEstimate,
      note: 'CPU-only, excludes landmarks, GPU upload/rendering, frame waits and browser readiness',
    },
    null,
    2,
  ),
);
stream.dispose();
resources.dispose();
if (tracker.bytes() !== 0) throw new Error('Geometry ownership leaked after disposal');
