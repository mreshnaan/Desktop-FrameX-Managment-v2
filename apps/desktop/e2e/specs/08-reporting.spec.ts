import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Orders have no delete path, so earlier specs' cafe orders persist in the
// same day/month -- these read a figure before the test's own sale so it
// can assert the increase, not an absolute total.
function parseLabeledAmount(text: string, label: string): number {
  const match = text.match(new RegExp(`${label}\\s*Rs\\.\\s*([\\d,]+)`, 'i'));
  if (!match) throw new Error(`"${label}" amount not found in: ${text}`);
  return Number(match[1].replace(/,/g, ''));
}

function parseFirstAmount(text: string): number {
  const match = text.match(/Rs\.\s*([\d,]+)/);
  if (!match) throw new Error(`amount not found in: ${text}`);
  return Number(match[1].replace(/,/g, ''));
}

test('cost price, cafe profit roll-up, and backdated Monthly Expenses', async () => {
  test.setTimeout(60_000);
  const page = await connectToApp();
  await login(page);

  // Baseline Cafe figures, captured before this test's own sale.
  await navigateTo(page, 'Daily Sales');
  const cafeCard = page.getByTestId('cafe-summary-card');
  const dailyBeforeText = await cafeCard.innerText();
  const dailyRevenueBefore = parseLabeledAmount(dailyBeforeText, 'Revenue');
  const dailyProfitBefore = parseLabeledAmount(dailyBeforeText, 'Profit');

  await navigateTo(page, 'Monthly Sales');
  const monthlyCafeCard = page.getByTestId('monthly-cafe-summary-card');
  const monthlyBeforeText = await monthlyCafeCard.innerText();
  const monthlyRevenueBefore = parseFirstAmount(monthlyBeforeText);
  const monthlyProfitBefore = parseLabeledAmount(monthlyBeforeText, 'profit');

  // Scoped by testid: the breakdown table's own column headers repeat
  // this text, so an unanchored hasText match would hit both.
  await expect(page.getByTestId('gross-revenue-card')).toBeVisible();
  await expect(page.getByTestId('total-expenses-card')).toBeVisible();
  await expect(page.getByTestId('net-profit-card')).toBeVisible();

  const filterTrigger = page.getByLabel('Filter category');
  await filterTrigger.click();
  await page.getByRole('option', { name: 'Cafe' }).click();
  await expect(page.getByRole('columnheader', { name: 'Cafe Profit' })).toBeVisible();

  await filterTrigger.click();
  await page.getByRole('option', { name: 'Expenses' }).click();
  await expect(page.getByRole('columnheader', { name: 'Total Expenses' })).toBeVisible();

  await filterTrigger.click();
  await page.getByRole('option', { name: 'All (Overall Summary)' }).click();
  await expect(page.getByRole('columnheader', { name: 'Gross Revenue' })).toBeVisible();

  // --- Cost price + margin, then a cafe sale feeding Daily/Monthly Sales' profit ---
  await navigateTo(page, 'Products & Stock');
  await page.locator('#new-product-category').fill('E2E Reporting Snacks');
  await page.getByRole('button', { name: 'Add category', exact: true }).click();

  await page.locator('#new-product-cat').click();
  await page.getByRole('option', { name: 'E2E Reporting Snacks' }).click();
  await page.locator('#new-product-name').fill('E2E Reporting Cola');
  await page.locator('#new-product-price').fill('150');
  await page.locator('#new-product-cost').fill('100');
  await page.getByRole('button', { name: 'Add product' }).click();

  const categoryCard = page.locator('[data-slot="card"]').filter({ hasText: 'E2E Reporting Snacks' });
  await expect(categoryCard.locator('input[id^="product-name-"]').last()).toHaveValue('E2E Reporting Cola');
  await expect(categoryCard.getByText(/Margin: Rs\. 50/)).toBeVisible();

  await categoryCard.locator('input[id^="product-stock-"]').last().fill('5');
  await categoryCard.getByRole('button', { name: 'Apply' }).last().click();
  await expect(categoryCard.getByText('Stock: 5')).toBeVisible();

  await navigateTo(page, 'Cafe');
  await page.getByRole('button', { name: /^E2E Reporting Cola/ }).click();
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.getByText('No items yet.')).toBeVisible();

  await navigateTo(page, 'Daily Sales');
  await expect(async () => {
    const text = await cafeCard.innerText();
    expect(parseLabeledAmount(text, 'Revenue')).toBe(dailyRevenueBefore + 150);
    expect(parseLabeledAmount(text, 'Profit')).toBe(dailyProfitBefore + 50); // 150 - 100 cost
  }).toPass();
  await cafeCard.getByRole('button', { name: 'Show orders' }).click();
  // Orders list newest-first; other specs' orders can also match this text.
  await expect(cafeCard.getByText(/1 item\(s\) — Cash/).first()).toBeVisible();

  await navigateTo(page, 'Monthly Sales');
  await expect(async () => {
    const text = await monthlyCafeCard.innerText();
    expect(parseFirstAmount(text)).toBe(monthlyRevenueBefore + 150);
    expect(parseLabeledAmount(text, 'profit')).toBe(monthlyProfitBefore + 50);
  }).toPass();

  // --- Backdated expense, visible from Monthly Expenses but not today's Expenses ---
  const yesterday = daysAgo(1);
  await navigateTo(page, 'Expenses');
  await page.getByLabel('Backdate to').fill(yesterday);
  await page.getByRole('button', { name: '+ Add expense' }).click();
  // The new row is filed under yesterday, not today's currently-viewed list.
  await page.getByRole('button', { name: 'Previous day' }).click();
  const row = page.getByTestId('expense-row').last();
  await row.getByLabel('Description').fill('E2E Reporting Ice');
  await row.getByLabel('Amount').fill('75');
  await row.getByLabel('Amount').blur();
  await expect(row.getByLabel('Description')).toHaveValue('E2E Reporting Ice');

  // Back to today -- the backdated expense must not appear here.
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByText('No expenses recorded for this day.')).toBeVisible();

  await navigateTo(page, 'Monthly Expenses');
  // Matched by total, not day number -- a bare "7" can collide with "Rs. 75".
  const dayRow = page.getByRole('row').filter({ hasText: 'Rs. 75' });
  await dayRow.click();

  // getByText() doesn't match input values -- assert via the field itself.
  const jumpedRow = page.getByTestId('expense-row').last();
  await expect(jumpedRow.getByLabel('Description')).toHaveValue('E2E Reporting Ice');

  // Cleanup: expense, product, category.
  await jumpedRow.getByRole('button', { name: 'Delete expense' }).click();
  await navigateTo(page, 'Products & Stock');
  await categoryCard.getByRole('button', { name: 'Deactivate' }).click();

  await page.getByTestId('logout-button').click();
});
