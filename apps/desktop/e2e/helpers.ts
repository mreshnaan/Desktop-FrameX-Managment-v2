import { chromium, type Browser, type Page } from '@playwright/test';

const CDP_URL = 'http://localhost:9222';
const WEB_URL = 'http://localhost:5173';

export const E2E_USERNAME = 'e2e-owner';
export const E2E_PIN = '1234';

// Connects to the already-running desktop app over WebView2's CDP port
// (started by global-setup.ts) -- drives the real compiled binary.
export async function connectToApp(): Promise<Page> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.bringToFront();
  return page;
}

// A previous spec may have failed before its own logout() -- log out first
// so every spec can assume a clean login screen.
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

// A plain browser instance pointed at apps/web's dev server -- used only by
// the cross-app-sync spec.
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
  // Awaited immediately so a login failure surfaces here, not as a later timeout.
  await page.getByRole('button', { name: 'Daily Sales' }).waitFor({ state: 'visible', timeout: 15_000 });
}

// Nav items render as <button>, not <a> -- exact: true avoids matching an
// unrelated button whose label contains this one as a substring.
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}
