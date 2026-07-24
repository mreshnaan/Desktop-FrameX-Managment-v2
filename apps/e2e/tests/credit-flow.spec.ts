import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';

test.beforeEach(async () => {
  await cleanupAll();
  await seedUser('owner@e2e.test', 'testpass123', 'OWNER');
});
test.afterAll(async () => {
  await cleanupAll();
});

test('a Credit session raises the customer balance, and Record payment lowers it', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Daily Sales' })).toBeVisible();

  await page.getByRole('button', { name: 'Customers' }).click();
  await page.getByLabel('Name').fill('Ravi Kumar');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Ravi Kumar')).toBeVisible();

  await page.getByRole('button', { name: 'Daily Sales' }).click();
  const tableCard = page.getByTestId('resource-card-Snooker-Table 1');
  await tableCard.getByRole('button', { name: 'Add session' }).click();

  const row = page.getByTestId('session-row').last();
  await row.getByLabel('Amount').fill('300');
  await row.getByLabel('Amount').blur();

  // Customer must be picked before switching the payment method to Credit:
  // SessionSchema rejects a Credit session with no customerId, so setting
  // Payment method first would silently fail validation and revert.
  await row.getByLabel('Customer').click();
  await page.getByRole('option', { name: 'Ravi Kumar' }).click();

  await row.getByLabel('Payment method').click();
  await page.getByRole('option', { name: 'Credit' }).click();

  await page.getByRole('button', { name: 'Credit Management' }).click();
  await expect(page.getByTestId('balance-Ravi Kumar')).toContainText('₹300');

  await page.getByTestId('draft-amount-Ravi Kumar').fill('100');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('balance-Ravi Kumar')).toContainText('₹200');
});
