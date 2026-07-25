import { test, expect, type Page, type Browser } from '@playwright/test';
import { connectToApp, connectToWeb, login, loginWeb, navigateTo } from '../helpers';
import { branding } from '../../src/config/branding';

// The only spec that proves apps/desktop and apps/web actually interoperate
// through the real api + Postgres -- every other spec in either suite only
// exercises one app talking to itself. Runs before 07-backup-restore (which
// leaves the desktop app unusable) and after the admin specs that need a
// clean, freshly-seeded desktop app.
//
// Only webPage is ever reloaded to force an immediate sync cycle (a plain
// browser rehydrates auth from localStorage with no network round trip).
// desktopPage is deliberately never reloaded here: its launch-time auth
// rehydration does a real network call to silently refresh the access
// token (see AuthContext.tsx), so a reload can transiently show the login
// screen if that call is merely slow, even though nothing was actually
// lost. Desktop-side observations instead wait out its own 30s sync
// interval, which is slower but doesn't touch that code path at all.
const DESKTOP_SYNC_WAIT = 35_000;

test.describe.serial('cross-app sync (desktop <-> web)', () => {
  let desktopPage: Page;
  let webBrowser: Browser;
  let webPage: Page;

  async function reloadWebAndWait() {
    await webPage.reload();
    await expect(webPage.getByRole('button', { name: 'Daily Sales' })).toBeVisible({ timeout: 15_000 });
  }

  // Chromium (and WebView2) throttles setInterval in a backgrounded
  // window -- connectToWeb() launching a separate browser can steal focus
  // from the desktop app, which would silently stall its sync interval far
  // beyond 30s. Bring it back to front before every wait that depends on
  // that interval actually firing.
  async function waitForDesktopSync() {
    await desktopPage.bringToFront();
    await desktopPage.waitForTimeout(DESKTOP_SYNC_WAIT);
  }

  test.beforeAll(async () => {
    desktopPage = await connectToApp();
    await login(desktopPage);
    ({ browser: webBrowser, page: webPage } = await connectToWeb());
    await loginWeb(webPage);
  });

  test.afterAll(async () => {
    await desktopPage.getByTestId('logout-button').click();
    await webPage.getByTestId('logout-button').click();
    await webBrowser.close();
  });

  test('a customer created on desktop reaches web', async () => {
    test.setTimeout(60_000);
    await navigateTo(desktopPage, 'Customers');
    await desktopPage.locator('#customer-name').fill('E2E Cross D2W');
    await desktopPage.getByRole('button', { name: 'Add customer', exact: true }).click();
    await expect(desktopPage.getByRole('cell', { name: 'E2E Cross D2W', exact: true })).toBeVisible();

    // Desktop pushes on its own 30s interval -- wait that out, then force
    // web to pull via reload.
    await waitForDesktopSync();
    await reloadWebAndWait();
    await webPage.getByRole('button', { name: 'Customers' }).click();
    await expect(webPage.getByRole('cell', { name: 'E2E Cross D2W', exact: true })).toBeVisible({ timeout: 15_000 });

    // The push that just landed on the server should be attributed to the
    // real logged-in user (E2E Owner, per apps/api/scripts/e2e-seed.mjs),
    // both in the Activity Log (what changed) and the Sync Log (that a push
    // happened at all).
    await desktopPage.bringToFront();
    await navigateTo(desktopPage, 'Activity & Sync Logs');
    await expect(desktopPage.getByRole('cell', { name: /Created customer "E2E Cross D2W"/ }).first()).toBeVisible();
    await expect(desktopPage.getByRole('cell', { name: 'E2E Owner', exact: true }).first()).toBeVisible();
    await desktopPage.getByRole('button', { name: 'Sync Log', exact: true }).click();
    await expect(desktopPage.getByRole('cell', { name: 'push', exact: true }).first()).toBeVisible();

    // The same log entries must be visible from web too -- Activity/Sync Log
    // is a server-side, read-only view on both apps, not something either
    // client keeps a local copy of.
    await webPage.bringToFront();
    await navigateTo(webPage, 'Activity & Sync Logs');
    await expect(webPage.getByRole('cell', { name: /Created customer "E2E Cross D2W"/ }).first()).toBeVisible();
    await expect(webPage.getByRole('cell', { name: 'E2E Owner', exact: true }).first()).toBeVisible();
    await webPage.getByRole('button', { name: 'Sync Log', exact: true }).click();
    await expect(webPage.getByRole('cell', { name: 'push', exact: true }).first()).toBeVisible();

    await desktopPage.bringToFront();
    await navigateTo(desktopPage, 'Customers');
    await desktopPage.getByRole('button', { name: 'Delete E2E Cross D2W' }).click();
  });

  test('a cafe product and the sale that decrements its stock are visible read-only on web', async () => {
    test.setTimeout(60_000);
    await navigateTo(desktopPage, 'Products & Stock');
    await desktopPage.locator('#new-product-category').fill('E2E Cafe Sync Category');
    await desktopPage.getByRole('button', { name: 'Add category', exact: true }).click();
    await expect(desktopPage.locator('#new-product-category')).toHaveValue('');

    await desktopPage.locator('#new-product-cat').click();
    await desktopPage.getByRole('option', { name: 'E2E Cafe Sync Category' }).click();
    await desktopPage.locator('#new-product-name').fill('E2E Cafe Sync Cola');
    await desktopPage.locator('#new-product-price').fill('60');
    await desktopPage.getByRole('button', { name: 'Add product' }).click();

    // Scoped to this test's own category card: other specs in this suite
    // (03-cafe.spec.ts) leave their own products behind in a differently
    // named category, and categories don't render in creation order (it's
    // alphabetical), so an unscoped .last() can resolve to the wrong one.
    const categoryCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'E2E Cafe Sync Category' });
    await expect(categoryCard.locator('input[id^="product-name-"]').last()).toHaveValue('E2E Cafe Sync Cola');

    await categoryCard.locator('input[id^="product-stock-"]').last().fill('10');
    await categoryCard.getByRole('button', { name: 'Apply' }).last().click();
    await expect(categoryCard.getByText('Stock: 10')).toBeVisible();

    await navigateTo(desktopPage, 'Cafe');
    await desktopPage.getByRole('button', { name: /^E2E Cafe Sync Cola/ }).click();
    await desktopPage.getByRole('button', { name: 'Complete sale' }).click();
    await expect(desktopPage.getByText('No items yet.')).toBeVisible();

    await waitForDesktopSync();
    await reloadWebAndWait();
    await navigateTo(webPage, 'Cafe');
    // Scoped to this product's own row: 03-cafe.spec.ts's "E2E Cola" also
    // sits at stock 9, so an unscoped "9" cell match would be ambiguous.
    const webProductRow = webPage.getByRole('row', { name: /E2E Cafe Sync Cola/ });
    await expect(webProductRow).toBeVisible();
    // Sold once (qty 1) out of the 10 stocked -- read-only, no way to
    // re-sell it from here, just confirming the same synced number.
    await expect(webProductRow.getByRole('cell', { name: '9', exact: true })).toBeVisible();

    await webPage.getByRole('button', { name: 'Orders', exact: true }).click();
    await expect(webPage.getByRole('cell', { name: `${branding.currencySymbol}60`, exact: true })).toBeVisible();
  });

  test('a credit session, an expense, and a rate change made on desktop are visible read-only on web', async () => {
    test.setTimeout(60_000);
    await navigateTo(desktopPage, 'Customers');
    await desktopPage.locator('#customer-name').fill('E2E Analytics Customer');
    await desktopPage.getByRole('button', { name: 'Add customer', exact: true }).click();
    await expect(desktopPage.getByRole('cell', { name: 'E2E Analytics Customer', exact: true })).toBeVisible();

    await navigateTo(desktopPage, 'Daily Sales');
    const stationCard = desktopPage.getByTestId('resource-card-8-Ball-Table 1');
    await stationCard.getByRole('button', { name: '+ Add session' }).click();
    const sessionRow = stationCard.getByTestId('session-row').last();
    await sessionRow.getByLabel('Amount').fill('300');
    await sessionRow.getByLabel('Customer').click();
    await desktopPage.getByRole('option', { name: 'E2E Analytics Customer' }).click();
    await expect(sessionRow.getByLabel('Customer')).toContainText('E2E Analytics Customer');
    await sessionRow.getByLabel('Payment method').click();
    await desktopPage.getByRole('option', { name: 'Credit' }).click();
    await expect(sessionRow.getByLabel('Payment method')).toContainText('Credit');

    await navigateTo(desktopPage, 'Expenses');
    await desktopPage.getByRole('button', { name: '+ Add expense' }).click();
    const expenseRow = desktopPage.getByTestId('expense-row').last();
    await expenseRow.getByLabel('Description').fill('E2E Analytics Snack');
    await expenseRow.getByLabel('Amount').fill('50');
    await expenseRow.getByLabel('Amount').blur();

    await navigateTo(desktopPage, 'Rate Management');
    const playStationCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'PlayStation' });
    const hourInput = playStationCard.getByLabel('Rate per 60 min');
    await hourInput.fill('175');
    await hourInput.blur();
    await expect(hourInput).toHaveValue('175');

    await waitForDesktopSync();
    await reloadWebAndWait();

    await navigateTo(webPage, 'Daily Sales');
    const webStationCard = webPage.getByTestId('resource-card-8-Ball-Table 1');
    const webSessionRow = webStationCard.getByTestId('session-row').last();
    await expect(webSessionRow).toContainText(`${branding.currencySymbol}300`);
    await expect(webSessionRow).toContainText('Credit');
    await expect(webSessionRow).toContainText('E2E Analytics Customer');
    // Read-only: no editable amount/method fields on web anymore.
    await expect(webSessionRow.getByLabel('Amount')).toHaveCount(0);

    await navigateTo(webPage, 'Credit Management');
    await expect(webPage.getByTestId('balance-E2E Analytics Customer')).toContainText(`${branding.currencySymbol}300`);

    await navigateTo(webPage, 'Expenses');
    await expect(webPage.getByText('E2E Analytics Snack')).toBeVisible();
    const totalCard = webPage.locator('[data-slot="card"]').filter({ hasText: 'Total expenses' });
    await expect(totalCard).toContainText('50');

    await navigateTo(webPage, 'Rate Management');
    const webPlayStationCard = webPage.locator('[data-slot="card"]').filter({ hasText: 'PlayStation' });
    await expect(webPlayStationCard).toContainText(`${branding.currencySymbol}175`);
    // Read-only: no rate input fields on web anymore.
    await expect(webPlayStationCard.getByRole('spinbutton')).toHaveCount(0);

    // Self-clean + restore the shared PlayStation rate.
    await desktopPage.bringToFront();
    await navigateTo(desktopPage, 'Daily Sales');
    await stationCard.getByTestId('session-row').last().getByRole('button', { name: 'Delete session' }).click();
    await navigateTo(desktopPage, 'Expenses');
    await desktopPage.getByTestId('expense-row').last().getByRole('button', { name: 'Delete expense' }).click();
    await navigateTo(desktopPage, 'Customers');
    await desktopPage.getByRole('button', { name: 'Delete E2E Analytics Customer' }).click();
    await navigateTo(desktopPage, 'Rate Management');
    await hourInput.fill('100');
    await hourInput.blur();
    await expect(hourInput).toHaveValue('100');
  });
});
