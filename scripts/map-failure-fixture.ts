/**
 * Produces a small, traceable city response for browser failure checks.
 * It deliberately keeps only real building records near Wardian: the test
 * proves lifecycle behaviour without asking Chromium to render all London.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeCity, dequantizeX, dequantizeY, encodeCity, type CityBuilding } from '../lib/game/render3d/format';
import { mapReplacementAnchors } from '../lib/game/render3d/stockReplacements';

const sourcePath = resolve('public/map/london-city.bin');
const noticedId = 'bagshaw-building-wardian-east';
const source = readFileSync(sourcePath);
const committed = execFileSync('git', ['show', 'HEAD:public/map/london-city.bin'], { maxBuffer: 16 * 1024 * 1024 });
if (!source.equals(committed)) throw new Error('public/map/london-city.bin differs from HEAD; fixture provenance must use committed data');
const sourceData = decodeCity(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
const committedManifest = execFileSync('git', ['show', 'HEAD:public/map/noticed/manifest.json'], { encoding: 'utf8' });
const manifest = JSON.parse(committedManifest) as { files?: Array<Record<string, unknown>> };
const noticedTarget = manifest.files?.find((entry) => entry.id === noticedId);
if (!noticedTarget) throw new Error(`Unknown noticed fixture ID: ${noticedId}`);
if (typeof noticedTarget.file !== 'string' || typeof noticedTarget.x !== 'number' || typeof noticedTarget.z !== 'number') {
  throw new Error(`Invalid noticed fixture record for ID: ${noticedId}`);
}
const target = { id: noticedId, lng: -0.0224, lat: 51.5017, x: noticedTarget.x, z: noticedTarget.z };
const replacementMapping = mapReplacementAnchors(sourceData, [{ id: target.id, x: target.x, z: target.z }]);
if (replacementMapping.unmatchedIds.length || replacementMapping.ambiguousIds.length) {
  throw new Error(`Replacement anchor mapping failed: ${JSON.stringify({ id: target.id, unmatchedIds: replacementMapping.unmatchedIds, ambiguousIds: replacementMapping.ambiguousIds })}`);
}
const targetOriginalIndex = replacementMapping.buildingIndexById.get(target.id);
if (targetOriginalIndex == null) throw new Error(`Replacement anchor mapping has no index: ${target.id}`);
function footprintDistance(building: CityBuilding, x: number, z: number): number {
  const points = Array.from({ length: building.verts.length / 2 }, (_, i) => ({
    x: dequantizeX(building.verts[i * 2]!), z: dequantizeY(building.verts[i * 2 + 1]!),
  }));
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!;
    const b = points[i]!;
    if (a.z > z !== b.z > z && a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z) > x) inside = !inside;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    nearest = Math.min(nearest, Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz)));
  }
  return inside ? 0 : nearest;
}
const selected = sourceData.buildings
  .map((building, originalIndex) => {
    return { building, originalIndex, distanceWorld: footprintDistance(building, target.x, target.z) };
  })
  .sort((a, b) => a.distanceWorld - b.distanceWorld || a.originalIndex - b.originalIndex)
  .slice(0, 80);
if (selected.length !== 80) throw new Error(`Expected at least 80 city buildings, found ${selected.length}`);
if (!selected.some(({ originalIndex }) => originalIndex === targetOriginalIndex)) {
  throw new Error(`Bounded fixture omitted mapped target footprint: ${JSON.stringify({ id: target.id, targetOriginalIndex, count: selected.length })}`);
}
const fixture = encodeCity({
  // Deliberate simplification: all cover layers are omitted; only nearby
  // building footprints are retained for this bounded failure test.
  buildings: selected.map(({ building }) => building), roads: [], parks: [], water: [],
});
const fixtureBytes = Buffer.from(fixture);
console.log(JSON.stringify({
  schema: 1,
  kind: 'bounded-wardian-city-fixture',
  target,
  count: selected.length,
  originalIndices: selected.map(({ originalIndex }) => originalIndex),
  targetOriginalIndex,
  replacementMapping: { unmatchedIds: replacementMapping.unmatchedIds, ambiguousIds: replacementMapping.ambiguousIds },
  nearestOriginalIndex: selected[0]!.originalIndex,
  nearestDistanceWorld: selected[0]!.distanceWorld,
  anchorRetained: selected.some(({ originalIndex }) => originalIndex === targetOriginalIndex),
  noticedTarget,
  simplification: '80 closest real building footprints; all roads, parks and water deliberately omitted',
  source: {
    path: 'public/map/london-city.bin',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sha256: createHash('sha256').update(committed).digest('hex'),
  },
  manifestSource: {
    path: 'public/map/noticed/manifest.json',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sha256: createHash('sha256').update(committedManifest).digest('hex'),
  },
  fixture: { sha256: createHash('sha256').update(fixtureBytes).digest('hex'), base64: fixtureBytes.toString('base64') },
}));
