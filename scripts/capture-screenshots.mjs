/**
 * Captures screenshots for the README.
 *
 * Runs the real page in Chromium and photographs it. Headless Chromium has no GPU, so
 * WebGL falls back to SwiftShader — geometry, layout and colour are correct, but
 * shading is softer than on a machine with a real GPU.
 *
 * Requires a server on http://localhost:3000 (`npm run dev` or `npm run start`).
 *
 * Run: npm run capture
 */

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

async function waitForModel() {
  await page.getByRole('status').filter({ hasText: 'Ready' }).first().waitFor({ timeout: 60_000 });
  // One extra beat so the entrance and cross-fade have resolved before the shutter.
  await page.waitForTimeout(1200);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await waitForModel();

await page.screenshot({ path: path.join(OUT, 'screenshot.png') });
console.log('captured docs/screenshot.png');

// A hotspot selected, so the leader line and callout are visible.
await page.getByRole('list', { name: /Hotspots/ }).getByRole('button').first().click();
await page.waitForTimeout(1200);
await page.locator('.aperture').screenshot({ path: path.join(OUT, 'callout.png') });
console.log('captured docs/callout.png');

// Dismiss it before the contact sheet. Re-selecting the row that is already selected
// is a no-op for the viewer, so without this the first frame of the sheet is captured
// with the callout still open and does not match the other seven.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// A contact sheet of every organ, one aperture each.
const rows = page
  .getByRole('navigation', { name: 'Organ library' })
  .first()
  .getByRole('listitem')
  .getByRole('button');

const count = await rows.count();
for (let index = 0; index < count; index += 1) {
  await rows.nth(index).click();
  await waitForModel();
  const name = (await rows.nth(index).innerText()).split('\n')[1] ?? `entity-${index}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.locator('.aperture').screenshot({ path: path.join(OUT, `entity-${slug}.png`) });
  console.log(`captured docs/entity-${slug}.png`);
}

await browser.close();
