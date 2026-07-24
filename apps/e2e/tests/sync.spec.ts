import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';
import { prisma } from '@cue-room/api/src/db';

test.beforeEach(async () => {
  await cleanupAll();
  await seedUser('owner@e2e.test', 'testpass123', 'OWNER');
});
test.afterAll(async () => {
  await cleanupAll();
});

// Sidebar.tsx renders nav items as plain <button>s (not <a> links), the
// auth form's submit button reads "Sign in" (see LoginForm.tsx), and the
// customer form's name field is labelled "Name" (see CustomersView.tsx) —
// selectors below match the real markup, not the brief's sketch.
async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Daily Sales' })).toBeVisible();
}

test('a customer added on "device A" appears on "device B" after sync', async ({ browser }) => {
  // Device B's own 30s interval starts ticking from its login time, not
  // from when device A's write happens, so give it a bit more headroom
  // than the brief's bare 35s to absorb login/render overhead eaten into
  // the window before the wait even starts.
  test.setTimeout(70_000);

  // Two independent browser contexts == two independent IndexedDB stores ==
  // two "devices" logged into the same account, exactly like a phone and a
  // desktop app both syncing against the same server.
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  const pageA = await deviceA.newPage();
  const pageB = await deviceB.newPage();

  await login(pageA);
  await login(pageB);

  await pageA.getByRole('button', { name: 'Customers' }).click();
  await pageA.getByLabel('Name').fill('Synced Customer');
  await pageA.getByRole('button', { name: 'Add customer' }).click();
  await expect(pageA.getByText('Synced Customer')).toBeVisible();

  // Device B was already sitting on the Customers view before device A's
  // write happened, so this assertion is only satisfied once B's own sync
  // engine pulls the new row from the server on its own cycle -- not by
  // re-reading device A's state.
  await pageB.getByRole('button', { name: 'Customers' }).click();
  await expect(pageB.getByText('Synced Customer')).toBeVisible({ timeout: 45_000 }); // sync engine's 30s interval, plus headroom

  await deviceA.close();
  await deviceB.close();
});

test('data added while offline is queued locally and reaches the server once back online', async ({ browser }) => {
  test.setTimeout(90_000); // default 30s is shorter than the 31s post-online drain wait
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Expenses' }).click();
  await page.getByRole('button', { name: 'Add expense' }).click();

  // ExpensesView renders rows as plain divs (data-testid="expense-row"),
  // not table rows, so the brief's getByRole('row') sketch doesn't match --
  // added the testid to ExpensesView.tsx since it was genuinely missing
  // (DailySalesView already has the equivalent "session-row" testid).
  const row = page.getByTestId('expense-row').last();
  await row.getByLabel('Description').fill('Offline expense');
  await row.getByLabel('Amount').fill('50');
  await row.getByLabel('Amount').blur();
  // Usable immediately while still offline, no network needed -- this is
  // the local-first claim: the write landed in Dexie synchronously.
  await expect(row.getByLabel('Description')).toHaveValue('Offline expense');

  await context.setOffline(false);
  await page.waitForTimeout(31_000); // let the sync engine's interval drain the outbox
  await page.reload();
  // App.tsx's `view` is plain React state, not persisted across a reload --
  // a fresh mount always lands back on Daily Sales, so navigate back to
  // Expenses before asserting the row survived.
  await page.getByRole('button', { name: 'Expenses' }).click();
  // The description/amount are rendered as <input value=...>, not text
  // nodes, so getByText() (the brief's sketch) can never match them here --
  // assert the input's value instead, same as the pre-reload check above.
  await expect(page.getByTestId('expense-row').last().getByLabel('Description')).toHaveValue(
    'Offline expense'
  );

  // The assertion above only proves the row survived in the local Dexie
  // cache -- it would pass even if the outbox never drained. Querying
  // Postgres directly is the real proof that the offline write actually
  // reached the server once back online, not just that the client
  // remembered it.
  const serverExpense = await prisma.expense.findFirst({ where: { description: 'Offline expense' } });
  expect(serverExpense).not.toBeNull();
  expect(serverExpense?.amount).toBe(50);

  await context.close();
});
