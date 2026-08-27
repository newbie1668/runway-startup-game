/**
 * OSM colour packing — offline, no DOM.
 */
import assert from 'node:assert/strict';
import { STYLE_TERRACE, STYLE_TOWER, facadeVForFloors } from '../lib/game/render3d/buildingStyle';
import {
  fromRgb565,
  isGenericWallPaint,
  parseCssColour,
  resolveRoofColour,
  resolveWallColour,
  toRgb565,
} from '../lib/game/render3d/osmColour';

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
  assert.equal(resolveWallColour({ 'building:colour': '#717E87', 'building:material': 'glass' }), 0x717e87);
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

check('generic OSM material / pale greys are not treated as unique paints', () => {
  assert.equal(isGenericWallPaint(0xb85c3a), true); // brick
  assert.equal(isGenericWallPaint(0xe8dcc8), true); // plaster
  assert.equal(isGenericWallPaint(0xcdcdcd), true); // pale grey
  assert.equal(isGenericWallPaint(0xb53931), false); // tagged red
  assert.equal(isGenericWallPaint(0x2a6ab4), false); // tagged blue
});

console.log(`\nAll ${passed} OSM colour / façade UV checks passed.`);
