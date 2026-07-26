# Session/OrderItem metadata snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nullable `metadata` JSON snapshot column to `sessions` and `order_items` (desktop SQLite + API Postgres) that records the rate/product-price context behind `amount`/`unitPrice` at write time, for future reference only.

**Architecture:** Thread a new nullable `metadata TEXT`/`Json?` column through the existing snapshot-at-write-time pattern already used for `amount` and `unitPrice`/`lineTotal`. Populate it at the exact point those columns are computed (session create/update, order-item create), propagate it through the existing outbox push/pull sync machinery unchanged, and mirror the column on the API's Prisma schema so it survives a push. No new tables, no new commands, no UI, no calculation ever reads it back.

**Tech Stack:** Rust (sqlx/SQLite, Tauri commands) for `apps/desktop/src-tauri`; TypeScript for `apps/desktop/src`; Prisma/Postgres for `apps/api`.

## Global Constraints

- No UI surfaces `metadata` anywhere.
- No calculation logic reads `metadata` back — `amount`/`unitPrice`/`lineTotal` stay authoritative, computed exactly as today.
- No backfill of historical rows — pre-existing rows keep `metadata = NULL`.
- No discount field — discounts aren't implemented anywhere in this codebase; nothing to snapshot for them yet.
- Frame-billed sessions' `amount` is never recomputed on update (existing behavior, untouched) — so their `metadata` is write-once, at creation. Time-billed sessions' `metadata` is (re)written every time `amount` is recomputed on update.

---

### Task 1: Desktop schema + model/query plumbing (metadata always `NULL` for now)

**Files:**
- Create: `apps/desktop/src-tauri/migrations/0004_metadata.sql`
- Modify: `apps/desktop/src-tauri/src/models.rs:44-57` (`Session`), `:118-128` (`OrderItem`)
- Modify: `apps/desktop/src-tauri/src/commands/sessions.rs` (SELECT lists, `session_payload`, `do_create_session`, `do_update_session`)
- Modify: `apps/desktop/src-tauri/src/commands/orders.rs` (SELECT list, `do_create_order`, `oi_payload`)
- Modify: `apps/desktop/src-tauri/src/commands/sync.rs` (`"sessions"` and `"orderItems"` pull-side upsert branches, so a value pulled from another device/the server round-trips into local SQLite)
- Modify: `apps/desktop/src/lib/tauri/commands.ts:42-53` (`SessionRow`), `:135-143` (`OrderItemRow`)

**Interfaces:**
- Produces: `Session.metadata: Option<String>` and `OrderItem.metadata: Option<String>` (Rust), `SessionRow.metadata: string | null` and `OrderItemRow.metadata: string | null` (TS) — a raw JSON-encoded string, or `null`/`None`. Task 2 and Task 3 are the only places that ever write a non-`None` value into these fields.

- [ ] **Step 1: Add the migration**

Create `apps/desktop/src-tauri/migrations/0004_metadata.sql`:

```sql
-- Nullable JSON-as-text snapshot of the pricing context (rate or product
-- price) that produced amount/unit_price, captured at write time for
-- reference only -- never read back by any query or UI.
ALTER TABLE sessions ADD COLUMN metadata TEXT;
ALTER TABLE order_items ADD COLUMN metadata TEXT;
```

- [ ] **Step 2: Add the field to both Rust structs**

In `apps/desktop/src-tauri/src/models.rs`, `Session` (currently lines 44-57), add `metadata` after `deleted_at`:

```rust
#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub station_id: String,
    pub date: String,
    pub start: String,
    pub end: String,
    pub amount: i64,
    pub method: String,
    pub customer_id: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub metadata: Option<String>,
}
```

And `OrderItem` (currently lines 118-128), add `metadata` after `updated_at`:

```rust
#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrderItem {
    pub id: String,
    pub order_id: String,
    pub product_id: String,
    pub qty: i64,
    pub unit_price: i64,
    pub line_total: i64,
    pub updated_at: String,
    pub metadata: Option<String>,
}
```

- [ ] **Step 3: Thread `metadata` through every Session SELECT/INSERT/UPDATE and the payload builder in `sessions.rs`**

`do_list_all_sessions` — change the query to:
```rust
"SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
 FROM sessions WHERE deleted_at IS NULL",
```

`do_list_sessions_between` — change the query to:
```rust
"SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
 FROM sessions WHERE date >= ? AND date <= ? AND deleted_at IS NULL",
```

