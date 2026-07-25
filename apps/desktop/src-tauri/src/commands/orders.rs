use crate::commands::products::payload as product_payload;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::{Order, OrderItem, OrderWithItems, Product};
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
// written (no partial sale: an early `return Err` drops `tx` without
// committing, and sqlx rolls back an uncommitted transaction on drop).
// Each affected row gets its own outbox entry, enqueued in dependency order
// (products/stock movements, then the order, then its items) so a later
// push never violates a foreign key on the server. Credit orders require a
// customerId, same rule as Credit sessions.
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

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let now = crate::time::now_iso();
    let order_id = Uuid::new_v4().to_string();

    // Pass 1: validate every line and fetch the products, without writing
    // anything yet -- this is also what makes the total available before
    // the order row is inserted.
    let mut validated: Vec<(Product, i64, i64)> = Vec::new(); // (product, qty, line_total)
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
        validated.push((product, item.qty, line_total));
    }

    // Pass 2: the order row must exist before any order_items row that
    // references it (order_items.order_id has a FK on orders.id) -- insert
    // it first, using the total computed in pass 1.
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

    // Pass 3: now that the order exists, decrement stock and write each
    // item + its stock movement + its order_item row.
    let mut order_items: Vec<OrderItem> = Vec::new();
    for (product, qty, line_total) in validated {
        let new_stock_qty = product.stock_qty - qty;
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
        .bind(-qty)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let movement_payload = json!({
            "id": movement_id, "productId": product.id, "delta": -qty,
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
        .bind(qty)
        .bind(product.price)
        .bind(line_total)
        .bind(&now)
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
        };
        let oi_payload = json!({
            "id": oi.id, "orderId": oi.order_id, "productId": oi.product_id,
            "qty": oi.qty, "unitPrice": oi.unit_price, "lineTotal": oi.line_total, "updatedAt": oi.updated_at,
        });
        enqueue_outbox_tx(&mut tx, "orderItems", "upsert", &oi.id, &oi_payload)
            .await
            .map_err(|e| e.to_string())?;
        order_items.push(oi);
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(OrderWithItems { order, items: order_items })
}

#[tauri::command]
pub async fn create_order(
    pool: State<'_, SqlitePool>,
    items: Vec<CartItemInput>,
    method: String,
    customer_id: Option<String>,
) -> Result<OrderWithItems, String> {
    do_create_order(pool.inner(), items, method, customer_id).await
}

pub(crate) async fn do_list_all_orders(pool: &SqlitePool) -> Result<Vec<Order>, String> {
    sqlx::query_as::<_, Order>(
        "SELECT id, method, total, customer_id, updated_at, deleted_at FROM orders WHERE deleted_at IS NULL ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_all_orders(pool: State<'_, SqlitePool>) -> Result<Vec<Order>, String> {
    do_list_all_orders(pool.inner()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::product_categories::do_create_product_category;
    use crate::commands::products::{do_adjust_stock, do_create_product};
    use crate::db::test_helpers::setup_test_db;

    async fn seed_product(pool: &SqlitePool, stock: i64) -> Product {
        let category_id = do_create_product_category(pool, "Drinks".to_string()).await.unwrap().id;
        let product = do_create_product(pool, category_id, "Cola".to_string(), 50, None, 5, None).await.unwrap();
        do_adjust_stock(pool, product.id.clone(), stock, "purchase".to_string(), None).await.unwrap();
        // Re-fetch to get the post-adjustment stock_qty.
        sqlx::query_as::<_, Product>(
            "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at FROM products WHERE id = ?",
        )
        .bind(&product.id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn checks_out_a_cash_order_and_decrements_stock() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;

        let result = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 3 }],
            "Cash".to_string(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.order.total, 150);
        assert_eq!(result.items.len(), 1);

        let updated: Product = sqlx::query_as(
            "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at FROM products WHERE id = ?",
        )
        .bind(&product.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(updated.stock_qty, 7);
    }

    #[tokio::test]
    async fn rejects_checkout_with_insufficient_stock_and_writes_nothing() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 2).await;

        let result = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 5 }],
            "Cash".to_string(),
            None,
        )
        .await;

        assert!(result.is_err());
        let (order_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM orders").fetch_one(&pool).await.unwrap();
        assert_eq!(order_count, 0, "no order should be created when a line item fails validation");
        let unchanged: Product = sqlx::query_as(
            "SELECT id, category_id, name, price, cost, stock_qty, low_stock_threshold, barcode, active, updated_at, deleted_at FROM products WHERE id = ?",
        )
        .bind(&product.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(unchanged.stock_qty, 2, "stock must not be decremented on a rejected order");
    }

    #[tokio::test]
    async fn rejects_checkout_for_an_inactive_product() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;
        crate::commands::products::do_update_product(
            &pool, product.id.clone(), product.name.clone(), product.price, product.cost,
            product.low_stock_threshold, product.barcode.clone(), false,
        )
        .await
        .unwrap();

        let result = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 1 }],
            "Cash".to_string(),
            None,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn rejects_an_empty_cart() {
        let pool = setup_test_db().await;
        let result = do_create_order(&pool, vec![], "Cash".to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn rejects_a_credit_order_with_no_customer() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;

        let result = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 1 }],
            "Credit".to_string(),
            None,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn accepts_a_credit_order_with_a_customer_and_records_it_on_the_order() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;
        let customer_id = crate::commands::customers::do_create_customer(&pool, "Ravi".to_string(), "".to_string())
            .await
            .unwrap()
            .id;

        let result = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 1 }],
            "Credit".to_string(),
            Some(customer_id.clone()),
        )
        .await
        .unwrap();

        assert_eq!(result.order.customer_id, Some(customer_id));
    }

    #[tokio::test]
    async fn a_multi_line_order_sums_correctly_and_decrements_each_product_independently() {
        let pool = setup_test_db().await;
        let a = seed_product(&pool, 10).await;
        let category_id = do_create_product_category(&pool, "Snacks".to_string()).await.unwrap().id;
        let b = do_create_product(&pool, category_id, "Chips".to_string(), 30, None, 2, None).await.unwrap();
        do_adjust_stock(&pool, b.id.clone(), 10, "purchase".to_string(), None).await.unwrap();

        let result = do_create_order(
            &pool,
            vec![
                CartItemInput { product_id: a.id.clone(), qty: 2 },
                CartItemInput { product_id: b.id.clone(), qty: 3 },
            ],
            "Card".to_string(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.order.total, 2 * 50 + 3 * 30);
        assert_eq!(result.items.len(), 2);
    }
}
