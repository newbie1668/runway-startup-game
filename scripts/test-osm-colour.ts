/**
 * OSM colour packing — offline, no DOM.
 */
import assert from 'node:assert/strict';
import {
  STYLE_APARTMENTS,
  STYLE_HOUSE,
  STYLE_INDUSTRIAL,
  STYLE_OFFICE,
  STYLE_RETAIL,
  STYLE_TERRACE,
  STYLE_TOWER,
  classifyBuilding,
  districtAt,
  extrusionScale,
  facadeVForFloors,
  facadeWindowRhythm,
  resolveStyle,
  restyleForDistrict,
  stockMassing,
  wantFacadeWindows,
  TOWER_HEIGHT_SCALE,
  HEIGHT_SCALE,
} from '../lib/game/render3d/buildingStyle';
import {
  fromRgb565,
  isGenericWallPaint,
  parseCssColour,
  resolveRoofColour,
  resolveWallColour,
  toRgb565,
} from '../lib/game/render3d/osmColour';
import {
  clampWallColour,
  facadeFamily,
  isConfettiHue,
  paletteFor,
  rgbToHsl,
  roofHex,
  wallHex,
} from '../lib/game/render3d/palette';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('OSM colour packing');

check('parses hex and named CSS colours', () => {
  assert.equal(parseCssColour('#CDCDCD'), 0xcdcdcd);
  assert.equal(parseCssColour('#fff'), 0xffffff);
  assert.equal(parseCssColour('cream'), 0xe8dcc8);
  assert.equal(parseCssColour('nope'), null);
});

check('prefers explicit colour over material', () => {
  assert.equal(
    resolveWallColour({ 'building:colour': '#717E87', 'building:material': 'glass' }),
    0x717e87,
  );
  assert.equal(resolveWallColour({ 'building:material': 'brick' }), 0xb85c3a);
  assert.equal(resolveRoofColour({ 'roof:material': 'slate' }), 0x6a7080);
});

check('rgb565 round-trips close enough for façade paints', () => {
  const packed = toRgb565(0xb85c3a);
  assert.ok(packed > 0);
  const back = fromRgb565(packed)!;
  const dr = Math.abs(((back >> 16) & 255) - 0xb8);
  const dg = Math.abs(((back >> 8) & 255) - 0x5c);
  const db = Math.abs((back & 255) - 0x3a);
  assert.ok(dr <= 8 && dg <= 4 && db <= 8, `drift ${dr},${dg},${db}`);
  assert.equal(toRgb565(null), 0);
  assert.equal(fromRgb565(0), null);
});

check('window UVs cover a full storey row, not a stretched sliver', () => {
  const terrace = facadeVForFloors(STYLE_TERRACE, 4);
  assert.ok(terrace.v1 - terrace.v0 > 0.18, `terrace span ${terrace.v1 - terrace.v0}`);
  const tower = facadeVForFloors(STYLE_TOWER, 8);
  assert.ok(tower.v1 - tower.v0 > 0.18, `tower span ${tower.v1 - tower.v0}`);
});

check('muted London palette has no confetti hues', () => {
  assert.equal(isConfettiHue(0x00ff88), true);
  assert.equal(isConfettiHue(0xff00ff), true);
  assert.equal(isConfettiHue(0x00e5ff), true);
  assert.equal(isConfettiHue(0xc9ae86), false);
  assert.equal(clampWallColour(0xff00aa), null);
  const brick = clampWallColour(0xb53931);
  assert.ok(brick !== null);
  assert.equal(isConfettiHue(brick!), false);
  const w = wallHex(STYLE_TERRACE, 'islington', 10, 10, 12345, null);
  assert.equal(isConfettiHue(w), false);
  for (const d of ['canary', 'city', 'westminster', 'shoreditch', 'south'] as const) {
    for (const hex of paletteFor(STYLE_TERRACE, d))
      assert.equal(isConfettiHue(hex), false, hex.toString(16));
    for (const hex of paletteFor(STYLE_TOWER, d))
      assert.equal(isConfettiHue(hex), false, hex.toString(16));
    for (const hex of paletteFor(STYLE_RETAIL, d))
      assert.equal(isConfettiHue(hex), false, hex.toString(16));
  }
});

