// Test actual Wikipedia through the exported app. Defaults to a public landmark.
// Optional location arguments may only be used after the user approves sending GPS to Wikipedia.
// Only FastAPI, Overpass and tiles are controlled; Wikipedia is never mocked.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
(async () => {
  const approvedLocationTest = process.argv.length >= 4;
  const location = { latitude: Number(process.argv[2] ?? 10.7764), longitude: Number(process.argv[3] ?? 106.6993) };
  const radiusKm = Number(process.argv[4] ?? 3);
  const manualMode = process.argv[5] === 'manual';
  const gpsMode = !manualMode && process.env.GPS_ENTRY_MODE === 'gps';
  const artifactName = gpsMode ? (approvedLocationTest ? 'wikipedia-one-gps-click-approved' : 'wikipedia-one-gps-click-public') : manualMode ? 'wikipedia-manual-entry' : approvedLocationTest ? 'wikipedia-gps-entry-approved' : 'wikipedia-gps-entry-public';
  const root = path.resolve('.e2e-web');
  const server = http.createServer((req, res) => {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
    if (!path.extname(file)) file += '.html';
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ geolocation: location, permissions: ['geolocation'], viewport: { width: 1280, height: 1400 } });
    const page = await context.newPage(); const errors = []; const statuses = [];
    await page.addInitScript(manual => {
      window.gpsCalls = 0;
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args) => {
        window.gpsCalls++;
        if (manual) throw new Error('GPS unavailable in manual entry test');
        original(...args);
      };
    }, manualMode);
    page.on('pageerror', error => { errors.push(error.message); console.log(JSON.stringify({ pageerror: error.message })); });
    page.on('response', async response => {
      if (!response.url().startsWith('https://vi.wikipedia.org/w/api.php?')) return;
      statuses.push(response.status());
      try {
        const value = await response.json();
        if (value.error || !Array.isArray(value.query?.geosearch)) console.log(JSON.stringify({ wikipediaApiError: value.error, radius: new URL(response.url()).searchParams.get('gsradius'), responseKeys: Object.keys(value) }));
      } catch { console.log(JSON.stringify({ wikipediaInvalidJson: true, type: response.headers()['content-type'] })); }
    });
    await page.route(/^http:\/\/127\.0\.0\.1:(8000|8765)\//, route => route.fulfill({ json: route.request().url().includes('/settings') ? { default_language: 'vi', nearby_radius_km: radiusKm } : [] }));
    await page.route('**/api/interpreter', route => route.fulfill({ status: 504, body: 'controlled Overpass outage' }));
    await page.route('https://tile.openstreetmap.org/**', route => route.abort());
    const devMode = !!process.env.LIVE_APP_URL;
    page.setDefaultTimeout(devMode ? 90000 : 30000);
    await page.goto(process.env.LIVE_APP_URL || `http://127.0.0.1:${server.address().port}/map`, { timeout: devMode ? 90000 : 30000 });
    await page.getByTestId('places-map').locator('.leaflet-control-zoom').waitFor();
    const initialHasLocation = !(await page.getByText(/GPS: Chưa có vị trí/).count());
    if (manualMode) {
      await page.getByRole('button', { name: 'Nhập tọa độ thay cho GPS', exact: true }).click();
      await page.getByLabel('Vĩ độ tìm kiếm', { exact: true }).fill(String(location.latitude));
      await page.getByLabel('Kinh độ tìm kiếm', { exact: true }).fill(String(location.longitude));
      await page.getByRole('button', { name: 'Dùng tọa độ và tìm Wikipedia', exact: true }).click();
    } else await page.getByRole('button', { name: gpsMode ? 'Dùng GPS và tìm địa danh' : 'Tìm bằng Wikipedia', exact: true }).click();
    try {
      await page.getByText(/Wikipedia: Đã phản hồi/).waitFor({ timeout: 15000 });
    } catch (error) {
      console.log(JSON.stringify({ statuses, errors, pageState: (await page.locator('body').innerText()).slice(0, 4500) }, null, 2));
      throw error;
    }
    await page.locator('.poi-marker[data-poi-id^="wiki-"]').first().waitFor();
    const markers = await page.locator('.poi-marker[data-poi-id^="wiki-"]').count();
    const summary = await page.getByText(/Wikipedia: Đã phản hồi/).innerText();
    const gpsCalls = await page.evaluate(() => window.gpsCalls);
    await page.getByTestId('places-map').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/${artifactName}.png`, fullPage: true });
    const result = { liveWikipedia: true, developmentMode: devMode, publicTestLandmark: !approvedLocationTest, approvedLocationTest, radiusKm, manualMode, gpsMode, mockedCoordinates: true, initialHasLocation, gpsCalls, statuses, markers, summary, errors };
    fs.writeFileSync(`.test-artifacts/${artifactName}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!markers || errors.length || (gpsMode && (gpsCalls !== 1 || initialHasLocation))) process.exitCode = 1;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
