// End-to-end scenarios: a production build of the shop, driven by Playwright
// in real browsers. Production, because only there does the server's chaos
// close a connection for real (in dev, Nuxt's proxy turns it into a 502).
//
// The tests share one server and change its state, so they run one at a time;
// each starts from a reset (fresh data, calm chaos, zeroed counters) and a
// fresh browser context (an empty IndexedDB).
//
//   npm run test:e2e                      every browser
//   npm run test:e2e -- --project=firefox one of them

import { defineConfig, devices } from '@playwright/test'

const PORT = 3100

export default defineConfig({
  testDir: './e2e',
  // Not `.spec.ts`: Vitest at the repository root would collect those.
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // Built from the repository root, as CI builds the playground.
    command: `cd .. && npx nuxt build playground && PORT=${PORT} node playground/.output/server/index.mjs`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
