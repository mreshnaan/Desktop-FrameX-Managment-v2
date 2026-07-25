import { test, expect } from '@playwright/test';
import { login } from '../helpers';

// Two separate browser contexts standing in for two devices logged into the
// same account -- proves the sync engine round-trips through the real api +
// Postgres, not just local Dexie state.
test('a customer added on one device appears on another after sync', async ({ browser }) => {
  // Device B's 30s sync interval means this test needs more than the
  // config's default 30s timeout.
  test.setTimeout(60_000);

  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  const pageA = await deviceA.newPage();
  const pageB = await deviceB.newPage();

  await login(pageA);
  await login(pageB);

  await pageA.getByRole('button', { name: 'Customers', exact: true }).click();
  await pageA.locator('#customer-name').fill('E2E Sync Customer');
  await pageA.getByRole('button', { name: 'Add customer', exact: true }).click();
  await expect(pageA.getByRole('cell', { name: 'E2E Sync Customer', exact: true })).toBeVisible();

  await pageB.getByRole('button', { name: 'Customers', exact: true }).click();
  // Device B's sync engine polls every 30s; give it room rather than
  // asserting on the very first cycle.
  await expect(pageB.getByRole('cell', { name: 'E2E Sync Customer', exact: true })).toBeVisible({ timeout: 35_000 });

  // Self-clean from whichever device -- either sees the same synced row.
  await pageB.getByRole('button', { name: 'Delete E2E Sync Customer' }).click();
  await expect(pageB.getByRole('cell', { name: 'E2E Sync Customer', exact: true })).not.toBeVisible();

  await pageA.getByTestId('logout-button').click();
  await pageB.getByTestId('logout-button').click();
  await deviceA.close();
  await deviceB.close();
});
