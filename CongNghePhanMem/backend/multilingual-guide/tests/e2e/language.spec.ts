import { test, expect } from '@playwright/test';

test('globe changes navigation and authentication language and persists after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Chọn ngôn ngữ', exact: true }).click();
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Explore/ })).toBeVisible();
  await page.goto('/login');
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose language', exact: true }).click();
  await page.getByRole('radio', { name: 'Français', exact: true }).click();
  await expect(page.getByLabel('Adresse e-mail', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choisir la langue', exact: true }).click();
  await page.getByRole('radio', { name: '日本語', exact: true }).click();
  await expect(page.getByLabel('メールアドレス', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
});
