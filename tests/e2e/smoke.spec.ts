import { expect, test } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * Smoke test.
 *
 * Walks the primary journey — pick an organ, read a hotspot, open the credits —
 * and fails on any console error or warning along the way. §12 of the brief requires a
 * clean console in the production build, so that is asserted rather than eyeballed.
 */

/** Collects console output, ignoring noise that is not ours to fix. */
function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    // SwiftShader is the software GL fallback headless Chromium uses; its shader
    // precision notices say nothing about this application.
    if (/SwiftShader|swiftshader|GroupMarkerNotSet|Automatic fallback to software/i.test(text)) return;
    problems.push(`${type}: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function waitForModel(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Ready' }).first()).toBeVisible({
    timeout: 30_000,
  });
}

test('loads, switches entities twice, opens a callout, opens and closes the dialog', async ({
  page,
}) => {
  const problems = watchConsole(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Soft Machinery', level: 1 })).toBeVisible();
  await waitForModel(page);

  const library = page.getByRole('navigation', { name: 'Organ library' }).first();
  const rows = library.getByRole('listitem').getByRole('button');
  await expect(rows).toHaveCount(9);

  // Switch one: the info panel's heading is the entity's *formal* name, matched whole.
  // The hotspot section heading is deliberately an h2 as well and carries the display
  // name ("Hotspots — Liver"), so `level: 2` does not separate the two and a
  // substring match on the display name is ambiguous for every entity whose formal
  // name contains it.
  await rows.nth(3).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Liver (Hepar)', exact: true }),
  ).toBeVisible();
  await waitForModel(page);

  // Switch two: and back to a previously viewed model, which should come from cache.
  await rows.nth(0).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Heart (Cor)', exact: true }),
  ).toBeVisible();
  await waitForModel(page);

  // Open a hotspot callout from the text-equivalent list — the same state the 3D
  // markers drive. Scoped to the named list: the cross-section toggle is also an
  // aria-pressed button, and an unscoped selector picks that up instead.
  const hotspots = page
    .getByRole('list', { name: /Hotspots/ })
    .getByRole('button');
  await expect(hotspots.first()).toBeVisible();
  await hotspots.first().click();
  await expect(hotspots.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Clear callout' })).toBeVisible();

  // Escape dismisses it and the contextual control disappears with it.
  await page.keyboard.press('Escape');
  await expect(hotspots.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Clear callout' })).toHaveCount(0);

  // Dialog: opens, is labelled, closes on Escape, and returns focus to its trigger.
  const about = page.getByRole('button', { name: 'About' });
  await about.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toContainText('CC Attribution 4.0 International');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(about).toBeFocused();

  expect(problems, `console problems:\n${problems.join('\n')}`).toEqual([]);
});

test('search filters the library and recovers from an empty result', async ({ page }) => {
  const problems = watchConsole(page);

  await page.goto('/');
  await waitForModel(page);

  const search = page.getByRole('searchbox', { name: 'Search organs' }).first();
  const library = page.getByRole('navigation', { name: 'Organ library' }).first();

  await search.fill('cornea');
  await expect(library.getByRole('listitem')).toHaveCount(1);

  await search.fill('kryptonite');
  await expect(library.getByRole('listitem')).toHaveCount(0);
  await expect(library).toContainText('Nothing matches');

  await search.fill('');
  await expect(library.getByRole('listitem')).toHaveCount(9);

  expect(problems, `console problems:\n${problems.join('\n')}`).toEqual([]);
});

/*
 * Deliberately absent: a test that walks all nine organs in the browser.
 *
 * It was written, and it worked, but headless Chromium has no GPU — WebGL falls back
 * to SwiftShader and software-rasterises every frame, which took the suite to 1.6
 * hours. A CI check nobody will wait for is a check that gets disabled.
 *
 * The coverage moved rather than disappeared: tests/models.test.ts parses all eight
 * optimised files and asserts each has real geometry and materials, which is what
 * would actually break if the asset pipeline regressed. That runs in about a second.
 */
