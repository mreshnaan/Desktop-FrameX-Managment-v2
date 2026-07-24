import { test, expect } from '@playwright/test';
import { login, navigateTo } from '../helpers';

test('adding an 8-Ball session auto-calculates its amount and rolls up into Daily/Monthly Sales', async ({ page }) => {
  await login(page);

  // 8-Ball / Table 1 is seeded server-side at hour=200, half=100.
  const stationCard = page.getByTestId('resource-card-8-Ball-Table 1');
  await expect(stationCard).toBeVisible();
  await stationCard.getByRole('button', { name: '+ Add session' }).click();

  const row = stationCard.getByTestId('session-row').last();
  await row.getByLabel('Start time').fill('09:00');
  await row.getByLabel('End time').fill('11:00');

  // 2h at the default 8-Ball rate (200/hr) = 400.
  await expect(row.getByLabel('Amount')).toHaveValue('400');
  await expect(page.getByTestId('summary-total')).toContainText('400');
  await expect(page.getByTestId('summary-cash')).toContainText('400');

  // Scoped to the 8-Ball category card -- "400" alone would also match the
  // Cash/Total table columns for today's row.
  await navigateTo(page, 'Monthly Sales');
  const categoryCard = page.locator('[data-slot="card"]').filter({ hasText: '8-Ball' });
  await expect(categoryCard).toContainText('400');

  // Self-clean: this suite runs against a shared dev database, not an
  // isolated profile like apps/desktop's.
  await navigateTo(page, 'Daily Sales');
  await stationCard.getByTestId('session-row').last().getByRole('button', { name: 'Delete session' }).click();
  await expect(stationCard.getByText('No sessions yet.')).toBeVisible();

  await page.getByTestId('logout-button').click();
});
