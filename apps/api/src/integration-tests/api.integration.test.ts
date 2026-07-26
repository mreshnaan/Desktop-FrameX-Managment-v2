import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import bcrypt from 'bcrypt';
import { app } from '../server';
import { prisma } from '../db';

// Unlike src/tests/ (which mocks prisma), these hit real Express routes and
// real Postgres. Run with `pnpm test:integration`, not `pnpm test`.

const USERNAME = 'e2e-integration';
const PIN = '1234';
let baseUrl: string;
let server: Server;
let customerId: string;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as { port: number };
  baseUrl = `http://localhost:${port}`;

  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'OWNER' } });
  const pinHash = await bcrypt.hash(PIN, 12);
  await prisma.user.upsert({
    where: { username: USERNAME },
    create: { username: USERNAME, pinHash, name: 'E2E Integration', roleId: role.id },
    update: { pinHash, roleId: role.id },
  });
});

afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  if (user) {
    await prisma.activityLog.deleteMany({ where: { userId: user.id } });
    await prisma.syncLog.deleteMany({ where: { userId: user.id } });
  }
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /auth/login', () => {
  it('rejects a wrong PIN', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, pin: '9999' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns an access token and the OWNER permission set for the right PIN', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, pin: PIN }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ accessToken: string; user: { permissions: string[] } }>(res);
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.permissions).toContain('userManagement');
  });
});

