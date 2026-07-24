# Cue Room Desktop App — Design

**Status:** Approved for planning
**Owner context:** Follow-up to the merged `apps/web` + `apps/api` build (see `docs/superpowers/plans/2026-07-24-cue-room-pool-table-manager.md`). Desktop is the primary focus going forward; new feature work on `apps/web` is deprioritized. The one exception is the schema retrofit below — `apps/api`'s relational-schema fix breaks `apps/web`'s sync payloads immediately, so that specific retrofit ships now, alongside `apps/api`, not deferred to "after desktop is done."

## Goal

Build `apps/desktop` as a genuinely separate Tauri 2 + Rust + SQLite application — not a wrapper around `apps/web` — that gives pool-hall staff a local-first front desk app with the same UI/UX as the web app, but with a properly relational schema and bidirectional sync against the existing self-hosted `apps/api`. Unlike the FrameX reference app (local-only, no sync), desktop syncs while open; unlike `apps/web` (Dexie/IndexedDB, non-atomic outbox writes), desktop's writes are atomically transactional at the SQLite layer.

## Non-goals

- No system tray / background sync — sync only runs while the app window is open.
- No PIN-based cashier quick-switch. One JWT session per shift; switching users means logging out and back in.
- No multi-tenant support — single business, role-gated staff (OWNER/ADMIN/CASHIER), same model as `apps/api`.
- No category/station management UI in any app (web or desktop) — they're seeded once server-side and treated as stable reference data, same as today's hardcoded list. Adding a management UI is a future follow-up, not in this scope.
- `/auth/login`, `/auth/refresh`, `/users` are reused unmodified. `/sync/push`/`/sync/pull` keep their existing request/response shape (a list of table names with rows) but gain two new tables — see "apps/api schema migration" below. This is a real, scoped change to `apps/api`, not a reuse-as-is.

## Architecture — hybrid Rust/TypeScript

**Rust owns all data access.** Every mutation is a single `sqlx` transaction that writes to the target table *and* inserts the corresponding `outbox` row in the same commit. This is the concrete correctness improvement over `apps/web`: Dexie's local write and its outbox-enqueue are two separate, non-atomic operations, so a crash between them silently drops a change from ever syncing. In SQLite via `sqlx`, both writes happen inside one transaction — a crash rolls back either both or neither.

**TypeScript owns sync orchestration.** A `setInterval` timer plus a `window.online` event listener drive periodic push/pull cycles. This logic stays in TS deliberately: timers and online/offline detection are free in a Tauri webview, and reimplementing them in native Rust (polling network state, managing a background thread) would add real complexity for no behavioral gain. TS calls into Rust only through typed Tauri commands — it never touches SQLite directly.

**Auth is a TS `fetch` call** reusing the same login flow already proven in `apps/web`'s `AuthContext` (username + password, per the auth model just shipped to `apps/api`/`apps/web`). Tokens are handed off to Rust immediately after login and stored via the OS keychain (`keyring` crate), not in any JS-accessible storage (no `localStorage`, no plain files) — this is a real security improvement desktop can make that a browser sandbox can't.

## Data layer — relational SQLite schema

```sql
categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  billing_type  TEXT NOT NULL CHECK (billing_type IN ('time', 'frame'))
);

stations (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  name         TEXT NOT NULL
);

rates (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  hour_rate    INTEGER,
  half_rate    INTEGER,
  frame_rate   INTEGER,
  updated_at   TEXT NOT NULL
);

customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

sessions (
  id           TEXT PRIMARY KEY,
  station_id   TEXT NOT NULL REFERENCES stations(id),
  date         TEXT NOT NULL,
  start        TEXT NOT NULL DEFAULT '',
  end          TEXT NOT NULL DEFAULT '',
  amount       INTEGER NOT NULL DEFAULT 0,
  method       TEXT NOT NULL CHECK (method IN ('Cash', 'Card', 'Credit')),
  customer_id  TEXT REFERENCES customers(id),  -- nullable: cash/card sessions have no customer
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

expenses (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('Cash', 'Card')),
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

credit_entries (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  date         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('CREDIT_GIVEN', 'PAYMENT_RECEIVED')),
  amount       INTEGER NOT NULL,
  updated_at   TEXT NOT NULL
);

outbox (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name         TEXT NOT NULL,
  op                 TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  entity_id          TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  client_updated_at  TEXT NOT NULL
);

sync_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
```

`sessions.customer_id` is nullable — confirmed. `categories`/`stations` are real tables with real foreign keys (unlike the current `apps/api` Postgres schema, which hardcodes categories/stations client-side with no DB backing) — this is what makes the desktop schema properly queryable (e.g., "all sessions for category X" is a join, not client-side filtering).

