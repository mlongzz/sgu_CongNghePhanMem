import { test, expect, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';

// Public test landmark; never uses the user's private GPS.
const origin = { latitude: 10.7764, longitude: 106.6993, accuracy: 5 };
const article = (pageid: number, title: string, lat = origin.latitude) => ({ pageid, title, lat, lon: origin.longitude, ns: 0 });
const wikiResponse = (rows: ReturnType<typeof article>[]) => ({ query: { geosearch: rows } });
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ status: 504, body: 'upstream unavailable' }));
});
async function locate(page: Page, radius = 3) {
  await page.goto('/map');
  await page.getByRole('button', { name: 'Developer Diagnostics', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: `Bán kính ${radius} km`, exact: true }).click();
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByText(/OpenStreetMap: Không tải được địa điểm OpenStreetMap/)).toBeVisible();
}

test('a GPS click automatically finds Wikipedia fallback places and keeps them separate from official POI', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const accountWrites: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/(history|favorites|audio-sessions)/.test(request.url())) accountWrites.push(request.url()); });
  let calls = 0;
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => {
    calls++;
    return route.fulfill({ json: wikiResponse([article(1, 'Wikipedia Nearby'), article(2, 'Browser Test Museum'), article(1, 'Duplicate'), article(3, 'Outside Radius', 11)]) });
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Developer Diagnostics', exact: true }).click();
  await expect(page.getByText(/Khi bật GPS, tọa độ và bán kính được gửi/)).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  const list = page.getByTestId('nearby-place-list');
  await expect(list.getByText('Wikipedia Nearby', { exact: true })).toBeVisible();
  await expect(list.getByText('Browser Test Museum', { exact: true })).toHaveCount(1);
  await expect(list.getByText('Outside Radius', { exact: true })).toHaveCount(0);
  await expect(page.locator('.poi-marker')).toHaveCount(2);
  await expect(page.locator('[data-poi-id="wiki-vi-1"]')).toHaveCount(1);
  await expect(page.getByText('Nguồn POI đang hiển thị: FastAPI và Wikipedia', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Chi tiết Wikipedia Nearby', { exact: true })).toBeVisible();
  await page.getByLabel('Xem bản đồ Wikipedia Nearby', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đọc bài viết Wikipedia →', exact: true })).toBeVisible();
  expect(calls).toBe(1); expect(accountWrites).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/wikipedia-alternative-source.png', fullPage: true });
});

test('Wikipedia failure leaves other sources available and manual refresh recovers', async ({ page }) => {
  let recover = false;
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => recover ? route.fulfill({ json: wikiResponse([article(4, 'Wikipedia Recovered')]) }) : route.fulfill({ status: 503, body: 'unavailable' }));
  await locate(page);
  await expect(page.getByText(/Wikipedia: Wikipedia trả HTTP 503/)).toBeVisible();
  await expect(page.getByTestId('nearby-place-list').getByText('Browser Test Museum', { exact: true })).toBeVisible();
  recover = true;
  await page.getByRole('button', { name: 'Làm mới Wikipedia', exact: true }).click();
  await expect(page.getByTestId('nearby-place-list').getByText('Wikipedia Recovered', { exact: true })).toBeVisible();
  await expect(page.getByText(/Wikipedia: Wikipedia trả HTTP 503/)).toHaveCount(0);
});

test('changing radius discards stale Wikipedia data and disabling stops future queries', async ({ page }) => {
  let release!: () => void; let oldSeen!: () => void; let calls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { oldSeen = resolve; });
  await page.route('https://vi.wikipedia.org/w/api.php?**', async route => {
    calls++;
    if (new URL(route.request().url()).searchParams.get('gsradius') === '5000') {
      oldSeen(); await held;
      try { await route.fulfill({ json: wikiResponse([article(5, 'Stale Wikipedia')]) }); } catch { /* request was cancelled */ }
    } else await route.fulfill({ json: wikiResponse([article(6, 'Current Wikipedia')]) });
  });
  try {
    await locate(page, 5);
    await seen;
    await page.getByRole('button', { name: 'Bán kính 1 km', exact: true }).click();
    await expect(page.getByTestId('nearby-place-list').getByText('Current Wikipedia', { exact: true })).toBeVisible();
    release();
    await expect(page.getByText('Stale Wikipedia', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Tắt Wikipedia', exact: true }).click();
    await expect(page.locator('[data-poi-id^="wiki-"]')).toHaveCount(0);
    const before = calls;
    await page.getByRole('button', { name: 'Bán kính 20 km', exact: true }).click();
    // Cover the 150 ms dispatch debounce to assert the opted-out source sends nothing.
    await page.waitForTimeout(350);
    expect(calls).toBe(before);
    await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
    await expect(page.getByText(/Wikipedia đang tắt\./)).toBeVisible();
    await page.waitForTimeout(350);
    expect(calls).toBe(before);
    await expect(page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Tìm bằng Wikipedia', exact: true }).click();
    await expect(page.getByTestId('nearby-place-list').getByText('Current Wikipedia', { exact: true })).toBeVisible();
    expect(calls).toBe(before + 1);
  } finally { release(); }
});

test('20 km Wikipedia search discloses its 10 km limit and uses that actual radius', async ({ page }) => {
  let radius = '';
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => {
    radius = new URL(route.request().url()).searchParams.get('gsradius') ?? '';
    return route.fulfill({ json: wikiResponse([article(7, 'Within Wikipedia Coverage'), article(8, 'Beyond Wikipedia Coverage', 10.88)]) });
  });
  await locate(page, 20);
  await expect(page.getByText(/Wikipedia hỗ trợ tối đa 10 km mỗi truy vấn/)).toBeVisible();
  await expect(page.getByTestId('nearby-place-list').getByText('Within Wikipedia Coverage', { exact: true })).toBeVisible();
  await expect(page.getByText('Beyond Wikipedia Coverage', { exact: true })).toHaveCount(0);
  expect(radius).toBe('10000');
});
