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
  STYLE_TOWER,
  STYLE_INDUSTRIAL,
  bayCountForEdge,
  restyleForDistrict,
  resolveStyle,
  districtAt,
  stockMassing,
  STYLE_APARTMENTS,
  wantBayWindows,
} from '../lib/game/render3d/buildingStyle';
import { polylineDashes, segmentEdgeOffsets } from '../lib/game/render3d/streetMarks';
import { chamferRing, insetRingTowardCentroid, scaleToward } from '../lib/game/render3d/footprint';
import {
  analyzeFootprint,
  recipeFingerprint,
  uniqueStockRecipe,
} from '../lib/game/render3d/uniqueStock';
import {
  JEWRY_BRONZE,
  JEWRY_GLASS,
  JEWRY_HIGH,
  JEWRY_MID,
  MANSION_COLUMN,
  NED_GLASS,
  POULTRY_BUFF,
  POULTRY_CLOCK,
  POULTRY_CLOCK_HAND,
  POULTRY_GLASS,
  POULTRY_MORTAR,
  POULTRY_PINK,
  POULTRY_ROOF,
  POULTRY_WELL,
  poultryWellR,
  STREET_UNIQUE_PINS,
  streetUniqueAt,
} from '../lib/game/render3d/uniqueStreet';
import { CameraRig, ISO_PITCH_DEG } from '../lib/game/render3d/cameraRig';
import {
  LANDMARKS,
  METERS_TO_WORLD,
  THAMES_CROSSINGS,
  WORLD,
  isDeckLandmark,
  project,
  thamesCrossingLookKey,
  thamesTangent,
  unproject,
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
  buildGround,
  plannedCrosswalks,
  BRIDGE_SPAN_MIN_M,
  CHUNK_COLS,
  CHUNK_COUNT,
  CHUNK_ROWS,
  PARK_Y,
  ROAD_Y,
  createScratch,
  onLondonCityAirportSpit,
} from '../lib/game/render3d/cityBuilder';
import { wallHex, HVAC_BLUE, HVAC_RED, GROUND, windowHex } from '../lib/game/render3d/palette';
import { decodeCity, dequantizeX, dequantizeY } from '../lib/game/render3d/format';
import {
  inKeepDisk,
  meshBudgetFromSearch,
  CITYSTREET_AT,
  buildJobsThisFrame,
  drainBuildJobKinds,
  BUILD_JOBS_WHILE_LOADING_KEEP,
  type KeepDisk,
} from '../lib/game/render3d/lookClip';

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

check('centroid inset shrinks a footprint without flipping it', () => {
  const ring = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 6 },
    { x: 0, z: 6 },
  ];
  const inner = insetRingTowardCentroid(ring, 5, 3, 1);
  assert.equal(inner.length, 4);
  for (const p of inner) {
    assert.ok(p.x > 0.2 && p.x < 9.8, `x ${p.x}`);
    assert.ok(p.z > 0.2 && p.z < 5.8, `z ${p.z}`);
  }
  const spanX = Math.max(...inner.map((p) => p.x)) - Math.min(...inner.map((p) => p.x));
  assert.ok(spanX < 10, `inset still ${spanX} wide`);
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

check('open ground is urban paving, not a citywide lawn', () => {
  const ground = buildGround();
  const mat = ground.material as THREE.MeshBasicMaterial;
  assert.equal(mat.type, 'MeshBasicMaterial', `${mat.type} still lights the dirt`);
  const c = new THREE.Color(GROUND);
  assert.ok(
    !(c.g > c.r + 0.04 && c.g > c.b + 0.04),
    `GROUND ${GROUND.toString(16)} still reads as park lawn`,
  );
  assert.ok(c.g < 0.48 && c.r < 0.52, `GROUND ${GROUND.toString(16)} is still beige dirt`);
  const buck = LANDMARKS.find((l) => l.kind === 'buckingham')!;
  const at = project(buck.at);
  const keep: KeepDisk = { x: at.x, z: at.y, r: 1600 * METERS_TO_WORLD };
  const clipped = buildGround(keep);
  const box = new THREE.Box3().setFromObject(clipped);
  const spanM = (box.max.x - box.min.x) / METERS_TO_WORLD;
  assert.ok(spanM < 3600, `look=buckingham ground still citywide (${spanM.toFixed(0)} m)`);
  assert.ok(spanM > 2800, `look=buckingham ground vanished (${spanM.toFixed(0)} m)`);
});