`do_list_sessions_for_date` — change the query to:
```rust
"SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
 FROM sessions WHERE date = ? AND deleted_at IS NULL",
```

`session_payload` (currently lines 71-78) — add the `metadata` key, parsed back into a JSON value (not double-encoded as a string) so it lands in Postgres as a real JSON object later:
```rust
fn session_payload(s: &Session, created_by: &Option<String>, updated_by: &Option<String>) -> serde_json::Value {
    json!({
        "id": s.id, "stationId": s.station_id, "date": s.date, "start": s.start, "end": s.end,
        "amount": s.amount, "method": s.method, "customerId": s.customer_id,
        "updatedAt": s.updated_at, "deletedAt": s.deleted_at,
        "createdBy": created_by, "updatedBy": updated_by,
        "metadata": s.metadata.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
    })
}
```

`do_create_session` — add `metadata: None,` to the `Session { ... }` literal (right after `deleted_at: None,`), and add the column to the INSERT:
```rust
sqlx::query(
    "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
)
.bind(&session.id)
.bind(&session.station_id)
.bind(&session.date)
.bind(&session.start)
.bind(&session.end)
.bind(session.amount)
.bind(&session.method)
.bind(&session.customer_id)
.bind(&session.updated_at)
.bind(&session.metadata)
.bind(&actor)
.bind(&actor)
.execute(&mut *tx)
.await
.map_err(|e| e.to_string())?;
```

`do_update_session` — add `metadata` to the existing-row SELECT:
```rust
let mut existing: Session = sqlx::query_as(
    "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
     FROM sessions WHERE id = ?",
)
```
and add `metadata = ?` to the UPDATE, binding `existing.metadata` (this task leaves the value untouched — Task 2 is what actually assigns a new value to `existing.metadata` inside the `time_patched` branch):
```rust
sqlx::query(
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
.execute(&mut *tx)
.await
.map_err(|e| e.to_string())?;
```

- [ ] **Step 4: Thread `metadata` through the OrderItem SELECT/INSERT and payload builder in `orders.rs`**

`do_list_order_items_between` — change the query to:
```rust
"SELECT oi.id, oi.order_id, oi.product_id, oi.qty, oi.unit_price, oi.line_total, oi.updated_at, oi.metadata
 FROM order_items oi
 JOIN orders o ON o.id = oi.order_id
 WHERE o.deleted_at IS NULL AND o.updated_at >= ? AND o.updated_at < ?",
```

`do_create_order`'s per-item loop — add the column to the INSERT and `metadata: None,` to the `OrderItem { ... }` literal (Task 3 replaces the `None` with a real snapshot):
```rust
sqlx::query(
    "INSERT INTO order_items (id, order_id, product_id, qty, unit_price, line_total, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
)
.bind(&order_item_id)
.bind(&order_id)
.bind(&product.id)
.bind(qty)
.bind(product.price)
.bind(line_total)
.bind(&now)
.bind(None::<String>)
.execute(&mut *tx)
.await
.map_err(|e| e.to_string())?;
let oi = OrderItem {
    id: order_item_id,
    order_id: order_id.clone(),
    product_id: product.id.clone(),
    qty,
    unit_price: product.price,
    line_total,
    updated_at: now.clone(),
    metadata: None,
};
let oi_payload = json!({
    "id": oi.id, "orderId": oi.order_id, "productId": oi.product_id,
    "qty": oi.qty, "unitPrice": oi.unit_price, "lineTotal": oi.line_total, "updatedAt": oi.updated_at,
    "metadata": oi.metadata.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
});
```

- [ ] **Step 5: Thread `metadata` through the pull-side sync upsert in `sync.rs`**

This is what lets a `metadata` value created on one device (pushed to the server) land in another device's local SQLite when it pulls. In the `"sessions"` branch:
```rust
"sessions" => {
    if !is_newer(tx, "sessions", &id, row).await? {
        return Ok(());
    }
    let metadata: Option<String> = match &row["metadata"] {
        serde_json::Value::Null => None,
        v => Some(v.to_string()),
    };
    sqlx::query(
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET station_id = excluded.station_id, date = excluded.date,
           start = excluded.start, \"end\" = excluded.\"end\", amount = excluded.amount,
           method = excluded.method, customer_id = excluded.customer_id,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, metadata = excluded.metadata",
    )
    .bind(&id)
    .bind(row["stationId"].as_str().unwrap_or_default())
    .bind(row["date"].as_str().unwrap_or_default())
    .bind(row["start"].as_str().unwrap_or_default())
    .bind(row["end"].as_str().unwrap_or_default())
    .bind(row["amount"].as_i64().unwrap_or(0))
    .bind(row["method"].as_str().unwrap_or_default())
    .bind(row["customerId"].as_str())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .bind(metadata)
    .execute(&mut **tx)
    .await?;
}
```

