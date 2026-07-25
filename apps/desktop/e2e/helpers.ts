import { chromium, type Browser, type Page } from '@playwright/test';

const CDP_URL = 'http://localhost:9222';
const WEB_URL = 'http://localhost:5173';

export const E2E_USERNAME = 'e2e-owner';
export const E2E_PIN = '1234';

// Connects to the already-running desktop app over WebView2's CDP port
// (started by global-setup.ts) -- there is no dev server / baseURL here,
// this drives the real compiled binary the same way FrameX's e2e suite
// does.
export async function connectToApp(): Promise<Page> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.bringToFront();
  return page;
}

// If a previous spec failed before reaching its own logout() call, the app
// is left authenticated -- log out first so every spec can assume a clean
// login screen, instead of hanging on a login form that was never going to
// appear.
async function ensureLoggedOut(page: Page): Promise<void> {
  const loginUsername = page.locator('#login-username');
  if (await loginUsername.isVisible({ timeout: 1_000 }).catch(() => false)) return;
  const logoutButton = page.getByTestId('logout-button');
  if (await logoutButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await logoutButton.click();
    await loginUsername.waitFor({ state: 'visible', timeout: 5_000 });
  }
}

export async function login(page: Page, username = E2E_USERNAME, pin = E2E_PIN): Promise<void> {
  await ensureLoggedOut(page);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-pin').fill(pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// A plain browser instance (not CDP) pointed at apps/web's dev server
// (started by global-setup.ts alongside the desktop binary) -- used only by
// the cross-app-sync spec to prove data written on one client reaches the
// other through the real api, not just within a single app's own suite.
export async function connectToWeb(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(WEB_URL);
  return { browser, page };
}

export async function loginWeb(page: Page, username = E2E_USERNAME, pin = E2E_PIN): Promise<void> {
  await page.locator('#login-username').fill(username);
  await page.locator('#login-pin').fill(pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Unlike desktop's login(), this one is awaited before the caller does
  // anything else -- a silent login failure here would otherwise surface as
  // a confusing timeout several steps later instead of at its real source.
  await page.getByRole('button', { name: 'Daily Sales' }).waitFor({ state: 'visible', timeout: 15_000 });
}

// The sidebar renders each nav item as a <button> (SidebarMenuButton with an
// onClick handler, not an <a href>), so this looks for a button by name --
// not a link. exact: true -- an unanchored match can also hit an unrelated
// button whose label happens to contain the nav label as a substring (e.g.
// "Backup & Restore" also matches a disabled "Restore" button elsewhere).
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}
