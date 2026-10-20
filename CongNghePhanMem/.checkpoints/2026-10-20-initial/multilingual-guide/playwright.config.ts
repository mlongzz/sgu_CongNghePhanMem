import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://127.0.0.1:8099', channel: 'chrome', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.E2E_EXTERNAL_SERVERS ? [] : [
    { command: 'python ../backend/tests/e2e_server.py', url: 'http://127.0.0.1:8765', reuseExistingServer: false, timeout: 30_000 },
    { command: 'node scripts/serve-e2e.cjs', url: 'http://127.0.0.1:8099/login', reuseExistingServer: false, timeout: 20_000 },
  ],
});
