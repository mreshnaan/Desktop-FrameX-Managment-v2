# Session pending payment + searchable customer picker — design

> Sub-project 6 of the codebase-cleanup refactor (branch `refactor/codebase-cleanup`,
> continued on `feature/session-paid-status` off `dev` after sub-projects 1-5 merged).
> This is a new feature area, raised mid-session rather than part of the original
> 5-area audit.

## Goal

Two related, small changes to Daily Sales, both scoped down after discussion:

**1. `Session.method` becomes nullable, defaulting to empty at creation.** Today,
`do_create_session` (`apps/desktop/src-tauri/src/commands/sessions.rs`) hardcodes
`method: "Cash"` the instant a session is created, before the customer has even
finished playing or paid — every session looks identical to a completed Cash sale
from the moment it exists. The fix is intentionally minimal: `method` becomes
nullable with no default, the UI shows a "Select payment" placeholder until the
cashier picks one, and daily/monthly totals gain a "Pending" bucket for sessions with
no method chosen yet. **No `paidAt` timestamp, no auto-set logic, no server-side
business rule beyond allowing the column to be empty** — that was considered and
explicitly dropped as unnecessary complexity for the problem actually being solved.

**2. The session customer picker becomes a searchable combobox with an inline "+ Add
customer" option.** Today (`DailySalesView.tsx`, the Credit-customer `<Select>`) it's
a plain flat dropdown — no filtering, and no way to add a new customer without
leaving Daily Sales, going to the Customers view, adding them, and coming back. This
is a real friction point for cashiers handling a walk-in customer mid-session.

**Order is explicitly out of scope for item 1** — a cafe order is only ever created
once a method is already chosen (`CafeView.tsx`'s "Complete sale" stays disabled until
then), so there's no equivalent "created but undecided" gap for orders. Also
explicitly out of scope: linking a Credit payment back to specific sessions (Credit
remains one running balance per customer, unchanged).

## 1. `Session.method` — nullable, no default

**Data model:**
- **SQLite**: new migration relaxes `sessions.method`'s `NOT NULL CHECK` constraint to
  allow `NULL` (SQLite has no `ALTER COLUMN`, so this needs a rebuild-the-table
  migration — copy data into a new table with the relaxed schema, drop the old one,
  rename; no other table references `sessions(id)` as a foreign key, so no `PRAGMA
  foreign_keys` toggling is needed).
- **Postgres**: `Session.method` changes from `Method` to `Method?` in
  `apps/api/prisma/schema.prisma`; new Prisma migration.
- **Rust**: `Session.method` in `models.rs` changes from `String` to `Option<String>`.
- **Shared zod schemas** (both apps' `session.schema.ts`): `method:
  z.enum(['Cash', 'Card', 'Credit'])` becomes `.nullable()`. The existing
  `checkCreditCustomer` refine (`data.method !== 'Credit' || !!data.customerId`) is
  unaffected — `null !== 'Credit'` is already `true`.
- **`do_create_session`**: starts new sessions with `method: None` (removing the
  hardcoded `"Cash"` default) — nothing else about session creation changes.
- **`do_update_session`/`SessionPatch`**: `SessionPatch.method` becomes `Option<Option<String>>`
  (same nested-Option shape already used by `SessionPatch.customer_id` in this file —
  outer `None` = patch doesn't touch method, `Some(None)` = clear it back to pending,
  `Some(Some(x))` = set it to `x`). No other logic changes in `do_update_session`.
- **Sync**: `session_payload`'s `method` field and `sync.rs`'s `apply_sessions` both
  already read every other nullable field (`customerId`, `deletedAt`) via
  `.as_str()` without `.unwrap_or_default()`; `method` needs the same treatment —
  binding `.unwrap_or_default()` would coerce a genuine `null` into `""`, which
  satisfies neither branch of the (updated) `CHECK` constraint and would break sync
  for every pending session.

**Frontend:**
- `DailySalesView.tsx`'s method `<Select>`: add `<SelectValue placeholder="Select
  payment" />` (matching the exact precedent already in this file for the customer
  `<Select>`, which already shows a `"No customer"` placeholder when `value` is
  `null`).
- `DailySalesView.tsx`'s `Summary`/`SummaryStrip` (both apps — web has its own copy):
  add a `Pending` field, route `s.method === null` sessions into it instead of
  crashing on `totals[s.method]`.
- `MonthlySalesView.tsx`'s category-filtered view (both apps): same treatment — a
  `Pending` field on `CategoryDayRow`, routed the same way, surfaced as a new column.
- `reports/sales.rs`'s `DailyCategoryTotal.method` changes from `String` to
  `Option<String>` (SQL `GROUP BY s.method` already produces a distinct `NULL` group
  for pending sessions; the Rust struct just needs to be able to receive it) — the
  corresponding TS interface in `commands.ts` gains `| null`.
- `CafeView.tsx` is untouched.

## 2. Searchable customer picker with inline "+ Add customer"

**Current state** (`DailySalesView.tsx`'s Credit-customer `<Select>`): a flat shadcn
`<Select>` listing every customer by name, no filtering; if there are zero customers
it shows a fallback "Add customers first" button. No search, no way to add a customer
without leaving the screen.

**New component**: a searchable combobox (shadcn's `Command`/`Popover` pattern, aka
"combobox" in shadcn's own docs — not yet used anywhere in this codebase, so this adds
the primitive) replacing the plain `<Select>`:
- Typing filters the customer list by name (client-side substring match — the
  customer list is already fully loaded via `useCustomers()`, no new query needed).
- The bottom of the list has a "+ Add customer" row. Selecting it opens a small inline
  form (name + phone, matching `CustomersView.tsx`'s existing add-customer fields)
  directly in the popover; submitting calls `useCustomers().addCustomer` (already a
  `useMutation`, per sub-project 5) and, on success, immediately selects the
  newly-created customer as this session's `customerId` — no extra click, no leaving
  Daily Sales.
- This is scoped to `DailySalesView.tsx`'s session customer picker only for this
  sub-project (the specific friction point raised). `CafeView.tsx`'s Credit-customer
  picker has the identical flat-`<Select>` limitation, but is left untouched here —
  worth the same upgrade later, as its own small follow-up once this pattern is
  proven in Daily Sales.

## Testing

- `cargo test` in `apps/desktop/src-tauri`: existing session tests updated wherever
  `method`'s type change from `String` to `Option<String>` breaks a binding; add a
  test confirming a freshly created session has `method: None`.
- `apps/api` integration tests: confirm push/pull sync round-trips a null `method`
  correctly for sessions.
- `pnpm --filter @cue-room/desktop exec tsc -b` / `pnpm --filter @cue-room/web exec
  tsc -b`: catches every place `session.method` was read as a non-nullable string.
- Full desktop e2e suite, in particular any spec touching Daily Sales, Monthly Sales,
  and cross-app sync.
- Manual check (`pnpm dev`): create a session, confirm "Select payment" placeholder
  and a "Pending" total; type a partial customer name in the picker and confirm
  filtering; use "+ Add customer" mid-session and confirm the new customer is
  selected immediately without leaving the view.
