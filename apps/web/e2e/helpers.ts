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

// Nav items render as <button>, not <a> -- exact: true avoids matching an
// unrelated disabled button (e.g. "Customers" vs "Add customers first").
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}
