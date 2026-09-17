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
const indexed: { value: CoverIndex | null } = { value: null };
const indexScheduler = createBuildScheduler();
indexScheduler.enqueue(
  createCoverIndexJob({
    id: 'index',
    generation: 0,
    essential: true,
    cityData: data,
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
const center = overview ? { x: WORLD.width / 2, y: WORLD.height / 2 } : project([-0.1358, 51.5196]);
rig.update(
  { ...center, zoom: overview ? 1440 / (WORLD.width * 1.1) : 900 / 1.92 },
  overview ? 0 : 0.6,
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
console.log(
  JSON.stringify(
    {
      mode: overview ? 'overview' : 'Fitzrovia',
      decodedMs,
      stockIndexMs,
      indexFrames,
      maxIndexSliceMs,
      frames,
      firstCoverageFrame,
      maxSliceMs,
      elapsedMs: performance.now() - started,
      geometryMiB: tracker.bytes() / 1024 / 1024,
      peakGeometryMiB: peakBytes / 1024 / 1024,
      buildings: stream.stockBuildings,
      residentCells: stream.residentCells,
      note: 'CPU-only, excludes landmarks, GPU upload/rendering, frame waits and browser readiness',
    },
    null,
    2,
  ),
);
stream.dispose();
resources.dispose();
if (tracker.bytes() !== 0) throw new Error('Geometry ownership leaked after disposal');
