import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

test('an admin can create a category and station, and it immediately appears in Daily Sales', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Categories & Stations');
  // "Add category" text is ambiguous (matches both the CardTitle and the
  // submit button) -- assert on the unique form input instead.
  await expect(page.locator('#new-category-name')).toBeVisible();

  // Billing defaults to "time" (NewCategoryCard's initial state), so no
  // interaction with the Select is needed for this case.
  await page.locator('#new-category-name').fill('E2E Bar Games');
  await page.getByRole('button', { name: 'Add category', exact: true }).click();

  await expect(page.getByText('E2E Bar Games')).toBeVisible();

  // Every category card has its own "New station name" input -- scope to
  // the card we just created, not the first one in DOM order.
  const categoryCard = page.locator('[data-slot="card"]').filter({ hasText: 'E2E Bar Games' });
  await categoryCard.getByPlaceholder('New station name').fill('E2E Dartboard');
  await categoryCard.getByRole('button', { name: '+ Add station' }).click();

  // exact: true -- an unanchored match also hits the "New station name" input.
  await expect(categoryCard.getByLabel('Station name', { exact: true }).last()).toHaveValue('E2E Dartboard');

  // Confirms this synced through the real write path, not just local UI state.
  await navigateTo(page, 'Daily Sales');
  await expect(page.getByRole('heading', { name: 'E2E Bar Games' })).toBeVisible();
  await expect(page.getByTestId('resource-card-E2E Bar Games-E2E Dartboard')).toBeVisible();

  await page.getByTestId('logout-button').click();
});
