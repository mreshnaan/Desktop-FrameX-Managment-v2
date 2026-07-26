# Rust Backend SOLID Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three genuine SOLID/structure issues in `apps/desktop/src-tauri/src/commands/` — `sync.rs`'s 230-line match statement, `orders.rs`'s 157-line checkout function, and `reports.rs`'s file-level responsibility mixing — with zero behavior change.

**Architecture:** Three independent, sequential tasks, one per file. Each task is a pure structural refactor verified by the file's existing `#[cfg(test)]` unit tests (which call the `do_*` functions directly against an in-memory SQLite pool) plus `cargo check`/`cargo clippy`. No new tests are written — the existing suite is the regression safety net, since every `do_*`/`#[tauri::command]` signature is preserved exactly.

**Tech Stack:** Rust, sqlx (SQLite), Tauri 2, tokio (async test runtime).

## Global Constraints

- No behavior change: identical SQL, identical bind order, identical error message strings, identical outbox payload shapes. This is a structural-only refactor.
- Every `pub(crate) async fn do_*` and `#[tauri::command] pub async fn` keeps its existing name and signature — the existing unit tests call these directly and must not need any edits.
- No new dynamic/generic SQL construction (a data-driven generic upsert for `sync.rs` was considered and explicitly rejected during design — see `docs/superpowers/specs/2026-07-26-rust-backend-solid-cleanup-design.md`). Each table keeps its own static, compile-time-checked SQL string.
- Verify each task with `cargo test` (in `apps/desktop/src-tauri`) before committing — the baseline test counts are 7 (`sync.rs`), 12 (`orders.rs`), 9 (`reports.rs`: 5 balance tests + 4 history tests; there are no unit tests for `do_get_monthly_report` today, confirmed by grep — only e2e coverage via `08-reporting.spec.ts`).

---

