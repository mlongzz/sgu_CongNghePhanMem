import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:8099', channel: 'chrome', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    // Discovery fixtures are synthetic places without photos and test radii up to 20 km; start with the place filters and the District 1 focus off.
    // tests/e2e/district1-guide.spec.ts covers the real District 1 mode (fixed filters, optimal route) separately.
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:8099', localStorage: [{ name: 'mg.placeFilters', value: '{"touristOnly":false,"withImageOnly":false,"district1Only":false}' }] }] },
  },
  webServer: process.env.E2E_EXTERNAL_SERVERS ? [] : [
    { command: 'python ../backend/tests/e2e_server.py', url: 'http://127.0.0.1:8765', reuseExistingServer: false, timeout: 30_000 },
    { command: 'node scripts/serve-e2e.cjs', url: 'http://127.0.0.1:8099/login', reuseExistingServer: false, timeout: 20_000 },
  ],
});