Soft deletes (`deleted_at`) on `customers`, `sessions`, `expenses` — same tombstone requirement as `apps/web`/`apps/api`, needed so sync can propagate deletions. `credit_entries` and `rates` stay append-only/upsert-only, no `deleted_at`, matching the existing web/api schema's rationale.

`categories`/`stations` intentionally have no `deleted_at`/soft-delete story — with no CRUD UI for them anywhere (see Non-goals), rows are only ever added by the `apps/api` seed script, never deleted by a client.

## apps/api schema migration — relational categories/stations

Today `apps/api`'s Postgres schema has no `Category`/`Station` tables at all: `Session.category`/`Session.resource` are plain strings and `Rate.category` is a bare string primary key, with the actual category/station list hardcoded client-side in `apps/web`'s `CATEGORIES` constant. That's the gap you flagged. This is now a real, scoped change to `apps/api`, not something desktop works around locally.

**Verified before writing the migration:** `Session`, `Expense`, `Customer`, `CreditEntry`, `Rate`, and `User` all have 0 rows in the live database (checked via a one-off Prisma count script). No data-preserving transform is needed — this can be a clean schema rebuild, same as the earlier username migration.

**New/changed Prisma models:**

```prisma
model Category {
  id          String   @id @default(uuid())
  name        String   @unique
  billingType String   // "time" | "frame"
  stations    Station[]
  rates       Rate?
}

model Station {
  id         String    @id @default(uuid())
  categoryId String
  category   Category  @relation(fields: [categoryId], references: [id])
  name       String
  sessions   Session[]

  @@index([categoryId])
}

model Session {
  id         String    @id @default(uuid())
  stationId  String
  station    Station   @relation(fields: [stationId], references: [id])
  date       String
  start      String
  end        String
  amount     Int
  method     Method
  customerId String?
  updatedAt  DateTime  @default(now())
  deletedAt  DateTime?

  @@index([date])
  @@index([customerId])
  @@index([stationId])
}

model Rate {
  id         String   @id @default(uuid())
  categoryId String   @unique
  category   Category @relation(fields: [categoryId], references: [id])
  hourRate   Int?
  halfRate   Int?
  frameRate  Int?
  updatedAt  DateTime @default(now())
}
```

`Session.category`/`Session.resource` (strings) are dropped in favor of `stationId`; `Rate.category` (string `@id`) is dropped in favor of `categoryId` (unique FK) plus its own generated `id`. This is the same shape as desktop's local SQLite schema — one relational model shared by both clients, no more flat-string translation layer.

**Migration steps** (hand-written, same approach as the username migration, since Prisma's non-interactive `migrate deploy` can't detect this as a rename):
1. Create `Category` and `Station` tables.
2. Add `Session.stationId` (nullable initially), drop `Session.category`/`Session.resource` (empty table, so no backfill needed).
3. Make `Session.stationId` `NOT NULL` and add the FK once the column exists.
4. Add `Rate.id`/`Rate.categoryId`, drop the old `category` string primary key, add the new UUID primary key and the unique FK constraint.
5. Apply via `prisma migrate deploy` against the live dev database, verified empty in the check above.

**Seed script** (`apps/api/prisma/seed.ts`, run once against a fresh database): inserts the same three categories and their stations that `apps/web`'s `CATEGORIES` constant currently hardcodes (8-Ball → Table 1/2/3, Snooker → Table 1, PlayStation → Station 1/2), plus one `Rate` row per category using the existing `DEFAULT_RATES` values. This is the single source of truth going forward — both `apps/web` and `apps/desktop` pull this data rather than hardcoding it.

**Sync service update** (`apps/api/src/services/sync.service.ts`): `applyPush`/`pullSince` extend from 5 tables to 7 — add `categories` and `stations` to `SyncTableName` (shared schema) and to the `switch` in `applyPush`/the `Promise.all` in `pullSince`. In practice, no client ever pushes a `categories`/`stations` outbox entry (no CRUD UI — see Non-goals), so these two are pull-only in every client, but the server-side plumbing treats them like any other syncable table for consistency and to leave room for an admin UI later.

## apps/web retrofit — required by this change, not deferred

Changing `apps/api`'s `Session`/`Rate` shape breaks `apps/web`'s current sync payloads immediately, not just once desktop exists — so this piece ships alongside the `apps/api` migration, ahead of the rest of the desktop build:

