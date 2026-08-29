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
  buildParkTrees,
  buildRoads,
  buildWater,
  buildChunkTier,
  plannedCrosswalks,
  BRIDGE_SPAN_MIN_M,
  CHUNK_COUNT,
  PARK_Y,
  ROAD_Y,
  createScratch,
  onLondonCityAirportSpit,
} from '../lib/game/render3d/cityBuilder';
import { wallHex } from '../lib/game/render3d/palette';
import { decodeCity, dequantizeX, dequantizeY } from '../lib/game/render3d/format';
import { inKeepDisk, meshBudgetFromSearch, type KeepDisk } from '../lib/game/render3d/lookClip';

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
        assert.equal(mat.side, THREE.FrontSide, 'DoubleSide grass z-fights GROUND');
        let green = 0;
        for (let i = 0; i < Math.min(colors.count, 80); i++) {
          if (colors.getY(i) > colors.getX(i) && colors.getY(i) > colors.getZ(i)) green += 1;
        }
        assert.ok(green > 40, `lawn verts are not green (${green}/80)`);
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
  assert.ok(PARK_Y < 0.05 && PARK_Y < ROAD_Y, `park carpet too high (${PARK_Y})`);
  const buck = LANDMARKS.find((l) => l.kind === 'buckingham')!;
  const at = project(buck.at);
  let garden = 0;
  let north = 0;
  let parkTris = 0;
  let lifted = 0;
  let longEdge = 0;
  parks!.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const pos = obj.geometry.getAttribute('position');
    const idx = obj.geometry.getIndex();
    if (idx) parkTris += idx.count / 3;
    if (!pos) return;
    const isGrass = obj.name === 'grass';
    for (let i = 0; i < pos.count; i++) {
      if (isGrass && Math.abs(pos.getY(i) - PARK_Y) > 0.004) lifted += 1;
      const dx = pos.getX(i) - at.x;
      const dz = pos.getZ(i) - at.y;
      const d = Math.hypot(dx, dz) / METERS_TO_WORLD;
      if (d > 90 && d < 240) garden += 1;
      if (d > 40 && d < 200 && dz < 0) north += 1;
    }
    if (!idx || !isGrass) return;
    for (let t = 0; t + 2 < idx.count; t += 3) {
      const i0 = idx.getX(t)!;
      const i1 = idx.getX(t + 1)!;
      const i2 = idx.getX(t + 2)!;
      const e = Math.max(
        Math.hypot(pos.getX(i0) - pos.getX(i1), pos.getZ(i0) - pos.getZ(i1)),
        Math.hypot(pos.getX(i1) - pos.getX(i2), pos.getZ(i1) - pos.getZ(i2)),
        Math.hypot(pos.getX(i2) - pos.getX(i0), pos.getZ(i2) - pos.getZ(i0)),
      );
      if (e > 130 * METERS_TO_WORLD) longEdge += 1;
    }
  });
  assert.equal(lifted, 0, `park verts not on the carpet (${lifted})`);
  assert.equal(longEdge, 0, `${longEdge} grass triangles still span > 130 m`);
  assert.ok(garden > 80, `palace gardens / Green Park missing lawn (${garden} verts)`);
  assert.ok(north > 40, `Green Park north of the palace missing (${north} verts)`);
  assert.ok(parkTris > 8_000 && parkTris < 80_000, `park triangulation ${parkTris} looks subdivided`);
});

check('zebra crossings sit on junction approaches, not every OSM stub', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const xw = plannedCrosswalks(city);
  assert.ok(xw.length > 40 && xw.length < 2000, `unexpected zebra count ${xw.length}`);
  let stacked = 0;
  for (let i = 0; i < xw.length; i++) {
    for (let j = i + 1; j < xw.length; j++) {
      const d = Math.hypot(xw[i]!.x - xw[j]!.x, xw[i]!.z - xw[j]!.z);
      if (d < 8 * METERS_TO_WORLD) stacked += 1;
    }
  }
  assert.equal(stacked, 0, `${stacked} overlapping zebra approaches`);
});

check('wide-view mesh budget clips the city; close looks stay full', () => {
  const mid = meshBudgetFromSearch(new URLSearchParams('view=mid'));
  assert.equal(mid.chunkKeepM, 1600);
  assert.equal(mid.skipAntialias, true);
  assert.equal(mid.pixelRatioCap, 1);
  assert.equal(mid.skipTrees, true);
  assert.equal(mid.skipWindows, true);
  const eye = meshBudgetFromSearch(new URLSearchParams('look=eye'));
  assert.equal(eye.chunkKeepM, 1800);
  assert.equal(eye.skipAntialias, true);
  const close = meshBudgetFromSearch(new URLSearchParams('look=towerbridge'));
  assert.equal(close.chunkKeepM, null);
  assert.equal(close.skipAntialias, false);
  assert.equal(close.skipTrees, false);
});

