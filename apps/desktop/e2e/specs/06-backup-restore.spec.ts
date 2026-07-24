import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

// Runs last (see the 06- prefix / playwright.config.ts's serial workers):
// restore_backup closes the app's SQLite connection pool as part of
// swapping the database file, so the app is intentionally left unusable
// until a real restart -- nothing after this spec should assume the app is
// still interactive.
test('an admin can back up the database and then restore from that backup', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Backup & Restore');
  await page.getByRole('button', { name: 'Back up now' }).click();

  await expect(page.getByText(/Backup created: cue-room-backup-/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/cue-room-backup-.*\.sqlite/).first()).toBeVisible();

  // exact: true -- a substring match would also hit the sidebar's
  // "Backup & Restore" nav button, which contains "Restore" too.
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();

  await expect(page.getByText('Restore complete')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Close and reopen Cue Room/)).toBeVisible();
});
