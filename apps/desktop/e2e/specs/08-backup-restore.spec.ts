import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';
import { branding } from '../../src/config/branding';

// Runs last (see the 08- prefix / playwright.config.ts's serial workers):
// restore_backup closes the app's SQLite connection pool as part of
// swapping the database file, so the app is intentionally left unusable
// until a real restart -- nothing after this spec should assume the app is
// still interactive.
test('an admin can back up the database and then restore from that backup', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Backup & Restore');
  await page.getByRole('button', { name: 'Back up now' }).click();

  // Derived from branding.ts rather than a second hardcoded literal --
  // src-tauri/src/branding.rs's APP_SHORT_NAME must still be kept equal to
  // this lowercased, since Rust and this TS test can't share one literal
  // across the language boundary.
  const prefix = `${branding.appShortName.toLowerCase()}-backup-`;
  await expect(page.getByText(new RegExp(`Backup created: ${prefix}`))).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(new RegExp(`${prefix}.*\\.sqlite`)).first()).toBeVisible();

  // exact: true -- a substring match would also hit the sidebar's
  // "Backup & Restore" nav button, which contains "Restore" too.
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();

  await expect(page.getByText('Restore complete')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(new RegExp(`Close and reopen ${branding.appName}`))).toBeVisible();
});
