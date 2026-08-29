/**
 * Landmark prefab + deck-height checks — offline, no DOM.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isDeckLandmark } from '../lib/game/geo';
import { ROAD_Y } from '../lib/game/render3d/cityBuilder';
import { EYE_WHEEL_NAME, LANDMARK_DECK_Y, build } from '../lib/game/render3d/landmarks';

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

check('Tower Bridge keeps its towers without a competing road slab', () => {
  const bridge = build('towerbridge');
  assert.equal(bridge.getObjectByName('deck'), undefined);
  let cones = 0;
  bridge.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'ConeGeometry') cones += 1;
  });
  assert.ok(cones >= 2, `expected Tower Bridge spires, got ${cones}`);
});

check('Hungerford keeps river piers, not a leftover deck box', () => {
  const br = build('hungerford');
  assert.equal(br.getObjectByName('deck'), undefined);
  let boxes = 0;
  br.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'BoxGeometry') boxes += 1;
  });
  assert.ok(boxes >= 4, `expected Hungerford piers, got ${boxes}`);
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

check('river prefabs do not carry a competing carriageway slab', () => {
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
    assert.equal(build(kind).getObjectByName('deck'), undefined, `${kind} still has a deck box`);
  }
});

check('beam-bridge piers sit under the asphalt, not over it', () => {
  for (const kind of [
    'westminsterbr',
    'lambethbr',
    'waterloobr',
    'blackfriarsbr',
    'londonbr',
  ] as const) {
    let maxTop = 0;
    build(kind).traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const box = new THREE.Box3().setFromObject(obj);
      maxTop = Math.max(maxTop, box.max.y);
    });
    assert.ok(
      maxTop <= ROAD_Y + 0.01,
      `${kind} pier top ${maxTop.toFixed(3)} sits on top of the road (${ROAD_Y})`,
    );
  }
});

console.log(`\nAll ${passed} landmark geometry checks passed.`);