- **Dexie schema** (`apps/web/src/lib/db/dexie.ts`): add `categories`/`stations` tables (`id, categoryId` indexes), matching the new relational shape. `sessions` table's `category`/`resource` fields become `stationId`; `rates` table's `category` key becomes `id`/`categoryId`.
- **`CATEGORIES` constant retired**: `apps/web/src/lib/shared/constants/categories.ts`'s hardcoded `CATEGORIES`/`DEFAULT_RATES` are removed. Views that read them (`DailySalesView`, `RateManagementView`, `useSessions`, `useRates`) instead read from Dexie's `categories`/`stations` tables, populated by sync.
- **First-run bootstrap pull**: since categories/stations no longer ship hardcoded, a fresh install has nothing to show until it talks to the server at least once. On login, before rendering the main app shell, `apps/web` runs one blocking `GET /sync/pull` (no `since` cursor) to populate `categories`/`stations`/`rates` locally, then proceeds as normal. This avoids any risk of a client generating its own category/station UUIDs that would collide with the server's seeded ones.
- **Sync engine** (`apps/web/src/lib/sync/syncEngine.ts`): `TABLES` constant extends from 5 to 7 entries, matching the API change.
- **Zod schemas** (`apps/web/src/lib/shared/schemas/session.schema.ts`, `rate.schema.ts`): `category`/`resource` fields replaced with `stationId`; rate schema keyed by `categoryId` instead of `category`.

This is a coordinated three-way schema change (`apps/api` Postgres, `apps/web` Dexie, `apps/desktop` SQLite) landing together, not staged — `apps/web` cannot be left on the old flat shape once `apps/api` moves, since they share the same wire format.

## Rust module layout

Per-domain command modules, mirroring FrameX's `checkout.rs`/`credit.rs`/`orders.rs` pattern rather than one monolithic file:

```
apps/desktop/src-tauri/
  Cargo.toml
  tauri.conf.json
  migrations/
    0001_init.sql
  src/
    main.rs
    db.rs              # sqlx pool setup, migration runner
    auth.rs            # keyring read/write commands
    commands/
      categories.rs      # read-only: list_categories(); populated by sync pull, never by local writes
      stations.rs        # read-only: list_stations(); same as above
      rates.rs
      customers.rs
      sessions.rs
      expenses.rs
      credit_entries.rs
      sync.rs           # drain_outbox(), apply_pulled_rows()
```

Each command module exposes `#[tauri::command]` functions (e.g. `create_session`, `update_session`, `list_sessions_for_date`) that TS calls via `invoke()`. Every write command wraps its table write + outbox insert in one `sqlx::Transaction`.

## TypeScript layer

```
apps/desktop/src/
  lib/
    tauri/
      commands.ts        # typed invoke() wrappers, one per Rust command
    sync/
      syncEngine.ts       # setInterval + window.online, calls commands.ts + apps/api
    auth/
      AuthContext.tsx     # copied/adapted from apps/web, username+password login
    hooks/
      useSessions.ts       # TanStack Query wrapping commands.ts instead of Dexie
      useExpenses.ts
      useCustomers.ts
      useRates.ts
  components/
    views/                 # copied from apps/web as a starting point, per approved UI-reuse decision
      DailySalesView.tsx
      MonthlySalesView.tsx
      CustomersView.tsx
      CreditManagementView.tsx
      ExpensesView.tsx
      RateManagementView.tsx
      UserManagementView.tsx
    ui/                    # shadcn primitives, copied from apps/web
```

The hooks layer is the seam: `apps/web`'s hooks call Dexie directly, desktop's hooks call `invoke()` — the view components above them stay visually and structurally identical, satisfying "no UI/UX change from web."

## Sync protocol

Reuses `apps/api`'s `/sync/push`/`/sync/pull` endpoints (updated per the schema migration above to carry `categories`/`stations` alongside the original five tables):

1. TS calls the Rust `drain_outbox` command, which returns all pending `outbox` rows.
2. TS `POST`s them to `/sync/push` (same `OutboxEntry[]` shape `apps/web` sends — `{table, op, id, payload, clientUpdatedAt}`). In practice only `sessions`, `expenses`, `customers`, `credit_entries`, and `rates` rows ever appear here — desktop never writes to `categories`/`stations` (no CRUD UI, per Non-goals), so nothing enqueues an outbox entry for them.
3. On success, TS calls a Rust command to delete the pushed rows from `outbox`.
4. TS `GET`s `/sync/pull?since=<cursor>` (cursor read from `sync_state`) — returns all seven tables.
5. TS calls a Rust `apply_pulled_rows` command with the response; Rust upserts each row only if the incoming `updated_at` is newer than the local row's (last-write-wins), then updates `sync_state`'s cursor. `categories`/`stations` rows are simple upserts by `id` — the server's UUIDs are authoritative, and since desktop never generates its own, there is no collision case to handle.

