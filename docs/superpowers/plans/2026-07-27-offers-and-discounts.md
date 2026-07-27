# Offers and Discounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `Offer` entity — a named, togglable-on/off promotional rule scoped to
any combination of categories (or explicitly "all categories"), with optional
day-of-week / time-of-day / date-range / minimum-duration / minimum-game-count
conditions and one of three effects (extra free time, percent off, flat amount off).
Applied to a session via a "system suggests, cashier confirms" inline prompt on Daily
Sales — never automatically.

**Architecture:** Ten sequential tasks, each an independently testable slice: (1-2)
the core `Offer` entity and its integration into `Session`'s amount computation on
desktop (Rust/SQLite), (3) the sync engine, (4) Postgres/API, (5) a new permission,
(6) shared frontend plumbing (schemas, wire types, hooks), (7) the Offers Management
views in both apps, (8) the actual Daily Sales UX (eligibility prompt + discount
display), (9) an edge-case unit test audit, (10) a comprehensive end-to-end test
suite. This order means every layer below the UI is fully built and tested before
any UI code depends on it, and both testing tasks come last so they can exercise the
complete, integrated feature rather than partial slices of it.

**Tech Stack:** Rust, sqlx, SQLite, Prisma, PostgreSQL, TypeScript, React,
react-hook-form, zod, TanStack Query.

## Global Constraints

- `Order`/cafe/`CafeView.tsx` — untouched. Bundle offers (linking a session to cafe
  products) are a separate, deferred sub-project.
- Customer-specific discount rates — not part of this plan, deferred.
- No dual billing per category (e.g. a single "Carrom" category being both
  time-billed and per-game-billed at once) — out of scope; achievable today with two
  separate categories if ever needed.
- No enforcement/rejection of bookings outside an offer's time window — offers are
  purely a discount mechanism, never a scheduling restriction.
- No aggregate "total discounts given" reporting in this plan — the discount is
  visible per-session (auditable), but no rollup view is built here.
- `Offer` has **no soft-delete** — retiring an offer means switching `active` off.
  Follow `Product`'s precedent for the active toggle (a full-object `update` call
  with `active` flipped, no dedicated toggle command) but *not* Product's unused
  `deletedAt` column — `Offer` omits it entirely, matching `Rate`'s cleaner
  no-delete-path precedent.
- `Offer`'s create/update commands take a single struct parameter (not many
  positional arguments like `Product`'s 6-param `update_product`) because `Offer` has
  ~13 fields — a deliberate, justified deviation from `Product`'s positional-args
  precedent, not an oversight.
- Every synced entity's permission-key change must be mirrored in all three copies:
  `apps/api/src/shared/constants/roles.ts` (authoritative for seeding),
  `apps/desktop/src/lib/shared/constants/roles.ts`, `apps/web/src/lib/shared/constants/roles.ts`.
  No shared package exists by design (commit `bfdff4b` removed it) — this is
  deliberate triplication, not a bug to fix.
- A new `PermissionKey` needs **no Prisma migration** for the permission row itself
  (only `Offer`'s own table needs a migration) — permission rows come from
  `apps/api/prisma/seed.ts`, which must be **manually re-run** (`cd apps/api && npm
  run seed`) against Postgres after this plan's Task 5 lands, since it is not
  triggered automatically by migrations or API startup. This is a manual operational
  step, called out explicitly in Task 5 and in Final Verification — do not try to
  automate it as part of a migration.
- Verify each task with the app-appropriate command (`cargo test`, `cargo check`,
  `tsc -b`) before committing.

---

### Task 1: SQLite migration + Rust `Offer` model + `commands/offers.rs`

**Files:**
- Create: `apps/desktop/src-tauri/migrations/0007_offers.sql`
- Modify: `apps/desktop/src-tauri/src/models.rs`
- Create: `apps/desktop/src-tauri/src/commands/offers.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `Offer` struct, `OfferInput` struct (create/update payload), `do_list_offers(pool) -> Result<Vec<Offer>, String>`, `do_create_offer(pool, input: OfferInput) -> Result<Offer, String>`, `do_update_offer(pool, id: String, input: OfferInput) -> Result<Offer, String>`, plus `#[tauri::command]` wrappers `list_offers`/`create_offer`/`update_offer`. Consumed by Task 2 (session integration needs `Offer` to look up conditions/effect) and Task 6 (frontend wiring).

- [ ] **Step 1: Create the migration**

`apps/desktop/src-tauri/migrations/0007_offers.sql`:

```sql
-- A named, togglable promotional rule. No soft-delete -- retiring an offer
-- means switching active off (see Product's active-toggle precedent; unlike
-- Product this table has no unused deleted_at column, since no delete path
-- ever exists for offers).
CREATE TABLE offers (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  active                 INTEGER NOT NULL DEFAULT 1,
  applies_to_all_categories INTEGER NOT NULL DEFAULT 0,
  category_ids           TEXT,
  days                   TEXT,
  start_time             TEXT,
  end_time               TEXT,
  start_date             TEXT,
  end_date               TEXT,
  min_duration_minutes   INTEGER,
  min_game_count         INTEGER,
  effect_type            TEXT NOT NULL CHECK (effect_type IN ('extraTime', 'percentOff', 'flatOff')),
  effect_value           INTEGER NOT NULL,
  updated_at             TEXT NOT NULL,
  created_by             TEXT,
  updated_by             TEXT
);
```

- [ ] **Step 2: Add the `Offer` struct to `models.rs`**

Add near the other entity structs (e.g. after `Product`):

```rust
#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub applies_to_all_categories: bool,
    pub category_ids: Option<String>,
    pub days: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub min_duration_minutes: Option<i64>,
    pub min_game_count: Option<i64>,
    pub effect_type: String,
    pub effect_value: i64,
    pub updated_at: String,
}
```

(`created_by`/`updated_by` are write-only audit columns, not read back into the
struct — same as `Session`/`Product` already do.)

- [ ] **Step 3: Create `apps/desktop/src-tauri/src/commands/offers.rs`**

```rust
use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Offer;
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) const OFFER_COLUMNS: &str = "id, name, active, applies_to_all_categories, category_ids, \
    days, start_time, end_time, start_date, end_date, min_duration_minutes, \
    min_game_count, effect_type, effect_value, updated_at";

pub(crate) async fn do_list_offers(pool: &SqlitePool) -> Result<Vec<Offer>, String> {
    sqlx::query_as::<_, Offer>(&format!("SELECT {OFFER_COLUMNS} FROM offers"))
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_offers(pool: State<'_, SqlitePool>) -> Result<Vec<Offer>, String> {
    do_list_offers(pool.inner()).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferInput {
    pub name: String,
    pub active: bool,
    pub applies_to_all_categories: bool,
    pub category_ids: Option<String>,
    pub days: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub min_duration_minutes: Option<i64>,
    pub min_game_count: Option<i64>,
    pub effect_type: String,
    pub effect_value: i64,
}

fn offer_payload(o: &Offer, created_by: &Option<String>, updated_by: &Option<String>) -> serde_json::Value {
    json!({
        "id": o.id, "name": o.name, "active": o.active,
        "appliesToAllCategories": o.applies_to_all_categories, "categoryIds": o.category_ids,
        "days": o.days, "startTime": o.start_time, "endTime": o.end_time,
        "startDate": o.start_date, "endDate": o.end_date,
        "minDurationMinutes": o.min_duration_minutes, "minGameCount": o.min_game_count,
        "effectType": o.effect_type, "effectValue": o.effect_value,
        "updatedAt": o.updated_at, "createdBy": created_by, "updatedBy": updated_by,
    })
}

pub(crate) async fn do_create_offer(pool: &SqlitePool, input: OfferInput) -> Result<Offer, String> {
    let offer = Offer {
        id: Uuid::new_v4().to_string(),
        name: input.name,
        active: true,
        applies_to_all_categories: input.applies_to_all_categories,
        category_ids: input.category_ids,
        days: input.days,
        start_time: input.start_time,
        end_time: input.end_time,
        start_date: input.start_date,
        end_date: input.end_date,
        min_duration_minutes: input.min_duration_minutes,
        min_game_count: input.min_game_count,
        effect_type: input.effect_type,
        effect_value: input.effect_value,
        updated_at: crate::time::now_iso(),
    };

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO offers (id, name, active, applies_to_all_categories, category_ids, \
         days, start_time, end_time, start_date, end_date, min_duration_minutes, \
         min_game_count, effect_type, effect_value, updated_at, created_by, updated_by) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&offer.id)
    .bind(&offer.name)
    .bind(offer.active)
    .bind(offer.applies_to_all_categories)
    .bind(&offer.category_ids)
    .bind(&offer.days)
    .bind(&offer.start_time)
    .bind(&offer.end_time)
    .bind(&offer.start_date)
    .bind(&offer.end_date)
    .bind(offer.min_duration_minutes)
    .bind(offer.min_game_count)
    .bind(&offer.effect_type)
    .bind(offer.effect_value)
    .bind(&offer.updated_at)
    .bind(&actor)
    .bind(&actor)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "offers", "upsert", &offer.id, &offer_payload(&offer, &actor, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(offer)
}

#[tauri::command]
pub async fn create_offer(pool: State<'_, SqlitePool>, input: OfferInput) -> Result<Offer, String> {
    do_create_offer(pool.inner(), input).await
}

// Full-object update, mirroring Product's active-toggle precedent: there is no
// dedicated "toggle active" command -- the caller always resends every field,
// including active, whether they changed it or just flipped the toggle.
pub(crate) async fn do_update_offer(pool: &SqlitePool, id: String, input: OfferInput) -> Result<Offer, String> {
    let offer = Offer {
        id: id.clone(),
        name: input.name,
        active: input.active,
        applies_to_all_categories: input.applies_to_all_categories,
        category_ids: input.category_ids,
        days: input.days,
        start_time: input.start_time,
        end_time: input.end_time,
        start_date: input.start_date,
        end_date: input.end_date,
        min_duration_minutes: input.min_duration_minutes,
        min_game_count: input.min_game_count,
        effect_type: input.effect_type,
        effect_value: input.effect_value,
        updated_at: crate::time::now_iso(),
    };

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE offers SET name = ?, active = ?, applies_to_all_categories = ?, category_ids = ?, \
         days = ?, start_time = ?, end_time = ?, start_date = ?, end_date = ?, \
         min_duration_minutes = ?, min_game_count = ?, effect_type = ?, effect_value = ?, \
         updated_at = ?, updated_by = ? WHERE id = ?",
    )
    .bind(&offer.name)
    .bind(offer.active)
    .bind(offer.applies_to_all_categories)
    .bind(&offer.category_ids)
    .bind(&offer.days)
    .bind(&offer.start_time)
    .bind(&offer.end_time)
    .bind(&offer.start_date)
    .bind(&offer.end_date)
    .bind(offer.min_duration_minutes)
    .bind(offer.min_game_count)
    .bind(&offer.effect_type)
    .bind(offer.effect_value)
    .bind(&offer.updated_at)
    .bind(&actor)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "offers", "upsert", &id, &offer_payload(&offer, &None, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(offer)
}

#[tauri::command]
pub async fn update_offer(pool: State<'_, SqlitePool>, id: String, input: OfferInput) -> Result<Offer, String> {
    do_update_offer(pool.inner(), id, input).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;

    fn sample_input(effect_type: &str, effect_value: i64) -> OfferInput {
        OfferInput {
            name: "Weekday Special".to_string(),
            active: true,
            applies_to_all_categories: false,
            category_ids: Some("cat-1".to_string()),
            days: Some("mon,tue,wed,thu,fri".to_string()),
            start_time: None,
            end_time: None,
            start_date: None,
            end_date: None,
            min_duration_minutes: Some(90),
            min_game_count: None,
            effect_type: effect_type.to_string(),
            effect_value,
        }
    }

    #[tokio::test]
    async fn creates_an_offer_active_by_default() {
        let pool = setup_test_db().await;
        let offer = do_create_offer(&pool, sample_input("extraTime", 30)).await.unwrap();
        assert!(offer.active);
        assert_eq!(offer.name, "Weekday Special");
        assert_eq!(offer.min_duration_minutes, Some(90));
    }

    #[tokio::test]
    async fn lists_created_offers() {
        let pool = setup_test_db().await;
        do_create_offer(&pool, sample_input("extraTime", 30)).await.unwrap();
        let offers = do_list_offers(&pool).await.unwrap();
        assert_eq!(offers.len(), 1);
    }

    #[tokio::test]
    async fn updating_can_toggle_active_off() {
        let pool = setup_test_db().await;
        let created = do_create_offer(&pool, sample_input("percentOff", 10)).await.unwrap();
        assert!(created.active);

        let mut input = sample_input("percentOff", 10);
        input.active = false;
        let updated = do_update_offer(&pool, created.id, input).await.unwrap();
        assert!(!updated.active);
    }
}
```

- [ ] **Step 4: Register the `offers` module**

In `apps/desktop/src-tauri/src/commands/mod.rs`, add `pub mod offers;` alongside the
other `pub mod` declarations.

- [ ] **Step 5: Register the three new Tauri commands**

In `apps/desktop/src-tauri/src/lib.rs`, find the `tauri::generate_handler![...]` macro
call and add `commands::offers::list_offers, commands::offers::create_offer,
commands::offers::update_offer,` to its argument list, matching how every other
command module's commands are registered there.

- [ ] **Step 6: Verify**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all existing tests pass, plus the 3 new tests in `offers.rs`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/migrations/0007_offers.sql apps/desktop/src-tauri/src/models.rs apps/desktop/src-tauri/src/commands/offers.rs apps/desktop/src-tauri/src/commands/mod.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add Offer entity (SQLite + Rust CRUD, no soft-delete)"
```

---

### Task 2: Session integration — effect math, `offerId`/`discountAmount`, apply/clear logic

**Files:**
- Create: `apps/desktop/src-tauri/migrations/0008_session_offer_fields.sql`
- Modify: `apps/desktop/src-tauri/src/models.rs`
- Modify: `apps/desktop/src-tauri/src/money.rs`
- Modify: `apps/desktop/src-tauri/src/commands/sessions.rs`

**Interfaces:**
- Consumes: `Offer` (Task 1).
- Produces: `Session.offer_id: Option<String>`, `Session.discount_amount: Option<i64>`;
  `SessionPatch.offer_id: Option<Option<String>>` (same nested-Option convention as
  `method`/`customer_id`/`paid_at`); `apply_offer_effect(base_amount: i64,
  duration_minutes: i64, effect_type: &str, effect_value: i64) -> (i64, i64)` in
  `money.rs` returning `(final_amount, discount_amount)`.

- [ ] **Step 1: Create the migration**

`apps/desktop/src-tauri/migrations/0008_session_offer_fields.sql`:

```sql
-- Nullable reference to an applied Offer, and the resulting discount amount
-- (base amount minus final amount) at the moment it was applied -- stored,
-- not recomputed later, so a subsequent rate/offer change never silently
-- alters a past session's recorded discount.
ALTER TABLE sessions ADD COLUMN offer_id TEXT REFERENCES offers(id);
ALTER TABLE sessions ADD COLUMN discount_amount INTEGER;
```

- [ ] **Step 2: Update `Session` in `models.rs`**

Add two fields after `paid_at`:

```rust
    pub paid_at: Option<String>,
    pub offer_id: Option<String>,
    pub discount_amount: Option<i64>,
}
```

- [ ] **Step 3: Add effect math to `money.rs`**

Append to `apps/desktop/src-tauri/src/money.rs`:

```rust
// Applies one Offer's effect to an already-computed base amount, returning
// (final_amount, discount_amount). extraTime reduces the billable duration
// before the caller's own rate math would apply -- callers pass the
// *already rate-multiplied* base amount for extraTime too, since the
// reduced-duration recompute happens in sessions.rs (money.rs stays a pure
// amount-in/amount-out function, matching calc_time_amount/calc_frame_amount's
// existing shape) via a separate helper below.
pub fn apply_discount_effect(base_amount: i64, effect_type: &str, effect_value: i64) -> (i64, i64) {
    let final_amount = match effect_type {
        "percentOff" => ((base_amount as f64) * ((100 - effect_value.clamp(0, 100)) as f64) / 100.0).round() as i64,
        "flatOff" => (base_amount - effect_value).max(0),
        // "extraTime" is handled by the caller recomputing calc_time_amount on a
        // reduced duration and passing the result here as base_amount with
        // effect_value 0, so this function's job for that case is a no-op --
        // the discount is simply base_amount(full duration) - base_amount(reduced).
        _ => base_amount,
    };
    (final_amount, (base_amount - final_amount).max(0))
}

