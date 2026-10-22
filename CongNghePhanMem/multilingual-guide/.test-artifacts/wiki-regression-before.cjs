const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 10.7764, longitude: 106.6993, accuracy: 5 } });
    const page = await context.newPage();
    await page.route('**/osm/nearby?**', r => r.fulfill({ status: 503, json: { detail: 'Optional source unavailable' } }));
    await page.route('https://*.wikipedia.org/w/api.php?**', r => r.fulfill({ json: { query: { geosearch: [{ pageid: 456, ns: 0, title: 'Wikipedia Narration Regression', lat: 10.7764, lon: 106.6993 }] } } }));
    await page.route('https://tile.openstreetmap.org/**', r => r.abort());
    await page.goto('http://localhost:8081/map', { timeout: 60000 });
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
    await expect(page.getByTestId('nearby-place-list').getByText('Wikipedia Narration Regression')).toBeVisible();
    const count = await page.getByLabel('Chi tiết Wikipedia Narration Regression', { exact: true }).count();
    fs.writeFileSync('.test-artifacts/wiki-regression-before.json', JSON.stringify({ simulatedPublicGPS: true, mockWikipedia: true, wikipediaVisible: true, detailEntryCount: count, expectedDetailEntryCount: 1, regressionFailed: count !== 1 }, null, 2));
    await expect(page.getByLabel('Chi tiết Wikipedia Narration Regression', { exact: true })).toBeVisible({ timeout: 1500 });
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
