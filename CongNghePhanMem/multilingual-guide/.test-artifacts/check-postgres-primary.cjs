// Browser smoke against real local PostgreSQL/API; no external POI/tile request.
const fs = require('node:fs');
const { chromium, expect } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const pageErrors = []; const directOverpass = [];
  try {
    const context = await browser.newContext({ permissions: ['geolocation'],
      geolocation: { latitude: 10.749375, longitude: 106.651078, accuracy: 5 }, viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64') }));
    await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.fulfill({ json: { query: { geosearch: [] } } }));
    await page.route(/https:\/\/overpass[^/]*\/api\/interpreter/, route => { directOverpass.push(route.request().url()); return route.abort(); });
    await page.goto('http://localhost:8081/map', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.getByTestId('places-map').locator('.leaflet-control-zoom')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Bán kính 3 km', exact: true }).click();
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
    const list = page.getByTestId('nearby-place-list');
    await expect(list.getByText('Chợ Bình Tây', { exact: true })).toBeVisible();
    await expect(list.getByText('Chùa Giác Viên', { exact: true })).toBeVisible();
    await expect(page.getByTestId('backend-poi-status')).toHaveText(/Đã phản hồi · 4 POI chính thức/);
    await expect(page.getByText(/Nguồn khám phá tùy chọn chưa được đồng bộ/)).toBeVisible();
    const count = await page.locator('.poi-marker[data-poi-id^="db-"]').count();
    if (count !== 4 || directOverpass.length || pageErrors.length) throw new Error('Unexpected markers, external request or page error');
    await page.screenshot({ path: '.test-artifacts/map-postgres-primary.png', fullPage: true });
    const result = { realPostgreSQL: true, simulatedPublicLandmarkGPS: true, officialPoiCount: count,
      directOverpassRequests: directOverpass.length, pageErrors, backendStatus: await page.getByTestId('backend-poi-status').innerText() };
    fs.writeFileSync('.test-artifacts/postgres-primary-browser.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
