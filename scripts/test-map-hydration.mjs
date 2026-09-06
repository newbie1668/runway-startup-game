import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, expect, request } from '@playwright/test';

const baseUrl = process.env.RUNWAY_BASE_URL ?? 'http://127.0.0.1:4318';
const evidenceDir = resolve(process.env.RUNWAY_EVIDENCE_DIR ?? 'docs/runway-recovery/evidence/R2/browser');
const screenshotsDir = join(evidenceDir, 'screenshots');
const initialClock = '2030-01-31T23:59:00Z';
const rolledClock = '2030-01-31T23:59:40Z';
const timeout = 15_000;
const check = expect.configure({ timeout });
const routes = [
  { id: 'visible-3d', path: '/game?map=3d', visible: true },
  { id: 'hidden-3d', path: '/game?map=3d&chrome=0', visible: false },
  { id: 'explicit-2d', path: '/game?map=2d', visible: false },
];
const devices = [
  { id: 'desktop1440', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { id: 'mobile390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const startedAt = new Date().toISOString();
const result = {
  schema: 1,
  startedAt,
  finishedAt: null,
  baseUrl,
  clientClockStart: initialClock,
  limitation: 'WebGL2 is deliberately stubbed to null. These cases prove hydration and deterministic 2D fallback only; they do not report actual 3D or performance behaviour.',
  provenance: { gitSha: shell('git', ['rev-parse', 'HEAD']), dirty: shell('git', ['status', '--porcelain']) || false },
  environment: { node: process.version, playwright: '1.63.0', browser: null },
  source: {},
  phases: [],
  failures: [],
};

function shell(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); }
  catch (error) { return `unavailable: ${error.message}`; }
}
function slug(value) { return value.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase(); }
function hash(body) { return createHash('sha256').update(body).digest('hex'); }
function normalize(value) { return value.replace(/\s+/g, ' ').trim(); }
async function saveJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
async function screenshot(page, name) {
  try { await page.screenshot({ path: join(screenshotsDir, `${name}.png`), timeout: 5_000, animations: 'disabled' }); return join(screenshotsDir, `${name}.png`); }
  catch (error) { return { error: error.message }; }
}
function eventsFor(page) {
  const events = [];
  page.on('pageerror', error => events.push({ type: 'pageerror', message: error.message }));
  page.on('crash', () => events.push({ type: 'crash', message: 'page crashed' }));
  page.on('console', message => { if (message.type() === 'error') events.push({ type: 'console.error', message: message.text() }); });
  page.on('requestfailed', req => events.push({ type: 'requestfailed', url: req.url(), message: req.failure()?.errorText ?? 'unknown' }));
  page.on('response', response => { if (response.status() >= 400) events.push({ type: 'http', url: response.url(), status: response.status() }); });
  return events;
}
function recordFailure(entry, label, error) {
  entry.assertions ??= [];
  entry.assertions.push({ label, pass: false, error: error.message });
  entry.failed = true;
}
async function assertion(entry, label, fn) {
  try { const value = await fn(); entry.assertions.push({ label, pass: true, value }); return value; }
  catch (error) { recordFailure(entry, label, error); return undefined; }
}
async function fetchSource(api, route) {
  const response = await api.get(`${baseUrl}${route.path}`, { timeout });
  const body = await response.text();
  const firstParagraph = body.match(/data-city-hud="pane"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1]
    ?.replace(/<[^>]+>/g, ' ').replace(/&middot;|&#183;/g, '·');
  const source = { route: route.path, status: response.status(), hash: hash(body), ssrFirstParagraph: firstParagraph ? normalize(firstParagraph) : null, htmlPath: join(evidenceDir, `source-${slug(route.id)}.html`) };
  await writeFile(source.htmlPath, body);
  result.source[route.id] = source;
  if (response.status() !== 200) throw new Error(`${route.path} source returned HTTP ${response.status()}`);
  return { body, source };
}

async function runPhase(browser, route, device, source, page, phase, clock) {
  const entry = { phase, route: route.path, routeId: route.id, viewport: { id: device.id, ...device.viewport, dpr: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch }, sourceHtmlHash: source.hash, ssrClockText: source.ssrFirstParagraph, clientClockStart: initialClock, initialClientClock: null, rolledClientClock: null, events: [], assertions: [], screenshot: null, failed: false };
  const events = eventsFor(page);
  entry.events = events;
  try {
    if (phase === 'cold') await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'domcontentloaded', timeout });
    else { await clock.setSystemTime(initialClock); await page.reload({ waitUntil: 'domcontentloaded', timeout }); }
    await page.locator('[data-map-ready="1"]').waitFor({ state: 'attached', timeout });
  } catch (error) { recordFailure(entry, 'navigation and 2D ready marker', error); }

  if (route.visible) {
    await assertion(entry, 'SSR clock is neutral', () => check(source.ssrFirstParagraph ?? '').toContain('--:--'));
    const clockLocator = page.locator('[data-city-hud="pane"] > p:first-child');
    await assertion(entry, 'initial clock', async () => {
      try {
        await check(clockLocator).toContainText('23:59 THU · JAN 31');
      } finally {
        entry.initialClientClock = await clockLocator.textContent().catch(() => null);
      }
      return normalize(entry.initialClientClock ?? '');
    });
    await assertion(entry, 'typical climate label', () => check(page.getByText('Typical monthly conditions')).toBeAttached());
    await assertion(entry, 'January sunset', () => check(page.locator('[data-city-hud="pane"]').getByText('16:18')).toBeAttached());
    await assertion(entry, 'search visible', () => check(page.locator('#city-search')).toBeVisible());
    await assertion(entry, 'Farringdon search selection', async () => {
      const input = page.locator('#city-search');
      await input.fill('Farringdon');
      const matches = page.getByRole('listbox').getByRole('button', { name: 'Farringdon Neighbourhood', exact: true });
      await check(matches).toHaveCount(1);
      await matches.click();
      await check(input).toHaveValue('Farringdon');
      await check(page.locator('[role="listbox"]')).toHaveCount(0);
      return { value: await input.inputValue() };
    });
  } else {
    await assertion(entry, 'hidden HUD pane', () => check(page.locator('[data-city-hud="pane"]')).toHaveCount(0));
    await assertion(entry, 'hidden HUD search', () => check(page.locator('[data-city-hud="search"]')).toHaveCount(0));
  }

  await assertion(entry, 'fast-forward clock rollover', async () => {
    await clock.setSystemTime(rolledClock);
    await clock.fastForward(31_000);
    if (route.visible) {
      const text = await page.locator('[data-city-hud="pane"] > p:first-child').textContent();
      entry.rolledClientClock = text;
      await check(page.locator('[data-city-hud="pane"] > p:first-child')).toContainText('00:00 FRI · FEB 1');
      await check(page.locator('[data-city-hud="pane"]')).toContainText('17:08');
    }
    return entry.rolledClientClock;
  });
  entry.screenshot = await screenshot(page, `${slug(route.id)}-${device.id}-${phase}`);
  if (entry.screenshot?.error) recordFailure(entry, 'screenshot', new Error(entry.screenshot.error));
  entry.events = [...events];
  entry.failed ||= entry.events.length > 0;
  result.phases.push(entry);
}