check('view=mid does not paint kerb ribbons across the city', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const hero = project([-0.1358, 51.5196]);
  const keep: KeepDisk = { x: hero.x, z: hero.y, r: 1600 * METERS_TO_WORLD };
  const quiet = buildRoads(city, keep, false);
  assert.ok(quiet, 'mid-view still needs asphalt');
  let markMeshes = 0;
  quiet!.traverse((obj) => {
    if (obj.userData.roadMarks) markMeshes += 1;
  });
  assert.equal(markMeshes, 0, `mid-view still has ${markMeshes} mark meshes`);
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
  const hyde = project([-0.169, 51.5075]);
  let garden = 0;
  let north = 0;
  let parkTris = 0;
  let lifted = 0;
  let longEdge = 0;
  let hydeSkinny = 0;
  let hydeTris = 0;
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
      const e01 = Math.hypot(pos.getX(i0) - pos.getX(i1), pos.getZ(i0) - pos.getZ(i1));
      const e12 = Math.hypot(pos.getX(i1) - pos.getX(i2), pos.getZ(i1) - pos.getZ(i2));
      const e20 = Math.hypot(pos.getX(i2) - pos.getX(i0), pos.getZ(i2) - pos.getZ(i0));
      const longest = Math.max(e01, e12, e20);
      const shortest = Math.min(e01, e12, e20) || 1;
      if (longest > 50 * METERS_TO_WORLD) longEdge += 1;
      const mx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
      const mz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
      if (Math.hypot(mx - hyde.x, mz - hyde.y) < 700 * METERS_TO_WORLD) {
        hydeTris += 1;
        if (longest / shortest > 3.2) hydeSkinny += 1;
      }
    }
  });
  assert.equal(lifted, 0, `park verts not on the carpet (${lifted})`);
  assert.equal(longEdge, 0, `${longEdge} grass triangles still span > 50 m`);
  assert.ok(garden > 80, `palace gardens / Green Park missing lawn (${garden} verts)`);
  assert.ok(north > 40, `Green Park north of the palace missing (${north} verts)`);
  assert.ok(hydeTris > 80, `Hyde Park lawn missing (${hydeTris} tris)`);
  assert.ok(
    hydeSkinny / hydeTris < 0.08,
    `Hyde still has fan tents (${hydeSkinny}/${hydeTris} skinny tris)`,
  );
  assert.ok(
    parkTris > 8_000 && parkTris < 140_000,
    `park triangulation ${parkTris} looks subdivided`,
  );
});

check('zebra crossings sit one per junction, not stacked on every arm', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const xw = plannedCrosswalks(city);
  assert.ok(xw.length > 25 && xw.length < 2000, `unexpected zebra count ${xw.length}`);
  let stacked = 0;
  for (let i = 0; i < xw.length; i++) {
    for (let j = i + 1; j < xw.length; j++) {
      const d = Math.hypot(xw[i]!.x - xw[j]!.x, xw[i]!.z - xw[j]!.z);
      if (d < 22 * METERS_TO_WORLD) stacked += 1;
    }
  }
  assert.equal(stacked, 0, `${stacked} stacked zebra approaches`);
});

check('City offices mass as setbacks or mansards, not forced slabs', () => {
  for (const seed of [0, 1, 2, 3, 17, 99, 1001]) {
    const kind = stockMassing({
      style: STYLE_OFFICE,
      roof: 0,
      heightM: 24,
      areaM2: 420,
      district: 'city',
      seed,
    });
    assert.ok(
      kind === 'setback' || kind === 'mansard',
      `city 24 m office seed ${seed} was ${kind}`,
    );
  }
  assert.equal(
    stockMassing({
      style: STYLE_TOWER,
      roof: 0,
      heightM: 90,
      areaM2: 800,
      district: 'city',
      seed: 4,
    }),
    'slab',
  );
  assert.equal(
    stockMassing({
      style: STYLE_TERRACE,
      roof: 0,
      heightM: 12,
      areaM2: 180,
      district: 'westend',
      seed: 8,
    }),
    'gable',
  );
  assert.equal(
    stockMassing({
      style: STYLE_INDUSTRIAL,
      roof: 0,
      heightM: 10,
      areaM2: 2000,
      district: 'eastend',
      seed: 2,
    }),
    'sawtooth',
  );
});

check('citystreet stock has no HVAC red/blue rooftop confetti', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const at = project(CITYSTREET_AT);
  const col = Math.min(CHUNK_COLS - 1, Math.max(0, Math.floor((at.x / WORLD.width) * CHUNK_COLS)));
  const row = Math.min(CHUNK_ROWS - 1, Math.max(0, Math.floor((at.y / WORLD.height) * CHUNK_ROWS)));
  const chunkId = row * CHUNK_COLS + col;
  const red = new THREE.Color(HVAC_RED);
  const blue = new THREE.Color(HVAC_BLUE);
  let confetti = 0;
  let verts = 0;
  let sloped = 0;
  for (const major of [true, false]) {
    const mesh = buildChunkTier(city, chunkId, major, [], createScratch());
    if (!mesh) continue;
    assert.equal(mesh.frustumCulled, false, 'chunk frustum cull empties close zoom');
    const colors = mesh.geometry.getAttribute('color');
    const normals = mesh.geometry.getAttribute('normal');
    assert.ok(colors, `chunk ${chunkId} major=${major} needs vertex colours`);
    for (let i = 0; i < colors.count; i++) {
      verts += 1;
      const r = colors.getX(i);
      const g = colors.getY(i);
      const b = colors.getZ(i);
      const ny = normals?.getY(i) ?? 0;
      if (ny > 0.18 && ny < 0.92) sloped += 1;
      if (ny < 0.85) continue;
      if (
        Math.abs(r - red.r) < 0.012 &&
        Math.abs(g - red.g) < 0.012 &&
        Math.abs(b - red.b) < 0.012
      ) {
        confetti += 1;
      }
      if (
        Math.abs(r - blue.r) < 0.012 &&
        Math.abs(g - blue.g) < 0.012 &&
        Math.abs(b - blue.b) < 0.012
      ) {
        confetti += 1;
      }
    }
  }
  assert.ok(verts > 2000, `citystreet chunk ${chunkId} empty (${verts})`);
  assert.equal(confetti, 0, `HVAC confetti still in chunk ${chunkId} (${confetti})`);
  assert.ok(sloped > 80, `citystreet chunk ${chunkId} has no pitched/mansard slopes (${sloped})`);
});

