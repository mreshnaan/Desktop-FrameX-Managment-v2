import { chromium, type Page } from '@playwright/test';

const CDP_URL = 'http://localhost:9222';

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

// The sidebar renders each nav item as a <button> (SidebarMenuButton with an
// onClick handler, not an <a href>), so this looks for a button by name --
// not a link.
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label }).click();
}