// The extraTime-specific piece: how many minutes are actually billable after
// N minutes are given free. Floors at 0 -- a session shorter than the free
// allowance is simply billed as 0 minutes, never negative.
pub fn billable_minutes_after_extra_time(actual_minutes: i64, free_minutes: i64) -> i64 {
    (actual_minutes - free_minutes).max(0)
}

// Same math as calc_time_amount, but takes an already-known duration instead
// of re-deriving one from a start/end pair. Used only by the offer-effect
// recompute path in sessions.rs: after an extraTime offer reduces the actual
// duration by its free-minutes allowance, there is no real "reduced end
// time" to hand to calc_time_amount's string-based API, only a minute count.
pub fn calc_time_amount_for_duration(minutes: i64, hour_rate: i64, half_rate: i64) -> i64 {
    let hours = minutes / 60;
    let rem = minutes % 60;
    let mut amt = hours * hour_rate;
    if rem > 0 {
        amt += if half_rate > 0 {
            (half_rate as f64 * (rem as f64 / 30.0)) as i64
        } else {
            (hour_rate as f64 * (rem as f64 / 60.0)) as i64
        };
    }
    amt
}
```

- [ ] **Step 4: Add a test for the new `money.rs` functions**

Add to `money.rs`'s existing `#[cfg(test)] mod tests` block (if one already exists;
otherwise create it at the bottom of the file, matching the file's existing test
style for `calc_time_amount`/`calc_frame_amount`):

```rust
    #[test]
    fn percent_off_rounds_to_nearest_rupee() {
        let (final_amount, discount) = apply_discount_effect(600, "percentOff", 10);
        assert_eq!(final_amount, 540);
        assert_eq!(discount, 60);
    }

    #[test]
    fn flat_off_never_goes_negative() {
        let (final_amount, discount) = apply_discount_effect(30, "flatOff", 50);
        assert_eq!(final_amount, 0);
        assert_eq!(discount, 30);
    }

    #[test]
    fn billable_minutes_floors_at_zero() {
        assert_eq!(billable_minutes_after_extra_time(90, 30), 60);
        assert_eq!(billable_minutes_after_extra_time(20, 30), 0);
    }

    #[test]
    fn duration_based_amount_matches_the_string_based_calculation() {
        // 1h at 400/hr + 200/half (30 of the 90 minutes) = 600, same as
        // calc_time_amount("13:00", "14:30", 400, 200) would give.
        assert_eq!(calc_time_amount_for_duration(90, 400, 200), 600);
    }
```

- [ ] **Step 5: Update the four SQL column lists in `sessions.rs`**

In all four places that currently list
`... amount, method, customer_id, updated_at, deleted_at, metadata, paid_at` (the
three read queries and `do_update_session`'s internal `SELECT`), append `, offer_id,
discount_amount`:

```
SELECT id, station_id, date, start, "end", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at, offer_id, discount_amount
```

- [ ] **Step 6: Update `session_payload`**

Add two fields, after `"paidAt": s.paid_at,`:

```rust
        "paidAt": s.paid_at,
        "offerId": s.offer_id,
        "discountAmount": s.discount_amount,
```

- [ ] **Step 7: Update `do_create_session`'s struct literal and `INSERT`**

Add `offer_id: None, discount_amount: None,` to the `Session { ... }` struct literal
inside `do_create_session` (alongside its existing `paid_at: None,` line). Update the
`INSERT`:

Replace:

```rust
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, created_by, updated_by, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)",
```

with:

```rust
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, created_by, updated_by, paid_at, offer_id, discount_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL)",
```

(`offer_id`/`discount_amount` are both hardcoded `NULL` literals, matching
`deleted_at`/`paid_at` — a brand-new session never has an offer applied.)

- [ ] **Step 8: Add `offer_id` to `SessionPatch` and wire the apply/clear logic**

Add a field to `SessionPatch` (after `paid_at`):

```rust
    #[serde(default, deserialize_with = "deserialize_some")]
    pub offer_id: Option<Option<String>>,
