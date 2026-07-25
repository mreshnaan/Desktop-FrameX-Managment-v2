import { test, expect } from '@playwright/test';
import { login, navigateTo } from '../helpers';

// Web never stamps createdBy/updatedBy locally (its Dexie schema was
// deliberately left untouched -- see the audit-trail feature's scope
// decision), but the server resolves the actor from the verified JWT on
// every push, not from anything the client sends. So a web-originated
// write still gets correctly attributed server-side, same as a desktop one.
// This proves that end to end, and doubles as the only e2e coverage of the
// (read-only, by design) Activity Log / Sync Log screens on web.
test('a customer created on web is correctly attributed in the Activity Log and Sync Log', async ({ page }) => {
  await login(page);

  await navigateTo(page, 'Customers');
  await page.locator('#customer-name').fill('E2E Audit Customer');
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'E2E Audit Customer', exact: true })).toBeVisible();

  // The Activity/Sync Log are server-only views -- unlike every other check
  // in this suite, which reads local Dexie state, this needs the customer's
  // outbox entry to have actually reached the server first. A reload forces
  // web's sync engine to run its push cycle immediately instead of waiting
  // out its own 30s interval.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Daily Sales' })).toBeVisible({ timeout: 15_000 });
  await navigateTo(page, 'Activity & Sync Logs');
  await expect(page.getByRole('cell', { name: /Created customer "E2E Audit Customer"/ }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'E2E Owner', exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Sync Log', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'push', exact: true }).first()).toBeVisible();

  await navigateTo(page, 'Customers');
  await page.getByRole('button', { name: 'Delete E2E Audit Customer' }).click();
  await expect(page.getByRole('cell', { name: 'E2E Audit Customer', exact: true })).not.toBeVisible();

  await page.getByTestId('logout-button').click();
});
