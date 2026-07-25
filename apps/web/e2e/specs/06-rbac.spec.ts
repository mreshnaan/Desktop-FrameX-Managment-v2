import { test, expect } from '@playwright/test';
import { login, navigateTo } from '../helpers';

test('an owner creates a cashier user, who then sees every business view but not User Management', async ({ page }) => {
  await login(page);
  await navigateTo(page, 'User Management');

  await page.locator('#user-name').fill('E2E Cashier');
  await page.locator('#user-username').fill('e2e-cashier');
  await page.locator('#user-pin').fill('4321');
  await page.locator('#user-role').click();
  await page.getByRole('option', { name: 'CASHIER', exact: true }).click();
  await page.getByRole('button', { name: 'Create user' }).click();

  await expect(page.getByRole('cell', { name: 'e2e-cashier' })).toBeVisible();
  await page.getByTestId('logout-button').click();

  await login(page, 'e2e-cashier', '4321');

  // Every business view stays reachable for a cashier... (exact: true --
  // "Customers" can also match an unrelated disabled "Add customers first"
  // button if a stale session row happens to be on screen.)
  await expect(page.getByRole('button', { name: 'Daily Sales', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Monthly Sales', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Customers', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Credit Management', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expenses', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rate Management', exact: true })).toBeVisible();
  // ...but User Management is hidden entirely, matching CASHIER's permission
  // set (BUSINESS_PERMISSIONS only, see apps/api/src/shared/constants/roles.ts).
  await expect(page.getByRole('button', { name: 'User Management', exact: true })).toHaveCount(0);

  await page.getByTestId('logout-button').click();
});