```

In `do_update_session`, the existing flow merges every patched field onto `existing`
first (`if let Some(v) = patch.field { existing.field = v; }` for each), then — only
for `start`/`end` — recomputes `amount` from the rate. Offer application needs its
own recompute path, triggered whenever `patch.offer_id` is present (whether setting a
real id or clearing to `None`), independent of whether `start`/`end` were also
patched in the same call.

Replace the existing merge block:

```rust
    let time_patched = patch.start.is_some() || patch.end.is_some();
    if let Some(v) = patch.start { existing.start = v; }
    if let Some(v) = patch.end { existing.end = v; }
    if let Some(v) = patch.amount { existing.amount = v; }
    if let Some(v) = patch.method { existing.method = v; }
    if let Some(v) = patch.customer_id { existing.customer_id = v; }
    if let Some(v) = patch.paid_at { existing.paid_at = v; }
```

with:

```rust
    let time_patched = patch.start.is_some() || patch.end.is_some();
    let offer_patched = patch.offer_id.is_some();
    if let Some(v) = patch.start { existing.start = v; }
    if let Some(v) = patch.end { existing.end = v; }
    if let Some(v) = patch.amount { existing.amount = v; }
    if let Some(v) = patch.method { existing.method = v; }
    if let Some(v) = patch.customer_id { existing.customer_id = v; }
    if let Some(v) = patch.paid_at { existing.paid_at = v; }
    if let Some(v) = patch.offer_id.clone() { existing.offer_id = v; }
```

Immediately after the existing time-recompute block (`if time_patched && ... { ...
existing.amount = calc_time_amount(...); ... }`), add a new block that runs whenever
`offer_patched` is true:

```rust
    if offer_patched {
        // Applying (or clearing) an offer always recomputes from the category's
        // base rate, ignoring any prior manual amount edit or previously
        // applied offer's discount -- see the plan's Global Constraints for why
        // (predictability: "price this session correctly, with the discount,"
        // never "discount whatever number happens to be in the box").
        let category_row: Option<(String, Option<i64>, Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT c.billing_type, r.hour_rate, r.half_rate, r.frame_rate
             FROM stations st JOIN categories c ON c.id = st.category_id
             LEFT JOIN rates r ON r.category_id = c.id
             WHERE st.id = ?",
        )
        .bind(&existing.station_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let base_amount = match &category_row {
            Some((billing_type, hour_rate, half_rate, _)) if billing_type == "time" => {
                calc_time_amount(&existing.start, &existing.end, hour_rate.unwrap_or(0), half_rate.unwrap_or(0))
            }
            Some((billing_type, _, _, frame_rate)) if billing_type == "frame" => {
                calc_frame_amount(frame_rate.unwrap_or(0))
            }
            _ => existing.amount,
        };

        match &existing.offer_id {
            None => {
                existing.amount = base_amount;
                existing.discount_amount = None;
            }
            Some(offer_id) => {
                let offer: Option<Offer> = sqlx::query_as(&format!(
                    "SELECT {OFFER_COLUMNS} FROM offers WHERE id = ?"
                ))
                .bind(offer_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;

                if let Some(offer) = offer {
                    let (final_amount, discount) = if offer.effect_type == "extraTime" {
                        let actual_minutes = duration_minutes(&existing.start, &existing.end);
                        let billable = billable_minutes_after_extra_time(actual_minutes, offer.effect_value);
                        let hour_rate = category_row.as_ref().and_then(|r| r.1).unwrap_or(0);
                        let half_rate = category_row.as_ref().and_then(|r| r.2).unwrap_or(0);
                        let discounted_base = calc_time_amount_for_duration(billable, hour_rate, half_rate);
                        (discounted_base, (base_amount - discounted_base).max(0))
                    } else {
                        apply_discount_effect(base_amount, &offer.effect_type, offer.effect_value)
                    };
                    existing.amount = final_amount;
                    existing.discount_amount = Some(discount);
                } else {
                    existing.amount = base_amount;
                    existing.discount_amount = None;
                }
            }
        }
    }
```

This references `OFFER_COLUMNS`/`Offer` (Task 1) and the three new `money.rs`
functions from Step 3 — update `sessions.rs`'s imports at the top of the file:

```rust
use crate::money::{calc_frame_amount, calc_time_amount, calc_time_amount_for_duration, apply_discount_effect, billable_minutes_after_extra_time};
use crate::money::duration_minutes;
use crate::models::Offer;
```

(`OFFER_COLUMNS` needs to be `pub(crate)` and imported from `commands::offers` — add
`pub(crate) use crate::commands::offers::OFFER_COLUMNS;` or simply make the constant
`pub(crate) const OFFER_COLUMNS` in `offers.rs` — already written that way in Task 1
— and import it in `sessions.rs`: `use crate::commands::offers::OFFER_COLUMNS;`.)

- [ ] **Step 9: Update the `UPDATE sessions` statement to persist the new fields**

Replace:

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

with:

```rust
        "UPDATE sessions SET start = ?, \"end\" = ?, amount = ?, method = ?, customer_id = ?, updated_at = ?, updated_by = ?, metadata = ?, paid_at = ?, offer_id = ?, discount_amount = ? WHERE id = ?",
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
    .bind(&existing.offer_id)
    .bind(existing.discount_amount)
    .bind(&id)
```

- [ ] **Step 10: Add a frame-count eligibility helper**

Add a new function to `sessions.rs` (near `do_list_sessions_for_date`) for the
per-customer-per-category-per-day count used by frame-billed `minGameCount`
conditions (this is a read, not part of the write path — called from a new small
Tauri command so the frontend can check eligibility without loading every session):

```rust
pub(crate) async fn do_count_sessions_today(
    pool: &SqlitePool,
    date: String,
    category_id: String,
    customer_id: String,
) -> Result<i64, String> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sessions s
         JOIN stations st ON s.station_id = st.id
         WHERE st.category_id = ? AND s.customer_id = ? AND s.date = ? AND s.deleted_at IS NULL",
    )
    .bind(&category_id)
    .bind(&customer_id)
    .bind(&date)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(count.0)
}

#[tauri::command]
pub async fn count_sessions_today(
    pool: State<'_, SqlitePool>,
    date: String,
    category_id: String,
    customer_id: String,
) -> Result<i64, String> {
    do_count_sessions_today(pool.inner(), date, category_id, customer_id).await
}
```

Register `commands::sessions::count_sessions_today` in `lib.rs`'s
`tauri::generate_handler![...]` list, alongside the other session commands.

- [ ] **Step 11: Add tests for the apply/clear/count logic**

Add to `sessions.rs`'s existing `#[cfg(test)] mod tests` block:

```rust
    #[tokio::test]
    async fn applying_an_offer_recomputes_from_the_base_rate_and_records_the_discount() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id.clone(), "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        let with_time = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("13:00".to_string()), end: Some("14:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(with_time.amount, 600); // 1.5h at 400/hr + 200/half = 600

        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, Some(90))).await.unwrap();

        let with_offer = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { offer_id: Some(Some(offer.id.clone())), ..Default::default() },
        )
        .await
        .unwrap();

        assert_eq!(with_offer.amount, 400); // billable drops to 60 min -> 1h at 400
        assert_eq!(with_offer.discount_amount, Some(200));
        assert_eq!(with_offer.offer_id, Some(offer.id));
    }

    #[tokio::test]
    async fn clearing_an_offer_restores_the_undiscounted_amount() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        let with_time = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("13:00".to_string()), end: Some("14:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, Some(90))).await.unwrap();
        let with_offer = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { offer_id: Some(Some(offer.id)), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(with_offer.amount, 400);

        let cleared = do_update_session(
            &pool,
            with_offer.id,
            SessionPatch { offer_id: Some(None), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(cleared.amount, 600);
        assert_eq!(cleared.discount_amount, None);
        assert_eq!(cleared.offer_id, None);
    }

    #[tokio::test]
    async fn count_sessions_today_counts_only_matching_customer_category_and_date() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let customer = crate::commands::customers::do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        for _ in 0..3 {
            let s = do_create_session(&pool, station_id.clone(), category_id.clone(), "frame".to_string(), "2026-07-27".to_string()).await.unwrap();
            do_update_session(&pool, s.id, SessionPatch { customer_id: Some(Some(customer.id.clone())), ..Default::default() }).await.unwrap();
        }

        let count = do_count_sessions_today(&pool, "2026-07-27".to_string(), category_id, customer.id).await.unwrap();
        assert_eq!(count, 3);
    }
```

The test helper `tests_helpers_offer_input_extra_time` referenced above needs adding
to `offers.rs` (outside its own `#[cfg(test)]` block, since `sessions.rs`'s tests
need to construct an `OfferInput` too — make it a `pub(crate)` function, not
`#[cfg(test)]`-gated, since it's only ever called from test code but Rust's
module-privacy rules make a plain `pub(crate)` helper simpler than exposing
test-only cross-module items):

Add to `offers.rs`, near the bottom (outside the `mod tests` block):

```rust
// Test-only helper used by sessions.rs's own tests to build a minimal
// extraTime OfferInput without duplicating every field default inline.
pub(crate) fn tests_helpers_offer_input_extra_time(free_minutes: i64, min_duration_minutes: Option<i64>) -> OfferInput {
    OfferInput {
        name: "Weekday Special".to_string(),
        active: true,
        applies_to_all_categories: true,
        category_ids: None,
        days: None,
        start_time: None,
        end_time: None,
        start_date: None,
        end_date: None,
        min_duration_minutes,
        min_game_count: None,
        effect_type: "extraTime".to_string(),
        effect_value: free_minutes,
    }
}
```

