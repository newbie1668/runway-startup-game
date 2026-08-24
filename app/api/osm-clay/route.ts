import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

/** Serves the scored PR #23 simplified extract. Not the 50MB dump, not london.bin. */
export async function GET() {
  const file = path.join(process.cwd(), 'data/osm-central-london-simplified.geojson');
  const buf = await readFile(file);
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/geo+json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
