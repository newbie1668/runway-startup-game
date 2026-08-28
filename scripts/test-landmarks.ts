/**
 * Landmark prefab + deck-height checks — offline, no DOM.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isDeckLandmark } from '../lib/game/geo';
import { ROAD_Y } from '../lib/game/render3d/cityBuilder';
import { EYE_WHEEL_NAME, LANDMARK_DECK_Y, build } from '../lib/game/render3d/landmarks';
import { ASPHALT } from '../lib/game/render3d/palette';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('Landmark geometry');

check('Thames crossings are deck landmarks; the Eye is not', () => {
  assert.equal(isDeckLandmark('towerbridge'), true);
  assert.equal(isDeckLandmark('hungerford'), true);
  assert.equal(isDeckLandmark('westminsterbr'), true);
  assert.equal(isDeckLandmark('eye'), false);
  assert.equal(isDeckLandmark('gherkin'), false);
});

check('bridge decks sit above OSM carriageways', () => {
  assert.ok(LANDMARK_DECK_Y > ROAD_Y, `${LANDMARK_DECK_Y} vs ${ROAD_Y}`);
});

check('London Eye A-frame meets the hub', () => {
  const eye = build('eye');
  const wheel = eye.getObjectByName(EYE_WHEEL_NAME);
  assert.ok(wheel, 'missing eyeWheel group');
  const hub = new THREE.Vector3(0, wheel.position.y, 0);
  let hits = 0;
  for (const child of eye.children) {
    if (child === wheel) continue;
    child.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (box.distanceToPoint(hub) < 0.08) hits += 1;
    });
  }
  assert.ok(hits >= 2, `expected axle/legs at the hub, got ${hits}`);
});

check('Tower Bridge has a deck at LANDMARK_DECK_Y', () => {
  const bridge = build('towerbridge');
  let found = false;
  bridge.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Math.abs(obj.position.y - LANDMARK_DECK_Y) > 0.03) return;
    const size = new THREE.Vector3();
    obj.geometry.computeBoundingBox();
    obj.geometry.boundingBox?.getSize(size);
    if (size.z > size.x) found = true;
  });
  assert.ok(found, 'no along-Z deck slab at deck height');
});

check('Hungerford deck matches LANDMARK_DECK_Y', () => {
  const br = build('hungerford');
  let found = false;
  br.traverse((obj) => {
    if (obj instanceof THREE.Mesh && Math.abs(obj.position.y - LANDMARK_DECK_Y) < 0.03) {
      found = true;
    }
  });
  assert.ok(found);
});

function countGlow(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    if (mats.some((m) => m instanceof THREE.MeshBasicMaterial)) n += 1;
  });
  return n;
}

check('Shard keeps glowing ridge lines', () => {
  assert.ok(countGlow(build('shard')) >= 8, 'Shard silhouette needs MeshBasicMaterial ridges');
});

check('Gherkin keeps a diagrid plus window panes', () => {
  const g = build('gherkin');
  assert.ok(countGlow(g) >= 8, 'Gherkin diagrid should glow');
  let panes = 0;
  g.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'PlaneGeometry') panes += 1;
  });
  assert.ok(panes >= 16, `expected Gherkin window panes, got ${panes}`);
});

check("St Paul's nave has a window grid and dome ridges", () => {
  const st = build('stpauls');
  assert.ok(countGlow(st) >= 8, "St Paul's dome ridges");
  let boxes = 0;
  st.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'BoxGeometry') boxes += 1;
  });
  assert.ok(boxes >= 40, `nave window grid should add boxes, got ${boxes}`);
});

function deckHex(kind: Parameters<typeof build>[0]): number | null {
  const root = build(kind);
  const deck = root.getObjectByName('deck');
  if (!(deck instanceof THREE.Mesh)) return null;
  const mat = deck.material;
  if (mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshBasicMaterial) {
    return mat.color.getHex();
  }
  return null;
}

check('named Thames decks use street asphalt, not park green or brick red', () => {
  for (const kind of [
    'westminsterbr',
    'lambethbr',
    'waterloobr',
    'blackfriarsbr',
    'londonbr',
    'millennium',
    'albertbr',
    'hungerford',
    'towerbridge',
  ] as const) {
    const hex = deckHex(kind);
    assert.equal(hex, ASPHALT, `${kind} deck ${hex?.toString(16)} should be asphalt`);
  }
});

console.log(`\nAll ${passed} landmark geometry checks passed.`);
