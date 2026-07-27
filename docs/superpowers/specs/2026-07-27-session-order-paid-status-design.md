# Session paid status — design

> Sub-project 6 of the codebase-cleanup refactor (branch `refactor/codebase-cleanup`).
> Sub-projects 1-5 (web bounded reads, hooks+types cleanup, Rust backend SOLID cleanup,
> shared table/form components, useMutation migration) are complete. This is a new
> feature area, raised mid-session rather than part of the original 5-area audit.

## Goal

Today, a `Session`'s `method` field ('Cash' | 'Card' | 'Credit') is required and gets a
value the instant the row is created — `do_create_session`
(`apps/desktop/src-tauri/src/commands/sessions.rs`) hardcodes `method: "Cash"` before
the customer has even finished playing or paid. There is no way to represent "this
hasn't been settled yet" distinct from "this was paid in Cash" — every session looks
identical to a completed Cash sale from the moment it exists.

This sub-project adds a genuine pending state to Session: `method` becomes nullable
(no default at creation — a new session starts with no method chosen), and a new
`paidAt: string | null` timestamp is added, auto-set server-side the instant Cash or
Card is chosen. Credit stays exactly as it works today (tracked via the existing
`credit_entries` balance ledger, not this new field) — Credit is a deliberately
deferred tab, not something this sub-project marks "paid" at any point.

**Order is explicitly out of scope.** Confirmed during scoping: a cafe order is
created atomically at checkout, only once a method is already chosen —
`CafeView.tsx`'s "Complete sale" button stays disabled until a method is picked (and,
for Credit, a customer is selected), so `do_create_order` never runs with an undecided
method. There is no equivalent "created, but not yet settled" gap for orders the way
there is for sessions (which persist as an editable draft from the moment a table
starts, long before payment is decided). Making `Order.method`/a hypothetical
`Order.paidAt` nullable "for symmetry" would add real schema surface (SQLite/Postgres
migrations, Rust struct changes, sync payload changes) for a state that can never
actually occur today — exactly the kind of speculative, no-current-need addition this
codebase's conventions avoid elsewhere. If a future "open a tab, settle later" cafe
flow is ever built, it would need this same treatment then, as its own scoped change.

**Also explicitly out of scope:** linking a later Credit payment back to the specific
session(s) it settles. Credit remains one running balance per customer, not itemized —
that would require a rule for which session(s) a partial payment covers (oldest-first?
cashier picks?) and is a materially bigger feature, raised and deliberately deferred
during scoping.

## 1. Data model — `method` becomes nullable, `paidAt` is added

Three states after this change, instead of today's one-size-fits-all "always has a
method":

1. **Just created, no method chosen** — `method: null, paidAt: null`. UI shows a
   "Select payment" placeholder. Excluded from every revenue bucket (not Cash, not
   Card, not Credit) until a method is chosen.
