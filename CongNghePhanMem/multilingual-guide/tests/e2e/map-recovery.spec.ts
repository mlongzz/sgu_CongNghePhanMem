import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const full = 'https://qa-images.example.test/recovery.jpg';
const thumb = 'https://qa-images.example.test/recovery-thumb.jpg';
const place = { id: 990051, name: 'Map Recovery Fixture', latitude: 10.7764, longitude: 106.6993,
  category: 'Văn hóa', publication_status: 'published', image_url: full, image_thumbnail_url: thumb };

test.beforeEach(async ({ page }) => {
  await page.route('**/places?**', route => route.fulfill({ json: [place] }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ status: 503, json: { detail: 'Fixture unavailable' } }));
  await page.route('https://vi.wikipedia.org/**', route => route.fulfill({ json: { query: { geosearch: [] } } }));
  await page.route(thumb, route => route.fulfill({ status: 404 }));
  await page.route(full, route => route.fulfill({ contentType: 'image/png', body: pixel }));
});

for (const width of [390, 1440]) {
  test(`failed main tiles switch host and popup thumbnails fall back at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://tile.openstreetmap.org/**', route => route.abort());
    await page.route('https://*.tile.openstreetmap.fr/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
    await page.goto('/map');
    await expect(page.getByTestId('tile-provider-notice')).toContainText('OpenStreetMap France');
    await expect.poll(() => page.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(0);
    await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap France');
    await expect(page.locator('.poi-marker')).toHaveCount(1);
    await page.locator('.poi-marker').click();
    const photo = page.locator('.mg-popup-photo');
    await expect(photo).toHaveCount(1);
    await expect(photo).toHaveAttribute('src', full);
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('both tile hosts fail once, then manual retry recovers without losing selection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let recover = false, requests = 0;
  await page.route('https://tile.openstreetmap.org/**', route => {
    requests++;
    return recover ? route.fulfill({ contentType: 'image/png', body: pixel }) : route.abort();
  });
  await page.route('https://*.tile.openstreetmap.fr/**', route => { requests++; return route.abort(); });
  await page.goto('/map');
  const retry = page.getByRole('button', { name: 'Thử tải lại bản đồ', exact: true });
  await expect(retry).toBeVisible();
  const before = requests;
  await page.waitForTimeout(500);
  expect(requests).toBe(before);
  await page.locator('.poi-marker').click();
  recover = true;
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect.poll(() => page.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(0);
  await expect(page.locator('.poi-marker[data-selected="true"]')).toHaveCount(1);
  await expect(page.locator('.leaflet-popup-content')).toHaveCount(1);
  await expect(page.locator('.leaflet-popup-content')).toContainText(place.name);
  expect(errors).toEqual([]);
});
