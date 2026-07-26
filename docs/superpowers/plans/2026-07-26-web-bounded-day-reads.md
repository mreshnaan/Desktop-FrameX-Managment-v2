# Web Bounded Day-Scoped Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `apps/web` from fetching its entire unbounded transaction history (via `/sync/pull`) to render single-day views; give it three new bounded read endpoints instead.

**Architecture:** Three new single-responsibility Express route files (`GET /sessions?date=`, `GET /expenses?date=`, `GET /orders?startUtc=&endUtc=`), each behind the existing `authenticate` middleware. Web's `useSessions`/`useExpenses` hooks switch from deriving off `usePullData()` to calling these directly; `CafeView.tsx`'s Orders tab gains a date stepper and switches to the new `/orders` endpoint.

**Tech Stack:** Express, Prisma, TanStack Query, Playwright (web e2e), Vitest (api unit + integration).

## Global Constraints

- Full design/rationale: `docs/superpowers/specs/2026-07-26-web-bounded-day-reads-design.md`.
- `GET /sync/pull` and `apps/web/src/lib/hooks/usePullData.ts` are NOT modified by this plan — they remain desktop's real sync protocol and web's source for small reference data (categories, stations, rates, customer roster).
- New routes follow the exact existing pattern in `apps/api/src/routes/reports.routes.ts`: a `Router()`, `.use(authenticate)`, plain `prisma` queries, no service-layer indirection.
- `useSessions(date)` / `useExpenses(date)`'s public return shape (`{ sessions, isLoading }` / `{ expenses, isLoading }`) must not change — `DailySalesView.tsx` and `ExpensesView.tsx` call them without modification.
- Cafe→Orders on web currently shows every order ever placed with no date control. This plan changes that to one day at a time (default today), navigable via `DateStepper` — a real, user-visible UX change, not just internal cleanup.

---

### Task 1: `GET /sessions?date=` endpoint

**Files:**
- Create: `apps/api/src/routes/sessions.routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/integration-tests/api.integration.test.ts`

**Interfaces:**
- Consumes: `authenticate` (`apps/api/src/middleware/auth.ts`), `prisma` (`apps/api/src/db.ts`).
- Produces: `sessionsRouter` (default export from the new file, named export `sessionsRouter`), mounted at `/sessions`. `GET /sessions?date=YYYY-MM-DD` → `200` with a JSON array of Prisma `Session` rows (`deletedAt: null` only), or `400 { error: 'date required' }` if `date` is missing.

- [ ] **Step 1: Write the failing integration test**

Add to `apps/api/src/integration-tests/api.integration.test.ts`, inside the existing `describe('authenticated routes', ...)` block (after the `GET /reports/customer-credit-history/:id` tests, before the closing `});` of that describe):

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cue-room/api test:integration`
Expected: FAIL — `fetch(...)` to `/sessions` returns 404 (no such route registered yet).

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/sessions.routes.ts`:

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../db';

export const sessionsRouter = Router();
sessionsRouter.use(authenticate);

// GET /sessions?date=YYYY-MM-DD -- bounded to one day, unlike /sync/pull.
sessionsRouter.get('/', async (req, res) => {
  const date = String(req.query.date || '');
  if (!date) {
    return res.status(400).json({ error: 'date required' });
  }

  const sessions = await prisma.session.findMany({
    where: { date, deletedAt: null },
  });

  return res.json(sessions);
});
```

- [ ] **Step 4: Mount the router**

Modify `apps/api/src/server.ts`:

```ts
import express from 'express';
import cors from 'cors';
import { env } from './env';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { rolesRouter } from './routes/roles.routes';
import { syncRouter } from './routes/sync.routes';
import { reportsRouter } from './routes/reports.routes';
import { sessionsRouter } from './routes/sessions.routes';
import { logsRouter } from './routes/logs.routes';

export const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/roles', rolesRouter);
app.use('/sync', syncRouter);
app.use('/reports', reportsRouter);
app.use('/sessions', sessionsRouter);
app.use('/', logsRouter);

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => console.log(`api listening on :${env.PORT}`));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cue-room/api test:integration`
Expected: PASS — both new tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/sessions.routes.ts apps/api/src/server.ts apps/api/src/integration-tests/api.integration.test.ts
git commit -m "feat(api): add bounded GET /sessions?date= endpoint"
```

