/**
 * Street-camera / HUD helpers — offline, no DOM.
 */
import assert from 'node:assert/strict';
import { londonClimate, londonClock, searchPlaces } from '../lib/game/mapSearch';
import {
  STYLE_HOUSE,
  STYLE_OFFICE,
  STYLE_TERRACE,
  bayCountForEdge,
  restyleForDistrict,
  STYLE_APARTMENTS,
  wantBayWindows,
} from '../lib/game/render3d/buildingStyle';
import { polylineDashes, segmentEdgeOffsets } from '../lib/game/render3d/streetMarks';
import { chamferRing } from '../lib/game/render3d/footprint';
import { CameraRig, ISO_PITCH_DEG } from '../lib/game/render3d/cameraRig';
import { METERS_TO_WORLD } from '../lib/game/geo';
import {
  splitRoadRuns,
  stitchWaterSpans,
  BRIDGE_SPAN_MIN_M,
} from '../lib/game/render3d/cityBuilder';
import { wallHex } from '../lib/game/render3d/palette';
import { STYLE_TERRACE } from '../lib/game/render3d/buildingStyle';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('Street-camera city read');

check('dashed centre lines leave gaps', () => {
  const run = [
    { x: 0, z: 0 },
    { x: 40 * METERS_TO_WORLD, z: 0 },
  ];
  const dashes = polylineDashes(run);
  assert.ok(dashes.length >= 3, `expected several dashes, got ${dashes.length}`);
  const painted = dashes.reduce((n, d) => n + Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z), 0);
  const total = 40 * METERS_TO_WORLD;
  assert.ok(painted < total * 0.75, 'dashes should not be a solid stripe');
  assert.ok(painted > total * 0.35, 'dashes should still read as a centre line');
});

check('terrace and street-scale office fronts get bay windows; towers do not', () => {
  assert.equal(wantBayWindows(8, 10, STYLE_TERRACE), true);
  assert.equal(wantBayWindows(8, 10, STYLE_HOUSE), true);
  assert.equal(wantBayWindows(8, 10, STYLE_OFFICE), true);
  assert.equal(wantBayWindows(8, 30, STYLE_OFFICE), false);
  assert.equal(wantBayWindows(16, 10, STYLE_TERRACE), false);
  assert.equal(wantBayWindows(28, 12, STYLE_TERRACE), true);
  assert.equal(bayCountForEdge(8), 1);
  assert.equal(bayCountForEdge(11), 2);
  assert.ok(bayCountForEdge(32) >= 3);
});

check('offline search finds Shard, Shoreditch, Hyde Park', () => {
  const shard = searchPlaces('shard');
  assert.ok(
    shard.some((h) => h.label === 'The Shard' && h.kind === 'landmark'),
    shard.map((h) => h.label).join(','),
  );
  const shore = searchPlaces('shoreditch');
  assert.ok(shore.some((h) => /shoreditch/i.test(h.label)));
  const park = searchPlaces('hyde');
  assert.ok(park.some((h) => h.label === 'Hyde Park' && h.kind === 'park'));
});

check('West End 4–6 storey terraces keep bays (not restyled to office)', () => {
  assert.equal(restyleForDistrict(STYLE_APARTMENTS, 20, 400, 'westend'), STYLE_APARTMENTS);
  assert.equal(wantBayWindows(8, 18, STYLE_APARTMENTS), true);
});

check('chamfer turns a rectangle into eight vertices', () => {
  const r = chamferRing(
    [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 6 },
      { x: 0, z: 6 },
    ],
    1,
  );
  assert.equal(r.length, 8);
  assert.ok(r.every((p) => p.x >= -1e-9 && p.x <= 10 + 1e-9));
});

check('road edge offsets sit on both kerbs', () => {
  const edges = segmentEdgeOffsets({ x: 0, z: 0 }, { x: 10, z: 0 }, 2);
  assert.ok(Math.abs(edges.left[0]!.z - 2) < 1e-9);
  assert.ok(Math.abs(edges.right[0]!.z + 2) < 1e-9);
});

check('isometric zoom scales the frustum and does not tilt pitch', () => {
  const rig = new CameraRig();
  rig.setViewport(1280, 720);
  rig.update({ x: 40, y: 30, zoom: 400 });
  const pitch = rig.camera.rotation.x;
  const topWide = rig.camera.top;
  const isoRad = (ISO_PITCH_DEG * Math.PI) / 180;
  rig.update({ x: 40, y: 30, zoom: 800 });
  assert.ok(
    rig.camera.top < topWide * 0.55,
    `zoom in should shrink the ortho frustum (top ${rig.camera.top} vs ${topWide})`,
  );
  assert.ok(Math.abs(rig.camera.rotation.x - pitch) < 1e-8, 'pitch must stay locked while zooming');
  assert.equal(CameraRig.pitchDeg(), ISO_PITCH_DEG);
  assert.ok(
    Math.abs(Math.abs(rig.camera.rotation.x) - isoRad) < 0.02,
    `camera pitch should stay near ${ISO_PITCH_DEG}°`,
  );
});

check('London clock and climate stay offline', () => {
  const at = new Date('2026-08-28T12:16:00Z');
  const clock = londonClock(at);
  assert.match(clock.time, /^\d{2}:\d{2}$/);
  assert.ok(clock.weekday.length >= 3);
  const climate = londonClimate(at);
  assert.ok(climate.tempC > 0 && climate.tempC < 40);
  assert.ok(climate.sunset.includes(':'));
  assert.ok(climate.aqi > 0);
});

check('river crossings keep a long interior water span and drop bank noise', () => {
  const min = BRIDGE_SPAN_MIN_M * METERS_TO_WORLD;
  const landA = [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
  ];
  const span = [
    { x: 2.1, z: 0 },
    { x: 2.1 + min + 0.4, z: 0 },
  ];
  const landB = [
    { x: 2.1 + min + 0.5, z: 0 },
    { x: 2.1 + min + 2.5, z: 0 },
  ];
  const pts = [...landA, ...span, ...landB];
  const wet = new Set(span.map((p) => `${p.x},${p.z}`));
  const runs = splitRoadRuns(pts, (x, z) => wet.has(`${x},${z}`));
  assert.ok(
    runs.some((r) => r.span),
    'expected a kept Thames span',
  );
  const dip = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1.05, z: 0 },
    { x: 2, z: 0 },
  ];
  const dipWet = (x: number, z: number) => x === 1.05 && z === 0;
  const dipped = splitRoadRuns(dip, dipWet);
  assert.equal(
    dipped.some((r) => r.span),
    false,
    'short water dips must not become decks',
  );
});

check('neighbouring terraces do not share one cloned wall paint', () => {
  const a = wallHex(STYLE_TERRACE, 'westend', 10, 10, 11, null);
  const b = wallHex(STYLE_TERRACE, 'westend', 12.2, 10.8, 4_001_001, null);
  assert.notEqual(a, b);
});

check('land stubs facing across water stitch into an asphalt span', () => {
  const approaches = [
    { x: 0, z: 0, dx: 1, dz: 0, tier: 0 },
    { x: 2.2, z: 0, dx: -1, dz: 0, tier: 0 },
  ];
  const spans = stitchWaterSpans(approaches, (x) => x > 0.4 && x < 1.8);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.pts.length, 2);
});

console.log(`\nAll ${passed} street-camera checks passed.`);
