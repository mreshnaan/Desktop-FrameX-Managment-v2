use crate::commands::sync::enqueue_outbox_tx;
use crate::models::{Product, StockMovement};
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) fn payload(p: &Product) -> serde_json::Value {
    json!({
        "id": p.id, "categoryId": p.category_id, "name": p.name, "price": p.price, "cost": p.cost,
        "stockQty": p.stock_qty, "lowStockThreshold": p.low_stock_threshold, "barcode": p.barcode,
        "active": p.active, "updatedAt": p.updated_at, "deletedAt": p.deleted_at,
    })
}

// Every command below is split into a plain `do_*` function taking a raw
// `&SqlitePool` (unit-testable with an in-memory db -- see the `tests`
// module) and a thin `#[tauri::command]` wrapper that just unwraps Tauri's
// State, which can't be constructed outside a running app.

pub(crate) async fn do_list_products(pool: &SqlitePool) -> Result<Vec<Product>, String> {
    sqlx::query_as::<_, Product>(
        "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at
         FROM products WHERE deleted_at IS NULL ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_products(pool: State<'_, SqlitePool>) -> Result<Vec<Product>, String> {
    do_list_products(pool.inner()).await
}

pub(crate) async fn do_create_product(
    pool: &SqlitePool,
    category_id: String,
    name: String,
    price: i64,
    cost: Option<i64>,
    low_stock_threshold: i64,
    barcode: Option<String>,
) -> Result<Product, String> {
    let product = Product {
        id: Uuid::new_v4().to_string(),
        category_id,
        name,
        price,
        cost,
        stock_qty: 0,
        low_stock_threshold,
        barcode,
        active: true,
        updated_at: crate::time::now_iso(),
        deleted_at: None,
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO products (id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(&product.id)
    .bind(&product.category_id)
    .bind(&product.name)
    .bind(product.price)
    .bind(product.cost)
    .bind(product.stock_qty)
    .bind(product.low_stock_threshold)
    .bind(&product.barcode)
    .bind(product.active)
    .bind(&product.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "products", "upsert", &product.id, &payload(&product))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(product)
}

#[tauri::command]
pub async fn create_product(
    pool: State<'_, SqlitePool>,
    category_id: String,
    name: String,
    price: i64,
    cost: Option<i64>,
    low_stock_threshold: i64,
    barcode: Option<String>,
) -> Result<Product, String> {
    do_create_product(pool.inner(), category_id, name, price, cost, low_stock_threshold, barcode).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn do_update_product(
    pool: &SqlitePool,
    id: String,
    name: String,
    price: i64,
    cost: Option<i64>,
    low_stock_threshold: i64,
    barcode: Option<String>,
    active: bool,
) -> Result<Product, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let existing: Product = sqlx::query_as(
        "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at
         FROM products WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let product = Product {
        name, price, cost, low_stock_threshold, barcode, active,
        updated_at: crate::time::now_iso(),
        ..existing
    };

    sqlx::query(
        "UPDATE products SET name = ?, price = ?, cost = ?, low_stock_threshold = ?, barcode = ?, active = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&product.name)
    .bind(product.price)
    .bind(product.cost)
    .bind(product.low_stock_threshold)
    .bind(&product.barcode)
    .bind(product.active)
    .bind(&product.updated_at)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "products", "upsert", &id, &payload(&product))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(product)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_product(
    pool: State<'_, SqlitePool>,
    id: String,
    name: String,
    price: i64,
    cost: Option<i64>,
    low_stock_threshold: i64,
    barcode: Option<String>,
    active: bool,
) -> Result<Product, String> {
    do_update_product(pool.inner(), id, name, price, cost, low_stock_threshold, barcode, active).await
}

// Manual stock adjustment (purchase/waste/correction) -- rejects a negative
// resulting stock, updates products.stock_qty and logs a stock_movements
// row in the same transaction, matching FrameX's adjust_stock. Both the
// product update and the movement row get their own outbox entry so they
// sync independently.
pub(crate) async fn do_adjust_stock(
    pool: &SqlitePool,
    product_id: String,
    delta: i64,
    reason: String,
    note: Option<String>,
) -> Result<Product, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let existing: Product = sqlx::query_as(
        "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at
         FROM products WHERE id = ?",
    )
    .bind(&product_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let new_stock_qty = existing.stock_qty + delta;
    if new_stock_qty < 0 {
        return Err(format!(
            "Adjustment would take stock below zero (current: {}, delta: {})",
            existing.stock_qty, delta
        ));
    }

    let product = Product { stock_qty: new_stock_qty, updated_at: crate::time::now_iso(), ..existing };

    sqlx::query("UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?")
        .bind(product.stock_qty)
        .bind(&product.updated_at)
        .bind(&product_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    enqueue_outbox_tx(&mut tx, "products", "upsert", &product_id, &payload(&product))
        .await
        .map_err(|e| e.to_string())?;

    let movement = StockMovement {
        id: Uuid::new_v4().to_string(),
        product_id: product_id.clone(),
        delta,
        reason,
        note,
        updated_at: product.updated_at.clone(),
    };
    sqlx::query("INSERT INTO stock_movements (id, product_id, delta, reason, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&movement.id)
        .bind(&movement.product_id)
        .bind(movement.delta)
        .bind(&movement.reason)
        .bind(&movement.note)
        .bind(&movement.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let movement_payload = json!({
        "id": movement.id, "productId": movement.product_id, "delta": movement.delta,
        "reason": movement.reason, "note": movement.note, "updatedAt": movement.updated_at,
    });
    enqueue_outbox_tx(&mut tx, "stockMovements", "upsert", &movement.id, &movement_payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(product)
}

#[tauri::command]
pub async fn adjust_stock(
    pool: State<'_, SqlitePool>,
    product_id: String,
    delta: i64,
    reason: String,
    note: Option<String>,
) -> Result<Product, String> {
    do_adjust_stock(pool.inner(), product_id, delta, reason, note).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::product_categories::do_create_product_category;
    use crate::db::test_helpers::setup_test_db;

    async fn seed_category(pool: &SqlitePool) -> String {
        do_create_product_category(pool, "Drinks".to_string()).await.unwrap().id
    }

    #[tokio::test]
    async fn creates_a_product_with_zero_starting_stock() {
        let pool = setup_test_db().await;
        let category_id = seed_category(&pool).await;

        let product = do_create_product(&pool, category_id.clone(), "Cola".to_string(), 50, Some(20), 5, None)
            .await
            .unwrap();

        assert_eq!(product.stock_qty, 0);
        assert_eq!(product.category_id, category_id);
        assert!(product.active);
    }

    #[tokio::test]
    async fn adjust_stock_increases_and_records_a_purchase_movement() {
        let pool = setup_test_db().await;
        let category_id = seed_category(&pool).await;
        let product = do_create_product(&pool, category_id, "Cola".to_string(), 50, None, 5, None).await.unwrap();

        let updated = do_adjust_stock(&pool, product.id.clone(), 24, "purchase".to_string(), Some("initial stock".to_string()))
            .await
            .unwrap();

        assert_eq!(updated.stock_qty, 24);
        let (movement_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM stock_movements WHERE product_id = ?")
            .bind(&product.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(movement_count, 1);
    }

    #[tokio::test]
    async fn adjust_stock_rejects_an_adjustment_that_would_go_negative() {
        let pool = setup_test_db().await;
        let category_id = seed_category(&pool).await;
        let product = do_create_product(&pool, category_id, "Cola".to_string(), 50, None, 5, None).await.unwrap();
        do_adjust_stock(&pool, product.id.clone(), 10, "purchase".to_string(), None).await.unwrap();

        let result = do_adjust_stock(&pool, product.id.clone(), -11, "waste".to_string(), None).await;

        assert!(result.is_err());
        // Stock must be unchanged -- the rejected adjustment must not have partially applied.
        let unchanged: Product = sqlx::query_as(
            "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at FROM products WHERE id = ?",
        )
        .bind(&product.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(unchanged.stock_qty, 10);
    }

    #[tokio::test]
    async fn update_product_persists_new_price_and_active_flag() {
        let pool = setup_test_db().await;
        let category_id = seed_category(&pool).await;
        let product = do_create_product(&pool, category_id, "Cola".to_string(), 50, None, 5, None).await.unwrap();

        let updated = do_update_product(&pool, product.id.clone(), "Cola (large)".to_string(), 75, None, 5, None, false)
            .await
            .unwrap();

        assert_eq!(updated.name, "Cola (large)");
        assert_eq!(updated.price, 75);
        assert!(!updated.active);
    }

    #[tokio::test]
    async fn every_write_enqueues_an_outbox_entry() {
        let pool = setup_test_db().await;
        let category_id = seed_category(&pool).await;
        let product = do_create_product(&pool, category_id, "Cola".to_string(), 50, None, 5, None).await.unwrap();
        do_adjust_stock(&pool, product.id.clone(), 5, "purchase".to_string(), None).await.unwrap();

        let (outbox_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM outbox WHERE table_name IN ('products', 'stockMovements')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        // 1 for create_product + 1 for the stock update on adjust_stock + 1 for its stock_movement.
        // (Filters out the productCategories entry from seed_category, which isn't part of what this test covers.)
        assert_eq!(outbox_count, 3);
    }
}