---

### Task 2: `GET /expenses?date=` endpoint

**Files:**
- Create: `apps/api/src/routes/expenses.routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/integration-tests/api.integration.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `prisma` (same as Task 1).
- Produces: `expensesRouter`, mounted at `/expenses`. `GET /expenses?date=YYYY-MM-DD` → `200` with a JSON array of Prisma `Expense` rows (`deletedAt: null` only), or `400` if `date` is missing.

- [ ] **Step 1: Write the failing integration test**

Add to `apps/api/src/integration-tests/api.integration.test.ts`, after the `GET /sessions` tests added in Task 1:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cue-room/api test:integration`
Expected: FAIL — `/expenses` returns 404.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/expenses.routes.ts`:

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../db';

export const expensesRouter = Router();
expensesRouter.use(authenticate);

// GET /expenses?date=YYYY-MM-DD -- bounded to one day, unlike /sync/pull.
expensesRouter.get('/', async (req, res) => {
  const date = String(req.query.date || '');
  if (!date) {
    return res.status(400).json({ error: 'date required' });
  }

  const expenses = await prisma.expense.findMany({
    where: { date, deletedAt: null },
  });

  return res.json(expenses);
});
```

- [ ] **Step 4: Mount the router**

Modify `apps/api/src/server.ts` — add the import and registration:

```ts
import { expensesRouter } from './routes/expenses.routes';
```

```ts
app.use('/expenses', expensesRouter);
```

(placed after `app.use('/sessions', sessionsRouter);`, before `app.use('/', logsRouter);`)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cue-room/api test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/expenses.routes.ts apps/api/src/server.ts apps/api/src/integration-tests/api.integration.test.ts
git commit -m "feat(api): add bounded GET /expenses?date= endpoint"
```

---

### Task 3: `GET /orders?startUtc=&endUtc=` endpoint

**Files:**
- Create: `apps/api/src/routes/orders.routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/integration-tests/api.integration.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `prisma`.
- Produces: `ordersRouter`, mounted at `/orders`. `GET /orders?startUtc=<ISO>&endUtc=<ISO>` → `200` with `{ orders: Order[], orderItems: OrderItem[] }` (orders in `[startUtc, endUtc)` by `updatedAt`, `deletedAt: null`; `orderItems` for exactly those orders), or `400` if either bound is missing.

**Note:** Orders have no `date` column — `updatedAt` is a UTC instant (see `reports.routes.ts`'s `/monthly` handler and `apps/desktop/src-tauri/src/commands/orders.rs`'s `list_orders_between` for the established convention this follows). The client computes `startUtc`/`endUtc` via `localDateRangeToUtc()`.

- [ ] **Step 1: Write the failing integration test**

Add to `apps/api/src/integration-tests/api.integration.test.ts`, after the `GET /expenses` tests added in Task 2:

