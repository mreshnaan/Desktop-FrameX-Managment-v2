# Hooks + types cleanup — design

> Sub-project 2 of the codebase-cleanup refactor (branch `refactor/codebase-cleanup`).
> Sub-project 1 (web's bounded day-scoped reads) is complete. The remaining two areas
> (shared table/form components, Rust backend SOLID cleanup) are scoped separately.

## Goal

Remove duplicated entity-shape definitions in `apps/desktop` that already exist as
zod-inferred types in `lib/shared/schemas/`, fix a real naming inconsistency in how
desktop exposes `Rate` fields, and extract the repeated mutate-then-invalidate pattern
used by every write-capable desktop hook.

## 1. Replace hand-rolled Row types with existing shared zod types

Confirmed field-for-field identical (verified by direct comparison, not assumed):

| `apps/desktop/src/lib/tauri/commands.ts` | `apps/desktop/src/lib/shared/schemas/*.schema.ts` |
|---|---|
| `SessionRow` | `Session` |
| `ExpenseRow` | `Expense` |
| `CustomerRow` | `Customer` |
| `CreditEntryRow` | `CreditEntry` |

Each pair has the exact same fields, same types, same nullability. `SessionRow`,
`ExpenseRow`, `CustomerRow`, `CreditEntryRow` are deleted from `commands.ts`; every call
site (hooks and views importing these from `tauri/commands`) switches to importing
`Session`/`Expense`/`Customer`/`CreditEntry` from `@/lib/shared` instead.

**Explicitly not touched**: `CategoryRow`, `StationRow`, `ProductRow`, `OrderRow`,
`OrderItemRow`, `RateRow` (see below) — none of these entities has a zod schema in
`lib/shared/schemas/` today, so there is nothing to deduplicate against. Adding schemas
for them is a larger, separate undertaking (it would also mean deciding whether `apps/api`
and `apps/web` should validate against them too) and is out of scope here.

## 2. Fix the RateRow naming inconsistency

Verified across all three layers, not assumed:

- SQLite (`apps/desktop/src-tauri/migrations/0001_init.sql`): columns `hour_rate`,
  `half_rate`, `frame_rate`.
- Rust (`apps/desktop/src-tauri/src/models.rs`'s `Rate` struct, `#[serde(rename_all =
  "camelCase")]`): fields `hour_rate`/`half_rate`/`frame_rate` → serialize as
  `hourRate`/`halfRate`/`frameRate`.
- Postgres (`apps/api/prisma/schema.prisma`'s `Rate` model): columns `hour`, `half`,
  `value`.
- The project's own shared schema (`apps/desktop/src/lib/shared/schemas/rate.schema.ts`,
  `TimeRateSchema`/`FrameRateSchema`): already uses `hour`/`half`/`value` — matching
  Postgres and web, not desktop's own Tauri layer.

So `hour`/`half`/`value` is already the established canonical name in this codebase;
desktop's `RateRow` (in `commands.ts`) is the outlier, because it mirrors the Rust
struct's field names 1:1 instead of translating at the TS boundary. This is not a sync
bug — `apps/desktop/src-tauri/src/commands/rates.rs`'s `do_upsert_rate` already
constructs its outbox payload using `hour`/`half`/`value` (verified: `json!({"hour":
rate.hour_rate, "half": rate.half_rate, "value": rate.frame_rate, ...})`), so data
crossing to Postgres is already correctly named. The inconsistency is purely that
desktop's own frontend code sees one name from `list_rates`/`upsert_rate` (raw Rust
struct fields) and would see a different name from the sync wire format, if it ever read
rates that way (it doesn't today, but the inconsistency is real and confusing to anyone
reading both `useRates.ts` files side by side, which is exactly what happened during this
audit).

Fix, applied at the `apps/desktop/src/lib/tauri/commands.ts` boundary only (both
directions, so no other file ever sees the raw Rust field names):
- `RateRow`'s interface changes from `{ hourRate, halfRate, frameRate }` to `{ hour,
  half, value }`.
- `listRates()`'s wrapper maps the raw Tauri response (which still arrives as
  `hourRate`/`halfRate`/`frameRate`, since the Rust struct and its
  `#[serde(rename_all = "camelCase")]` are unchanged) into the new `RateRow` shape
  before returning it: `rows.map(r => ({ id: r.id, categoryId: r.categoryId, hour:
  r.hourRate, half: r.halfRate, value: r.frameRate, updatedAt: r.updatedAt }))`.
