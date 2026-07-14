/**
 * Crop, strip grass background, and resize hub illustrations to sprite dimensions.
 * Usage: tsx scripts/process-hub-sprite.ts <hubId> <source.png>
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { hubSpriteCanvasSize } from '../lib/game/hub-sprite-bake';
import { HUB_SPRITE_META } from '../lib/game/sprite-loader';
import type { HubId } from '../lib/game/types';

function stripGrassBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    // Grass / turf greens from generated art
    const isGrass = g > 70 && g > r * 1.12 && g > b * 1.05;
    // Pale green-beige ground plane
    const isGround =
      g > 120 &&
      r > 100 &&
      b > 70 &&
      g >= r - 15 &&
      g >= b &&
      Math.abs(g - r) < 45;
    if (isGrass || isGround) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

async function main() {
  const hubId = process.argv[2] as HubId;
  const source = process.argv[3];

  if (!hubId || !source || !HUB_SPRITE_META[hubId]) {
    console.error('Usage: tsx scripts/process-hub-sprite.ts <hubId> <source.png>');
    process.exit(1);
  }

  const meta = HUB_SPRITE_META[hubId];
  const { width, height } = hubSpriteCanvasSize(hubId);
  const aspect = (meta.drawW * 2) / meta.drawH;

  const img = await loadImage(source);
  const sw = img.width;
  const sh = img.height;

  let cropW = sw;
  let cropH = Math.round(sw / aspect);
  if (cropH > sh) {
    cropH = sh;
    cropW = Math.round(sh * aspect);
  }
  const sx = Math.round((sw - cropW) / 2);
  const sy = Math.round((sh - cropH) / 2);

  const cropCanvas = createCanvas(cropW, cropH);
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(img, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
  stripGrassBackground(cropCtx, cropW, cropH);

  const outCanvas = createCanvas(width, height);
  const outCtx = outCanvas.getContext('2d');
  outCtx.drawImage(cropCanvas, 0, 0, width, height);

  const outDir = path.join(process.cwd(), 'public/map/hubs');
  const docsDir = path.join(process.cwd(), 'docs/art/sources');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.copyFileSync(source, path.join(docsDir, `${hubId}-source.png`));

  const outPath = path.join(outDir, `${hubId}.png`);
  fs.writeFileSync(outPath, await outCanvas.encode('png'));
  console.log(`✓ ${hubId}.png (${width}×${height}, transparent)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