check('view=mid keep-disk does not tessellate the whole 23 km map', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const hero = project([-0.1358, 51.5196]);
  const keep: KeepDisk = { x: hero.x, z: hero.y, r: 1600 * METERS_TO_WORLD };
  const pad = 120 * METERS_TO_WORLD;
  const tally = (root: THREE.Object3D | null) => {
    let verts = 0;
    let outside = 0;
    if (!root) return { verts, outside };
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const pos = obj.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        verts += 1;
        if (!inKeepDisk(pos.getX(i), pos.getZ(i), keep, pad)) outside += 1;
      }
    });
    return { verts, outside };
  };
  const roads = tally(buildRoads(city, keep));
  assert.ok(roads.verts > 800, `mid-view neighbourhood has no streets (${roads.verts} verts)`);
  assert.equal(roads.outside, 0, `road verts leak outside the keep-disk (${roads.outside})`);
  const parks = tally(buildParks(city, keep));
  assert.equal(parks.outside, 0, `park verts leak outside the keep-disk (${parks.outside})`);
  const water = tally(buildWater(city, keep));
  assert.equal(water.outside, 0, `water verts leak outside the keep-disk (${water.outside})`);
  const eyeAt = project(LANDMARKS.find((l) => l.kind === 'eye')!.at);
  const eyeKeep: KeepDisk = { x: eyeAt.x, z: eyeAt.y, r: 1800 * METERS_TO_WORLD };
  const eyeWater = buildWater(city, eyeKeep);
  let eyeWaterVerts = 0;
  eyeWater?.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const pos = obj.geometry.getAttribute('position');
    if (pos) eyeWaterVerts += pos.count;
  });
  assert.ok(eyeWaterVerts > 40, `look=eye keep-disk lost the Thames (${eyeWaterVerts} verts)`);
});

check('LCY spit is not OSM boxes or park mounds on the peninsula', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const budget = meshBudgetFromSearch(new URLSearchParams('look=lcy'));
  assert.equal(budget.skipTrees, true);
  assert.equal(budget.chunkKeepM, 2200);
  const anchors = LANDMARKS.map((l) => {
    const p = project(l.at);
    return { x: p.x, y: p.y, r: (l.exclusionM ?? 80) * METERS_TO_WORLD };
  });
  const scratch = createScratch();
  let boxes = 0;
  for (let chunkId = 0; chunkId < CHUNK_COUNT; chunkId++) {
    for (const major of [true, false]) {
      const mesh = buildChunkTier(city, chunkId, major, anchors, scratch);
      if (!mesh) continue;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) continue;
      for (let i = 0; i < pos.count; i++) {
        if (onLondonCityAirportSpit(pos.getX(i), pos.getZ(i))) boxes += 1;
      }
    }
  }
  assert.equal(boxes, 0, `OSM extrusions still sit on the LCY spit (${boxes} verts)`);
  const parks = buildParks(city);
  let grass = 0;
  parks?.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      if (onLondonCityAirportSpit(pos.getX(i), pos.getZ(i))) grass += 1;
    }
  });
  assert.equal(grass, 0, `park mounds still sit on the LCY spit (${grass} verts)`);
});

check('park trees stand on the lawn, not as dirt mounds', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const trees = buildParkTrees(city);
  assert.ok(trees, 'expected park trees');
  let groves = 0;
  const dummy = new THREE.Object3D();
  const maxCanopyM = { n: 0 };
  const trunks: { x: number; z: number }[] = [];
  trees!.traverse((obj) => {
    if (obj.userData.grove) groves += 1;
    if (!(obj instanceof THREE.InstancedMesh)) return;
    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      if (obj.geometry.type === 'CylinderGeometry') {
        trunks.push({ x: dummy.position.x, z: dummy.position.z });
      } else {
        const spanM = dummy.scale.x / METERS_TO_WORLD;
        if (spanM > maxCanopyM.n) maxCanopyM.n = spanM;
      }
    }
  });
  assert.equal(groves, 0, 'flattened grove blobs are the fake lawn');
  assert.ok(maxCanopyM.n > 8 && maxCanopyM.n < 40, `canopy span ${maxCanopyM.n.toFixed(1)} m`);

  const rings: { x: number; z: number }[][] = [];
  for (const park of city.parks) {
    const n = park.verts.length / 2;
    if (n < 3) continue;
    const ring: { x: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      ring.push({
        x: dequantizeX(park.verts[i * 2]!),
        z: dequantizeY(park.verts[i * 2 + 1]!),
      });
    }
    rings.push(ring);
  }
  const inRing = (x: number, z: number, ring: { x: number; z: number }[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]!.x;
      const zi = ring[i]!.z;
      const xj = ring[j]!.x;
      const zj = ring[j]!.z;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  const buck = LANDMARKS.find((l) => l.kind === 'buckingham')!;
  const at = project(buck.at);
  let onLawn = 0;
  let onSpit = 0;
  for (const t of trunks) {
    if (onLondonCityAirportSpit(t.x, t.z)) onSpit += 1;
    const d = Math.hypot(t.x - at.x, t.z - at.y) / METERS_TO_WORLD;
    if (d < 80 || d > 280) continue;
    if (rings.some((ring) => inRing(t.x, t.z, ring))) onLawn += 1;
  }
  assert.equal(onSpit, 0, `trees still planted on the LCY spit (${onSpit})`);
  assert.ok(onLawn > 8, `no trees on Green Park / palace gardens (${onLawn})`);
});

console.log(`\nAll ${passed} street-camera checks passed.`);
