/**
 * Landmark prefab + deck-height checks — offline, no DOM.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isDeckLandmark, LANDMARKS, METERS_TO_WORLD } from '../lib/game/geo';
import { PARK_Y, ROAD_Y } from '../lib/game/render3d/cityBuilder';
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
  let legs = 0;
  bridge.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'ConeGeometry') cones += 1;
    if (obj.name === 'tb-leg' || obj.name === 'tb-leg-e') legs += 1;
  });
  assert.equal(cones, 0, `Disney cones still on the towers (${cones})`);
  assert.ok(legs >= 2, `two-legged portal frames, got ${legs} named legs`);
  assert.ok(bridge.getObjectByName('tb-roof'), 'pitched roof over the portal, not a cone');
  assert.ok(bridge.getObjectByName('abutment'), 'stone abutments on the banks');
  assert.ok(bridge.getObjectByName('apron'), 'asphalt apron overlapping the bank road');
  const walk = bridge.getObjectByName('walkway');
  assert.ok(walk instanceof THREE.Mesh, 'high walkways between the towers');
  assert.ok(Math.abs(walk.rotation.y) < 1e-8, 'walkway must share the deck heading');
  assert.ok(Math.abs(deck.rotation.y) < 1e-8, 'deck stays on the designed Z axis');
  const walkBox = new THREE.Box3().setFromObject(walk);
  const walkYM = (walkBox.max.y - walkBox.min.y) / METERS_TO_WORLD;
  const walkZM = (walkBox.max.z - walkBox.min.z) / METERS_TO_WORLD;
  const walkXM = (walkBox.max.x - walkBox.min.x) / METERS_TO_WORLD;
  assert.ok(walkYM < 12, `walkway must sit level, height ${walkYM.toFixed(1)} m`);
  assert.ok(walkZM > 70, `walkway must span both towers, length ${walkZM.toFixed(0)} m`);
  assert.ok(walkZM > walkXM * 8, 'walkway must run with the deck, not across the towers');
  const walkMat = Array.isArray(walk.material) ? walk.material[0] : walk.material;
  assert.notEqual(
    (walkMat as THREE.MeshBasicMaterial).color.getHex(),
    0x2f62b8,
    'walkways must not be bright-blue chords',
  );
  assert.ok(bridge.getObjectByName('portal'), 'Gothic portal on the tower face');
  const deckAt = LANDMARK_DECK_Y;
  let blocking = 0;
  bridge.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.name === 'deck' || obj.name === 'apron') return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!(mat && 'color' in mat)) return;
    const hex = (mat as THREE.MeshLambertMaterial).color.getHex();
    if (hex === ASPHALT || hex === 0xd8dce0 || hex === 0x3c4654 || hex === 0x243040) return;
    const b = new THREE.Box3().setFromObject(obj);
    const inX = b.min.x < 4 * METERS_TO_WORLD && b.max.x > -4 * METERS_TO_WORLD;
    const inY = b.min.y < deckAt + 8 * METERS_TO_WORLD && b.max.y > deckAt - 1 * METERS_TO_WORLD;
    const inZ = b.min.z < 40 * METERS_TO_WORLD && b.max.z > -40 * METERS_TO_WORLD;
    if (inX && inY && inZ) blocking += 1;
  });
  assert.equal(blocking, 0, `stone still fills the roadway portal (${blocking} meshes)`);
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
  const chain = bridge.getObjectByName('chain');
  assert.ok(chain, 'chains leave the towers, not the walkway slab');
  assert.ok(
    Math.abs(chain.position.x - walk.position.x) < 0.5 * METERS_TO_WORLD,
    'chains must share the walkway X, not a third axis',
  );
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
  let carpet = 0;
  for (const mesh of lawns) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    assert.equal(mat.type, 'MeshBasicMaterial', `${mat.type} would relight the lawn`);
    if (Math.abs(mesh.position.y - PARK_Y) < 0.002) carpet += 1;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.min.x < -80 * METERS_TO_WORLD) west += 1;
    if (box.min.z < -60 * METERS_TO_WORLD) north += 1;
  }
  assert.ok(carpet >= 3, `garden plates must sit on PARK_Y, got ${carpet}`);
  assert.ok(west >= 1, 'west private garden missing');
  assert.ok(north >= 1, 'north Green Park apron missing');
});

check('Buckingham east front is a Portland palace, not a courtyard doughnut', () => {
  const palace = build('buckingham');
  const east = palace.getObjectByName('east-front');
  assert.ok(east instanceof THREE.Mesh, 'named Mall facade');
  const mat = Array.isArray(east.material) ? east.material[0] : east.material;
  assert.equal(mat.type, 'MeshBasicMaterial', 'Portland must not relight to slate-blue');
  const hex = (mat as THREE.MeshBasicMaterial).color.getHex();
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  assert.ok(
    r > 180 && g > 160 && b > 140 && r > b + 20,
    `Portland not slate (${hex.toString(16)})`,
  );
  const roof = palace.getObjectByName('palace-roof');
  assert.ok(roof instanceof THREE.Mesh, 'slate roof over the whole footprint');
  const rb = new THREE.Box3().setFromObject(roof);
  assert.ok(
    rb.containsPoint(new THREE.Vector3(0, rb.min.y + 0.002, 0)),
    'roof must cover the court',
  );
  assert.ok((rb.max.x - rb.min.x) / METERS_TO_WORLD > 80, 'roof span east-west');
  assert.ok((rb.max.z - rb.min.z) / METERS_TO_WORLD > 90, 'roof span north-south');
  const ped = palace.getObjectByName('pediment');
  assert.ok(ped instanceof THREE.Mesh, 'central pediment on the Mall');
  assert.notEqual(ped.geometry.type, 'ConeGeometry', 'pediment must not be a cone nub');
  assert.ok(palace.getObjectByName('balcony'), 'centre balcony');
  let columns = 0;
  let cones = 0;
  palace.traverse((obj) => {
    if (obj.name === 'column') columns += 1;
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'ConeGeometry') cones += 1;
  });
  assert.ok(columns >= 4, `portico columns, got ${columns}`);
  assert.equal(cones, 0, 'no cone nubs on the palace');
  const dummy = new THREE.Group();
  dummy.name = 'costume';
  dummy.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2)));
  const prefabs = new Map();
  prefabs.set('buckingham', dummy);
  const live = instantiateLandmark('buckingham', prefabs);
  assert.equal(live.getObjectByName('costume'), undefined);
  assert.ok(live.getObjectByName('east-front'));
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
  assert.ok(box.min.y > 0.08, `runway must sit above dock water, min.y=${box.min.y.toFixed(3)}`);
  const mat = Array.isArray(runway.material) ? runway.material[0] : runway.material;
  assert.equal(mat.type, 'MeshBasicMaterial', 'runway stays asphalt, not a lit hangar');
  assert.equal(
    (mat as THREE.MeshBasicMaterial).polygonOffset,
    false,
    'runway polygonOffset buries piano keys at the aerial look',
  );
  assert.ok(air.getObjectByName('terminal'), 'south-side terminal pier');
  assert.ok(air.getObjectByName('tower'), 'south-side control tower');
  assert.ok(air.getObjectByName('apron'), 'stands south of the runway');
  assert.ok(air.getObjectByName('mark-09'), '09 threshold at the west end');
  assert.ok(air.getObjectByName('mark-27'), '27 threshold at the east end');
  const tower = air.getObjectByName('tower')!;
  assert.ok(tower.position.z > 0, 'tower must sit south of the runway');
  const shaft = air.getObjectByName('tower-shaft');
  assert.ok(shaft instanceof THREE.Mesh, 'shaft under the cab');
  const cabBox = new THREE.Box3().setFromObject(tower);
  const shaftBox = new THREE.Box3().setFromObject(shaft);
  const cabWM = (cabBox.max.x - cabBox.min.x) / METERS_TO_WORLD;
  const shaftWM = (shaftBox.max.x - shaftBox.min.x) / METERS_TO_WORLD;
  const cabDM = (cabBox.max.z - cabBox.min.z) / METERS_TO_WORLD;
  assert.ok(cabWM > 36, `cab must read as a hat, width ${cabWM.toFixed(0)} m`);
  assert.ok(cabDM > 28, `cab depth ${cabDM.toFixed(0)} m`);
  assert.ok(cabWM > shaftWM * 2.2, `cab ${cabWM.toFixed(0)} m vs shaft ${shaftWM.toFixed(0)} m`);
  assert.ok(
    cabBox.min.z < shaftBox.min.z - 6 * METERS_TO_WORLD,
    'cab cantilevers toward the runway',
  );
  const rwTop = box.max.y;
  let marks = 0;
  let buried = 0;
  air.traverse((obj) => {
    if (obj.name !== 'runway-mark' || !(obj instanceof THREE.Mesh)) return;
    marks += 1;
    const mb = new THREE.Box3().setFromObject(obj);
    if (mb.min.y < rwTop - 1e-4) buried += 1;
  });
  assert.ok(marks >= 40, `piano keys / dashes / 09-27, got ${marks}`);
  assert.equal(buried, 0, `${buried} marks still inside the runway slab`);
  const dlr = air.getObjectByName('dlr')!;
  assert.ok(dlr.position.x < 0, 'DLR at the west end');
  let bridges = 0;
  air.traverse((obj) => {
    if (obj.name === 'jetbridge') bridges += 1;
  });
  assert.ok(bridges >= 6, `airside jetbridges, got ${bridges}`);
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
