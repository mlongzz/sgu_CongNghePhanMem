import { test, expect, type Page } from '@playwright/test';

// Explicit HTTP fixtures exercise React Native Web's actual Image and Pressable DOM.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const photo = 'https://qa-images.example.test/place.png';
const thumb = 'https://qa-images.example.test/thumb.png';
const row = (image = photo, thumbnail: string | null = null) => ({
  id: 990001, name: 'QA Image Fixture', latitude: 10.7764, longitude: 106.6993,
  description: 'Explicit browser image fixture', category: 'Văn hóa', address: 'Test address',
  publication_status: 'published', image_url: image, image_thumbnail_url: thumbnail,
  image_attribution: 'QA fixture author', image_license: 'CC0',
});
function captureWarnings(page: Page) {
  const warnings: string[] = [];
  page.on('pageerror', error => warnings.push(error.message));
  page.on('console', message => {
    if (/cannot (?:contain|appear)|validateDOMNesting|hydration|nested.*button|Unexpected text node|unknown module/i.test(message.text())) warnings.push(message.text());
  });
  return warnings;
}
async function validDom(page: Page) {
  await expect(page.locator('button button, button [role="button"], [role="button"] button, [role="button"] [role="button"], button a[href], a[href] button')).toHaveCount(0);
}
async function home(page: Page, getRow = () => row()) {
  await page.route(/http:\/\/127\.0\.0\.1:8765\/places\?/, route => route.fulfill({ json: [getRow()] }));
  await page.goto('/');
  return page.getByRole('button', { name: 'Xem chi tiết QA Image Fixture', exact: true }).first().locator('..');
}

test('valid image keeps credit and keyboard navigation with no nested interactive DOM', async ({ page }) => {
  const warnings = captureWarnings(page);
  await page.route(photo, route => route.fulfill({ contentType: 'image/png', body: pixel }));
  const card = await home(page);
  await expect(card.locator(`img[src="${photo}"]`)).toBeVisible();
  await expect(card.getByText('Nguồn ảnh: QA fixture author · CC0')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Thử tải ảnh' })).toHaveCount(0);
  await validDom(page);
  const detail = card.getByRole('button', { name: 'Xem chi tiết QA Image Fixture', exact: true });
  await detail.focus();
  await expect(detail).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/place\/db-990001$/);
  expect(warnings).toEqual([]);
});

test('missing image shows placeholder without a meaningless retry', async ({ page }) => {
  const warnings = captureWarnings(page);
  const card = await home(page, () => row(''));
  await expect(card.getByText('Chưa có ảnh địa điểm')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Thử tải ảnh' })).toHaveCount(0);
  await validDom(page);
  expect(warnings).toEqual([]);
});

test('failed image retry is a sibling action and reloads without opening details', async ({ page }) => {
  const warnings = captureWarnings(page);
  let recover = false, requests = 0;
  await page.route(photo, route => {
    requests++;
    return recover ? route.fulfill({ contentType: 'image/png', body: pixel, headers: { 'Cache-Control': 'no-store' } }) : route.fulfill({ status: 503, body: 'Fixture outage', headers: { 'Cache-Control': 'no-store' } });
  });
  const card = await home(page);
  const retry = card.getByRole('button', { name: 'Thử tải ảnh', exact: true });
  await expect(retry).toBeVisible();
  await expect(card.getByText('Không tải được ảnh địa điểm')).toBeVisible();
  await validDom(page);
  const before = requests;
  // Advancing past multiple load deadlines must not cause an automatic request loop.
  await page.clock.install();
  await page.clock.fastForward(40_000);
  expect(requests).toBe(before);
  recover = true;
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(card.locator(`img[src="${photo}"]`)).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:8099/');
  await validDom(page);
  await card.getByRole('button', { name: 'Xem chi tiết QA Image Fixture', exact: true }).click();
  await expect(page).toHaveURL(/\/place\/db-990001$/);
  expect(warnings).toEqual([]);
});

test('failed thumbnail falls back to full image without retry or lost credits', async ({ page }) => {
  const warnings = captureWarnings(page);
  await page.route(thumb, route => route.fulfill({ status: 404, body: 'Missing fixture thumbnail' }));
  await page.route(photo, route => route.fulfill({ contentType: 'image/png', body: pixel }));
  const card = await home(page, () => row(photo, thumb));
  await expect(card.locator(`img[src="${photo}"]`)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Thử tải ảnh' })).toHaveCount(0);
  await expect(card.getByText('Nguồn ảnh: QA fixture author · CC0')).toBeVisible();
  await validDom(page);
  expect(warnings).toEqual([]);
});

test('journey and Admin image tiles keep retry outside navigation buttons', async ({ page }) => {
  const warnings = captureWarnings(page);
  let recover = false;
  await page.route(photo, route => recover
    ? route.fulfill({ contentType: 'image/png', body: pixel, headers: { 'Cache-Control': 'no-store' } })
    : route.fulfill({ status: 503, body: 'Fixture outage', headers: { 'Cache-Control': 'no-store' } }));
  const journey = { id: 990001, name: 'QA Image Journey', description: 'Explicit fixture', image_url: photo, stops: [row()] };
  await page.route(/http:\/\/127\.0\.0\.1:8765\/journeys(?:\?|\/990001)/, route => route.fulfill({ json: route.request().url().includes('/990001') ? journey : [journey] }));
  await page.goto('/journeys');
  await expect(page.getByRole('button', { name: 'Thử tải ảnh', exact: true })).toBeVisible();
  await validDom(page);
  await page.getByRole('button', { name: 'Thử tải ảnh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'QA Image Journey', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'QA Image Journey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bắt đầu hành trình', exact: true })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill('admin@e2e.example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('TestPassword123!');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.route(/http:\/\/127\.0\.0\.1:8765\/admin\/images\/places\?/, route => route.fulfill({ json: { items: [{ ...row(), images: { approved: 0, pending: 1 } }, { ...row(''), id: 990002, name: 'Missing photo fixture', images: {} }], total: 2, pages: 1 } }));
  await page.getByText('Thư viện ảnh', { exact: true }).click();
  const manager = page.getByTestId('image-manager');
  await expect(manager.getByRole('button', { name: 'Thử tải ảnh', exact: true })).toBeVisible();
  await expect(manager.getByText('Chưa tải được ảnh xem trước; hãy thử lại')).toBeVisible();
  await expect(manager.getByText('Chưa có ảnh bìa', { exact: true })).toBeVisible();
  await validDom(page);
  recover = true;
  await manager.getByRole('button', { name: 'Thử tải ảnh', exact: true }).click();
  await expect(manager.getByText('Ảnh xem trước đã tải được')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đóng thư viện ảnh', exact: true })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Quản lý ảnh QA Image Fixture', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đóng thư viện ảnh', exact: true })).toBeVisible();
  await validDom(page);
  expect(warnings).toEqual([]);
});
