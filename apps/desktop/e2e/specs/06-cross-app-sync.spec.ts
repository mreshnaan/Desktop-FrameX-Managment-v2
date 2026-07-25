import { test, expect, type Page, type Browser } from '@playwright/test';
import { connectToApp, connectToWeb, login, loginWeb, navigateTo } from '../helpers';

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

    await navigateTo(desktopPage, 'Customers');
    await desktopPage.getByRole('button', { name: 'Delete E2E Cross D2W' }).click();
  });

  test('a customer created on web reaches desktop', async () => {
    test.setTimeout(60_000);
    await webPage.getByRole('button', { name: 'Customers' }).click();
    await webPage.locator('#customer-name').fill('E2E Cross W2D');
    await webPage.getByRole('button', { name: 'Add customer', exact: true }).click();
    await expect(webPage.getByRole('cell', { name: 'E2E Cross W2D', exact: true })).toBeVisible();

    // Force web to push immediately (reload), then wait out desktop's own
    // pull interval -- no reload on the desktop side.
    await reloadWebAndWait();
    await webPage.getByRole('button', { name: 'Customers' }).click();
    await desktopPage.bringToFront();
    await navigateTo(desktopPage, 'Customers');
    await expect(desktopPage.getByRole('cell', { name: 'E2E Cross W2D', exact: true })).toBeVisible({
      timeout: DESKTOP_SYNC_WAIT,
    });

    await webPage.getByRole('button', { name: 'Delete E2E Cross W2D' }).click();
  });

  test('an edit made offline on web queues locally and reaches desktop once back online', async () => {
    test.setTimeout(60_000);
    const context = webPage.context();
    await context.setOffline(true);

    await webPage.getByRole('button', { name: 'Customers' }).click();
    await webPage.locator('#customer-name').fill('E2E Cross Offline');
    await webPage.getByRole('button', { name: 'Add customer', exact: true }).click();
    // Local-first: the write lands in Dexie and renders immediately, with no
    // network at all.
    await expect(webPage.getByRole('cell', { name: 'E2E Cross Offline', exact: true })).toBeVisible();

    await context.setOffline(false);
    // Push the now-queued outbox entry before desktop's next pull.
    await reloadWebAndWait();
    await webPage.getByRole('button', { name: 'Customers' }).click();
    await expect(webPage.getByRole('cell', { name: 'E2E Cross Offline', exact: true })).toBeVisible();

    await desktopPage.bringToFront();
    await navigateTo(desktopPage, 'Customers');
    await expect(desktopPage.getByRole('cell', { name: 'E2E Cross Offline', exact: true })).toBeVisible({
      timeout: DESKTOP_SYNC_WAIT,
    });

    await desktopPage.getByRole('button', { name: 'Delete E2E Cross Offline' }).click();
  });

  test('a session amount edited on both clients around the same time converges to one value on both', async () => {
    test.setTimeout(150_000);
    await navigateTo(desktopPage, 'Daily Sales');
    const desktopStation = desktopPage.getByTestId('resource-card-8-Ball-Table 1');
    await desktopStation.getByRole('button', { name: '+ Add session' }).click();
    const desktopRow = desktopStation.getByTestId('session-row').last();
    await desktopRow.getByLabel('Amount').fill('111');
    await desktopRow.getByLabel('Amount').blur();

    // Wait for desktop's push, then have web pull it -- both sides need a
    // shared starting point before they can race to edit the same row.
    await waitForDesktopSync();
    await reloadWebAndWait();
    await webPage.getByRole('button', { name: 'Daily Sales' }).click();
    const webStation = webPage.getByTestId('resource-card-8-Ball-Table 1');
    const webRow = webStation.getByTestId('session-row').last();
    await expect(webRow.getByLabel('Amount')).toHaveValue('111', { timeout: 15_000 });

    // Both clients now edit the same session at roughly the same time. Which
    // edit "wins" depends on which client's push happens to reach the server
    // last (last write wins, server-timestamped on arrival, per Global
    // Constraints) -- not something a test should assert a specific side of.
    // What must hold is convergence: no split-brain, both ends end up
    // showing the identical final value.
    await desktopRow.getByLabel('Amount').fill('222');
    await desktopRow.getByLabel('Amount').blur();
    await webRow.getByLabel('Amount').fill('333');
    await webRow.getByLabel('Amount').blur();

    // Desktop's next interval tick pushes 222. Web's reload immediately
    // after pushes 333 (landing after desktop's, since it happens on
    // demand) and pulls back whatever is now on the server.
    await waitForDesktopSync();
    await reloadWebAndWait();
    await webPage.getByRole('button', { name: 'Daily Sales' }).click();
    const webValue = await webStation.getByTestId('session-row').last().getByLabel('Amount').inputValue();
    expect(['222', '333']).toContain(webValue);

    // Desktop only converges to the same value on its own next pull.
    await desktopPage.bringToFront();
    await expect(async () => {
      const desktopValue = await desktopStation.getByTestId('session-row').last().getByLabel('Amount').inputValue();
      expect(desktopValue).toBe(webValue);
    }).toPass({ timeout: DESKTOP_SYNC_WAIT + 10_000, intervals: [5_000] });

    await desktopStation.getByTestId('session-row').last().getByRole('button', { name: 'Delete session' }).click();
  });
});