check('City skyline punch leaves neighbouring streets', () => {
  for (const kind of ['gherkin', 'walkie', 'grater', 'bishop', 'heron', 'tower42'] as const) {
    const landmark = LANDMARKS.find((l) => l.kind === kind);
    assert.ok(landmark, kind);
    assert.ok(
      (landmark.exclusionM ?? 99) <= 50,
      `${kind} still punches a city block (${landmark.exclusionM} m)`,
    );
  }
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const gherkin = LANDMARKS.find((l) => l.kind === 'gherkin')!;
  const at = project(gherkin.at);
  const col = Math.min(CHUNK_COLS - 1, Math.max(0, Math.floor((at.x / WORLD.width) * CHUNK_COLS)));
  const row = Math.min(CHUNK_ROWS - 1, Math.max(0, Math.floor((at.y / WORLD.height) * CHUNK_ROWS)));
  const chunkId = row * CHUNK_COLS + col;
  const anchors = LANDMARKS.map((l) => {
    const p = project(l.at);
    return { x: p.x, y: p.y, r: (l.exclusionM ?? 80) * METERS_TO_WORLD };
  });
  let verts = 0;
  for (const major of [true, false]) {
    const mesh = buildChunkTier(city, chunkId, major, anchors, createScratch());
    if (!mesh) continue;
    verts += mesh.geometry.getAttribute('position')?.count ?? 0;
  }
  assert.ok(verts > 2000, `Gherkin neighbourhood emptied by punch (${verts} verts)`);
});

check('look=citystreet sits on stock, not inside a landmark punch-hole', () => {
  const at = project(CITYSTREET_AT);
  for (const landmark of LANDMARKS) {
    const p = project(landmark.at);
    const d = Math.hypot(at.x - p.x, at.y - p.y) / METERS_TO_WORLD;
    const r = landmark.exclusionM ?? 80;
    assert.ok(
      d > r + 40,
      `citystreet camera is inside ${landmark.kind} exclusion (${d.toFixed(0)} m vs ${r} m)`,
    );
  }
});

check('look=citystreet sits on the carriageway, not a courtyard pancake', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const at = project(CITYSTREET_AT);
  const inRing = (x: number, z: number, ring: { x: number; z: number }[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]!.x;
      const zi = ring[i]!.z;
      const xj = ring[j]!.x;
      const zj = ring[j]!.z;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  const ringsOf = (polys: { verts: Uint16Array }[]) =>
    polys.map((poly) => {
      const n = poly.verts.length / 2;
      const ring: { x: number; z: number }[] = [];
      for (let i = 0; i < n; i++) {
        ring.push({ x: dequantizeX(poly.verts[i * 2]!), z: dequantizeY(poly.verts[i * 2 + 1]!) });
      }
      return ring;
    });
  assert.equal(
    ringsOf(city.parks).some((ring) => inRing(at.x, at.y, ring)),
    false,
    'citystreet camera spawned in a park',
  );
  assert.equal(
    ringsOf(city.buildings).some((ring) => inRing(at.x, at.y, ring)),
    false,
    'citystreet camera spawned inside a footprint courtyard',
  );
  let roadM = Infinity;
  for (const road of city.roads) {
    const n = road.pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const ax = dequantizeX(road.pts[i * 2]!);
      const az = dequantizeY(road.pts[i * 2 + 1]!);
      const bx = dequantizeX(road.pts[(i + 1) * 2]!);
      const bz = dequantizeY(road.pts[(i + 1) * 2 + 1]!);
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1e-12;
      const t = Math.max(0, Math.min(1, ((at.x - ax) * dx + (at.y - az) * dz) / len2));
      const d = Math.hypot(at.x - (ax + t * dx), at.y - (az + t * dz)) / METERS_TO_WORLD;
      if (d < roadM) roadM = d;
    }
  }
  assert.ok(roadM < 8, `citystreet camera is ${roadM.toFixed(1)} m from a road`);
});

check('look=citystreet keep-disk still extrudes Cheapside stock', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const at = project(CITYSTREET_AT);
  const keep: KeepDisk = { x: at.x, z: at.y, r: 1600 * METERS_TO_WORLD };
  const pad = 120 * METERS_TO_WORLD;
  const col = Math.min(CHUNK_COLS - 1, Math.max(0, Math.floor((at.x / WORLD.width) * CHUNK_COLS)));
  const row = Math.min(CHUNK_ROWS - 1, Math.max(0, Math.floor((at.y / WORLD.height) * CHUNK_ROWS)));
  const chunkId = row * CHUNK_COLS + col;
  const anchors = LANDMARKS.map((l) => {
    const p = project(l.at);
    return { x: p.x, y: p.y, r: (l.exclusionM ?? 80) * METERS_TO_WORLD };
  });
  const streetM = 250;
  let nearby = 0;
  let dropped = 0;
  for (const b of city.buildings) {
    const n = b.verts.length / 2;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += dequantizeX(b.verts[i * 2]!);
      cz += dequantizeY(b.verts[i * 2 + 1]!);
    }
    cx /= n;
    cz /= n;
    if (Math.hypot(cx - at.x, cz - at.y) / METERS_TO_WORLD > streetM) continue;
    nearby += 1;
    if (!inKeepDisk(cx, cz, keep, pad)) dropped += 1;
  }
  assert.ok(nearby > 80, `Cheapside street has no OSM stock (${nearby} footprints)`);
  assert.equal(dropped, 0, `keep-disk clipped ${dropped}/${nearby} Cheapside footprints`);
  let verts = 0;
  let tallNear = 0;
  for (const major of [true, false]) {
    const mesh = buildChunkTier(city, chunkId, major, anchors, createScratch(), keep);
    if (!mesh) continue;
    assert.equal(mesh.frustumCulled, false, 'chunk frustum cull empties close zoom');
    const pos = mesh.geometry.getAttribute('position');
    verts += pos?.count ?? 0;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const d = Math.hypot(pos.getX(i) - at.x, pos.getZ(i) - at.y) / METERS_TO_WORLD;
        if (d > 200) continue;
        if (pos.getY(i) > 8 * METERS_TO_WORLD) tallNear += 1;
      }
    }
  }
  assert.ok(verts > 2000, `citystreet keep-disk emptied Cheapside (${verts} verts)`);
  assert.ok(tallNear > 4000, `citystreet keep-disk is ground pancakes (${tallNear} tall verts)`);
});

