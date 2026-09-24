// CPU-only replay of a gradual (mouse-wheel) zoom on the committed London data: settle the whole-city
// overview, zoom in by 1.47x per step (one wheel notch), then back out, draining once per step.
// Prints drawn buildings, resident MiB and stale MiB per step, and the floor of drawn buildings.
// Usage: pnpm exec tsx scripts/profile-gradual-zoom.ts [MiB held elsewhere, default 0]
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { WORLD } from '../lib/game/geo';
import { createMapDiagnostics } from '../lib/game/mapDiagnostics';
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
const data = decodeCity(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
const cityIndex = indexCity(data, 400);
const indexed: { value: CoverIndex | null } = { value: null };
const job = createCoverIndexJob({ id: 'i', generation: 0, essential: true, cityData: data, cellSizeM: 3200, now: () => performance.now(), onReady: (v) => { indexed.value = v; } });
while (!job.step()) {}
const MiB = 1048576;
const extra = Number(process.argv[2] ?? 6) * MiB; // landmark/replacement geometry held by the renderer
const tracker = createGeometryTracker();
const resources = createResourcePool();
const material = createBuildingMaterial(); resources.retain(material);
const diagnostics = createMapDiagnostics(1, () => performance.now()); diagnostics.selectMode('3d');
let evicted = 0;
const stream = new CityStream({ data, cityIndex, coverIndex: indexed.value!, exclusions: new Set(), material, root: new THREE.Group(), resources, tracker, diagnostics,
  residentBudget: { maxBytes: 128 * MiB - extra, backgroundBytes: 96 * MiB - extra },
  now: () => performance.now(), onStockDrawn: () => undefined, onStockEvicted: (p) => { evicted += p.length; }, onFatal: (r) => { console.log('FATAL', r, diagnostics.snapshot().errors); process.exit(1); } });
const rig = new CameraRig(); rig.setViewport(1440, 900);
const wide = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 1440 / (WORLD.width * 1.1) };
rig.update(wide, 0); stream.update(cameraGroundBounds(rig, 1440, 900));
while (!stream.idle) stream.drain();
const line = (tag: string) => console.log(tag, stream.stockBuildings, (tracker.bytes() / MiB).toFixed(1), 'stale', (stream.staleStockBytes / MiB).toFixed(1), 'staging', (stream.stagingBytes / MiB).toFixed(1), 'evictedPicks', evicted);
line('settled');
for (let k = 1; k <= 8; k++) { rig.update({ ...wide, zoom: wide.zoom * 1.47 ** k }, 0); stream.update(cameraGroundBounds(rig, 1440, 900)); stream.drain(); line(`wheel${k}`); }
for (let i = 0; i < 4; i++) { stream.drain(); line(`drain${i}`); }
let floor = stream.stockBuildings;
for (let k = 7; k >= 0; k--) { rig.update({ ...wide, zoom: wide.zoom * 1.47 ** k }, 0); stream.update(cameraGroundBounds(rig, 1440, 900)); stream.drain(); floor = Math.min(floor, stream.stockBuildings); line(`out${k}`); }
let n = 0; while (!stream.idle) { stream.drain(); n++; floor = Math.min(floor, stream.stockBuildings); }
line(`settled-after-${n}`); console.log('floor', floor);
