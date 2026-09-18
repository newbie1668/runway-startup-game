import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { decodeCity } from '../lib/game/render3d/format';
import { riverCrossingSpans } from '../lib/game/render3d/cityBuilder';

const raw = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
const r1Profile = JSON.parse(readFileSync(join(process.cwd(), 'docs/runway-recovery/evidence/R1/crossings-profile.json'), 'utf8')) as {
  crossingsMs: number;
  node: string;
};
const r1Browser = JSON.parse(readFileSync(join(process.cwd(), 'docs/runway-recovery/evidence/R1/browser/map-diagnostics-browser.json'), 'utf8')) as {
  environment: { node: string; os: { cpu: string; platform: string; arch: string } };
};
const city = decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
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
  r1ColdBaselineMs: r1Profile.crossingsMs,
  r1BaselineHardware: r1Browser.environment.os,
  currentCpu: cpus()[0]?.model ?? 'unknown',
  cpuCount: cpus().length,
  hardwareMatch: cpus()[0]?.model.includes(r1Browser.environment.os.cpu) ?? false,
  baselineNode: r1Profile.node,
  citySha256: createHash('sha256').update(raw).digest('hex'),
  coldMs,
  warmMs,
  coldSpeedupRatio: r1Profile.crossingsMs / coldMs,
  spanCount: spans.length,
  outputSha256: hash(spans),
}, null, 2));
