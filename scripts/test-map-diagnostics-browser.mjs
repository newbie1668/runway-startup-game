import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release } from 'node:os';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);

const baseUrl = process.env.RUNWAY_BASE_URL ?? 'http://127.0.0.1:4318';
const evidenceDir = resolve(process.env.RUNWAY_EVIDENCE_DIR ?? 'docs/runway-recovery/evidence/R1/browser');
const screenshotsDir = join(evidenceDir, 'screenshots');
const viewport = { width: 1440, height: 900 };
const caseTimeout = 45_000;
const navigationTimeout = 15_000;
const evaluateTimeout = 3_000;
const selected = process.env.RUNWAY_CASES?.split(',').map((v) => v.trim()).filter(Boolean);

const definitions = [
  { id: 'D1-qa-toggle', path: '/game?map=2d', kind: 'qa-toggle' },
  { id: 'D2-webgl2-unavailable', path: '/game?map=3d&qa=1', kind: 'webgl2-unavailable' },
  { id: 'D3-city-http-503', path: '/game?map=3d&qa=1', kind: 'city-503' },
  { id: 'B1-3d-default', path: '/game?qa=1', kind: 'production' },
  { id: 'B2-3d-citystreet', path: '/game?map=3d&look=citystreet&chrome=0&qa=1', kind: 'production' },
  { id: 'B3-3d-mid', path: '/game?map=3d&view=mid&chrome=0&qa=1', kind: 'production' },
];
const invalidSelections = selected?.filter((id) => !definitions.some((item) => item.id === id)) ?? [];
const cases = selected?.length ? definitions.filter((item) => selected.includes(item.id)) : definitions;
const result = {
  schema: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  baseUrl,
  viewport: { ...viewport, dpr: 1 },
  routes: cases.map(({ id, path }) => ({ id, path })),
  provenance: { gitSha: shell('git', ['rev-parse', 'HEAD']), dirty: shell('git', ['status', '--porcelain']) || false },
  environment: { node: process.version, pnpm: shell('pnpm', ['--version']), playwright: require('@playwright/test/package.json').version, os: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' }, browser: null },
  cases: [],
  failures: [],
};

function shell(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); }
  catch (error) { return `unavailable: ${error.message}`; }
}
function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
async function saveJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
async function withDeadline(promise, ms, message) {
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
  const events = [];
  const phase = { cleanup: false };
  const add = (event) => events.push({ ...event, stage: phase.cleanup ? 'cleanup' : 'runtime' });
  page.on('console', (message) => { if (message.type() === 'error') add({ type: 'console.error', message: message.text(), location: message.location() }); });
  page.on('pageerror', (error) => add({ type: 'pageerror', message: error.message }));
  page.on('crash', () => add({ type: 'crash', message: 'page crashed' }));
  page.on('requestfailed', (request) => add({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText ?? 'unknown' }));
  page.on('response', (response) => { if (response.status() >= 400) add({ type: 'http', url: response.url(), status: response.status() }); });
  events.phase = phase;
  return events;
}
async function screenshot(page, name) {
  const path = join(screenshotsDir, `${name}.png`);
  try { await page.screenshot({ path, timeout: 5_000, animations: 'disabled' }); return { path, ok: true, capturedAt: new Date().toISOString() }; }
  catch (error) { return { path, ok: false, error: error.message, capturedAt: new Date().toISOString() }; }
}
async function snapshot(page) {
  return evaluate(page, () => {
    const shell = document.querySelector('[data-map-shell]');
    const ready = document.querySelector('[data-map-ready]');
    const qa = window.__runwayQA;
    return { snapshot: qa?.snapshot?.() ?? null, mapMode: shell?.getAttribute('data-map-mode') ?? null, mapState: shell?.getAttribute('data-map-state') ?? null, mapReady: ready?.getAttribute('data-map-ready') ?? null, bridge: Boolean(qa) };
  });
}
async function waitForSnapshot(page, predicate, timeout = 3_000) {
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
function expectedEvents(events, kind) {
  return events.filter((event) => {
    if (kind !== 'city-503') return false;
    if (event.type === 'http' && event.status === 503 && event.url.endsWith('/map/london-city.bin')) return true;
    if (event.type === 'console.error' && event.location?.url?.endsWith('/map/london-city.bin') && /503|failed|error/i.test(event.message)) return true;
    return false;
  });
}
function assessErrors(entry, events, kind) {
  const expected = expectedEvents(events, kind);
  entry.expectedFixtureEvents = expected;
  entry.cleanupEvents = events.filter((event) => event.stage === 'cleanup');
  entry.unexpectedEvents = events.filter((event) => event.stage !== 'cleanup' && !expected.includes(event));
  check(entry, 'no unexpected browser errors', entry.unexpectedEvents.length === 0, entry.unexpectedEvents);
}
async function pollProduction(page, entry) {
  const started = Date.now();
  let fiveSecondScreenshot = false;
  while (Date.now() - started < 30_000) {
    if (!fiveSecondScreenshot && Date.now() - started >= 5_000) {
      entry.screenshots.push(await screenshot(page, `${slug(entry.id)}-5s`));
      fiveSecondScreenshot = true;
    }
    try { entry.snapshots.push({ atMs: Date.now() - started, ...(await snapshot(page)) }); }
    catch (error) { entry.errors.push({ stage: 'snapshot', message: error.message }); }
    const latest = entry.snapshots.at(-1);
    if ((latest?.snapshot?.state === 'ready' || latest?.snapshot?.state === 'degraded') && Date.now() - started >= 5_000) return;
    await sleep(Math.min(750, Math.max(0, 30_000 - (Date.now() - started))));
  }
  if (!fiveSecondScreenshot) entry.screenshots.push(await screenshot(page, `${slug(entry.id)}-5s`));
}
function summarizeSnapshots(entry) {
  const snapshots = entry.snapshots.map((item) => item.snapshot).filter(Boolean);
  const last = snapshots.at(-1) ?? null;
  const slowest = snapshots.reduce((best, item) => item.slowestJob?.ms > (best?.slowestJob?.ms ?? -1) ? item : best, null);
  const active = snapshots.filter((item) => item.activeJobId).map((item) => item.activeJobId);
  entry.snapshotSummary = { last, slowestJob: slowest?.slowestJob ?? null, activeJobIds: [...new Set(active)], maxQueuedJobs: Math.max(0, ...snapshots.map((item) => item.queuedJobs)), maxPendingEssentialJobs: Math.max(0, ...snapshots.map((item) => item.pendingEssentialJobs)), maxCompletedJobs: Math.max(0, ...snapshots.map((item) => item.completedJobs)) };
}
async function runCase(definition) {
  const entry = { id: definition.id, path: definition.path, url: `${baseUrl}${definition.path}`, startedAt: new Date().toISOString(), assertions: [], snapshots: [], errors: [], screenshots: [], failed: false };
  let server; let browser; let context; let page; let events = []; let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true; entry.failed = true; entry.errors.push({ stage: 'case-deadline', message: `case exceeded ${caseTimeout} ms` });
    void browser?.close().catch(() => {});
    try { server?.process()?.kill?.(); } catch {}
  }, caseTimeout);
  try {
    server = await chromium.launchServer({ headless: true, host: '127.0.0.1', timeout: navigationTimeout });
    browser = await chromium.connect(server.wsEndpoint());
    result.environment.browser ??= await browser.version();
    context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', colorScheme: 'light' });
    context.setDefaultTimeout(navigationTimeout); context.setDefaultNavigationTimeout(navigationTimeout);
    page = await context.newPage(); events = monitor(page); entry.events = events;
    if (definition.kind === 'webgl2-unavailable') await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...args) { if (type === 'webgl2') return null; return original.call(this, type, ...args); }; });
    if (definition.kind === 'city-503') await page.route('**/map/london-city.bin', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture: city binary unavailable' }));
    await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
    if (definition.kind === 'qa-toggle') {
      await page.locator('[data-map-ready="1"]').waitFor({ state: 'attached', timeout: navigationTimeout });
      let state = await snapshot(page); check(entry, '2D ready marker', state.mapReady === '1', state); check(entry, 'QA bridge initially absent', !state.bridge, state);
      await evaluate(page, () => history.pushState({}, '', `${location.pathname}?map=2d&qa=1`));
      state = await waitForSnapshot(page, (value) => value.bridge); check(entry, 'QA bridge appears after pushState', state.bridge, state);
      check(entry, '2D fallback mode', state.mapMode === '2d' && state.mapState === 'fallback', state); check(entry, '2D first useful frame', Number.isFinite(state.snapshot?.firstUsefulFrameMs) && state.snapshot.firstUsefulFrameMs >= 0, state.snapshot);
      check(entry, 'frozen QA bridge and snapshot', await evaluate(page, () => { const bridge = window.__runwayQA; const value = bridge?.snapshot?.(); return Boolean(bridge && Object.isFrozen(bridge) && value && Object.isFrozen(value) && Object.isFrozen(value.errors)); }), state);
      check(entry, 'camera is reported', Boolean(state.snapshot?.camera), state.snapshot); check(entry, 'bridge snapshot has no errors', state.snapshot?.errorCount === 0, state.snapshot);
      await evaluate(page, () => history.pushState({}, '', `${location.pathname}?map=2d`)); state = await waitForSnapshot(page, (value) => !value.bridge); check(entry, 'QA bridge disappears after toggle off', !state.bridge, state);
      entry.final = state;
    } else if (definition.kind === 'production') {
      await pollProduction(page, entry); entry.screenshots.push(await screenshot(page, `${slug(definition.id)}-final`)); summarizeSnapshots(entry);
      const state = entry.snapshots.at(-1); const diagnostic = state?.snapshot; check(entry, 'actual mode is 3D', state?.mapMode === '3d' && diagnostic?.mode === '3d', state); check(entry, 'state is ready or degraded', ['ready', 'degraded'].includes(state?.mapState) && ['ready', 'degraded'].includes(diagnostic?.state), state); check(entry, 'map ready marker', state?.mapReady === '1', state); check(entry, 'actual first useful frame', Number.isFinite(diagnostic?.firstUsefulFrameMs) && diagnostic.firstUsefulFrameMs >= 0, diagnostic); check(entry, 'positive stock draw metrics', diagnostic?.stockDrawn === true && Number.isFinite(diagnostic.stockBuildings) && diagnostic.stockBuildings > 0 && Number.isFinite(diagnostic.drawCalls) && diagnostic.drawCalls > 0 && Number.isFinite(diagnostic.triangles) && diagnostic.triangles > 0 && Number.isFinite(diagnostic.geometryBytes) && diagnostic.geometryBytes > 0, diagnostic);
    } else {
      await page.locator('[data-map-ready="1"]').waitFor({ state: 'attached', timeout: navigationTimeout }); const state = await snapshot(page); entry.screenshots.push(await screenshot(page, `${slug(definition.id)}-final`)); check(entry, 'fallback ready marker', state.mapReady === '1', state); check(entry, '2D fallback mode', state.mapMode === '2d' && state.mapState === 'fallback' && state.snapshot?.mode === '2d', state); check(entry, 'fallback reason', definition.kind === 'webgl2-unavailable' ? state.snapshot?.fallbackReason === 'WebGL2 unavailable' : state.snapshot?.fallbackReason?.length > 0, state.snapshot); check(entry, '2D first useful frame', Number.isFinite(state.snapshot?.firstUsefulFrameMs) && state.snapshot.firstUsefulFrameMs >= 0, state.snapshot); if (definition.kind === 'city-503') check(entry, 'essential city load error', state.snapshot?.errors?.some((error) => error.jobId === 'load:city' && error.essential && /HTTP 503|503/.test(error.message)), state.snapshot); entry.final = state;
    }
  } catch (error) { entry.failed = true; entry.errors.push({ stage: 'runner', message: error.message }); }
  finally {
    if (events.phase) events.phase.cleanup = true;
    if (context) await withDeadline(context.close(), 3_000, 'context close timed out').catch((error) => entry.errors.push({ stage: 'cleanup', message: error.message }));
    if (browser) await withDeadline(browser.close(), 3_000, 'browser close timed out').catch((error) => entry.errors.push({ stage: 'cleanup', message: error.message }));
    if (server) {
      try { await withDeadline(server.close(), 3_000, 'server close timed out'); }
      catch (error) { entry.errors.push({ stage: 'cleanup', message: error.message }); try { await withDeadline(Promise.resolve(server.kill()), 3_000, 'server kill timed out'); } catch (killError) { entry.errors.push({ stage: 'cleanup-kill', message: killError.message }); } }
    }
    clearTimeout(deadline); entry.finishedAt = new Date().toISOString(); entry.events = [...events]; assessErrors(entry, entry.events, definition.kind);
    for (const capture of entry.screenshots) if (!capture?.ok) { check(entry, 'screenshot captured', false, capture); }
  }
  entry.failed ||= timedOut || entry.errors.some((error) => error.stage !== 'cleanup' && error.stage !== 'cleanup-kill') || entry.assertions.some((assertion) => !assertion.pass);
  return entry;
}

await mkdir(screenshotsDir, { recursive: true });
if (invalidSelections.length) result.failures.push({ type: 'invalid-case-selection', ids: invalidSelections });
try { for (const definition of cases) result.cases.push(await runCase(definition)); }
catch (error) { result.failures.push({ type: 'runner', message: error.message }); }
finally {
  result.finishedAt = new Date().toISOString();
  result.failures.push(...result.cases.filter((entry) => entry.failed).map((entry) => ({ type: 'case', id: entry.id })));
  if (result.cases.length !== cases.length) result.failures.push({ type: 'incomplete-cases', expected: cases.length, actual: result.cases.length });
  result.summary = { cases: result.cases.length, expectedCases: cases.length, failed: result.failures.length, incomplete: result.cases.filter((entry) => !entry.finishedAt).length };
  result.exitStatus = result.failures.length ? 1 : 0;
  await saveJson(join(evidenceDir, 'map-diagnostics-browser.json'), result);
}
console.log(JSON.stringify(result.summary));
process.exitCode = result.failures.length ? 1 : 0;
