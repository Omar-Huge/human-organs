import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * GPU-level guarantees.
 *
 * These are the assertions the Node suite cannot make. renderer.info.memory only moves
 * when resources are uploaded to a real WebGL context, and drawCount only advances when
 * frames are actually composited — neither exists without a browser.
 *
 * Reads the Viewer through the window hook installed by SubjectViewer.
 */

type Stats = {
  geometries: number;
  textures: number;
  programs: number;
  draws: number;
  tracked: number;
  fading: boolean;
  cache: { cached: number; inflight: number; prefetched: number };
};

const readStats = (page: Page) =>
  page.evaluate<Stats | null>(() => {
    const hook = (window as Window & { __cruisePhase?: { viewer: { stats: () => Stats } } })
      .__cruisePhase;
    return hook ? hook.viewer.stats() : null;
  });

async function waitForModel(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Ready' }).first()).toBeVisible({
    timeout: 30_000,
  });
}

/** Waits until the viewer stops drawing, then returns the settled draw count. */
async function waitForIdle(page: Page): Promise<number> {
  return page.evaluate<number>(async () => {
    const hook = (window as Window & { __cruisePhase?: { viewer: { drawCount: number } } })
      .__cruisePhase;
    if (!hook) throw new Error('viewer hook missing');

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let previous = -1;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = hook.viewer.drawCount;
      if (current === previous) return current;
      previous = current;
      await sleep(250);
    }
    throw new Error('viewer never stopped drawing');
  });
}

test('the render loop idles at zero draws when nothing moves', async ({ page }) => {
  await page.goto('/');
  await waitForModel(page);

  const settled = await waitForIdle(page);
  expect(settled).toBeGreaterThan(0);

  // Nothing is touched for a full second. A permanent rAF loop would add ~60 frames.
  await page.waitForTimeout(1000);
  const after = await readStats(page);

  expect(after?.draws).toBe(settled);
});

test('a hidden tab draws nothing', async ({ page }) => {
  await page.goto('/');
  await waitForModel(page);
  const settled = await waitForIdle(page);

  // Drive the visibility path directly: Playwright cannot background a tab, but the
  // listener the viewer installs is the same one the browser would fire.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.waitForTimeout(800);
  const hidden = await readStats(page);
  expect(hidden?.draws).toBe(settled);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Becoming visible again must produce a frame, or the canvas would be stale.
  await expect
    .poll(async () => (await readStats(page))?.draws ?? 0, { timeout: 5000 })
    .toBeGreaterThan(settled);
});

test('the selection pulse expires instead of pinning the renderer', async ({ page }) => {
  await page.goto('/');
  await waitForModel(page);
  await waitForIdle(page);

  await page.locator('button[aria-pressed]').first().click();

  // The pulse runs for a bounded window, then the loop must stop again — with the
  // callout still open.
  const afterPulse = await waitForIdle(page);
  await expect(page.locator('button[aria-pressed]').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.waitForTimeout(1000);
  const stats = await readStats(page);
  expect(stats?.draws).toBe(afterPulse);
});

test('switching entities holds at most three parsed models', async ({ page }) => {
  await page.goto('/');
  await waitForModel(page);

  const rows = page
    .getByRole('navigation', { name: 'Organ library' })
    .first()
    .getByRole('listitem')
    .getByRole('button');

  for (const index of [1, 2, 3, 4, 5]) {
    await rows.nth(index).click();
    await waitForModel(page);
  }
  await waitForIdle(page);

  const stats = await readStats(page);
  // Capacity is 3, but a referenced model is never evicted, so the cache may sit one
  // above capacity while a fade holds a second reference. Four is the ceiling.
  expect(stats?.cache.cached).toBeLessThanOrEqual(4);
  expect(stats?.cache.inflight).toBe(0);
});

test('teardown returns GPU memory to baseline', async ({ page }) => {
  await page.goto('/');
  await waitForModel(page);

  // Load several models before tearing down. This is what makes the assertion below
  // meaningful: three.js shares a single module-level geometry across every Sprite
  // ever constructed, so exactly one geometry legitimately survives teardown and can
  // never be disposed without breaking future sprites. A per-model leak would leave
  // more than one, and visiting three entities is what tells the two apart.
  const rows = page
    .getByRole('navigation', { name: 'Organ library' })
    .first()
    .getByRole('listitem')
    .getByRole('button');
  for (const index of [1, 2]) {
    await rows.nth(index).click();
    await waitForModel(page);
  }
  await waitForIdle(page);

  const loaded = await readStats(page);
  expect(loaded, 'viewer hook was not installed').not.toBeNull();
  // Establish that there was something to release in the first place — an assertion
  // that everything is zero is worthless if it was zero all along.
  expect(loaded!.geometries).toBeGreaterThan(0);
  expect(loaded!.textures).toBeGreaterThan(0);

  const after = await page.evaluate<Stats>(() => {
    const hook = (
      window as Window & { __cruisePhase?: { viewer: { dispose: () => void; stats: () => Stats } } }
    ).__cruisePhase;
    if (!hook) throw new Error('viewer hook missing');
    const { viewer } = hook;
    viewer.dispose();
    return viewer.stats();
  });

  /*
   * Both counts fall to a fixed internal baseline of one, not to zero, and neither
   * survivor is ours to release:
   *
   *  - geometries: three.js shares one module-level BufferGeometry across every Sprite
   *    ever constructed.
   *  - textures: WebGLState allocates placeholder textures through _gl.createTexture()
   *    while incrementing info.memory.textures, and they live until context loss.
   *
   * The three models loaded above are what make this assertion sharp. Each organ
   * part gets its own material, so anything leaking per model would leave dozens here.
   */
  expect(after.geometries, 'model geometries leaked after dispose').toBeLessThanOrEqual(1);
  expect(after.textures, 'model textures leaked after dispose').toBeLessThanOrEqual(1);
  expect(after.geometries).toBeLessThan(loaded!.geometries);
  expect(after.textures).toBeLessThan(loaded!.textures);
  expect(after.tracked, 'disposal registry still holds resources').toBe(0);
});
