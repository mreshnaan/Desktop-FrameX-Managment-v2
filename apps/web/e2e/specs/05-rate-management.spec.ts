import { test, expect } from '@playwright/test';
import { login, navigateTo } from '../helpers';

// Rate rows are shared business data, not a per-test fixture -- restore the
// original value at the end instead of deleting anything.
test('changing a category rate is reflected in a new session amount, then is restored', async ({ page }) => {
  await login(page);
  await navigateTo(page, 'Rate Management');

  const playStationCard = page.locator('[data-slot="card"]').filter({ hasText: 'PlayStation' });
  const hourInput = playStationCard.getByLabel('Rate per 60 min');
  await expect(hourInput).toHaveValue('100');

  await hourInput.fill('250');
  await hourInput.blur();
  await expect(hourInput).toHaveValue('250');

  await navigateTo(page, 'Daily Sales');
  const stationCard = page.getByTestId('resource-card-PlayStation-Station 1');
  await stationCard.getByRole('button', { name: '+ Add session' }).click();
  const row = stationCard.getByTestId('session-row').last();
  await row.getByLabel('Start time').fill('09:00');
  await row.getByLabel('End time').fill('10:00');

  // 1h at the just-changed rate (250/hr) = 250, not the original 100.
  await expect(row.getByLabel('Amount')).toHaveValue('250');

  await stationCard.getByTestId('session-row').last().getByRole('button', { name: 'Delete session' }).click();

  await navigateTo(page, 'Rate Management');
  await hourInput.fill('100');
  await hourInput.blur();
  await expect(hourInput).toHaveValue('100');

  await page.getByTestId('logout-button').click();
});