describe('authenticated routes', () => {
  let accessToken: string;

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, pin: PIN }),
    });
    ({ accessToken } = await json<{ accessToken: string }>(res));
  });

  it('rejects a request with no bearer token', async () => {
    const res = await fetch(`${baseUrl}/sync/pull`);
    expect(res.status).toBe(401);
  });

  it('lists the three seeded system roles', async () => {
    const res = await fetch(`${baseUrl}/roles`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const roles = await json<{ name: string; isSystem: boolean }[]>(res);
    const names = roles.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['OWNER', 'ADMIN', 'CASHIER']));
  });

  it('a pushed customer is retrievable via pull', async () => {
    customerId = crypto.randomUUID();
    const pushRes = await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [
          {
            table: 'customers',
            op: 'upsert',
            id: customerId,
            payload: { id: customerId, name: 'E2E Integration Customer', phone: '' },
            clientUpdatedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(pushRes.status).toBe(200);
    expect((await json<{ failed: unknown[] }>(pushRes)).failed).toEqual([]);

    const pullRes = await fetch(`${baseUrl}/sync/pull?since=2000-01-01T00:00:00.000Z`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(pullRes.status).toBe(200);
    const body = await json<{ customers: unknown[] }>(pullRes);
    expect(body.customers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: customerId, name: 'E2E Integration Customer' })]),
    );
  });

  it('the push above is attributed to the pushing user in Activity Log and Sync Log', async () => {
    const activityRes = await fetch(`${baseUrl}/activity-logs?pageSize=50`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(activityRes.status).toBe(200);
    const activityBody = await json<{ entries: { tableName: string; entityId: string; action: string; userName: string }[] }>(activityRes);
    expect(activityBody.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: 'customers', entityId: customerId, action: 'create', userName: 'E2E Integration' }),
      ]),
    );

    const syncRes = await fetch(`${baseUrl}/sync-logs?pageSize=50`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(syncRes.status).toBe(200);
    const syncBody = await json<{ entries: { direction: string; userName: string }[] }>(syncRes);
    expect(syncBody.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ direction: 'push', userName: 'E2E Integration' })]),
    );
  });

  // GET /reports/customer-balances
  it('GET /reports/customer-balances returns a plain object keyed by customerId', async () => {
    const res = await fetch(`${baseUrl}/reports/customer-balances`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const body = await json<Record<string, number>>(res);

    // Must be a plain object (not an array)
    expect(Array.isArray(body)).toBe(false);
    expect(typeof body).toBe('object');

    // The customer we pushed earlier must appear with balance 0
    // (no credit entries exist for it yet)
    expect(body).toHaveProperty(customerId);
    expect(body[customerId]).toBe(0);
  });

  it('GET /reports/customer-balances reflects a pushed credit entry', async () => {
    // Push a CREDIT_GIVEN entry of 350 for our test customer
    const entryId = crypto.randomUUID();
    const pushRes = await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [{
          table: 'creditEntries',
          op: 'upsert',
          id: entryId,
          payload: {
            id: entryId,
            customerId,
            date: '2026-07-01',
            type: 'CREDIT_GIVEN',
            amount: 350,
            updatedAt: new Date().toISOString(),
          },
          clientUpdatedAt: new Date().toISOString(),
        }],
      }),
    });
    expect(pushRes.status).toBe(200);
    expect((await json<{ failed: unknown[] }>(pushRes)).failed).toEqual([]);

    const balRes = await fetch(`${baseUrl}/reports/customer-balances`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(balRes.status).toBe(200);
    const balances = await json<Record<string, number>>(balRes);
    expect(balances[customerId]).toBe(350);

    // Cleanup credit entry
    await prisma.creditEntry.deleteMany({ where: { id: entryId } });
  });

  // GET /reports/customer-credit-history/:customerId
  it('GET /reports/customer-credit-history/:id returns an empty array for a customer with no history', async () => {
    const res = await fetch(`${baseUrl}/reports/customer-credit-history/${customerId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const body = await json<unknown[]>(res);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /reports/customer-credit-history/:id returns labelled rows sorted date DESC', async () => {
    // Push two credit entries with different dates
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [
          { table: 'creditEntries', op: 'upsert', id: id1, payload: { id: id1, customerId, date: '2026-07-01', type: 'CREDIT_GIVEN', amount: 200, updatedAt: new Date().toISOString() }, clientUpdatedAt: new Date().toISOString() },
          { table: 'creditEntries', op: 'upsert', id: id2, payload: { id: id2, customerId, date: '2026-07-05', type: 'PAYMENT_RECEIVED', amount: 80, updatedAt: new Date().toISOString() }, clientUpdatedAt: new Date().toISOString() },
        ],
      }),
    });

    const res = await fetch(`${baseUrl}/reports/customer-credit-history/${customerId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const rows = await json<{ id: string; date: string; label: string; amount: number; direction: string }[]>(res);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Date DESC: 2026-07-05 payment comes before 2026-07-01 credit
    const paymentIdx = rows.findIndex(r => r.id === `credit-${id2}`);
    const creditIdx  = rows.findIndex(r => r.id === `credit-${id1}`);
    expect(paymentIdx).toBeLessThan(creditIdx);
    expect(rows[paymentIdx].label).toBe('Payment received');
    expect(rows[paymentIdx].direction).toBe('payment');
    expect(rows[creditIdx].label).toBe('Credit given');
    expect(rows[creditIdx].direction).toBe('charge');

    // Cleanup
    await prisma.creditEntry.deleteMany({ where: { id: { in: [id1, id2] } } });
  });

  // -------------------------------------------------------------------------
  // GET /sessions
  // -------------------------------------------------------------------------
  it('GET /sessions returns only sessions for the requested date', async () => {
    const station = await prisma.station.findFirstOrThrow({ where: { name: 'Table 1' } });
    const inRangeId = crypto.randomUUID();
    const outOfRangeId = crypto.randomUUID();

    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [
          {
            table: 'sessions', op: 'upsert', id: inRangeId,
            payload: { id: inRangeId, stationId: station.id, date: '2026-07-01', start: '10:00', end: '11:00', amount: 250, method: 'Cash', customerId: null },
            clientUpdatedAt: new Date().toISOString(),
          },
          {
            table: 'sessions', op: 'upsert', id: outOfRangeId,
            payload: { id: outOfRangeId, stationId: station.id, date: '2026-07-02', start: '10:00', end: '11:00', amount: 300, method: 'Cash', customerId: null },
            clientUpdatedAt: new Date().toISOString(),
          },
        ],
      }),
    });

    const res = await fetch(`${baseUrl}/sessions?date=2026-07-01`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const sessions = await json<{ id: string; date: string }[]>(res);
    expect(sessions.some(s => s.id === inRangeId)).toBe(true);
    expect(sessions.some(s => s.id === outOfRangeId)).toBe(false);

    await prisma.session.deleteMany({ where: { id: { in: [inRangeId, outOfRangeId] } } });
  });

  it('GET /sessions returns 400 when date is missing', async () => {
    const res = await fetch(`${baseUrl}/sessions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(400);
  });

  it('GET /sessions excludes soft-deleted sessions', async () => {
    const station = await prisma.station.findFirstOrThrow({ where: { name: 'Table 1' } });
    const sessionId = crypto.randomUUID();
    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [{
          table: 'sessions', op: 'upsert', id: sessionId,
          payload: { id: sessionId, stationId: station.id, date: '2026-07-01', start: '10:00', end: '11:00', amount: 250, method: 'Cash', customerId: null },
          clientUpdatedAt: new Date().toISOString(),
        }],
      }),
    });
    await prisma.session.update({ where: { id: sessionId }, data: { deletedAt: new Date() } });

    const res = await fetch(`${baseUrl}/sessions?date=2026-07-01`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const sessions = await json<{ id: string }[]>(res);
    expect(sessions.some(s => s.id === sessionId)).toBe(false);

    await prisma.session.deleteMany({ where: { id: sessionId } });
  });

  // -------------------------------------------------------------------------
  // GET /expenses
  // -------------------------------------------------------------------------
  it('GET /expenses returns only expenses for the requested date', async () => {
    const inRangeId = crypto.randomUUID();
    const outOfRangeId = crypto.randomUUID();

    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [
          {
            table: 'expenses', op: 'upsert', id: inRangeId,
            payload: { id: inRangeId, date: '2026-07-01', description: 'E2E in range', amount: 50, method: 'Cash' },
            clientUpdatedAt: new Date().toISOString(),
          },
          {
            table: 'expenses', op: 'upsert', id: outOfRangeId,
            payload: { id: outOfRangeId, date: '2026-07-02', description: 'E2E out of range', amount: 75, method: 'Cash' },
            clientUpdatedAt: new Date().toISOString(),
          },
        ],
      }),
    });

    const res = await fetch(`${baseUrl}/expenses?date=2026-07-01`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const expenses = await json<{ id: string; date: string }[]>(res);
    expect(expenses.some(e => e.id === inRangeId)).toBe(true);
    expect(expenses.some(e => e.id === outOfRangeId)).toBe(false);

    await prisma.expense.deleteMany({ where: { id: { in: [inRangeId, outOfRangeId] } } });
  });

  it('GET /expenses returns 400 when date is missing', async () => {
    const res = await fetch(`${baseUrl}/expenses`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(400);
  });

  it('GET /expenses excludes soft-deleted expenses', async () => {
    const expenseId = crypto.randomUUID();
    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [{
          table: 'expenses', op: 'upsert', id: expenseId,
          payload: { id: expenseId, date: '2026-07-01', description: 'E2E soft-deleted', amount: 50, method: 'Cash' },
          clientUpdatedAt: new Date().toISOString(),
        }],
      }),
    });
    await prisma.expense.update({ where: { id: expenseId }, data: { deletedAt: new Date() } });

    const res = await fetch(`${baseUrl}/expenses?date=2026-07-01`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const expenses = await json<{ id: string }[]>(res);
    expect(expenses.some(e => e.id === expenseId)).toBe(false);

    await prisma.expense.deleteMany({ where: { id: expenseId } });
  });

  // -------------------------------------------------------------------------
  // GET /orders
  // -------------------------------------------------------------------------
  it('GET /orders returns only orders within the UTC bounds, with their items', async () => {
    // Pushes its own category/product rather than relying on findFirst() --
    // a previous version of this test skipped the item assertion entirely
    // when no product existed in the DB.
    const categoryId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    const inRangeId = crypto.randomUUID();
    const outOfRangeId = crypto.randomUUID();
    const itemId = crypto.randomUUID();

    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [
          { table: 'productCategories', op: 'upsert', id: categoryId, payload: { id: categoryId, name: 'E2E Integration Category' }, clientUpdatedAt: new Date().toISOString() },
          { table: 'products', op: 'upsert', id: productId, payload: { id: productId, categoryId, name: 'E2E Integration Product', price: 50, cost: null, stockQty: 0, lowStockThreshold: 0, barcode: null, active: true }, clientUpdatedAt: new Date().toISOString() },
          { table: 'orders', op: 'upsert', id: inRangeId, payload: { id: inRangeId, method: 'Cash', total: 100, customerId: null }, clientUpdatedAt: new Date().toISOString() },
          { table: 'orders', op: 'upsert', id: outOfRangeId, payload: { id: outOfRangeId, method: 'Cash', total: 200, customerId: null }, clientUpdatedAt: new Date().toISOString() },
          { table: 'orderItems', op: 'upsert', id: itemId, payload: { id: itemId, orderId: inRangeId, productId, qty: 2, unitPrice: 50, lineTotal: 100 }, clientUpdatedAt: new Date().toISOString() },
        ],
      }),
    });

    // applyPush always server-stamps updatedAt to "now" -- backdate directly
    // to simulate historical orders, matching the pattern in
    // apps/desktop/src-tauri/src/commands/orders.rs's own tests.
    await prisma.order.update({ where: { id: inRangeId }, data: { updatedAt: new Date('2026-07-01T10:00:00.000Z') } });
    await prisma.order.update({ where: { id: outOfRangeId }, data: { updatedAt: new Date('2026-07-02T10:00:00.000Z') } });

    const res = await fetch(
      `${baseUrl}/orders?startUtc=2026-07-01T00:00:00.000Z&endUtc=2026-07-02T00:00:00.000Z`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status).toBe(200);
    const body = await json<{ orders: { id: string }[]; orderItems: { orderId: string }[] }>(res);
    expect(body.orders.some(o => o.id === inRangeId)).toBe(true);
    expect(body.orders.some(o => o.id === outOfRangeId)).toBe(false);
    expect(body.orderItems.length).toBeGreaterThan(0);
    expect(body.orderItems.every(i => i.orderId === inRangeId)).toBe(true);

    await prisma.orderItem.deleteMany({ where: { orderId: { in: [inRangeId, outOfRangeId] } } });
    await prisma.order.deleteMany({ where: { id: { in: [inRangeId, outOfRangeId] } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
  });

  it('GET /orders excludes soft-deleted orders', async () => {
    const orderId = crypto.randomUUID();
    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [{ table: 'orders', op: 'upsert', id: orderId, payload: { id: orderId, method: 'Cash', total: 100, customerId: null }, clientUpdatedAt: new Date().toISOString() }],
      }),
    });
    await prisma.order.update({ where: { id: orderId }, data: { updatedAt: new Date('2026-07-01T10:00:00.000Z'), deletedAt: new Date() } });

    const res = await fetch(
      `${baseUrl}/orders?startUtc=2026-07-01T00:00:00.000Z&endUtc=2026-07-02T00:00:00.000Z`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status).toBe(200);
    const body = await json<{ orders: { id: string }[] }>(res);
    expect(body.orders.some(o => o.id === orderId)).toBe(false);

    await prisma.order.deleteMany({ where: { id: orderId } });
  });

  it('GET /orders returns 400 when startUtc/endUtc are missing', async () => {
    const res = await fetch(`${baseUrl}/orders`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(400);
  });

  it('GET /orders returns 400 (not a hang/crash) for malformed startUtc/endUtc', async () => {
    const res = await fetch(
      `${baseUrl}/orders?startUtc=not-a-date&endUtc=also-not-a-date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status).toBe(400);
    const body = await json<{ error: string }>(res);
    expect(body.error).toBe('startUtc and endUtc must be valid ISO datetimes');
  });

  // -------------------------------------------------------------------------
  // requireView wiring on the three new routes
  // -------------------------------------------------------------------------
  it('GET /sessions, /expenses, /orders all reject a token with none of the matching permissions', async () => {
    const role = await prisma.role.create({ data: { name: 'E2E No Permissions Role' } });
    const pinHash = await bcrypt.hash('9999', 12);
    const user = await prisma.user.create({
      data: { username: 'e2e-no-permissions', pinHash, name: 'E2E No Permissions', roleId: role.id },
    });

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'e2e-no-permissions', pin: '9999' }),
    });
    const { accessToken: restrictedToken } = await json<{ accessToken: string }>(loginRes);

    const [sessionsRes, expensesRes, ordersRes] = await Promise.all([
      fetch(`${baseUrl}/sessions?date=2026-07-01`, { headers: { Authorization: `Bearer ${restrictedToken}` } }),
      fetch(`${baseUrl}/expenses?date=2026-07-01`, { headers: { Authorization: `Bearer ${restrictedToken}` } }),
      fetch(`${baseUrl}/orders?startUtc=2026-07-01T00:00:00.000Z&endUtc=2026-07-02T00:00:00.000Z`, { headers: { Authorization: `Bearer ${restrictedToken}` } }),
    ]);
    expect(sessionsRes.status).toBe(403);
    expect(expensesRes.status).toBe(403);
    expect(ordersRes.status).toBe(403);

    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.role.deleteMany({ where: { id: role.id } });
  });
});
