import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { arch, cpus, platform, totalmem } from 'node:os';
import { chromium } from '@playwright/test';
import { baseUrl, cases, hubTour, viewports } from './map-browser-fixtures.mjs';

const evidenceDir = resolve(process.env.RUNWAY_EVIDENCE_DIR ?? 'docs/runway-recovery/evidence/R0');
const screenshotsDir = join(evidenceDir, 'screenshots');
const logsDir = join(evidenceDir, 'logs');
const startedAt = new Date().toISOString();
const timeoutMs = 30_000;
const result = {
  schema: 1,
  startedAt,
  baseUrl,
  provenance: { gitSha: shell('git', ['rev-parse', 'HEAD']), dirty: shell('git', ['status', '--porcelain']) || false },
  environment: {
    node: process.version,
    pnpm: shell('pnpm', ['--version']),
    playwright: '1.63.0',
    hardware: process.env.RUNWAY_HARDWARE ?? { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', memoryGiB: Math.round(totalmem() / 2 ** 30) },
    headless: process.env.RUNWAY_HEADLESS !== '0',
  },
  limitations: [
    'data-map-ready is legacy completion only; it does not prove requested 3D, useful frame, draw calls, geometry bytes, or geographic coverage.',
    'The drag trace measures browser requestAnimationFrame intervals, not Three.js render time.',
    'This Chromium run is reproducible browser evidence; it is not representative iPhone Safari performance evidence.',
  ],
  cases: [],
  observations: [],
  failures: [],
};

function shell(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); } catch (error) { return `unavailable: ${error.message}`; }
}
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function now() { return performance.now(); }
async function saveJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
async function saveLog(name, entry) { await saveJson(join(logsDir, `${name}.json`), entry); }

function monitor(page) {
  const events = [];
  page.on('pageerror', error => events.push({ type: 'pageerror', message: error.message }));
  page.on('crash', () => events.push({ type: 'crash', message: 'page crashed' }));
  page.on('console', message => { if (message.type() === 'error') events.push({ type: 'console', message: message.text() }); });
  page.on('requestfailed', request => events.push({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText ?? 'unknown' }));
  page.on('response', response => { if (response.status() >= 400) events.push({ type: 'http', url: response.url(), status: response.status() }); });
  return events;
}

async function capture(page, name) {
  try { await page.screenshot({ path: join(screenshotsDir, `${name}.png`), fullPage: false, animations: 'disabled', timeout: 5_000 }); return null; }
  catch (error) { return `screenshot: ${error.message}`; }
}

async function runCase(browser, testCase, device) {
  const context = await browser.newContext({ ...device, locale: 'en-GB', colorScheme: 'light' });
  const page = await context.newPage();
  const events = monitor(page);
  const common = { id: testCase.id, path: testCase.path, url: `${baseUrl}${testCase.path}`, viewport: device.id, requested: { width: device.viewport.width, height: device.viewport.height, dpr: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch, input: device.id === 'mobile' ? 'touch/coarse' : 'fine pointer' } };
  const runPhase = async phase => {
    events.length = 0;
    const entry = { ...common, phase, timing: {} };
    const began = now();
    try {
      if (phase === 'cold') await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      else {
        entry.force2dBeforeReload = await page.evaluate(() => sessionStorage.getItem('runway-force-2d'));
        if (testCase.path.includes('map=3d')) await page.evaluate(() => sessionStorage.removeItem('runway-force-2d'));
        events.length = 0;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
      }
      entry.timing.navigationMs = Math.round(now() - began);
      const readyStart = now();
      await page.locator('[data-map-ready="1"]').waitFor({ state: 'attached', timeout: timeoutMs });
      entry.ready = true;
      entry.timing.readyAfterNavigationMs = Math.round(now() - readyStart);
      await page.waitForTimeout(500);
    } catch (error) { entry.ready = false; entry.error = error.message; }
    entry.timing.totalMs = Math.round(now() - began);
    entry.actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches, maxTouchPoints: navigator.maxTouchPoints })).catch(() => null);
    entry.force2dAfterLoad = await page.evaluate(() => sessionStorage.getItem('runway-force-2d')).catch(() => 'unavailable');
    const screenshotError = await capture(page, `${testCase.id}-${device.id}-${phase}`);
    if (screenshotError) events.push({ type: 'runner', message: screenshotError });
    entry.events = [...events];
    entry.failed = !entry.ready || entry.events.length > 0;
    await saveLog(`${testCase.id}-${device.id}-${phase}`, entry);
    return entry;
  };
  try { return [await runPhase('cold'), await runPhase('reload')]; }
  finally { await context.close().catch(error => result.failures.push({ type: 'context-close', id: `${testCase.id}-${device.id}`, message: error.message })); }
}

async function openDesktop(browser, path) {
  const device = viewports[0];
  const context = await browser.newContext({ ...device, locale: 'en-GB', colorScheme: 'light' });
  const page = await context.newPage();
  const events = monitor(page);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.locator('[data-map-ready="1"]').waitFor({ state: 'attached', timeout: timeoutMs });
  await page.waitForTimeout(500);
  return { context, page, events };
}

