import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCity } from '../lib/game/render3d/format';
import { riverCrossingSpans } from '../lib/game/render3d/cityBuilder';

const raw = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
const city = decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const shape = (spans: ReturnType<typeof riverCrossingSpans>) => spans.map((s) => ({ pts: s.pts, tier: s.tier }));
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const elapsed = (run: () => unknown): number => {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

const coldMs = elapsed(() => riverCrossingSpans(city));
const warmMs = elapsed(() => riverCrossingSpans(city));
const spans = riverCrossingSpans(city);
console.log(JSON.stringify({
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cityBytes: raw.byteLength,
  citySha256: createHash('sha256').update(raw).digest('hex'),
  coldMs,
  warmMs,
  spanCount: spans.length,
  outputSha256: hash(shape(spans)),
}, null, 2));
