# Session Pending Payment + Customer Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Session.method` becomes nullable with no default at creation (shows
"Select payment" until chosen, a new "Pending" total appears in Daily/Monthly Sales).
Separately, `Session` also gains a nullable `paidAt` timestamp column — schema-only,
with no auto-set logic and no UI to set it yet (added now, purely additive, so a
later feature can use it without another migration). Separately again, Daily Sales'
Credit-customer picker becomes a searchable combobox with an inline "+ Add customer"
option.

**Architecture:** Seven sequential tasks. Tasks 1-3 (already complete) made
`Session.method` nullable across SQLite/Rust, the sync engine, and Postgres. Task 4
(new) adds the `paidAt` column across the same layers, as a separate additive change
— it does not reopen Tasks 1-3's already-reviewed migrations/commits. Tasks 5-6 are
shared schema + Daily Sales UI + Monthly Sales reporting for the `method` change. Task
7 is the independent customer-combobox feature, built last since it touches the same
view file as Task 5 but is otherwise unrelated.

**Tech Stack:** Rust, sqlx, SQLite, Prisma, PostgreSQL, TypeScript, React, zod,
`@base-ui/react` (Task 7's combobox is built on the already-installed
`@base-ui/react/popover`, matching every other overlay component in this codebase —
no new dependency).

## Global Constraints

- Order/`orders`, `Order` struct, `OrderRow`, cafe checkout — **all untouched**. Do
  not touch anything Order-related.
- No auto-set-timestamp logic for `method` itself, no business rule beyond "the
  column can be empty." This was deliberately simplified from an earlier, larger
  version of this design. `paidAt` (Task 4) is a later, deliberately reintroduced
  exception to that simplification — but it is schema-only: no code anywhere sets it
  automatically, and no UI exposes it yet. Do not add auto-set logic or a UI trigger
  for `paidAt` unless explicitly asked.
- `method` semantics: `null` = not yet decided (new session default); `'Cash'` /
  `'Card'` / `'Credit'` = staff picked one, behaves exactly as it already does today
  (Credit still requires a customer; no other behavior changes).
- SQLite has no `ALTER COLUMN` — relaxing `sessions.method`'s `NOT NULL CHECK`
  requires a rebuild-the-table migration. No other table references `sessions(id)` as
  a foreign key, so no `PRAGMA foreign_keys` toggling is needed.
- Task 7's combobox is scoped to `DailySalesView.tsx`'s session customer picker only.
  `CafeView.tsx`'s Credit-customer picker keeps its current plain `<Select>` — that's
  a deliberate, separate follow-up, not part of this plan.
- Verify each task with the app-appropriate command (`cargo test`, `cargo check`,
  `tsc -b`) before committing.

---

### Task 1: SQLite migration + Rust `Session` model + `sessions.rs` commands

**Files:**
- Create: `apps/desktop/src-tauri/migrations/0005_session_nullable_method.sql`
- Modify: `apps/desktop/src-tauri/src/models.rs`
- Modify: `apps/desktop/src-tauri/src/commands/sessions.rs`

**Interfaces:**
- Produces: `Session.method: Option<String>`; `SessionPatch.method:
  Option<Option<String>>` (same nested-Option shape already used by
  `SessionPatch.customer_id` in this file — outer `None` = patch doesn't touch
  method, `Some(None)` = clear it back to pending, `Some(Some(x))` = set it to `x`).
  `do_create_session`/`do_update_session` keep their existing signatures.

- [ ] **Step 1: Create the migration**

`apps/desktop/src-tauri/migrations/0005_session_nullable_method.sql`:

```sql
-- method becomes nullable -- a session starts with no payment method chosen
-- (shown as "Select payment" in the UI) instead of defaulting to Cash.
-- SQLite has no ALTER COLUMN, so relaxing the NOT NULL CHECK requires
-- rebuilding the table.
CREATE TABLE sessions_new (
  id           TEXT PRIMARY KEY,
  station_id   TEXT NOT NULL REFERENCES stations(id),
  date         TEXT NOT NULL,
  start        TEXT NOT NULL DEFAULT '',
  "end"        TEXT NOT NULL DEFAULT '',
  amount       INTEGER NOT NULL DEFAULT 0,
  method       TEXT CHECK (method IS NULL OR method IN ('Cash', 'Card', 'Credit')),
  customer_id  TEXT REFERENCES customers(id),
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  created_by   TEXT,
  updated_by   TEXT,
  metadata     TEXT
);

INSERT INTO sessions_new (id, station_id, date, start, "end", amount, method, customer_id, updated_at, deleted_at, created_by, updated_by, metadata)
SELECT id, station_id, date, start, "end", amount, method, customer_id, updated_at, deleted_at, created_by, updated_by, metadata
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_date ON sessions(date);
CREATE INDEX idx_sessions_station_id ON sessions(station_id);
CREATE INDEX idx_sessions_customer_id ON sessions(customer_id);
```

- [ ] **Step 2: Update `Session` in `models.rs`**

Change:

```rust
    pub method: String,
```

to:

```rust
    pub method: Option<String>,
```

(no other field changes — `paid_at` is explicitly not part of this design).

- [ ] **Step 3: Update `session_payload`**

The `"method": s.method` line in `session_payload` needs no change — `serde_json::json!`
already serializes an `Option<String>` as either the string or JSON `null`
automatically, matching how `s.customer_id`/`s.deleted_at` (already `Option<String>`)
are handled on the same lines.

- [ ] **Step 4: Update `do_create_session`**

Replace:

```rust
        method: "Cash".to_string(),
```

with:

```rust
        method: None,
```

(inside the `Session { ... }` struct literal — no other field changes).

- [ ] **Step 5: Update `SessionPatch` and `do_update_session`**

Replace:

```rust
    pub method: Option<String>,
```

with:

