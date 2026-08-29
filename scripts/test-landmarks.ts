/**
 * Landmark prefab + deck-height checks — offline, no DOM.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isDeckLandmark, METERS_TO_WORLD } from '../lib/game/geo';
import { ROAD_Y } from '../lib/game/render3d/cityBuilder';
import { EYE_WHEEL_NAME, LANDMARK_DECK_Y, build } from '../lib/game/render3d/landmarks';
import { HEIGHT_SCALE } from '../lib/game/render3d/buildingStyle';
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

check('Tower Bridge carries a designed asphalt deck through the Gothic towers', () => {
  const bridge = build('towerbridge');
  const deck = bridge.getObjectByName('deck');
  assert.ok(deck instanceof THREE.Mesh, 'Tower Bridge needs a named deck');
  const box = new THREE.Box3().setFromObject(deck);
  const spanM = (box.max.z - box.min.z) / METERS_TO_WORLD;
  assert.ok(spanM > 220, `deck must reach both banks, got ${spanM.toFixed(0)} m`);
  assert.ok(
    box.min.z < -40 * METERS_TO_WORLD && box.max.z > 40 * METERS_TO_WORLD,
    'deck must pass through both towers',
  );
  const mat = Array.isArray(deck.material) ? deck.material[0] : deck.material;
  assert.ok(mat && 'color' in mat && (mat as THREE.MeshLambertMaterial).color.getHex() === ASPHALT);
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

check('civic landmarks are unique meshes with their own colours, not type paints', () => {
  const kinds = [
    'britishmuseum',
    'allsouls',
    'goodgest',
    'stcharles',
    'nationaltheatre',
    'tatemodern',
    'stpancras',
    'alberthall',
  ] as const;
  const wallHexes = new Set<number>();
  for (const kind of kinds) {
    const root = build(kind);
    let meshes = 0;
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      meshes += 1;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (mat && 'color' in mat) wallHexes.add((mat as THREE.MeshLambertMaterial).color.getHex());
    });
    assert.ok(meshes >= 8, `${kind} is still an extrusion (${meshes} meshes)`);
  }
  assert.ok(wallHexes.size >= 6, `civic walls collapsed to ${wallHexes.size} paints`);
  let cones = 0;
  build('allsouls').traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'ConeGeometry') cones += 1;
  });
  assert.ok(cones >= 1, 'All Souls needs a needle spire');
  let cylinders = 0;
  build('britishmuseum').traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'CylinderGeometry') cylinders += 1;
  });
  assert.ok(cylinders >= 8, `British Museum colonnade, got ${cylinders} cylinders`);
  assert.ok(countGlow(build('stpancras')) >= 1, 'St Pancras clock should glow');
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

check('Tower of London is a concentric fortress, not a courtyard slab', () => {
  const root = build('towerlondon');
  assert.ok(root.getObjectByName('white-tower'), 'White Tower keep');
  assert.ok(root.getObjectByName('outer-curtain'), 'outer curtain wall');
  assert.ok(root.getObjectByName('inner-curtain'), 'inner curtain wall');
  let cones = 0;
  let cylinders = 0;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.geometry.type === 'ConeGeometry') cones += 1;
    if (obj.geometry.type === 'CylinderGeometry') cylinders += 1;
    if (obj.geometry instanceof THREE.BoxGeometry) {
      const p = obj.geometry.parameters;
      const slab =
        p.width > 80 * METERS_TO_WORLD &&
        p.depth > 60 * METERS_TO_WORLD &&
        p.height > 5 * METERS_TO_WORLD * HEIGHT_SCALE &&
        p.height < 15 * METERS_TO_WORLD * HEIGHT_SCALE;
      assert.equal(slab, false, 'old courtyard office plate must not return');
    }
  });
  assert.ok(cones >= 8, `wall and keep turrets need conical roofs, got ${cones}`);
  assert.ok(cylinders >= 6, `round mural towers, got ${cylinders}`);
});

console.log(`\nAll ${passed} landmark geometry checks passed.`);
