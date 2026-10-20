import { osmPayload } from './osm-fixture';
import { test, expect, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';

const origin = { latitude: 10.7764, longitude: 106.6993, accuracy: 5 };
const poi = (id: number, name: string, latitude = origin.latitude) => ({ type: 'node', id, lat: latitude, lon: origin.longitude, tags: { name, tourism: 'museum' } });
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  // These cases isolate FastAPI/OSM behavior; the automatically searched fallback is empty.
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.fulfill({ json: { query: { geosearch: [] } } }));
});

async function locate(page: Page) {
  await page.goto('/map');
  await expect(page.getByTestId('places-map').locator('.leaflet-control-zoom')).toBeVisible();
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
}

test('the real FastAPI endpoints render both ID namespaces and the browser never calls Overpass', async ({ page }) => {
  const externalCalls: string[] = []; const osmRequests: string[] = [];
  await page.route(/https:\/\/overpass[^/]*\/api\/interpreter/, route => { externalCalls.push(route.request().url()); return route.abort(); });
  page.on('request', request => {
    if (request.url().includes('/osm/nearby?')) {
      osmRequests.push(request.url());
      expect(request.headers()['authorization']).toBeUndefined();
    }
  });
  await locate(page);
  await expect(page.getByTestId('nearby-place-list').getByText('Browser Test Museum', { exact: true })).toBeVisible();
  await expect(page.getByTestId('nearby-place-list').getByText('Backend OSM Test Park', { exact: true })).toBeVisible();
  await expect(page.locator('.poi-marker[data-poi-id^="db-"]')).toHaveCount(1);
  await expect(page.locator('.poi-marker[data-poi-id^="osm-"]')).toHaveCount(1);
  expect(osmRequests).toHaveLength(1); expect(externalCalls).toEqual([]);
  expect(new URL(osmRequests[0]).searchParams.get('latitude')).toBe(String(origin.latitude));
  expect(new URL(osmRequests[0]).searchParams.has('force_refresh')).toBe(false);
});

test('GPS repeats and radius changes reuse cache, while a full reload still asks FastAPI without forcing refresh', async ({ page }) => {
  const osmRequests: string[] = []; let officialRequests = 0;
  page.on('request', request => {
    if (request.url().includes('/osm/nearby?')) osmRequests.push(request.url());
    if (request.url().includes('/places/nearby?')) officialRequests++;
  });
  await locate(page);
  const community = page.getByTestId('nearby-place-list').getByText('Backend OSM Test Park', { exact: true });
  await expect(community).toBeVisible();
  expect(osmRequests).toHaveLength(1);
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect.poll(() => officialRequests).toBe(2);
  await expect(community).toBeVisible();
  expect(osmRequests).toHaveLength(1);
  await page.getByRole('button', { name: 'Bán kính 5 km', exact: true }).click();
  await expect(community).toBeVisible();
  await expect.poll(() => osmRequests.length).toBe(2);
  await page.getByRole('button', { name: 'Bán kính 3 km', exact: true }).click();
  await expect(community).toBeVisible();
  expect(osmRequests).toHaveLength(2);
  await expect(page.locator('.poi-marker[data-poi-id^="db-"]')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(community).toBeVisible();
  expect(osmRequests).toHaveLength(3);
  for (const request of osmRequests) expect(new URL(request).searchParams.has('force_refresh')).toBe(false);
});

for (const radius of [3, 20]) {
  test(`empty FastAPI response is complete while OSM is pending at ${radius} km`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
    let release!: () => void;
    const heldResponse = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/osm/nearby?**', async route => {
      await heldResponse;
      await route.fulfill({ json: osmPayload(route, []) });
    });
    try {
      await page.goto('/map');
      await page.getByRole('button', { name: `Bán kính ${radius} km`, exact: true }).click();
      await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
      await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đã phản hồi · 0 POI chính thức.');
      await expect(page.getByText('Chưa có POI chính thức trong bán kính đã chọn.', { exact: true })).toBeVisible();
      await expect(page.getByText(`Đang tìm OpenStreetMap trong ${radius} km`, { exact: false })).toBeVisible();
      await expect(page.getByText('Đang chờ FastAPI', { exact: false })).toHaveCount(0);
      await expect(page.getByText(/Chưa tìm thấy địa điểm trong bán kính/)).toHaveCount(0);
      release();
      await expect(page.getByText('OpenStreetMap: Đã phản hồi · 0 POI khám phá đang hiển thị.', { exact: true })).toBeVisible();
      await expect(page.getByText(/Đang tìm OpenStreetMap/)).toHaveCount(0);
      await expect(page.getByText(/Chưa tìm thấy địa điểm trong bán kính/)).toBeVisible();
      expect(errors).toEqual([]);
    } finally { release(); }
  });
}