And in the `"orderItems"` branch:
```rust
"orderItems" => {
    if !is_newer(tx, "order_items", &id, row).await? {
        return Ok(());
    }
    let metadata: Option<String> = match &row["metadata"] {
        serde_json::Value::Null => None,
        v => Some(v.to_string()),
    };
    sqlx::query(
        "INSERT INTO order_items (id, order_id, product_id, qty, unit_price, line_total, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET order_id = excluded.order_id, product_id = excluded.product_id,
           qty = excluded.qty, unit_price = excluded.unit_price, line_total = excluded.line_total,
           updated_at = excluded.updated_at, metadata = excluded.metadata",
    )
    .bind(&id)
    .bind(row["orderId"].as_str().unwrap_or_default())
    .bind(row["productId"].as_str().unwrap_or_default())
    .bind(row["qty"].as_i64().unwrap_or(0))
    .bind(row["unitPrice"].as_i64().unwrap_or(0))
    .bind(row["lineTotal"].as_i64().unwrap_or(0))
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(metadata)
    .execute(&mut **tx)
    .await?;
}
```

- [ ] **Step 6: Add the field to the TS row types**

In `apps/desktop/src/lib/tauri/commands.ts`, add to `SessionRow` (after `deletedAt`):
```ts
export interface SessionRow {
  id: string;
  stationId: string;
  date: string;
  start: string;
  end: string;
  amount: number;
  method: 'Cash' | 'Card' | 'Credit';
  customerId: string | null;
  updatedAt: string;
  deletedAt: string | null;
  metadata: string | null;
}
```
and to `OrderItemRow` (after `updatedAt`):
```ts
export interface OrderItemRow {
  id: string;
  orderId: string;
  productId: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  updatedAt: string;
  metadata: string | null;
}
```

- [ ] **Step 7: Verify nothing broke**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all existing tests pass (they will now also implicitly exercise the widened SELECT/INSERT/UPDATE statements and the new migration, since `setup_test_db()` runs every migration in the folder).

Run: `cd apps/desktop && npx tsc -b`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/migrations/0004_metadata.sql apps/desktop/src-tauri/src/models.rs apps/desktop/src-tauri/src/commands/sessions.rs apps/desktop/src-tauri/src/commands/orders.rs apps/desktop/src-tauri/src/commands/sync.rs apps/desktop/src/lib/tauri/commands.ts
git commit -m "feat(desktop): add nullable metadata column to sessions and order_items"
```

---

### Task 2: Populate `Session.metadata` with the rate snapshot

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/sessions.rs` (`do_create_session`, `do_update_session`, test module)

**Interfaces:**
- Consumes: `Session.metadata: Option<String>` (Task 1).
- Produces: for frame billing, `metadata` = `{"billingType":"frame","rateValue":<int>}`; for time billing, `metadata` = `{"billingType":"time","hourRate":<int>,"halfRate":<int>}`. No other shapes are ever written.

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block in `apps/desktop/src-tauri/src/commands/sessions.rs` (after `a_frame_session_gets_its_amount_immediately_with_no_start_end`):

```rust
#[tokio::test]
async fn a_frame_session_stores_the_rate_used_as_metadata() {
    let pool = setup_test_db().await;
    let (station_id, category_id) = seed_frame_station(&pool, 150).await;

    let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
        .await
        .unwrap();

    let metadata: serde_json::Value = serde_json::from_str(session.metadata.as_deref().unwrap()).unwrap();
    assert_eq!(metadata["billingType"], "frame");
    assert_eq!(metadata["rateValue"], 150);
}

#[tokio::test]
async fn a_time_session_has_no_metadata_until_the_first_recompute_then_stores_both_rates() {
    let pool = setup_test_db().await;
    let (station_id, category_id) = seed_time_station(&pool, 200, 100).await;
    let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-25".to_string())
        .await
        .unwrap();
    assert!(session.metadata.is_none(), "no rate has been used yet -- amount is still 0");

    let updated = do_update_session(
        &pool,
        session.id,
        SessionPatch { start: Some("09:00".to_string()), end: Some("10:30".to_string()), ..Default::default() },
    )
    .await
    .unwrap();

    let metadata: serde_json::Value = serde_json::from_str(updated.metadata.as_deref().unwrap()).unwrap();
    assert_eq!(metadata["billingType"], "time");
    assert_eq!(metadata["hourRate"], 200);
    assert_eq!(metadata["halfRate"], 100);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test a_frame_session_stores_the_rate_used_as_metadata a_time_session_has_no_metadata_until_the_first_recompute_then_stores_both_rates`
