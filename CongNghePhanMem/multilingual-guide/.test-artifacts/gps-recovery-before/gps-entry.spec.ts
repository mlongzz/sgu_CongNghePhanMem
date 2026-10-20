import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

const origin = { latitude: 10.7764, longitude: 106.6993, accuracy: 5 };
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const wikiData = { query: { geosearch: [{ pageid: 40515, ns: 0, title: 'GPS Entry Museum', lat: origin.latitude, lon: origin.longitude }] } };

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('**/api/interpreter', route => route.fulfill({ status: 504, body: 'upstream unavailable' }));
  await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.fulfill({ json: wikiData }));
});

test('fresh page and reload need one Wikipedia click, tolerate malformed settings and request GPS once', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let wikiCalls = 0;
  page.on('request', request => { if (request.url().startsWith('https://vi.wikipedia.org/w/api.php?')) wikiCalls++; });
  await page.route('**/settings', route => route.fulfill({ json: {} }));
  await page.addInitScript(() => {
    const state = window as typeof window & { gpsCalls: number };
    state.gpsCalls = 0;
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...args) => { state.gpsCalls++; original(...args); };
  });
  await page.goto('/map');
  await expect(page.getByText(/Chưa bắt đầu tìm kiếm/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true })).toBeEnabled();
  expect(wikiCalls).toBe(0);
  await page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { gpsCalls: number }).gpsCalls)).toBe(1);
  await expect(page.locator('.poi-marker')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  expect(wikiCalls).toBe(2); expect(errors).toEqual([]);
});

test('Wikipedia starts as soon as GPS arrives even while FastAPI is pending', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/places/nearby?**', async route => { await held; await route.fulfill({ json: [] }); });
  try {
    await page.goto('/map');
    await page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true }).click();
    await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
    await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đang tìm POI chính thức...');
    await expect(page.getByRole('button', { name: 'Đang tìm địa điểm...', exact: true })).toBeDisabled();
    release();
    await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đã phản hồi · 0 POI chính thức.');
  } finally { release(); }
});

test('denied GPS sends no POI request, gives a clear error and retry can recover', async ({ page }) => {
  let poiRequests = 0;
  page.on('request', request => { if (/\/places\/nearby\?|\/api\/interpreter|vi\.wikipedia\.org\/w\/api/.test(request.url())) poiRequests++; });
  await page.addInitScript(() => {
    const state = window as typeof window & { denyGps: boolean };
    state.denyGps = true;
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (success, error, options) => state.denyGps
      ? error?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
      : original(success, error, options);
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true }).click();
  await expect(page.getByText(/GPS: Bạn chưa cấp quyền vị trí/)).toBeVisible();
  expect(poiRequests).toBe(0);
  await expect(page.getByRole('button', { name: 'Làm mới Wikipedia', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as typeof window & { denyGps: boolean }).denyGps = false; });
  await page.getByRole('button', { name: 'Làm mới Wikipedia', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
});

test('a GPS callback that never arrives ends loading through the watchdog', async ({ page }) => {
  let wikiCalls = 0;
  page.on('request', request => { if (request.url().startsWith('https://vi.wikipedia.org/w/api.php?')) wikiCalls++; });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {};
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => original(handler, timeout === 15000 ? 50 : timeout, ...args)) as typeof window.setTimeout;
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true }).click();
  await expect(page.getByText(/GPS: Chưa nhận được GPS sau 15 giây/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Làm mới Wikipedia', exact: true })).toBeEnabled();
  expect(wikiCalls).toBe(0);
});

test('manual coordinates work without GPS, validate inputs and are labelled honestly', async ({ page }) => {
  let coordinateQuery = '';
  page.on('request', request => { if (request.url().startsWith('https://vi.wikipedia.org/w/api.php?')) coordinateQuery = new URL(request.url()).searchParams.get('gscoord') ?? ''; });
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = () => { throw new Error('GPS must not be used for manual coordinates'); }; });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Bán kính 5 km', exact: true }).click();
  await page.getByRole('button', { name: 'Nhập tọa độ thay cho GPS', exact: true }).click();
  await page.getByRole('button', { name: 'Dùng tọa độ và tìm Wikipedia', exact: true }).click();
  await expect(page.getByText(/Nhập vĩ độ từ -90 đến 90/)).toBeVisible();
  expect(coordinateQuery).toBe('');
  await page.getByLabel('Vĩ độ tìm kiếm', { exact: true }).fill('10,7764');
  await page.getByLabel('Kinh độ tìm kiếm', { exact: true }).fill('106,6993');
  await page.getByRole('button', { name: 'Dùng tọa độ và tìm Wikipedia', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  await expect(page.getByText(/GPS: Không dùng GPS · Vị trí đã nhập \(10.77640, 106.69930\)/)).toBeVisible();
  expect(coordinateQuery).toBe('10.7764|106.6993');
  await expect(page.locator('.user-location-marker')).toHaveCount(1);
  await expect(page.locator('.poi-marker')).toHaveCount(1);
});

test('late server settings cannot replace the radius the user already selected', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let wikiRadius = ''; let backendRadius = '';
  page.on('request', request => {
    if (request.url().startsWith('https://vi.wikipedia.org/w/api.php?')) wikiRadius = new URL(request.url()).searchParams.get('gsradius') ?? '';
    if (request.url().includes('/places/nearby?')) backendRadius = new URL(request.url()).searchParams.get('radius_km') ?? '';
  });
  await page.route('**/settings', async route => { await held; await route.fulfill({ json: { nearby_radius_km: 20, default_language: 'vi' } }); });
  try {
    await page.goto('/map');
    await page.getByRole('button', { name: 'Bán kính 1 km', exact: true }).click();
    const settingsLoaded = page.waitForResponse(response => response.url().endsWith('/settings'));
    release(); await settingsLoaded;
    await page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true }).click();
    await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
    await expect(page.getByText(/Bán kính: 1 km/)).toBeVisible();
    expect(wikiRadius).toBe('1000'); expect(backendRadius).toBe('1');
  } finally { release(); }
});