Also confirm `apps/desktop/src-tauri/src/commands/customers.rs` actually exports a
`do_create_customer(pool, name, phone)` with this exact signature (used in the third
new test above) — check the file during implementation and adjust the call if the
real signature differs.

- [ ] **Step 12: Verify**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all existing tests plus the 3 new `money.rs` tests and 3 new `sessions.rs`
tests pass.

- [ ] **Step 13: Commit**

```bash
git add apps/desktop/src-tauri/migrations/0008_session_offer_fields.sql apps/desktop/src-tauri/src/models.rs apps/desktop/src-tauri/src/money.rs apps/desktop/src-tauri/src/commands/sessions.rs apps/desktop/src-tauri/src/commands/offers.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): apply/clear Offer effects on Session, always recomputed from base rate"
```

---

### Task 3: Sync engine — `apply_offers` + `apply_sessions` extension

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/sync.rs`

**Interfaces:**
- Consumes: `Offer` (Task 1), `Session.offer_id`/`discount_amount` (Task 2).
- Produces: `apply_offers(tx, id, row) -> Result<(), sqlx::Error>`, wired into
  `apply_one`'s dispatcher match.

- [ ] **Step 1: Add the `apply_offers` function**

Add to `sync.rs`, near `apply_rates` (the closest structural precedent — a table with
no `deleted_at` column, no soft-delete path):

```rust
async fn apply_offers(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "offers", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO offers (id, name, active, applies_to_all_categories, category_ids, \
         days, start_time, end_time, start_date, end_date, min_duration_minutes, \
         min_game_count, effect_type, effect_value, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = excluded.active,
           applies_to_all_categories = excluded.applies_to_all_categories,
           category_ids = excluded.category_ids, days = excluded.days,
           start_time = excluded.start_time, end_time = excluded.end_time,
           start_date = excluded.start_date, end_date = excluded.end_date,
           min_duration_minutes = excluded.min_duration_minutes,
           min_game_count = excluded.min_game_count, effect_type = excluded.effect_type,
           effect_value = excluded.effect_value, updated_at = excluded.updated_at",
    )
    .bind(id)
    .bind(row["name"].as_str().unwrap_or_default())
    .bind(row["active"].as_bool().unwrap_or(true))
    .bind(row["appliesToAllCategories"].as_bool().unwrap_or(false))
    .bind(row["categoryIds"].as_str())
    .bind(row["days"].as_str())
    .bind(row["startTime"].as_str())
    .bind(row["endTime"].as_str())
    .bind(row["startDate"].as_str())
    .bind(row["endDate"].as_str())
    .bind(row["minDurationMinutes"].as_i64())
    .bind(row["minGameCount"].as_i64())
    .bind(row["effectType"].as_str().unwrap_or_default())
    .bind(row["effectValue"].as_i64().unwrap_or(0))
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

- [ ] **Step 2: Register it in `apply_one`'s dispatcher**

Add `"offers" => apply_offers(tx, &id, row).await,` to the `match table { ... }` list
in `apply_one`, alongside the other 12 arms.

- [ ] **Step 3: Extend `apply_sessions` for `offerId`/`discountAmount`**

In `apply_sessions`, add the two new columns to the `INSERT`/`ON CONFLICT` SQL and two
new binds. Replace:

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

(Note: this is the state *after* the `paid_at` column was added in an earlier
sub-project — confirm the exact current text in the file before replacing, since line
numbers may have shifted.) Replace with:

```rust
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at, offer_id, discount_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET station_id = excluded.station_id, date = excluded.date,
           start = excluded.start, \"end\" = excluded.\"end\", amount = excluded.amount,
           method = excluded.method, customer_id = excluded.customer_id,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, metadata = excluded.metadata,
           paid_at = excluded.paid_at, offer_id = excluded.offer_id, discount_amount = excluded.discount_amount",
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
    .bind(row["offerId"].as_str())
    .bind(row["discountAmount"].as_i64())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

- [ ] **Step 4: Verify**

Run: `cd apps/desktop/src-tauri && cargo test && cargo check`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/sync.rs
git commit -m "feat(desktop): sync engine handles Offer table and Session's offer/discount fields"
```

---

### Task 4: Postgres schema + API sync plumbing

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: new Prisma migration (via `prisma migrate dev`)
- Modify: `apps/api/src/services/sync.service.ts`
- Modify: `apps/api/src/shared/schemas/sync.schema.ts`

**Interfaces:**
- Produces: Prisma `Offer` model, `Session.offerId`/`discountAmount` fields;
  `'offers'` added to the sync table union everywhere it appears.

- [ ] **Step 1: Add the `Offer` model to `schema.prisma`**

```prisma
model Offer {
  id                       String   @id @default(uuid())
  name                     String
  active                   Boolean  @default(true)
  appliesToAllCategories   Boolean  @default(false)
  categoryIds              String?
  days                     String?
  startTime                String?
  endTime                  String?
  startDate                String?
  endDate                  String?
  minDurationMinutes       Int?
  minGameCount             Int?
  effectType               String
  effectValue              Int
  updatedAt                DateTime @default(now())

  createdBy     String?
  createdByUser User?   @relation("OfferCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  updatedBy     String?
  updatedByUser User?   @relation("OfferUpdatedBy", fields: [updatedBy], references: [id], onDelete: SetNull)
}
```

Add two fields to the existing `Session` model (after `paidAt`):

```prisma
  paidAt         DateTime?
  offerId        String?
  discountAmount Int?
```

- [ ] **Step 2: Generate the migration**

Run: `cd apps/api && npx prisma migrate dev --name offers`
Expected: a new migration directory is created; Prisma reports success against the
local dev database.

- [ ] **Step 3: Add `'offers'` to `sync.schema.ts`**

In `apps/api/src/shared/schemas/sync.schema.ts`, find the `SyncTableName` (or
equivalent) zod enum listing all synced tables and add `'offers'` to it.

- [ ] **Step 4: Extend `sync.service.ts`**

In `applyEntry`'s `switch (entry.table) { ... }`, add a case (Offer has no
`deletedAt`, so it follows `Rate`'s exact shape, not `Session`'s):

```ts
    case 'offers': {
      const base = { ...payload, updatedAt: now, ...stampUpdate };
      await tx.offer.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.OfferUncheckedCreateInput,
        update: base as unknown as Prisma.OfferUncheckedUpdateInput,
      });
      break;
    }
```

In `entryExists`'s `switch (entry.table) { ... }`, add:

```ts
    case 'offers':
      return (await tx.offer.findUnique({ where: { id }, select: { id: true } })) !== null;
```

In `pullSince`, add `offers` to the `Promise.all` fetch list and the returned object:

```ts
    prisma.offer.findMany({ where }),
```

(added alongside the other `prisma.<table>.findMany({ where })` calls, in the same
position as its corresponding entry in the destructured result array and the
returned object's `offers,` field).

In `summarize()`'s `switch (entry.table) { ... }` (the human-readable ActivityLog
one-liner builder), add:

```ts
    case 'offers':
      return `offer "${str(payload.name)}"`;
```

- [ ] **Step 5: Verify**

Run: `cd apps/api && npx vitest run && npx vitest run --config vitest.integration.config.ts`
Expected: both pass, unaffected (no existing fixture references offers).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/services/sync.service.ts apps/api/src/shared/schemas/sync.schema.ts
git commit -m "feat(api): add Offer model and sync plumbing (push/pull/entryExists/summarize)"
```

---

### Task 5: New `offerManagement` permission

**Files:**
- Modify: `apps/api/src/shared/constants/roles.ts`
- Modify: `apps/desktop/src/lib/shared/constants/roles.ts`
- Modify: `apps/web/src/lib/shared/constants/roles.ts`

**Interfaces:**
- Produces: `'offerManagement'` added to the `PermissionKey` union and
  `PERMISSION_KEYS` array in all three files, and to `ADMIN_ONLY_PERMISSIONS` in
  `apps/api`'s copy (Owner/Admin only, per the spec's explicit decision — Cashier
  keeps `dailySales` access, which is what lets them apply an existing active offer;
  they just can't create/edit/toggle offers).

- [ ] **Step 1: Update `apps/api/src/shared/constants/roles.ts`**

Add `'offerManagement'` to the `PermissionKey` union type, to the `PERMISSION_KEYS`
array (with a human-readable `label`, e.g. `{ key: 'offerManagement', label: 'Offer Management' }`,
matching the existing entries' shape), and to `ADMIN_ONLY_PERMISSIONS`.

- [ ] **Step 2: Mirror the union/array into `apps/desktop/src/lib/shared/constants/roles.ts`**

Add the identical `'offerManagement'` entry to this file's `PermissionKey` union and
`PERMISSION_KEYS` array. This file has no `SYSTEM_ROLE_SEED`/`ADMIN_ONLY_PERMISSIONS`
— only the type/list needs mirroring, per this file's own documented role (see
`historical precedent commit 3fa1268`, which only touched the union/array in the
non-authoritative copies).

- [ ] **Step 3: Mirror into `apps/web/src/lib/shared/constants/roles.ts`**

Same as Step 2, for web's copy.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`, `pnpm --filter @cue-room/web exec
tsc -b`, and `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually re-seed permissions (not part of automated verification — a real operational step)**

Run: `cd apps/api && npm run seed`
Expected: the seed script (idempotent) inserts the new `offerManagement` `Permission`
row and refreshes `RolePermission` rows for the `OWNER`/`ADMIN`/`CASHIER` system
roles — `OWNER`/`ADMIN` gain it, `CASHIER` does not. This must be re-run against
every environment's Postgres instance (including production, once deployed) — it is
**not** triggered automatically by the migration in Task 4 or by API startup. Note
this explicitly in the PR/handoff notes for whoever deploys this branch.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/shared/constants/roles.ts apps/desktop/src/lib/shared/constants/roles.ts apps/web/src/lib/shared/constants/roles.ts
git commit -m "feat: add offerManagement permission (Owner/Admin only)"
```