await mkdir(screenshotsDir, { recursive: true });
let api;
let browser;
try {
  api = await request.newContext();
  const sources = new Map();
  for (const route of routes) {
    try { sources.set(route.id, await fetchSource(api, route)); }
    catch (error) { result.failures.push({ type: 'source', route: route.path, message: error.message }); }
  }
  browser = await chromium.launch({ headless: true });
  result.environment.browser = await browser.version();
  for (const route of routes) for (const device of devices) {
    const captured = sources.get(route.id);
    if (!captured) continue;
    let context;
    try {
      context = await browser.newContext({ ...device, locale: 'en-GB', colorScheme: 'light' });
      context.setDefaultTimeout(timeout);
      context.setDefaultNavigationTimeout(timeout);
      const page = await context.newPage();
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          if (type === 'webgl2') return null;
          return original.call(this, type, ...args);
        };
      });
      await page.route('**/*', async routeRequest => {
        if (routeRequest.request().resourceType() === 'document') await routeRequest.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: captured.body });
        else await routeRequest.continue();
      });
      const clock = page.clock;
      await clock.install({ time: initialClock });
      await runPhase(browser, route, device, captured.source, page, 'cold', clock);
      await runPhase(browser, route, device, captured.source, page, 'reload', clock);
    } catch (error) {
      result.failures.push({ type: 'context', route: route.path, viewport: device.id, message: error.message });
    } finally {
      if (context) await context.close().catch(error => result.failures.push({ type: 'context-close', route: route.path, viewport: device.id, message: error.message }));
    }
  }
} catch (error) {
  result.failures.push({ type: 'runner', message: error.message });
} finally {
  if (browser) await browser.close().catch(error => result.failures.push({ type: 'browser-close', message: error.message }));
  if (api) await api.dispose().catch(error => result.failures.push({ type: 'api-close', message: error.message }));
  result.finishedAt = new Date().toISOString();
  result.failures.push(...result.phases.filter(phase => phase.failed).map(phase => ({ type: 'phase', id: `${phase.routeId}-${phase.viewport.id}-${phase.phase}` })));
  result.summary = { phases: result.phases.length, expectedPhases: 12, failedPhases: result.phases.filter(phase => phase.failed).length, capturedBrowserErrors: result.phases.reduce((count, phase) => count + phase.events.length, 0), failures: result.failures.length };
  await saveJson(join(evidenceDir, 'hydration-regression.json'), result);
}
console.log(JSON.stringify(result.summary));
process.exitCode = result.failures.length ? 1 : 0;
