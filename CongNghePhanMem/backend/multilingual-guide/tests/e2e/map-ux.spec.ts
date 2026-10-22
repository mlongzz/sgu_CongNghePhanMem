import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { osmPayload } from './osm-fixture';

const origin = { latitude: 10.7764, longitude: 106.6993, accuracy: 102 };
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.fulfill({ json: { query: { geosearch: [] } } }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, [{ type: 'node', id: 501, lat: origin.latitude + .001, lon: origin.longitude, tags: { name: 'Nearby Garden', leisure: 'park' } }]) }));
});

test('clean mobile/desktop map keeps GPS accuracy, filtering and diagnostics opt-in', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/map');
  await expect(page.getByTestId('developer-diagnostics')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nhập tọa độ thay cho GPS', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  const list = page.getByTestId('nearby-place-list');
  await expect(list.getByText('Nearby Garden', { exact: true })).toBeVisible();
  await expect(page.getByTestId('location-summary')).toContainText('GPS ±102 m');
  await expect(page.getByText(/GPS chưa chính xác/)).toBeVisible();
  await expect(page.locator('.gps-accuracy-circle')).toHaveCount(1);
  await expect(page.getByText(/10\.77640, 106\.69930/)).toHaveCount(0);
  await expect(page.getByTestId('backend-poi-status')).toHaveCount(0);
  await page.getByLabel('Tìm địa danh', { exact: true }).fill('Garden');
  await expect(list.getByText('Browser Test Museum', { exact: true })).toHaveCount(0);
  await expect(page.locator('.poi-marker')).toHaveCount(1);
  await page.getByRole('button', { name: 'Xóa tìm kiếm', exact: true }).click();
  await page.getByRole('button', { name: 'Danh mục Văn hóa', exact: true }).click();
  await expect(list.getByText('Browser Test Museum', { exact: true })).toBeVisible();
  await expect(list.getByText('Nearby Garden', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Danh mục Tất cả', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/map-mobile-clean.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/map-desktop-clean.png', fullPage: true });
  await page.getByRole('button', { name: 'Developer Diagnostics', exact: true }).click();
  await expect(page.getByTestId('developer-diagnostics')).toBeVisible();
  await expect(page.getByText(/10\.77640, 106\.69930/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nhập tọa độ thay cho GPS', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('developer-diagnostics')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('one failed source produces one gentle notice and preserves working POI', async ({ page }) => {
  await page.route('**/osm/nearby?**', route => route.fulfill({ status: 504, body: 'upstream timeout' }));
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('Browser Test Museum', { exact: true })).toBeVisible();
  await expect(page.getByText('Không thể cập nhật một số nguồn địa danh. Bạn vẫn có thể khám phá các địa điểm hiện có.', { exact: true })).toBeVisible();
  await expect(page.getByText(/OpenStreetMap: Không tải được/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible();
});

test('dense marker clusters preserve an individually selected landmark', async ({ page }) => {
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, Array.from({ length: 65 }, (_, i) => ({ type: 'node', id: 1000 + i, lat: origin.latitude + i * .000001, lon: origin.longitude, tags: { name: `Cluster landmark ${i}`, tourism: 'museum' } }))) }));
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect.poll(() => page.locator('.poi-cluster').count()).toBeGreaterThan(0);
  await page.getByLabel('Xem bản đồ Cluster landmark 0', { exact: true }).click();
  await expect(page.locator('.poi-marker[data-poi-id="osm-node-1000"]')).toHaveCount(1);
  await expect(page.locator('.leaflet-popup-content')).toContainText('Cluster landmark 0');
});
