import { test, expect } from '@playwright/test';
import { login } from '../helpers';

const API_BASE = 'http://localhost:4000';
const E2E_USERNAME = 'e2e-owner';
const E2E_PIN = '1234';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: E2E_USERNAME, pin: E2E_PIN }),
  });
  const body = await res.json();
  return body.accessToken;
}

async function pushEntry(
  accessToken: string,
  table: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await fetch(`${API_BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      entries: [{ table, op: 'upsert', id, payload, clientUpdatedAt: new Date().toISOString() }],
    }),
  });
}

// Verifies Daily Sales, Expenses, and Cafe's Orders tab each read from the
// new bounded /sessions, /expenses, /orders endpoints rather than the
// unbounded /sync/pull -- seeds one row of each dated "today" via a direct
// /sync/push call (web has no UI of its own to create them), then confirms
// each view shows it, and that the Orders tab genuinely stops showing it
// once the date stepper moves to a different day.
test("Daily Sales, Expenses, and Cafe's Orders tab show today's bounded data", async ({ page }) => {
  test.setTimeout(45_000);
  const accessToken = await getAccessToken();
  const today = todayStr();

  const pullRes = await fetch(`${API_BASE}/sync/pull`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { stations } = (await pullRes.json()) as { stations: { id: string; name: string }[] };
  const station = stations.find(s => s.name === 'Table 1')!;

  const sessionId = crypto.randomUUID();
  await pushEntry(accessToken, 'sessions', sessionId, {
    id: sessionId, stationId: station.id, date: today, start: '10:00', end: '11:00',
    amount: 250, method: 'Cash', customerId: null,
  });

  const expenseId = crypto.randomUUID();
  await pushEntry(accessToken, 'expenses', expenseId, {
    id: expenseId, date: today, description: 'E2E Bounded Read Snack', amount: 42, method: 'Cash',
  });

  const orderId = crypto.randomUUID();
  await pushEntry(accessToken, 'orders', orderId, { id: orderId, method: 'Cash', total: 88, customerId: null });

  await login(page);

  const stationCard = page.getByTestId('resource-card-8-Ball-Table 1');
  await expect(stationCard.getByTestId('session-row').filter({ hasText: 'Rs. 250' })).toBeVisible();

  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByText('E2E Bounded Read Snack')).toBeVisible();

  await page.getByRole('button', { name: 'Cafe', exact: true }).click();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await expect(page.getByText('Rs. 88')).toBeVisible();

  // Stepping to a different day must not show today's order -- proves the
  // Orders tab is genuinely date-scoped now, not the old unbounded list.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('No orders for this day.')).toBeVisible();

  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByText('Rs. 88')).toBeVisible();

  await page.getByTestId('logout-button').click();
});
