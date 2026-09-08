import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release } from 'node:os';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const baseUrl = process.env.RUNWAY_BASE_URL ?? 'http://127.0.0.1:4318';
const evidenceDir = resolve(process.env.RUNWAY_EVIDENCE_DIR ?? 'docs/runway-recovery/evidence/R3a/browser');
const screenshotsDir = join(evidenceDir, 'screenshots');
const viewport = { width: 1440, height: 900 };
const caseTimeout = 40_000;
const evaluateTimeout = 3_000;
const screenshotTimeout = 5_000;
const cleanupTimeout = 3_000;
const selected = process.env.RUNWAY_CASES?.split(',').map((value) => value.trim()).filter(Boolean);
const noticedTarget = {
  id: 'bagshaw-building-wardian-east',
  name: 'Bagshaw Building (Wardian East)',
  file: 'bagshaw-building-wardian-east.glb',
  x: 151.14295564101428,
  z: 50.26157999999867,
  exclusionM: 40,
  heightM: 179,
};

const definitions = [
  { id: 'L1-optional-manifest-503', kind: 'manifest-503', path: '/game?map=3d&look=citystreet&chrome=0&qa=1' },
  { id: 'L2-context-loss-pending-load', kind: 'context-loss', path: '/game?map=debug&look=citystreet&chrome=0&qa=1' },
  { id: 'L3-constructor-failure', kind: 'constructor-failure', path: '/game?map=3d&look=citystreet&chrome=0&qa=1' },
  { id: 'L4-city-503', kind: 'city-503', path: '/game?map=3d&look=wardian&chrome=0&qa=1' },
  { id: 'L5-city-truncated', kind: 'city-truncated', path: '/game?map=3d&look=wardian&chrome=0&qa=1' },
  { id: 'L6-noticed-glb-503', kind: 'noticed-glb-503', path: '/game?map=3d&look=wardian&chrome=0&qa=1' },
];
const invalidSelections = selected?.filter((id) => !definitions.some((definition) => definition.id === id)) ?? [];
const cases = selected?.length ? definitions.filter((definition) => selected.includes(definition.id)) : definitions;

