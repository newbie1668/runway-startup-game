import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { COMPACT_FILE } from '../lib/sim/compact';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'public', 'sim', COMPACT_FILE);

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(path.join(ROOT, 'public', 'sim'), { recursive: true });
  if (!(await exists(SRC))) {
    throw new Error(
      `Missing ${SRC} — run pnpm pack:sim (do not copy the raw GeoJSON into public/)`,
    );
  }
  // Canonical runtime mesh already lives in public/sim. Keep public/data empty of GeoJSON.
  await mkdir(path.join(ROOT, 'public', 'data'), { recursive: true });
  console.log(`Sim mesh ready at public/sim/${COMPACT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
