// Desktop release check for PR #30 (status.md E5–E7). Needs a production server:
//   pnpm build && pnpm start --hostname 127.0.0.1 --port 4317
//   pnpm check:desktop            # in a second terminal
// Runs a visible Chromium by default so the machine's real GPU is used; set RUNWAY_HEADLESS=1 to
// validate the script itself (headless software GL timings are not evidence).
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import os from 'node:os';

const baseUrl = process.env.RUNWAY_BASE_URL ?? 'http://127.0.0.1:4317';
const headless = process.env.RUNWAY_HEADLESS === '1';
const loads = Number(process.env.RUNWAY_LOADS ?? 5);
const loadTimeoutMs = Number(process.env.RUNWAY_LOAD_TIMEOUT_MS ?? 90_000);
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
const outDir = resolve(process.env.RUNWAY_EVIDENCE_DIR ?? `docs/runway-recovery/evidence/R6/desktop-check-${sha}`);
const viewport = { width: 1440, height: 900 };

const snapshot = (page) => page.evaluate(() => window.__runwayQA?.snapshot() ?? null);

function watch(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('crash', () => errors.push('page crashed'));
  return errors;
}

async function waitSettled(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await snapshot(page).catch(() => null);
    if (s && s.state !== 'loading') return s;
    if (Date.now() > deadline) return s ?? { state: 'timeout' };
    await page.waitForTimeout(100);
  }
}

async function fresh(browser, path) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB' });
  const page = await context.newPage();
  const errors = watch(page);
  const started = Date.now();
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: loadTimeoutMs });
  const settled = await waitSettled(page, loadTimeoutMs);
  return { context, page, errors, settled, wallMs: Date.now() - started };
}

/** E6: each cold load (fresh context, empty cache) reaches ready 3D with no error. */
async function checkLoads(browser) {
  const samples = [];
  for (let i = 0; i < loads; i++) {
    const { context, page, errors, settled, wallMs } = await fresh(browser, '/game?qa=1');
    await page.screenshot({ path: join(outDir, `load-${i + 1}.png`) });
    samples.push({
      mode: settled.mode, state: settled.state, firstUsefulFrameMs: settled.firstUsefulFrameMs,
      wallMs, drawCalls: settled.drawCalls, triangles: settled.triangles,
      geometryMiB: settled.geometryBytes == null ? null : +(settled.geometryBytes / 1048576).toFixed(1),
      errors: [...errors, ...(settled.errors ?? []).map((e) => `${e.jobId}: ${e.message}`)],
    });
    await context.close();
  }
  const pass = samples.every((s) => s.mode === '3d' && s.state === 'ready' && s.errors.length === 0);
  const times = samples.map((s) => s.firstUsefulFrameMs).filter((t) => t != null).sort((a, b) => a - b);
  return { pass, medianFirstUsefulFrameMs: times.length ? times[Math.floor(times.length / 2)] : null, samples };
}

