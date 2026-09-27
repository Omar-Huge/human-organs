import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against a production build, not the dev server.
 *
 * Dev-only machinery — Strict Mode's double mount, the HMR client, the error overlay —
 * changes both the console output and the mount lifecycle, which are exactly what the
 * GPU suite asserts on. Testing the artifact that actually ships is the point.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Headless Chromium has no GPU, so WebGL runs on SwiftShader. Every model load and
  // every frame is software-rasterised, which is several times slower than a real
  // browser — the default 30s is not enough to walk all nine organs.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // WebGL in headless Chromium falls back to SwiftShader, which is slow but real —
    // the resources these tests count are genuinely allocated.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
