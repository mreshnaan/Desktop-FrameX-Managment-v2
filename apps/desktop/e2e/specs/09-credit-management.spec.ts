import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

// Tests for the Credit Management view:
//   - Customer balance is pre-aggregated in SQLite (get_customer_balances)
//   - Per-customer credit history is lazy-fetched from the DB (get_customer_credit_history)
//   - Balance shown in the card reflects give-credit and record-payment actions
test.describe.serial('credit management', () => {
  const CUSTOMER = 'E2E Credit Customer';

  test('balance chip shows Rs. 0 for a new customer', async () => {
    test.setTimeout(45_000);
    const page = await connectToApp();
    await login(page);

    // Create a customer via the Customers view
    await navigateTo(page, 'Customers');
    await page.locator('#customer-name').fill(CUSTOMER);
    await page.getByRole('button', { name: 'Add customer', exact: true }).click();
    await expect(page.getByRole('cell', { name: CUSTOMER, exact: true })).toBeVisible();

    // Navigate to Credit Management and check the initial balance
    await navigateTo(page, 'Credit Management');
    const card = page.locator('[data-slot="card"]').filter({ hasText: CUSTOMER });
    await expect(card).toBeVisible();
    await expect(card.getByTestId(`balance-${CUSTOMER}`)).toHaveText('Rs. 0');

    await page.getByTestId('logout-button').click();
  });

  test('giving credit increases balance; recording payment decreases it', async () => {
    test.setTimeout(45_000);
    const page = await connectToApp();
    await login(page);

    await navigateTo(page, 'Credit Management');
    const card = page.locator('[data-slot="card"]').filter({ hasText: CUSTOMER });

    // Give 500 credit
    await card.getByTestId(`draft-amount-${CUSTOMER}`).fill('500');
    await card.getByRole('button', { name: 'Give credit' }).click();
    await expect(async () => {
      await expect(card.getByTestId(`balance-${CUSTOMER}`)).toHaveText('Rs. 500');
    }).toPass({ timeout: 10_000 });

    // Record 200 payment
    await card.getByTestId(`draft-amount-${CUSTOMER}`).fill('200');
    await card.getByRole('button', { name: 'Record payment' }).click();
    await expect(async () => {
      await expect(card.getByTestId(`balance-${CUSTOMER}`)).toHaveText('Rs. 300');
    }).toPass({ timeout: 10_000 });

    await page.getByTestId('logout-button').click();
  });

  test('history panel shows credit and payment rows pre-sorted date DESC', async () => {
    test.setTimeout(45_000);
    const page = await connectToApp();
    await login(page);

    await navigateTo(page, 'Credit Management');
    const card = page.locator('[data-slot="card"]').filter({ hasText: CUSTOMER });

    // Open the history panel — data is lazy-fetched from the backend
    await card.getByRole('button', { name: 'Show history' }).click();

    const historyItems = card.locator('ul li');
    await expect(historyItems).toHaveCount(2);

    // Most recent entry (payment) should appear first
    await expect(historyItems.nth(0)).toContainText('Payment received');
    await expect(historyItems.nth(1)).toContainText('Credit given');

    await page.getByTestId('logout-button').click();
  });

  test('cleanup: delete the E2E credit customer', async () => {
    test.setTimeout(30_000);
    const page = await connectToApp();
    await login(page);

    await navigateTo(page, 'Customers');
    const row = page.getByRole('row').filter({ hasText: CUSTOMER });
    await row.getByRole('button', { name: 'Delete' }).click();
    // exact: true -- an unanchored match also hits the delete button's own
    // cell, whose accessible name is "Delete E2E Credit Customer".
    await expect(page.getByRole('cell', { name: CUSTOMER, exact: true })).not.toBeVisible();

    await page.getByTestId('logout-button').click();
  });
});
