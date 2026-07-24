import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

test('an admin creates a product with stock, then a cashier sells one and stock decrements', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Products & Stock');

  await page.locator('#new-product-category').fill('E2E Snacks');
  await page.getByRole('button', { name: 'Add category' }).click();
  // A newly created category with no products isn't rendered anywhere in
  // the product list (ProductManagementView filters out empty categories),
  // so the only observable proof it exists is that it's selectable here.
  await expect(page.locator('#new-product-category')).toHaveValue('');

  await page.locator('#new-product-cat').click();
  await page.getByRole('option', { name: 'E2E Snacks' }).click();
  await page.locator('#new-product-name').fill('E2E Cola');
  await page.locator('#new-product-price').fill('50');
  await page.getByRole('button', { name: 'Add product' }).click();

  // The product's name is the *value* of an editable input (ProductRowEditor),
  // not plain text -- getByText/hasText never match input values, and
  // getByDisplayValue is a Testing Library API, not Playwright's. This is
  // the only product in a fresh e2e run, so id^= is unambiguous.
  const nameInput = page.locator('input[id^="product-name-"]');
  await expect(nameInput).toHaveValue('E2E Cola');

  // Give it stock to sell -- a freshly created product starts at 0.
  await page.locator('input[id^="product-stock-"]').fill('10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Stock: 10')).toBeVisible();

  await navigateTo(page, 'Cafe');
  await page.getByRole('button', { name: /^E2E Cola/ }).click();

  await expect(page.getByTestId('cafe-total')).toContainText('50');

  await page.getByRole('button', { name: 'Complete sale' }).click();

  await expect(page.getByText('No items yet.')).toBeVisible();

  await navigateTo(page, 'Products & Stock');
  await expect(page.getByText('Stock: 9')).toBeVisible();

  await page.getByTestId('logout-button').click();
});

test('checkout rejects a sale that would take stock below zero', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Cafe');
  // Anchor to the start: an unanchored /E2E Cola/ also matches the cart's
  // "Remove E2E Cola" button (aria-label) once an item's been added.
  const productButton = page.getByRole('button', { name: /^E2E Cola/ });
  // Only 9 left after the previous test -- add it 10 times to overshoot.
  for (let i = 0; i < 10; i++) {
    await productButton.click();
  }

  await page.getByRole('button', { name: 'Complete sale' }).click();

  await expect(page.getByText(/Insufficient stock/)).toBeVisible();

  await page.getByTestId('logout-button').click();
});