check('Cheapside stock is unique meshes from each footprint, not one office costume', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const at = project(CITYSTREET_AT);
  const prints = new Set<string>();
  const kinds = new Map<string, number>();
  const facades = new Map<string, number>();
  let n = 0;
  for (const b of city.buildings) {
    const count = b.verts.length / 2;
    const ring: { x: number; z: number }[] = [];
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      const x = dequantizeX(b.verts[i * 2]!);
      const z = dequantizeY(b.verts[i * 2 + 1]!);
      ring.push({ x, z });
      cx += x;
      cz += z;
    }
    cx /= count;
    cz /= count;
    if (Math.hypot(cx - at.x, cz - at.y) / METERS_TO_WORLD > 220) continue;
    let acc = 0;
    for (let i = 0; i < count; i++) {
      const a = ring[i]!;
      const bp = ring[(i + 1) % count]!;
      acc += a.x * bp.z - bp.x * a.z;
    }
    const areaM2 = (Math.abs(acc) * 0.5) / (METERS_TO_WORLD * METERS_TO_WORLD);
    const [lng, lat] = unproject(cx, cz);
    const district = districtAt(lng, lat);
    const style = restyleForDistrict(
      resolveStyle(b.style, b.heightM, areaM2),
      b.heightM,
      areaM2,
      district,
    );
    if (b.heightM < 12) continue;
    const plan = analyzeFootprint(ring, METERS_TO_WORLD);
    const recipe = uniqueStockRecipe({
      plan,
      heightM: b.heightM,
      style,
      osmRoof: b.roof,
    });
    prints.add(recipeFingerprint(recipe));
    kinds.set(recipe.silhouette.kind, (kinds.get(recipe.silhouette.kind) ?? 0) + 1);
    facades.set(recipe.facade.kind, (facades.get(recipe.facade.kind) ?? 0) + 1);
    n += 1;
  }
  assert.ok(n > 40, `Cheapside near-field has no mid-rise stock (${n})`);
  assert.ok(prints.size >= Math.floor(n * 0.55), `stock fingerprints cloned ${prints.size}/${n}`);
  assert.ok(kinds.size >= 3, `only ${[...kinds.keys()].join(',')} silhouettes on Cheapside`);
  const dominant = Math.max(...kinds.values());
  assert.ok(dominant / n < 0.62, `one silhouette still costumes the street (${dominant}/${n})`);
  assert.ok(facades.size >= 2, `every Cheapside front still shares one façade language`);
});

check('acute and courtyard plans get stand-out massing, not a shared setback box', () => {
  const m = METERS_TO_WORLD;
  const wedge = [
    { x: 0, z: 0 },
    { x: 40 * m, z: 0 },
    { x: 8 * m, z: 28 * m },
  ];
  const wedgePlan = analyzeFootprint(wedge, m);
  const wedgeRecipe = uniqueStockRecipe({
    plan: wedgePlan,
    heightM: 28,
    style: STYLE_OFFICE,
    osmRoof: 0,
  });
  assert.equal(wedgeRecipe.silhouette.kind, 'wedge-step');
  assert.equal(wedgeRecipe.facade.kind, 'ribbon');
  assert.ok(scaleToward(wedge, wedge[0]!.x, wedge[0]!.z, 0.5)[1]!.x < wedge[1]!.x);

  const court = [
    { x: 0, z: 0 },
    { x: 50 * m, z: 0 },
    { x: 50 * m, z: 40 * m },
    { x: 30 * m, z: 40 * m },
    { x: 30 * m, z: 12 * m },
    { x: 12 * m, z: 12 * m },
    { x: 12 * m, z: 40 * m },
    { x: 0, z: 40 * m },
  ];
  const courtRecipe = uniqueStockRecipe({
    plan: analyzeFootprint(court, m),
    heightM: 22,
    style: STYLE_OFFICE,
    osmRoof: 0,
  });
  assert.equal(courtRecipe.silhouette.kind, 'courtyard');

  const plateA = [
    { x: 0, z: 0 },
    { x: 24 * m, z: 0 },
    { x: 24 * m, z: 20 * m },
    { x: 0, z: 20 * m },
  ];
  const plateB = [
    { x: 0, z: 0 },
    { x: 48 * m, z: 0 },
    { x: 48 * m, z: 16 * m },
    { x: 0, z: 16 * m },
  ];
  const a = uniqueStockRecipe({
    plan: analyzeFootprint(plateA, m),
    heightM: 32,
    style: STYLE_OFFICE,
    osmRoof: 0,
  });
  const b = uniqueStockRecipe({
    plan: analyzeFootprint(plateB, m),
    heightM: 32,
    style: STYLE_OFFICE,
    osmRoof: 0,
  });
  assert.notEqual(recipeFingerprint(a), recipeFingerprint(b));
});