Expected: both FAIL — `session.metadata`/`updated.metadata` are `None` because nothing populates them yet.

- [ ] **Step 3: Populate metadata in `do_create_session`'s frame branch**

Replace the `let amount = ...` block with:
```rust
let (amount, metadata) = if billing_type == "frame" {
    let rate: Option<(Option<i64>,)> =
        sqlx::query_as("SELECT frame_rate FROM rates WHERE category_id = ?")
            .bind(&category_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let rate_value = rate.and_then(|r| r.0).unwrap_or(0);
    let metadata = json!({"billingType": "frame", "rateValue": rate_value}).to_string();
    (calc_frame_amount(rate_value), Some(metadata))
} else {
    (0, None)
};
```
and change the `Session { ... }` literal's `metadata: None,` to `metadata,` (using the shorthand, since the local variable is now named `metadata`).

- [ ] **Step 4: Populate metadata in `do_update_session`'s time-recompute branch**

Inside `if let Some((billing_type, hour_rate, half_rate)) = rate { if billing_type == "time" { ... } }`, after the `calc_time_amount` call, add the metadata assignment:
```rust
if billing_type == "time" {
    existing.amount = calc_time_amount(
        &existing.start,
        &existing.end,
        hour_rate.unwrap_or(0),
        half_rate.unwrap_or(0),
    );
    existing.metadata = Some(
        json!({"billingType": "time", "hourRate": hour_rate.unwrap_or(0), "halfRate": half_rate.unwrap_or(0)}).to_string(),
    );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all tests pass, including the two new ones and the full existing suite (amount values are unaffected — only the extra `metadata` assignment was added alongside them).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/sessions.rs
git commit -m "feat(desktop): snapshot the rate used into Session.metadata"
```

---