test('OSM results appear while FastAPI is still pending', async ({ page }) => {
  let release!: () => void;
  const heldResponse = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/places/nearby?**', async route => {
    await heldResponse;
    await route.fulfill({ json: [] });
  });
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, [poi(90, 'Community While Backend Pending')]) }));
  try {
    await locate(page);
    await expect(page.getByTestId('nearby-place-list').getByText('Community While Backend Pending', { exact: true })).toBeVisible();
    await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đang tìm POI chính thức...');
    release();
    await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đã phản hồi · 0 POI chính thức.');
    await expect(page.locator('.poi-marker')).toHaveCount(1);
  } finally { release(); }
});

test('20 km search displays the five km coverage reported by FastAPI', async ({ page }) => {
  let release!: () => void;
  const heldResponse = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
  await page.route('**/osm/nearby?**', async route => {
    await heldResponse;
    await route.fulfill({ json: osmPayload(route, [poi(91, 'Reduced Radius Community')], 5) });
  });
  try {
    await page.goto('/map');
    await page.getByRole('button', { name: 'Bán kính 20 km', exact: true }).click();
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
    await expect(page.getByText(/Đang tìm OpenStreetMap trong 20 km/)).toBeVisible();
    await expect(page.getByText(/Truy vấn qua FastAPI/)).toBeVisible();
    await expect(page.getByText(/10\.77640, 106\.69930/)).toBeVisible();
    release();
    await expect(page.getByTestId('nearby-place-list').getByText('Reduced Radius Community', { exact: true })).toBeVisible();
    await expect(page.getByText(/Tạm hiển thị dữ liệu trong 5 km/)).toBeVisible();
    await expect(page.locator('.poi-marker')).toHaveCount(1);
  } finally { release(); }
});

test('proxy throttling ends loading and retry stays on FastAPI', async ({ page }) => {
  let calls = 0;
  await page.route('**/osm/nearby?**', route => {
    calls++;
    return route.fulfill({ status: 503, headers: { 'Retry-After': '60' }, json: { detail: 'Không tải được địa điểm OpenStreetMap. Máy chủ đang giới hạn truy cập.' } });
  });
  await locate(page);
  await expect(page.getByText(/OpenStreetMap: Không tải được địa điểm OpenStreetMap/)).toBeVisible();
  await expect(page.getByText(/đang giới hạn truy cập/)).toBeVisible();
  await expect(page.getByText(/Đang tìm OpenStreetMap/)).toHaveCount(0);
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Thử lại OpenStreetMap', exact: true }).click();
  await expect(page.getByText(/OpenStreetMap: Không tải được địa điểm OpenStreetMap/)).toBeVisible();
  expect(calls).toBe(2);
  await expect(page.getByTestId('nearby-place-list').getByText('Browser Test Museum', { exact: true })).toBeVisible();
});

test('Web resolves the real nearby module, merges sources and renders matching Leaflet markers', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, [
    poi(101, 'Community Near'), poi(102, 'Community Near'), poi(103, 'Community Farther', 10.79),
    poi(104, 'Outside Radius', 11), poi(105, 'Browser Test Museum'), null,
  ]) }));
  await locate(page);
  const list = page.getByTestId('nearby-place-list');
  await expect(list.getByText('Community Near', { exact: true })).toHaveCount(1);
  await expect(list.getByText('Browser Test Museum', { exact: true })).toHaveCount(1);
  await expect(list.getByText('Outside Radius', { exact: true })).toHaveCount(0);
  await expect(page.locator('.poi-marker')).toHaveCount(3);
  await expect(page.locator('.user-location-marker')).toHaveCount(1);
  await page.getByLabel('Xem bản đồ Community Near', { exact: true }).click();
  await expect(page.getByText('Đang chọn: Community Near', { exact: true })).toBeVisible();
  await expect(page.getByText('Mở vị trí trên OpenStreetMap →', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/map-sources-and-markers.png', fullPage: true });
});

