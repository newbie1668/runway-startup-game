/**
 * Noticed-tower factory helpers — offline, no DOM.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMatteLambert } from '../lib/game/render3d/matteGltf';
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

console.log(`\nAll ${passed} noticed-factory checks passed.`);
