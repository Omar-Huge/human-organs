import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Does anything actually appear on screen?
 *
 * Every other assertion in this project can pass while the viewer shows an empty
 * rectangle: the scene graph can be correct, materials pristine, meshes flagged
 * visible, the camera framed — and the canvas still blank, because under
 * render-on-demand a correct scene that nobody asked to draw is an invisible one.
 *
 * That is not hypothetical. Retiring a cross-faded model mutated the scene without
 * requesting a redraw, so every entity switch left a stale frame and only the first
 * model ever rendered. It survived a full DOM and GPU test suite. These tests count
 * pixels, which is the only thing that would have caught it.
 */

/**
 * Fraction of pixels that differ meaningfully from the flat background field.
 *
 * The background is taken as the *modal* colour, not a corner sample. A corner lands
 * on the aperture's inset border, which differs from the void — so measuring against
 * it scored a blank viewer at 99% coverage and made this test pass on exactly the bug
 * it was written to catch. Colours are quantised to 5 bits per channel first, so
 * shading gradients in the flat field do not split the mode across neighbours.
 */
async function subjectCoverage(target: Locator): Promise<number> {
  const png = await target.screenshot();
  const { data, info } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += info.channels) {
    const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let modeKey = 0;
  let best = 0;
  for (const [key, count] of counts) {
    if (count > best) {
      best = count;
      modeKey = key;
    }
  }
  const bg = [((modeKey >> 10) & 31) << 3, ((modeKey >> 5) & 31) << 3, (modeKey & 31) << 3];

  let lit = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const distance =
      Math.abs(data[i]! - bg[0]!) +
      Math.abs(data[i + 1]! - bg[1]!) +
      Math.abs(data[i + 2]! - bg[2]!);
    if (distance > 40) lit += 1;
  }

  return lit / (info.width * info.height);
}

async function waitForModel(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Ready' }).first()).toBeVisible({
    timeout: 60_000,
  });
  // Let the cross-fade and any tween resolve before counting pixels.
  await page.waitForTimeout(1500);
}

test('the viewer renders a subject, and keeps rendering one across switches', async ({ page }) => {
  await page.goto('/');
  const aperture = page.locator('.aperture');
  await waitForModel(page);

  const initial = await subjectCoverage(aperture);
  expect(initial, 'nothing rendered on first load').toBeGreaterThan(0.01);

  const rows = page
    .getByRole('navigation', { name: 'Organ library' })
    .first()
    .getByRole('listitem')
    .getByRole('button');

  // Three switches: the first exercises the cross-fade from the initial model, the
  // next fades between two freshly loaded models, and the last returns to a cached one
  // whose materials the fade previously mutated.
  const journey: ReadonlyArray<readonly [number, string]> = [
    [2, 'Lungs'],
    [6, 'Intestine'],
    [0, 'Heart (cached)'],
  ];

  for (const [index, label] of journey) {
    await rows.nth(index).click();
    await waitForModel(page);

    const coverage = await subjectCoverage(aperture);
    expect(
      coverage,
      `${label} rendered a blank viewer (coverage ${coverage.toFixed(4)})`,
    ).toBeGreaterThan(0.01);
  }
});

test('the frame is stable once a switch has settled', async ({ page }) => {
  await page.goto('/');
  const aperture = page.locator('.aperture');
  await waitForModel(page);

  const rows = page
    .getByRole('navigation', { name: 'Organ library' })
    .first()
    .getByRole('listitem')
    .getByRole('button');

  await rows.nth(4).click();
  await waitForModel(page);
  const settled = await subjectCoverage(aperture);
  expect(settled).toBeGreaterThan(0.01);

  // Nothing is touched. A fade left half-resolved, or a model retired without a
  // redraw, would show up as coverage that keeps moving.
  await page.waitForTimeout(1500);
  const later = await subjectCoverage(aperture);
  expect(Math.abs(later - settled), 'the viewer was still changing after settling').toBeLessThan(
    0.005,
  );
});
