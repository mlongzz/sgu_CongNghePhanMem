import { test, expect, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { osmPayload } from './osm-fixture';

// Deterministic browser API fixtures only; these tests never read device GPS.
const origin = { latitude: 10.7764, longitude: 106.6993 };
const moved = { latitude: 10.8764, longitude: 106.7193 };
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
type GpsFixtureWindow = typeof window & {
  gpsFixture: { callbacks: PositionCallback[]; emit: (index: number, coordinates: { latitude: number; longitude: number }) => void };
};

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('**/settings', route => route.fulfill({ json: { nearby_radius_km: 3, default_language: 'vi' } }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, []) }));
  await page.route('**/places/nearby?**', route => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: [{ id: 70, name: 'Official GPS Race Museum', latitude: Number(query.get('latitude')), longitude: Number(query.get('longitude')), address: 'Mock provider fixture' }] });
  });
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => {
    const [lat, lon] = new URL(route.request().url()).searchParams.get('gscoord')!.split('|').map(Number);
    return route.fulfill({ json: { query: { geosearch: [{ pageid: 700, ns: 0, title: 'Wikipedia GPS Race Landmark', lat, lon }] } } });
  });
  await page.addInitScript(() => {
    const fixture = {
      callbacks: [] as PositionCallback[],
      emit(index: number, coordinates: { latitude: number; longitude: number }) {
        this.callbacks[index]({ coords: { ...coordinates, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
      },
    };
    (window as GpsFixtureWindow).gpsFixture = fixture;
    navigator.geolocation.getCurrentPosition = success => { fixture.callbacks.push(success); };
  });
});

async function emit(page: Page, index: number, coordinates: typeof origin) {
  await page.evaluate(({ index, coordinates }) => (window as GpsFixtureWindow).gpsFixture.emit(index, coordinates), { index, coordinates });
}

test('radius 3→5→1 while a fresh GPS fix is pending uses the last radius and returned coordinates', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const requests: URL[] = [];
  page.on('request', request => { if (request.url().includes('/places/nearby?')) requests.push(new URL(request.url())); });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('gps-progress')).toBeVisible();
  for (const radius of [3, 5, 1]) await page.getByRole('button', { name: `Bán kính ${radius} km`, exact: true }).click();
  expect(requests).toHaveLength(0);
  expect(await page.evaluate(() => (window as GpsFixtureWindow).gpsFixture.callbacks.length)).toBe(1);
  await emit(page, 0, moved);
  await expect(page.getByTestId('nearby-place-list').getByText('Official GPS Race Museum', { exact: true })).toBeVisible();
  await expect(page.getByText(/GPS: Đã có vị trí \(10.87640, 106.71930\)/)).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('radius_km')).toBe('1');
  expect(requests[0].searchParams.get('latitude')).toBe(moved.latitude.toFixed(3));
  expect(requests[0].searchParams.get('longitude')).toBe(moved.longitude.toFixed(3));
  expect(errors).toEqual([]);
});

test('stale GPS reacquisition cannot be replaced by the old fix when radius changes again', async ({ page }) => {
  const requests: URL[] = [];
  page.on('request', request => { if (request.url().includes('/places/nearby?')) requests.push(new URL(request.url())); });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await emit(page, 0, origin);
  await expect(page.getByTestId('nearby-place-list').getByText('Wikipedia GPS Race Landmark', { exact: true })).toBeVisible();
  await expect(page.getByTestId('backend-poi-status')).toHaveText('FastAPI: Đã phản hồi · 1 POI chính thức.');
  await page.evaluate(() => { const realNow = Date.now; Date.now = () => realNow() + 61000; });
  // Radius 3 starts reacquisition because the previous fix is now older than 60s.
  await page.getByRole('button', { name: 'Bán kính 3 km', exact: true }).click();
  await expect(page.getByTestId('gps-progress')).toBeVisible();
  for (const radius of [5, 1]) await page.getByRole('button', { name: `Bán kính ${radius} km`, exact: true }).click();
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => (window as GpsFixtureWindow).gpsFixture.callbacks.length)).toBe(2);
  // A duplicate callback from the already finished request must not settle the new one.
  await emit(page, 0, origin);
  await expect(page.getByTestId('gps-progress')).toBeVisible();
  expect(requests).toHaveLength(1);
  await emit(page, 1, moved);
  await expect(page.getByTestId('gps-progress')).toHaveCount(0);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].searchParams.get('radius_km')).toBe('1');
  expect(requests[1].searchParams.get('latitude')).toBe(moved.latitude.toFixed(3));
  expect(requests[1].searchParams.get('longitude')).toBe(moved.longitude.toFixed(3));
  await expect(page.getByText(/GPS: Đã có vị trí \(10.87640, 106.71930\)/)).toBeVisible();
});

test('leaving the map cancels a pending GPS request and ignores its callback after returning', async ({ page }) => {
  const errors: string[] = []; const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/places\/nearby\?|\/osm\/nearby\?|vi\.wikipedia\.org\/w\/api/.test(request.url())) requests.push(request.url()); });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('gps-progress')).toBeVisible();
  // Tab navigation keeps the same browser context and the pending callback fixture.
  await page.getByText('Khám phá', { exact: true }).last().click();
  await expect(page).toHaveURL('http://127.0.0.1:8099/');
  await emit(page, 0, moved);
  await page.getByText('Bản đồ', { exact: true }).last().click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('gps-progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true })).toBeEnabled();
  await expect(page.getByText(/GPS: Chưa có vị trí/)).toBeVisible();
  expect(requests).toEqual([]); expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await emit(page, 1, moved);
  await expect(page.getByTestId('nearby-place-list').getByText('Official GPS Race Museum', { exact: true })).toBeVisible();
});