```rust
    pub method: Option<Option<String>>,
```

(in the `SessionPatch` struct). The line `if let Some(v) = patch.method { existing.method = v; }`
in `do_update_session` needs no textual change — it already correctly unwraps one
level of `Option` regardless of whether the inner type is `String` or
`Option<String>`.

- [ ] **Step 6: Update the existing test for the new type**

`patching_only_the_method_does_not_recompute_the_amount` currently does:

```rust
        let updated = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { method: Some("Card".to_string()), ..Default::default() },
        )
```

Change to `SessionPatch { method: Some(Some("Card".to_string())), ..Default::default() }`.
The assertion `assert_eq!(updated.method, "Card");` becomes
`assert_eq!(updated.method, Some("Card".to_string()));`.

- [ ] **Step 7: Add one new test**

```rust
    #[tokio::test]
    async fn a_new_session_has_no_method_chosen() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;

        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        assert_eq!(session.method, None);
    }
```

- [ ] **Step 8: Verify**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all existing tests pass with the Step 6 assertion updated, plus the new
test from Step 7 passes.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src-tauri/migrations/0005_session_nullable_method.sql apps/desktop/src-tauri/src/models.rs apps/desktop/src-tauri/src/commands/sessions.rs
git commit -m "feat(desktop): make Session.method nullable, no default at creation"
```

---

### Task 2: Sync engine — `apply_sessions` handles nullable `method`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/sync.rs`

- [ ] **Step 1: Update `apply_sessions`'s `method` bind**

Find (inside `apply_sessions`):

```rust
    .bind(row["method"].as_str().unwrap_or_default())
```

Replace with:

```rust
    .bind(row["method"].as_str())
```

This is the one substantive change. `method` is now genuinely nullable — coercing a
real `null` into `""` via `unwrap_or_default()` would violate the new `CHECK (method
IS NULL OR method IN (...))` constraint (an empty string satisfies neither branch),
causing every pending-session sync to fail. `.as_str()` alone returns `Option<&str>`,
which binds as SQL `NULL` when the JSON value is `null`, exactly as
`row["customerId"].as_str()`/`row["deletedAt"].as_str()` already do on adjacent
lines.

- [ ] **Step 2: Verify**

Run: `cd apps/desktop/src-tauri && cargo test && cargo check`
Expected: all pass, no warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/sync.rs
git commit -m "fix(desktop): sync engine binds Session.method as nullable"
```

---

### Task 3: Postgres schema + API

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: new Prisma migration (generated via `prisma migrate dev`)
- Modify: `apps/api/src/integration-tests/api.integration.test.ts` (only if an
  existing test breaks — see Step 3)

- [ ] **Step 1: Update `Session.method` in `apps/api/prisma/schema.prisma`**

Change:

```prisma
  method     Method
```

to:

```prisma
  method     Method?
```

(within the `Session` model only — `Order.method` is untouched).

- [ ] **Step 2: Generate the migration**

Run: `cd apps/api && npx prisma migrate dev --name session_nullable_method`
Expected: a new migration directory is created under `apps/api/prisma/migrations/`;
Prisma reports success against the local dev database.

- [ ] **Step 3: Check the integration test suite**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts`
Expected: run first to see if anything fails. If a session fixture/assertion assumes
`method` is always a defined string, update that specific assertion only — do not add
new integration tests here (Task 1's Rust tests are this feature's primary coverage).

- [ ] **Step 4: Verify**

Run: `cd apps/api && npx vitest run`
Expected: all pass, unaffected (unit tests don't fixture session rows directly).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): make Session.method nullable"
```

(Include the integration test file too if Step 3 required a fix.)

---

### Task 4: Add a nullable `paidAt` timestamp to Session (schema-only, no auto-set logic, no UI)

This is a separate, additive change from Tasks 1-3 (already complete, reviewed, and
committed) — it does not edit `0005_session_nullable_method.sql` or reopen any
already-applied migration. `paidAt` is added purely so the column exists for a future
feature; nothing in this task sets it automatically, and no UI reads or writes it.
Follows the exact same plumbing pattern the existing `metadata` column already uses
in this file (added independently, in its own migration, well after the original
schema).

**Files:**
- Create: `apps/desktop/src-tauri/migrations/0006_session_paid_at.sql`
- Modify: `apps/desktop/src-tauri/src/models.rs`
- Modify: `apps/desktop/src-tauri/src/commands/sessions.rs`
- Modify: `apps/desktop/src-tauri/src/commands/sync.rs` (`apply_sessions`)
- Modify: `apps/api/prisma/schema.prisma`
- Create: new Prisma migration (generated via `prisma migrate dev`)
- Modify: `apps/desktop/src/lib/shared/schemas/session.schema.ts`
- Modify: `apps/web/src/lib/shared/schemas/session.schema.ts`
- Modify: `apps/desktop/src/lib/tauri/commands.ts` (`SessionPatch`)

**Interfaces:**
- Produces: `Session.paid_at: Option<String>` (Rust), `Session.paidAt: DateTime?`
  (Postgres), `paidAt: string | null | undefined` (zod, both apps).
  `SessionPatch.paid_at: Option<Option<String>>` (same nested-Option shape as
  `method`/`customer_id` in this file) so the field is settable through the existing
  patch mechanism even though no UI calls it yet.

- [ ] **Step 1: Create the SQLite migration**

`apps/desktop/src-tauri/migrations/0006_session_paid_at.sql`:

```sql
-- Nullable timestamp for when a session's payment was actually settled.
-- Purely additive (no rebuild needed, unlike 0005 -- adding a nullable
-- column needs no constraint change). No code sets this automatically and
-- no UI exposes it yet -- it exists so a later feature can use it without
-- another migration.
ALTER TABLE sessions ADD COLUMN paid_at TEXT;
```

- [ ] **Step 2: Update `Session` in `models.rs`**

Add a new field after `metadata`:

```rust
    pub metadata: Option<String>,
    pub paid_at: Option<String>,
```

- [ ] **Step 3: Update the three read queries and `do_update_session`'s internal SELECT in `sessions.rs`**

Four SQL strings in this file list the same columns
(`do_list_all_sessions`, `do_list_sessions_between`, `do_list_sessions_for_date`, and
the `SELECT` inside `do_update_session`). In all four, replace:

```
SELECT id, station_id, date, start, "end", amount, method, customer_id, updated_at, deleted_at, metadata
```

with:

```
SELECT id, station_id, date, start, "end", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at
```

- [ ] **Step 4: Update `session_payload`**

Add a `"paidAt"` field:

```rust
        "metadata": s.metadata.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
        "paidAt": s.paid_at,
```

(`paid_at` is a plain ISO datetime string or `None`, unlike `metadata` — no JSON
decoding needed, same treatment as `deleted_at` on the line above it.)

- [ ] **Step 5: Update `do_create_session`'s `Session` struct literal and its `INSERT`**

Add `paid_at: None,` to the struct literal (after `metadata,`). Update the `INSERT`:

Replace:

```rust
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
```

with:

```rust
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, created_by, updated_by, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)",
```

(`deleted_at` and `paid_at` are both hardcoded `NULL` literals here, matching each
other — a brand-new session has neither.) No new `.bind(...)` call is needed since
neither placeholder is a `?`.

- [ ] **Step 6: Update `SessionPatch` and `do_update_session`**

Add a field to `SessionPatch`:

```rust
    pub paid_at: Option<Option<String>>,