Because `apps/api`'s `Category`/`Station`/`Session`/`Rate` models are now shaped exactly like desktop's local tables (real FKs, same field names in spirit), there is no flat-string translation layer — the payload desktop pushes/pulls is structurally the same as what it stores locally.

Triggered by: a 30s interval timer (matching `apps/web`'s cadence) and the `window.online` event. Only runs while the app is open — no tray, no background service, per the earlier explicit decision.

**First-run bootstrap.** A brand-new desktop install has empty `categories`/`stations` tables (no local seed — see Rust module layout below). On first login, before rendering the main app shell, desktop runs one blocking pull cycle (same as `apps/web`'s equivalent bootstrap) to populate `categories`/`stations`/`rates` from the server, which already has them from the `apps/api` seed script. Only after that completes does the sidebar/views render.

## Auth

- Login screen: username + password, `fetch`-based, calling `apps/api`'s `/auth/login` — same request/response shape `apps/web` now uses.
- On success, TS immediately hands the access + refresh tokens to a Rust command that stores them via the `keyring` crate (OS-native credential store: Credential Manager on Windows, Keychain on macOS, Secret Service on Linux). Tokens are never written to a JS-accessible store.
- On app launch, TS asks Rust for the stored tokens; if present, it silently attempts `/auth/refresh` before showing the login screen.
- No PIN quick-switch. One login per shift; logging out clears the keychain entry.
- RBAC: same `hasAccess(role, view)` check as `apps/web`, sourced from a local copy of `apps/api`'s `roles.ts` constants — sidebar filtering client-side, with the real enforcement remaining server-side in `apps/api`'s `requireView` middleware for anything that touches the network (sync push, user management).

## Testing strategy

- **`apps/api`:** existing Vitest suite extended — `sync.service.test.ts` gets cases for pushing/pulling `categories`/`stations`, and a new test confirming `pullSince` returns a `Session` row with its `station`/`category` relation resolvable. Migration correctness is verified manually against the live dev database (same approach as the username migration): apply, then confirm the seed script populates the expected rows.
- **`apps/web` retrofit:** existing `dexie.outbox.test.ts`/`useSessions.test.tsx`/`syncEngine.test.ts` updated for the new `stationId`/`categoryId` shape; `pnpm -r test` must stay green before desktop work begins, since this retrofit ships first.
- **Rust:** `cargo test` unit tests for each command module's business logic (rate calculation, outbox transaction correctness, last-write-wins merge logic) using an in-memory SQLite pool (`sqlx::SqlitePool::connect(":memory:")`).
- **TypeScript (desktop):** Vitest unit tests for hooks and the sync engine, following the same pattern already used in `apps/web` (`syncEngine.test.ts`, `useSessions.test.tsx`) — Rust commands mocked at the `invoke()` boundary.
- **View components:** not separately unit-tested, consistent with the `apps/web` plan's existing rule — UI composition coverage comes from manual verification (no Playwright-against-Tauri harness in this phase; that's a heavier investment than this plan's scope justifies).
- **Manual verification checklist** (run after implementation): fresh desktop install's first-run bootstrap pull populates categories/stations/rates correctly; click through all seven views; confirm rate-based amount auto-calc; confirm a session/expense/customer created offline queues in `outbox` and drains once online; confirm sync against the same `apps/api` instance `apps/web` uses shows changes made on the web app appearing on desktop and vice versa (including that both resolve the same station/category names); confirm login/logout clears the keychain entry; confirm a CASHIER-role login hides User Management.

## Migration/versioning

- **`apps/api`:** the hand-written Postgres migration (Category/Station tables, Session/Rate FK changes) plus the seed script, applied once to the dev database before any other work in this plan proceeds.
- **`apps/web`:** no local migration mechanism needed beyond Dexie's own schema versioning (`db.version(2).stores({...})`), since existing installs are pre-release / have no real user data yet.
- **`apps/desktop`:** SQLite schema is created and migrated via `sqlx::migrate!()` against the `migrations/` folder above, run automatically on app startup — no manual migration step for end users.

## Open follow-ups (explicitly out of scope for this spec)

- Any further `apps/web` feature work beyond the schema retrofit above — deprioritized until desktop is done, per your instruction.
- A category/station management UI (create/edit/delete) in either app — not planned; both apps currently treat this data as stable, server-seeded reference data.
- Any system-tray/background-sync mode — explicitly rejected for this phase.
- PIN-based quick-switch — explicitly rejected for this phase.