### Task 3: Populate `OrderItem.metadata` with the product snapshot

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/orders.rs` (`do_create_order`, test module)

**Interfaces:**
- Consumes: `OrderItem.metadata: Option<String>` (Task 1), `Product { name, category_id, price, .. }` (existing).
- Produces: `metadata` = `{"productName":<string>,"categoryId":<string>,"unitPrice":<int>}` for every order item, written once at checkout.

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `apps/desktop/src-tauri/src/commands/orders.rs` (after `checks_out_a_cash_order_and_decrements_stock`):

```rust
#[tokio::test]
async fn checkout_stores_a_product_snapshot_as_metadata() {
    let pool = setup_test_db().await;
    let product = seed_product(&pool, 10).await;

    let result = do_create_order(
        &pool,
        vec![CartItemInput { product_id: product.id.clone(), qty: 2 }],
        "Cash".to_string(),
        None,
    )
    .await
    .unwrap();

    let metadata: serde_json::Value =
        serde_json::from_str(result.items[0].metadata.as_deref().unwrap()).unwrap();
    assert_eq!(metadata["productName"], "Cola");
    assert_eq!(metadata["categoryId"], product.category_id);
    assert_eq!(metadata["unitPrice"], 50);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test checkout_stores_a_product_snapshot_as_metadata`
Expected: FAIL — `result.items[0].metadata` is `None`.

- [ ] **Step 3: Populate metadata in `do_create_order`'s per-item loop**

Replace the item-insert block (from `let order_item_id = ...` through the `oi_payload` `json!` call) with:
```rust
let order_item_id = Uuid::new_v4().to_string();
let metadata = json!({
    "productName": product.name,
    "categoryId": product.category_id,
    "unitPrice": product.price,
})
.to_string();
sqlx::query(
    "INSERT INTO order_items (id, order_id, product_id, qty, unit_price, line_total, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
)
.bind(&order_item_id)
.bind(&order_id)
.bind(&product.id)
.bind(qty)
.bind(product.price)
.bind(line_total)
.bind(&now)
.bind(&metadata)
.execute(&mut *tx)
.await
.map_err(|e| e.to_string())?;
let oi = OrderItem {
    id: order_item_id,
    order_id: order_id.clone(),
    product_id: product.id.clone(),
    qty,
    unit_price: product.price,
    line_total,
    updated_at: now.clone(),
    metadata: Some(metadata),
};
let oi_payload = json!({
    "id": oi.id, "orderId": oi.order_id, "productId": oi.product_id,
    "qty": oi.qty, "unitPrice": oi.unit_price, "lineTotal": oi.line_total, "updatedAt": oi.updated_at,
    "metadata": oi.metadata.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/orders.rs
git commit -m "feat(desktop): snapshot the product used into OrderItem.metadata"
```

---

### Task 4: API Prisma schema + migration + sync round-trip verification

**Files:**
- Modify: `apps/api/prisma/schema.prisma:175-196` (`Session` model), `:320-333` (`OrderItem` model)
- Modify: `apps/api/src/integration-tests/api.integration.test.ts`

**Interfaces:**
- Consumes: the outbox payload's `metadata` key produced by Task 1/2/3 (`session_payload`/`oi_payload` in `sessions.rs`/`orders.rs`), applied generically by `sync.service.ts`'s existing `{ ...payload }` spread (`sync.service.ts:85-91`, `:169-` for orderItems) — no changes needed to `sync.service.ts` itself.
- Produces: `Session.metadata: Json | null` and `OrderItem.metadata: Json | null` on the Postgres side.

- [ ] **Step 1: Write the failing integration test**

Add to `apps/api/src/integration-tests/api.integration.test.ts`, in the `GET /sessions` section (after `GET /sessions excludes soft-deleted sessions`):

```ts
it('a pushed session metadata payload round-trips into the Session row', async () => {
  const station = await prisma.station.findFirstOrThrow({ where: { name: 'Table 1' } });
  const sessionId = crypto.randomUUID();

  await fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      entries: [{
        table: 'sessions', op: 'upsert', id: sessionId,
        payload: {
          id: sessionId, stationId: station.id, date: '2026-07-01', start: '09:00', end: '10:30',
          amount: 300, method: 'Cash', customerId: null,
          metadata: { billingType: 'time', hourRate: 200, halfRate: 100 },
        },
        clientUpdatedAt: new Date().toISOString(),
      }],
    }),
  });

  const row = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  expect(row.metadata).toEqual({ billingType: 'time', hourRate: 200, halfRate: 100 });

  await prisma.session.deleteMany({ where: { id: sessionId } });
});
```

- [ ] **Step 2: Run the test to verify it fails**

This requires the local Postgres from `apps/api/.env` (`DATABASE_URL`) to be running.

Run: `cd apps/api && pnpm test:integration -- -t "a pushed session metadata payload round-trips"`
Expected: FAILS — `entry.payload` contains an unrecognized `metadata` key that the current `Session` Prisma model has no column for, so `tx.session.upsert(...)` throws (`Unknown argument metadata`).

- [ ] **Step 3: Add `metadata` to the Prisma schema**

In `apps/api/prisma/schema.prisma`, add to `model Session` (after `deletedAt`):
```prisma
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
  metadata   Json?

  createdBy     String?
  createdByUser User?   @relation("SessionCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  updatedBy     String?
  updatedByUser User?   @relation("SessionUpdatedBy", fields: [updatedBy], references: [id], onDelete: SetNull)

  @@index([date])
  @@index([customerId])
  @@index([stationId])
}
```

And to `model OrderItem` (after `updatedAt`) — no test exercises this one directly in this task, but it must land in the same migration since Task 1/3 already push a `metadata` key for order items too:
```prisma
model OrderItem {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  qty       Int
  unitPrice Int
  lineTotal Int
  updatedAt DateTime @default(now())
  metadata  Json?

  @@index([orderId])
  @@index([productId])
}
```

- [ ] **Step 4: Generate and run the Prisma migration**

Run: `cd apps/api && pnpm run prisma:migrate -- --name add_metadata_to_session_and_order_item`
Expected: a new migration folder under `apps/api/prisma/migrations/` containing `ALTER TABLE "Session" ADD COLUMN "metadata" JSONB;` and `ALTER TABLE "OrderItem" ADD COLUMN "metadata" JSONB;`, applied successfully.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && pnpm test:integration -- -t "a pushed session metadata payload round-trips"`
Expected: PASS.

- [ ] **Step 6: Run the full API test suites**

Run: `cd apps/api && pnpm test:integration`
Expected: full integration suite passes.

Run: `cd apps/api && pnpm test`
Expected: all passing (no unit test constructs a `Session`/`OrderItem` Prisma input literal that would need a `metadata` key — it's optional).

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/integration-tests/api.integration.test.ts
git commit -m "feat(api): add metadata column to Session and OrderItem"
```
