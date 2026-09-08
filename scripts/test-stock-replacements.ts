import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { LANDMARKS, project } from '../lib/game/geo';
import { buildChunkTier, chunkTierMeshes, createScratch } from '../lib/game/render3d/cityBuilder';
import { decodeCity, quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';
import {
  excludedBuildingIndices,
  mapReplacementAnchors,
  selectActiveReplacementIds,
} from '../lib/game/render3d/stockReplacements';
import { shouldLoadNoticedGlb } from '../lib/game/render3d/noticedPrefabs';
import {
  attachVisibleReplacement,
  hasVisibleReplacementGeometry,
} from '../lib/game/render3d/replacementAvailability';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function building(x0: number, z0: number, x1: number, z1: number, heightM = 15) {
  return {
    major: false,
    heightM,
    chunkId: 0,
    style: 0,
    roof: 0,
    wall565: 0,
    roof565: 0,
    verts: new Uint16Array([
      quantizeX(x0),
      quantizeY(z0),
      quantizeX(x1),
      quantizeY(z0),
      quantizeX(x1),
      quantizeY(z1),
      quantizeX(x0),
      quantizeY(z1),
    ]),
    indices: new Uint8Array([0, 1, 2, 0, 2, 3]),
  };
}

function fixture(): CityData {
  return {
    buildings: [building(10, 10, 20, 20), building(22, 10, 32, 20)],
    roads: [],
    parks: [],
    water: [],
  };
}

function emitted(city: CityData, excluded: ReadonlySet<number>) {
  const scratch = createScratch();
  const group = buildChunkTier(city, 0, false, excluded, scratch);
  let positions = 0;
  for (const mesh of group ? chunkTierMeshes(group) : []) {
    const attribute = mesh.geometry.getAttribute('position');
    positions += attribute?.count ?? 0;
    for (let i = 0; attribute && i < attribute.count; i++) {
      assert.ok(
        Number.isFinite(attribute.getX(i)) &&
          Number.isFinite(attribute.getY(i)) &&
          Number.isFinite(attribute.getZ(i)),
      );
    }
  }
  return { positions, picks: scratch.picks };
}

console.log('Stock replacement coverage');

check('active IDs are deterministic and duplicates are malformed', () => {
  assert.deepEqual(
    [
      ...selectActiveReplacementIds([
        { id: 'z', enabled: true, available: true },
        { id: 'a', enabled: true, available: true },
      ]),
    ],
    ['a', 'z'],
  );
  assert.throws(() =>
    selectActiveReplacementIds([
      { id: 'a', enabled: true, available: true },
      { id: 'a', enabled: false, available: false },
    ]),
  );
});

check('only visible nonempty roots activate replacements', () => {
  const material = new THREE.MeshBasicMaterial();
  const empty = new THREE.Group();
  assert.equal(hasVisibleReplacementGeometry(empty), false);

  const zeroInstances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 1);
  zeroInstances.count = 0;
  assert.equal(hasVisibleReplacementGeometry(zeroInstances), false);

  const hidden = new THREE.Group();
  hidden.visible = false;
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  assert.equal(hasVisibleReplacementGeometry(hidden), false);

  const visible = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  assert.equal(hasVisibleReplacementGeometry(visible), true);
});

check('throwing partial attachment cannot activate a replacement', () => {
  const root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const attached = new THREE.Group();
  const active = new Set<string>();
  assert.throws(() => {
    if (
      attachVisibleReplacement(root, (candidate) => {
        attached.add(candidate);
        throw new Error('optional replacement failed after partial output');
      })
    ) {
      active.add('partial');
    }
  });
  assert.equal(attached.children.length, 1);
  assert.equal(active.has('partial'), false);
});

check('only an active, uniquely-contained anchor suppresses its own source footprint', () => {
  const city = fixture();
  const mapping = mapReplacementAnchors(city, [{ id: 'own', x: 15, z: 15 }]);
  const excluded = excludedBuildingIndices(
    selectActiveReplacementIds([{ id: 'own', enabled: true, available: true }]),
    mapping,
  );
  assert.deepEqual([...excluded], [0]);
  const result = emitted(city, excluded);
  assert.ok(result.positions > 0);
  assert.deepEqual(
    result.picks.map((pick) => pick.sourceIndex),
    [1],
  );
});

