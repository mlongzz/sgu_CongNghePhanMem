/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

test.beforeEach(async ({ page }) => {
  // External map/photo providers are outside this local integration test.
  await page.route(/https:\/\/(www\.openstreetmap\.org|images\.unsplash\.com|www\.google\.com)\//, route => route.abort());
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => route.fulfill({ json: { query: { geosearch: [] } } }));
});

async function login(page: import('@playwright/test').Page, email: string, password = 'TestPassword123!') {
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

test('register, login, restore, favorites, review, history, profile, logout', async ({ page }) => {
  const email = `traveler-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByText('Vui lòng nhập email.', { exact: true })).toBeVisible();
  await page.getByLabel('Họ và tên', { exact: true }).fill('Browser Traveler');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('TestPassword123!');
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByText('Mật khẩu xác nhận chưa khớp.', { exact: true })).toBeVisible();
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill('TestPassword123!');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByText(/Đăng ký thành công/)).toBeVisible();
  await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByText('Email hoặc mật khẩu không đúng.', { exact: true })).toBeVisible();
  await page.getByLabel('Mật khẩu', { exact: true }).fill('TestPassword123!');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:8099/');
  await page.goto('/admin');
  await expect(page).toHaveURL('http://127.0.0.1:8099/');
  await page.goto('/place/db-1');
  await expect(page.getByText('Browser Test Museum', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Lưu địa điểm yêu thích' }).click();
  await expect(page.getByRole('button', { name: 'Bỏ lưu địa điểm yêu thích' })).toBeVisible();
  await page.getByLabel('Nội dung đánh giá').fill('A helpful verified guide.');
  await page.getByRole('button', { name: 'Gửi đánh giá', exact: true }).click();
  await expect(page.getByText('Đã lưu đánh giá.', { exact: true })).toBeVisible();
  await page.goto('/saved');
  await expect(page.getByText('Browser Test Museum', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Được đồng bộ với tài khoản của bạn.', { exact: true })).toBeVisible();
  await page.goto('/history');
  await expect(page.getByText('Browser Test Museum', { exact: true })).toBeVisible();
  await page.goto('/account');
  await page.getByLabel('Họ và tên', { exact: true }).fill('Updated Traveler');
  await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
  await expect(page.getByText('Đã cập nhật hồ sơ.', { exact: true })).toBeVisible();
  await page.goto('/profile');
  await expect(page.getByText('Updated Traveler', { exact: true })).toBeVisible();
  await page.getByText('Đăng xuất', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
});

test('admin login, image upload and remove through the real backend', async ({ page }) => {
  await login(page, 'admin@e2e.example.com');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByText('Địa điểm POI', { exact: true }).click();
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Chọn ảnh và lưu ngay' }).click();
  await (await chooser).setFiles({ name: 'museum.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64') });
  await expect(page.getByRole('button', { name: 'Gỡ ảnh khỏi địa điểm' })).toBeVisible();
  await page.getByRole('button', { name: 'Gỡ ảnh khỏi địa điểm' }).click();
  await page.getByRole('button', { name: 'Xác nhận gỡ ảnh' }).click();
  await expect(page.getByRole('button', { name: 'Gỡ ảnh khỏi địa điểm' })).toHaveCount(0);
});

test('responsive authentication at mobile and desktop widths', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register');
    await expect(page.getByLabel('Xác nhận mật khẩu', { exact: true })).toBeVisible();
    await expect(page.getByTestId('auth-form')).toHaveCSS('opacity', '1');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/register-${width}.png`, fullPage: true });
  }
});

test('expired access token refreshes, invalid refresh clears the session', async ({ page, request }) => {
  const result = await request.post('http://127.0.0.1:8765/auth/login', { data: { email: 'admin@e2e.example.com', password: 'TestPassword123!' } });
  const tokens = await result.json();
  await page.goto('/login');
  await page.evaluate(refresh => { sessionStorage.setItem('mg_access_token_v3', 'expired-access'); sessionStorage.setItem('mg_refresh_token_v3', refresh); }, tokens.refresh_token);
  await page.goto('/admin');
  await expect(page.getByText('Hệ thống thuyết minh của bạn', { exact: true })).toBeVisible();
  await page.evaluate(() => { sessionStorage.setItem('mg_access_token_v3', 'expired-access'); sessionStorage.setItem('mg_refresh_token_v3', 'expired-refresh'); });
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('mg_refresh_token_v3'))).toBe(null);
});

test('GPS search uses actual coordinates and offline login shows an actionable error', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 10.7764, longitude: 106.6993, accuracy: 5 });
  await page.goto('/map');
  await page.getByText('Dùng GPS và tìm địa danh', { exact: true }).click();
  await expect(page.getByText('Browser Test Museum', { exact: true }).first()).toBeVisible();
  await page.goto('/login');
  await page.route('http://127.0.0.1:8765/auth/login', route => route.abort());
  await page.getByLabel('Địa chỉ email', { exact: true }).fill('anyone@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByText('Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.', { exact: true })).toBeVisible();
});

test('admin publishes narration and builds a journey from named places', async ({ page, request }) => {
  await login(page, 'admin@e2e.example.com');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('button', { name: 'Bản dịch & TTS', exact: true }).click();
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click();
  const language = await page.getByLabel('Mã ngôn ngữ (vi/en/fr/ja…)').inputValue();
  await page.getByLabel('Nội dung thuyết minh', { exact: true }).fill('Updated narration verified by browser test.');
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('Đã lưu vào cơ sở dữ liệu.', { exact: false })).toBeVisible();
  const guide = await request.get(`http://127.0.0.1:8765/places/1/guide-content?language=${language}`);
  expect((await guide.json()).content).toBe('Updated narration verified by browser test.');
  await page.getByRole('button', { name: 'Hành trình', exact: true }).click();
  await page.getByRole('button', { name: '＋ Thêm mới', exact: true }).click();
  await page.getByLabel('Tên hành trình', { exact: true }).fill('Browser Walking Journey');
  await page.getByRole('button', { name: '＋ Browser Test Museum', exact: true }).click();
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('Đã lưu vào cơ sở dữ liệu.', { exact: false })).toBeVisible();
  await page.goto('/journeys');
  await page.getByText('Browser Walking Journey', { exact: true }).click();
  await expect(page.getByText('1. Browser Test Museum →', { exact: true })).toBeVisible();
});
