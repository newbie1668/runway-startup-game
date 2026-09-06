/**
 * Noticed-tower factory helpers — offline, no DOM.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { makeMatteLambert, makeUnlitBasic } from '../lib/game/render3d/matteGltf';
import {
  bandsForShape,
  civicKindFromTags,
  featuresFromText,
  isCircularShape,
  isCivicShape,
  liftRgb,
  resolveShape,
  roofFromWall,
  tintForShape,
} from './noticedFeatures';
import { buildNoticedGroup } from './noticedMesh';
import {
  instantiateNoticed,
  isStreetNoticedId,
  shouldLoadNoticedGlb,
} from '../lib/game/render3d/noticedPrefabs';
import {
  ellipseRing,
  isUniqueNoticedId,
  metersToWorld,
  UNIQUE_NOTICED_IDS,
} from '../lib/game/render3d/uniqueNoticed';
import {
  isUsefulName,
  slugify,
  uniqueSlug,
  wikiTitleFromTags,
  heightFromTags,
} from './noticedSelect';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('Noticed tower factory');

check('slugify strips punctuation', () => {
  assert.equal(slugify('22 Bishopsgate Tower'), '22-bishopsgate-tower');
  assert.equal(slugify('HSBC UK'), 'hsbc-uk');
});

check('rejects generic names', () => {
  assert.equal(isUsefulName('The Tower'), false);
  assert.equal(isUsefulName('8 Bishopsgate'), true);
});

check('reads English wikipedia titles only', () => {
  assert.equal(wikiTitleFromTags({ wikipedia: 'en:22 Bishopsgate' }), '22 Bishopsgate');
  assert.equal(wikiTitleFromTags({ wikipedia: 'de:Irgendwas' }), null);
  assert.equal(wikiTitleFromTags({}), null);
});

check('height prefers metres over levels', () => {
  assert.equal(heightFromTags({ height: '183', 'building:levels': '42' }), 183);
  assert.equal(heightFromTags({ 'building:levels': '10' }), 10 * 3.2 + 3);
});

check('uniqueSlug disambiguates', () => {
  const used = new Set<string>();
  assert.equal(uniqueSlug('tower', used), 'tower');
  assert.equal(uniqueSlug('tower', used), 'tower-2');
});

check('named London silhouettes match the skyline', () => {
  assert.equal(resolveShape('newfoundland-quay', 'Newfoundland Quay', ''), 'twist');
  assert.equal(resolveShape('one-park-drive', 'One Park Drive', ''), 'cylinder');
  assert.equal(resolveShape('cromwell-tower', 'Cromwell Tower', ''), 'brutalist');
  assert.equal(resolveShape('8-bishopsgate', '8 Bishopsgate', ''), 'stepped');
  assert.equal(resolveShape('bagshaw-building-wardian-east', 'Wardian', ''), 'taper');
  assert.equal(resolveShape('hsbc-uk', 'HSBC UK', ''), 'slab');
});

check('wiki intro text can fill in unknown towers', () => {
  assert.equal(featuresFromText('a twisted residential tower on the quay'), 'twist');
  assert.equal(featuresFromText('brutalist concrete Barbican slab'), 'brutalist');
  assert.equal(featuresFromText('a cylindrical glass residential tower'), 'cylinder');
  assert.equal(featuresFromText('the parish church with a tall spire'), 'church');
  assert.equal(featuresFromText('the railway station terminus'), 'station');
});

check('OSM civic tags pick church/station/theatre/civic, not navy glass', () => {
  assert.equal(civicKindFromTags({ building: 'church', name: "St Mary's" }), 'church');
  assert.equal(civicKindFromTags({ railway: 'station', name: 'Goodge Street' }), 'station');
  assert.equal(civicKindFromTags({ amenity: 'theatre', name: 'National Theatre' }), 'theatre');
  assert.equal(civicKindFromTags({ tourism: 'museum', name: 'British Museum' }), 'civic');
  assert.equal(civicKindFromTags({ building: 'office', name: 'HSBC UK' }), null);
  assert.equal(isCivicShape('church'), true);
  assert.equal(isCivicShape('taper'), false);
});

check('named silhouettes win over a misleading extract', () => {
  assert.equal(
    resolveShape('one-park-drive', 'One Park Drive', 'The twisted cylindrical brutalist tower'),
    'cylinder',
  );
});

check('twist bands yaw further up the shaft', () => {
  const bands = bandsForShape('twist');
  assert.ok(bands[0]!.yawDeg < bands[bands.length - 1]!.yawDeg);
  assert.ok(bands[bands.length - 1]!.yawDeg >= 50);
  assert.equal(bands[bands.length - 1]!.t1, 1);
  assert.equal(isCircularShape('cylinder'), true);
  assert.equal(isCircularShape('twist'), false);
});

check('liftRgb raises crushed photo samples', () => {
  const lifted = liftRgb([0.05, 0.06, 0.07]);
  assert.ok(lifted[0] > 0.25);
});

check('shape tints and roofs stay distinct from the wall', () => {
  const wall: [number, number, number] = [0.45, 0.5, 0.55];
  const twist = tintForShape('twist', wall);
  const roof = roofFromWall(twist);
  assert.ok(twist[1] > twist[0], 'twist should lean teal');
  assert.ok((roof[0] + roof[1] + roof[2]) / 3 < (twist[0] + twist[1] + twist[2]) / 3);
});

check('makeMatteLambert keeps noticed albedo maps', () => {
  const data = new Uint8Array([10, 80, 160, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, metalness: 0.4 }),
  );
  const root = new THREE.Group();
  root.add(mesh);
  makeMatteLambert(root, { keepMaps: true });
  const mat = mesh.material as THREE.MeshLambertMaterial;
  assert.ok(mat.map, 'expected albedo map to survive');
  assert.equal(mat.color.getHex(), 0xffffff);
});

check('makeMatteLambert still drops maps on landmarks', () => {
  const data = new Uint8Array([250, 250, 250, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex }),
  );
  makeMatteLambert(mesh);
  const mat = mesh.material as THREE.MeshLambertMaterial;
  assert.equal(mat.map, null);
  assert.equal(mat.color.getHex(), 0x7a92a4);
});

check('unique-tower unlit pass keeps pale stone as MeshBasicMaterial', () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xe8e2d6 }),
  );
  const root = new THREE.Group();
  root.add(mesh);
  makeMatteLambert(root, { keepMaps: true });
  makeUnlitBasic(root);
  const mat = mesh.material as THREE.MeshBasicMaterial;
  assert.equal(mat.type, 'MeshBasicMaterial');
  assert.equal(mat.color.getHex(), 0xe8e2d6);
});

check('church baker adds a tower and spire, not another glass taper', () => {
  const ring: Array<[number, number]> = [
    [-0.15, -0.25],
    [0.15, -0.25],
    [0.15, 0.25],
    [-0.15, 0.25],
  ];
  const group = buildNoticedGroup({
    id: 'church-test',
    ring,
    heightWorld: 1.2,
    wall: [0.7, 0.5, 0.42],
    roof: [0.35, 0.32, 0.3],
    glass: false,
    seed: 4,
    shape: 'church',
  });
  assert.ok(group.getObjectByName('church-test-tower'), 'nave needs a tower');
  assert.ok(group.getObjectByName('church-test-spire'), 'tower needs a spire');
  let cones = 0;
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === 'ConeGeometry') cones += 1;
  });
  assert.ok(cones >= 1, `expected a spire cone, got ${cones}`);
});

check('station baker adds a clock drum instead of navy glass bands only', () => {
  const ring: Array<[number, number]> = [
    [-0.2, -0.12],
    [0.2, -0.12],
    [0.2, 0.12],
    [-0.2, 0.12],
  ];
  const group = buildNoticedGroup({
    id: 'station-test',
    ring,
    heightWorld: 0.9,
    wall: [0.45, 0.2, 0.18],
    roof: [0.25, 0.24, 0.22],
    glass: false,
    seed: 8,
    shape: 'station',
  });
  assert.ok(group.getObjectByName('station-test-clock'));
  assert.ok(group.getObjectByName('station-test-clockface'));
});

check('taper baker shrinks the crown relative to the podium', () => {
  const ring: Array<[number, number]> = [
    [-0.2, -0.2],
    [0.2, -0.2],
    [0.2, 0.2],
    [-0.2, 0.2],
  ];
  const group = buildNoticedGroup({
    id: 'taper-test',
    ring,
    heightWorld: 2,
    wall: [0.5, 0.55, 0.6],
    roof: [0.3, 0.32, 0.34],
    glass: true,
    seed: 1,
    shape: 'taper',
  });
  const podium = group.getObjectByName('taper-test-0') as THREE.Mesh;
  const crown = group.getObjectByName('taper-test-3') as THREE.Mesh;
  assert.ok(podium && crown, 'expected podium and crown bands');
  const pod = new THREE.Box3().setFromObject(podium);
  const top = new THREE.Box3().setFromObject(crown);
  const podW = pod.max.x - pod.min.x;
  const topW = top.max.x - top.min.x;
  assert.ok(topW < podW * 0.55, `crown ${topW} should be narrower than podium ${podW}`);
});

check('named Canary towers get photo-true unique meshes, not baker costumes', () => {
  const charrington = buildNoticedGroup({
    id: 'charrington-tower',
    ring: ellipseRing(metersToWorld(16), metersToWorld(12)),
    heightWorld: 2.1,
    wall: [0.5, 0.5, 0.52],
    roof: [0.2, 0.2, 0.22],
    glass: true,
    seed: 1,
    shape: 'stepped',
  });
  assert.ok(charrington.getObjectByName('charrington-tower-peel'), 'peeled balcony stack');
  assert.ok(charrington.getObjectByName('charrington-tower-shell'), 'C-shell, not a closed tube');
  assert.equal(
    charrington.getObjectByName('charrington-tower-0'),
    undefined,
    'not a stepped extrusion',
  );
  const peel = charrington.getObjectByName('charrington-tower-peel') as THREE.Mesh;
  assert.ok(peel.position.z > 0, 'balconies face +Z (Thames / south)');
  const shell = charrington.getObjectByName('charrington-tower-shell') as THREE.Mesh;
  const cyl = shell.geometry as THREE.CylinderGeometry;
  assert.equal(cyl.parameters.openEnded, true);
  assert.ok(
    cyl.parameters.thetaLength < Math.PI * 2 - 1,
    `south peel must be a real bite, thetaLength=${cyl.parameters.thetaLength}`,
  );
  assert.ok(cyl.parameters.thetaStart < 1.2, 'opening is centered on +Z, not +X');
  const peelMat = Array.isArray(peel.material) ? peel.material[0] : peel.material;
  assert.equal(
    peelMat?.type,
    'MeshBasicMaterial',
    'peeled stone must stay unlit white, not navy Lambert',
  );

  const park = buildNoticedGroup({
    id: 'one-park-drive',
    ring: ellipseRing(metersToWorld(15), metersToWorld(15)),
    heightWorld: 2.4,
    wall: [0.6, 0.62, 0.64],
    roof: [0.2, 0.2, 0.22],
    glass: true,
    seed: 2,
    shape: 'cylinder',
  });
  assert.ok(park.getObjectByName('one-park-drive-disc-0'));
  assert.ok(park.getObjectByName('one-park-drive-disc-6'), 'stacked discs, not one tapering tube');

  const nf = buildNoticedGroup({
    id: 'newfoundland-quay',
    ring: ellipseRing(metersToWorld(14), metersToWorld(12)),
    heightWorld: 2.2,
    wall: [0.4, 0.5, 0.55],
    roof: [0.2, 0.2, 0.22],
    glass: true,
    seed: 3,
    shape: 'twist',
  });
  assert.ok(nf.getObjectByName('newfoundland-quay-helix'));

  const hsbc = buildNoticedGroup({
    id: 'hsbc-uk',
    ring: [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [-0.2, 0.2],
    ],
    heightWorld: 2.3,
    wall: [0.5, 0.55, 0.58],
    roof: [0.2, 0.2, 0.22],
    glass: true,
    seed: 4,
    shape: 'slab',
  });
  assert.ok(hsbc.getObjectByName('hsbc-uk-hat'), 'Foster plant-room hat');

  const citi = buildNoticedGroup({
    id: 'citi',
    ring: [
      [-0.22, -0.2],
      [0.22, -0.2],
      [0.22, 0.2],
      [-0.22, 0.2],
    ],
    heightWorld: 2.3,
    wall: [0.45, 0.5, 0.55],
    roof: [0.2, 0.2, 0.22],
    glass: true,
    seed: 5,
    shape: 'slab',
  });
  assert.ok(citi.getObjectByName('citi-notch'), 'notched crown');
  assert.equal(UNIQUE_NOTICED_IDS.length, 5);
});

check('runtime instantiate uses the unique mesh, not the stepped GLB costume', () => {
  const dummy = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x445566 }),
  );
  dummy.name = 'charrington-tower-0';
  const prefab = new THREE.Group();
  prefab.add(dummy);
  const group = instantiateNoticed(
    {
      id: 'charrington-tower',
      name: 'Charrington Tower',
      x: 0,
      z: 0,
      exclusionM: 40,
      heightM: 144,
    },
    prefab,
  );
  assert.ok(group.getObjectByName('charrington-tower-peel'));
  assert.equal(group.getObjectByName('charrington-tower-0'), undefined);
});

check('Poultry is a committed photo GLB on the noticed tray, not a uniqueNoticed hull', () => {
  assert.equal(isUniqueNoticedId('no-1-poultry'), false);
  assert.equal(isStreetNoticedId('no-1-poultry'), true);
  assert.equal(
    shouldLoadNoticedGlb('no-1-poultry', true),
    false,
    'parked uniqueness does not load Poultry under skipGlb',
  );
  assert.equal(
    shouldLoadNoticedGlb('no-1-poultry', false),
    false,
    'parked uniqueness does not load Poultry when skipGlb is off',
  );
  assert.equal(shouldLoadNoticedGlb('hampton-tower', true), false);
  assert.equal(shouldLoadNoticedGlb('charrington-tower', false), false);
  const glbPath = join(process.cwd(), 'public/map/noticed/no-1-poultry.glb');
  const manifestPath = join(process.cwd(), 'public/map/noticed/manifest.json');
  assert.equal(existsSync(glbPath), true, 'no-1-poultry.glb missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    files?: Array<{ id: string; file: string; photo?: boolean }>;
  };
  const entry = manifest.files?.find((f) => f.id === 'no-1-poultry');
  assert.ok(entry, 'no-1-poultry missing from noticed manifest');
  assert.equal(entry?.photo, true);
  const buf = readFileSync(glbPath);
  assert.ok(buf.byteLength > 40_000, `Poultry GLB too small (${buf.byteLength} bytes)`);
  const jsonLen = buf.readUInt32LE(12);
  const json = buf
    .subarray(20, 20 + jsonLen)
    .toString('utf8')
    .replace(/\0+$/, '')
    .trim();
  const doc = JSON.parse(json) as {
    asset?: { generator?: string };
    meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
  };
  assert.match(
    doc.asset?.generator ?? '',
    /GLTFExporter/,
    'Poultry GLB must use the tray exporter',
  );
  const hasColor = (doc.meshes ?? []).some((mesh) =>
    (mesh.primitives ?? []).some((p) => p.attributes?.COLOR_0 != null),
  );
  assert.equal(hasColor, true, 'Poultry GLB has no still vertex colours');
  const dummy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  dummy.name = 'no-1-poultry-south';
  const prefab = new THREE.Group();
  prefab.add(dummy);
  const group = instantiateNoticed(
    {
      id: 'no-1-poultry',
      name: 'No 1 Poultry',
      x: 0,
      z: 0,
      exclusionM: 24,
      heightM: 42,
    },
    prefab,
  );
  assert.equal(group.scale.y, 1, 'Poultry must not take tower Y-scale');
  assert.ok(group.getObjectByName('no-1-poultry-south'));
});

async function checkPoultryGlbParses(): Promise<void> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const glbPath = join(process.cwd(), 'public/map/noticed/no-1-poultry.glb');
  const buf = readFileSync(glbPath);
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    '',
  );
  assert.ok(gltf.scene.getObjectByName('no-1-poultry-south'), 'loaded GLB missing south mesh');
  passed += 1;
  console.log('  ✓ Poultry GLB parses in GLTFLoader');
}

checkPoultryGlbParses()
  .then(() => {
    console.log(`\nAll ${passed} noticed-factory checks passed.`);
  })
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
