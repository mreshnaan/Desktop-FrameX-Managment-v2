import { test, expect } from '@playwright/test';
import { connectToApp, login } from '../helpers';

// Both cases share the one running app instance (see helpers.ts), so this
// runs the failure case first -- an authenticated session must not leak
// into it -- then logs in for real and logs back out, leaving the app at
// the login screen for whichever spec file runs next.
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