check('No 1 Poultry matches the Stirling pin, not a fake Lombard costume', () => {
  assert.equal(streetUniqueAt(-0.09087, 51.51339), 'no-1-poultry');
  assert.equal(streetUniqueAt(-0.08996, 51.51374), 'the-ned');
  assert.equal(streetUniqueAt(-0.08983, 51.51262), 'walbrook');
  assert.equal(streetUniqueAt(-0.09072, 51.51379), 'old-jewry');
  assert.equal(streetUniqueAt(-0.08938, 51.51311), 'mansion-house');
  assert.equal(streetUniqueAt(-0.09065, 51.51399), 'gresham-33');
  assert.equal(streetUniqueAt(-0.09141, 51.51242), 'bloomberg');
  assert.equal(streetUniqueAt(-0.08839, 51.51408), 'bank-england');
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const at = project(CITYSTREET_AT);
  const poultryAt = project([-0.09075, 51.51332]);
  const jewryAt = project([-0.09077, 51.51381]);
  const mansionAt = project([-0.08948, 51.51297]);
  const nedAt = project([-0.09008, 51.51372]);
  const col = Math.min(CHUNK_COLS - 1, Math.max(0, Math.floor((at.x / WORLD.width) * CHUNK_COLS)));
  const row = Math.min(CHUNK_ROWS - 1, Math.max(0, Math.floor((at.y / WORLD.height) * CHUNK_ROWS)));
  const chunkId = row * CHUNK_COLS + col;
  let wellR = 8 * METERS_TO_WORLD;
  let poultryMaxR = 40 * METERS_TO_WORLD;
  let poultryCx = poultryAt.x;
  let poultryCz = poultryAt.y;
  let apexX = poultryAt.x;
  let apexZ = poultryAt.y;
  for (const b of city.buildings) {
    if (b.chunkId !== chunkId) continue;
    const n = b.verts.length / 2;
    const ring: { x: number; z: number }[] = [];
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const x = dequantizeX(b.verts[i * 2]!);
      const z = dequantizeY(b.verts[i * 2 + 1]!);
      ring.push({ x, z });
      cx += x;
      cz += z;
    }
    cx /= n;
    cz /= n;
    const [lng, lat] = unproject(cx, cz);
    if (streetUniqueAt(lng, lat) !== 'no-1-poultry') continue;
    const plan = analyzeFootprint(ring, METERS_TO_WORLD);
    wellR = poultryWellR(plan);
    poultryCx = plan.cx;
    poultryCz = plan.cz;
    poultryMaxR = 0;
    const apex = ring[plan.apexIndex] ?? { x: plan.cx, z: plan.cz };
    apexX = apex.x;
    apexZ = apex.z;
    for (const p of ring) {
      poultryMaxR = Math.max(poultryMaxR, Math.hypot(p.x - plan.cx, p.z - plan.cz));
    }
    break;
  }
  const pink = new THREE.Color(POULTRY_PINK);
  const buff = new THREE.Color(POULTRY_BUFF);
  const bronze = new THREE.Color(JEWRY_BRONZE);
  const column = new THREE.Color(MANSION_COLUMN);
  const wellCol = new THREE.Color(POULTRY_WELL);
  const roofCol = new THREE.Color(POULTRY_ROOF);
  const jewryMid = new THREE.Color(JEWRY_MID);
  const jewryHigh = new THREE.Color(JEWRY_HIGH);
  const poultryGlass = new THREE.Color(POULTRY_GLASS);
  const poultryClock = new THREE.Color(POULTRY_CLOCK);
  const poultryHand = new THREE.Color(POULTRY_CLOCK_HAND);
  const poultryMortar = new THREE.Color(POULTRY_MORTAR);
  const jewryGlass = new THREE.Color(JEWRY_GLASS);
  const nedGlass = new THREE.Color(NED_GLASS);
  let pinkN = 0;
  let buffN = 0;
  let near = 0;
  let bronzeN = 0;
  let columnN = 0;
  let holeRoof = 0;
  let wellN = 0;
  let stickN = 0;
  let jewryMidN = 0;
  let jewryHighN = 0;
  let poultryGlassN = 0;
  let poultryClockN = 0;
  let poultryClockProwN = 0;
  let poultryHandN = 0;
  let poultryMortarN = 0;
  let jewryGlassN = 0;
  let nedGlassN = 0;
  let apexPinkN = 0;
  let apexEastPinkN = 0;
  const highR: number[] = [];
  const turretR: number[] = [];
  const midR: number[] = [];
  const stickPad = 8 * METERS_TO_WORLD;
  for (const major of [true, false]) {
    const mesh = buildChunkTier(city, chunkId, major, [], createScratch());
    if (!mesh) continue;
    const pos = mesh.geometry.getAttribute('position');
    const colors = mesh.geometry.getAttribute('color');
    const nrm = mesh.geometry.getAttribute('normal');
    if (!pos || !colors) continue;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x - poultryAt.x, z - poultryAt.y) / METERS_TO_WORLD;
      const yM = y / METERS_TO_WORLD;
      const dC = Math.hypot(x - poultryCx, z - poultryCz);
      const r = colors.getX(i);
      const g = colors.getY(i);
      const b = colors.getZ(i);
      const wingTint =
        (Math.abs(r - pink.r) < 0.04 &&
          Math.abs(g - pink.g) < 0.04 &&
          Math.abs(b - pink.b) < 0.04) ||
        (Math.abs(r - buff.r) < 0.04 && Math.abs(g - buff.g) < 0.04 && Math.abs(b - buff.b) < 0.04);
      const poultryTint =
        wingTint ||
        (Math.abs(r - wellCol.r) < 0.05 &&
          Math.abs(g - wellCol.g) < 0.05 &&
          Math.abs(b - wellCol.b) < 0.05) ||
        (Math.abs(r - roofCol.r) < 0.05 &&
          Math.abs(g - roofCol.g) < 0.05 &&
          Math.abs(b - roofCol.b) < 0.05);
      if (d <= 40 && yM > 32 && poultryTint) {
        highR.push(Math.hypot(x - apexX, z - apexZ) / METERS_TO_WORLD);
      }
      if (d <= 40 && yM > 30 && poultryTint) {
        turretR.push(Math.hypot(x - apexX, z - apexZ) / METERS_TO_WORLD);
      }
      if (d <= 40 && yM > 10 && yM < 26 && wingTint) {
        midR.push(Math.hypot(x - poultryCx, z - poultryCz) / METERS_TO_WORLD);
      }
      if (d <= 55 && poultryTint && dC > poultryMaxR + stickPad) stickN += 1;
      if (
        dC < wellR * 1.08 &&
        Math.abs(r - wellCol.r) < 0.05 &&
        Math.abs(g - wellCol.g) < 0.05 &&
        Math.abs(b - wellCol.b) < 0.05
      ) {
        wellN += 1;
      }
      if (dC < wellR * 0.55 && yM > 8) {
        const r = colors.getX(i);
        const g = colors.getY(i);
        const b = colors.getZ(i);
        if (
          Math.abs(r - roofCol.r) < 0.05 &&
          Math.abs(g - roofCol.g) < 0.05 &&
          Math.abs(b - roofCol.b) < 0.05
        ) {
          holeRoof += 1;
        }
        if (Math.abs(r - 0.831) < 0.05 && Math.abs(g - 0.761) < 0.05 && Math.abs(b - 0.29) < 0.08) {
          holeRoof += 1;
        }
      }
      if (d <= 45) {
        near += 1;
        const r = colors.getX(i);
        const g = colors.getY(i);
        const b = colors.getZ(i);
        if (
          Math.abs(r - pink.r) < 0.04 &&
          Math.abs(g - pink.g) < 0.04 &&
          Math.abs(b - pink.b) < 0.04
        ) {
          pinkN += 1;
          const dApex = Math.hypot(x - apexX, z - apexZ) / METERS_TO_WORLD;
          if (dApex < 10 && yM > 6 && yM < 48) {
            apexPinkN += 1;
            if (nrm && Math.abs(nrm.getX(i)) > 0.85 && Math.abs(nrm.getY(i)) < 0.25) {
              apexEastPinkN += 1;
            }
          }
        }
        if (
          Math.abs(r - buff.r) < 0.04 &&
          Math.abs(g - buff.g) < 0.04 &&
          Math.abs(b - buff.b) < 0.04
        ) {
          buffN += 1;
        }
        if (
          Math.abs(r - poultryGlass.r) < 0.04 &&
          Math.abs(g - poultryGlass.g) < 0.04 &&
          Math.abs(b - poultryGlass.b) < 0.04
        ) {
          poultryGlassN += 1;
        }
        if (
          Math.abs(r - poultryClock.r) < 0.04 &&
          Math.abs(g - poultryClock.g) < 0.04 &&
          Math.abs(b - poultryClock.b) < 0.04
        ) {
          poultryClockN += 1;
          const dApex = Math.hypot(x - apexX, z - apexZ) / METERS_TO_WORLD;
          if (dApex < 30 && yM > 16 && yM < 90) poultryClockProwN += 1;
        }
        if (
          Math.abs(r - poultryHand.r) < 0.05 &&
          Math.abs(g - poultryHand.g) < 0.05 &&
          Math.abs(b - poultryHand.b) < 0.05
        ) {
          poultryHandN += 1;
        }
        if (
          Math.abs(r - poultryMortar.r) < 0.05 &&
          Math.abs(g - poultryMortar.g) < 0.05 &&
          Math.abs(b - poultryMortar.b) < 0.05
        ) {
          poultryMortarN += 1;
        }
      }
      const dj = Math.hypot(x - jewryAt.x, z - jewryAt.y) / METERS_TO_WORLD;
      if (dj <= 35) {
        const r = colors.getX(i);
        const g = colors.getY(i);
        const b = colors.getZ(i);
        if (
          Math.abs(r - bronze.r) < 0.05 &&
          Math.abs(g - bronze.g) < 0.05 &&
          Math.abs(b - bronze.b) < 0.05
        ) {
          bronzeN += 1;
        }
        if (
          Math.abs(r - jewryMid.r) < 0.05 &&
          Math.abs(g - jewryMid.g) < 0.05 &&
          Math.abs(b - jewryMid.b) < 0.05
        ) {
          jewryMidN += 1;
        }
        if (
          Math.abs(r - jewryHigh.r) < 0.05 &&
          Math.abs(g - jewryHigh.g) < 0.05 &&
          Math.abs(b - jewryHigh.b) < 0.05
        ) {
          jewryHighN += 1;
        }
        if (
          Math.abs(r - jewryGlass.r) < 0.05 &&
          Math.abs(g - jewryGlass.g) < 0.05 &&
          Math.abs(b - jewryGlass.b) < 0.05
        ) {
          jewryGlassN += 1;
        }
      }
      const dn = Math.hypot(x - nedAt.x, z - nedAt.y) / METERS_TO_WORLD;
      if (dn <= 40) {
        const r = colors.getX(i);
        const g = colors.getY(i);
        const b = colors.getZ(i);
        if (
          Math.abs(r - nedGlass.r) < 0.05 &&
          Math.abs(g - nedGlass.g) < 0.05 &&
          Math.abs(b - nedGlass.b) < 0.05
        ) {
          nedGlassN += 1;
        }
      }
      const dm = Math.hypot(x - mansionAt.x, z - mansionAt.y) / METERS_TO_WORLD;
      if (dm <= 40) {
        const r = colors.getX(i);
        const g = colors.getY(i);
        const b = colors.getZ(i);
        if (
          Math.abs(r - column.r) < 0.05 &&
          Math.abs(g - column.g) < 0.05 &&
          Math.abs(b - column.b) < 0.05
        ) {
          columnN += 1;
        }
      }
    }
  }
  assert.ok(near > 200, `No 1 Poultry mesh missing (${near} verts)`);
  assert.ok(
    pinkN > 80 && buffN > 80,
    `Stirling pink / yellow limestone courses missing pink=${pinkN} buff=${buffN}`,
  );
  assert.ok(
    poultryGlassN > 80,
    `Stirling glazing missing (glass=${poultryGlassN}) — blank walls are a fail`,
  );
  assert.ok(poultryClockN > 40, `Poultry dark clock faces missing (clock=${poultryClockN})`);
  assert.ok(
    poultryClockProwN > 24,
    `Stirling clocks missing from the prow turret (prowClock=${poultryClockProwN})`,
  );
  assert.ok(poultryHandN > 8, `Stirling clock red hands missing (hands=${poultryHandN})`);
  assert.ok(
    poultryMortarN > 30,
    `Poultry limestone is a band shader, not modelled courses (mortar=${poultryMortarN})`,
  );
  assert.ok(highR.length > 16, `Poultry prow missing above the wings (${highR.length} high verts)`);
  {
    const turretNear = turretR.filter((r) => r > 3 && r < 12);
    assert.ok(
      turretNear.length > 24,
      `Stirling prow missing at the apex (prow=${turretNear.length})`,
    );
    const mean = midR.length > 0 ? midR.reduce((a, v) => a + v, 0) / midR.length : 0;
    const variance =
      midR.length > 0 ? midR.reduce((a, v) => a + (v - mean) ** 2, 0) / midR.length : 0;
    const std = Math.sqrt(variance);
    const circ = mean > 0.4 ? 1 - std / mean : 1;
    const spread = midR.length > 0 ? Math.max(...midR) - Math.min(...midR) : 0;
    assert.ok(midR.length > 80, `Poultry limestone wings missing at mid-height (n=${midR.length})`);
    assert.ok(
      circ < 0.88,
      `Poultry wings are still a cylinder (circularity=${circ.toFixed(2)}, n=${midR.length})`,
    );
    assert.ok(
      spread > 5,
      `Poultry concertina has no plan fold (spread=${spread.toFixed(1)} m, n=${midR.length})`,
    );
  }
  assert.ok(wellN > 40, `Poultry courtyard well missing (${wellN} verts)`);
  assert.ok(holeRoof < 12, `Poultry courtyard well is roofed over (${holeRoof} hole verts)`);
  assert.ok(stickN < 8, `Poultry bands stick through the facade (${stickN} verts)`);
  assert.ok(
    apexPinkN < 8 || apexEastPinkN / apexPinkN < 0.22,
    `Poultry prow still has N-S limestone poles at the apex (eastFacing=${apexEastPinkN}/${apexPinkN})`,
  );
  assert.ok(bronzeN > 20, `1 Old Jewry bronze portal missing (${bronzeN} verts)`);
  assert.ok(
    jewryMidN > 20 && jewryHighN > 20,
    `1 Old Jewry is not three blocks (mid=${jewryMidN} high=${jewryHighN})`,
  );
  assert.ok(jewryGlassN > 40, `1 Old Jewry window rhythm missing (glass=${jewryGlassN})`);
  assert.ok(nedGlassN > 40, `The Ned palazzo window grid missing (glass=${nedGlassN})`);
  assert.ok(columnN > 20, `Mansion House portico columns missing (${columnN} verts)`);
});

