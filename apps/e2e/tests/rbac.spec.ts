import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';

test.beforeEach(async () => {
  await cleanupAll();
  await seedUser('owner@e2e.test', 'testpass123', 'OWNER');
  await seedUser('cashier@e2e.test', 'testpass123', 'CASHIER');
});
test.afterAll(async () => {
  await cleanupAll();
});

// Sidebar.tsx renders nav items as plain <button>s inside SidebarMenu (not
// <a> links), and the auth form's submit button reads "Sign in" (see
// LoginForm.tsx) — selectors below match the real markup, not the brief's
// sketch. There's also no "Log out" control anywhere in the app yet
// (AuthContext.logout() is defined but never wired to any UI element), so
// each role is checked in its own browser context rather than logging out
// mid-test.
test('cashier does not see User Management; owner does', async ({ browser }) => {
  const cashierContext = await browser.newContext();
  const cashierPage = await cashierContext.newPage();
  await cashierPage.goto('/');
  await cashierPage.getByLabel('Email').fill('cashier@e2e.test');
  await cashierPage.getByLabel('Password').fill('testpass123');
  await cashierPage.getByRole('button', { name: 'Sign in' }).click();

  await expect(cashierPage.getByRole('heading', { name: 'Daily Sales' })).toBeVisible();
  await expect(cashierPage.getByRole('button', { name: 'User Management' })).toHaveCount(0);

  // Per the agreed permission matrix, cashier still gets every business view:
  await expect(cashierPage.getByRole('button', { name: 'Daily Sales' })).toBeVisible();
  await expect(cashierPage.getByRole('button', { name: 'Monthly Sales' })).toBeVisible();
  await expect(cashierPage.getByRole('button', { name: 'Customers' })).toBeVisible();
  await expect(cashierPage.getByRole('button', { name: 'Credit Management' })).toBeVisible();
  await expect(cashierPage.getByRole('button', { name: 'Expenses' })).toBeVisible();
  await expect(cashierPage.getByRole('button', { name: 'Rate Management' })).toBeVisible();

  await cashierContext.close();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/');
  await ownerPage.getByLabel('Email').fill('owner@e2e.test');
  await ownerPage.getByLabel('Password').fill('testpass123');
  await ownerPage.getByRole('button', { name: 'Sign in' }).click();

  await expect(ownerPage.getByRole('heading', { name: 'Daily Sales' })).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: 'User Management' })).toBeVisible();

  await ownerContext.close();
});