function shell(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); }
  catch (error) { return `unavailable: ${error.message}`; }
}
function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
async function deadline(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function evaluate(page, fn, arg) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`browser evaluation timed out after ${evaluateTimeout} ms`)), evaluateTimeout); }),
    ]);
  } finally { clearTimeout(timer); }
}
function monitor(page) {
  const phase = { cleanup: false };
  const events = [];
  const add = (event) => events.push({ ...event, stage: phase.cleanup ? 'cleanup' : 'runtime' });
  page.on('console', (message) => { if (message.type() === 'error') add({ type: 'console.error', message: message.text(), location: message.location() }); });
  page.on('pageerror', (error) => add({ type: 'pageerror', message: error.message }));
  page.on('crash', () => add({ type: 'crash', message: 'page crashed' }));
  page.on('requestfailed', (request) => add({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText ?? 'unknown' }));
  page.on('response', (response) => { if (response.status() >= 400) add({ type: 'http', url: response.url(), status: response.status() }); });
  events.phase = phase;
  return events;
}
async function snapshot(page) {
  return evaluate(page, () => {
    const shell = document.querySelector('[data-map-shell]');
    const ready = document.querySelector('[data-map-ready]');
    const qa = window.__runwayQA;
    return { snapshot: qa?.snapshot?.() ?? null, mapMode: shell?.getAttribute('data-map-mode') ?? null, mapState: shell?.getAttribute('data-map-state') ?? null, mapReady: ready?.getAttribute('data-map-ready') ?? null, bridge: Boolean(qa) };
  });
}
async function waitFor(page, predicate, timeout = 8_000) {
  const began = Date.now();
  while (Date.now() - began < timeout) {
    const state = await snapshot(page);
    if (predicate(state)) return state;
    await sleep(100);
  }
  return snapshot(page);
}
function check(entry, label, condition, detail) {
  entry.assertions.push({ label, pass: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
  if (!condition) entry.failed = true;
}
function errorIsFixture(error) { return /503|fixture:|manifest/i.test(error?.message ?? ''); }
function assessEvents(entry, events, kind) {
  const expected = events.filter((event) => {
    if (kind === 'manifest-503') return (event.type === 'http' && event.status === 503 && event.url.endsWith('/map/noticed/manifest.json')) || (event.type === 'console.error' && event.location?.url?.endsWith('/map/noticed/manifest.json') && errorIsFixture(event));
    if (kind === 'context-loss') {
      if (event.type === 'requestfailed' && event.url.endsWith('/map/london-city.bin')) return true;
      if (event.type === 'console.error' || event.type === 'pageerror') return /webgl context lost|contextlost|context loss/i.test(event.message ?? '');
      return false;
    }
    if (kind === 'constructor-failure') return event.type === 'console.error' && errorIsFixture(event);
    if (kind === 'city-503') return event.type === 'http' && event.status === 503 && event.url.endsWith('/map/london-city.bin');
    if (kind === 'city-truncated') return false;
    if (kind === 'noticed-glb-503') return event.type === 'http' && event.status === 503 && event.url.endsWith(`/map/noticed/${noticedTarget.file}`);
    return false;
  });
  entry.expectedFixtureEvents = expected;
  entry.cleanupEvents = events.filter((event) => event.stage === 'cleanup');
  entry.unexpectedEvents = events.filter((event) => event.stage !== 'cleanup' && !expected.includes(event));
  check(entry, 'no unexpected browser errors', entry.unexpectedEvents.length === 0, entry.unexpectedEvents);
}
function cityFixture() {
  const raw = execFileSync('pnpm', ['tsx', 'scripts/map-failure-fixture.ts'], { encoding: 'utf8' }).trim();
  const fixture = JSON.parse(raw);
  if (fixture.kind !== 'bounded-wardian-city-fixture' || fixture.count > 80 || !Array.isArray(fixture.originalIndices) || fixture.originalIndices.length !== fixture.count || !fixture.originalIndices.includes(fixture.nearestOriginalIndex) || fixture.anchorRetained !== true || !fixture.fixture?.base64 || fixture.noticedTarget?.id !== noticedTarget.id || fixture.noticedTarget?.file !== noticedTarget.file) {
    throw new Error('map failure fixture has an invalid bounded-city contract');
  }
  return fixture;
}
async function screenshot(page, name) {
  const path = join(screenshotsDir, `${slug(name)}.png`);
  try { await page.screenshot({ path, timeout: screenshotTimeout, animations: 'disabled' }); return { path, ok: true, capturedAt: new Date().toISOString() }; }
  catch (error) { return { path, ok: false, error: error.message, capturedAt: new Date().toISOString() }; }
}
function installFixture(page, kind) {
  if (kind === 'context-loss') return page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state = { cityFetchStarted: false, citySignalAborted: false, citySettled: false, cityResult: null, cityStartedAt: null, citySettledAt: null };
    window.__r3aFixture = state;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input?.url ?? '');
      if (!url.endsWith('/map/london-city.bin')) return originalFetch(input, init);
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      state.cityFetchStarted = true; state.cityStartedAt = performance.now();
      signal?.addEventListener('abort', () => { state.citySignalAborted = true; }, { once: true });
      return originalFetch(input, init).then((response) => { state.citySettled = true; state.cityResult = `response:${response.status}`; state.citySettledAt = performance.now(); return response; }, (error) => { state.citySettled = true; state.cityResult = `error:${error?.name ?? 'unknown'}`; state.citySettledAt = performance.now(); throw error; });
    };
  });
  if (kind === 'constructor-failure') return page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio') ?? { configurable: true, enumerable: true, value: 1 };
    let thrown = false;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get() { if (!thrown) { thrown = true; throw new Error('fixture: pixel ratio unavailable'); } return 1; } });
    const originalAdd = HTMLCanvasElement.prototype.addEventListener;
    const originalRemove = HTMLCanvasElement.prototype.removeEventListener;
    const ids = new WeakMap(); let nextId = 0;
    const records = [];
    const getContextCalls = [];
    const idFor = (canvas) => { let id = ids.get(canvas); if (!id) { id = `canvas-${++nextId}`; ids.set(canvas, id); } return id; };
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { if (type === 'webgl2') getContextCalls.push({ type, canvas: idFor(this) }); return originalGetContext.call(this, type, ...args); };
    HTMLCanvasElement.prototype.addEventListener = function(type, listener, options) { if (/^webgl(contextlost|contextrestored|contextcreationerror)$/.test(type)) records.push({ action: 'add', type, canvas: idFor(this) }); return originalAdd.call(this, type, listener, options); };
    HTMLCanvasElement.prototype.removeEventListener = function(type, listener, options) { if (/^webgl(contextlost|contextrestored|contextcreationerror)$/.test(type)) records.push({ action: 'remove', type, canvas: idFor(this) }); return originalRemove.call(this, type, listener, options); };
    window.__r3aFixture = { records, getContextCalls, originalDprConfigurable: original.configurable };
  });
  return Promise.resolve();
}
async function runCase(definition, result) {
  const entry = { id: definition.id, path: definition.path, url: `${baseUrl}${definition.path}`, startedAt: new Date().toISOString(), assertions: [], snapshots: [], screenshots: [], errors: [], failed: false };
  let server; let browser; let context; let page; let events = []; let releaseCity;
  const timedOut = { value: false };
  const timer = setTimeout(() => { timedOut.value = true; entry.failed = true; entry.errors.push({ stage: 'case-deadline', message: `case exceeded ${caseTimeout} ms` }); void browser?.close().catch(() => {}); try { server?.process()?.kill?.(); } catch {} }, caseTimeout);
  try {
    server = await chromium.launchServer({ headless: true, host: '127.0.0.1' });
    browser = await chromium.connect(server.wsEndpoint());
    result.environment.browser ??= await browser.version();
    context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', colorScheme: 'light' });
    context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(15_000);
    page = await context.newPage(); events = monitor(page); entry.events = events;
    await installFixture(page, definition.kind);
    const fixture = ['city-truncated', 'noticed-glb-503'].includes(definition.kind) ? cityFixture() : null;
    if (fixture) entry.fixtureProvenance = { ...fixture, fixture: { ...fixture.fixture, base64: undefined } };
    if (definition.kind === 'manifest-503') await page.route('**/map/noticed/manifest.json', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture: noticed manifest unavailable' }));
    if (definition.kind === 'context-loss') {
      await page.route('**/map/london-city.bin', async (route) => { await new Promise((resolvePromise) => { releaseCity = resolvePromise; }); await route.continue().catch(() => {}); });
    }
    if (definition.kind === 'city-503') {
      entry.fixture = { cityRequests: 0, response: 503 };
      await page.route('**/map/london-city.bin', (route) => { entry.fixture.cityRequests++; return route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture: city unavailable' }); });
    }
    if (definition.kind === 'city-truncated') {
      entry.fixture = { cityRequests: 0, response: 'truncated', bytes: 11 };
      await page.route('**/map/london-city.bin', (route) => { entry.fixture.cityRequests++; return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(fixture.fixture.base64, 'base64').subarray(0, 11) }); });
    }
    if (definition.kind === 'noticed-glb-503') {
      const selectedNoticedTarget = fixture.noticedTarget;
      entry.fixture = { cityRequests: 0, noticedManifestRequests: 0, glbRequests: 0, noticedTarget: selectedNoticedTarget };
      await page.route('**/map/london-city.bin', (route) => { entry.fixture.cityRequests++; return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(fixture.fixture.base64, 'base64') }); });
      await page.route('**/map/noticed/manifest.json', (route) => { entry.fixture.noticedManifestRequests++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [selectedNoticedTarget] }) }); });
      await page.route(`**/map/noticed/${selectedNoticedTarget.file}`, (route) => { entry.fixture.glbRequests++; return route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture: noticed GLB unavailable' }); });
    }
    await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (definition.kind === 'manifest-503') {
      const state = await waitFor(page, (value) => value.mapMode === '3d' && value.mapState === 'degraded' && value.snapshot?.mode === '3d' && value.snapshot?.state === 'degraded' && value.mapReady === '1' && value.snapshot?.stockDrawn === true && value.snapshot.stockBuildings > 0, 30_000);
      entry.snapshots.push({ atMs: 0, ...state }); entry.screenshots.push(await screenshot(page, `${definition.id}-final`));
      check(entry, '3D mode remains active', state.mapMode === '3d' && state.snapshot?.mode === '3d', state);
      check(entry, '3D useful degraded state', state.mapState === 'degraded' && state.snapshot?.state === 'degraded', state);
      check(entry, 'stock draw is useful', state.snapshot?.stockDrawn === true && state.snapshot.stockBuildings > 0 && state.snapshot.drawCalls > 0 && state.snapshot.triangles > 0, state.snapshot);
      check(entry, 'map ready marker', state.mapReady === '1', state);
      check(entry, 'manifest failure recorded as optional 503 asset error', state.snapshot?.errors?.some((error) => error.jobId === 'asset:noticed:manifest' && !error.essential && /503/.test(error.message)), state.snapshot);
      check(entry, 'no essential load failure', !state.snapshot?.errors?.some((error) => error.essential), state.snapshot);
      entry.final = state;
    } else if (definition.kind === 'context-loss') {
      const before = await waitFor(page, (value) => value.bridge && value.snapshot?.mode === '3d' && value.snapshot?.state !== 'loading', 8_000).catch(() => null);
      entry.snapshots.push({ label: 'before-context-loss', ...(before ?? await snapshot(page)) });
      await waitFor(page, (value) => value.bridge && value.snapshot?.mode === '3d', 8_000);
      const cityStartedAt = Date.now();
      while (Date.now() - cityStartedAt < 8_000 && !(await evaluate(page, () => window.__r3aFixture?.cityFetchStarted === true))) await sleep(100);
      check(entry, 'city request started while held', await evaluate(page, () => window.__r3aFixture?.cityFetchStarted === true));
      check(entry, 'debug context-loss hook exists', await evaluate(page, () => typeof window.__runwayForceContextLoss === 'function'));
      await evaluate(page, () => window.__runwayForceContextLoss());
      const after = await waitFor(page, (value) => value.mapMode === '2d' && value.mapState === 'fallback' && value.mapReady === '1', 8_000);
      entry.snapshots.push({ label: 'after-context-loss', ...after });
      const fixture = await evaluate(page, () => ({ ...window.__r3aFixture }));
      check(entry, '2D fallback is ready', after.mapMode === '2d' && after.mapState === 'fallback' && after.mapReady === '1' && after.snapshot?.mode === '2d', after);
      check(entry, 'context-loss error and reason recorded', after.snapshot?.errors?.some((error) => error.jobId === 'contextlost' && error.essential) && /WebGL context lost/i.test(after.snapshot?.fallbackReason ?? ''), after.snapshot);
      check(entry, 'pending city request aborted', fixture.citySignalAborted === true, fixture);
      check(entry, 'debug hook removed after fallback', await evaluate(page, () => typeof window.__runwayForceContextLoss === 'undefined'));
      releaseCity?.();
      await sleep(500);
      const settled = await snapshot(page); entry.snapshots.push({ label: 'after-held-route-release', ...settled });
      entry.screenshots.push(await screenshot(page, `${definition.id}-final`));
      check(entry, 'no late 3D transition or stock mutation', settled.mapMode === '2d' && settled.snapshot?.mode === '2d' && settled.snapshot?.stockDrawn == null, settled);
      entry.fixture = fixture; entry.final = settled;
    } else if (definition.kind === 'city-503' || definition.kind === 'city-truncated') {
      const state = await waitFor(page, (value) => value.mapMode === '2d' && value.mapState === 'fallback' && value.mapReady === '1', 12_000);
      entry.snapshots.push({ atMs: 0, ...state }); entry.screenshots.push(await screenshot(page, `${definition.id}-final`));
      check(entry, 'actual city request intercepted', entry.fixture.cityRequests >= 1, entry.fixture);
      check(entry, '2D fallback is ready', state.mapMode === '2d' && state.mapState === 'fallback' && state.mapReady === '1' && state.snapshot?.mode === '2d', state);
      check(entry, 'essential city failure is recorded', state.snapshot?.errors?.some((error) => error.jobId === 'load:city' && error.essential), state.snapshot);
      check(entry, 'fallback reason identifies production city failure', /City data failed/i.test(state.snapshot?.fallbackReason ?? ''), state.snapshot);
      entry.final = state;
    } else if (definition.kind === 'noticed-glb-503') {
      const state = await waitFor(page, (value) => value.mapMode === '3d' && value.mapState === 'degraded' && value.mapReady === '1' && value.snapshot?.stockDrawn === true && value.snapshot?.stockBuildings > 0 && value.snapshot?.drawCalls > 0 && value.snapshot?.triangles > 0, 30_000);
      entry.snapshots.push({ atMs: 0, ...state }); entry.screenshots.push(await screenshot(page, `${definition.id}-final`));
      check(entry, 'actual target GLB request intercepted', entry.fixture.glbRequests >= 1, entry.fixture);
      check(entry, 'restricted manifest was requested', entry.fixture.noticedManifestRequests >= 1, entry.fixture);
      check(entry, 'bounded city fixture retains the Wardian anchor footprint', fixture.anchorRetained === true && fixture.originalIndices.includes(fixture.nearestOriginalIndex), entry.fixtureProvenance);
      check(entry, '3D remains useful and degraded', state.mapMode === '3d' && state.mapState === 'degraded' && state.snapshot?.mode === '3d' && state.snapshot?.state === 'degraded' && state.snapshot?.stockDrawn === true && state.snapshot.stockBuildings > 0 && state.snapshot.drawCalls > 0 && state.snapshot.triangles > 0, state);
      check(entry, 'exact optional GLB failure is recorded', state.snapshot?.errors?.some((error) => error.jobId === `asset:noticed:${noticedTarget.id}` && !error.essential && /HTTP 503/.test(error.message)), state.snapshot);
      check(entry, 'no essential load failure', !state.snapshot?.errors?.some((error) => error.essential), state.snapshot);
      entry.final = state;
    } else {
      const state = await waitFor(page, (value) => value.mapReady === '1' && value.mapMode === '2d', 8_000);
      entry.snapshots.push({ atMs: 0, ...state }); entry.screenshots.push(await screenshot(page, `${definition.id}-final`));
      const fixture = await evaluate(page, () => ({ ...window.__r3aFixture }));
      const registered = new Set(fixture.records.filter((record) => record.action === 'add').map((record) => `${record.canvas}:${record.type}`));
      const removed = new Set(fixture.records.filter((record) => record.action === 'remove').map((record) => `${record.canvas}:${record.type}`));
      const webgl2CallCanvasIds = new Set(fixture.getContextCalls.filter((call) => call.type === 'webgl2').map((call) => call.canvas));
      check(entry, '2D fallback is ready', state.mapMode === '2d' && state.mapState === 'fallback' && state.mapReady === '1' && state.snapshot?.mode === '2d', state);
      check(entry, 'constructor failure is essential and identified', state.snapshot?.errors?.some((error) => error.jobId === 'init:3d' && error.essential && /fixture: pixel ratio unavailable/i.test(error.message)), state.snapshot);
      check(entry, 'failed renderer attempted real WebGL2 context', [...webgl2CallCanvasIds].some((canvas) => registered.has(`${canvas}:webglcontextlost`)), { fixture, webgl2CallCanvasIds: [...webgl2CallCanvasIds], registered: [...registered] });
      check(entry, 'failed renderer listeners are removed', [...registered].every((value) => removed.has(value)), { fixture, registered: [...registered], removed: [...removed] });
      entry.fixture = fixture; entry.final = state;
    }
  } catch (error) { entry.failed = true; entry.errors.push({ stage: 'runner', message: error.message }); }
  finally {
    releaseCity?.();
    if (events.phase) events.phase.cleanup = true;
    if (context) await deadline(context.close(), cleanupTimeout, 'context close timed out').catch((error) => entry.errors.push({ stage: 'cleanup', message: error.message }));
    if (browser) await deadline(browser.close(), cleanupTimeout, 'browser close timed out').catch((error) => entry.errors.push({ stage: 'cleanup', message: error.message }));
    if (server) await deadline(server.close(), cleanupTimeout, 'browser server close timed out').catch((error) => entry.errors.push({ stage: 'cleanup', message: error.message }));
    clearTimeout(timer); entry.finishedAt = new Date().toISOString(); entry.events = [...events]; assessEvents(entry, entry.events, definition.kind);
    for (const capture of entry.screenshots) if (!capture.ok) check(entry, 'screenshot captured', false, capture);
    check(entry, 'exactly one successful final screenshot', entry.screenshots.length === 1 && entry.screenshots.filter((capture) => capture.ok).length === 1, entry.screenshots);
  }
  entry.failed ||= timedOut.value || entry.errors.some((error) => !String(error.stage).startsWith('cleanup')) || entry.assertions.some((assertion) => !assertion.pass);
  return entry;
}
const result = {
  schema: 1, startedAt: new Date().toISOString(), finishedAt: null, baseUrl,
  viewport: { ...viewport, dpr: 1 }, routes: cases.map(({ id, path }) => ({ id, path })),
  provenance: { exactSHA: shell('git', ['rev-parse', 'HEAD']), dirty: shell('git', ['status', '--porcelain']) || false },
  environment: { node: process.version, pnpm: shell('pnpm', ['--version']), playwright: require('@playwright/test/package.json').version, os: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' }, browser: null },
  cases: [], failures: [], runtimeCapture: 'browser fixture capture; provenance records the exact source SHA and bounded fixture hashes',
};
await mkdir(screenshotsDir, { recursive: true });
if (invalidSelections.length) result.failures.push({ type: 'invalid-case-selection', ids: invalidSelections });
try { for (const definition of cases) result.cases.push(await runCase(definition, result)); }
catch (error) { result.failures.push({ type: 'runner', message: error.message }); }
finally {
  result.finishedAt = new Date().toISOString();
  result.failures.push(...result.cases.filter((entry) => entry.failed).map((entry) => ({ type: 'case', id: entry.id })));
  if (result.cases.length !== cases.length) result.failures.push({ type: 'incomplete-cases', expected: cases.length, actual: result.cases.length });
  result.summary = { cases: result.cases.length, expectedCases: cases.length, failed: result.failures.length, incomplete: result.cases.filter((entry) => !entry.finishedAt).length };
  result.exitStatus = result.failures.length ? 1 : 0;
  await writeFile(join(evidenceDir, 'map-lifecycle-browser.json'), `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result.summary));
process.exitCode = result.exitStatus;