check('generic OSM material / pale greys are not treated as unique paints', () => {
  assert.equal(isGenericWallPaint(0xb85c3a), true); // brick
  assert.equal(isGenericWallPaint(0xe8dcc8), true); // plaster
  assert.equal(isGenericWallPaint(0xcdcdcd), true); // pale grey
  assert.equal(isGenericWallPaint(0xb53931), false); // tagged red
  assert.equal(isGenericWallPaint(0x2a6ab4), false); // tagged blue
});

check('tall residential OSM tags become towers, not brick apartments', () => {
  assert.equal(classifyBuilding({ building: 'apartments' }, 187, 900).style, STYLE_TOWER);
  assert.equal(resolveStyle(STYLE_APARTMENTS, 200, 1200), STYLE_TOWER);
  assert.equal(resolveStyle(STYLE_APARTMENTS, 20, 400), STYLE_APARTMENTS);
});

check('district boxes match the labelled neighbourhoods', () => {
  assert.equal(districtAt(-0.0196, 51.505), 'canary');
  assert.equal(districtAt(-0.193, 51.4985), 'kensington');
  assert.equal(districtAt(-0.081, 51.526), 'shoreditch');
  assert.equal(districtAt(-0.1246, 51.5007), 'westminster');
  assert.equal(districtAt(-0.0925, 51.5158), 'city');
  assert.equal(districtAt(-0.1196, 51.5033), 'southbank');
  assert.equal(districtAt(-0.115, 51.4605), 'south');
  assert.equal(districtAt(-0.148, 51.5098), 'westend');
});

check('Canary Wharf restyles mid-rises to glass, Shoreditch to warehouses', () => {
  assert.equal(restyleForDistrict(STYLE_APARTMENTS, 40, 800, 'canary'), STYLE_TOWER);
  assert.equal(restyleForDistrict(STYLE_TERRACE, 16, 300, 'shoreditch'), STYLE_INDUSTRIAL);
  assert.equal(restyleForDistrict(STYLE_HOUSE, 12, 180, 'kensington'), STYLE_TERRACE);
  assert.equal(restyleForDistrict(STYLE_APARTMENTS, 20, 400, 'westminster'), STYLE_APARTMENTS);
  assert.equal(restyleForDistrict(STYLE_APARTMENTS, 28, 400, 'westminster'), STYLE_OFFICE);
});

check('street-front windows skip terrace party walls and tiny edges', () => {
  assert.equal(wantFacadeWindows(6, 10, STYLE_TERRACE), true);
  assert.equal(wantFacadeWindows(22, 10, STYLE_TERRACE), false);
  assert.equal(wantFacadeWindows(2.5, 10, STYLE_TERRACE), false);
  assert.equal(wantFacadeWindows(4, 4, STYLE_HOUSE), false);
  assert.equal(wantFacadeWindows(18, 30, STYLE_OFFICE), true);
  assert.equal(wantFacadeWindows(18, 80, STYLE_TOWER), false);
});

check('pitched and terrace roofs stay muted brown/slate, not confetti', () => {
  for (let seed = 0; seed < 24; seed++) {
    const hex = roofHex(STYLE_TERRACE, true, seed);
    assert.equal(isConfettiHue(hex), false, hex.toString(16));
    const { s, l } = rgbToHsl(hex);
    assert.ok(s <= 0.45, `roof sat ${s}`);
    assert.ok(l <= 0.55, `roof light ${l}`);
  }
});

check('Canary glass is muted but not near-black', () => {
  for (const hex of paletteFor(STYLE_TOWER, 'canary')) {
    const { l } = rgbToHsl(hex);
    assert.ok(l >= 0.32, `${hex.toString(16)} l=${l}`);
    assert.equal(isConfettiHue(hex), false);
  }
});

check('Canary towers ignore black OSM paints', () => {
  const hex = wallHex(STYLE_TOWER, 'canary', 10, 10, 1, 0x000000);
  const { l } = rgbToHsl(hex);
  assert.ok(l >= 0.32, `black OSM tower became ${hex.toString(16)} l=${l}`);
});

