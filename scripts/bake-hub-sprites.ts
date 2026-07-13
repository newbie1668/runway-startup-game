/**
 * Bake illustrated hub cluster PNGs into public/map/hubs/.
 * Run: pnpm bake:map
 */

import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { bakeHubCluster, HUB_IDS, hubSpriteCanvasSize } from '../lib/game/hub-sprite-bake';

const OUT_DIR = path.join(process.cwd(), 'public/map/hubs');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const hubId of HUB_IDS) {
    const { width, height } = hubSpriteCanvasSize(hubId);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    bakeHubCluster(ctx, hubId, width, height);
    const outPath = path.join(OUT_DIR, `${hubId}.png`);
    const buf = await canvas.encode('png');
    fs.writeFileSync(outPath, buf);
    console.log(`  ✓ ${hubId}.png (${width}×${height})`);
  }

  console.log(`\nBaked ${HUB_IDS.length} hub sprites → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
