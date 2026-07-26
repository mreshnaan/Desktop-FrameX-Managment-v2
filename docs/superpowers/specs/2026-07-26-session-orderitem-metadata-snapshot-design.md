# Session/OrderItem `metadata` snapshot — design

## Goal

Add a nullable JSON `metadata` column to `sessions` and `order_items` (both `apps/desktop`'s
SQLite schema and `apps/api`'s Postgres/Prisma schema) that records the pricing context behind
`amount`/`unitPrice` at the moment it was computed. Reference/audit data only — nothing reads it
back, no UI, no discount field (discounts aren't an implemented feature anywhere in this codebase
today).

## Why

Today `Session.amount` and `OrderItem.unitPrice`/`lineTotal` are snapshot values with no trace of
which rate or product-price produced them (confirmed: `Session` has no FK to `Rate`, `OrderItem`
stores only `productId`). If a `Rate` or `Product.price` is edited later, historical rows are
already unaffected (this is the correct, existing behavior — see prior conversation) — but there's
currently no way to tell, after the fact, *what rate/price was actually used*. `metadata` closes
that gap for future debugging/reporting without changing any live calculation.

## Schema changes

- **Desktop SQLite** (`apps/desktop/src-tauri/migrations/0003_metadata.sql`, new migration file):
  ```sql
  ALTER TABLE sessions ADD COLUMN metadata TEXT;
  ALTER TABLE order_items ADD COLUMN metadata TEXT;
  ```
  Nullable, stores a JSON-encoded string (SQLite has no native JSON type).
- **API Postgres** (`apps/api/prisma/schema.prisma`): add `metadata Json?` to the `Session` model
  (after `deletedAt`, `schema.prisma:187`) and to `OrderItem` (after `updatedAt`,
  `schema.prisma:330` area). Generate the Prisma migration (`prisma migrate dev`).
- Existing rows: left `NULL`. No backfill — we don't have reliable historical rate context for
  rows that predate this column.

## What gets written, and when

### Session

Written at the exact point `amount` is computed — never recomputed independently of `amount`:

- **Frame billing**, `do_create_session` (`apps/desktop/src-tauri/src/commands/sessions.rs:87-97`):
  right after the `frame_rate` lookup, set
  `metadata = {"billingType":"frame","rateValue":<frame_rate>}`.
- **Time billing**, `do_update_session`, inside the `time_patched` recompute branch
  (`sessions.rs:194-203`): right after `calc_time_amount` runs, set
  `metadata = {"billingType":"time","hourRate":<hour_rate>,"halfRate":<half_rate>}`.
- Time-billed sessions have no `amount` (and thus no `metadata`) until the first `start`/`end`
  edit, matching current behavior where `amount` itself starts at `0` for time billing.
- `session_payload()` (`sessions.rs:71-78`) gains a `"metadata"` key so it flows through the
  outbox to the API sync (see below).

### Cafe OrderItem

`OrderItem` only stores `productId`, and `Product.name`/`category`/`price` can all change later —
so the snapshot captures what was true about the product at sale time, not just the price already
stored in `unitPrice`:

- `do_create_order` (`apps/desktop/src-tauri/src/commands/orders.rs:133-146`), same loop iteration
  that computes `line_total`: set
  `metadata = {"productName":<product.name>,"categoryId":<product.category_id>,"unitPrice":<product.price>}`.
- Order items are append-only (no update path), so this is write-once, matching `unitPrice`/
  `lineTotal`'s existing lifecycle.
- The order-item outbox payload (`orders.rs`, built alongside `oi` around line 147) gains a
  `"metadata"` key.

## Sync propagation (desktop → API)

`apps/api/src/services/sync.service.ts`'s `applyEntry()` spreads the outbox payload directly into
`tx.session.upsert(...)` / the order-items equivalent (`sync.service.ts:85-91`) — no per-field
mapping list to update. Adding `metadata` to the Rust payload builders plus the Prisma schema is
sufficient; no changes needed in `sync.service.ts` itself.

## Type updates (no behavior change)

- `apps/desktop/src-tauri/src/models.rs` (or wherever `Session`/`OrderItem` structs live): add
  `pub metadata: Option<String>` to both, and add `metadata` to the `SELECT`/`INSERT` column lists
  in `sessions.rs` and `orders.rs`.
- `apps/desktop/src/lib/tauri/commands.ts`: add `metadata: string | null` to `SessionRow`
  (`:42-53`) and `OrderItemRow` (`:135-143`) for type-accuracy. Not read by any component.
- `apps/desktop/src/lib/shared/schemas/session.schema.ts`: add an optional `metadata` field to
  `SessionSchema` if the zod schema is strict about unknown keys (check `.strict()` usage);
  otherwise no change needed.

## Explicit non-goals

- No UI surfaces `metadata` anywhere.
- No calculation reads it back — `amount`/`unitPrice`/`lineTotal` remain authoritative and are
  computed exactly as today.
- No backfill of historical rows.
- No discount field — discounts aren't implemented anywhere in the codebase; nothing to snapshot
  yet.
- Frame-billed sessions' `amount` is still never recomputed on update (existing behavior,
  untouched) — so their `metadata` is also write-once, at creation.

## Testing

- Rust unit tests in `apps/desktop/src-tauri/src/commands/sessions.rs` and `orders.rs` (existing
  test modules, if present, or `apps/desktop/src-tauri/tests/`): assert `metadata` is populated
  with the expected JSON shape after `do_create_session` (frame case) and after
  `do_update_session` (time case), and that it's `NULL`/absent for a freshly created time-billed
  session before any edit.
- `apps/api`: extend existing sync integration test(s) covering `sessions`/`orderItems` upsert
  (`apps/api/src/integration-tests/api.integration.test.ts`) to assert a `metadata` payload key
  round-trips into the `Session`/`OrderItem` row via `applyEntry`.
- Full sweep: `cargo test` (desktop), `pnpm test` + `pnpm test:integration` (api), `tsc -b` (web/
  desktop) to confirm the new optional fields don't break existing type checks.
