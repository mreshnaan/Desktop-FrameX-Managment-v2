use crate::commands::sync::enqueue_outbox_tx;
use crate::models::{Product, StockMovement};
use chrono::Utc;
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

#[tauri::command]
pub async fn list_products(pool: State<'_, SqlitePool>) -> Result<Vec<Product>, String> {
    sqlx::query_as::<_, Product>(
        "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at
         FROM products WHERE deleted_at IS NULL ORDER BY name",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
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
        updated_at: Utc::now().to_rfc3339(),
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
        updated_at: Utc::now().to_rfc3339(),
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

// Manual stock adjustment (purchase/waste/correction) -- rejects a negative
// resulting stock, updates products.stock_qty and logs a stock_movements
// row in the same transaction, matching FrameX's adjust_stock. Both the
// product update and the movement row get their own outbox entry so they
// sync independently.
#[tauri::command]
pub async fn adjust_stock(
    pool: State<'_, SqlitePool>,
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

    let product = Product { stock_qty: new_stock_qty, updated_at: Utc::now().to_rfc3339(), ..existing };

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