check('City street offices are not a shared punched-window recess costume', () => {
  const m = METERS_TO_WORLD;
  const plate = [
    { x: 0, z: 0 },
    { x: 22 * m, z: 0 },
    { x: 22 * m, z: 18 * m },
    { x: 0, z: 18 * m },
  ];
  const recipe = uniqueStockRecipe({
    plan: analyzeFootprint(plate, m),
    heightM: 20,
    style: STYLE_OFFICE,
    osmRoof: 0,
  });
  assert.notEqual(recipe.facade.kind, 'recess');
});

check('Cheapside unnamed stock has in-plane window glass, not blank walls', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const at = project(CITYSTREET_AT);
  const col = Math.min(CHUNK_COLS - 1, Math.max(0, Math.floor((at.x / WORLD.width) * CHUNK_COLS)));
  const row = Math.min(CHUNK_ROWS - 1, Math.max(0, Math.floor((at.y / WORLD.height) * CHUNK_ROWS)));
  const chunkId = row * CHUNK_COLS + col;
  const pins = STREET_UNIQUE_PINS.map((p) => project([p.lng, p.lat]));
  const glassCols = [0, 1, 2, 3, 4, 5].map((s) => new THREE.Color(windowHex(s)));
  let near = 0;
  let glassN = 0;
  for (const major of [true, false]) {
    const mesh = buildChunkTier(city, chunkId, major, [], createScratch());
    if (!mesh) continue;
    const pos = mesh.geometry.getAttribute('position');
    const colors = mesh.geometry.getAttribute('color');
    if (!pos || !colors) continue;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x - at.x, z - at.y) / METERS_TO_WORLD;
      if (d > 90) continue;
      near += 1;
      let pinned = false;
      for (const pin of pins) {
        if (Math.hypot(x - pin.x, z - pin.y) / METERS_TO_WORLD <= 42) {
          pinned = true;
          break;
        }
      }
      if (pinned) continue;
      const r = colors.getX(i);
      const g = colors.getY(i);
      const b = colors.getZ(i);
      for (const c of glassCols) {
        if (Math.abs(r - c.r) < 0.04 && Math.abs(g - c.g) < 0.04 && Math.abs(b - c.b) < 0.04) {
          glassN += 1;
          break;
        }
      }
    }
  }
  assert.ok(near > 400, `Cheapside stock mesh missing (${near} verts)`);
  assert.ok(glassN > 200, `unnamed Cheapside walls are blank (glass=${glassN})`);
});

