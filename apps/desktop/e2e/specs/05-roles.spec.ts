import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

test('a custom role with two permissions gates the sidebar down to exactly those two views', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Roles');
  // Scoped to the "Add role" card -- the 3 existing system roles each render
  // their own (disabled, pre-checked) "Daily Sales"/"Cafe" checkboxes too.
  const newRoleCard = page.locator('[data-slot="card"]').filter({ hasText: 'Add role' });
  await newRoleCard.locator('#new-role-name').fill('E2E Limited Role');
  await newRoleCard.getByLabel('Daily Sales').check();
  await newRoleCard.getByLabel('Cafe').check();
  await newRoleCard.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByText('E2E Limited Role')).toBeVisible();

  await navigateTo(page, 'User Management');
  await page.locator('#user-name').fill('E2E Limited User');
  await page.locator('#user-username').fill('e2e-limited');
  await page.locator('#user-pin').fill('5678');
  await page.locator('#user-role').click();
  await page.getByRole('option', { name: 'E2E Limited Role' }).click();
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('cell', { name: 'e2e-limited' })).toBeVisible();

  await page.getByTestId('logout-button').click();
  await login(page, 'e2e-limited', '5678');

  await expect(page.getByRole('button', { name: 'Daily Sales' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cafe' })).toBeVisible();
  for (const label of [
    'Monthly Sales', 'Customers', 'Credit Management', 'Expenses', 'Rate Management',
    'User Management', 'Roles', 'Categories & Stations', 'Products & Stock', 'Backup & Restore',
  ]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
  }

  await page.getByTestId('logout-button').click();
});
