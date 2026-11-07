import { test, expect } from '@playwright/test';
import { osmPayload } from './osm-fixture';

test('a 95m GPS reading shows the same accuracy warning on Home and Map', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = success => success({ coords: { latitude: 10.7764, longitude: 106.6993, accuracy: 95, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
  });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, []) }));
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.fulfill({ json: { query: { geosearch: [] } } }));
  const warning = 'GPS chưa chính xác. Khoảng cách chỉ gần đúng; hãy định vị lại ở nơi thoáng hơn.';
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByTestId('location-summary')).toContainText('GPS ±95 m');
  await expect(page.getByTestId('map-gps-accuracy-warning')).toHaveText(warning);
  await page.getByTestId('map-gps-accuracy-warning').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('map-gps-accuracy-warning')).toBeInViewport();
  await page.getByText('Khám phá', { exact: true }).last().click();
  await expect(page.getByTestId('home-location-summary')).toBeVisible();
  await expect(page.getByTestId('home-location-summary')).toContainText('GPS ±95 m');
  await expect(page.getByTestId('home-gps-accuracy-warning')).toHaveText(warning);
  await page.getByTestId('home-gps-accuracy-warning').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('home-gps-accuracy-warning')).toBeInViewport();
});

test('guide no-op stays published, actual edit needs confirmation and missing translation provider disables translation', async ({ page, request }) => {
  const api = 'http://127.0.0.1:8765';
  const login = await request.post(`${api}/auth/login`, { data: { email: 'admin@e2e.example.com', password: 'TestPassword123!' } });
  const headers = { Authorization: `Bearer ${(await login.json()).access_token}` };
  const place = await (await request.post(`${api}/admin/places`, { headers, data: { name: 'Review guide fixture', latitude: 0, longitude: 0, publication_status: 'published' } })).json();
  const title = `Reviewed guide ${Date.now()}`;
  await request.put(`${api}/admin/places/${place.id}/guide-content/vi`, { headers, data: { title, content: 'Published review fixture text.', publication_status: 'published' } });
  try {
    await page.goto('/login');
    await page.getByLabel('Địa chỉ email', { exact: true }).fill('admin@e2e.example.com');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('TestPassword123!');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole('button', { name: 'Bản dịch & TTS', exact: true }).click();
    await expect(page.getByText('Dịch tự động chưa được cấu hình. Nhập bản dịch thủ công hoặc cấu hình LibreTranslate ở máy chủ.', { exact: true })).toBeVisible();
    await page.getByLabel('Tìm kiếm', { exact: true }).fill(title);
    const row = page.getByText(title, { exact: true }).locator('..');
    await expect(row.getByRole('button', { name: 'Dịch', exact: true })).toBeDisabled();
    await row.getByRole('button', { name: 'Sửa', exact: true }).click();
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(page.getByText('Không có thay đổi. Trạng thái xuất bản được giữ nguyên.', { exact: true })).toBeVisible();
    expect((await request.get(`${api}/places/${place.id}/guide-content?language=vi`)).status()).toBe(200);
    await row.getByRole('button', { name: 'Sửa', exact: true }).click();
    await page.getByLabel('Nội dung thuyết minh', { exact: true }).fill('Changed content requiring a new publication review.');
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(page.getByText(/Lưu nội dung này sẽ gỡ bản đang công khai/)).toBeVisible();
    expect((await request.get(`${api}/places/${place.id}/guide-content?language=vi`)).status()).toBe(200);
    await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await expect.poll(async () => (await request.get(`${api}/places/${place.id}/guide-content?language=vi`)).status()).toBe(404);
  } finally {
    await request.delete(`${api}/admin/places/${place.id}`, { headers });
  }
});

for (const width of [320, 390, 768, 1440]) test(`Admin fits ${width}px and shows readable column labels and scrolling guidance`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill('admin@e2e.example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('TestPassword123!');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('button', { name: 'Người dùng', exact: true }).click();
  await expect(page.getByText('Vai trò trong CSDL', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Quyền Admin thực tế', { exact: true })).toBeVisible();
  if (width < 900) await expect(page.getByText('Cuộn ngang để xem các cột và thao tác →', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`admin-${width}.png`), fullPage: true });
});
