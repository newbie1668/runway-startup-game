/**
 * Shoot stills of data/osm-central-london-simplified.geojson itself.
 * Does not start /sim and does not read public/sim/london.bin.
 *
 * Usage: pnpm stills:extract
 */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { SIMPLIFIED_DATA_FILE } from '../lib/sim/constants';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs', 'sim-london');
const EXTRACT = path.join(ROOT, 'data', SIMPLIFIED_DATA_FILE);
const CLIENT = path.join(ROOT, 'scripts', 'extract-still-client.ts');
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
const PORT = Number(process.env.EXTRACT_STILLS_PORT ?? 4177);

const SHOTS: { file: string; view: string }[] = [
  { file: 'extract-whole-board.png', view: 'overview' },
  { file: 'extract-streets.png', view: 'streets' },
  { file: 'extract-canary.png', view: 'canary' },
  { file: 'extract-westminster.png', view: 'westminster' },
  { file: 'extract-farringdon.png', view: 'farringdon' },
];

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>EXTRACT stills — clay-board GeoJSON</title>
  <style>
    html, body, #view { margin: 0; height: 100%; width: 100%; background: #111; overflow: hidden; }
    #hud {
      position: fixed; left: 16px; top: 16px; z-index: 2;
      font: 600 18px/1.35 ui-sans-serif, system-ui, sans-serif;
      color: #f4f6f8;
      background: rgba(8, 10, 14, 0.78);
      padding: 12px 14px;
      border: 1px solid rgba(255,255,255,0.18);
      max-width: 560px;
    }
    #hud .kicker { letter-spacing: 0.14em; font-size: 12px; color: #9ecbff; margin-bottom: 4px; }
    #source { font-size: 12px; font-weight: 500; opacity: 0.88; margin-top: 6px; }
  </style>
</head>
<body>
  <div id="hud">
    <div class="kicker" id="kicker">EXTRACT · CLAY BOARD</div>
    <div id="counts">loading extract…</div>
    <div id="source"></div>
  </div>
  <div id="view"></div>
  <script src="/bundle.js"></script>
</body>
</html>
`;

function loadEsbuild(): typeof import('esbuild') {
  const require = createRequire(import.meta.url);
  try {
    return require('esbuild') as typeof import('esbuild');
  } catch {
    const pnpm = path.join(ROOT, 'node_modules', '.pnpm');
    const dir = readdirSync(pnpm).find((name) => name.startsWith('esbuild@'));
    if (!dir) throw new Error('esbuild is required to bundle extract stills');
    return require(path.join(pnpm, dir, 'node_modules', 'esbuild')) as typeof import('esbuild');
  }
}

async function bundleClient(): Promise<Uint8Array> {
  const esbuild = loadEsbuild();
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [CLIENT],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'warning',
    target: ['chrome120'],
  });
  const file = result.outputFiles?.[0];
  if (!file) throw new Error('esbuild produced no bundle');
  const text = file.text;
  if (text.includes('/sim/london.bin') || text.includes("fetch('/sim")) {
    throw new Error('extract stills bundle must not fetch /sim or london.bin');
  }
  if (!text.includes('extract.geojson')) {
    throw new Error('extract stills bundle must fetch extract.geojson');
  }
  return file.contents;
}

function contentType(url: string): string {
  if (url.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (url.endsWith('.geojson') || url.endsWith('.json'))
    return 'application/geo+json; charset=utf-8';
  return 'text/html; charset=utf-8';
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const extractJson = await readFile(EXTRACT);
  const bundle = await bundleClient();

  const server = createServer((req, res) => {
    const url = req.url?.split('?')[0] ?? '/';
    if (url === '/sim' || url.startsWith('/sim/') || url.includes('london.bin')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('extract stills server does not serve /sim');
      return;
    }
    if (url === '/extract.geojson') {
      res.writeHead(200, { 'content-type': contentType(url), 'cache-control': 'no-store' });
      res.end(extractJson);
      return;
    }
    if (url === '/bundle.js') {
      res.writeHead(200, { 'content-type': contentType(url), 'cache-control': 'no-store' });
      res.end(Buffer.from(bundle));
      return;
    }
    res.writeHead(200, { 'content-type': contentType('/') });
    res.end(HTML);
  });

  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${PORT}`;
  console.log(`extract stills at ${origin} (source ${pathToFileURL(EXTRACT).pathname})`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--window-size=1600,1000',
    ],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(180_000);
    page.on('pageerror', (err) => console.error('pageerror', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('browser', msg.text());
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        Boolean((window as unknown as { __extractReady?: boolean }).__extractReady) ||
        Boolean((window as unknown as { __extractError?: string }).__extractError),
      { timeout: 180_000 },
    );
    const boot = await page.evaluate(() => {
      const w = window as unknown as {
        __extractReady?: boolean;
        __extractError?: string;
        __extractStats?: { buildings: number; roads: number; source: string };
      };
      return { ready: w.__extractReady, error: w.__extractError, stats: w.__extractStats };
    });
    if (boot.error) throw new Error(boot.error);
    if (!boot.stats) throw new Error('extract stats missing');
    if (boot.stats.buildings > 25_000 || boot.stats.roads > 20_000) {
      throw new Error(
        `counts look like /sim (${boot.stats.buildings} buildings / ${boot.stats.roads} streets)`,
      );
    }
    console.log(
      `extract HUD ${boot.stats.buildings} buildings · ${boot.stats.roads} streets (${boot.stats.source})`,
    );

    for (const shot of SHOTS) {
      await page.evaluate((view) => {
        (window as unknown as { setExtractView?: (id: string) => void }).setExtractView?.(view);
      }, shot.view);
      await new Promise((r) => setTimeout(r, 900));
      const dest = path.join(OUT, shot.file);
      await page.screenshot({ path: dest, type: 'png' });
      console.log('wrote', dest);
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
