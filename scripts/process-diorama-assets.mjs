/**
 * Compress Blender authoring renders into the formats shipped by /game.
 *
 * Requires ffmpeg with libsvtav1 and cwebp. Both are available through
 * Homebrew on the verified development machine.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const authoring = join(root, 'artifacts', 'diorama-authoring');
const output = join(root, 'public', 'game', 'diorama');
const generatedManifest = join(root, 'lib', 'game', 'diorama-manifest.generated.json');

function requireFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing authoring render: ${path}`);
  }
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function avif(input, target, width, height, crf) {
  mkdirSync(dirname(target), { recursive: true });
  run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-vf',
    `scale=${width}:${height}:flags=lanczos`,
    '-frames:v',
    '1',
    '-c:v',
    'libsvtav1',
    '-preset',
    '8',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p10le',
    target,
  ]);
}

function webp(input, target, width, height, quality = 82) {
  mkdirSync(dirname(target), { recursive: true });
  run('cwebp', [
    '-quiet',
    '-mt',
    '-m',
    '6',
    '-q',
    String(quality),
    '-resize',
    String(width),
    String(height),
    input,
    '-o',
    target,
  ]);
}

function shareJpeg(input, target) {
  mkdirSync(dirname(target), { recursive: true });
  run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-vf',
    'scale=1200:675:flags=lanczos,crop=1200:630',
    '-frames:v',
    '1',
    '-q:v',
    '3',
    target,
  ]);
}

function tokenWebp(input, target) {
  mkdirSync(dirname(target), { recursive: true });
  run('cwebp', ['-quiet', '-mt', '-m', '6', '-q', '86', input, '-o', target]);
}

const sourceManifestPath = join(authoring, 'manifest.source.json');
requireFile(sourceManifestPath);
const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
const hubs = Object.keys(sourceManifest.hubs);

const masterInput = join(authoring, 'master-5120.png');
requireFile(masterInput);

avif(masterInput, join(output, 'master-5120.avif'), 5120, 2880, 40);
avif(masterInput, join(output, 'master-2560.avif'), 2560, 1440, 39);
webp(masterInput, join(output, 'master-5120.webp'), 5120, 2880, 82);
webp(masterInput, join(output, 'master-2560.webp'), 2560, 1440, 82);
shareJpeg(masterInput, join(output, 'share-base.jpg'));

const lqipPath = join(authoring, 'master-lqip.webp');
webp(masterInput, lqipPath, 64, 36, 24);
const lqip = `data:image/webp;base64,${readFileSync(lqipPath).toString('base64')}`;

for (const hub of hubs) {
  const input = join(authoring, 'focus', `${hub}-2560.png`);
  requireFile(input);
  avif(input, join(output, 'focus', `${hub}-2560.avif`), 2560, 2560, 41);
  avif(input, join(output, 'focus', `${hub}-1280.avif`), 1280, 1280, 40);
  webp(input, join(output, 'focus', `${hub}-2560.webp`), 2560, 2560, 83);
  webp(input, join(output, 'focus', `${hub}-1280.webp`), 1280, 1280, 83);
}

for (const token of ['hq', 'rival', 'event', 'ring']) {
  const input = join(authoring, 'tokens', `${token}.png`);
  requireFile(input);
  tokenWebp(input, join(output, 'tokens', `${token}.webp`));
}

const manifest = {
  ...sourceManifest,
  master: {
    lqip,
    avif: '/game/diorama/master-5120.avif',
    avifSmall: '/game/diorama/master-2560.avif',
    webp: '/game/diorama/master-5120.webp',
    webpSmall: '/game/diorama/master-2560.webp',
  },
  tokens: {
    hq: '/game/diorama/tokens/hq.webp',
    rival: '/game/diorama/tokens/rival.webp',
    event: '/game/diorama/tokens/event.webp',
    ring: '/game/diorama/tokens/ring.webp',
  },
};
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(generatedManifest, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote production diorama assets to ${output}`);
