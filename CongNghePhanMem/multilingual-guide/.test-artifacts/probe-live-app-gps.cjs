// Exercise the running Expo development app with real browser geolocation.
// No coordinates are provided by Playwright. No coordinates are printed or sent to POI services.
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ permissions: ['geolocation'] });
    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    const errors = []; const progress = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
    await page.route('**/api/interpreter', route => route.fulfill({ json: { elements: [] } }));
    await page.route('https://tile.openstreetmap.org/**', route => route.abort());
    await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.abort());
    await page.addInitScript(() => {
      window.gpsRequests = [];
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (success, error, options) => {
        window.gpsRequests.push(options);
        original(success, error, options);
      };
    });
    await page.goto('http://localhost:8081/map', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
    const started = Date.now();
    for (let i = 0; i < 90; i++) {
      const text = await page.getByTestId('gps-progress').textContent().catch(() => '');
      if (text && progress.at(-1) !== text) progress.push(text);
      if (await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).isEnabled().catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const state = (await page.locator('body').innerText()).split('\n').filter(line => /^GPS:/.test(line)).map(line => line.replace(/\(-?\d+\.\d+, -?\d+\.\d+\)/g, '(coordinates withheld)'));
    const result = { developmentMode: true, mockedCoordinates: false, ms: Date.now() - started,
      state, progress, requests: await page.evaluate(() => window.gpsRequests), errors,
      retryEnabled: await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).isEnabled() };
    fs.writeFileSync('.test-artifacts/real-gps-development.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
