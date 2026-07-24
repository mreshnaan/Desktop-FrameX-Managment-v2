import { test, expect } from '@playwright/test';
import { login, navigateTo } from '../helpers';

test('adding an expense updates the day total, and deleting it clears the total again', async ({ page }) => {
  await login(page);
  await navigateTo(page, 'Expenses');

  await expect(page.getByText('No expenses recorded for this day.')).toBeVisible();

  await page.getByRole('button', { name: '+ Add expense' }).click();
  const row = page.getByTestId('expense-row').last();
  await row.getByLabel('Description').fill('E2E ice');
  await row.getByLabel('Amount').fill('75');
  await row.getByLabel('Amount').blur();

  await expect(page.getByText('Total expenses')).toBeVisible();
  const totalCard = page.locator('[data-slot="card"]').filter({ hasText: 'Total expenses' });
  await expect(totalCard).toContainText('75');

  await row.getByRole('button', { name: 'Delete expense' }).click();
  await expect(page.getByText('No expenses recorded for this day.')).toBeVisible();
  await expect(totalCard).toContainText('0');

  await page.getByTestId('logout-button').click();
});
