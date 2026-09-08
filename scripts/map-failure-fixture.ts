/**
 * Produces a small, traceable city response for browser failure checks.
 * It deliberately keeps only real building records near Wardian: the test
 * proves lifecycle behaviour without asking Chromium to render all London.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { project } from '../lib/game/geo';
import { decodeCity, dequantizeX, dequantizeY, encodeCity, type CityBuilding } from '../lib/game/render3d/format';

const sourcePath = resolve('public/map/london-city.bin');
const noticedId = 'bagshaw-building-wardian-east';
const source = readFileSync(sourcePath);
const committed = execFileSync('git', ['show', 'HEAD:public/map/london-city.bin'], { maxBuffer: 16 * 1024 * 1024 });
if (!source.equals(committed)) throw new Error('public/map/london-city.bin differs from HEAD; fixture provenance must use committed data');
const sourceData = decodeCity(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
const target = { lng: -0.0224, lat: 51.5017, ...project([-0.0224, 51.5017]) };
const centre = (building: CityBuilding) => {
  let x = 0; let y = 0;
  for (let i = 0; i < building.verts.length; i += 2) {
    x += dequantizeX(building.verts[i]!);
    y += dequantizeY(building.verts[i + 1]!);
  }
  const n = building.verts.length / 2;
  return { x: x / n, y: y / n };
};
const selected = sourceData.buildings
  .map((building, originalIndex) => {
    const point = centre(building);
    return { building, originalIndex, distanceWorld: Math.hypot(point.x - target.x, point.y - target.y) };
  })
  .sort((a, b) => a.distanceWorld - b.distanceWorld || a.originalIndex - b.originalIndex)
  .slice(0, 80);
if (selected.length !== 80) throw new Error(`Expected at least 80 city buildings, found ${selected.length}`);
const fixture = encodeCity({
  // Deliberate simplification: only nearby building footprints are retained;
  // roads, parks and water are remote cover for this bounded failure test.
  buildings: selected.map(({ building }) => building), roads: [], parks: [], water: [],
});
const fixtureBytes = Buffer.from(fixture);
const manifest = JSON.parse(readFileSync(resolve('public/map/noticed/manifest.json'), 'utf8')) as { files?: Array<Record<string, unknown>> };
const noticedTarget = manifest.files?.find((entry) => entry.id === noticedId);
if (!noticedTarget) throw new Error(`Unknown noticed fixture ID: ${noticedId}`);
if (typeof noticedTarget.file !== 'string' || typeof noticedTarget.x !== 'number' || typeof noticedTarget.z !== 'number') {
  throw new Error(`Invalid noticed fixture record for ID: ${noticedId}`);
}
console.log(JSON.stringify({
  schema: 1,
  kind: 'bounded-wardian-city-fixture',
  target,
  count: selected.length,
  originalIndices: selected.map(({ originalIndex }) => originalIndex),
  nearestOriginalIndex: selected[0]!.originalIndex,
  nearestDistanceWorld: selected[0]!.distanceWorld,
  anchorRetained: selected.some(({ originalIndex }) => originalIndex === selected[0]!.originalIndex),
  noticedTarget,
  simplification: '80 closest real building footprints; roads, parks and water excluded as remote cover',
  source: {
    path: 'public/map/london-city.bin',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sha256: createHash('sha256').update(committed).digest('hex'),
  },
  fixture: { sha256: createHash('sha256').update(fixtureBytes).digest('hex'), base64: fixtureBytes.toString('base64') },
}));