---

### Task 6: Shared frontend plumbing — schemas, wire types, hooks

**Files:**
- Modify: `apps/desktop/src/lib/shared/utils/dates.ts`
- Create: `apps/desktop/src/lib/shared/schemas/offer.schema.ts`
- Modify: `apps/desktop/src/lib/shared/schemas/session.schema.ts`
- Modify: `apps/web/src/lib/shared/schemas/session.schema.ts`
- Modify: `apps/desktop/src/lib/tauri/commands.ts`
- Create: `apps/desktop/src/lib/hooks/useOffers.ts`
- Modify: `apps/web/src/lib/hooks/usePullData.ts`
- Create: `apps/web/src/lib/hooks/useOffers.ts`

**Interfaces:**
- Produces: `dayOfWeek(dateStr: string): number`; `OfferSchema`/`OfferDraftSchema`/
  `Offer` type (desktop, RHF+zod-driven since the Offers form is meaningfully more
  complex than Product's ad-hoc form — a deliberate deviation from Product's
  no-schema precedent, using Customer/Expense/RateManagement's RHF+zod convention
  instead); `useOffers()` (desktop: full CRUD via Tauri commands; web: read-only via
  `usePullData()`, following `useRates()`'s exact pattern).

- [ ] **Step 1: Add `dayOfWeek` to `apps/desktop/src/lib/shared/utils/dates.ts`**

```ts
// 0 = Sunday ... 6 = Saturday, matching Date.getDay() and this file's existing
// WEEKDAYS constant ordering (see constants/categories.ts).
export function dayOfWeek(dateStr: string): number {
  return parseDate(dateStr).getDay();
}
```

- [ ] **Step 2: Create `apps/desktop/src/lib/shared/schemas/offer.schema.ts`**

```ts
import { z } from 'zod';

const timeRegex = /^\d{2}:\d{2}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const OfferSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  active: z.boolean(),
  appliesToAllCategories: z.boolean(),
  categoryIds: z.string().nullable(),
  days: z.string().nullable(),
  startTime: z.string().regex(timeRegex).nullable(),
  endTime: z.string().regex(timeRegex).nullable(),
  startDate: z.string().regex(dateRegex).nullable(),
  endDate: z.string().regex(dateRegex).nullable(),
  minDurationMinutes: z.coerce.number().int().positive().nullable(),
  minGameCount: z.coerce.number().int().positive().nullable(),
  effectType: z.enum(['extraTime', 'percentOff', 'flatOff']),
  effectValue: z.coerce.number().int().min(0),
  updatedAt: z.string().datetime().optional(),
}).refine(
  data => data.appliesToAllCategories || !!data.categoryIds,
  { message: 'Select at least one category, or choose "All categories"', path: ['categoryIds'] }
).refine(
  data => data.effectType !== 'percentOff' || data.effectValue <= 100,
  { message: 'Percent off cannot exceed 100', path: ['effectValue'] }
);

export type Offer = z.infer<typeof OfferSchema>;

export const OfferDraftSchema = OfferSchema.omit({ id: true, updatedAt: true });
export type OfferDraft = z.infer<typeof OfferDraftSchema>;
```

- [ ] **Step 3: Add `offerId`/`discountAmount` to both apps' `session.schema.ts`**

In both `apps/desktop/src/lib/shared/schemas/session.schema.ts` and
`apps/web/src/lib/shared/schemas/session.schema.ts`, add two fields to
`sessionBaseSchema` (after `paidAt`):

```ts
  offerId: z.string().uuid().nullable().optional(),
  discountAmount: z.coerce.number().int().nullable().optional(),
```

- [ ] **Step 4: Add Offer wire types and command wrappers to `apps/desktop/src/lib/tauri/commands.ts`**

```ts
export interface OfferRow {
  id: string;
  name: string;
  active: boolean;
  appliesToAllCategories: boolean;
  categoryIds: string | null;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  startDate: string | null;
  endDate: string | null;
  minDurationMinutes: number | null;
  minGameCount: number | null;
  effectType: 'extraTime' | 'percentOff' | 'flatOff';
  effectValue: number;
  updatedAt: string;
}

export interface OfferInput {
  name: string;
  active: boolean;
  appliesToAllCategories: boolean;
  categoryIds: string | null;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  startDate: string | null;
  endDate: string | null;
  minDurationMinutes: number | null;
  minGameCount: number | null;
  effectType: 'extraTime' | 'percentOff' | 'flatOff';
  effectValue: number;
}
```

Add to the `commands` object (alongside the other entity commands):

```ts
  listOffers: () => invoke<OfferRow[]>('list_offers'),
  createOffer: (input: OfferInput) => invoke<OfferRow>('create_offer', { input }),
  updateOffer: (id: string, input: OfferInput) => invoke<OfferRow>('update_offer', { id, input }),
  countSessionsToday: (date: string, categoryId: string, customerId: string) =>
    invoke<number>('count_sessions_today', { date, categoryId, customerId }),
```

Add `offerId?: string | null;` to the existing `SessionPatch` interface (alongside
`method`/`customerId`/`paidAt`).

- [ ] **Step 5: Create `apps/desktop/src/lib/hooks/useOffers.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type OfferInput } from '../tauri/commands';

export function useOffers() {
  const qc = useQueryClient();

  const offersQuery = useQuery({
    queryKey: ['offers'],
    queryFn: () => commands.listOffers(),
  });

  const addOffer = useMutation({
    mutationFn: (input: OfferInput) => commands.createOffer(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }),
  });

  const updateOffer = useMutation({
    mutationFn: ({ id, input }: { id: string; input: OfferInput }) => commands.updateOffer(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }),
  });

  return { offers: offersQuery.data ?? [], isLoading: offersQuery.isLoading, addOffer, updateOffer };
}
```

- [ ] **Step 6: Extend `apps/web/src/lib/hooks/usePullData.ts`**

Add an `OfferRow` interface (matching desktop's `OfferRow` shape from Step 4) and add
`offers: OfferRow[];` to the `PullResult` interface.

- [ ] **Step 7: Create `apps/web/src/lib/hooks/useOffers.ts`**

```ts
import { usePullData } from './usePullData';

export function useOffers() {
  const query = usePullData();
  return { offers: query.data?.offers ?? [], isLoading: query.isLoading };
}
```

- [ ] **Step 8: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
exec tsc -b`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/lib/shared/utils/dates.ts apps/desktop/src/lib/shared/schemas/offer.schema.ts apps/desktop/src/lib/shared/schemas/session.schema.ts apps/web/src/lib/shared/schemas/session.schema.ts apps/desktop/src/lib/tauri/commands.ts apps/desktop/src/lib/hooks/useOffers.ts apps/web/src/lib/hooks/usePullData.ts apps/web/src/lib/hooks/useOffers.ts
git commit -m "feat(desktop,web): offer.schema.ts, session offerId/discountAmount fields, useOffers hooks"
```

---

### Task 7: Offer Management views (desktop full CRUD, web read-only)

**Files:**
- Create: `apps/desktop/src/components/views/OfferManagementView.tsx`
- Create: `apps/web/src/components/views/OfferManagementView.tsx`
- Modify: `apps/desktop/src/components/layout/Sidebar.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (or equivalent nav file)
- Modify: `apps/web/src/App.tsx` (or equivalent routing file)

**Interfaces:**
- Consumes: `useOffers()`, `useCategories()`, `OfferSchema`/`OfferDraftSchema`
  (Task 6), `hasPermission`/`'offerManagement'` (Task 5).

- [ ] **Step 1: Create `apps/desktop/src/components/views/OfferManagementView.tsx`**

Following `CustomersView.tsx`/`ExpensesView.tsx`'s established RHF+zod form
convention (not Product's ad-hoc `useState` form, per this plan's deliberate
deviation) and `ProductManagementView.tsx`'s active-toggle-via-full-resend pattern:

```tsx
import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  OfferDraftSchema,
  toFieldErrors,
  type OfferDraft,
} from '@/lib/shared';
import { useOffers } from '@/lib/hooks/useOffers';
import { useCategories } from '@/lib/hooks/useCategories';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OfferRow, OfferInput } from '@/lib/tauri/commands';

const WEEKDAY_OPTIONS = [
  { code: 'mon', label: 'Mon' }, { code: 'tue', label: 'Tue' }, { code: 'wed', label: 'Wed' },
  { code: 'thu', label: 'Thu' }, { code: 'fri', label: 'Fri' }, { code: 'sat', label: 'Sat' }, { code: 'sun', label: 'Sun' },
];

