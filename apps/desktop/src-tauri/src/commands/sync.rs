use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};
use tauri::State;

// Inserts the outbox row in the SAME transaction as the caller's table write,
// so a crash rolls back both or neither (unlike apps/web's Dexie outbox).
pub async fn enqueue_outbox_tx(
    tx: &mut Transaction<'_, Sqlite>,
    table: &str,
    op: &str,
    entity_id: &str,
    payload: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO outbox (table_name, op, entity_id, payload_json, client_updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(table)
    .bind(op)
    .bind(entity_id)
    .bind(payload.to_string())
    .bind(crate::time::now_iso())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OutboxEntryRow {
    pub id: i64,
    pub table_name: String,
    pub op: String,
    pub entity_id: String,
    pub payload_json: String,
    pub client_updated_at: String,
}

pub(crate) async fn do_drain_outbox(pool: &SqlitePool) -> Result<Vec<OutboxEntryRow>, String> {
    sqlx::query_as::<_, OutboxEntryRow>(
        "SELECT id, table_name, op, entity_id, payload_json, client_updated_at FROM outbox ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

// Called by syncEngine.ts before POSTing to /sync/push -- TS owns the HTTP
// call and timing, Rust only owns the SQLite read/write.
#[tauri::command]
pub async fn drain_outbox(pool: State<'_, SqlitePool>) -> Result<Vec<OutboxEntryRow>, String> {
    do_drain_outbox(pool.inner()).await
}

pub(crate) async fn do_delete_outbox_entries(pool: &SqlitePool, ids: Vec<i64>) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for id in ids {
        sqlx::query("DELETE FROM outbox WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_outbox_entries(pool: State<'_, SqlitePool>, ids: Vec<i64>) -> Result<(), String> {
    do_delete_outbox_entries(pool.inner(), ids).await
}

#[derive(Debug, Deserialize)]
pub struct PulledRow {
    pub table: String,
    pub row: Value,
}

// Applies pulled rows from GET /sync/pull. categories/stations always
// overwrite (no updatedAt column); everything else is last-write-wins by
// updatedAt, matching apps/web's syncEngine.ts mergeIncoming().
pub(crate) async fn do_apply_pulled_rows(pool: &SqlitePool, rows: Vec<PulledRow>) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for entry in rows {
        apply_one(&mut tx, &entry.table, &entry.row)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apply_pulled_rows(pool: State<'_, SqlitePool>, rows: Vec<PulledRow>) -> Result<(), String> {
    do_apply_pulled_rows(pool.inner(), rows).await
}

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
    let id = row["id"].as_str().unwrap_or_default();

    match table {
        "categories" => apply_categories(tx, id, row).await,
        "stations" => apply_stations(tx, id, row).await,
        "rates" => apply_rates(tx, id, row).await,
        "customers" => apply_customers(tx, id, row).await,
        "sessions" => apply_sessions(tx, id, row).await,
        "expenses" => apply_expenses(tx, id, row).await,
        "creditEntries" => apply_credit_entries(tx, id, row).await,
        "productCategories" => apply_product_categories(tx, id, row).await,
        "products" => apply_products(tx, id, row).await,
        "orders" => apply_orders(tx, id, row).await,
        "orderItems" => apply_order_items(tx, id, row).await,
        "stockMovements" => apply_stock_movements(tx, id, row).await,
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
    .bind(row["method"].as_str())
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

// Last-write-wins: skip the incoming row if the local row is already at
// least as new. sqlite_table is the actual table name (snake_case), which
// differs from the sync wire-format table name for credit_entries.
async fn is_newer(
    tx: &mut Transaction<'_, Sqlite>,
    sqlite_table: &str,
    id: &str,
    row: &Value,
) -> Result<bool, sqlx::Error> {
    let query = format!("SELECT updated_at FROM {sqlite_table} WHERE id = ?");
    let existing: Option<(String,)> = sqlx::query_as(&query)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    let Some((existing_updated_at,)) = existing else {
        return Ok(true);
    };
    let incoming_updated_at = row["updatedAt"].as_str().unwrap_or_default();
    Ok(incoming_updated_at > existing_updated_at.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;
    use serde_json::json;

    fn row(table: &str, value: serde_json::Value) -> PulledRow {
        PulledRow { table: table.to_string(), row: value }
    }

    #[tokio::test]
    async fn categories_always_overwrite_even_though_they_have_no_updated_at() {
        let pool = setup_test_db().await;
        do_apply_pulled_rows(
            &pool,
            vec![row("categories", json!({ "id": "cat-1", "name": "8-Ball", "billingType": "time" }))],
        )
        .await
        .unwrap();

        // A second pull for the same id with a different name must win
        // unconditionally -- categories have no updatedAt to compare.
        do_apply_pulled_rows(
            &pool,
            vec![row("categories", json!({ "id": "cat-1", "name": "9-Ball", "billingType": "frame" }))],
        )
        .await
        .unwrap();

        let (name, billing_type): (String, String) =
            sqlx::query_as("SELECT name, billing_type FROM categories WHERE id = ?")
                .bind("cat-1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(name, "9-Ball");
        assert_eq!(billing_type, "frame");
    }

    #[tokio::test]
    async fn last_write_wins_skips_an_incoming_row_older_than_the_local_one() {
        let pool = setup_test_db().await;
        do_apply_pulled_rows(
            &pool,
            vec![row(
                "customers",
                json!({ "id": "c1", "name": "Server Name", "phone": "", "updatedAt": "2026-07-23T00:00:00Z", "deletedAt": null }),
            )],
        )
        .await
        .unwrap();

        // Simulate the local row having since been updated to something newer
        // than the incoming (stale) pull.
        sqlx::query("UPDATE customers SET name = 'Local Newer Name', updated_at = ? WHERE id = ?")
            .bind("2026-07-24T00:00:00Z")
            .bind("c1")
            .execute(&pool)
            .await
            .unwrap();

        do_apply_pulled_rows(
            &pool,
            vec![row(
                "customers",
                json!({ "id": "c1", "name": "Stale Server Name", "phone": "", "updatedAt": "2026-07-23T00:00:00Z", "deletedAt": null }),
            )],
        )
        .await
        .unwrap();

        let (name,): (String,) = sqlx::query_as("SELECT name FROM customers WHERE id = ?")
            .bind("c1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "Local Newer Name", "a pulled row older than the local one must not overwrite it");
    }

    #[tokio::test]
    async fn last_write_wins_applies_an_incoming_row_newer_than_the_local_one() {
        let pool = setup_test_db().await;
        do_apply_pulled_rows(
            &pool,
            vec![row(
                "customers",
                json!({ "id": "c1", "name": "Old Name", "phone": "", "updatedAt": "2026-07-23T00:00:00Z", "deletedAt": null }),
            )],
        )
        .await
        .unwrap();

        do_apply_pulled_rows(
            &pool,
            vec![row(
                "customers",
                json!({ "id": "c1", "name": "New Name", "phone": "", "updatedAt": "2026-07-24T00:00:00Z", "deletedAt": null }),
            )],
        )
        .await
        .unwrap();

        let (name,): (String,) = sqlx::query_as("SELECT name FROM customers WHERE id = ?")
            .bind("c1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "New Name");
    }

    #[tokio::test]
    async fn a_brand_new_row_is_always_inserted_regardless_of_last_write_wins() {
        let pool = setup_test_db().await;
        do_apply_pulled_rows(
            &pool,
            vec![row(
                "customers",
                json!({ "id": "c1", "name": "Ravi", "phone": "", "updatedAt": "2026-07-23T00:00:00Z", "deletedAt": null }),
            )],
        )
        .await
        .unwrap();

        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM customers").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn drain_outbox_returns_entries_in_insertion_order() {
        let pool = setup_test_db().await;
        let mut tx = pool.begin().await.unwrap();
        enqueue_outbox_tx(&mut tx, "customers", "upsert", "c1", &json!({ "id": "c1" })).await.unwrap();
        enqueue_outbox_tx(&mut tx, "customers", "upsert", "c2", &json!({ "id": "c2" })).await.unwrap();
        tx.commit().await.unwrap();

        let entries = do_drain_outbox(&pool).await.unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].entity_id, "c1");
        assert_eq!(entries[1].entity_id, "c2");
    }

    #[tokio::test]
    async fn delete_outbox_entries_removes_only_the_specified_ids() {
        let pool = setup_test_db().await;
        let mut tx = pool.begin().await.unwrap();
        enqueue_outbox_tx(&mut tx, "customers", "upsert", "c1", &json!({ "id": "c1" })).await.unwrap();
        enqueue_outbox_tx(&mut tx, "customers", "upsert", "c2", &json!({ "id": "c2" })).await.unwrap();
        tx.commit().await.unwrap();
        let entries = do_drain_outbox(&pool).await.unwrap();
        let first_id = entries[0].id;

        do_delete_outbox_entries(&pool, vec![first_id]).await.unwrap();

        let remaining = do_drain_outbox(&pool).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].entity_id, "c2");
    }
}