```

Add the same one-line unwrap already used for `method`/`customer_id`, right after
them:

```rust
    if let Some(v) = patch.paid_at { existing.paid_at = v; }
```

Update the `UPDATE` statement:

Replace:

```rust
        "UPDATE sessions SET start = ?, \"end\" = ?, amount = ?, method = ?, customer_id = ?, updated_at = ?, updated_by = ?, metadata = ? WHERE id = ?",
    )
    .bind(&existing.start)
    .bind(&existing.end)
    .bind(existing.amount)
    .bind(&existing.method)
    .bind(&existing.customer_id)
    .bind(&existing.updated_at)
    .bind(&actor)
    .bind(&existing.metadata)
    .bind(&id)
```

with:

```rust
        "UPDATE sessions SET start = ?, \"end\" = ?, amount = ?, method = ?, customer_id = ?, updated_at = ?, updated_by = ?, metadata = ?, paid_at = ? WHERE id = ?",
    )
    .bind(&existing.start)
    .bind(&existing.end)
    .bind(existing.amount)
    .bind(&existing.method)
    .bind(&existing.customer_id)
    .bind(&existing.updated_at)
    .bind(&actor)
    .bind(&existing.metadata)
    .bind(&existing.paid_at)
    .bind(&id)
```

- [ ] **Step 7: Update `apply_sessions` in `sync.rs`**

Replace:

```rust
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET station_id = excluded.station_id, date = excluded.date,
           start = excluded.start, \"end\" = excluded.\"end\", amount = excluded.amount,
           method = excluded.method, customer_id = excluded.customer_id,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, metadata = excluded.metadata",
    )
    .bind(id)
    .bind(row["stationId"].as_str().unwrap_or_default())
    .bind(row["date"].as_str().unwrap_or_default())
    .bind(row["start"].as_str().unwrap_or_default())
    .bind(row["end"].as_str().unwrap_or_default())
    .bind(row["amount"].as_i64().unwrap_or(0))
    .bind(row["method"].as_str())
    .bind(row["customerId"].as_str())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .bind(metadata)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

with:

