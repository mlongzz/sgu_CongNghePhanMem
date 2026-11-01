import { test, expect } from '@playwright/test';

declare global {
  interface Window { mapTestUrl: string; mapTestMessage: string }
}

test('account and admin show their stored role and checked permission; selectors expose their state', async ({ page, request }) => {
  // The E2E backend creates a fresh disposable database for this run.
  const email = `profile-${Date.now()}@example.com`;
  const password = 'TestPassword123!';
  const created = await request.post('http://127.0.0.1:8765/users', {
    data: { email, password, full_name: 'Profile fixture', language: 'vi' },
  });
  expect(created.status()).toBe(201);
  const signIn = async (address: string) => {
    await page.goto('/login');
    await page.getByLabel('Địa chỉ email', { exact: true }).fill(address);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(address.startsWith('admin@') ? /\/admin$/ : /\/$/);
  };
  await signIn(email);
  await page.goto('/profile');
  await expect(page.getByText(/Vai trò tài khoản: Người dùng thường · Quyền quản trị khi đăng nhập: Không/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tiếng Việt', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'English', exact: true })).toBeChecked();
  await expect(page.getByText(/Account role: User · Admin access at sign-in: No/)).toBeVisible();
  await page.getByRole('radio', { name: 'Tiếng Việt', exact: true }).click();
  await page.goto('/place/db-1');
  await expect(page.getByRole('radio', { name: 'Tiếng Việt', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: '4 sao', exact: true }).click();
  await expect(page.getByRole('radio', { name: '4 sao', exact: true })).toBeChecked();
  await page.goto('/profile');
  await page.getByText('Đăng xuất', { exact: true }).click();
  await signIn('admin@e2e.example.com');
  await page.goto('/profile');
  await expect(page.getByText(/Vai trò tài khoản: Quản trị viên · Quyền quản trị khi đăng nhập: Có/)).toBeVisible();
});

test('directions use only the selected coordinates and report a blocked popup', async ({ page }) => {
  await page.goto('/place/db-1');
  await expect(page.getByText('Browser Test Museum', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.mapTestUrl = '';
    window.mapTestMessage = '';
    window.open = ((url?: string | URL) => { window.mapTestUrl = String(url); return null; }) as typeof window.open;
    window.alert = message => { window.mapTestMessage = String(message); };
  });
  await page.getByRole('button', { name: 'Chỉ đường', exact: true }).first().click();
  const actual = await page.evaluate(() => ({ url: window.mapTestUrl, message: window.mapTestMessage }));
  const url = new URL(actual.url);
  expect(url.host).toBe('www.google.com');
  expect(url.searchParams.get('destination')).toBe('10.7764,106.6993');
  expect(url.searchParams.has('origin')).toBe(false);
  expect(actual.message).toContain('cho phép cửa sổ mới');
});