check('City towers use readable glass, not charcoal silhouettes', () => {
  for (const hex of paletteFor(STYLE_TOWER, 'city')) {
    const { l } = rgbToHsl(hex);
    assert.ok(l >= 0.32, `${hex.toString(16)} l=${l}`);
  }
});

check('West End terrace street mixes cream, brick, and grey families', () => {
  const families = new Set<string>();
  const hexes = new Set<number>();
  for (let i = 0; i < 16; i++) {
    const cx = i * 0.12;
    const seed = 1000 + i * 7919;
    hexes.add(wallHex(STYLE_TERRACE, 'westend', cx, 10, seed, null));
    families.add(facadeFamily(STYLE_TERRACE, 'westend', cx, 10, seed));
  }
  assert.ok(hexes.size >= 10, `expected many paints, got ${hexes.size}`);
  assert.ok(families.size >= 3, `families ${[...families].join(',')}`);
  assert.ok(families.has('brick'), 'street must include brick');
  assert.ok(families.has('cream') || families.has('yellow'), 'street must include stucco/yellow');
  assert.ok(families.has('grey') || families.has('portland'), 'street must include stone/grey');
  const a = wallHex(STYLE_TERRACE, 'westend', 0, 0, 1, null);
  const b = wallHex(STYLE_TERRACE, 'westend', 2.4, 1.1, 99_001, null);
  assert.notEqual(a, b, 'adjacent hashes should pick different swatches');
});

check('street-scale offices mix stone and brick, not one grey plate', () => {
  const families = new Set<string>();
  for (let i = 0; i < 12; i++) {
    families.add(facadeFamily(STYLE_OFFICE, 'westend', i * 0.2, 4, i * 3331 + 17));
  }
  assert.ok(families.size >= 3, `office families ${[...families].join(',')}`);
  assert.ok(families.has('brick') || families.has('cream'), 'offices should not be all grey');
});

check('generic OSM brick is a family hint, not one cloned hex', () => {
  const a = wallHex(STYLE_TERRACE, 'westend', 0, 0, 11, 0xb85c3a);
  const b = wallHex(STYLE_TERRACE, 'westend', 1.1, 0.4, 44_001, 0xb85c3a);
  assert.notEqual(a, b);
  const plaster = wallHex(STYLE_TERRACE, 'westend', 0, 0, 11, 0xe8dcc8);
  assert.notEqual(a, plaster, 'brick vs plaster hints must not share a paint');
});

check('neighbouring terraces keep different sash pitches', () => {
  const a = facadeWindowRhythm(STYLE_TERRACE, false, 12);
  const b = facadeWindowRhythm(STYLE_TERRACE, false, 99_001);
  assert.notEqual(a.pitchU, b.pitchU);
  assert.notEqual(`${a.colCap}x${a.rowCap}`, `${b.colCap}x${b.rowCap}`);
});

check('stock massing is a silhouette family, not a City slab costume', () => {
  assert.notEqual(
    stockMassing({
      style: STYLE_OFFICE,
      roof: 0,
      heightM: 28,
      areaM2: 500,
      district: 'city',
      seed: 1,
    }),
    'slab',
  );
  assert.equal(
    stockMassing({
      style: STYLE_TOWER,
      roof: 0,
      heightM: 80,
      areaM2: 900,
      district: 'canary',
      seed: 3,
    }),
    'slab',
  );
  assert.equal(
    stockMassing({
      style: STYLE_TERRACE,
      roof: 0,
      heightM: 11,
      areaM2: 140,
      district: 'kensington',
      seed: 4,
    }),
    'gable',
  );
});

check('towers extrude taller than houses', () => {
  assert.ok(
    extrusionScale(STYLE_TOWER, 200, 'canary') > extrusionScale(STYLE_TERRACE, 12, 'kensington'),
  );
  assert.equal(extrusionScale(STYLE_TOWER, 200, 'canary'), TOWER_HEIGHT_SCALE);
  assert.equal(extrusionScale(STYLE_TERRACE, 10, 'inner'), HEIGHT_SCALE);
});

console.log(`\nAll ${passed} OSM colour / façade UV checks passed.`);
