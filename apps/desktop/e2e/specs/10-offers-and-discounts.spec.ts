import { test, expect, type Page, type Browser, type Locator } from '@playwright/test';
import { connectToApp, connectToWeb, login, loginWeb, navigateTo } from '../helpers';
import { branding } from '../../src/config/branding';

// Must run before 11-backup-restore (which kills the desktop app) -- see
// that file and 06-cross-app-sync.spec.ts for the same constraint.
const DESKTOP_SYNC_WAIT = 35_000;

test.describe.serial('offers and discounts', () => {
  let desktopPage: Page;
  let webBrowser: Browser;
  let webPage: Page;

  async function reloadWebAndWait() {
    await webPage.reload();
    await expect(webPage.getByRole('button', { name: 'Daily Sales' })).toBeVisible({ timeout: 15_000 });
  }

  // Backgrounded windows throttle setInterval -- bring desktop to front
  // first or its sync interval can silently stall past 30s.
  async function waitForDesktopSync() {
    await desktopPage.bringToFront();
    await desktopPage.waitForTimeout(DESKTOP_SYNC_WAIT);
  }

  // CustomerCombobox's popover is fine under a single use (see
  // 06-cross-app-sync.spec.ts), but four rapid-fire open/select cycles in the
  // frame-offer test below can occasionally race Base UI's popover mount --
  // the trigger click opens it a beat before the option is actionable, so a
  // single click can land before the option is wired up. Wrapping the whole
  // open+select in expect(...).toPass() retries the full sequence (not just
  // the final assertion) until the row's own label confirms the customer
  // actually stuck, instead of trusting one unconfirmed click.
  async function selectCustomer(row: Locator, name: string) {
    await expect(async () => {
      await row.getByLabel('Customer').click();
      await desktopPage.getByRole('button', { name, exact: true }).click();
      await expect(row.getByLabel('Customer')).toContainText(name, { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
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

  test('Owner creates an offer scoped to a specific category', async () => {
    await navigateTo(desktopPage, 'Offers');
    await desktopPage.getByRole('button', { name: '+ New offer' }).click();
    await desktopPage.getByLabel('Name').fill('E2E Weekday Special');
    // "All categories" defaults checked -- uncheck it to scope to 8-Ball only.
    await desktopPage.getByLabel('All categories').uncheck();
    await desktopPage.getByRole('checkbox', { name: '8-Ball' }).check();
    await desktopPage.getByLabel(/Minimum duration/).fill('90');
    await desktopPage.getByLabel('Effect value').fill('30');
    await desktopPage.getByRole('button', { name: 'Save' }).click();

    await expect(desktopPage.getByText('E2E Weekday Special')).toBeVisible();
    await expect(desktopPage.getByText('8-Ball', { exact: true })).toBeVisible();
  });

  test('Cashier cannot see Offers Management, but Owner can', async () => {
    // Reuses this repo's existing custom-role pattern (see 05-roles.spec.ts) --
    // a role with no offerManagement permission must not show the nav item.
    await navigateTo(desktopPage, 'Roles');
    const newRoleCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'Add role' });
    await newRoleCard.locator('#new-role-name').fill('E2E No Offers Role');
    await newRoleCard.getByLabel('Daily Sales').check();
    await newRoleCard.getByRole('button', { name: 'Create role' }).click();
    await expect(desktopPage.getByText('E2E No Offers Role')).toBeVisible();

    await navigateTo(desktopPage, 'User Management');
    await desktopPage.locator('#user-name').fill('E2E No Offers User');
    await desktopPage.locator('#user-username').fill('e2e-no-offers');
    await desktopPage.locator('#user-pin').fill('9012');
    await desktopPage.locator('#user-role').click();
    await desktopPage.getByRole('option', { name: 'E2E No Offers Role' }).click();
    await desktopPage.getByRole('button', { name: 'Create user' }).click();
    await expect(desktopPage.getByRole('cell', { name: 'e2e-no-offers' })).toBeVisible();

    await desktopPage.getByTestId('logout-button').click();
    await login(desktopPage, 'e2e-no-offers', '9012');
    await expect(desktopPage.getByRole('button', { name: 'Offers', exact: true })).toHaveCount(0);

    await desktopPage.getByTestId('logout-button').click();
    await login(desktopPage);
    await expect(desktopPage.getByRole('button', { name: 'Offers', exact: true })).toBeVisible();
  });

  test('a time-billed session becomes eligible, the discount applies, and it can be cleared', async () => {
    test.setTimeout(60_000);
    await navigateTo(desktopPage, 'Daily Sales');
    const stationCard = desktopPage.getByTestId('resource-card-8-Ball-Table 1');
    await stationCard.getByRole('button', { name: '+ Add session' }).click();
    const row = stationCard.getByTestId('session-row').last();

    // 8-Ball is 200/hr per the shared fixture rate -- 1.5h = 300, meets the
    // offer's 90-minute minimum.
    await row.getByLabel('Start time').fill('13:00');
    await row.getByLabel('End time').fill('14:30');
    await expect(row.getByLabel('Amount')).toHaveValue('300');

    await expect(row.getByText('E2E Weekday Special available')).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button', { name: 'Apply?' }).click();

    // 30 min free of a 90-min session -- 60 billable min at 200/hr = 200.
    await expect(row.getByLabel('Amount')).toHaveValue('200');
    await expect(row.getByText(/E2E Weekday Special applied/)).toBeVisible();
    await expect(row.getByText(new RegExp(`saved ${branding.currencySymbol}100`))).toBeVisible();

    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(row.getByLabel('Amount')).toHaveValue('300');
    await expect(row.getByText(/E2E Weekday Special applied/)).toHaveCount(0);

    await row.getByRole('button', { name: 'Delete session' }).click();
  });

  test('the applied offer and discount sync to web read-only', async () => {
    test.setTimeout(120_000);
    await navigateTo(desktopPage, 'Daily Sales');
    const stationCard = desktopPage.getByTestId('resource-card-8-Ball-Table 1');
    await stationCard.getByRole('button', { name: '+ Add session' }).click();
    const row = stationCard.getByTestId('session-row').last();
    await row.getByLabel('Start time').fill('13:00');
    await row.getByLabel('End time').fill('14:30');
    await expect(row.getByText('E2E Weekday Special available')).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button', { name: 'Apply?' }).click();
    await expect(row.getByLabel('Amount')).toHaveValue('200');

    // This session goes through two back-to-back local mutations (create at
    // the base 300, then apply-offer down to 200) before it's ever pushed --
    // both land in the outbox, but exactly which server-side state a given
    // 30s sync tick catches is a race against wall-clock timing, not
    // something a single fixed sleep can reliably outlast. Poll (reload +
    // re-check) across multiple sync intervals instead of trusting one.
    const webStationCard = webPage.getByTestId('resource-card-8-Ball-Table 1');
    let webRow = webStationCard.getByTestId('session-row').last();
    await expect(async () => {
      await waitForDesktopSync();
      await reloadWebAndWait();
      await navigateTo(webPage, 'Daily Sales');
      webRow = webStationCard.getByTestId('session-row').last();
      await expect(webRow).toContainText(`${branding.currencySymbol}200`, { timeout: 3_000 });
    }).toPass({ timeout: 100_000 });
    await expect(webRow).toContainText('E2E Weekday Special');
    await expect(webRow).toContainText(`${branding.currencySymbol}100`);

    await desktopPage.bringToFront();
    await row.getByRole('button', { name: 'Delete session' }).click();
  });

  test('a frame-billed quantity offer prompts exactly on the Nth game for the right customer', async () => {
    test.setTimeout(90_000);
    await navigateTo(desktopPage, 'Offers');
    await desktopPage.getByRole('button', { name: '+ New offer' }).click();
    await desktopPage.getByLabel('Name').fill('E2E Play 3 Get 1 Free');
    await desktopPage.getByLabel('All categories').uncheck();
    await desktopPage.getByRole('checkbox', { name: 'Snooker' }).check();
    await desktopPage.getByLabel(/Minimum game count/).fill('4');
    await desktopPage.getByRole('button', { name: 'Save' }).click();
    await expect(desktopPage.getByText('E2E Play 3 Get 1 Free')).toBeVisible();

    await navigateTo(desktopPage, 'Customers');
    await desktopPage.locator('#customer-name').fill('E2E Frame Offer Customer');
    await desktopPage.getByRole('button', { name: 'Add customer', exact: true }).click();
    await expect(desktopPage.getByRole('cell', { name: 'E2E Frame Offer Customer', exact: true })).toBeVisible();

    await navigateTo(desktopPage, 'Daily Sales');
    const stationCard = desktopPage.getByTestId('resource-card-Snooker-Table 1');

    for (let i = 0; i < 3; i++) {
      await stationCard.getByRole('button', { name: '+ Add session' }).click();
      const row = stationCard.getByTestId('session-row').last();
      await selectCustomer(row, 'E2E Frame Offer Customer');
      // No prompt should appear on games 1-3.
      await expect(row.getByText(/E2E Play 3 Get 1 Free available/)).toHaveCount(0);
    }

    await stationCard.getByRole('button', { name: '+ Add session' }).click();
    const fourthRow = stationCard.getByTestId('session-row').last();
    await selectCustomer(fourthRow, 'E2E Frame Offer Customer');
    await expect(fourthRow.getByText('E2E Play 3 Get 1 Free available')).toBeVisible({ timeout: 10_000 });

    // Clean up: delete all 4 sessions and the customer.
    for (let i = 0; i < 4; i++) {
      await stationCard.getByTestId('session-row').last().getByRole('button', { name: 'Delete session' }).click();
    }
    await navigateTo(desktopPage, 'Customers');
    await desktopPage.getByRole('button', { name: 'Delete E2E Frame Offer Customer' }).click();
  });

  test('cleanup: deactivate the two E2E offers', async () => {
    await navigateTo(desktopPage, 'Offers');
    const weekdaySpecialCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'E2E Weekday Special' });
    await weekdaySpecialCard.getByRole('button', { name: 'Deactivate' }).click();
    const frameOfferCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'E2E Play 3 Get 1 Free' });
    await frameOfferCard.getByRole('button', { name: 'Deactivate' }).click();
  });
});
