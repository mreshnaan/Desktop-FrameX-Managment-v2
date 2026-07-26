import { test, expect } from '@playwright/test';
import { connectToApp, login } from '../helpers';

// Runs the failure case first (no session to leak in), then logs in and back
// out, leaving the app at the login screen for the next spec.
test('rejects a wrong PIN with an inline error and does not enter the app', async () => {
  const page = await connectToApp();

  await login(page, 'e2e-owner', '9999');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily Sales' })).not.toBeVisible();
});

test('logs in with username + PIN, reaches the app shell, and logs out cleanly', async () => {
  const page = await connectToApp();

  await login(page);
  await expect(page.getByRole('heading', { name: 'Daily Sales' })).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('logout-button').click();
  await expect(page.locator('#login-username')).toBeVisible();
});
