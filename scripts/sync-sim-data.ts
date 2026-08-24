import { mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { BUILDING_DATA_FILE, LANDCOVER_DATA_FILE, ROADS_DATA_FILE } from '../lib/sim/constants';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'data');
const DEST = path.join(ROOT, 'public', 'data');

const FILES = [BUILDING_DATA_FILE, ROADS_DATA_FILE, LANDCOVER_DATA_FILE];

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(DEST, { recursive: true });
  let copied = 0;
  for (const file of FILES) {
    const from = path.join(SRC, file);
    if (!(await exists(from))) {
      console.warn(`skip missing ${from}`);
      continue;
    }
    await copyFile(from, path.join(DEST, file));
    copied += 1;
  }
  console.log(`Synced ${copied}/${FILES.length} OSM extracts to public/data`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