check('wide-view mesh budget clips the city; close looks stay full', () => {
  const mid = meshBudgetFromSearch(new URLSearchParams('view=mid'));
  assert.equal(mid.chunkKeepM, 1600);
  assert.equal(mid.skipAntialias, true);
  assert.equal(mid.pixelRatioCap, 1);
  assert.equal(mid.skipTrees, true);
  assert.equal(mid.skipWindows, true);
  assert.equal(mid.skipMinorChunks, false);
  assert.equal(mid.skipRoadMarks, true);
  const eye = meshBudgetFromSearch(new URLSearchParams('look=eye'));
  assert.equal(eye.chunkKeepM, 1800);
  assert.equal(eye.skipAntialias, true);
  assert.equal(eye.skipRoadMarks, true);
  const close = meshBudgetFromSearch(new URLSearchParams('look=towerbridge'));
  assert.equal(close.chunkKeepM, null);
  assert.equal(close.skipAntialias, false);
  assert.equal(close.skipTrees, false);
  assert.equal(close.skipRoadMarks, false);
  const street = meshBudgetFromSearch(new URLSearchParams('look=citystreet'));
  assert.equal(street.chunkKeepM, 1600);
  assert.equal(street.skipMinorChunks, false);
  assert.equal(street.skipRoadMarks, false);
  assert.equal(street.skipTrees, true);
  assert.equal(street.skipWindows, true);
  assert.equal(street.skipAntialias, true);
  assert.equal(street.pixelRatioCap, 1);
  const buck = meshBudgetFromSearch(new URLSearchParams('look=buckingham'));
  assert.equal(buck.chunkKeepM, 1600);
  assert.equal(buck.skipTrees, true);
  assert.equal(buck.skipAntialias, true);
  assert.equal(buck.skipRoadMarks, true);
  assert.equal(buck.skipMinorChunks, false);
});

