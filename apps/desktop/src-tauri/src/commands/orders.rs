use crate::commands::products::payload as product_payload;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::{Order, OrderItem, OrderWithItems, Product};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CartItemInput {
    pub product_id: String,
    pub qty: i64,
}

// The cafe checkout: validates every line against live stock/active status,
// decrements stock, and writes order + order_items + stock_movements in one
// transaction -- if any product is unavailable or understocked, nothing is
// written (no partial sale). Each affected row gets its own outbox entry,
// enqueued in dependency order (products/stock movements, then the order,
// then its items) so a later push never violates a foreign key on the
// server. Credit orders require a customerId, same rule as Credit sessions.
#[tauri::command]
pub async fn create_order(
    pool: State<'_, SqlitePool>,
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

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let order_id = Uuid::new_v4().to_string();

    let mut order_items: Vec<OrderItem> = Vec::new();
    let mut total: i64 = 0;

    for item in &items {
        let product: Product = sqlx::query_as(
            "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at
             FROM products WHERE id = ?",
        )
        .bind(&item.product_id)
        .fetch_one(&mut *tx)
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
        total += line_total;

        let new_stock_qty = product.stock_qty - item.qty;
        sqlx::query("UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?")
            .bind(new_stock_qty)
            .bind(&now)
            .bind(&product.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        let updated_product = Product { stock_qty: new_stock_qty, updated_at: now.clone(), ..product.clone() };
        enqueue_outbox_tx(&mut tx, "products", "upsert", &product.id, &product_payload(&updated_product))
            .await
            .map_err(|e| e.to_string())?;

        let movement_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO stock_movements (id, product_id, delta, reason, note, updated_at) VALUES (?, ?, ?, 'sale', NULL, ?)",
        )
        .bind(&movement_id)
        .bind(&product.id)
        .bind(-item.qty)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let movement_payload = json!({
            "id": movement_id, "productId": product.id, "delta": -item.qty,
            "reason": "sale", "note": null, "updatedAt": now,
        });
        enqueue_outbox_tx(&mut tx, "stockMovements", "upsert", &movement_id, &movement_payload)
            .await
            .map_err(|e| e.to_string())?;

        let order_item_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO order_items (id, order_id, product_id, qty, unit_price, line_total, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&order_item_id)
        .bind(&order_id)
        .bind(&product.id)
        .bind(item.qty)
        .bind(product.price)
        .bind(line_total)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        order_items.push(OrderItem {
            id: order_item_id,
            order_id: order_id.clone(),
            product_id: product.id.clone(),
            qty: item.qty,
            unit_price: product.price,
            line_total,
            updated_at: now.clone(),
        });
    }

    sqlx::query("INSERT INTO orders (id, method, total, customer_id, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)")
        .bind(&order_id)
        .bind(&method)
        .bind(total)
        .bind(&customer_id)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let order = Order {
        id: order_id.clone(),
        method: method.clone(),
        total,
        customer_id: customer_id.clone(),
        updated_at: now.clone(),
        deleted_at: None,
    };
    let order_payload = json!({
        "id": order.id, "method": order.method, "total": order.total,
        "customerId": order.customer_id, "updatedAt": order.updated_at, "deletedAt": null,
    });
    enqueue_outbox_tx(&mut tx, "orders", "upsert", &order_id, &order_payload)
        .await
        .map_err(|e| e.to_string())?;

    for oi in &order_items {
        let oi_payload = json!({
            "id": oi.id, "orderId": oi.order_id, "productId": oi.product_id,
            "qty": oi.qty, "unitPrice": oi.unit_price, "lineTotal": oi.line_total, "updatedAt": oi.updated_at,
        });
        enqueue_outbox_tx(&mut tx, "orderItems", "upsert", &oi.id, &oi_payload)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(OrderWithItems { order, items: order_items })
}

#[tauri::command]
pub async fn list_all_orders(pool: State<'_, SqlitePool>) -> Result<Vec<Order>, String> {
    sqlx::query_as::<_, Order>(
        "SELECT id, method, total, customer_id, updated_at, deleted_at FROM orders WHERE deleted_at IS NULL ORDER BY updated_at DESC",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}