```ts
  // -------------------------------------------------------------------------
  // GET /orders
  // -------------------------------------------------------------------------
  it('GET /orders returns only orders within the UTC bounds, with their items', async () => {
    const product = await prisma.product.findFirst();
    const inRangeId = crypto.randomUUID();
    const outOfRangeId = crypto.randomUUID();

    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [
          { table: 'orders', op: 'upsert', id: inRangeId, payload: { id: inRangeId, method: 'Cash', total: 100, customerId: null }, clientUpdatedAt: new Date().toISOString() },
          { table: 'orders', op: 'upsert', id: outOfRangeId, payload: { id: outOfRangeId, method: 'Cash', total: 200, customerId: null }, clientUpdatedAt: new Date().toISOString() },
        ],
      }),
    });

    // applyPush always server-stamps updatedAt to "now" -- backdate directly
    // to simulate historical orders, matching the pattern in
    // apps/desktop/src-tauri/src/commands/orders.rs's own tests.
    await prisma.order.update({ where: { id: inRangeId }, data: { updatedAt: new Date('2026-07-01T10:00:00.000Z') } });
    await prisma.order.update({ where: { id: outOfRangeId }, data: { updatedAt: new Date('2026-07-02T10:00:00.000Z') } });

    if (product) {
      const itemId = crypto.randomUUID();
      await fetch(`${baseUrl}/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          entries: [{
            table: 'orderItems', op: 'upsert', id: itemId,
            payload: { id: itemId, orderId: inRangeId, productId: product.id, qty: 2, unitPrice: 50, lineTotal: 100 },
            clientUpdatedAt: new Date().toISOString(),
          }],
        }),
      });
    }

    const res = await fetch(
      `${baseUrl}/orders?startUtc=2026-07-01T00:00:00.000Z&endUtc=2026-07-02T00:00:00.000Z`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status).toBe(200);
    const body = await json<{ orders: { id: string }[]; orderItems: { orderId: string }[] }>(res);
    expect(body.orders.some(o => o.id === inRangeId)).toBe(true);
    expect(body.orders.some(o => o.id === outOfRangeId)).toBe(false);
    expect(body.orderItems.every(i => i.orderId === inRangeId)).toBe(true);

    await prisma.orderItem.deleteMany({ where: { orderId: { in: [inRangeId, outOfRangeId] } } });
    await prisma.order.deleteMany({ where: { id: { in: [inRangeId, outOfRangeId] } } });
  });

  it('GET /orders returns 400 when startUtc/endUtc are missing', async () => {
    const res = await fetch(`${baseUrl}/orders`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cue-room/api test:integration`
Expected: FAIL — `/orders` returns 404.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/orders.routes.ts`:

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../db';

export const ordersRouter = Router();
ordersRouter.use(authenticate);

// GET /orders?startUtc=<ISO>&endUtc=<ISO> -- bounded by UTC instant, unlike
// /sync/pull. Orders have no `date` column; updatedAt is the UTC instant the
// order belongs to (see apps/desktop's list_orders_between for why this
// can't be a plain date filter).
ordersRouter.get('/', async (req, res) => {
  const startUtc = String(req.query.startUtc || '');
  const endUtc = String(req.query.endUtc || '');
  if (!startUtc || !endUtc) {
    return res.status(400).json({ error: 'startUtc and endUtc required' });
  }

  const orders = await prisma.order.findMany({
    where: {
      updatedAt: { gte: new Date(startUtc), lt: new Date(endUtc) },
      deletedAt: null,
    },
  });

  const orderIds = orders.map(o => o.id);
  const orderItems = orderIds.length > 0
    ? await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } } })
    : [];

  return res.json({ orders, orderItems });
});
```

- [ ] **Step 4: Mount the router**

Modify `apps/api/src/server.ts` — add the import and registration:

```ts
import { ordersRouter } from './routes/orders.routes';
```

```ts
app.use('/orders', ordersRouter);
```

(placed after `app.use('/expenses', expensesRouter);`, before `app.use('/', logsRouter);`)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cue-room/api test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/orders.routes.ts apps/api/src/server.ts apps/api/src/integration-tests/api.integration.test.ts
git commit -m "feat(api): add bounded GET /orders?startUtc=&endUtc= endpoint"
```

---

### Task 4: Switch web's `useSessions` to the bounded endpoint

**Files:**
- Modify: `apps/web/src/lib/hooks/useSessions.ts`

**Interfaces:**
- Consumes: `apiFetch` (`apps/web/src/lib/api/client.ts`), `useAuth` (`apps/web/src/lib/auth/useAuth.ts`), `Session` type (`@/lib/shared`), the `GET /sessions?date=` endpoint from Task 1.
- Produces: `useSessions(date: string) => { sessions: Session[], isLoading: boolean }` — same public shape as before; `DailySalesView.tsx` needs no changes.

- [ ] **Step 1: Replace the hook body**