check('keep-disk drain finishes; cover never packs with chunks', () => {
  assert.equal(BUILD_JOBS_WHILE_LOADING_KEEP, 6);
  assert.equal(buildJobsThisFrame({ ready: false, keepDisk: true, kind: 'chunk' }), 6);
  assert.equal(buildJobsThisFrame({ ready: false, keepDisk: true, kind: 'cover' }), 1);
  assert.equal(buildJobsThisFrame({ ready: false, keepDisk: false, kind: 'chunk' }), 16);
  assert.equal(buildJobsThisFrame({ ready: true, keepDisk: true, kind: 'chunk' }), 2);
  assert.equal(buildJobsThisFrame({ ready: true, keepDisk: true, kind: 'cover' }), 1);
  const kinds = [
    ...Array(10).fill('chunk' as const),
    'cover' as const,
    'cover' as const,
    'cover' as const,
    'rest' as const,
  ];
  const frames = drainBuildJobKinds(kinds, { keepDisk: true });
  for (const frame of frames) {
    assert.equal(new Set(frame).size, 1, `mixed kinds in one frame: ${frame.join(',')}`);
  }
  const coverFrames = frames.filter((f) => f[0] === 'cover');
  assert.equal(coverFrames.length, 3);
  assert.ok(coverFrames.every((f) => f.length === 1));
  assert.equal(frames[0]?.length, 6);
  assert.equal(frames[0]?.[0], 'chunk');
});

check('view=mid keep-disk does not tessellate the whole 23 km map', () => {
  const buf = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const hero = project([-0.1358, 51.5196]);
  const keep: KeepDisk = { x: hero.x, z: hero.y, r: 1600 * METERS_TO_WORLD };
  const pad = 120 * METERS_TO_WORLD;
  const tally = (root: THREE.Object3D | null, disk: KeepDisk) => {
    let verts = 0;
    let outside = 0;
    if (!root) return { verts, outside };
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const pos = obj.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        verts += 1;
        if (!inKeepDisk(pos.getX(i), pos.getZ(i), disk, pad)) outside += 1;
      }
    });
    return { verts, outside };
  };
  const roads = tally(buildRoads(city, keep), keep);
  assert.ok(roads.verts > 800, `mid-view neighbourhood has no streets (${roads.verts} verts)`);
  assert.equal(roads.outside, 0, `road verts leak outside the keep-disk (${roads.outside})`);
  const parks = tally(buildParks(city, keep), keep);
  assert.equal(parks.outside, 0, `park verts leak outside the keep-disk (${parks.outside})`);
  const water = tally(buildWater(city, keep), keep);
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
  const buckAt = project(LANDMARKS.find((l) => l.kind === 'buckingham')!.at);
  const buckKeep: KeepDisk = { x: buckAt.x, z: buckAt.y, r: 1600 * METERS_TO_WORLD };
  const buckParks = tally(buildParks(city, buckKeep), buckKeep);
  assert.ok(
    buckParks.verts > 80,
    `look=buckingham keep-disk lost Green Park (${buckParks.verts} verts)`,
  );
  assert.equal(
    buckParks.outside,
    0,
    `Buckingham park verts leak outside the keep-disk (${buckParks.outside})`,
  );
  const unclipped = tally(buildParks(city), buckKeep);
  assert.ok(
    buckParks.verts < unclipped.verts,
    `Buckingham parks still tessellate the whole map (${buckParks.verts} vs ${unclipped.verts})`,
  );
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
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi)
        inside = !inside;
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
