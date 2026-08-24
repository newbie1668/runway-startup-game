/**
 * Capture /sim stills for the PR. Requires the dev server and Google Chrome.
 *
 * Usage: pnpm dev  (elsewhere)
 *        pnpm tsx scripts/capture-sim-stills.ts
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.SIM_URL ?? 'http://127.0.0.1:3000/sim';
const OUT = path.join(process.cwd(), 'docs', 'sim-london');
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';

const SHOTS: { file: string; label: string; waitMs?: number }[] = [
  { file: 'whole-board.png', label: 'London', waitMs: 1200 },
  { file: 'thames.png', label: 'London Bridge', waitMs: 1600 },
  { file: 'canary-wharf.png', label: 'Canary Wharf', waitMs: 1600 },
  { file: 'westminster.png', label: 'Westminster', waitMs: 1600 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--window-size=1600,1000',
    ],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(180_000);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body.innerText.includes('buildings') && document.body.innerText.includes('streets'),
    { timeout: 180_000 },
  );
  await new Promise((r) => setTimeout(r, 1500));

  for (const shot of SHOTS) {
    await page.evaluate((label) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      buttons.find((b) => b.textContent?.trim() === label)?.click();
    }, shot.label);
    await new Promise((r) => setTimeout(r, shot.waitMs ?? 1400));
    const dest = path.join(OUT, shot.file);
    await page.screenshot({ path: dest, type: 'png' });
    console.log('wrote', dest);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