Replace the full contents of `apps/web/src/lib/hooks/useSessions.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import type { Session } from '@/lib/shared';

// Read-only: sessions are created/edited on the desktop app -- web only
// displays them, bounded to one day via GET /sessions?date=.
export function useSessions(date: string) {
  const { state } = useAuth();

  const query = useQuery({
    queryKey: ['sessions', date],
    queryFn: () => apiFetch<Session[]>(`/sessions?date=${date}`, { accessToken: state.accessToken }),
    enabled: !!state.accessToken,
  });

  return { sessions: query.data ?? [], isLoading: query.isLoading };
}
```

- [ ] **Step 2: Verify the app still type-checks**

Run: `pnpm --filter @cue-room/web exec tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/hooks/useSessions.ts
git commit -m "refactor(web): useSessions reads from bounded GET /sessions, not the full pull"
```

---

### Task 5: Switch web's `useExpenses` to the bounded endpoint

**Files:**
- Modify: `apps/web/src/lib/hooks/useExpenses.ts`

**Interfaces:**
- Consumes: `apiFetch`, `useAuth`, `Expense` type (`@/lib/shared`), the `GET /expenses?date=` endpoint from Task 2.
- Produces: `useExpenses(date: string) => { expenses: Expense[], isLoading: boolean }` — same public shape; `ExpensesView.tsx` needs no changes.

- [ ] **Step 1: Replace the hook body**

Replace the full contents of `apps/web/src/lib/hooks/useExpenses.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import type { Expense } from '@/lib/shared';

// Read-only: expense entry/editing is a desktop-only workflow -- web only
// displays the day's recorded expenses, bounded via GET /expenses?date=.
export function useExpenses(date: string) {
  const { state } = useAuth();

  const query = useQuery({
    queryKey: ['expenses', date],
    queryFn: () => apiFetch<Expense[]>(`/expenses?date=${date}`, { accessToken: state.accessToken }),
    enabled: !!state.accessToken,
  });

  return { expenses: query.data ?? [], isLoading: query.isLoading };
}
```

- [ ] **Step 2: Verify the app still type-checks**

Run: `pnpm --filter @cue-room/web exec tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/hooks/useExpenses.ts
git commit -m "refactor(web): useExpenses reads from bounded GET /expenses, not the full pull"
```

---

### Task 6: Date-scope Cafe's Orders tab

**Files:**
- Modify: `apps/web/src/components/views/CafeView.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useAuth`, `localDateRangeToUtc`, `todayStr` (`@/lib/shared`), `DateStepper` (`@/components/layout/DateStepper`), `OrderRow`/`OrderItemRow` types (already exported from `apps/web/src/lib/hooks/usePullData.ts`), the `GET /orders?startUtc=&endUtc=` endpoint from Task 3.
- Produces: `CafeView` now owns `date`/`setDate` state and renders `DateStepper` above the tab content when the Orders tab is active. `OrdersTable` takes a `date: string` prop instead of reading unbounded data.

- [ ] **Step 1: Replace the full file contents**

Replace `apps/web/src/components/views/CafeView.tsx` in full:

```tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, localDateRangeToUtc, todayStr } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import { usePullData, type OrderRow, type OrderItemRow } from '@/lib/hooks/usePullData';
import DateStepper from '@/components/layout/DateStepper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Read-only, like the rest of web's dashboard views. Products & Stock still
// reads the full catalog via /sync/pull (no date dimension applies to a
// product catalog); Orders is bounded to one day via GET /orders, since an
// order list otherwise grows unbounded forever (see the design doc).
export default function CafeView() {
  const [tab, setTab] = useState<'products' | 'orders'>('products');
  const [date, setDate] = useState(todayStr());

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <Button type="button" variant={tab === 'products' ? 'default' : 'outline'} size="sm" onClick={() => setTab('products')}>
          Products & Stock
        </Button>
        <Button type="button" variant={tab === 'orders' ? 'default' : 'outline'} size="sm" onClick={() => setTab('orders')}>
          Orders
        </Button>
      </div>
      {tab === 'orders' && <DateStepper date={date} onDateChange={setDate} />}
      {tab === 'products' ? <ProductsTable /> : <OrdersTable date={date} />}
    </div>
  );
}

function ProductsTable() {
  const query = usePullData();

  const rows = useMemo(() => {
    if (!query.data) return [];
    const categoryName = new Map(query.data.productCategories.map(c => [c.id, c.name]));
    return query.data.products
      .filter(p => !p.deletedAt)
      .map(p => ({ ...p, categoryName: categoryName.get(p.categoryId) ?? 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Products & Stock</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {query.isLoading ? (
          <p className="px-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No products yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-muted-foreground">{p.categoryName}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{formatCurrency(p.price)}</TableCell>
                  <TableCell className={p.stockQty <= p.lowStockThreshold ? 'font-medium text-destructive' : undefined}>
                    {p.stockQty}
                  </TableCell>
                  <TableCell>{p.active ? 'Active' : 'Inactive'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function useOrdersForDate(date: string) {
  const { state } = useAuth();
  const { startUtc, endUtc } = localDateRangeToUtc(date, date);

  return useQuery({
    queryKey: ['orders', date],
    queryFn: () =>
      apiFetch<{ orders: OrderRow[]; orderItems: OrderItemRow[] }>(
        `/orders?startUtc=${encodeURIComponent(startUtc)}&endUtc=${encodeURIComponent(endUtc)}`,
        { accessToken: state.accessToken },
      ),
    enabled: !!state.accessToken,
  });
}

function OrdersTable({ date }: { date: string }) {
  const query = useOrdersForDate(date);

  const rows = useMemo(() => {
    if (!query.data) return [];
    const itemCount = new Map<string, number>();
    for (const item of query.data.orderItems) {
      itemCount.set(item.orderId, (itemCount.get(item.orderId) ?? 0) + item.qty);
    }
    return query.data.orders
      .filter(o => !o.deletedAt)
      .map(o => ({ ...o, items: itemCount.get(o.id) ?? 0 }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [query.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {query.isLoading ? (
          <p className="px-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No orders for this day.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(o.updatedAt)}</TableCell>
                  <TableCell>{o.method}</TableCell>
                  <TableCell>{o.items}</TableCell>
                  <TableCell>{formatCurrency(o.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the app still type-checks**

Run: `pnpm --filter @cue-room/web exec tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/views/CafeView.tsx
git commit -m "feat(web): date-scope Cafe's Orders tab via bounded GET /orders"
```

---

### Task 7: e2e coverage for the new bounded reads

**Files:**
- Create: `apps/web/e2e/specs/02-bounded-reads.spec.ts`

**Interfaces:**
- Consumes: `login` (`apps/web/e2e/helpers.ts`), the real running api (`http://localhost:4000`, started by `apps/web/e2e/global-setup.ts`) and web dev server.

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/specs/02-bounded-reads.spec.ts`:

```ts
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
```

- [ ] **Step 2: Build the api (required by global-setup) and run the spec**

Run: `pnpm --filter @cue-room/api build && pnpm --filter @cue-room/web exec playwright test e2e/specs/02-bounded-reads.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/specs/02-bounded-reads.spec.ts
git commit -m "test(e2e): cover web's bounded day-scoped reads for sessions/expenses/orders"
```

---

### Task 8: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the api unit suite**

Run: `pnpm --filter @cue-room/api test`
Expected: all existing tests still pass (no regressions from the new route files).

- [ ] **Step 2: Run the api integration suite**

Run: `pnpm --filter @cue-room/api test:integration`
Expected: all tests pass, including the three new endpoint tests from Tasks 1-3.

- [ ] **Step 3: Type-check web**

Run: `pnpm --filter @cue-room/web exec tsc -b`
Expected: no errors.

- [ ] **Step 4: Run the full web e2e suite**

Run: `pnpm --filter @cue-room/web exec playwright test`
Expected: all specs pass, including `01-auth.spec.ts`, `02-bounded-reads.spec.ts` (new), and `06-rbac.spec.ts`.

- [ ] **Step 5: Sanity-check desktop is unaffected**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors (this plan touches no desktop files, but desktop imports nothing from `apps/web`, so this should already be a no-op check).

- [ ] **Step 6: Final commit if anything was missed**

```bash
git status --short
```

If clean, this sub-project is done. If anything is uncommitted, commit it with a message describing what was missed.
