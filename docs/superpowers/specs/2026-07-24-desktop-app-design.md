# Cue Room Desktop App — Design

**Status:** Approved for planning
**Owner context:** Follow-up to the merged `apps/web` + `apps/api` build (see `docs/superpowers/plans/2026-07-24-cue-room-pool-table-manager.md`). Desktop is now the primary focus; `apps/web` is deprioritized and will later be retrofitted to match whatever data-layer architecture desktop lands on.

## Goal

Build `apps/desktop` as a genuinely separate Tauri 2 + Rust + SQLite application — not a wrapper around `apps/web` — that gives pool-hall staff a local-first front desk app with the same UI/UX as the web app, but with a properly relational schema and bidirectional sync against the existing self-hosted `apps/api`. Unlike the FrameX reference app (local-only, no sync), desktop syncs while open; unlike `apps/web` (Dexie/IndexedDB, non-atomic outbox writes), desktop's writes are atomically transactional at the SQLite layer.

## Non-goals

- No system tray / background sync — sync only runs while the app window is open.
- No PIN-based cashier quick-switch. One JWT session per shift; switching users means logging out and back in.
- No multi-tenant support — single business, role-gated staff (OWNER/ADMIN/CASHIER), same model as `apps/api`.
- No changes to `apps/api` — desktop reuses its existing `/auth/login`, `/auth/refresh`, `/sync/push`, `/sync/pull`, `/users` endpoints unmodified.

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
      categories.rs
      stations.rs
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

Reuses `apps/api`'s existing, unmodified endpoints:

1. TS calls the Rust `drain_outbox` command, which returns all pending `outbox` rows.
2. TS `POST`s them to `/sync/push` (same `OutboxEntry[]` shape `apps/web` already sends).
3. On success, TS calls a Rust command to delete the pushed rows from `outbox`.
4. TS `GET`s `/sync/pull?since=<cursor>` (cursor read from `sync_state`).
5. TS calls a Rust `apply_pulled_rows` command with the response; Rust upserts each row only if the incoming `updated_at` is newer than the local row's (last-write-wins), then updates `sync_state`'s cursor.

Triggered by: a 30s interval timer (matching `apps/web`'s cadence) and the `window.online` event. Only runs while the app is open — no tray, no background service, per the earlier explicit decision.

**Payload mapping (reconciling desktop's relational schema with `apps/api`'s flat one).** `apps/api`'s `Session` model stores `category`/`resource` as plain strings (no FK tables), and its `Rate` model is keyed by `category` (a string), not an id — this predates desktop's schema and is unchanged. So:
- `categories` and `stations` are **local-only, not synced** — they're reference/config data, seeded on first launch from the same static list `apps/web`'s `CATEGORIES` constant uses (e.g. "8-Ball" / "Snooker" / "PlayStation" and their stations). They never appear in `outbox` and have no `updated_at`/sync columns, since nothing pushes or pulls them.
- When a `sessions` row is pushed, Rust resolves `station_id` → the station's `name` and its category's `name`, and writes the outbox payload in the same flat `{category, resource, ...}` shape `apps/web` already sends — `apps/api` never sees `station_id`/`category_id`.
- When a `rates` row is pushed, Rust resolves `category_id` → the category's `name` and uses that as the outbox entry's `id` (matching `apps/api`'s `Rate.category` primary key), same convention `apps/web` already uses.
- Pulled `sessions`/`rates` rows (flat `category`/`resource` strings from the server) are resolved back to local `station_id`/`category_id` by name lookup against the locally-seeded `categories`/`stations` tables during `apply_pulled_rows`.

This keeps `apps/api` completely unchanged while giving desktop real foreign keys locally — the flat/relational translation happens entirely in the Rust sync layer.

## Auth

- Login screen: username + password, `fetch`-based, calling `apps/api`'s `/auth/login` — same request/response shape `apps/web` now uses.
- On success, TS immediately hands the access + refresh tokens to a Rust command that stores them via the `keyring` crate (OS-native credential store: Credential Manager on Windows, Keychain on macOS, Secret Service on Linux). Tokens are never written to a JS-accessible store.
- On app launch, TS asks Rust for the stored tokens; if present, it silently attempts `/auth/refresh` before showing the login screen.
- No PIN quick-switch. One login per shift; logging out clears the keychain entry.
- RBAC: same `hasAccess(role, view)` check as `apps/web`, sourced from a local copy of `apps/api`'s `roles.ts` constants — sidebar filtering client-side, with the real enforcement remaining server-side in `apps/api`'s `requireView` middleware for anything that touches the network (sync push, user management).

## Testing strategy

- **Rust:** `cargo test` unit tests for each command module's business logic (rate calculation, outbox transaction correctness, last-write-wins merge logic) using an in-memory SQLite pool (`sqlx::SqlitePool::connect(":memory:")`).
- **TypeScript:** Vitest unit tests for hooks and the sync engine, following the same pattern already used in `apps/web` (`syncEngine.test.ts`, `useSessions.test.tsx`) — Rust commands mocked at the `invoke()` boundary.
- **View components:** not separately unit-tested, consistent with the `apps/web` plan's existing rule — UI composition coverage comes from manual verification (no Playwright-against-Tauri harness in this phase; that's a heavier investment than this plan's scope justifies).
- **Manual verification checklist** (run after implementation): click through all seven views; confirm rate-based amount auto-calc; confirm a session/expense/customer created offline queues in `outbox` and drains once online; confirm sync against the same `apps/api` instance `apps/web` uses shows changes made on the web app appearing on desktop and vice versa; confirm login/logout clears the keychain entry; confirm a CASHIER-role login hides User Management.

## Migration/versioning

SQLite schema is created and migrated via `sqlx::migrate!()` against the `migrations/` folder above, run automatically on app startup — no manual migration step for end users.

## Open follow-ups (explicitly out of scope for this spec)

- Retrofitting `apps/web` to match this relational schema/architecture — deferred until desktop is done, per your instruction.
- Any system-tray/background-sync mode — explicitly rejected for this phase.
- PIN-based quick-switch — explicitly rejected for this phase.