2. **Cash or Card chosen** — `paidAt` auto-set to the server's `now()` the moment
   `method` becomes `'Cash'` or `'Card'` (if it wasn't already set — see "Auto-set
   logic" below). Counted as realized revenue, same as today.
3. **Credit chosen** — `method: 'Credit', paidAt: null`. Tracked via the existing
   `credit_entries`/customer-balance mechanism, completely unchanged.

**SQLite** (`apps/desktop/src-tauri/migrations/`): new migration relaxes
`sessions.method` to nullable (SQLite has no `ALTER COLUMN`, so this needs a
rebuild-the-table migration, same pattern as any prior column-nullability change in
this codebase — copy data into a new table with the relaxed schema, drop the old one,
rename), and adds a nullable `paid_at TEXT` column to `sessions`. `orders` is untouched
(out of scope — see above).

**Postgres** (`apps/api/prisma/schema.prisma`): `Session.method` changes from `Method`
to `Method?`; add `paidAt DateTime?`. New Prisma migration. `Order` is untouched.

**Rust** (`apps/desktop/src-tauri/src/models.rs`): `Session.method` changes from
`String` to `Option<String>`; add `paid_at: Option<String>`. `Order` is untouched.

**Shared zod schemas** (`apps/desktop/src/lib/shared/schemas/session.schema.ts`,
`apps/web/src/lib/shared/schemas/session.schema.ts`): `method:
z.enum(['Cash', 'Card', 'Credit'])` becomes `z.enum(['Cash', 'Card',
'Credit']).nullable()`; add `paidAt: z.string().datetime().nullable().optional()`. The
existing `checkCreditCustomer` refine (`data.method !== 'Credit' || !!data.customerId`)
is unaffected — `null !== 'Credit'` is already true, so a not-yet-decided session
correctly doesn't require a customer.

**Sync payload**: `session_payload` in `apps/desktop/src-tauri/src/commands/sessions.rs`
includes `method` (now possibly `null`) and the new `paidAt`; `sync.rs`'s
`apply_sessions` function reads both fields the same way it already reads every other
nullable column (`row["paidAt"].as_str()`, matching the existing
`row["deletedAt"].as_str()` pattern).

## 2. Auto-set `paidAt` logic — server-side, not trusted from the frontend

Computed in Rust (`do_create_session`/`do_update_session` in `sessions.rs`), the same
way `updated_at`/`created_by` are already stamped server-side rather than trusted from
the caller:

- If the incoming `method` is `Some("Cash")` or `Some("Card")` **and** the row's
  current `paid_at` is `None`: set `paid_at` to `now()`. (Guards against resetting the
  original payment time if a cashier corrects Cash→Card or vice versa after the fact.)
- If the incoming `method` is `Some("Credit")` or `None`: set `paid_at` to `None`
  (clearing it — covers the correction case where a cashier picks Cash by mistake,
  then fixes it to Credit).
- `do_create_session` starts new rows with `method: None, paid_at: None` — no default
  method is chosen automatically.

## 3. Frontend changes

**`DailySalesView.tsx`** (session's method `<Select>`, confirmed current code at
`:419-431`): remove the implicit default (sessions no longer arrive with `method:
"Cash"` pre-filled) and add a placeholder: `<SelectValue placeholder="Select
payment" />`, with no `SelectItem` pre-selected until the cashier picks one.

**Daily/Monthly Sales totals** (`DailySalesView.tsx`'s summary strip,
`MonthlySalesView.tsx` both apps, `reports/sales.rs`'s `do_get_monthly_report`'s
session-side query only — the cafe/expense queries are untouched): the existing
`totals[s.method] += s.amount`-style grouping (TS) and `GROUP BY s.method` (SQL) both
already produce a natural fourth bucket for `method IS NULL` with zero extra logic —
SQL `GROUP BY` treats `NULL` as its own group, and the TS grouping just needs its
`Record<string, number>` accumulator to also handle a `null` key (e.g. initialize a
`Pending` bucket alongside `Cash`/`Card`/`Credit` and route `method === null` rows into
it). This directly closes the "can staff see how much is still pending today" gap
raised during scoping — surfaced as a new "Pending" figure in the same summary strip
that already shows Cash/Card/Credit totals, not a separate screen.

**`CafeView.tsx` is untouched** — orders are out of scope (see Goal above).

## Testing

This is a genuine behavior change (unlike sub-projects 1-5's pure refactors), so
verification is broader:

- `cargo test` in `apps/desktop/src-tauri`: existing session tests must be updated
  wherever they assert a specific `method` string was defaulted (the
  `do_create_session` test suite currently has no test asserting the "Cash" default,
  since it wasn't a deliberately-tested behavior — confirm during implementation) or
  wherever `method`'s type change from `String` to `Option<String>` breaks a test's
  binding; add new tests for: a freshly created session has `method: None, paid_at:
  None`; setting method to Cash/Card sets `paid_at`; setting method to Credit or back
  to null clears `paid_at`; correcting Cash→Card doesn't reset an already-set
  `paid_at`. `orders.rs`'s test suite is unaffected.
- `apps/api` integration tests: push/pull sync round-trips a null `method` and a set
  `paidAt` correctly for sessions; existing tests asserting `method` is always present
  need updating.
- `pnpm --filter @cue-room/desktop exec tsc -b` / `pnpm --filter @cue-room/web exec
  tsc -b`: catches every place `session.method` was read as a non-nullable string.
- Full desktop e2e suite, in particular any spec touching Daily Sales, Monthly Sales,
  and cross-app sync (a null `method` and the new `paidAt` field must survive a full
  desktop→Postgres→web round trip).
- Manual check (`pnpm dev`): create a new session, confirm it shows "Select payment"
  and doesn't appear in any Cash/Card/Credit total; pick Cash, confirm it appears in
  the Cash total and a "Pending" count decreases; pick Credit, confirm it behaves
  exactly as today (customer required, balance updates, no `paidAt` set).
