/**
 * Reprocess all hub sprites from docs/art/sources/.
 * Run: pnpm process:hub-sprites
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HUB_IDS } from '../lib/game/hub-sprite-bake';

const sourcesDir = path.join(process.cwd(), 'docs/art/sources');

for (const hubId of HUB_IDS) {
  const source = path.join(sourcesDir, `${hubId}-source.png`);
  if (!fs.existsSync(source)) {
    console.warn(`  ⊘ ${hubId} — no source at ${source}`);
    continue;
  }
  execSync(`pnpm exec tsx scripts/process-hub-sprite.ts ${hubId} "${source}"`, {
    stdio: 'inherit',
  });
}

console.log('\nDone.');
