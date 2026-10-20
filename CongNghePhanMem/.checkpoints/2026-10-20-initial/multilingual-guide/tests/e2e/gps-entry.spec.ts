import { osmPayload } from './osm-fixture';
import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

const origin = { latitude: 10.7764, longitude: 106.6993, accuracy: 5 };
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const wikiData = { query: { geosearch: [{ pageid: 40515, ns: 0, title: 'GPS Entry Museum', lat: origin.latitude, lon: origin.longitude }] } };

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ status: 504, body: 'upstream unavailable' }));
  await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.fulfill({ json: wikiData }));
});

test('fresh page and reload need one GPS click, tolerate malformed settings and automatically show fallback places', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { gpsCalls: number }).gpsCalls)).toBe(1);
  await expect(page.locator('.poi-marker')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  expect(wikiCalls).toBe(2); expect(errors).toEqual([]);
});

test('one GPS click shows fallback places while FastAPI and OpenStreetMap are both pending', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/places/nearby?**', async route => { await held; await route.fulfill({ json: [] }); });
  await page.route('**/osm/nearby?**', async route => { await held; await route.fulfill({ json: osmPayload(route, []) }); });
  try {
    await page.goto('/map');
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
    await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
    await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đang tìm POI chính thức...');
    await expect(page.getByText(/Đang đọc dữ liệu OpenStreetMap đã lưu trong/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đang tìm địa điểm...', exact: true })).toBeDisabled();
    release();
    await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đã phản hồi · 0 POI chính thức.');
  } finally { release(); }
});

test('another GPS click waits for the new position before refreshing fallback places', async ({ page, context }) => {
  const queries: string[] = [];
  const osmQueries: string[] = [];
  await page.route('**/osm/nearby?**', route => {
    osmQueries.push(new URL(route.request().url()).searchParams.get('latitude')!);
    return route.fulfill({ json: osmPayload(route, []) });
  });
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => {
    const coordinate = new URL(route.request().url()).searchParams.get('gscoord')!;
    queries.push(coordinate);
    const [lat, lon] = coordinate.split('|').map(Number);
    return route.fulfill({ json: { query: { geosearch: [{ pageid: 123, ns: 0, title: 'Place at current GPS', lat, lon }] } } });
  });
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    const state = window as typeof window & { holdGps: boolean; releaseGps: () => void };
    navigator.geolocation.getCurrentPosition = (success, error, options) => {
      // Force a fresh simulated fix here; the application intentionally accepts a browser fix up to 60s old.
      if (state.holdGps) state.releaseGps = () => original(success, error, { ...options, maximumAge: 0 });
      else original(success, error, options);
    };
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('Place at current GPS', { exact: true })).toBeVisible();
  expect(queries).toEqual(['10.7764|106.6993']);
  await expect.poll(() => osmQueries).toEqual(['10.7764']);
  await context.setGeolocation({ latitude: 10.8764, longitude: 106.6993, accuracy: 5 });
  await page.evaluate(() => { (window as typeof window & { holdGps: boolean }).holdGps = true; });
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('gps-progress')).toBeVisible();
  await page.waitForTimeout(300);
  expect(queries).toHaveLength(1);
  expect(osmQueries).toEqual(['10.7764']);
  await page.evaluate(() => (window as typeof window & { releaseGps: () => void }).releaseGps());
  await expect(page.getByText(/GPS: Đã có vị trí \(10.87640, 106.69930\)/)).toBeVisible();
  await expect(page.getByTestId('nearby-place-list').getByText('Place at current GPS', { exact: true })).toBeVisible();
  expect(queries).toEqual(['10.7764|106.6993', '10.8764|106.6993']);
  await expect.poll(() => osmQueries).toEqual(['10.7764', '10.8764']);
  await expect(page.locator('.poi-marker')).toHaveCount(1);
});

