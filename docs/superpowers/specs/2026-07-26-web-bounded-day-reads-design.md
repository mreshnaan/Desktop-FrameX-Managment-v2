# Web bounded day-scoped reads — design

> Sub-project 1 of the codebase-cleanup refactor (branch `refactor/codebase-cleanup`, off `dev`).
> The other four sub-projects (shared table/form components, hooks consolidation, types from
> zod schemas, Rust backend SOLID cleanup) are scoped separately and follow after this one.

## Goal

Stop `apps/web` from fetching its entire unbounded transaction history to render a single day's
data. Give it purpose-built, day-bounded read endpoints instead, matching the bounded-query
convention `apps/desktop` already uses via Tauri commands (`list_sessions_for_date`,
`list_orders_between`, etc.).

## Problem (confirmed by direct code inspection)

`apps/web/src/lib/hooks/usePullData.ts` calls `GET /sync/pull` with no `since` cursor and no date
bound — every call returns every session, expense, customer, credit entry, order, and order item
the business has ever created. That's the correct contract for `/sync/pull`'s real purpose
(desktop's local-first sync engine hydrating SQLite), but three web call sites use it as their only
data source for single-day views:

- `useSessions(date)` (`useSessions.ts:11`) — pulls everything, then
  `.filter(s => s.date === date)` client-side.
- `useExpenses(date)` (`useExpenses.ts:10`) — same pattern.
- `CafeView.tsx`'s `OrdersTable` (`:93-106`) — renders **every order ever placed**, unfiltered,
  unpaginated, sorted newest-first. There is no date scoping at all today, not even "today only".

This gets strictly worse as the business accumulates history — unlike a client-side memoization
gap, this is unbounded network + compute cost that grows forever.

## Design

### New API endpoints (three new route files, not piled into `reports.routes.ts`)

`reports.routes.ts` already mixes monthly aggregation with customer-balance and customer-history
logic (flagged separately for the SOLID cleanup sub-project) — these new endpoints get their own
files instead of adding a fourth responsibility there.

- `apps/api/src/routes/sessions.routes.ts` (new): `GET /sessions?date=YYYY-MM-DD` →
  `Session[]`. Prisma `findMany({ where: { date, deletedAt: null } })` — same shape as the
  existing `date` equality filters in `reports.routes.ts`'s `/monthly` handler.
- `apps/api/src/routes/expenses.routes.ts` (new): `GET /expenses?date=YYYY-MM-DD` →
  `Expense[]`. Same pattern.
- `apps/api/src/routes/orders.routes.ts` (new): `GET /orders?startUtc=&endUtc=` →
  `{ orders: OrderRow[], orderItems: OrderItemRow[] }`. Orders have no `date` column (see
  `orders.rs`'s and `reports.routes.ts`'s existing comments on this) — `updatedAt` is a UTC
  instant, so the query is bounded by `startUtc`/`endUtc` alone (`updatedAt >= startUtc AND
  updatedAt < endUtc`), no separate `date` param. The client computes these bounds via the
  existing `localDateRangeToUtc()` helper (`apps/web/src/lib/shared/utils/dates.ts`), the same
  helper and pattern `MonthlySalesView.tsx` already uses when calling `/reports/monthly`. This
  avoids reintroducing the UTC-vs-local-midnight bug fixed earlier for desktop's
  `list_orders_between`.

All three are mounted in `apps/api/src/server.ts` behind `authenticate`, matching every other
route.

### Frontend changes

- `apps/web/src/lib/hooks/useSessions.ts`: replace the `usePullData()` + client-side `.filter()`
  body with `useQuery(['sessions', date], () => apiFetch<Session[]>(`/sessions?date=${date}`))`.
  Public signature (`useSessions(date) => { sessions, isLoading }`) is unchanged, so no caller
  needs to change.
- `apps/web/src/lib/hooks/useExpenses.ts`: same change, calling `/expenses?date=`.
- `apps/web/src/components/views/CafeView.tsx`: `OrdersTable` gains a `date` prop. `CafeView`
  itself gains a `date`/`setDate` state pair and renders the existing `DateStepper` component
  above the tab buttons when the "Orders" tab is active (mirrors `DailySalesView`'s header
  layout). A new `useOrdersForDate(date)` hook (co-located in `CafeView.tsx` or a new
  `useOrders.ts` if it grows) calls `/orders?startUtc=&endUtc=`, computing the bounds via
  `localDateRangeToUtc(date, date)`; the query key stays `['orders', date]` for cache purposes
  even though the wire request only sends the UTC bounds. The existing item-count grouping
  (`Map<orderId, qty>` built from `orderItems`) stays client-side, unchanged — it's now O(one
  day's orders) instead of O(all orders ever), which is an appropriate place for a small,
  bounded client-side computation.
- **Visible behavior change**: Cafe→Orders on web currently shows every order ever placed with no
  way to scope it. After this change it shows one day at a time (default: today), navigable via
  the date stepper — consistent with how Daily Sales already works, but a real, user-visible
  change to that tab, not just internal cleanup.

### Explicitly unchanged

- `apps/web/src/lib/hooks/usePullData.ts` and `GET /sync/pull` itself: untouched. This is
  desktop's real bidirectional sync protocol (`apply_pulled_rows` hydrates local SQLite from it)
  and must keep returning full/incremental history regardless of what web reads from it.
- `useCategories`, `useRates`, and the customer roster read in `useCustomers` keep deriving from
  `usePullData()`. Categories/stations/rates are small, server-seeded reference data, and the
  customer list is bounded by roster size, not transaction volume — neither grows the way
  sessions/expenses/orders do, so pulling them via `/sync/pull` is not the same class of problem.
- `CafeView.tsx`'s `ProductsTable`: no date dimension applies to a product catalog; stays on
  `usePullData()`.

### Known follow-up, not in scope here

After this change, `GET /sync/pull`'s response body still includes the full unbounded
sessions/expenses/orders/orderItems arrays on every call from web, even though nothing on web
reads those fields anymore. Trimming `/sync/pull`'s payload (e.g. an opt-in `?tables=` filter)
would touch the same endpoint desktop's real sync engine depends on, which is a materially
riskier, separate change. Flagged here, not implemented as part of this fix.

## Testing

- `apps/api`: unit tests for each new route (valid date/bounds return the right rows, `deletedAt`
  exclusion, a missing `date` param on sessions/expenses or missing `startUtc`/`endUtc` on orders
  returns 400) — following the existing pattern in `apps/api/src/tests/`. Integration test
  additions in
  `apps/api/src/integration-tests/api.integration.test.ts` for at least one of the three routes
  against real Postgres.
- `apps/web`: no existing e2e coverage exists for `CafeView`'s Orders tab (confirmed: no spec
  file references "Orders" or "CafeView" under `apps/web/e2e/specs/`) — this change needs new
  coverage, not just non-regression of old coverage. Add a spec exercising: Orders tab shows
  today's orders by default, the date stepper navigates to a different day, and Sessions/Expenses
  views still show the correct day's data after switching from the old pull-and-filter
  implementation.
- Full sweep before considering this sub-project done: `pnpm test` (api), `pnpm test:integration`
  (api), `tsc -b` (web), and the web e2e suite.