```rust
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET station_id = excluded.station_id, date = excluded.date,
           start = excluded.start, \"end\" = excluded.\"end\", amount = excluded.amount,
           method = excluded.method, customer_id = excluded.customer_id,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, metadata = excluded.metadata,
           paid_at = excluded.paid_at",
    )
    .bind(id)
    .bind(row["stationId"].as_str().unwrap_or_default())
    .bind(row["date"].as_str().unwrap_or_default())
    .bind(row["start"].as_str().unwrap_or_default())
    .bind(row["end"].as_str().unwrap_or_default())
    .bind(row["amount"].as_i64().unwrap_or(0))
    .bind(row["method"].as_str())
    .bind(row["customerId"].as_str())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .bind(metadata)
    .bind(row["paidAt"].as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

- [ ] **Step 8: Add two new tests to `sessions.rs`**

```rust
    #[tokio::test]
    async fn a_new_session_has_no_paid_at() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;

        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        assert_eq!(session.paid_at, None);
    }

    #[tokio::test]
    async fn paid_at_can_be_set_and_cleared_through_a_patch() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        let paid = do_update_session(
            &pool,
            session.id.clone(),
            SessionPatch { paid_at: Some(Some("2026-07-25T10:00:00Z".to_string())), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(paid.paid_at, Some("2026-07-25T10:00:00Z".to_string()));

        let cleared = do_update_session(
            &pool,
            session.id,
            SessionPatch { paid_at: Some(None), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(cleared.paid_at, None);
    }
```

- [ ] **Step 9: Verify**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all existing tests pass, plus the two new tests from Step 8.

- [ ] **Step 10: Update Postgres schema**

In `apps/api/prisma/schema.prisma`, add a field to the `Session` model, after
`metadata`:

```prisma
  metadata   Json?
  paidAt     DateTime?
```

- [ ] **Step 11: Generate the migration**

Run: `cd apps/api && npx prisma migrate dev --name session_paid_at`
Expected: a new migration directory is created; Prisma reports success.

No change is needed in `apps/api/src/services/sync.service.ts` — its `sessions` case
already spreads the entire raw payload (`const base = { ...payload, ... }`) directly
into `tx.session.upsert(...)`, so a `paidAt` key present in a pushed payload flows
through automatically once the field exists in the Prisma schema.

- [ ] **Step 12: Verify**

Run: `cd apps/api && npx vitest run && npx vitest run --config vitest.integration.config.ts`
Expected: both pass, unaffected (no fixture sends `paidAt`, and Prisma allows omitting
a nullable field).

- [ ] **Step 13: Update both apps' `session.schema.ts`**

In `apps/desktop/src/lib/shared/schemas/session.schema.ts` and
`apps/web/src/lib/shared/schemas/session.schema.ts`, add a field to
`sessionBaseSchema` (after `metadata` in desktop's; web's has no `metadata` field, so
add it after `deletedAt`):

```ts
  paidAt: z.string().datetime().nullable().optional(),
```

- [ ] **Step 14: Update `apps/desktop/src/lib/tauri/commands.ts`'s `SessionPatch`**

Add a field:

```ts
  paidAt?: string | null;
```

- [ ] **Step 15: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
exec tsc -b`
Expected: no errors.

- [ ] **Step 16: Commit**

```bash
git add apps/desktop/src-tauri/migrations/0006_session_paid_at.sql apps/desktop/src-tauri/src/models.rs apps/desktop/src-tauri/src/commands/sessions.rs apps/desktop/src-tauri/src/commands/sync.rs apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/desktop/src/lib/shared/schemas/session.schema.ts apps/web/src/lib/shared/schemas/session.schema.ts apps/desktop/src/lib/tauri/commands.ts
git commit -m "feat(desktop,api): add nullable Session.paidAt column (schema-only, no auto-set logic or UI yet)"
```

---

### Task 5: Shared zod schema + `commands.ts` + Daily Sales UI (both apps)

**Files:**
- Modify: `apps/desktop/src/lib/shared/schemas/session.schema.ts`
- Modify: `apps/web/src/lib/shared/schemas/session.schema.ts`
- Modify: `apps/desktop/src/lib/tauri/commands.ts`
- Modify: `apps/desktop/src/components/views/DailySalesView.tsx`
- Modify: `apps/web/src/components/views/DailySalesView.tsx`

- [ ] **Step 1: Update `apps/desktop/src/lib/shared/schemas/session.schema.ts`**

Replace:

```ts
  method: z.enum(['Cash', 'Card', 'Credit']),
```

with:

```ts
  method: z.enum(['Cash', 'Card', 'Credit']).nullable(),
```

`checkCreditCustomer`'s explicit parameter type must widen alongside it — `z.object`'s
inferred shape for the `refine` callback will now include `method: string | null`,
which isn't assignable to the current `method: string` annotation. Replace:

```ts
const checkCreditCustomer = (data: {
  method: string;
  customerId: string | null;
}) => data.method !== 'Credit' || !!data.customerId;
```

with:

```ts
const checkCreditCustomer = (data: {
  method: string | null;
  customerId: string | null;
}) => data.method !== 'Credit' || !!data.customerId;
```

(`data.method !== 'Credit'` already handles `null` correctly with no further change —
`null !== 'Credit'` is `true`, so a pending session never trips the Credit-customer
check.)

- [ ] **Step 2: Apply the identical changes to `apps/web/src/lib/shared/schemas/session.schema.ts`**

Same two replacements (the `method` field and `checkCreditCustomer`'s parameter
type) — this file's `sessionBaseSchema`/`checkCreditCustomer` are structurally
identical to desktop's except for the `metadata` field, which is untouched here.

- [ ] **Step 3: Update `apps/desktop/src/lib/tauri/commands.ts`'s `SessionPatch`**

Replace:

```ts
  method?: string;
```

with:

```ts
  method?: string | null;
```

(within the `SessionPatch` interface).

- [ ] **Step 4: Update `apps/desktop/src/components/views/DailySalesView.tsx`'s `Summary`**

Replace:

```ts
interface Summary {
  total: number;
  Cash: number;
  Card: number;
  Credit: number;
}
```

with:

```ts
interface Summary {
  total: number;
  Cash: number;
  Card: number;
  Credit: number;
  Pending: number;
}
```

Update the cafe-side initializer (orders always have a method, so this stays 0):

```ts
    const byMethod: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0, Pending: 0 };
```

Replace the session-side `summary` computation:

```ts
  const summary = useMemo<Summary>(() => {
    const totals: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0 };
    for (const s of sessions) {
      totals.total += s.amount;
      totals[s.method] += s.amount;
    }
    // Cafe sales fold into the same Total/Cash/Card/Credit figure as sessions.
    totals.total += cafe.byMethod.total;
    totals.Cash += cafe.byMethod.Cash;
    totals.Card += cafe.byMethod.Card;
    totals.Credit += cafe.byMethod.Credit;
    return totals;
  }, [sessions, cafe]);
```

with:

```ts
  const summary = useMemo<Summary>(() => {
    const totals: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0, Pending: 0 };
    for (const s of sessions) {
      totals.total += s.amount;
      if (s.method) {
        totals[s.method] += s.amount;
      } else {
        totals.Pending += s.amount;
      }
    }
    // Cafe sales fold into the same Total/Cash/Card/Credit figure as sessions.
    totals.total += cafe.byMethod.total;
    totals.Cash += cafe.byMethod.Cash;
    totals.Card += cafe.byMethod.Card;
    totals.Credit += cafe.byMethod.Credit;
    return totals;
  }, [sessions, cafe]);
```

- [ ] **Step 5: Add "Pending" to `SummaryStrip`**

Find the `{ label, value }` array passed to `SummaryStrip` (`Total`/`Card`/`Cash`/
`Credit`) and add `{ label: 'Pending', value: summary.Pending }`.

- [ ] **Step 6: Add the "Select payment" placeholder**

Replace:

```tsx
        <Select
          value={session.method}
          onValueChange={value => commit({ method: value as Session['method'] })}
        >
          <SelectTrigger className="w-28" aria-label="Payment method">
            <SelectValue />
          </SelectTrigger>
```

with:

```tsx
        <Select
          value={session.method}
          onValueChange={value => commit({ method: value as Session['method'] })}
        >
          <SelectTrigger className="w-28" aria-label="Payment method">
            <SelectValue placeholder="Select payment" />
          </SelectTrigger>
```

- [ ] **Step 7: Apply the identical changes to `apps/web/src/components/views/DailySalesView.tsx`**

This file has its own `Summary`/`SummaryStrip` (no cafe-merging — web's Daily Sales
has no cafe/order data at all, confirmed by direct read). Replace:

```ts
interface Summary {
  total: number;
  Cash: number;
  Card: number;
  Credit: number;
}
```

with:

```ts
interface Summary {
  total: number;
  Cash: number;
  Card: number;
  Credit: number;
  Pending: number;
}
```

Replace the `summary` computation:

```ts
  const summary = useMemo<Summary>(() => {
    const totals: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0 };
    for (const s of sessions) {
      totals.total += s.amount;
      totals[s.method] += s.amount;
    }
    return totals;
  }, [sessions]);
```

with:

```ts
  const summary = useMemo<Summary>(() => {
    const totals: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0, Pending: 0 };
    for (const s of sessions) {
      totals.total += s.amount;
      if (s.method) {
        totals[s.method] += s.amount;
      } else {
        totals.Pending += s.amount;
      }
    }
    return totals;
  }, [sessions]);
```

In `SummaryStrip`, add a `Pending` entry to the `items` array:

```ts
  const items: { label: string; value: number }[] = [
    { label: 'Total', value: summary.total },
    { label: 'Card', value: summary.Card },
    { label: 'Cash', value: summary.Cash },
    { label: 'Credit', value: summary.Credit },
    { label: 'Pending', value: summary.Pending },
  ];
```

Web is read-only (no `<Select>` — it renders `session.method` as plain text in
`SessionRow`). Replace:

```tsx
      <span className="text-muted-foreground">{session.method}</span>
```

with:

```tsx
      <span className="text-muted-foreground">{session.method ?? 'Pending'}</span>
```

so a null method shows a clear label instead of rendering nothing.

- [ ] **Step 8: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, add a new session, confirm "Select payment"
shows and the row appears in "Pending" not any of Cash/Card/Credit; pick Cash,
confirm it moves to Cash.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/lib/shared/schemas/session.schema.ts apps/web/src/lib/shared/schemas/session.schema.ts apps/desktop/src/lib/tauri/commands.ts apps/desktop/src/components/views/DailySalesView.tsx apps/web/src/components/views/DailySalesView.tsx
git commit -m "feat(desktop,web): nullable Session.method in shared schema, Pending total in Daily Sales"
```

---

### Task 6: Monthly Sales reporting — nullable method flows through

**Important — the two apps' Monthly Sales views have different data sources, not
identical ones as an earlier draft of this plan assumed:** desktop's
`MonthlySalesView.tsx` calls `commands.getMonthlyReport(...)`, a Tauri invoke backed
by the Rust `reports/sales.rs` command reviewed in Steps 1-3 below. Web's
`MonthlySalesView.tsx` instead calls `apiFetch('/reports/monthly', ...)` — a
completely separate Express/Prisma route (`apps/api/src/routes/reports.routes.ts`)
that queries Postgres directly and has never touched Rust at all. Both need fixing,
but with different code (Steps 1-3 for desktop/Rust, Steps 4-5 for the API route +
web).

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/reports/sales.rs`
- Modify: `apps/desktop/src/lib/tauri/commands.ts` (the `DailyCategoryTotal` interface)
- Modify: `apps/desktop/src/components/views/MonthlySalesView.tsx`
- Modify: `apps/api/src/routes/reports.routes.ts`
- Modify: `apps/api/src/integration-tests/api.integration.test.ts` (new regression test)
- Modify: `apps/web/src/components/views/MonthlySalesView.tsx`

- [ ] **Step 1: Update `DailyCategoryTotal` in `reports/sales.rs`**

Replace:

```rust
    pub method: String,
```

with:

```rust
    pub method: Option<String>,
```

(within the `DailyCategoryTotal` struct only — `DailyExpenseTotal`/`DailyCafeTotal`
are untouched). No SQL change is needed — `GROUP BY s.date, st.category_id, s.method`
already produces a distinct group when `s.method IS NULL`, and `sqlx::FromRow` now
maps that into `None` instead of failing to deserialize.

- [ ] **Step 2: Update `DailyCategoryTotal` in `apps/desktop/src/lib/tauri/commands.ts`**

Replace:

```ts
  method: 'Cash' | 'Card' | 'Credit';
```

with:

```ts
  method: 'Cash' | 'Card' | 'Credit' | null;
```

(within the `DailyCategoryTotal` interface only).

- [ ] **Step 3: Update `apps/desktop/src/components/views/MonthlySalesView.tsx`**

This file has no locally-declared `DailyCategoryTotal`-shaped interface — its
`sessionTotals` (from `report?.sessionTotals ?? []`, where `report` comes from
`commands.getMonthlyReport(...)`) is typed via the `DailyCategoryTotal` interface
you just updated in `commands.ts` (Step 2), so no import or type change is needed
here beyond that. It does declare its own local `CategoryDayRow` interface (used only
for this file's own row-shape construction, not shared with `commands.ts`) — add a
`Pending` field to it:

```ts
interface CategoryDayRow {
  date: string;
  Cash: number;
  Card: number;
  Credit: number;
  Pending: number;
  total: number;
}
```

Update the local `DailyCategoryTotal`-equivalent interface's `method` field to allow
`null`, matching Step 2.

Replace the `categoryRows` grouping body:

```ts
    const byDate = new Map<string, { Cash: number; Card: number; Credit: number; total: number }>();
    for (const s of sessionTotals) {
      if (s.categoryId !== catId) continue;
      const entry = byDate.get(s.date) ?? { Cash: 0, Card: 0, Credit: 0, total: 0 };
      if (s.method === 'Cash' || s.method === 'Card' || s.method === 'Credit') {
        entry[s.method] += s.total;
      }
      entry.total += s.total;
      byDate.set(s.date, entry);
    }
```

with:

```ts
    const byDate = new Map<string, { Cash: number; Card: number; Credit: number; Pending: number; total: number }>();
    for (const s of sessionTotals) {
      if (s.categoryId !== catId) continue;
      const entry = byDate.get(s.date) ?? { Cash: 0, Card: 0, Credit: 0, Pending: 0, total: 0 };
      if (s.method === 'Cash' || s.method === 'Card' || s.method === 'Credit') {
        entry[s.method] += s.total;
      } else {
        entry.Pending += s.total;
      }
      entry.total += s.total;
      byDate.set(s.date, entry);
    }
```

Update the `Array.from` fallback in `categoryRows`'s final mapping step (`byDate.get(date) ?? { Cash: 0, Card: 0, Credit: 0, total: 0 }`) to include `Pending: 0`.

Add a `Pending` column to `CategoryDayRow`'s column definitions (alongside the
existing `Card`/`Cash`/`Credit`/`total` columns):
`ch.accessor('Pending', { header: 'Pending', cell: info => formatCurrency(info.getValue()) })`.

- [ ] **Step 4: Fix `apps/api/src/routes/reports.routes.ts`'s session grouping to preserve a real `null` method**

The `/monthly` route currently builds its session grouping map like this:

```ts
  const sessionMap = new Map<string, number>();
  for (const s of sessionGroup) {
    const categoryId = categoryByStationId.get(s.stationId);
    if (!categoryId) continue;
    const key = `${s.date}:${categoryId}:${s.method}`;
    sessionMap.set(key, (sessionMap.get(key) ?? 0) + (s._sum.amount ?? 0));
  }

  const sessionTotals = Array.from(sessionMap.entries()).map(([key, total]) => {
    const [date, categoryId, method] = key.split(':');
    return { date, categoryId, method, total };
  });
```

Once `Session.method` is nullable (Task 3), `s.method` can be JS `null` for a pending
session. The template literal `` `${s.date}:${categoryId}:${s.method}` `` coerces that
`null` into the four-character string `"null"`, and the later `key.split(':')`
re-derives `method` from that string — so the JSON response would send the *string*
`"null"` for a pending session's method, not real `null`. That string is truthy and
doesn't equal `'Cash'`/`'Card'`/`'Credit'`, so every downstream consumer that checks
`if (s.method === 'Cash' || ...)` would silently drop that session's amount instead of
either counting it correctly or routing it to a "Pending" bucket. Replace both blocks
with a map that carries the real `method` value alongside the sum instead of
round-tripping it through a split string:

```ts
  const sessionMap = new Map<string, { date: string; categoryId: string; method: string | null; total: number }>();
  for (const s of sessionGroup) {
    const categoryId = categoryByStationId.get(s.stationId);
    if (!categoryId) continue;
    const key = `${s.date}:${categoryId}:${s.method ?? ''}`;
    const existing = sessionMap.get(key);
    sessionMap.set(key, {
      date: s.date,
      categoryId,
      method: s.method,
      total: (existing?.total ?? 0) + (s._sum.amount ?? 0),
    });
  }

  const sessionTotals = Array.from(sessionMap.values());
```

(The key itself can still safely use `s.method ?? ''` as a grouping discriminator —
it never needs to be parsed back apart, so coercing `null` to `''` there is harmless;
only the *stored, returned* `method` value matters, and that now comes directly from
`s.method`, never from string-splitting.)

No other route in this file needs a change — `expenseGroup`/`expenseTotals` and the
`cafeMap`/`cafeTotals` logic operate on `Expense.method`/`Order.method`, both of which
remain non-nullable (confirmed: only `Session.method` changed in Task 3).

- [ ] **Step 5: Update `apps/web/src/components/views/MonthlySalesView.tsx`**

This file has its own local `DailyCategoryTotal` interface (distinct from desktop's
`commands.ts` one — this file gets its data from the API route you just fixed, not
from Tauri). Replace:

```ts
interface DailyCategoryTotal {
  date: string;
  categoryId: string;
  method: string;
  total: number;
}
```

with:

```ts
interface DailyCategoryTotal {
  date: string;
  categoryId: string;
  method: string | null;
  total: number;
}
```

Replace its local `CategoryDayRow` interface:

```ts
interface CategoryDayRow {
  date: string;
  Cash: number;
  Card: number;
  Credit: number;
  total: number;
}
```

with:

```ts
interface CategoryDayRow {
  date: string;
  Cash: number;
  Card: number;
  Credit: number;
  Pending: number;
  total: number;
}
```

Replace the `categoryRows` grouping body:

```ts
    const byDate = new Map<string, { Cash: number; Card: number; Credit: number; total: number }>();
    for (const s of sessionTotals) {
      if (s.categoryId !== catId) continue;
      const entry = byDate.get(s.date) ?? { Cash: 0, Card: 0, Credit: 0, total: 0 };
      if (s.method === 'Cash' || s.method === 'Card' || s.method === 'Credit') {
        entry[s.method as 'Cash' | 'Card' | 'Credit'] += s.total;
      }
      entry.total += s.total;
      byDate.set(s.date, entry);
    }
```

with:

```ts
    const byDate = new Map<string, { Cash: number; Card: number; Credit: number; Pending: number; total: number }>();
    for (const s of sessionTotals) {
      if (s.categoryId !== catId) continue;
      const entry = byDate.get(s.date) ?? { Cash: 0, Card: 0, Credit: 0, Pending: 0, total: 0 };
      if (s.method === 'Cash' || s.method === 'Card' || s.method === 'Credit') {
        entry[s.method as 'Cash' | 'Card' | 'Credit'] += s.total;
      } else {
        entry.Pending += s.total;
      }
      entry.total += s.total;
      byDate.set(s.date, entry);
    }
```

Update the `Array.from` fallback two lines below it (`byDate.get(date) ?? { Cash: 0,
Card: 0, Credit: 0, total: 0 }`) to include `Pending: 0`.

Add a `Pending` column to the `filter !== 'all'/'cafe'/'expenses'` branch's
`createColumnHelper<CategoryDayRow>()` column list (alongside the existing
`Card`/`Cash`/`Credit`/`total` columns):
`ch.accessor('Pending', { header: 'Pending', cell: info => formatCurrency(info.getValue()) })`.

`cafeRows`/`expensesRows` and their column definitions need no change — `Order.method`
and `Expense.method` remain non-nullable.

- [ ] **Step 6: Add a regression test for the `/reports/monthly` null-method fix**

No existing integration test covers `/reports/monthly`. Add one to
`apps/api/src/integration-tests/api.integration.test.ts`, following the exact style
of the adjacent `GET /sessions` tests (same file, same `station`/`sync/push`
pattern) — insert it right after `'a pushed session metadata payload round-trips
into the Session row'` (the test ending around line 344):

```ts
  it('GET /reports/monthly reports a pending (null-method) session as method: null, not the string "null"', async () => {
    const station = await prisma.station.findFirstOrThrow({ where: { name: 'Table 1' } });
    const sessionId = crypto.randomUUID();

    await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [{
          table: 'sessions', op: 'upsert', id: sessionId,
          payload: { id: sessionId, stationId: station.id, date: '2026-07-01', start: '10:00', end: '11:00', amount: 400, method: null, customerId: null },
          clientUpdatedAt: new Date().toISOString(),
        }],
      }),
    });

    const res = await fetch(
      `${baseUrl}/reports/monthly?startDate=2026-07-01&endDate=2026-07-01&startUtc=2026-07-01T00:00:00.000Z&endUtc=2026-07-01T23:59:59.999Z`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status).toBe(200);
    const body = await json<{ sessionTotals: { date: string; method: string | null; total: number }[] }>(res);
    const pendingRow = body.sessionTotals.find(s => s.date === '2026-07-01' && s.total === 400);
    expect(pendingRow?.method).toBeNull();

    await prisma.session.deleteMany({ where: { id: sessionId } });
  });
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`, `pnpm --filter @cue-room/web exec
tsc -b`, `cargo check` (from `apps/desktop/src-tauri`), and `cd apps/api && npx tsc
--noEmit`
Expected: no errors.

Run: `cd apps/api && npx vitest run` (unit) and `npx vitest run --config
vitest.integration.config.ts` (integration) — both must pass, including the new test
from Step 6.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/reports/sales.rs apps/desktop/src/lib/tauri/commands.ts apps/desktop/src/components/views/MonthlySalesView.tsx apps/api/src/routes/reports.routes.ts apps/api/src/integration-tests/api.integration.test.ts apps/web/src/components/views/MonthlySalesView.tsx
git commit -m "feat(desktop,web,api): surface a Pending column/value in Monthly Sales instead of dropping or stringifying null methods"
```

---

### Task 7: Searchable customer combobox with inline "+ Add customer"

**Important — this codebase does not use Radix or shadcn's default primitives.**
Every existing overlay component (`select.tsx`, `dialog.tsx`, `sheet.tsx`,
`tooltip.tsx`) is built directly on `@base-ui/react` (confirmed: `package.json`
depends on `@base-ui/react`, not any `@radix-ui/*` package, and neither `cmdk` nor
`@radix-ui/react-popover` are installed). An earlier draft of this plan assumed the
standard shadcn CLI (`pnpm dlx shadcn@latest add popover command`), which would have
installed Radix + `cmdk` — a second, inconsistent primitive library alongside Base
UI. That step is replaced below. Good news: `@base-ui/react` already ships its own
`popover` subpackage (confirmed present at
`@base-ui/react/popover` — `Root`, `Trigger`, `Portal`, `Positioner`, `Popup`,
`Backdrop`, `Close`, `Title`, `Description`, `Arrow` all exist, same shape as
`select.tsx`/`dialog.tsx` already use), so **no new dependency is needed at all**.
There is no Base UI equivalent to `cmdk`'s `Command` — the searchable list below is
a plain filtered `.map()` over `customers` with a controlled `<Input>`, not a new
primitive.

**Files:**
- Create: `apps/desktop/src/components/ui/popover.tsx` (thin wrapper over
  `@base-ui/react/popover`, following this file's own `dialog.tsx`/`select.tsx`
  pattern — no new dependency)
- Create: `apps/desktop/src/components/CustomerCombobox.tsx`
- Modify: `apps/desktop/src/components/views/DailySalesView.tsx`

**Interfaces:**
- Consumes: `useCustomers()` (already `addCustomer: UseMutationResult<Customer,
  Error, {name, phone?}>` per sub-project 5).
- Produces: `CustomerCombobox({ customers, value, onChange }: { customers:
  Customer[]; value: string | null; onChange: (id: string | null) => void })` — a
  drop-in replacement for the existing customer `<Select>` in
  `DailySalesView.tsx`'s `SessionRow`.

- [ ] **Step 1: Create `apps/desktop/src/components/ui/popover.tsx`**

```tsx
"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-72 rounded-lg bg-popover p-0 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
```

(Matches `select.tsx`'s `SelectContent` Positioner/Popup structure and className
conventions exactly — same `data-open`/`data-closed` animation classes, same
`ring-1 ring-foreground/10` popup styling. Unlike `dialog.tsx`, no `Backdrop` — a
popover shouldn't dim the whole screen, and Base UI's `Popover.Root` already closes
on outside click/Escape without one, matching how `select.tsx`'s dropdown behaves.)

- [ ] **Step 2: Create `apps/desktop/src/components/CustomerCombobox.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCustomers } from '@/lib/hooks/useCustomers';
import type { Customer } from '@/lib/shared';

interface CustomerComboboxProps {
  customers: Customer[];
  value: string | null;
  onChange: (id: string | null) => void;
}

export function CustomerCombobox({ customers, value, onChange }: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const { addCustomer } = useCustomers();

  const selected = customers.find(c => c.id === value);
  const filtered = useMemo(
    () => customers.filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase())),
    [customers, search],
  );

  function resetAndClose() {
    setAdding(false);
    setSearch('');
    setNewName('');
    setNewPhone('');
    setOpen(false);
  }

  async function submitNewCustomer() {
    if (!newName.trim()) return;
    const created = await addCustomer.mutateAsync({ name: newName.trim(), phone: newPhone.trim() || undefined });
    onChange(created.id);
    resetAndClose();
  }

  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) {
          setAdding(false);
          setSearch('');
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label="Customer"
            className="w-36 justify-between font-normal"
          />
        }
      >
        <span className="truncate">{selected?.name ?? 'No customer'}</span>
        <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        {adding ? (
          <div className="flex flex-col gap-2 p-3">
            <Input
              autoFocus
              placeholder="Customer name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              aria-label="New customer name"
            />
            <Input
              placeholder="Phone (optional)"
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              aria-label="New customer phone"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!newName.trim() || addCustomer.isPending}
                onClick={submitNewCustomer}
              >
                Add customer
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
            {addCustomer.error && <p className="text-sm text-destructive">{addCustomer.error.message}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            <Input
              autoFocus
              placeholder="Search customers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search customers"
            />
            <div className="max-h-56 overflow-y-auto">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onChange(null); resetAndClose(); }}
              >
                <Check className={cn('h-4 w-4 shrink-0', value === null ? 'opacity-100' : 'opacity-0')} />
                No customer
              </button>
              {filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => { onChange(c.id); resetAndClose(); }}
                >
                  <Check className={cn('h-4 w-4 shrink-0', value === c.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">No customer found.</p>
              )}
            </div>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-4 w-4 shrink-0" />
              Add customer
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

(`PopoverTrigger`'s `render` prop follows the exact polymorphic pattern already used
in `dialog.tsx` for `DialogPrimitive.Close render={<Button variant="outline" />}` —
the element passed to `render` becomes the actual DOM node Base UI wires its
open/close behavior onto, and this component's own children render inside it.)

- [ ] **Step 3: Wire it into `DailySalesView.tsx`'s `SessionRow`**

Replace the customer-picker block:

```tsx
        {customers.length > 0 ? (
          <Select
            value={session.customerId}
            onValueChange={value => commit({ customerId: value })}
          >
            <SelectTrigger className="w-36" aria-label="Customer">
              {/* SelectValue only resolves a display label from the registered
                  `items`/`itemToStringLabel` root props, not from SelectItem
                  children/label — since customerId (the value) differs from
                  the customer's name (the label), it must be resolved
                  explicitly here or the trigger renders the raw id. */}
              <SelectValue placeholder="No customer">
                {(value: string | null) => customers.find(c => c.id === value)?.name ?? 'No customer'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null} label="No customer">No customer</SelectItem>
              {customers.map(c => (
                <SelectItem key={c.id} value={c.id} label={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="w-36 justify-start text-muted-foreground"
          >
            Add customers first
          </Button>
        )}
```

with:

```tsx
        <CustomerCombobox
          customers={customers}
          value={session.customerId}
          onChange={value => commit({ customerId: value })}
        />
```

Add the import: `import { CustomerCombobox } from '@/components/CustomerCombobox';`.
The "zero customers" fallback button is no longer needed — the combobox's own
"Add customer" option now covers that case directly (an empty customer list simply
means the searchable list is empty and only "Add customer" shows).

Since `SelectItem`/`SelectContent`/etc. may still be used elsewhere in this same file
(the payment-method `<Select>` from Task 5), do not remove the `@/components/ui/select`
import — only remove it if this was the sole remaining usage (check during
implementation).

- [ ] **Step 4: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, open a session's customer picker, confirm
typing filters the list; select "+ Add customer" (bottom item or empty-state prompt),
fill in a name, submit, and confirm the new customer is immediately selected on that
session without navigating away from Daily Sales.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/popover.tsx apps/desktop/src/components/CustomerCombobox.tsx apps/desktop/src/components/views/DailySalesView.tsx
git commit -m "feat(desktop): searchable customer combobox with inline add in Daily Sales"
```

---

## Final verification (after all 7 tasks)

- [ ] `cargo test` in `apps/desktop/src-tauri` — full suite green.
- [ ] `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
  exec tsc -b` — both clean.
- [ ] `cd apps/api && npx vitest run && npx vitest run --config vitest.integration.config.ts` — both green.
- [ ] Full desktop e2e suite, in particular any spec touching Daily Sales, Monthly
  Sales, Customers, and cross-app sync (a pending session with `method: null` must
  survive a full desktop→Postgres→web round trip).
- [ ] Manual end-to-end check (`pnpm dev` on both apps): create a session on desktop
  (confirm "Select payment" + Pending total), settle it as Cash (confirm it moves to
  Cash), add a brand-new customer via the combobox mid-session and confirm it's
  usable immediately, then confirm the session and the new customer both sync
  correctly to web.
