import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';
import { branding } from '../../src/config/branding';

// Runs last -- restore_backup closes the app's SQLite pool, leaving it
// unusable until a real restart.
test('an admin can back up the database and then restore from that backup', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Backup & Restore');
  await page.getByRole('button', { name: 'Back up now' }).click();

  // Must match src-tauri/src/branding.rs's APP_SHORT_NAME, lowercased.
  const prefix = `${branding.appShortName.toLowerCase()}-backup-`;
  await expect(page.getByText(new RegExp(`Backup created: ${prefix}`))).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(new RegExp(`${prefix}.*\\.sqlite`)).first()).toBeVisible();

  // exact: true -- a substring match would also hit the sidebar's
  // "Backup & Restore" nav button, which contains "Restore" too.
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();

  await expect(page.getByText('Restore complete')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(new RegExp(`Close and reopen ${branding.appName}`))).toBeVisible();
});