- `upsertRate(...)`'s JS-facing parameters become `(categoryId, hour, half, value)` to
  match; internally it still calls `invoke('upsert_rate', { categoryId, hourRate: hour,
  halfRate: half, frameRate: value })`, since Tauri's `invoke()` keys must match the
  Rust command's actual parameter names (`hour_rate`/`half_rate`/`frame_rate`,
  camelCased) — this mapping is the one place that name has to appear at all.

`apps/desktop/src/lib/hooks/useRates.ts` then needs no further change beyond the type
already matching (`setRate`'s parameter object and the two `hourRate: 0`-style default
fallbacks switch to `hour`/`half`/`value`) — its merge logic already matches web's
`useRates.ts` line-for-line once the field names align, so the two `useRates.ts` files
become mechanically comparable (not merged into one file — no shared package exists by
design — just structurally identical, which they already were except for naming).
`apps/desktop/src/components/views/RateManagementView.tsx` also reads
`row.hourRate`/`row.frameRate` directly (verified: lines 39, 99) and constructs
`{hourRate, halfRate, frameRate}` objects when submitting (lines 45-47, 105-107) — these
switch to the new field names too.

SQLite's column names and the Rust struct are **not** renamed — that's an internal
storage detail with its own migration cost for zero externally-visible benefit; only the
TS-facing boundary changes.

## 3. Extract the mutate-then-invalidate pattern

Every write-capable desktop hook repeats the same shape:

```ts
async function addX(...) {
  await commands.createX(...);
  await qc.invalidateQueries({ queryKey: ['x'] });
}
```

Confirmed present in `useCustomers.ts` (`addCustomer`, `deleteCustomer`,
`adjustCustomer`), `useExpenses.ts` (`addExpense`, `updateExpense`, `deleteExpense`),
`useSessions.ts` (`addSession`, `updateSession`, `deleteSession`), `useRates.ts`
(`setRate`), and `useOrders.ts` (`checkout`, with three separate invalidations).

Unlike `groupBy` (a pure function, extracted in sub-project 1), this pattern needs
`useQueryClient()` — itself a hook, callable only from a hook or component body — so the
extraction here is a genuine custom hook:

```ts
function useInvalidateAfter(queryKey: unknown[]) {
  const qc = useQueryClient();
  return async function runAndInvalidate<T>(action: () => Promise<T>): Promise<T> {
    const result = await action();
    await qc.invalidateQueries({ queryKey });
    return result;
  };
}
```

Each hook's mutation functions wrap their existing `commands.X(...)` call in
`runAndInvalidate(...)` instead of manually awaiting the command and then the
invalidation. `useOrders.ts`'s `checkout` invalidates three separate keys (`orders`,
`order-items`, `products`) — it gets its own small helper or three calls, whichever reads
more clearly; the implementer decides based on what's there when writing the plan's task.

## Testing

No behavior change is intended anywhere in this sub-project — it is a pure type/structure
cleanup. Verification is:

- `pnpm --filter @cue-room/desktop exec tsc -b` (catches every call site that imported
  the now-deleted `SessionRow`/`ExpenseRow`/`CustomerRow`/`CreditEntryRow`, and every
  place that read `RateRow.hourRate`/`.halfRate`/`.frameRate` instead of the new
  `.hour`/`.half`/`.value`).
- `cargo test` (unaffected — no Rust changes) and `cargo check` as a sanity check that
  nothing here touched Rust.
- Full desktop e2e suite (`apps/desktop/e2e`), especially `07-quick-session-duration.spec.ts`
  and any spec touching Rate Management, Sessions, Expenses, Customers, or Credit
  Management, since those are the views whose underlying hooks change here.