test('FastAPI reports provider failure without crashing and retry restores community markers', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const requests: string[] = [];
  let recover = false; let calls = 0;
  await page.route('**/osm/nearby?**', route => {
    requests.push(route.request().url());
    calls++;
    return recover ? route.fulfill({ json: osmPayload(route, [poi(201, 'Recovered Community')]) }) : route.fulfill({ status: 504, body: 'upstream timeout' });
  });
  await locate(page);
  await expect(page.getByText(/OpenStreetMap: Không tải được địa điểm OpenStreetMap/)).toBeVisible();
  expect(calls).toBe(1);
  await expect(page.getByTestId('nearby-place-list').getByText('Browser Test Museum', { exact: true })).toBeVisible();
  await expect(page.locator('.poi-marker[data-poi-id^="db-"]')).toHaveCount(1);
  recover = true;
  await page.getByRole('button', { name: 'Thử lại OpenStreetMap', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('Recovered Community', { exact: true })).toBeVisible();
  await expect(page.locator('.poi-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Bán kính 5 km', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('Recovered Community', { exact: true })).toBeVisible();
  for (const request of requests) expect(new URL(request).searchParams.has('force_refresh')).toBe(false);
  expect(errors).toEqual([]);
});

test('PostgreSQL POI lookup failure leaves the independent OSM endpoint available', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/places/nearby?**', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, [poi(301, 'OSM Independent')]) }));
  await locate(page);
  await expect(page.getByTestId('nearby-place-list').getByText('OSM Independent', { exact: true })).toBeVisible();
  await expect(page.getByText(/FastAPI: Dịch vụ đang gặp sự cố/)).toBeVisible();
  await expect(page.locator('.poi-marker')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('both FastAPI POI endpoints fail while GPS, map and retry remain available', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/places/nearby?**', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ status: 504, body: 'timeout' }));
  await locate(page);
  await expect(page.getByText(/FastAPI: Dịch vụ đang gặp sự cố/)).toBeVisible();
  await expect(page.getByText(/OpenStreetMap: Không tải được địa điểm OpenStreetMap/)).toBeVisible();
  await expect(page.locator('.poi-marker')).toHaveCount(0);
  await expect(page.locator('.user-location-marker')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Thử lại OpenStreetMap', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('empty results and malformed JSON have honest empty/error states', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
  let malformed = false;
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: malformed ? { wrong: 'shape' } : osmPayload(route, []) }));
  await locate(page);
  await expect(page.getByText(/Chưa tìm thấy địa điểm trong bán kính/)).toBeVisible();
  await expect(page.locator('.poi-marker')).toHaveCount(0);
  await expect(page.locator('.user-location-marker')).toHaveCount(1);
  malformed = true;
  // A repeat GPS search now uses the valid empty cache; use an uncached radius.
  await page.getByRole('button', { name: 'Bán kính 5 km', exact: true }).click();
  await expect(page.getByText(/OpenStreetMap: API \/osm\/nearby trả dữ liệu không hợp lệ/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('rapid radius changes requery FastAPI and discard a delayed OSM response', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const backendRadii: string[] = [];
  page.on('request', request => { if (request.url().includes('/places/nearby?')) backendRadii.push(new URL(request.url()).searchParams.get('radius_km') ?? ''); });
  let oldRequestSeen!: () => void;
  const oldRequest = new Promise<void>(resolve => { oldRequestSeen = resolve; });
  await page.route('**/osm/nearby?**', async route => {
    const radius = new URL(route.request().url()).searchParams.get('radius_km');
    if (radius === '20') {
      oldRequestSeen(); await new Promise(resolve => setTimeout(resolve, 500));
      try { await route.fulfill({ json: osmPayload(route, [poi(401, 'Stale Large Radius')]) }); } catch { /* caller cancelled */ }
    } else await route.fulfill({ json: osmPayload(route, [poi(402, 'Current Radius')]) });
  });
  await locate(page);
  await expect(page.getByTestId('nearby-place-list').getByText('Current Radius', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bán kính 20 km', exact: true }).click();
  await oldRequest;
  await page.getByRole('button', { name: 'Bán kính 5 km', exact: true }).click();
  await page.getByRole('button', { name: 'Bán kính 1 km', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('Current Radius', { exact: true })).toBeVisible();
  await expect(page.getByText('Stale Large Radius', { exact: true })).toHaveCount(0);
  await expect.poll(() => backendRadii.at(-1)).toBe('1');
  await expect(page.locator('.poi-marker')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('denied GPS leaves the Leaflet map usable and sends no POI query', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let osmCalls = 0;
  await page.route('**/osm/nearby?**', route => { osmCalls++; return route.fulfill({ json: osmPayload(route, []) }); });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_, error) => error?.({ code: 1, message: 'Permission denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  });
  await locate(page);
  await expect(page.getByText(/Bạn chưa cấp quyền vị trí/)).toBeVisible();
  await expect(page.getByTestId('places-map')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true })).toBeEnabled();
  expect(osmCalls).toBe(0); expect(errors).toEqual([]);
});