async function runHubTour(browser) {
  const entry = { id: 'B6-search-tour', actions: [], events: [] };
  let context;
  try {
    const opened = await openDesktop(browser, '/game');
    context = opened.context;
    const { page, events } = opened;
    entry.events = events;
    for (const hub of hubTour) {
      const input = page.locator('#city-search');
      await input.fill(hub);
      const matches = page.locator('[role="listbox"] button').filter({ hasText: hub });
      const count = await matches.count();
      if (count !== 1) throw new Error(`search result ambiguity for ${hub}: ${count} matching buttons`);
      await matches.first().click({ timeout: 5_000 });
      await page.waitForTimeout(500);
      const screenshotError = await capture(page, `B6-desktop-${slug(hub)}`);
      entry.actions.push({ hub, clicked: true, screenshotError });
    }
    entry.failed = events.length > 0 || entry.actions.some(action => action.screenshotError);
  } catch (error) { entry.failed = true; entry.error = error.message; }
  finally { if (context) await context.close().catch(error => entry.closeError = error.message); }
  await saveLog('B6-search-tour', entry);
  return entry;
}

async function runDragTrace(browser) {
  const entry = { id: 'B6-drag-trace', events: [], trace: [] };
  let context;
  try {
    const opened = await openDesktop(browser, '/game?map=3d&view=mid&chrome=0');
    context = opened.context;
    const { page, events } = opened;
    entry.events = events;
    await page.evaluate(() => {
      const samples = []; let last = performance.now(); const started = last;
      const tick = timestamp => { samples.push(Math.round((timestamp - last) * 100) / 100); last = timestamp; if (timestamp - started < 30_000) requestAnimationFrame(tick); else window.__runwayR0Trace = samples; };
      requestAnimationFrame(tick);
    });
    const map = page.locator('[data-map-ready="1"]');
    const box = await map.boundingBox();
    const started = now();
    if (!box) throw new Error('map bounding box unavailable for drag trace');
    for (let step = 0; step < 30; step++) {
      const direction = step % 2 ? 1 : -1;
      const fromX = box.x + box.width * (direction > 0 ? 0.35 : 0.65);
      const toX = box.x + box.width * (direction > 0 ? 0.65 : 0.35);
      const y = box.y + box.height * (0.4 + (step % 3) * 0.1);
      await page.mouse.move(fromX, y); await page.mouse.down(); await page.mouse.move(toX, y, { steps: 12 }); await page.mouse.up();
      if (step % 5 === 0) await page.mouse.wheel(0, direction * 180);
      entry.actions ??= []; entry.actions.push({ elapsedMs: Math.round(now() - started), step, fromX: Math.round(fromX), toX: Math.round(toX), y: Math.round(y) });
      await page.waitForTimeout(850);
    }
    await page.waitForFunction(() => Array.isArray(window.__runwayR0Trace), undefined, { timeout: 35_000 });
    entry.trace = await page.evaluate(() => window.__runwayR0Trace);
    await page.waitForTimeout(500);
    const screenshotError = await capture(page, 'B6-desktop-drag-endpoint');
    entry.screenshotError = screenshotError;
    entry.failed = events.length > 0 || Boolean(screenshotError);
  } catch (error) { entry.failed = true; entry.error = error.message; }
  finally { if (context) await context.close().catch(error => entry.closeError = error.message); }
  await saveLog('B6-drag-trace', entry);
  return entry;
}

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: process.env.RUNWAY_HEADLESS !== '0' });
  result.environment.browser = await browser.version();
  for (const testCase of cases) for (const device of viewports) {
    try { result.cases.push(...await runCase(browser, testCase, device)); }
    catch (error) { result.cases.push({ id: testCase.id, viewport: device.id, phase: 'context', ready: false, failed: true, error: error.message, events: [] }); }
  }
  result.observations.push(await runHubTour(browser));
  result.observations.push(await runDragTrace(browser));
} catch (error) {
  result.failures.push({ type: 'browser-launch', message: error.message });
} finally {
  if (browser) await browser.close().catch(error => result.failures.push({ type: 'browser-close', message: error.message }));
  result.finishedAt = new Date().toISOString();
  result.failures.push(...result.cases.filter(entry => entry.failed).map(entry => ({ type: 'case', id: `${entry.id}-${entry.viewport}-${entry.phase}` })));
  result.failures.push(...result.observations.filter(entry => entry.failed).map(entry => ({ type: 'observation', id: entry.id })));
  result.summary = { cases: result.cases.length, failedCases: result.cases.filter(entry => entry.failed).length, observations: result.observations.length, failedObservations: result.observations.filter(entry => entry.failed).length, failed: result.failures.length };
  await saveJson(join(evidenceDir, 'baseline.json'), result);
}
console.log(JSON.stringify(result.summary));
process.exitCode = result.failures.length ? 1 : 0;
