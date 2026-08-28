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
  resolveStyle,
  restyleForDistrict,
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
import { clampWallColour, isConfettiHue, paletteFor, wallHex } from '../lib/game/render3d/palette';

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
  assert.equal(restyleForDistrict(STYLE_APARTMENTS, 20, 400, 'westminster'), STYLE_OFFICE);
});

check('towers extrude taller than houses', () => {
  assert.ok(
    extrusionScale(STYLE_TOWER, 200, 'canary') > extrusionScale(STYLE_TERRACE, 12, 'kensington'),
  );
  assert.equal(extrusionScale(STYLE_TOWER, 200, 'canary'), TOWER_HEIGHT_SCALE);
  assert.equal(extrusionScale(STYLE_TERRACE, 10, 'inner'), HEIGHT_SCALE);
});

console.log(`\nAll ${passed} OSM colour / façade UV checks passed.`);
