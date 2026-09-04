/**
 * Rebake photo-true unique noticed GLBs without a full Overpass run.
 *
 * Run: `pnpm exec tsx scripts/bake-unique-noticed.ts`
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NOTICED_BAKE_HEIGHT_SCALE } from '../lib/game/render3d/buildingStyle';
import { METERS_TO_WORLD } from '../lib/game/geo';
import {
  ellipseRing,
  metersToWorld,
  rectRing,
  UNIQUE_NOTICED_IDS,
} from '../lib/game/render3d/uniqueNoticed';
import { buildNoticedGroup, exportNoticedGlb } from './noticedMesh';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public/map/noticed');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

const PLAN: Record<string, Array<[number, number]>> = {
  'charrington-tower': ellipseRing(metersToWorld(16), metersToWorld(12)),
  'one-park-drive': ellipseRing(metersToWorld(15), metersToWorld(15)),
  'newfoundland-quay': ellipseRing(metersToWorld(14), metersToWorld(12)),
  'hsbc-uk': rectRing(metersToWorld(47), metersToWorld(47)),
  citi: rectRing(metersToWorld(50), metersToWorld(48)),
};

interface ManifestFile {
  id: string;
  name: string;
  file: string;
  bytes: number;
  x: number;
  z: number;
  exclusionM: number;
  heightM: number;
  photo: boolean;
  shape: string;
}

interface Manifest {
  generatedAt: string;
  hash: string;
  baker: string;
  files: ManifestFile[];
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as Manifest;
  for (const id of UNIQUE_NOTICED_IDS) {
    const entry = manifest.files.find((f) => f.id === id);
    if (!entry) {
      console.warn(`  skip ${id}: not in manifest`);
      continue;
    }
    const ring = PLAN[id];
    if (!ring) continue;
    const group = buildNoticedGroup({
      id,
      ring,
      heightWorld: entry.heightM * METERS_TO_WORLD * NOTICED_BAKE_HEIGHT_SCALE,
      wall: [0.7, 0.72, 0.74],
      roof: [0.3, 0.32, 0.34],
      glass: true,
      seed: 1,
      shape: 'slab',
    });
    const buf = await exportNoticedGlb(group);
    await writeFile(path.join(OUT_DIR, entry.file), Buffer.from(buf));
    entry.bytes = buf.byteLength;
    console.log(`  ${id}.glb  ${(buf.byteLength / 1024).toFixed(1)} KB`);
  }
  manifest.generatedAt = new Date().toISOString();
  manifest.baker = 'three-unique';
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