check('disabled, failed, unmapped, and ambiguous replacements leave stock eligible', () => {
  const city = fixture();
  const mapping = mapReplacementAnchors(
    { ...city, buildings: [...city.buildings, building(10, 10, 20, 20)] },
    [
      { id: 'disabled', x: 25, z: 15 },
      { id: 'failed', x: 25, z: 15 },
      { id: 'missing', x: 50, z: 50 },
      { id: 'ambiguous', x: 15, z: 15 },
    ],
  );
  assert.deepEqual(mapping.unmatchedIds, ['missing']);
  assert.deepEqual(mapping.ambiguousIds, ['ambiguous']);
  assert.equal(mapping.buildingIndexById.get('disabled'), 1);
  assert.equal(mapping.buildingIndexById.get('failed'), 1);
  const excluded = excludedBuildingIndices(
    selectActiveReplacementIds([
      { id: 'disabled', enabled: false, available: true },
      { id: 'failed', enabled: true, available: false },
      { id: 'missing', enabled: true, available: true },
      { id: 'ambiguous', enabled: true, available: true },
    ]),
    mapping,
  );
  assert.equal(excluded.size, 0);
  assert.deepEqual(
    emitted(city, excluded).picks.map((pick) => pick.sourceIndex),
    [0, 1],
  );
});

check('a former broad radius cannot remove a neighbouring footprint', () => {
  const city = fixture();
  const mapping = mapReplacementAnchors(city, [{ id: 'replacement', x: 15, z: 15 }]);
  const excluded = excludedBuildingIndices(
    selectActiveReplacementIds([{ id: 'replacement', enabled: true, available: true }]),
    mapping,
  );
  const result = emitted(city, excluded);
  assert.deepEqual(
    result.picks.map((pick) => pick.sourceIndex),
    [1],
  );
  assert.ok(result.positions > 0);
});

check('Poultry retains ordinary massing and picking while its GLB remains unfetched', () => {
  assert.equal(shouldLoadNoticedGlb('no-1-poultry', false), false);
  const bytes = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
  const city = decodeCity(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const poultry = project([-0.09075, 51.51332]);
  const mapping = mapReplacementAnchors(city, [{ id: 'poultry', x: poultry.x, z: poultry.y }]);
  const sourceIndex = mapping.buildingIndexById.get('poultry');
  assert.notEqual(
    sourceIndex,
    undefined,
    `Poultry mapping failed: unmatched=${mapping.unmatchedIds} ambiguous=${mapping.ambiguousIds}`,
  );
  const source = city.buildings[sourceIndex!]!;
  const mini: CityData = {
    buildings: [{ ...source, chunkId: 0, major: false }],
    roads: [],
    parks: [],
    water: [],
  };
  const result = emitted(mini, new Set());
  assert.ok(result.positions > 0, 'Poultry ordinary massing is empty');
  assert.deepEqual(
    result.picks.map((pick) => pick.sourceIndex),
    [0],
  );
});

const bytes = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
const committed = decodeCity(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const noticedManifest = JSON.parse(
  readFileSync(join(process.cwd(), 'public/map/noticed/manifest.json'), 'utf8'),
) as { files?: Array<{ id: string; x: number; z: number }> };
const summary = mapReplacementAnchors(committed, [
  ...LANDMARKS.map((landmark, sourceIndex) => {
    const point = project(landmark.at);
    return { id: `landmark:${sourceIndex}:${landmark.kind}`, x: point.x, z: point.y };
  }),
  ...(noticedManifest.files ?? []).map((entry) => ({
    id: `noticed:${entry.id}`,
    x: entry.x,
    z: entry.z,
  })),
]);
console.log(
  `\nCommitted mapping summary: mapped=${summary.buildingIndexById.size} unmatched=${summary.unmatchedIds.length} ambiguous=${summary.ambiguousIds.length}`,
);
console.log(`All ${passed} stock-replacement checks passed.`);
