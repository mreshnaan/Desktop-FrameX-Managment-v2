import { test, expect } from '@playwright/test';
import { login, navigateTo } from '../helpers';

test('a Credit session raises the customer balance, and Record payment lowers it', async ({ page }) => {
  await login(page);

  await navigateTo(page, 'Customers');
  await page.locator('#customer-name').fill('E2E Ravi Kumar');
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'E2E Ravi Kumar', exact: true })).toBeVisible();

  await navigateTo(page, 'Daily Sales');
  const stationCard = page.getByTestId('resource-card-8-Ball-Table 1');
  await stationCard.getByRole('button', { name: '+ Add session' }).click();
  const row = stationCard.getByTestId('session-row').last();
  await row.getByLabel('Amount').fill('300');
  // Customer must be set before switching to Credit -- the session schema
  // rejects a Credit session with no customer, so setting Credit first would
  // silently fail validation and leave the method at its default (Cash).
  await row.getByLabel('Customer').click();
  await page.getByRole('option', { name: 'E2E Ravi Kumar' }).click();
  // Wait for the customer selection to actually commit (its own async
  // updateSession + re-render) before switching payment method -- otherwise
  // the method commit can read a still-stale session with no customerId yet
  // and get silently rejected by the same Credit-needs-a-customer check.
  await expect(row.getByLabel('Customer')).toContainText('E2E Ravi Kumar');
  await row.getByLabel('Payment method').click();
  await page.getByRole('option', { name: 'Credit' }).click();
  await expect(row.getByLabel('Payment method')).toContainText('Credit');

  await navigateTo(page, 'Credit Management');
  await expect(page.getByTestId('balance-E2E Ravi Kumar')).toContainText('300');

  await page.getByTestId('draft-amount-E2E Ravi Kumar').fill('100');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('balance-E2E Ravi Kumar')).toContainText('200');

  // Self-clean: remove the session and the customer.
  await navigateTo(page, 'Daily Sales');
  await stationCard.getByTestId('session-row').last().getByRole('button', { name: 'Delete session' }).click();
  await navigateTo(page, 'Customers');
  await page.getByRole('button', { name: 'Delete E2E Ravi Kumar' }).click();
  await expect(page.getByRole('cell', { name: 'E2E Ravi Kumar', exact: true })).not.toBeVisible();

  await page.getByTestId('logout-button').click();
});
