/**
 * Crop and resize a source illustration to hub sprite dimensions.
 * Usage: tsx scripts/process-hub-sprite.ts <hubId> <source.png>
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { hubSpriteCanvasSize } from '../lib/game/hub-sprite-bake';
import { HUB_SPRITE_META } from '../lib/game/sprite-loader';
import type { HubId } from '../lib/game/types';

const hubId = process.argv[2] as HubId;
const source = process.argv[3];

if (!hubId || !source || !HUB_SPRITE_META[hubId]) {
  console.error('Usage: tsx scripts/process-hub-sprite.ts <hubId> <source.png>');
  process.exit(1);
}

const meta = HUB_SPRITE_META[hubId];
const { width, height } = hubSpriteCanvasSize(hubId);
const aspect = (meta.drawW * 2) / meta.drawH;

const dim = execSync(`sips -g pixelWidth -g pixelHeight "${source}"`, { encoding: 'utf8' });
const sw = Number(dim.match(/pixelWidth: (\d+)/)?.[1] ?? 1536);
const sh = Number(dim.match(/pixelHeight: (\d+)/)?.[1] ?? 1024);

let cropW = sw;
let cropH = Math.round(sw / aspect);
if (cropH > sh) {
  cropH = sh;
  cropW = Math.round(sh * aspect);
}

const outDir = path.join(process.cwd(), 'public/map/hubs');
const docsDir = path.join(process.cwd(), 'docs/art/sources');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(docsDir, { recursive: true });

const archived = path.join(docsDir, `${hubId}-source.png`);
fs.copyFileSync(source, archived);

const cropPath = path.join(outDir, `.${hubId}-crop.png`);
const outPath = path.join(outDir, `${hubId}.png`);
const x = Math.round((sw - cropW) / 2);
const y = Math.round((sh - cropH) / 2);

execSync(
  `sips -c ${cropH} ${cropW} "${source}" --cropOffset ${y} ${x} --out "${cropPath}"`,
  { stdio: 'inherit' },
);
execSync(`sips -z ${height} ${width} "${cropPath}" --out "${outPath}"`, { stdio: 'inherit' });
fs.unlinkSync(cropPath);

console.log(`✓ ${hubId}.png (${width}×${height})`);
