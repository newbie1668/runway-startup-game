import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { chromium } from '@playwright/test';
import { buildCellStockBatch, chunkTierMeshes, createScratch } from '../lib/game/render3d/cityBuilder';
import { createCellStockJob } from '../lib/game/render3d/cellStockJob';
import { indexCity } from '../lib/game/render3d/cityIndex';
import { decodeCity } from '../lib/game/render3d/format';

async function main() {
const BINARY = 'public/map/london-city.bin';
const BINARY_SHA = '6375dd81dfb23a7ef6e312b888c1b0bcf9e26b67978081a48403429221a2a2c0';
const require = createRequire(import.meta.url);
const sourceSHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() || false;
const outputDir = resolve(process.env.RUNWAY_EVIDENCE_DIR ?? 'tier-preview');
const html = await readFile(new URL('./stock-tier-preview.html', import.meta.url));
const cityBytes = await readFile(BINARY); assert.equal(createHash('sha256').update(cityBytes).digest('hex'), BINARY_SHA);
const city = decodeCity(cityBytes.buffer.slice(cityBytes.byteOffset, cityBytes.byteOffset + cityBytes.byteLength));
const cell = indexCity(city, 400).cells.get('14,10'); assert.ok(cell); assert.equal(cell.buildingIndices.length, 320);
const selected = cell.buildingIndices.slice(0, 16); const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const buildMode = process.env.RUNWAY_PREVIEW_BUILD === 'cell-job' ? 'cell-job' : 'batch';
function extract(detail: 'overview' | 'neighbourhood' | 'street') {
  let scratch = createScratch(); let group: THREE.Group | null = null;
  let previewJob: ReturnType<typeof createCellStockJob> | undefined;
  try {
  if (buildMode === 'cell-job') {
    let ready: { group: THREE.Group | null; scratch: typeof scratch } | undefined;
    previewJob = createCellStockJob({ id: `preview-${detail}`, generation: 1, essential: true, cityData: city, cell: { ...cell, buildingIndices: selected }, excludedBuildingIndices: new Set(), material, detail, now: () => 0, onReady: (value) => { ready = value; } });
    for (let i = 0; i < 10000 && !previewJob.step(); i++);
    assert.ok(ready, `cell job did not complete for ${detail}`); group = ready.group; scratch = ready.scratch;
  } else {
    group = buildCellStockBatch({ cityData: city, cellId: '14,10', buildingIndices: selected, excludedBuildingIndices: new Set(), material, scratch, detail });
  }
  assert.ok(group);
    const meshes = chunkTierMeshes(group); assert.ok(meshes.length > 0); const mesh = meshes[0]!; const geometry = mesh.geometry;
    const attrs = (name: string) => { const attribute = geometry.getAttribute(name); const values: number[] = []; for (let i = 0; i < attribute.count; i++) values.push(attribute.getX(i), attribute.itemSize > 1 ? attribute.getY(i) : 0, attribute.itemSize > 2 ? attribute.getZ(i) : 0); return values; };
    const indices = Array.from(geometry.getIndex()!.array as Uint32Array | Uint16Array | Uint8Array);
    const rawBytes = geometry.getAttribute('position').array.byteLength + geometry.getAttribute('normal').array.byteLength + geometry.getAttribute('color').array.byteLength + geometry.getIndex()!.array.byteLength;
    const sourceIds = [...new Set(meshes.flatMap((m) => (m.userData.sourceBuildingIndices as number[] ?? [])))];
    return { detail, positions: attrs('position'), normals: attrs('normal'), colors: attrs('color'), indices, sourceIds, picks: scratch.picks, vertices: geometry.getAttribute('position').count, triangles: indices.length / 3, rawBytes, buildMode, positionStorage: geometry.getAttribute('position').array.constructor.name, normalStorage: geometry.getAttribute('normal').array.constructor.name, colorStorage: geometry.getAttribute('color').array.constructor.name, indexStorage: geometry.getIndex()!.array.constructor.name, normalNormalized: geometry.getAttribute('normal').normalized, colorNormalized: geometry.getAttribute('color').normalized };
  } finally {
    try { previewJob?.cancel(); } finally { group?.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); }
  }
}
let tiers;
try {
  tiers = (['overview', 'neighbourhood', 'street'] as const).map(extract);
} finally {
  material.dispose();
}
assert.deepEqual(tiers.map((tier) => tier.sourceIds), tiers.map(() => selected));
const fixture = { sourceSHA, dirty, binarySHA256: BINARY_SHA, selectedIndices: selected, buildMode, tiers: tiers.map(({ detail, positions, normals, colors, indices, sourceIds, picks, vertices, triangles, rawBytes, positionStorage, normalStorage, colorStorage, indexStorage, normalNormalized, colorNormalized }) => ({ detail, positions, normals, colors, indices, sourceIds, picks, vertices, triangles, rawBytes, buildMode, positionStorage, normalStorage, colorStorage, indexStorage, normalNormalized, colorNormalized })) };
const threeBuildDir = dirname(require.resolve('three')); const threeModule = await readFile(join(threeBuildDir, 'three.module.js')); const threeCore = await readFile(join(threeBuildDir, 'three.core.js'));
const errors: Array<Record<string, string>> = []; let server: ReturnType<typeof createServer> | undefined; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const captureStartedAt = new Date().toISOString();
try {
  server = createServer((request, response) => { const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname; if (path === '/') { response.setHeader('content-type', 'text/html'); response.end(html); } else if (path === '/fixture.json') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(fixture)); } else if (path === '/three.module.js') { response.setHeader('content-type', 'text/javascript'); response.end(threeModule); } else if (path === '/three.core.js') { response.setHeader('content-type', 'text/javascript'); response.end(threeCore); } else { response.statusCode = 404; response.end('not found'); } });
  await new Promise<void>((resolvePromise, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolvePromise); }); const address = server.address(); assert.ok(address && typeof address === 'object');
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 2400, height: 650 }, deviceScaleFactor: 1 }); page.on('console', (message) => { if (message.type() === 'error') errors.push({ type: 'console.error', message: message.text() }); }); page.on('pageerror', (error) => errors.push({ type: 'pageerror', message: error.message }));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' }); try { await page.waitForFunction(() => (window as unknown as { __stockTierPreview?: { renderComplete?: boolean } }).__stockTierPreview?.renderComplete === true, null, { timeout: 10_000 }); } catch (error) { const message = error instanceof Error ? error.message : String(error); throw new Error(`${message}; captured browser errors: ${JSON.stringify(errors)}`, { cause: error }); } const qa = await page.evaluate(() => (window as unknown as { __stockTierPreview: Record<string, unknown> }).__stockTierPreview); assert.equal(qa.canvasCount, 3); assert.ok((qa.drawCounts as number[]).every((count) => count > 0)); assert.deepEqual(errors, []); const png = join(outputDir, 'stock-tier-comparison.png'); await mkdir(outputDir, { recursive: true }); await page.screenshot({ path: png, fullPage: false });
  const tierSummaries = tiers.map((tier) => ({ detail: tier.detail, sourceIds: tier.sourceIds, picks: tier.picks, vertices: tier.vertices, triangles: tier.triangles, rawBytes: tier.rawBytes, buildMode: tier.buildMode, positionStorage: tier.positionStorage, normalStorage: tier.normalStorage, colorStorage: tier.colorStorage, indexStorage: tier.indexStorage, normalNormalized: tier.normalNormalized, colorNormalized: tier.colorNormalized }));
  const result = { schema: 1, runtimeCapture: 'standalone geometry preview, not in-game performance or fidelity acceptance', sourceSHA: fixture.sourceSHA, exactSHA: fixture.sourceSHA, dirty: fixture.dirty, captureStartedAt, captureFinishedAt: new Date().toISOString(), binarySHA256: BINARY_SHA, selectedIndices: selected, selectedIDs: selected, buildMode, viewport: { width: 2400, height: 650, dpr: 1 }, camera: qa.camera, tiers: tierSummaries, errors, outputPath: png, browser: await browser.version(), playwright: require('@playwright/test/package.json').version, three: THREE.REVISION, rawVertexDataExcluded: true };
  await writeFile(join(outputDir, 'stock-tier-comparison.json'), `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result));
} finally {
  try { await browser?.close(); } catch {}
  try { if (server) await new Promise<void>((resolvePromise) => server!.close(() => resolvePromise())); } catch {}
}
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
