/**
 * Landmark prefab + deck-height checks — offline, no DOM.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isDeckLandmark, LANDMARKS, METERS_TO_WORLD } from '../lib/game/geo';
import { ROAD_Y } from '../lib/game/render3d/cityBuilder';
import { EYE_WHEEL_NAME, LANDMARK_DECK_Y, build } from '../lib/game/render3d/landmarks';
import { HEIGHT_SCALE } from '../lib/game/render3d/buildingStyle';
import { ASPHALT } from '../lib/game/render3d/palette';
import { instantiateLandmark } from '../lib/game/render3d/landmarkPrefabs';

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
  assert.ok(spanM > 360, `deck must reach both banks, got ${spanM.toFixed(0)} m`);
  assert.ok(
    box.min.z < -40 * METERS_TO_WORLD && box.max.z > 40 * METERS_TO_WORLD,
    'deck must pass through both towers',
  );
  const mat = Array.isArray(deck.material) ? deck.material[0] : deck.material;
  assert.ok(mat && 'color' in mat);
  assert.equal((mat as THREE.MeshBasicMaterial).color.getHex(), ASPHALT);
  assert.equal(
    mat.type,
    'MeshBasicMaterial',
    'deck must stay asphalt under the sun, not pick up river light',
  );
  let cones = 0;
  bridge.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'ConeGeometry') cones += 1;
  });
  assert.ok(cones >= 2, `expected Tower Bridge spires, got ${cones}`);
  assert.ok(bridge.getObjectByName('abutment'), 'stone abutments on the banks');
  assert.ok(bridge.getObjectByName('apron'), 'asphalt apron overlapping the bank road');
  const walk = bridge.getObjectByName('walkway');
  assert.ok(walk instanceof THREE.Mesh, 'high walkways between the towers');
  const walkBox = new THREE.Box3().setFromObject(walk);
  const walkYM = (walkBox.max.y - walkBox.min.y) / METERS_TO_WORLD;
  const walkZM = (walkBox.max.z - walkBox.min.z) / METERS_TO_WORLD;
  assert.ok(walkYM < 12, `walkway must sit level, height ${walkYM.toFixed(1)} m`);
  assert.ok(walkZM > 60, `walkway must span both towers, length ${walkZM.toFixed(0)} m`);
  assert.ok(bridge.getObjectByName('portal'), 'Gothic portal on the tower face');
  let tubes = 0;
  let hangers = 0;
  bridge.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.geometry.type === 'TubeGeometry') tubes += 1;
    if (obj.geometry.type === 'CylinderGeometry') {
      const b = new THREE.Box3().setFromObject(obj);
      const yM = (b.max.y - b.min.y) / METERS_TO_WORLD;
      const zM = (b.max.z - b.min.z) / METERS_TO_WORLD;
      if (yM > 4 && zM > 8) hangers += 1;
    }
  });
  assert.equal(tubes, 0, 'chains must be attached cylinders, not floating tubes');
  assert.ok(hangers >= 4, `chains must run from the towers down to the deck, got ${hangers}`);
  assert.ok(bridge.getObjectByName('chain'), 'chains leave the towers, not the walkway slab');
  const deckBox = new THREE.Box3().setFromObject(deck);
  const walkAxis = new THREE.Box3().setFromObject(walk);
  const deckSpanZ = deckBox.max.z - deckBox.min.z;
  const deckSpanX = deckBox.max.x - deckBox.min.x;
  const walkSpanZ = walkAxis.max.z - walkAxis.min.z;
  const walkSpanX = walkAxis.max.x - walkAxis.min.x;
  assert.ok(deckSpanZ > deckSpanX * 8, 'designed deck must run with the towers, along Z');
  assert.ok(walkSpanZ > walkSpanX * 4, 'walkway must run with the deck, not across it');
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
  assert.ok(root.getObjectByName('ward-court'), 'stone ward, not a beige exclusion hole');
  const keep = root.getObjectByName('white-tower')!;
  const keepBox = new THREE.Box3().setFromObject(keep);
  const keepWM = (keepBox.max.x - keepBox.min.x) / METERS_TO_WORLD;
  const keepDM = (keepBox.max.z - keepBox.min.z) / METERS_TO_WORLD;
  assert.ok(
    keepWM > 40 && keepDM > 40,
    `White Tower must read as a cubic keep, got ${keepWM.toFixed(0)}×${keepDM.toFixed(0)} m`,
  );
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
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!('color' in mat)) continue;
      const hex = (mat as THREE.MeshBasicMaterial).color.getHex();
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      assert.ok(
        !(g > r + 18 && g > b + 18),
        `fortress must not carry a green hedge/lawn (${hex.toString(16)})`,
      );
    }
  });
  assert.ok(cones >= 8, `wall and keep turrets need conical roofs, got ${cones}`);
  assert.ok(cylinders >= 6, `round mural towers, got ${cylinders}`);
  const tb = LANDMARKS.find((l) => l.kind === 'towerbridge')!;
  assert.equal(tb.yaw, undefined, 'Tower Bridge must not take a stitch yaw');
  const tol = LANDMARKS.find((l) => l.kind === 'towerlondon')!;
  assert.ok((tol.exclusionM ?? 0) >= 140, 'Tower of London must punch the surrounding park');
});

check('Buckingham Palace carries MeshBasic garden lawns, not a dirt moat', () => {
  const palace = build('buckingham');
  const lawns: THREE.Mesh[] = [];
  palace.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.name === 'lawn') lawns.push(obj);
  });
  assert.ok(lawns.length >= 3, `expected garden plates, got ${lawns.length}`);
  let west = 0;
  let north = 0;
  for (const mesh of lawns) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    assert.equal(mat.type, 'MeshBasicMaterial', `${mat.type} would relight the lawn`);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.min.x < -80 * METERS_TO_WORLD) west += 1;
    if (box.min.z < -60 * METERS_TO_WORLD) north += 1;
  }
  assert.ok(west >= 1, 'west private garden missing');
  assert.ok(north >= 1, 'north Green Park apron missing');
});

check('One Canada Square playtime mesh keeps the pyramid, not a crushed GLB box', () => {
  const dummy = new THREE.Group();
  dummy.name = 'crushed';
  dummy.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshLambertMaterial({ color: 0x445566 }),
    ),
  );
  const prefabs = new Map();
  prefabs.set('canadasq', dummy);
  const group = instantiateLandmark('canadasq', prefabs);
  assert.equal(group.getObjectByName('crushed'), undefined);
  assert.ok(group.getObjectByName('canadasq-pyramid'), 'Foster pyramid hat');
});

check('London City Airport is a runway in the docks, not a grey rectangle', () => {
  const air = build('lcy');
  const runway = air.getObjectByName('runway');
  assert.ok(runway instanceof THREE.Mesh, 'needs a named 09/27 runway');
  const box = new THREE.Box3().setFromObject(runway);
  const eastM = (box.max.x - box.min.x) / METERS_TO_WORLD;
  const northM = (box.max.z - box.min.z) / METERS_TO_WORLD;
  assert.ok(eastM > 1400 && eastM < 1700, `runway length ${eastM.toFixed(0)} m`);
  assert.ok(northM > 20 && northM < 50, `runway width ${northM.toFixed(0)} m`);
  assert.ok(air.getObjectByName('terminal'), 'south-side terminal');
  assert.ok(air.getObjectByName('tower'), 'south-side control tower');
  assert.ok(air.getObjectByName('apron'), 'stands south of the runway');
  const dummy = new THREE.Group();
  dummy.name = 'costume';
  dummy.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.2)));
  const prefabs = new Map();
  prefabs.set('lcy', dummy);
  const live = instantiateLandmark('lcy', prefabs);
  assert.equal(live.getObjectByName('costume'), undefined);
  assert.ok(live.getObjectByName('runway'));
});

console.log(`\nAll ${passed} landmark geometry checks passed.`);
