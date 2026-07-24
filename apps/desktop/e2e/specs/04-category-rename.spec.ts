import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

test('renaming a category and its station persists and shows up on Daily Sales', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Categories & Stations');
  await page.locator('#new-category-name').fill('E2E Rename Source');
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(page.getByText('E2E Rename Source')).toBeVisible();

  const categoryCard = page.locator('[data-slot="card"]').filter({ hasText: 'E2E Rename Source' });
  await categoryCard.getByPlaceholder('New station name').fill('E2E Rename Station Src');
  await categoryCard.getByRole('button', { name: '+ Add station' }).click();
  await expect(categoryCard.getByLabel('Station name', { exact: true }).last()).toHaveValue('E2E Rename Station Src');

  const categoryNameInput = categoryCard.getByLabel('Category name');
  await categoryNameInput.fill('E2E Renamed Category');
  await categoryCard.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('E2E Renamed Category')).toBeVisible();

  // The card is still scoped by its original "E2E Rename Source" filter
  // text, which no longer matches after the rename above -- re-locate it by
  // the new name for the station rename that follows.
  const renamedCard = page.locator('[data-slot="card"]').filter({ hasText: 'E2E Renamed Category' });
  const stationNameInput = renamedCard.getByLabel('Station name', { exact: true }).last();
  await stationNameInput.fill('E2E Renamed Station');
  await renamedCard.getByRole('button', { name: 'Save' }).last().click();
  await expect(stationNameInput).toHaveValue('E2E Renamed Station');

  await navigateTo(page, 'Daily Sales');
  await expect(page.getByRole('heading', { name: 'E2E Renamed Category' })).toBeVisible();
  await expect(page.getByTestId('resource-card-E2E Renamed Category-E2E Renamed Station')).toBeVisible();

  await page.getByTestId('logout-button').click();
});