test('denied GPS sends no POI request, gives a clear error and another GPS click can recover', async ({ page }) => {
  let poiRequests = 0;
  page.on('request', request => { if (/\/places\/nearby\?|\/osm\/nearby|vi\.wikipedia\.org\/w\/api/.test(request.url())) poiRequests++; });
  await page.addInitScript(() => {
    const state = window as typeof window & { denyGps: boolean };
    state.denyGps = true;
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (success, error, options) => state.denyGps
      ? error?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
      : original(success, error, options);
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByText(/GPS: Bạn chưa cấp quyền vị trí/)).toBeVisible();
  expect(poiRequests).toBe(0);
  await expect(page.getByRole('button', { name: 'Làm mới Wikipedia', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as typeof window & { denyGps: boolean }).denyGps = false; });
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
});

test('a GPS callback that never arrives ends loading through the watchdog', async ({ page }) => {
  let wikiCalls = 0;
  page.on('request', request => { if (request.url().startsWith('https://vi.wikipedia.org/w/api.php?')) wikiCalls++; });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {};
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => original(handler, timeout === 35000 || timeout === 90000 ? 50 : timeout, ...args)) as typeof window.setTimeout;
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByText(/GPS: Chưa nhận được tọa độ sau hai lần thử GPS/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Làm mới Wikipedia', exact: true })).toBeEnabled();
  expect(wikiCalls).toBe(0);
});

test('a transient GPS error retries with high accuracy and then displays the returned position', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { gpsOptions: PositionOptions[] };
    state.gpsOptions = [];
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (success, error, options) => {
      state.gpsOptions.push(options ?? {});
      if (state.gpsOptions.length === 1) error?.({ code: 2, message: 'provider temporarily unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      else original(success, error, options);
    };
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByText(/GPS: Đã có vị trí \(10.77640, 106.69930\)/)).toBeVisible();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  const options = await page.evaluate(() => (window as typeof window & { gpsOptions: PositionOptions[] }).gpsOptions);
  expect(options.map(value => value.enableHighAccuracy)).toEqual([false, true]);
  await expect(page.locator('.user-location-marker')).toHaveCount(1);
});

test('permission progress is visible and a later approval continues the same GPS request', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    const query = navigator.permissions.query.bind(navigator.permissions);
    const status = Object.assign(new EventTarget(), { state: 'prompt', name: 'geolocation', onchange: null });
    navigator.permissions.query = descriptor => descriptor.name === 'geolocation' ? Promise.resolve(status as PermissionStatus) : query(descriptor);
    let callback: PositionCallback;
    navigator.geolocation.getCurrentPosition = success => { callback = success; };
    (window as typeof window & { approveGps: () => void }).approveGps = () => {
      status.state = 'granted'; status.dispatchEvent(new Event('change'));
      original(callback);
    };
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('gps-progress')).toHaveText(/Chọn Cho phép.*Thời gian chờ cấp quyền được tính riêng/);
  await expect(page.getByRole('button', { name: 'Hủy lấy GPS', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as typeof window & { approveGps: () => void }).approveGps());
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  await expect(page.getByTestId('gps-progress')).toHaveCount(0);
});

test('cancel ignores the old GPS callback and a new click can obtain position', async ({ page }) => {
  let poiRequests = 0;
  page.on('request', request => { if (/\/places\/nearby\?|\/osm\/nearby|vi\.wikipedia\.org\/w\/api/.test(request.url())) poiRequests++; });
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    const state = window as typeof window & { gpsCalls: number; releaseOldGps: () => void };
    state.gpsCalls = 0;
    navigator.geolocation.getCurrentPosition = (success, error, options) => {
      if (++state.gpsCalls === 1) state.releaseOldGps = () => original(success);
      else original(success, error, options);
    };
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await page.getByRole('button', { name: 'Hủy lấy GPS', exact: true }).click();
  await expect(page.getByText(/GPS: Đã hủy lấy vị trí/)).toBeVisible();
  await page.evaluate(() => (window as typeof window & { releaseOldGps: () => void }).releaseOldGps());
  await expect(page.getByText(/GPS: Chưa có vị trí/)).toBeVisible();
  expect(poiRequests).toBe(0);
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
  await expect(page.locator('.user-location-marker')).toHaveCount(1);
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
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
    await expect(page.getByTestId('nearby-place-list').getByText('GPS Entry Museum', { exact: true })).toBeVisible();
    await expect(page.getByText(/Bán kính: 1 km/)).toBeVisible();
    expect(wikiRadius).toBe('1000'); expect(backendRadius).toBe('1');
  } finally { release(); }
});
