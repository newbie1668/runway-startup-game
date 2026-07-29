import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const assetRoot = join(root, 'public', 'game', 'diorama');
const hubs = [
  'shoreditch',
  'kingscross',
  'soho',
  'farringdon',
  'canarywharf',
  'londonbridge',
  'camden',
  'battersea',
];
const tokens = ['hq', 'rival', 'event', 'ring'];
const geographyPath = join(root, 'scripts', 'blender-city', 'london-geography.json');

function size(path) {
  assert.ok(existsSync(path), `missing asset: ${path}`);
  return statSync(path).size;
}

console.log('RUNWAY diorama asset checks');

assert.ok(existsSync(geographyPath), 'frozen London geography snapshot is missing');
const geography = JSON.parse(readFileSync(geographyPath, 'utf8'));
assert.equal(geography.source.provider, 'OpenStreetMap contributors');
assert.ok(geography.river.points.length >= 20, 'Thames line should retain its recognisable bends');
assert.ok(geography.roads.length >= 80, 'London primary-road snapshot is unexpectedly sparse');
const docklandsRiver = geography.river.points.filter(([lon]) => lon >= -0.06 && lon <= 0.01);
const docklandsLatitudes = docklandsRiver.map(([, lat]) => lat);
assert.ok(
  Math.min(...docklandsLatitudes) < 51.49 && Math.max(...docklandsLatitudes) > 51.505,
  'Thames geometry should preserve the Isle of Dogs loop',
);
console.log(
  `  ✓ OSM geography snapshot includes ${geography.river.points.length} Thames points and ${geography.roads.length} road segments`,
);

const initialBytes =
  size(join(assetRoot, 'master-2560.avif')) +
  tokens.reduce((total, token) => total + size(join(assetRoot, 'tokens', `${token}.webp`)), 0);
assert.ok(
  initialBytes <= 1_500_000,
  `initial map payload is ${(initialBytes / 1_000_000).toFixed(2)}MB; budget is 1.50MB`,
);
console.log(`  ✓ initial map payload ${(initialBytes / 1_000_000).toFixed(2)}MB`);

for (const hub of hubs) {
  const bytes = size(join(assetRoot, 'focus', `${hub}-2560.avif`));
  assert.ok(bytes <= 450_000, `${hub} focus AVIF is ${bytes} bytes; budget is 450000`);
  for (const variant of ['2560.avif', '1280.avif', '2560.webp', '1280.webp']) {
    size(join(assetRoot, 'focus', `${hub}-${variant}`));
  }
}
console.log('  ✓ all eight focus AVIFs stay within 450KB');

const tokenBytes = tokens.reduce(
  (total, token) => total + size(join(assetRoot, 'tokens', `${token}.webp`)),
  0,
);
assert.ok(tokenBytes <= 120_000, `token corpus is ${tokenBytes} bytes; budget is 120000`);
console.log(`  ✓ clay token corpus ${(tokenBytes / 1000).toFixed(0)}KB`);

const shareImageBytes = size(join(assetRoot, 'share-base.jpg'));
assert.ok(shareImageBytes <= 500_000, `share preview base is ${shareImageBytes} bytes`);
console.log(`  ✓ social preview base ${(shareImageBytes / 1000).toFixed(0)}KB`);

const manifestPath = join(assetRoot, 'manifest.json');
assert.ok(existsSync(manifestPath), 'diorama manifest is missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(Object.keys(manifest.hubs).length, 8);
assert.match(manifest.master.lqip, /^data:image\/webp;base64,/);
const generatedManifest = JSON.parse(
  readFileSync(join(root, 'lib', 'game', 'diorama-manifest.generated.json'), 'utf8'),
);
assert.equal(generatedManifest.master.lqip, manifest.master.lqip);
assert.deepEqual(generatedManifest.hubs, manifest.hubs);
console.log('  ✓ runtime manifest matches all eight hubs and includes an inline LQIP');

const fullAvifCorpus =
  size(join(assetRoot, 'master-5120.avif')) +
  hubs.reduce((total, hub) => total + size(join(assetRoot, 'focus', `${hub}-2560.avif`)), 0) +
  tokenBytes;
assert.ok(
  fullAvifCorpus <= 5_500_000,
  `full-resolution AVIF corpus is ${(fullAvifCorpus / 1_000_000).toFixed(2)}MB; target is about 5MB`,
);
console.log(`  ✓ full-resolution AVIF corpus ${(fullAvifCorpus / 1_000_000).toFixed(2)}MB`);
