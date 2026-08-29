/**
 * Street-camera / HUD helpers — offline, no DOM.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
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
import {
  LANDMARKS,
  METERS_TO_WORLD,
  THAMES_CROSSINGS,
  isDeckLandmark,
  project,
  thamesCrossingLookKey,
  thamesTangent,
} from '../lib/game/geo';
import {
  splitRoadRuns,
  stitchWaterSpans,
  walkAcrossWater,
  buildCrossingSpans,
  riverCrossingSpans,
  countLandRibbonsOverWater,
  spanEndClearanceM,
  landRibbonVerts,
  buildParks,
  buildRoads,
  plannedCrosswalks,
  BRIDGE_SPAN_MIN_M,
} from '../lib/game/render3d/cityBuilder';
import { wallHex } from '../lib/game/render3d/palette';
import { decodeCity } from '../lib/game/render3d/format';

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
  const chelsea = searchPlaces('chelsea');
  assert.ok(chelsea.some((h) => h.label === 'Chelsea Bridge'));
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

check('river crossings drop wet OSM and stitch a land-to-land span', () => {
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
  const over = (x: number, z: number) => wet.has(`${x},${z}`) || (x > 2.05 && x < 2.1 + min + 0.45);
  const runs = splitRoadRuns(pts, over);
  assert.equal(
    runs.some((r) => r.span),
    false,
    'wet OSM must not become a ribbon',
  );
  assert.equal(runs.length, 2, 'both banks keep their land roads');

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

  const oneVert = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 2, z: 0 },
  ];
  const oneWet = (x: number, z: number) => x === 1 && z === 0;
  const stubs = splitRoadRuns(oneVert, oneWet);
  assert.equal(stubs.length, 2, 'a single land vertex on each bank still makes an approach stub');
  assert.ok(stubs.every((r) => r.pts.length >= 2));

  const bankToBank = [
    { x: 0, z: 0 },
    { x: 3, z: 0 },
  ];
  const channel = (x: number) => x > 0.5 && x < 2.5;
  const broken = splitRoadRuns(bankToBank, channel);
  assert.equal(broken.length, 2, 'dry nodes on each bank still split at the channel');
  assert.ok(
    broken.every((r) => r.pts.every((p) => !channel(p.x))),
    'land ribbons must not keep channel samples',
  );

  const far = walkAcrossWater({ x: 0, z: 0, dx: 1, dz: 0, tier: 0 }, (x) => x > 0.5 && x < 1.6);
  assert.ok(far && far.x > 1.6, 'walk should step onto the far bank');
  const crossings = buildCrossingSpans(
    [
      { x: 0.2, z: 0, dx: 1, dz: 0, tier: 0 },
      { x: 1.9, z: 0, dx: -1, dz: 0, tier: 0 },
    ],
    (x) => x > 0.4 && x < 1.7,
  );
  assert.equal(crossings.length, 1);
  const mid = (crossings[0]!.pts[0].x + crossings[0]!.pts[1].x) / 2;
  assert.ok(mid > 0.4 && mid < 1.7, 'stitched span should cross the water');
});

check('neighbouring terraces do not share one cloned wall paint', () => {
  const a = wallHex(STYLE_TERRACE, 'westend', 10, 10, 11, null);
  const b = wallHex(STYLE_TERRACE, 'westend', 12.2, 10.8, 4_001_001, null);
  assert.notEqual(a, b);
});

check('search finds British Museum and Goodge Street among landmarks', () => {
  const museum = searchPlaces('british museum');
  assert.ok(museum.some((h) => h.label === 'British Museum'));
  const station = searchPlaces('goodge');
  assert.ok(station.some((h) => /goodge street/i.test(h.label)));
  const lcy = searchPlaces('london city');
  assert.ok(lcy.some((h) => h.label === 'London City Airport'));
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

check('named Thames crossings have a land-to-land span in the London bake', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const spans = riverCrossingSpans(city);
  const land = landRibbonVerts(city);
  const distToSpanM = (px: number, pz: number, s: (typeof spans)[0]): number => {
    const ax = s.pts[0].x;
    const az = s.pts[0].z;
    const bx = s.pts[1].x;
    const bz = s.pts[1].z;
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz || 1;
    let t = ((px - ax) * abx + (pz - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * abx), pz - (az + t * abz)) / METERS_TO_WORLD;
  };
  const named = LANDMARKS.filter(
    (l) => isDeckLandmark(l.kind) && l.kind !== 'oldstreet' && l.kind !== 'towerbridge',
  );
  for (const lm of named) {
    const at = project(lm.at);
    const hit = spans.find((s) => distToSpanM(at.x, at.y, s) < 30);
    assert.ok(hit, `${lm.name} has no stitched carriageway`);
    const meters =
      Math.hypot(hit!.pts[1].x - hit!.pts[0].x, hit!.pts[1].z - hit!.pts[0].z) / METERS_TO_WORLD;
    assert.ok(meters > 70 && meters < 520, `${lm.name} span ${meters.toFixed(0)}m looks wrong`);
    const t = thamesTangent(lm.at);
    const dx = hit!.pts[1].x - hit!.pts[0].x;
    const dz = hit!.pts[1].z - hit!.pts[0].z;
    const len = Math.hypot(dx, dz) || 1;
    const align = Math.abs((dx / len) * -t.y + (dz / len) * t.x);
    assert.ok(align > 0.7, `${lm.name} deck is skewed vs the river (${align.toFixed(2)})`);
    const near = spans.filter((s) => distToSpanM(at.x, at.y, s) < 40);
    assert.equal(near.length, 1, `${lm.name} has ${near.length} overlapping decks`);
    const [e0, e1] = spanEndClearanceM(hit!, land);
    const maxJoin = lm.kind === 'millennium' || lm.kind === 'hungerford' ? 80 : 40;
    assert.ok(
      e0 < maxJoin && e1 < maxJoin,
      `${lm.name} deck misses the bank road (${e0.toFixed(0)}m / ${e1.toFixed(0)}m)`,
    );
  }
  const tb = LANDMARKS.find((l) => l.kind === 'towerbridge')!;
  const tbAt = project(tb.at);
  assert.equal(
    spans.find((s) => distToSpanM(tbAt.x, tbAt.y, s) < 80),
    undefined,
    'Tower Bridge must not get a generic stitch ribbon',
  );
  const extra = THAMES_CROSSINGS;
  for (const { name, at: ll } of extra) {
    const at = project(ll);
    const hit = spans.find((s) => distToSpanM(at.x, at.y, s) < 55);
    assert.ok(hit, `${name} has no stitched carriageway`);
    const near = spans.filter((s) => distToSpanM(at.x, at.y, s) < 60);
    assert.equal(near.length, 1, `${name} has ${near.length} overlapping decks`);
    const [e0, e1] = spanEndClearanceM(hit!, land);
    assert.ok(
      e0 < 40 && e1 < 40,
      `${name} deck misses the bank road (${e0.toFixed(0)}m / ${e1.toFixed(0)}m)`,
    );
  }
  assert.equal(
    spans.length,
    named.length + extra.length,
    `unexpected extra river decks: ${spans.length} vs ${named.length + extra.length} named crossings`,
  );
  const keys = extra.map((c) => thamesCrossingLookKey(c.name));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('chelseabr') && keys.includes('vauxhallbr'));
  assert.equal(
    countLandRibbonsOverWater(city),
    0,
    'OSM land ribbons must not span a water channel',
  );
});

check('park grass is matte mottled green, not a lit plastic lawn', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const parks = buildParks(city);
  assert.ok(parks, 'expected park meshes');
  let grass = 0;
  parks!.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      assert.equal(mat.type, 'MeshBasicMaterial', `${mat.type} still lights the lawn`);
      assert.ok(
        !('metalness' in mat) || (mat as THREE.MeshBasicMaterial).type === 'MeshBasicMaterial',
      );
      if (mat.vertexColors) {
        grass += 1;
        const colors = obj.geometry.getAttribute('color');
        assert.ok(colors && colors.count > 12, 'grass needs per-vertex shade');
      }
    }
  });
  assert.ok(grass >= 1, 'grass mesh must use vertex colours');
});

check('OSM asphalt does not replace the Tower Bridge prefab', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const roads = buildRoads(city);
  assert.ok(roads, 'expected road meshes');
  const tb = LANDMARKS.find((l) => l.kind === 'towerbridge')!;
  const at = project(tb.at);
  let onSpan = 0;
  let onTowers = 0;
  roads!.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const dxM = (pos.getX(i) - at.x) / METERS_TO_WORLD;
      const dzM = (pos.getZ(i) - at.y) / METERS_TO_WORLD;
      if (Math.hypot(dxM, dzM) < 80) onTowers += 1;
      if (Math.abs(dxM) < 40 && Math.abs(dzM) < 120) onSpan += 1;
    }
  });
  assert.equal(onTowers, 0, `OSM/stitch ribbon still sits on the towers (${onTowers} verts)`);
  assert.equal(
    onSpan,
    0,
    `OSM/stitch ribbon still crosses the Tower Bridge span (${onSpan} verts)`,
  );
});

check('Tower Hill park does not remain as a green hedge around the fortress', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const parks = buildParks(city);
  assert.ok(parks, 'expected park meshes');
  const tol = LANDMARKS.find((l) => l.kind === 'towerlondon')!;
  const at = project(tol.at);
  const limit = 120 * METERS_TO_WORLD;
  let near = 0;
  parks!.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - at.x;
      const dz = pos.getZ(i) - at.y;
      if (Math.hypot(dx, dz) < limit) near += 1;
    }
  });
  assert.equal(near, 0, `park grass still inside the fortress (${near} verts)`);
});

check('Buckingham gardens keep a lawn; Hyde is not a crumpled fan', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const parks = buildParks(city);
  assert.ok(parks, 'expected park meshes');
  const buck = LANDMARKS.find((l) => l.kind === 'buckingham')!;
  const at = project(buck.at);
  let garden = 0;
  let parkTris = 0;
  parks!.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const pos = obj.geometry.getAttribute('position');
    const idx = obj.geometry.getIndex();
    if (idx) parkTris += idx.count / 3;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i) - at.x, pos.getZ(i) - at.y) / METERS_TO_WORLD;
      if (d > 90 && d < 240) garden += 1;
    }
  });
  assert.ok(garden > 80, `palace gardens / Green Park missing lawn (${garden} verts)`);
  assert.ok(parkTris > 200 && parkTris < 80_000, `park triangulation ${parkTris} looks subdivided`);
});

check('zebra crossings sit on junction approaches, not every OSM stub', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const xw = plannedCrosswalks(city);
  assert.ok(xw.length > 80 && xw.length < 4000, `unexpected zebra count ${xw.length}`);
  let stacked = 0;
  for (let i = 0; i < xw.length; i++) {
    for (let j = i + 1; j < xw.length; j++) {
      const d = Math.hypot(xw[i]!.x - xw[j]!.x, xw[i]!.z - xw[j]!.z);
      const dot = xw[i]!.dx * xw[j]!.dx + xw[i]!.dz * xw[j]!.dz;
      if (d < 5 * METERS_TO_WORLD && Math.abs(dot) > 0.92) stacked += 1;
    }
  }
  assert.equal(stacked, 0, `${stacked} overlapping zebra approaches`);
});

console.log(`\nAll ${passed} street-camera checks passed.`);
