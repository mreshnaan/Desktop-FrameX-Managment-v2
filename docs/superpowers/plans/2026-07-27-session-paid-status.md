# Session Pending Payment + Customer Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Session.method` becomes nullable with no default at creation (shows
"Select payment" until chosen, a new "Pending" total appears in Daily/Monthly Sales).
Separately, Daily Sales' Credit-customer picker becomes a searchable combobox with an
inline "+ Add customer" option. No `paidAt`, no auto-set timestamp logic — deliberately
minimal.

**Architecture:** Six sequential tasks. Tasks 1-5 are the nullable-`method` change
(SQLite/Rust core, sync engine, Postgres/API, shared schema + Daily Sales UI, Monthly
Sales reporting). Task 6 is the independent customer-combobox feature, built last
since it touches the same view file as Task 4 but is otherwise unrelated.

**Tech Stack:** Rust, sqlx, SQLite, Prisma, PostgreSQL, TypeScript, React, zod,
shadcn/ui (`cmdk`, Radix Popover — new dependencies for Task 6 only).

## Global Constraints

- Order/`orders`, `Order` struct, `OrderRow`, cafe checkout — **all untouched**. Do
  not touch anything Order-related.
- No `paidAt` field, no auto-set-timestamp logic, no business rule beyond "the column
  can be empty." This was deliberately simplified from an earlier, larger version of
  this design — do not reintroduce it.
- `method` semantics: `null` = not yet decided (new session default); `'Cash'` /
  `'Card'` / `'Credit'` = staff picked one, behaves exactly as it already does today
  (Credit still requires a customer; no other behavior changes).
- SQLite has no `ALTER COLUMN` — relaxing `sessions.method`'s `NOT NULL CHECK`
  requires a rebuild-the-table migration. No other table references `sessions(id)` as
  a foreign key, so no `PRAGMA foreign_keys` toggling is needed.
- Task 6's combobox is scoped to `DailySalesView.tsx`'s session customer picker only.
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

### Task 4: Shared zod schema + `commands.ts` + Daily Sales UI (both apps)

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

### Task 5: Monthly Sales reporting — nullable method flows through

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/reports/sales.rs`
- Modify: `apps/desktop/src/lib/tauri/commands.ts` (the `DailyCategoryTotal` interface)
- Modify: `apps/desktop/src/components/views/MonthlySalesView.tsx`
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

This file declares its own local `DailyCategoryTotal`-shaped interface and
`CategoryDayRow` type (not importing the one from `commands.ts` — confirm during
implementation). Add a `Pending` field to `CategoryDayRow`:

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

- [ ] **Step 4: Apply the identical change to `apps/web/src/components/views/MonthlySalesView.tsx`**

Same `CategoryDayRow` addition, same grouping-loop change, same column addition —
this file mirrors the desktop one exactly (confirmed in earlier sub-projects).

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`, `pnpm --filter @cue-room/web exec
tsc -b`, and `cargo check` (from `apps/desktop/src-tauri`)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/reports/sales.rs apps/desktop/src/lib/tauri/commands.ts apps/desktop/src/components/views/MonthlySalesView.tsx apps/web/src/components/views/MonthlySalesView.tsx
git commit -m "feat(desktop,web): surface a Pending column in Monthly Sales' category view"
```

---

### Task 6: Searchable customer combobox with inline "+ Add customer"

**Files:**
- Create: `apps/desktop/src/components/ui/popover.tsx` (shadcn primitive)
- Create: `apps/desktop/src/components/ui/command.tsx` (shadcn primitive)
- Create: `apps/desktop/src/components/CustomerCombobox.tsx`
- Modify: `apps/desktop/src/components/views/DailySalesView.tsx`
- Modify: `apps/desktop/package.json` (new dependencies)

**Interfaces:**
- Consumes: `useCustomers()` (already `addCustomer: UseMutationResult<Customer,
  Error, {name, phone?}>` per sub-project 5).
- Produces: `CustomerCombobox({ customers, value, onChange }: { customers:
  Customer[]; value: string | null; onChange: (id: string | null) => void })` — a
  drop-in replacement for the existing customer `<Select>` in
  `DailySalesView.tsx`'s `SessionRow`.

- [ ] **Step 1: Add the shadcn primitives**

Run (from `apps/desktop`): `pnpm dlx shadcn@latest add popover command`
Expected: creates `src/components/ui/popover.tsx` and `src/components/ui/command.tsx`,
adds `@radix-ui/react-popover` and `cmdk` to `package.json` dependencies. If the CLI
prompts for anything, accept the defaults (matching how every other primitive in this
project was added, per the original build plan's Task 4).

- [ ] **Step 2: Create `apps/desktop/src/components/CustomerCombobox.tsx`**

```tsx
import { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const { addCustomer } = useCustomers();

  const selected = customers.find(c => c.id === value);

  async function submitNewCustomer() {
    if (!newName.trim()) return;
    const created = await addCustomer.mutateAsync({ name: newName.trim(), phone: newPhone.trim() || undefined });
    onChange(created.id);
    setNewName('');
    setNewPhone('');
    setAdding(false);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setAdding(false); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Customer"
          className="w-36 justify-between font-normal"
        >
          <span className="truncate">{selected?.name ?? 'No customer'}</span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
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
          <Command>
            <CommandInput placeholder="Search customers…" />
            <CommandList>
              <CommandEmpty>No customer found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__no_customer__"
                  onSelect={() => { onChange(null); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === null ? 'opacity-100' : 'opacity-0')} />
                  No customer
                </CommandItem>
                {customers.map(c => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => { onChange(c.id); setOpen(false); }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === c.id ? 'opacity-100' : 'opacity-0')} />
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                <CommandItem value="__add_new__" onSelect={() => setAdding(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add customer
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

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
(the payment-method `<Select>` from Task 4), do not remove the `@/components/ui/select`
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
git add apps/desktop/src/components/ui/popover.tsx apps/desktop/src/components/ui/command.tsx apps/desktop/src/components/CustomerCombobox.tsx apps/desktop/src/components/views/DailySalesView.tsx apps/desktop/package.json apps/desktop/pnpm-lock.yaml
git commit -m "feat(desktop): searchable customer combobox with inline add in Daily Sales"
```

---

## Final verification (after all 6 tasks)

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