export default function OfferManagementView() {
  const { offers, addOffer, updateOffer } = useOffers();
  const { categories } = useCategories();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OfferRow | null>(null);

  function openCreate() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(offer: OfferRow) {
    setEditing(offer);
    setShowForm(true);
  }

  async function toggleActive(offer: OfferRow) {
    await updateOffer.mutateAsync({ id: offer.id, input: { ...toInput(offer), active: !offer.active } });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Offers</h1>
        <Button type="button" onClick={openCreate}>+ New offer</Button>
      </div>

      {offers.length === 0 && <p className="text-sm text-muted-foreground">No offers yet.</p>}

      <div className="flex flex-col gap-3">
        {offers.map(offer => (
          <Card key={offer.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{offer.name}</CardTitle>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(offer)}>Edit</Button>
                <Button
                  type="button"
                  variant={offer.active ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => toggleActive(offer)}
                >
                  {offer.active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {offer.appliesToAllCategories
                ? 'All categories'
                : (offer.categoryIds ?? '').split(',').map(id => categories.find(c => c.id === id)?.name ?? id).join(', ')}
            </CardContent>
          </Card>
        ))}
      </div>

      {showForm && (
        <OfferForm
          initial={editing}
          onSaved={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function toInput(offer: OfferRow): OfferInput {
  const { id: _id, updatedAt: _updatedAt, ...input } = offer;
  return input;
}

function OfferForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: OfferRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { addOffer, updateOffer } = useOffers();
  const { categories } = useCategories();
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<OfferDraft>({
    resolver: zodResolver(OfferDraftSchema),
    defaultValues: initial ?? {
      name: '',
      active: true,
      appliesToAllCategories: true,
      categoryIds: null,
      days: null,
      startTime: null,
      endTime: null,
      startDate: null,
      endDate: null,
      minDurationMinutes: null,
      minGameCount: null,
      effectType: 'extraTime',
      effectValue: 0,
    },
  });

  const appliesToAllCategories = watch('appliesToAllCategories');
  const selectedDays = new Set((watch('days') ?? '').split(',').filter(Boolean));
  const selectedCategoryIds = new Set((watch('categoryIds') ?? '').split(',').filter(Boolean));

  async function onSubmit(data: OfferDraft) {
    const input: OfferInput = { ...data };
    if (initial) {
      await updateOffer.mutateAsync({ id: initial.id, input });
    } else {
      await addOffer.mutateAsync(input);
    }
    onSaved();
  }

  return (
    <Card>
      <CardHeader><CardTitle>{initial ? 'Edit offer' : 'New offer'}</CardTitle></CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input {...register('name')} aria-invalid={!!toFieldErrors(errors.name)} />
            <FieldError errors={toFieldErrors(errors.name)} />
          </Field>

          <Field>
            <FieldLabel>Categories</FieldLabel>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register('appliesToAllCategories')} />
              All categories
            </label>
            {!appliesToAllCategories && (
              <Controller
                name="categoryIds"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-wrap gap-3">
                    {categories.map(c => (
                      <label key={c.id} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedCategoryIds.has(c.id)}
                          onChange={e => {
                            const next = new Set(selectedCategoryIds);
                            if (e.target.checked) next.add(c.id); else next.delete(c.id);
                            field.onChange(next.size > 0 ? Array.from(next).join(',') : null);
                          }}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}
              />
            )}
            <FieldError errors={toFieldErrors(errors.categoryIds)} />
          </Field>

          <Field>
            <FieldLabel>Days (leave all unchecked for every day)</FieldLabel>
            <Controller
              name="days"
              control={control}
              render={({ field }) => (
                <div className="flex flex-wrap gap-3">
                  {WEEKDAY_OPTIONS.map(d => (
                    <label key={d.code} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedDays.has(d.code)}
                        onChange={e => {
                          const next = new Set(selectedDays);
                          if (e.target.checked) next.add(d.code); else next.delete(d.code);
                          field.onChange(next.size > 0 ? Array.from(next).join(',') : null);
                        }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              )}
            />
          </Field>

          <Field>
            <FieldLabel>Time window (optional)</FieldLabel>
            <div className="flex gap-2">
              <Input type="time" {...register('startTime')} aria-label="Start time" />
              <Input type="time" {...register('endTime')} aria-label="End time" />
            </div>
          </Field>

          <Field>
            <FieldLabel>Date range (optional, for limited-time promos)</FieldLabel>
            <div className="flex gap-2">
              <Input type="date" {...register('startDate')} aria-label="Start date" />
              <Input type="date" {...register('endDate')} aria-label="End date" />
            </div>
          </Field>

          <Field>
            <FieldLabel>Minimum duration (minutes, time-billed categories)</FieldLabel>
            <Input type="number" {...register('minDurationMinutes')} />
          </Field>

          <Field>
            <FieldLabel>Minimum game count (frame-billed categories)</FieldLabel>
            <Input type="number" {...register('minGameCount')} />
          </Field>

          <Field>
            <FieldLabel>Effect</FieldLabel>
            <Controller
              name="effectType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={v => field.onChange(v ?? 'extraTime')}>
                  <SelectTrigger aria-label="Effect type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extraTime">Extra free time (minutes)</SelectItem>
                    <SelectItem value="percentOff">Percent off</SelectItem>
                    <SelectItem value="flatOff">Flat amount off</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <Input type="number" {...register('effectValue')} aria-label="Effect value" />
            <FieldError errors={toFieldErrors(errors.effectValue)} />
          </Field>

          <div className="flex gap-2">
            <Button type="button" onClick={handleSubmit(onSubmit)}>Save</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
```

Add `OfferSchema`, `OfferDraftSchema`, `Offer`, `OfferDraft` to `apps/desktop/src/lib/shared`'s
barrel export (wherever `session.schema.ts`'s exports are re-exported from, add the
identical pattern for `offer.schema.ts`).

- [ ] **Step 2: Create `apps/web/src/components/views/OfferManagementView.tsx`**

Read-only, mirroring `RateManagementView.tsx`'s web precedent exactly:

```tsx
import { useOffers } from '@/lib/hooks/useOffers';
import { useCategories } from '@/lib/hooks/useCategories';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Read-only: offers are managed on the desktop app -- web only displays them.
export default function OfferManagementView() {
  const { offers } = useOffers();
  const { categories } = useCategories();

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Offers</h1>
      {offers.map(offer => (
        <Card key={offer.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{offer.name}</CardTitle>
            <span className="text-sm text-muted-foreground">{offer.active ? 'Active' : 'Inactive'}</span>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {offer.appliesToAllCategories
              ? 'All categories'
              : (offer.categoryIds ?? '').split(',').map(id => categories.find(c => c.id === id)?.name ?? id).join(', ')}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire up navigation and routing in both apps**

Following `monthlyExpenses`'s precedent (commit `3fa1268`, which touched
`App.tsx`/`Sidebar.tsx` in each app): add an `'offerManagement'` entry to the view-key
union and route switch in both `apps/desktop/src/App.tsx`/`Sidebar.tsx` and
`apps/web/src/App.tsx`/`Sidebar.tsx` (or their equivalents — confirm exact file names
during implementation), gated by `hasPermission(permissions, 'offerManagement')`, the
same as every other admin-only nav item already is.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, log in as Owner, confirm "Offers" appears in
the sidebar, create the motivating example (name "Weekday Special", categories
8-Ball only, days Mon-Fri, min duration 90, effect extraTime 30), confirm it appears
in the list, edit it, toggle it inactive and back active. Log in as Cashier, confirm
"Offers" is absent from the sidebar.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/views/OfferManagementView.tsx apps/web/src/components/views/OfferManagementView.tsx apps/desktop/src/components/layout/Sidebar.tsx apps/desktop/src/App.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/App.tsx
git commit -m "feat(desktop,web): Offers Management views (desktop full CRUD, web read-only)"
```

---

### Task 8: Daily Sales integration — eligibility prompt, apply/clear, discount display

**Files:**
- Modify: `apps/desktop/src/components/views/DailySalesView.tsx`
- Modify: `apps/web/src/components/views/DailySalesView.tsx`

**Interfaces:**
- Consumes: `useOffers()`, `dayOfWeek()` (Task 6), `commands.countSessionsToday`
  (Task 2/6), `updateSession` (existing).

- [ ] **Step 1: Add an eligibility-checking helper to desktop's `DailySalesView.tsx`**

Add a new function (near the top of the file, alongside `formatDuration`):

```tsx
function offerAppliesTo(offer: OfferRow, categoryId: string): boolean {
  if (offer.appliesToAllCategories) return true;
  return (offer.categoryIds ?? '').split(',').includes(categoryId);
}

function isOfferActiveOn(offer: OfferRow, dateStr: string, timeStr: string): boolean {
  if (offer.startDate && dateStr < offer.startDate) return false;
  if (offer.endDate && dateStr > offer.endDate) return false;
  if (offer.days) {
    const codes = offer.days.split(',');
    const code = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayOfWeek(dateStr)];
    if (!codes.includes(code)) return false;
  }
  if (offer.startTime && timeStr < offer.startTime) return false;
  if (offer.endTime && timeStr > offer.endTime) return false;
  return true;
}
```

Import `dayOfWeek` from `@/lib/shared` and `type OfferRow` from `@/lib/tauri/commands`
at the top of the file.

- [ ] **Step 2: Pass `offers` down to `SessionRow` and check eligibility there**

Add two imports at the top of the file: `import { useOffers } from
'@/lib/hooks/useOffers';` and `import { commands } from '@/lib/tauri/commands';` (the
latter for the new `commands.countSessionsToday` call below — `commands` isn't
otherwise imported in this file today, since it reads data through hooks, not
directly).

`DailySalesView`'s top-level component already calls several hooks; add:

```tsx
  const { offers } = useOffers();
```

Thread `offers` down through `CategoryGroup`/`StationCard` to `SessionRow` the same
way `customers` already is (add `offers: OfferRow[]` to each intermediate
component's props type and JSX prop list).

In `SessionRow`, add eligibility state and the frame-count check (which needs an
async lookup, unlike the other synchronous conditions):

```tsx
  const [eligibleOfferId, setEligibleOfferId] = useState<string | null>(null);

  useEffect(() => {
    if (session.offerId) { setEligibleOfferId(null); return; }
    let cancelled = false;

    async function checkEligibility() {
      const candidates = offers.filter(o => o.active && offerAppliesTo(o, category.id));
      const nowTime = billing === 'time' && session.start ? session.start : nowTimeStr();
      for (const offer of candidates) {
        if (!isOfferActiveOn(offer, date, nowTime)) continue;
        if (offer.minDurationMinutes != null) {
          if (billing !== 'time' || !session.start || !session.end) continue;
          if (durationMinutes(session.start, session.end) < offer.minDurationMinutes) continue;
        }
        if (offer.minGameCount != null) {
          if (billing !== 'frame' || !session.customerId) continue;
          const count = await commands.countSessionsToday(date, category.id, session.customerId);
          if (count + 1 !== offer.minGameCount) continue;
        }
        if (!cancelled) setEligibleOfferId(offer.id);
        return;
      }
      if (!cancelled) setEligibleOfferId(null);
    }

    checkEligibility();
    return () => { cancelled = true; };
  }, [session.offerId, session.start, session.end, session.customerId, offers, category.id, billing, date]);
```

Add `category: CategoryWithStations` and `offers: OfferRow[]` to `SessionRow`'s props
type (threaded through from `StationCard`, which already receives `category`).

- [ ] **Step 3: Render the apply prompt and applied-offer display**

In `SessionRow`'s JSX, after the existing controls row and before the
`QUICK_DURATIONS` block, add:

```tsx
      {eligibleOfferId && (
        <div className="flex items-center gap-2 text-sm">
          <span>🎉 {offers.find(o => o.id === eligibleOfferId)?.name} available —</span>
          <Button type="button" size="xs" variant="link" className="h-auto p-0" onClick={() => commit({ offerId: eligibleOfferId })}>
            Apply?
          </Button>
        </div>
      )}
      {session.offerId && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{offers.find(o => o.id === session.offerId)?.name ?? 'Offer'} applied — saved {formatCurrency(session.discountAmount ?? 0)}</span>
          <Button type="button" size="xs" variant="link" className="h-auto p-0" onClick={() => commit({ offerId: null })}>
            Remove
          </Button>
        </div>
      )}
```

`commit` already exists in `SessionRow` and calls `updateSession(session.id, patch)`
— no change needed to `commit` itself, since `Partial<Session>` already accepts
`offerId` once Task 6's schema change lands.

- [ ] **Step 4: Web — read-only discount display**

In `apps/web/src/components/views/DailySalesView.tsx`'s `SessionRow`, add a line
showing the applied offer/discount if present (after the existing `customerName`
span):

```tsx
      {session.offerId && (
        <span className="text-muted-foreground">
          {offerName(session.offerId)} (−{formatCurrency(session.discountAmount ?? 0)})
        </span>
      )}
```

Thread `offers: OfferRow[]` down the same way `customers` already is (this file's
prop-drilling shape mirrors desktop's), and add a small `offerName(id)` lookup
helper (`offers.find(o => o.id === id)?.name ?? 'Offer'`) inside `SessionRow`. Add
two imports at the top of the file — `import { useOffers } from
'@/lib/hooks/useOffers';` and a type-only `import type { OfferRow } from
'@/lib/hooks/usePullData';` (web's `OfferRow` lives in `usePullData.ts`, added in
Task 6 Step 6 — not `commands.ts`, since web has no Tauri layer) — then call
`useOffers()` in the top-level component and pass `offers` down through
`CategoryGroup`/`StationCard`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, using the "Weekday Special" offer created in
Task 7's manual check — start an 8-Ball session, set start/end to a 1.5-hour span on
a weekday, confirm the "Apply?" prompt appears; click it, confirm the amount drops
and "saved ₹X" shows; click "Remove", confirm the amount and display revert. Then
confirm the session (with its offer/discount) appears correctly on web's Daily
Sales after a sync cycle.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/views/DailySalesView.tsx apps/web/src/components/views/DailySalesView.tsx
git commit -m "feat(desktop,web): eligible-offer prompt, apply/clear, and discount display in Daily Sales"
```

---

### Task 9: Edge-case unit test audit (Rust money math + `Offer` entity + counting)

Added after the fact, per explicit request to maximize test coverage before the
final review. Tasks 1-2's own review cycles already surfaced and fixed several
boundary bugs (see the progress ledger) — this task targets specific boundary
conditions those cycles didn't yet have dedicated tests for, rather than re-testing
what's already covered.

**Files:**
- Modify: `apps/desktop/src-tauri/src/money.rs`
- Modify: `apps/desktop/src-tauri/src/commands/offers.rs`
- Modify: `apps/desktop/src-tauri/src/commands/sessions.rs`

- [ ] **Step 1: Add boundary tests to `money.rs`**

Add to the existing `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn percent_off_at_100_zeroes_the_amount() {
        let (final_amount, discount) = apply_discount_effect(600, "percentOff", 100);
        assert_eq!(final_amount, 0);
        assert_eq!(discount, 600);
    }

    #[test]
    fn percent_off_at_0_is_a_no_op() {
        let (final_amount, discount) = apply_discount_effect(600, "percentOff", 0);
        assert_eq!(final_amount, 600);
        assert_eq!(discount, 0);
    }

    #[test]
    fn flat_off_at_0_is_a_no_op() {
        let (final_amount, discount) = apply_discount_effect(600, "flatOff", 0);
        assert_eq!(final_amount, 600);
        assert_eq!(discount, 0);
    }

    #[test]
    fn billable_minutes_at_exactly_the_free_allowance_is_zero_not_negative() {
        // effect_value equal to the actual duration -- the whole session is free,
        // not an error and not a negative duration.
        assert_eq!(billable_minutes_after_extra_time(30, 30), 0);
    }
```

- [ ] **Step 2: Add a storage-fidelity test to `offers.rs`**

Add to the existing `#[cfg(test)] mod tests` block:

```rust
    #[tokio::test]
    async fn applies_to_all_categories_and_category_ids_can_both_be_stored_as_given() {
        // The Rust layer doesn't validate/clear category_ids when
        // applies_to_all_categories is true -- that's a frontend zod-level
        // concern (the form only shows the checklist when "All categories" is
        // unchecked). This test documents that the CRUD layer is a faithful
        // store, not a validator, so a future reader doesn't mistake the
        // absence of that clearing logic for a bug.
        let pool = setup_test_db().await;
        let mut input = sample_input("percentOff", 10);
        input.applies_to_all_categories = true;
        input.category_ids = Some("cat-1,cat-2".to_string());
        let offer = do_create_offer(&pool, input).await.unwrap();
        assert!(offer.applies_to_all_categories);
        assert_eq!(offer.category_ids, Some("cat-1,cat-2".to_string()));
    }
```

- [ ] **Step 3: Add a soft-delete-exclusion test for `do_count_sessions_today` to `sessions.rs`**

Add to the existing `#[cfg(test)] mod tests` block, near
`count_sessions_today_counts_only_matching_customer_category_and_date`:

```rust
    #[tokio::test]
    async fn count_sessions_today_excludes_soft_deleted_sessions() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let customer = crate::commands::customers::do_create_customer(&pool, "Priya".to_string(), "".to_string()).await.unwrap();

        let mut last_id = String::new();
        for _ in 0..3 {
            let s = do_create_session(&pool, station_id.clone(), category_id.clone(), "frame".to_string(), "2026-07-27".to_string()).await.unwrap();
            do_update_session(&pool, s.id.clone(), SessionPatch { customer_id: Some(Some(customer.id.clone())), ..Default::default() }).await.unwrap();
            last_id = s.id;
        }
        do_delete_session(&pool, last_id).await.unwrap();

        let count = do_count_sessions_today(&pool, "2026-07-27".to_string(), category_id, customer.id).await.unwrap();
        assert_eq!(count, 2, "the soft-deleted session must not count toward the day's total");
    }
```

(Confirm the exact `do_create_customer` signature during implementation, matching
whatever Task 2 already settled on for its own tests.)

- [ ] **Step 4: Verify**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all prior tests plus these 7 new ones pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/money.rs apps/desktop/src-tauri/src/commands/offers.rs apps/desktop/src-tauri/src/commands/sessions.rs
git commit -m "test(desktop): boundary-condition coverage for offer effect math, storage, and counting"
```

**Note for the final whole-branch review**: the backend (`do_update_session`) never
re-validates an offer's own conditions (`active`, `days`, `startTime`/`endTime`,
`startDate`/`endDate`, category scope, `minDurationMinutes`, `minGameCount`) before
applying it — it trusts whatever `offerId` the frontend sends, and Task 8's
eligibility check is the only gate, entirely client-side. This was flagged during
Task 2's review as a deliberate (if not explicitly pre-approved) scope boundary, not
a bug this task should silently fix — raise it explicitly in the final review so a
human can decide whether backend-side re-validation belongs in this plan or a
follow-up.

---

### Task 10: Comprehensive end-to-end test suite

**Files:**
- Create: `apps/desktop/e2e/specs/11-offers-and-discounts.spec.ts`

**Interfaces:**
- Consumes: `connectToApp`, `connectToWeb`, `login`, `loginWeb`, `navigateTo` (from
  `apps/desktop/e2e/helpers.ts`, already used by every other spec — read
  `06-cross-app-sync.spec.ts` and `05-roles.spec.ts` in full before writing this task,
  as the two closest structural precedents: cross-app sync waiting pattern, and
  role-permission-gating pattern).

- [ ] **Step 1: Create `apps/desktop/e2e/specs/11-offers-and-discounts.spec.ts`**

```ts
import { test, expect, type Page, type Browser } from '@playwright/test';
import { connectToApp, connectToWeb, login, loginWeb, navigateTo } from '../helpers';
import { branding } from '../../src/config/branding';

const DESKTOP_SYNC_WAIT = 35_000;

test.describe.serial('offers and discounts', () => {
  let desktopPage: Page;
  let webBrowser: Browser;
  let webPage: Page;

  async function reloadWebAndWait() {
    await webPage.reload();
    await expect(webPage.getByRole('button', { name: 'Daily Sales' })).toBeVisible({ timeout: 15_000 });
  }

  async function waitForDesktopSync() {
    await desktopPage.bringToFront();
    await desktopPage.waitForTimeout(DESKTOP_SYNC_WAIT);
  }

  test.beforeAll(async () => {
    desktopPage = await connectToApp();
    await login(desktopPage);
    ({ browser: webBrowser, page: webPage } = await connectToWeb());
    await loginWeb(webPage);
  });

  test.afterAll(async () => {
    await desktopPage.getByTestId('logout-button').click();
    await webPage.getByTestId('logout-button').click();
    await webBrowser.close();
  });

  test('Owner creates an offer scoped to a specific category', async () => {
    await navigateTo(desktopPage, 'Offers');
    await desktopPage.getByRole('button', { name: '+ New offer' }).click();
    await desktopPage.getByLabel('Name').fill('E2E Weekday Special');
    // "All categories" defaults checked -- uncheck it to scope to 8-Ball only.
    await desktopPage.getByLabel('All categories').uncheck();
    await desktopPage.getByRole('checkbox', { name: '8-Ball' }).check();
    await desktopPage.getByLabel(/Minimum duration/).fill('90');
    await desktopPage.getByLabel('Effect value').fill('30');
    await desktopPage.getByRole('button', { name: 'Save' }).click();

    await expect(desktopPage.getByText('E2E Weekday Special')).toBeVisible();
    await expect(desktopPage.getByText('8-Ball', { exact: true })).toBeVisible();
  });

  test('Cashier cannot see Offers Management, but Owner can', async () => {
    // Reuses this repo's existing custom-role pattern (see 05-roles.spec.ts) --
    // a role with no offerManagement permission must not show the nav item.
    await navigateTo(desktopPage, 'Roles');
    const newRoleCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'Add role' });
    await newRoleCard.locator('#new-role-name').fill('E2E No Offers Role');
    await newRoleCard.getByLabel('Daily Sales').check();
    await newRoleCard.getByRole('button', { name: 'Create role' }).click();
    await expect(desktopPage.getByText('E2E No Offers Role')).toBeVisible();

    await navigateTo(desktopPage, 'User Management');
    await desktopPage.locator('#user-name').fill('E2E No Offers User');
    await desktopPage.locator('#user-username').fill('e2e-no-offers');
    await desktopPage.locator('#user-pin').fill('9012');
    await desktopPage.locator('#user-role').click();
    await desktopPage.getByRole('option', { name: 'E2E No Offers Role' }).click();
    await desktopPage.getByRole('button', { name: 'Create user' }).click();
    await expect(desktopPage.getByRole('cell', { name: 'e2e-no-offers' })).toBeVisible();

    await desktopPage.getByTestId('logout-button').click();
    await login(desktopPage, 'e2e-no-offers', '9012');
    await expect(desktopPage.getByRole('button', { name: 'Offers', exact: true })).toHaveCount(0);

    await desktopPage.getByTestId('logout-button').click();
    await login(desktopPage);
    await expect(desktopPage.getByRole('button', { name: 'Offers', exact: true })).toBeVisible();
  });

  test('a time-billed session becomes eligible, the discount applies, and it can be cleared', async () => {
    test.setTimeout(60_000);
    await navigateTo(desktopPage, 'Daily Sales');
    const stationCard = desktopPage.getByTestId('resource-card-8-Ball-Table 1');
    await stationCard.getByRole('button', { name: '+ Add session' }).click();
    const row = stationCard.getByTestId('session-row').last();

    // 8-Ball is 200/hr per the shared fixture rate -- 1.5h = 300, meets the
    // offer's 90-minute minimum.
    await row.getByLabel('Start time').fill('13:00');
    await row.getByLabel('End time').fill('14:30');
    await expect(row.getByLabel('Amount')).toHaveValue('300');

    await expect(row.getByText('E2E Weekday Special available')).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button', { name: 'Apply?' }).click();

    // 30 min free of a 90-min session -- 60 billable min at 200/hr = 200.
    await expect(row.getByLabel('Amount')).toHaveValue('200');
    await expect(row.getByText(/E2E Weekday Special applied/)).toBeVisible();
    await expect(row.getByText(new RegExp(`saved ${branding.currencySymbol}100`))).toBeVisible();

    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(row.getByLabel('Amount')).toHaveValue('300');
    await expect(row.getByText(/E2E Weekday Special applied/)).toHaveCount(0);

    await row.getByRole('button', { name: 'Delete session' }).click();
  });

  test('the applied offer and discount sync to web read-only', async () => {
    test.setTimeout(60_000);
    await navigateTo(desktopPage, 'Daily Sales');
    const stationCard = desktopPage.getByTestId('resource-card-8-Ball-Table 1');
    await stationCard.getByRole('button', { name: '+ Add session' }).click();
    const row = stationCard.getByTestId('session-row').last();
    await row.getByLabel('Start time').fill('13:00');
    await row.getByLabel('End time').fill('14:30');
    await row.getByRole('button', { name: 'Apply?' }).click();
    await expect(row.getByLabel('Amount')).toHaveValue('200');

    await waitForDesktopSync();
    await reloadWebAndWait();
    await navigateTo(webPage, 'Daily Sales');
    const webStationCard = webPage.getByTestId('resource-card-8-Ball-Table 1');
    const webRow = webStationCard.getByTestId('session-row').last();
    await expect(webRow).toContainText(`${branding.currencySymbol}200`);
    await expect(webRow).toContainText('E2E Weekday Special');
    await expect(webRow).toContainText(`${branding.currencySymbol}100`);

    await desktopPage.bringToFront();
    await row.getByRole('button', { name: 'Delete session' }).click();
  });

  test('a frame-billed quantity offer prompts exactly on the Nth game for the right customer', async () => {
    test.setTimeout(90_000);
    await navigateTo(desktopPage, 'Offers');
    await desktopPage.getByRole('button', { name: '+ New offer' }).click();
    await desktopPage.getByLabel('Name').fill('E2E Play 3 Get 1 Free');
    await desktopPage.getByLabel('All categories').uncheck();
    await desktopPage.getByRole('checkbox', { name: 'Snooker' }).check();
    await desktopPage.getByLabel(/Minimum game count/).fill('4');
    await desktopPage.getByRole('button', { name: 'Save' }).click();
    await expect(desktopPage.getByText('E2E Play 3 Get 1 Free')).toBeVisible();

    await navigateTo(desktopPage, 'Customers');
    await desktopPage.locator('#customer-name').fill('E2E Frame Offer Customer');
    await desktopPage.getByRole('button', { name: 'Add customer', exact: true }).click();
    await expect(desktopPage.getByRole('cell', { name: 'E2E Frame Offer Customer', exact: true })).toBeVisible();

    await navigateTo(desktopPage, 'Daily Sales');
    const stationCard = desktopPage.getByTestId('resource-card-Snooker-Table 1');

    for (let i = 0; i < 3; i++) {
      await stationCard.getByRole('button', { name: '+ Add session' }).click();
      const row = stationCard.getByTestId('session-row').last();
      await row.getByLabel('Customer').click();
      await desktopPage.getByRole('button', { name: 'E2E Frame Offer Customer', exact: true }).click();
      // No prompt should appear on games 1-3.
      await expect(row.getByText(/E2E Play 3 Get 1 Free available/)).toHaveCount(0);
    }

    await stationCard.getByRole('button', { name: '+ Add session' }).click();
    const fourthRow = stationCard.getByTestId('session-row').last();
    await fourthRow.getByLabel('Customer').click();
    await desktopPage.getByRole('button', { name: 'E2E Frame Offer Customer', exact: true }).click();
    await expect(fourthRow.getByText('E2E Play 3 Get 1 Free available')).toBeVisible({ timeout: 10_000 });

    // Clean up: delete all 4 sessions and the customer.
    for (let i = 0; i < 4; i++) {
      await stationCard.getByTestId('session-row').last().getByRole('button', { name: 'Delete session' }).click();
    }
    await navigateTo(desktopPage, 'Customers');
    await desktopPage.getByRole('button', { name: 'Delete E2E Frame Offer Customer' }).click();
  });

  test('cleanup: deactivate the two E2E offers', async () => {
    await navigateTo(desktopPage, 'Offers');
    const weekdaySpecialCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'E2E Weekday Special' });
    await weekdaySpecialCard.getByRole('button', { name: 'Deactivate' }).click();
    const frameOfferCard = desktopPage.locator('[data-slot="card"]').filter({ hasText: 'E2E Play 3 Get 1 Free' });
    await frameOfferCard.getByRole('button', { name: 'Deactivate' }).click();
  });
});
```

This spec is a best-effort draft based on the conventions of `05-roles.spec.ts` and
`06-cross-app-sync.spec.ts` — during implementation, verify every selector against
the actual rendered markup from Tasks 5-8 (exact label text for the "Minimum
duration"/"Minimum game count"/"Effect value" fields, the exact wording of the
apply-prompt and applied-offer text, the exact category `data-testid` names for
Snooker's station) and adjust any that don't match. Do not silently skip a
mismatched selector — fix the test to match the real UI, or fix the UI's
`aria-label`/text if the mismatch reveals the UI itself is unclear.

- [ ] **Step 2: Run the new spec against the real app**

Run: `cd apps/desktop && pnpm exec playwright test e2e/specs/11-offers-and-discounts.spec.ts`
Expected: all tests in the file pass against the real compiled app + live Postgres
(same infrastructure every other spec in this directory already uses).

- [ ] **Step 3: Run the full existing e2e suite to confirm no regression**

Run: `cd apps/desktop && pnpm exec playwright test`
Expected: all specs pass, including `06-cross-app-sync.spec.ts` (the closest
neighbor to this new spec) and `07-quick-session-duration.spec.ts` (shares
`SessionRow` markup with the offer-eligibility UI added in Task 8).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/e2e/specs/11-offers-and-discounts.spec.ts
git commit -m "test(desktop): end-to-end coverage for offer creation, application, sync, and permission gating"
```

---

## Final verification (after all 10 tasks)

- [ ] `cargo test` in `apps/desktop/src-tauri` — full suite green.
- [ ] `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
  exec tsc -b` — both clean.
- [ ] `cd apps/api && npx vitest run && npx vitest run --config vitest.integration.config.ts` — both green.
- [ ] Full desktop e2e suite, in particular any spec touching Daily Sales, Rate
  Management, and cross-app sync.
- [ ] **Manually re-run `cd apps/api && npm run seed`** against every Postgres
  environment this branch will run against (local dev, staging, production) — this
  is not automatic and is easy to forget; without it, `offerManagement` exists in
  code but no role actually has the permission, so the new nav item silently never
  appears for anyone.
- [ ] Manual end-to-end check (`pnpm dev` on both apps): the full motivating example
  end to end — create the "Weekday Special" offer as Owner, apply it to a session as
  Cashier, confirm the discount is visible and correct, confirm it syncs to web,
  confirm a Cashier cannot see the Offers Management nav item.
