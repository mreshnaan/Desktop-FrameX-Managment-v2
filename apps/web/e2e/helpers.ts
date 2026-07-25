import type { Page } from '@playwright/test';

export const E2E_USERNAME = 'e2e-owner';
export const E2E_PIN = '1234';

// Each test gets its own fresh browser context, so unlike apps/desktop's
// suite there's no leftover session to log out of first.
export async function login(page: Page, username = E2E_USERNAME, pin = E2E_PIN): Promise<void> {
  await page.goto('/');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-pin').fill(pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// The sidebar renders each nav item as a <button> (SidebarMenuButton with an
// onClick handler, not an <a href>) -- matches apps/desktop/e2e/helpers.ts.
// exact: true -- an unanchored match can also hit an unrelated disabled
// button whose label happens to contain the nav label as a substring (e.g.
// "Customers" also matches SessionRow's "Add customers first").
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}