### Task 1: `sync.rs` — split `apply_one`'s 230-line match into a dispatcher + 12 per-table functions

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/sync.rs:99-353` (the `apply_one` function and everything between it and `is_newer`, inclusive of `is_newer` staying in place after the new functions)

**Interfaces:**
- Consumes: `is_newer(tx, sqlite_table, id, row)` (unchanged, stays defined later in the same file), `Value` from `serde_json` (already imported).
- Produces: `apply_one` (same private signature: `async fn apply_one(tx: &mut Transaction<'_, Sqlite>, table: &str, row: &Value) -> Result<(), sqlx::Error>`) now a thin dispatcher; 12 new private `apply_<table>` functions each `async fn(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error>`; one new private helper `fn json_metadata(row: &Value) -> Option<String>`. None of these are called from outside this file — `do_apply_pulled_rows` (unchanged) is the only caller of `apply_one`, and it is untouched.

- [ ] **Step 1: Confirm the baseline test count**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::sync`
Expected: PASS — 7 tests (`categories_always_overwrite_even_though_they_have_no_updated_at`, `last_write_wins_skips_an_incoming_row_older_than_the_local_one`, `last_write_wins_applies_an_incoming_row_newer_than_the_local_one`, `a_brand_new_row_is_always_inserted_regardless_of_last_write_wins`, `drain_outbox_returns_entries_in_insertion_order`, `delete_outbox_entries_removes_only_the_specified_ids`, plus any others already present).

- [ ] **Step 2: Replace `apply_one` (lines 99-332) with a dispatcher + 12 named functions + the `json_metadata` helper**

Replace the entire block from `async fn apply_one(` (line 99) through the closing `}` right before `// Last-write-wins:` (line 332, i.e. everything up to but not including `is_newer`'s doc comment) with:

```rust
// Both sessions and order_items carry an optional JSON metadata blob stored
// as a nullable TEXT column -- Value::Null must become a real SQL NULL, not
// the string "null".
fn json_metadata(row: &Value) -> Option<String> {
    match &row["metadata"] {
        Value::Null => None,
        v => Some(v.to_string()),
    }
}

async fn apply_one(
    tx: &mut Transaction<'_, Sqlite>,
    table: &str,
    row: &Value,
) -> Result<(), sqlx::Error> {
    let id = row["id"].as_str().unwrap_or_default().to_string();

    match table {
        "categories" => apply_categories(tx, &id, row).await,
        "stations" => apply_stations(tx, &id, row).await,
        "rates" => apply_rates(tx, &id, row).await,
        "customers" => apply_customers(tx, &id, row).await,
        "sessions" => apply_sessions(tx, &id, row).await,
        "expenses" => apply_expenses(tx, &id, row).await,
        "creditEntries" => apply_credit_entries(tx, &id, row).await,
        "productCategories" => apply_product_categories(tx, &id, row).await,
        "products" => apply_products(tx, &id, row).await,
        "orders" => apply_orders(tx, &id, row).await,
        "orderItems" => apply_order_items(tx, &id, row).await,
        "stockMovements" => apply_stock_movements(tx, &id, row).await,
        _ => Ok(()),
    }
}

async fn apply_categories(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO categories (id, name, billing_type) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, billing_type = excluded.billing_type",
    )
    .bind(id)
    .bind(row["name"].as_str().unwrap_or_default())
    .bind(row["billingType"].as_str().unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_stations(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO stations (id, category_id, name) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name",
    )
    .bind(id)
    .bind(row["categoryId"].as_str().unwrap_or_default())
    .bind(row["name"].as_str().unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_rates(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "rates", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO rates (id, category_id, hour_rate, half_rate, frame_rate, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, hour_rate = excluded.hour_rate,
           half_rate = excluded.half_rate, frame_rate = excluded.frame_rate, updated_at = excluded.updated_at",
    )
    .bind(id)
    .bind(row["categoryId"].as_str().unwrap_or_default())
    .bind(row["hour"].as_i64())
    .bind(row["half"].as_i64())
    .bind(row["value"].as_i64())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_customers(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "customers", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO customers (id, name, phone, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    )
    .bind(id)
    .bind(row["name"].as_str().unwrap_or_default())
    .bind(row["phone"].as_str().unwrap_or_default())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_sessions(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "sessions", id, row).await? {
        return Ok(());
    }
    let metadata = json_metadata(row);
    sqlx::query(
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
    .bind(row["method"].as_str().unwrap_or_default())
    .bind(row["customerId"].as_str())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .bind(metadata)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_expenses(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "expenses", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO expenses (id, date, description, amount, method, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET date = excluded.date, description = excluded.description,
           amount = excluded.amount, method = excluded.method, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at",
    )
    .bind(id)
    .bind(row["date"].as_str().unwrap_or_default())
    .bind(row["description"].as_str().unwrap_or_default())
    .bind(row["amount"].as_i64().unwrap_or(0))
    .bind(row["method"].as_str().unwrap_or_default())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_credit_entries(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "credit_entries", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO credit_entries (id, customer_id, date, type, amount, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, date = excluded.date,
           type = excluded.type, amount = excluded.amount, updated_at = excluded.updated_at",
    )
    .bind(id)
    .bind(row["customerId"].as_str().unwrap_or_default())
    .bind(row["date"].as_str().unwrap_or_default())
    .bind(row["type"].as_str().unwrap_or_default())
    .bind(row["amount"].as_i64().unwrap_or(0))
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_product_categories(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO product_categories (id, name) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
    )
    .bind(id)
    .bind(row["name"].as_str().unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_products(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "products", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO products (id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name,
           price = excluded.price, cost = excluded.cost, stock_qty = excluded.stock_qty,
           low_stock_threshold = excluded.low_stock_threshold, barcode = excluded.barcode,
           active = excluded.active, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    )
    .bind(id)
    .bind(row["categoryId"].as_str().unwrap_or_default())
    .bind(row["name"].as_str().unwrap_or_default())
    .bind(row["price"].as_i64().unwrap_or(0))
    .bind(row["cost"].as_i64())
    .bind(row["stockQty"].as_i64().unwrap_or(0))
    .bind(row["lowStockThreshold"].as_i64().unwrap_or(0))
    .bind(row["barcode"].as_str())
    .bind(row["active"].as_bool().unwrap_or(true))
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_orders(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "orders", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO orders (id, method, total, customer_id, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET method = excluded.method, total = excluded.total,
           customer_id = excluded.customer_id, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    )
    .bind(id)
    .bind(row["method"].as_str().unwrap_or_default())
    .bind(row["total"].as_i64().unwrap_or(0))
    .bind(row["customerId"].as_str())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(row["deletedAt"].as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_order_items(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "order_items", id, row).await? {
        return Ok(());
    }
    let metadata = json_metadata(row);
    sqlx::query(
        "INSERT INTO order_items (id, order_id, product_id, qty, unit_price, line_total, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET order_id = excluded.order_id, product_id = excluded.product_id,
           qty = excluded.qty, unit_price = excluded.unit_price, line_total = excluded.line_total,
           updated_at = excluded.updated_at, metadata = excluded.metadata",
    )
    .bind(id)
    .bind(row["orderId"].as_str().unwrap_or_default())
    .bind(row["productId"].as_str().unwrap_or_default())
    .bind(row["qty"].as_i64().unwrap_or(0))
    .bind(row["unitPrice"].as_i64().unwrap_or(0))
    .bind(row["lineTotal"].as_i64().unwrap_or(0))
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .bind(metadata)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_stock_movements(tx: &mut Transaction<'_, Sqlite>, id: &str, row: &Value) -> Result<(), sqlx::Error> {
    if !is_newer(tx, "stock_movements", id, row).await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO stock_movements (id, product_id, delta, reason, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET product_id = excluded.product_id, delta = excluded.delta,
           reason = excluded.reason, note = excluded.note, updated_at = excluded.updated_at",
    )
    .bind(id)
    .bind(row["productId"].as_str().unwrap_or_default())
    .bind(row["delta"].as_i64().unwrap_or(0))
    .bind(row["reason"].as_str().unwrap_or_default())
    .bind(row["note"].as_str())
    .bind(row["updatedAt"].as_str().unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

The `// Last-write-wins:` doc comment and the `is_newer` function immediately after stay exactly where they are, unchanged.

- [ ] **Step 3: Run `cargo check` then the sync test suite**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: no errors, no warnings about unused imports (`Value`, `Sqlite`, `Transaction` are all still used).

Run: `cargo test --lib commands::sync`
Expected: PASS — same 7 tests as Step 1's baseline, all green.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/sync.rs
git commit -m "refactor(desktop): split sync.rs's apply_one match into a dispatcher + per-table functions"
```

---

### Task 2: `orders.rs` — decompose `do_create_order`'s 157-line body into named helpers

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/orders.rs:1-177` (imports and `do_create_order`)

**Interfaces:**
- Consumes: `get_current_actor`, `product_payload` (aliased `products::payload`), `enqueue_outbox_tx`, `Order`/`OrderItem`/`OrderWithItems`/`Product` from `models` (all unchanged imports, `Transaction`/`Sqlite` newly added to the `sqlx` import).
- Produces: `do_create_order` (same signature) now an orchestrator; three new private functions: `validate_cart(tx: &mut Transaction<'_, Sqlite>, items: &[CartItemInput]) -> Result<Vec<(Product, i64, i64)>, String>`, `insert_order_row(tx: &mut Transaction<'_, Sqlite>, order_id: &str, method: &str, total: i64, customer_id: &Option<String>, actor: &Option<String>, now: &str) -> Result<Order, String>`, `apply_line_item(tx: &mut Transaction<'_, Sqlite>, order_id: &str, product: &Product, qty: i64, line_total: i64, actor: &Option<String>, now: &str) -> Result<OrderItem, String>`. None of these three are called from outside this file.

- [ ] **Step 1: Confirm the baseline test count**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::orders`
Expected: PASS — 12 tests (checkout stamps created_by, checks out a cash order, stores metadata snapshot, rejects insufficient stock, rejects inactive product, rejects empty cart, rejects credit with no customer, accepts credit with customer, multi-line order sums correctly, list_orders_between filters by range, list_orders_between UTC/local-midnight regression, list_order_items_between filters by range).

- [ ] **Step 2: Update the `sqlx` import**

In `apps/desktop/src-tauri/src/commands/orders.rs`, change:

```rust
use sqlx::SqlitePool;
```

to:

```rust
use sqlx::{Sqlite, SqlitePool, Transaction};
```

- [ ] **Step 3: Replace `do_create_order` (lines 21-177) with the orchestrator + three helper functions**

Replace the entire block from `pub(crate) async fn do_create_order(` through its closing `}` (just before `#[tauri::command]\npub async fn create_order`) with:

```rust
async fn validate_cart(
    tx: &mut Transaction<'_, Sqlite>,
    items: &[CartItemInput],
) -> Result<Vec<(Product, i64, i64)>, String> {
    let mut validated: Vec<(Product, i64, i64)> = Vec::new();
    for item in items {
        let product: Product = sqlx::query_as(
            "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at
             FROM products WHERE id = ?",
        )
        .bind(&item.product_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| format!("Product {} not found", item.product_id))?;

        if !product.active {
            return Err(format!("{} is not available for sale", product.name));
        }
        if product.stock_qty < item.qty {
            return Err(format!(
                "Insufficient stock for {} (have {}, need {})",
                product.name, product.stock_qty, item.qty
            ));
        }

        let line_total = product.price * item.qty;
        validated.push((product, item.qty, line_total));
    }
    Ok(validated)
}

async fn insert_order_row(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: &str,
    method: &str,
    total: i64,
    customer_id: &Option<String>,
    actor: &Option<String>,
    now: &str,
) -> Result<Order, String> {
    sqlx::query("INSERT INTO orders (id, method, total, customer_id, updated_at, deleted_at, created_by) VALUES (?, ?, ?, ?, ?, NULL, ?)")
        .bind(order_id)
        .bind(method)
        .bind(total)
        .bind(customer_id)
        .bind(now)
        .bind(actor)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;

    let order = Order {
        id: order_id.to_string(),
        method: method.to_string(),
        total,
        customer_id: customer_id.clone(),
        updated_at: now.to_string(),
        deleted_at: None,
    };
    let order_payload = json!({
        "id": order.id, "method": order.method, "total": order.total,
        "customerId": order.customer_id, "updatedAt": order.updated_at, "deletedAt": null,
        "createdBy": actor,
    });
    enqueue_outbox_tx(tx, "orders", "upsert", order_id, &order_payload)
        .await
        .map_err(|e| e.to_string())?;

    Ok(order)
}

async fn apply_line_item(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: &str,
    product: &Product,
    qty: i64,
    line_total: i64,
    actor: &Option<String>,
    now: &str,
) -> Result<OrderItem, String> {
    let new_stock_qty = product.stock_qty - qty;
    sqlx::query("UPDATE products SET stock_qty = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .bind(new_stock_qty)
        .bind(now)
        .bind(actor)
        .bind(&product.id)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    let updated_product = Product { stock_qty: new_stock_qty, updated_at: now.to_string(), ..product.clone() };
    enqueue_outbox_tx(tx, "products", "upsert", &product.id, &product_payload(&updated_product, &None, actor))
        .await
        .map_err(|e| e.to_string())?;

    let movement_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO stock_movements (id, product_id, delta, reason, note, updated_at, created_by) VALUES (?, ?, ?, 'sale', NULL, ?, ?)",
    )
    .bind(&movement_id)
    .bind(&product.id)
    .bind(-qty)
    .bind(now)
    .bind(actor)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    let movement_payload = json!({
        "id": movement_id, "productId": product.id, "delta": -qty,
        "reason": "sale", "note": null, "updatedAt": now, "createdBy": actor,
    });
    enqueue_outbox_tx(tx, "stockMovements", "upsert", &movement_id, &movement_payload)
        .await
        .map_err(|e| e.to_string())?;

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
    .bind(order_id)
    .bind(&product.id)
    .bind(qty)
    .bind(product.price)
    .bind(line_total)
    .bind(now)
    .bind(&metadata)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    let oi = OrderItem {
        id: order_item_id,
        order_id: order_id.to_string(),
        product_id: product.id.clone(),
        qty,
        unit_price: product.price,
        line_total,
        updated_at: now.to_string(),
        metadata: Some(metadata),
    };
    let oi_payload = json!({
        "id": oi.id, "orderId": oi.order_id, "productId": oi.product_id,
        "qty": oi.qty, "unitPrice": oi.unit_price, "lineTotal": oi.line_total, "updatedAt": oi.updated_at,
        "metadata": oi.metadata.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
    });
    enqueue_outbox_tx(tx, "orderItems", "upsert", &oi.id, &oi_payload)
        .await
        .map_err(|e| e.to_string())?;

    Ok(oi)
}

// Cafe checkout: validates stock/active status, decrements stock, and writes
// order + order_items + stock_movements in one transaction -- an early
// `return Err` drops `tx` uncommitted, so a failed line leaves no partial sale.
pub(crate) async fn do_create_order(
    pool: &SqlitePool,
    items: Vec<CartItemInput>,
    method: String,
    customer_id: Option<String>,
) -> Result<OrderWithItems, String> {
    if items.is_empty() {
        return Err("Cart is empty".to_string());
    }
    if method == "Credit" && customer_id.is_none() {
        return Err("A customer must be selected for Credit orders".to_string());
    }

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let now = crate::time::now_iso();
    let order_id = Uuid::new_v4().to_string();

    let validated = validate_cart(&mut tx, &items).await?;
    let total: i64 = validated.iter().map(|(_, _, line_total)| *line_total).sum();

    let order = insert_order_row(&mut tx, &order_id, &method, total, &customer_id, &actor, &now).await?;

    let mut order_items: Vec<OrderItem> = Vec::new();
    for (product, qty, line_total) in validated {
        let oi = apply_line_item(&mut tx, &order_id, &product, qty, line_total, &actor, &now).await?;
        order_items.push(oi);
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(OrderWithItems { order, items: order_items })
}
```

- [ ] **Step 4: Run `cargo check` then the orders test suite**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: no errors, no unused-import warnings.

Run: `cargo test --lib commands::orders`
Expected: PASS — same 12 tests as Step 1's baseline, all green (in particular `checkout_stores_a_product_snapshot_as_metadata` and `rejects_checkout_with_insufficient_stock_and_writes_nothing`, which most directly exercise the extracted functions' boundaries).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/orders.rs
git commit -m "refactor(desktop): decompose orders.rs's checkout into validate/insert/apply-line-item helpers"
```

---

### Task 3: `reports.rs` — split into 3 files by domain + extract label constants

**Files:**
- Delete: `apps/desktop/src-tauri/src/commands/reports.rs`
- Create: `apps/desktop/src-tauri/src/commands/reports/mod.rs`
- Create: `apps/desktop/src-tauri/src/commands/reports/sales.rs`
- Create: `apps/desktop/src-tauri/src/commands/reports/customer_balances.rs`
- Create: `apps/desktop/src-tauri/src/commands/reports/credit_history.rs`

**Interfaces:**
- Consumes: nothing outside this file changes — `commands/mod.rs:12`'s `pub mod reports;` needs no edit (a directory module with `mod.rs` is a drop-in replacement for a single file), and `lib.rs`'s three `commands::reports::get_*` references resolve identically once `mod.rs` re-exports them.
- Produces: `mod.rs` re-exports `get_monthly_report`, `get_customer_balances`, `get_customer_credit_history` at the same `commands::reports::*` path they're at today. Each `do_*` function keeps its exact signature.

- [ ] **Step 1: Confirm the baseline test count**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::reports`
Expected: PASS — 9 tests (5 balance tests: fresh customer is zero, includes credit sessions, credit given/payment received, soft-deleted excluded, multiple customers independent; 4 history tests: empty for fresh customer, contains labelled entries, ids namespaced, only returns requested customer's rows).

- [ ] **Step 2: Create `apps/desktop/src-tauri/src/commands/reports/sales.rs`**

```rust
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::State;

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DailyCategoryTotal {
    pub date: String,
    pub category_id: String,
    pub method: String,
    pub total: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DailyExpenseTotal {
    pub date: String,
    pub method: String,
    pub total: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DailyCafeTotal {
    pub date: String,
    pub method: String,
    pub total: i64,
    pub profit: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReportResult {
    pub session_totals: Vec<DailyCategoryTotal>,
    pub expense_totals: Vec<DailyExpenseTotal>,
    pub cafe_totals: Vec<DailyCafeTotal>,
}

pub(crate) async fn do_get_monthly_report(
    pool: &SqlitePool,
    start_date: String,
    end_date: String,
    start_utc: String,
    end_utc: String,
) -> Result<MonthlyReportResult, String> {
    let session_totals = sqlx::query_as::<_, DailyCategoryTotal>(
        "SELECT 
            s.date as date,
            st.category_id as category_id,
            s.method as method,
            CAST(SUM(s.amount) AS INTEGER) as total
         FROM sessions s
         JOIN stations st ON s.station_id = st.id
         WHERE s.date >= ? AND s.date <= ? AND s.deleted_at IS NULL
         GROUP BY s.date, st.category_id, s.method",
    )
    .bind(&start_date)
    .bind(&end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let expense_totals = sqlx::query_as::<_, DailyExpenseTotal>(
        "SELECT 
            date,
            method,
            CAST(SUM(amount) AS INTEGER) as total
         FROM expenses
         WHERE date >= ? AND date <= ? AND deleted_at IS NULL
         GROUP BY date, method",
    )
    .bind(&start_date)
    .bind(&end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let cafe_totals = sqlx::query_as::<_, DailyCafeTotal>(
        "SELECT 
            substr(o.updated_at, 1, 10) as date,
            o.method as method,
            CAST(SUM(o.total) AS INTEGER) as total,
            CAST(SUM(
                COALESCE(oi_agg.items_total, 0) - COALESCE(oi_agg.items_cost, 0)
            ) AS INTEGER) as profit
         FROM orders o
         LEFT JOIN (
             SELECT 
                 oi.order_id,
                 SUM(oi.line_total) as items_total,
                 SUM(COALESCE(p.cost, 0) * oi.qty) as items_cost
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             GROUP BY oi.order_id
         ) oi_agg ON o.id = oi_agg.order_id
         WHERE o.deleted_at IS NULL AND o.updated_at >= ? AND o.updated_at < ?
         GROUP BY substr(o.updated_at, 1, 10), o.method",
    )
    .bind(&start_utc)
    .bind(&end_utc)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(MonthlyReportResult {
        session_totals,
        expense_totals,
        cafe_totals,
    })
}

#[tauri::command]
pub async fn get_monthly_report(
    pool: State<'_, SqlitePool>,
    start_date: String,
    end_date: String,
    start_utc: String,
    end_utc: String,
) -> Result<MonthlyReportResult, String> {
    do_get_monthly_report(pool.inner(), start_date, end_date, start_utc, end_utc).await
}
```

- [ ] **Step 3: Create `apps/desktop/src-tauri/src/commands/reports/customer_balances.rs`**

```rust
use sqlx::{FromRow, SqlitePool};
use std::collections::HashMap;
use tauri::State;

/// Customer balances as { customerId: balance }.
/// balance = credit sessions + credit cafe orders + CREDIT_GIVEN − PAYMENT_RECEIVED
#[derive(Debug, FromRow)]
pub struct CustomerBalanceRow {
    pub customer_id: String,
    pub balance: i64,
}

pub(crate) async fn do_get_customer_balances(
    pool: &SqlitePool,
) -> Result<HashMap<String, i64>, String> {
    let rows = sqlx::query_as::<_, CustomerBalanceRow>(
        "SELECT
            c.id AS customer_id,
            COALESCE(s.credit_sessions, 0)
            + COALESCE(o.credit_orders, 0)
            + COALESCE(ce.given, 0)
            - COALESCE(ce.paid, 0) AS balance
         FROM customers c
         LEFT JOIN (
             SELECT customer_id,
                    CAST(SUM(amount) AS INTEGER) AS credit_sessions
             FROM sessions
             WHERE method = 'Credit'
               AND customer_id IS NOT NULL
               AND deleted_at IS NULL
             GROUP BY customer_id
         ) s ON s.customer_id = c.id
         LEFT JOIN (
             SELECT customer_id,
                    CAST(SUM(total) AS INTEGER) AS credit_orders
             FROM orders
             WHERE method = 'Credit'
               AND customer_id IS NOT NULL
               AND deleted_at IS NULL
             GROUP BY customer_id
         ) o ON o.customer_id = c.id
         LEFT JOIN (
             SELECT customer_id,
                    CAST(SUM(CASE WHEN type = 'CREDIT_GIVEN'     THEN amount ELSE 0 END) AS INTEGER) AS given,
                    CAST(SUM(CASE WHEN type = 'PAYMENT_RECEIVED' THEN amount ELSE 0 END) AS INTEGER) AS paid
             FROM credit_entries
             GROUP BY customer_id
         ) ce ON ce.customer_id = c.id
         WHERE c.deleted_at IS NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|r| (r.customer_id, r.balance)).collect())
}

#[tauri::command]
pub async fn get_customer_balances(
    pool: State<'_, SqlitePool>,
) -> Result<HashMap<String, i64>, String> {
    do_get_customer_balances(pool.inner()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::categories::do_create_category;
    use crate::commands::credit_entries::do_create_credit_entry;
    use crate::commands::customers::do_create_customer;
    use crate::commands::stations::do_create_station;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn balance_is_zero_for_a_fresh_customer() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        let balances = do_get_customer_balances(&pool).await.unwrap();
        assert_eq!(balances.get(&customer.id).copied().unwrap_or(0), 0);
    }

    #[tokio::test]
    async fn balance_includes_credit_sessions() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        // Insert a Credit session directly -- do_create_session doesn't
        // accept method/customer_id, and a fresh test DB has no station yet.
        let session_id = uuid::Uuid::new_v4().to_string();
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();
        let station = do_create_station(&pool, category.id.clone(), "Table 1".to_string()).await.unwrap();
        let station_id = station.id;
        sqlx::query(
            "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at)
             VALUES (?, ?, '2026-07-01', '10:00', '11:00', 250, 'Credit', ?, datetime('now'))",
        )
        .bind(&session_id)
        .bind(&station_id)
        .bind(&customer.id)
        .execute(&pool)
        .await
        .unwrap();

        let balances = do_get_customer_balances(&pool).await.unwrap();
        assert_eq!(balances[&customer.id], 250);
    }

    #[tokio::test]
    async fn credit_given_adds_to_balance_and_payment_received_subtracts() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        do_create_credit_entry(&pool, customer.id.clone(), "2026-07-01".to_string(), "CREDIT_GIVEN".to_string(), 500).await.unwrap();
        do_create_credit_entry(&pool, customer.id.clone(), "2026-07-02".to_string(), "PAYMENT_RECEIVED".to_string(), 200).await.unwrap();

        let balances = do_get_customer_balances(&pool).await.unwrap();
        // 500 given − 200 received = 300 outstanding
        assert_eq!(balances[&customer.id], 300);
    }

    #[tokio::test]
    async fn soft_deleted_customer_is_excluded_from_balances() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ghost".to_string(), "".to_string()).await.unwrap();
        // Soft-delete
        sqlx::query("UPDATE customers SET deleted_at = '2026-07-01T00:00:00Z' WHERE id = ?")
            .bind(&customer.id)
            .execute(&pool)
            .await
            .unwrap();

        let balances = do_get_customer_balances(&pool).await.unwrap();
        assert!(!balances.contains_key(&customer.id), "deleted customer must not appear in balances");
    }

    #[tokio::test]
    async fn multiple_customers_each_get_independent_balances() {
        let pool = setup_test_db().await;
        let c1 = do_create_customer(&pool, "Alice".to_string(), "".to_string()).await.unwrap();
        let c2 = do_create_customer(&pool, "Bob".to_string(), "".to_string()).await.unwrap();

        do_create_credit_entry(&pool, c1.id.clone(), "2026-07-01".to_string(), "CREDIT_GIVEN".to_string(), 300).await.unwrap();
        do_create_credit_entry(&pool, c2.id.clone(), "2026-07-01".to_string(), "CREDIT_GIVEN".to_string(), 700).await.unwrap();
        do_create_credit_entry(&pool, c2.id.clone(), "2026-07-02".to_string(), "PAYMENT_RECEIVED".to_string(), 200).await.unwrap();

        let balances = do_get_customer_balances(&pool).await.unwrap();
        assert_eq!(balances[&c1.id], 300);
        assert_eq!(balances[&c2.id], 500);  // 700 − 200
    }
}
```

- [ ] **Step 4: Create `apps/desktop/src-tauri/src/commands/reports/credit_history.rs`**

```rust
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::State;

const LABEL_SESSION_CHARGE: &str = "Table charge";
const LABEL_CREDIT_GIVEN: &str = "Credit given";
const LABEL_PAYMENT_RECEIVED: &str = "Payment received";

/// One merged, date-descending timeline row: a Credit session or credit_entry.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomerHistoryRow {
    pub id: String,
    pub date: String,
    pub label: String,
    pub amount: i64,
    /// "charge" | "payment"
    pub direction: String,
}

pub(crate) async fn do_get_customer_credit_history(
    pool: &SqlitePool,
    customer_id: String,
) -> Result<Vec<CustomerHistoryRow>, String> {
    // `date` is a plain calendar day, so same-day entries need updated_at as
    // a tiebreaker (used only in ORDER BY, not selected into the result).
    let query = format!(
        "SELECT id, date, label, amount, direction FROM (
             SELECT
                 'session-' || id         AS id,
                 date                     AS date,
                 '{LABEL_SESSION_CHARGE}' AS label,
                 CAST(amount AS INTEGER)  AS amount,
                 'charge'                 AS direction,
                 updated_at               AS updated_at
             FROM sessions
             WHERE customer_id = ?
               AND method = 'Credit'
               AND deleted_at IS NULL

             UNION ALL

             SELECT
                 'credit-' || id                                         AS id,
                 date                                                    AS date,
                 CASE type
                     WHEN 'CREDIT_GIVEN'     THEN '{LABEL_CREDIT_GIVEN}'
                     WHEN 'PAYMENT_RECEIVED' THEN '{LABEL_PAYMENT_RECEIVED}'
                     ELSE type
                 END                                                     AS label,
                 CAST(amount AS INTEGER)                                 AS amount,
                 CASE type
                     WHEN 'PAYMENT_RECEIVED' THEN 'payment'
                     ELSE 'charge'
                 END                                                     AS direction,
                 updated_at                                              AS updated_at
             FROM credit_entries
             WHERE customer_id = ?
         )
         ORDER BY date DESC, updated_at DESC"
    );
    sqlx::query_as::<_, CustomerHistoryRow>(&query)
        .bind(&customer_id)
        .bind(&customer_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_customer_credit_history(
    pool: State<'_, SqlitePool>,
    customer_id: String,
) -> Result<Vec<CustomerHistoryRow>, String> {
    do_get_customer_credit_history(pool.inner(), customer_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::credit_entries::do_create_credit_entry;
    use crate::commands::customers::do_create_customer;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn history_is_empty_for_a_fresh_customer() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        let rows = do_get_customer_credit_history(&pool, customer.id).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn history_contains_credit_entries_as_labelled_rows() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        do_create_credit_entry(&pool, customer.id.clone(), "2026-07-01".to_string(), "CREDIT_GIVEN".to_string(), 400).await.unwrap();
        do_create_credit_entry(&pool, customer.id.clone(), "2026-07-02".to_string(), "PAYMENT_RECEIVED".to_string(), 150).await.unwrap();

        let rows = do_get_customer_credit_history(&pool, customer.id).await.unwrap();
        assert_eq!(rows.len(), 2);

        // Sorted date DESC → payment (2026-07-02) is first
        let payment_row = &rows[0];
        assert_eq!(payment_row.label, "Payment received");
        assert_eq!(payment_row.direction, "payment");
        assert_eq!(payment_row.amount, 150);

        let credit_row = &rows[1];
        assert_eq!(credit_row.label, "Credit given");
        assert_eq!(credit_row.direction, "charge");
        assert_eq!(credit_row.amount, 400);
    }

    #[tokio::test]
    async fn history_ids_are_namespaced_to_avoid_collisions() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();
        do_create_credit_entry(&pool, customer.id.clone(), "2026-07-01".to_string(), "CREDIT_GIVEN".to_string(), 100).await.unwrap();

        let rows = do_get_customer_credit_history(&pool, customer.id).await.unwrap();
        assert!(rows[0].id.starts_with("credit-"), "credit_entry rows must be namespaced with 'credit-'");
    }

    #[tokio::test]
    async fn history_only_returns_rows_for_the_requested_customer() {
        let pool = setup_test_db().await;
        let c1 = do_create_customer(&pool, "Alice".to_string(), "".to_string()).await.unwrap();
        let c2 = do_create_customer(&pool, "Bob".to_string(), "".to_string()).await.unwrap();

        do_create_credit_entry(&pool, c1.id.clone(), "2026-07-01".to_string(), "CREDIT_GIVEN".to_string(), 999).await.unwrap();
        do_create_credit_entry(&pool, c2.id.clone(), "2026-07-01".to_string(), "CREDIT_GIVEN".to_string(), 1).await.unwrap();

        let rows_c2 = do_get_customer_credit_history(&pool, c2.id).await.unwrap();
        assert_eq!(rows_c2.len(), 1);
        assert_eq!(rows_c2[0].amount, 1, "must only return c2's entry, not c1's");
    }
}
```

- [ ] **Step 5: Create `apps/desktop/src-tauri/src/commands/reports/mod.rs`**

```rust
mod credit_history;
mod customer_balances;
mod sales;

pub use credit_history::get_customer_credit_history;
pub use customer_balances::get_customer_balances;
pub use sales::get_monthly_report;
```

- [ ] **Step 6: Delete the old single file**

```bash
rm apps/desktop/src-tauri/src/commands/reports.rs
```

- [ ] **Step 7: Run `cargo check`, `cargo clippy`, then the reports test suite**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: no errors. `commands/mod.rs:12`'s `pub mod reports;` resolves to the new `reports/mod.rs` automatically — no edit needed there.

Run: `cargo clippy --lib -- -D warnings`
Expected: no warnings (catches any dropped-but-still-referenced import across the 3 new files).

Run: `cargo test --lib commands::reports`
Expected: PASS — same 9 tests as Step 1's baseline, all green, now split 5-in-`customer_balances.rs` / 4-in-`credit_history.rs`.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/reports.rs apps/desktop/src-tauri/src/commands/reports/
git commit -m "refactor(desktop): split reports.rs into 3 files by domain, extract credit-history label constants"
```

---

## Final verification (after all 3 tasks)

- [ ] Run the full Rust test suite: `cd apps/desktop/src-tauri && cargo test`
  Expected: PASS — all tests across every command module (not just sync/orders/reports), confirming nothing outside the three touched files broke.
- [ ] Run `cargo clippy --all-targets -- -D warnings` from `apps/desktop/src-tauri`
  Expected: no warnings anywhere in the crate.
- [ ] Run the full desktop e2e suite (`apps/desktop/e2e`), in particular `03-cafe.spec.ts` (checkout), `06-cross-app-sync.spec.ts` (pull/push sync), and `08-reporting.spec.ts` (all three report endpoints), per `pnpm test:e2e`'s documented script.
  Expected: PASS — confirms the refactor is behavior-preserving at the integration level, not just per-unit-test.
