import { test, expect } from '@playwright/test';
import { login, E2E_USERNAME } from '../helpers';

test('rejects a wrong PIN with an inline error and does not enter the app', async ({ page }) => {
  await login(page, E2E_USERNAME, '9999');

  await expect(page.getByRole('alert')).toContainText(/invalid/i);
  await expect(page.locator('#login-username')).toBeVisible();
});

test('logs in with username + PIN, reaches the app shell, and logs out cleanly', async ({ page }) => {
  await login(page);

  await expect(page.getByRole('heading', { name: 'Daily Sales' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rate Management', exact: true })).toBeVisible();

  await page.getByTestId('logout-button').click();
  await expect(page.locator('#login-username')).toBeVisible();
});
