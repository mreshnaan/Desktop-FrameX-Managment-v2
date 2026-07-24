import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';

test.beforeEach(async () => {
  await cleanupAll();
  await seedUser('owner@e2e.test', 'testpass123', 'OWNER');
});
test.afterAll(async () => {
  await cleanupAll();
});

test('logs in, adds an 8-Ball session, and sees the auto-calculated amount reflected in the day total', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Daily Sales' })).toBeVisible();

  const tableCard = page.getByTestId('resource-card-8-Ball-Table 1');
  await tableCard.getByRole('button', { name: 'Add session' }).click();

  const row = page.getByTestId('session-row').last();
  await row.getByLabel('Start time').fill('09:00');
  await row.getByLabel('End time').fill('11:00');

  await expect(row.getByLabel('Amount')).toHaveValue('400'); // 2h x default INR 200/hr for 8-Ball
  await expect(page.getByTestId('summary-total')).toContainText('400');
});