/** E7: 30 s of continuous drag panning; p95 animation-frame interval ≤ 33 ms. */
async function checkPan(browser) {
  const { context, page, errors, settled } = await fresh(browser, '/game?qa=1&chrome=0');
  if (settled.state !== 'ready') { await context.close(); return { pass: false, reason: `map ${settled.state}` }; }
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => { window.__frames.push(t - last); last = t; if (!window.__stopFrames) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const cx = viewport.width / 2, cy = viewport.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const end = Date.now() + 30_000;
  for (let step = 0; Date.now() < end; step++) {
    const a = step / 20;
    await page.mouse.move(cx + Math.cos(a) * 250, cy + Math.sin(a) * 150);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const frames = await page.evaluate(() => { window.__stopFrames = true; return window.__frames.slice(5); });
  const sorted = [...frames].sort((a, b) => a - b);
  if (sorted.length < 100) { await context.close(); return { pass: false, reason: `only ${sorted.length} frames sampled` }; }
  const pct = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1);
  const after = await snapshot(page);
  errors.push(...(after.errors ?? []).map((e) => `${e.jobId}: ${e.message}`));
  await page.screenshot({ path: join(outDir, 'pan-end.png') });
  await context.close();
  const p95 = pct(0.95);
  return {
    pass: p95 <= 33 && errors.length === 0 && after.state === 'ready',
    frames: frames.length, medianMs: pct(0.5), p95Ms: p95,
    drawCalls: after.drawCalls, triangles: after.triangles, errors,
  };
}

/**
 * E5: from the wide overview, zoom in with the wheel and reverse early. `stockBuildings` counts
 * buildings the stream keeps in the scene (off-screen stale context included), sampled every
 * animation frame. The whole-city overview nearly fills the 128 MiB budget, so zooming in
 * releases the farthest stale tiles beyond the 96 MiB background level. The CPU replay
 * (scripts/profile-gradual-zoom.ts) keeps ~80%, against 25% before the fix. The 75% line was set
 * from that replay: it detects the old collapse, but it is this change's own yardstick, not a
 * product target. Pass: ≥75% kept on every frame, ≥95% restored 8 s after returning, no errors.
 */
async function checkReversal(browser) {
  const results = [];
  for (const reverseAfterMs of [30, 500]) {
    const { context, page, errors, settled } = await fresh(browser, '/game?qa=1&chrome=0&view=wide');
    if (settled.state !== 'ready') { await context.close(); results.push({ reverseAfterMs, pass: false, reason: `map ${settled.state}` }); continue; }
    await page.waitForTimeout(3_000); // let background prefetch settle
    const before = (await snapshot(page)).stockBuildings;
    await page.evaluate(() => {
      window.__stock = [];
      const tick = () => { const s = window.__runwayQA.snapshot(); window.__stock.push(s.stockBuildings ?? 0); if (!window.__stopStock) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const cx = viewport.width / 2, cy = viewport.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(reverseAfterMs);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 240);
    await page.waitForTimeout(8_000);
    const stock = await page.evaluate(() => { window.__stopStock = true; return window.__stock; });
    const min = stock.length ? Math.min(...stock) : 0; // no frames sampled is a failure, not a pass
    const after = await snapshot(page);
    const final = after.stockBuildings;
    errors.push(...(after.errors ?? []).map((e) => `${e.jobId}: ${e.message}`));
    await page.screenshot({ path: join(outDir, `reversal-${reverseAfterMs}ms.png`) });
    await context.close();
    results.push({
      reverseAfterMs, frames: stock.length, stockBefore: before, stockMin: min, stockFinal: final,
      minRatio: before ? +(min / before).toFixed(3) : null,
      pass: before > 0 && min >= 0.75 * before && final >= 0.95 * before && errors.length === 0, errors,
    });
  }
  return { pass: results.every((r) => r.pass), results };
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  headless,
  channel: process.env.RUNWAY_CHANNEL || undefined,
  executablePath: process.env.RUNWAY_CHROMIUM_PATH || undefined,
});
const report = {
  commit: sha, date: new Date().toISOString(), baseUrl, headless,
  machine: { platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGiB: Math.round(os.totalmem() / 2 ** 30) },
  browser: browser.version(), viewport,
};
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${baseUrl}/game?qa=1`);
  report.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl ? 'unknown' : 'no WebGL2';
  });
  await page.context().close();
  report.E6_loads = await checkLoads(browser);
  report.E7_pan = await checkPan(browser);
  report.E5_reversal = await checkReversal(browser);
} finally {
  await browser.close();
}
await writeFile(join(outDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
const line = (id, r, detail) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
console.log(`Commit ${sha} · ${report.browser} · GPU: ${report.gpu}${headless ? ' · HEADLESS (not evidence)' : ''}`);
line('E6 loads into 3D', report.E6_loads, `${report.E6_loads.samples.filter((s) => s.state === 'ready').length}/${loads} ready, median ${report.E6_loads.medianFirstUsefulFrameMs} ms to useful 3D`);
line('E7 smooth panning', report.E7_pan, `p95 ${report.E7_pan.p95Ms} ms (limit 33), median ${report.E7_pan.medianMs} ms`);
for (const r of report.E5_reversal.results)
  line(`E5 reverse zoom @${r.reverseAfterMs}ms`, r, `stock ${r.stockBefore} → min ${r.stockMin} → ${r.stockFinal}`);
console.log(`Details: ${join(outDir, 'result.json')}`);
process.exitCode = report.E6_loads.pass && report.E7_pan.pass && report.E5_reversal.pass ? 0 : 1;
