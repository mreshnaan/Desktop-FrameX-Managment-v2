use crate::commands::current_actor::get_current_actor;
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

    let actor = get_current_actor(pool).await;
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
    sqlx::query("INSERT INTO orders (id, method, total, customer_id, updated_at, deleted_at, created_by) VALUES (?, ?, ?, ?, ?, NULL, ?)")
        .bind(&order_id)
        .bind(&method)
        .bind(total)
        .bind(&customer_id)
        .bind(&now)
        .bind(&actor)
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
        "createdBy": actor,
    });
    enqueue_outbox_tx(&mut tx, "orders", "upsert", &order_id, &order_payload)
        .await
        .map_err(|e| e.to_string())?;

    // Pass 3: now that the order exists, decrement stock and write each
    // item + its stock movement + its order_item row.
    let mut order_items: Vec<OrderItem> = Vec::new();
    for (product, qty, line_total) in validated {
        let new_stock_qty = product.stock_qty - qty;
        sqlx::query("UPDATE products SET stock_qty = ?, updated_at = ?, updated_by = ? WHERE id = ?")
            .bind(new_stock_qty)
            .bind(&now)
            .bind(&actor)
            .bind(&product.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        let updated_product = Product { stock_qty: new_stock_qty, updated_at: now.clone(), ..product.clone() };
        enqueue_outbox_tx(&mut tx, "products", "upsert", &product.id, &product_payload(&updated_product, &None, &actor))
            .await
            .map_err(|e| e.to_string())?;

        let movement_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO stock_movements (id, product_id, delta, reason, note, updated_at, created_by) VALUES (?, ?, ?, 'sale', NULL, ?, ?)",
        )
        .bind(&movement_id)
        .bind(&product.id)
        .bind(-qty)
        .bind(&now)
        .bind(&actor)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let movement_payload = json!({
            "id": movement_id, "productId": product.id, "delta": -qty,
            "reason": "sale", "note": null, "updatedAt": now, "createdBy": actor,
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

// Orders have no separate `date` column like sessions do -- updated_at IS the
// instant the order belongs to, stamped in UTC (see create_order's comment
// and now_iso()). Date-range filtering therefore takes UTC instant bounds
// (start_utc inclusive, end_utc exclusive) rather than a local calendar-date
// string: the frontend converts its local [startDate, endDate] range into
// these UTC instants via localDateRangeToUtc() before calling this command,
// so the comparison is exact regardless of the machine's timezone offset.
pub(crate) async fn do_list_orders_between(
    pool: &SqlitePool,
    start_utc: &str,
    end_utc: &str,
) -> Result<Vec<Order>, String> {
    sqlx::query_as::<_, Order>(
        "SELECT id, method, total, customer_id, updated_at, deleted_at FROM orders
         WHERE deleted_at IS NULL AND updated_at >= ? AND updated_at < ?
         ORDER BY updated_at DESC",
    )
    .bind(start_utc)
    .bind(end_utc)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_orders_between(
    pool: State<'_, SqlitePool>,
    start_utc: String,
    end_utc: String,
) -> Result<Vec<Order>, String> {
    do_list_orders_between(pool.inner(), &start_utc, &end_utc).await
}

// Order items have no deleted_at of their own -- an order is append-only
// (see do_create_order's comment), so filtering by the parent order's
// deleted_at is the only soft-delete boundary that applies. Bounded by the
// same UTC instant range as list_orders_between, via a join on the parent
// order, rather than shipping every order item ever created to compute a
// single day's or month's cafe profit.
pub(crate) async fn do_list_order_items_between(
    pool: &SqlitePool,
    start_utc: &str,
    end_utc: &str,
) -> Result<Vec<OrderItem>, String> {
    sqlx::query_as::<_, OrderItem>(
        "SELECT oi.id, oi.order_id, oi.product_id, oi.qty, oi.unit_price, oi.line_total, oi.updated_at
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.deleted_at IS NULL AND o.updated_at >= ? AND o.updated_at < ?",
    )
    .bind(start_utc)
    .bind(end_utc)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_order_items_between(
    pool: State<'_, SqlitePool>,
    start_utc: String,
    end_utc: String,
) -> Result<Vec<OrderItem>, String> {
    do_list_order_items_between(pool.inner(), &start_utc, &end_utc).await
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
    async fn checkout_stamps_created_by_on_the_order_and_the_sold_products_updated_by() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;
        crate::commands::current_actor::do_set_current_actor(&pool, "cashier-1".to_string()).await.unwrap();

        let result = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 3 }],
            "Cash".to_string(),
            None,
        )
        .await
        .unwrap();

        let (order_created_by,): (Option<String>,) = sqlx::query_as("SELECT created_by FROM orders WHERE id = ?")
            .bind(&result.order.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(order_created_by, Some("cashier-1".to_string()));

        let (product_updated_by,): (Option<String>,) = sqlx::query_as("SELECT updated_by FROM products WHERE id = ?")
            .bind(&product.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(product_updated_by, Some("cashier-1".to_string()));
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

    #[tokio::test]
    async fn list_orders_between_only_returns_orders_in_the_date_range() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;

        let in_range = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 1 }],
            "Cash".to_string(),
            None,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE orders SET updated_at = '2026-06-15T10:00:00.000Z' WHERE id = ?")
            .bind(&in_range.order.id)
            .execute(&pool)
            .await
            .unwrap();

        let out_of_range = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 1 }],
            "Cash".to_string(),
            None,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE orders SET updated_at = '2026-07-01T10:00:00.000Z' WHERE id = ?")
            .bind(&out_of_range.order.id)
            .execute(&pool)
            .await
            .unwrap();

        let results = do_list_orders_between(&pool, "2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, in_range.order.id);
    }

    // Regression test for the UTC-vs-local timezone bug: an order stamped
    // just after local midnight in a timezone ahead of UTC (e.g. UTC+5:30 --
    // local 00:00-05:29 is still "yesterday" in UTC) must still be included
    // when the frontend converts that local day into its true UTC instant
    // bounds via localDateRangeToUtc(). Simulates a local date of 2026-06-16
    // in UTC+5:30, whose UTC start boundary is 2026-06-15T18:30:00.000Z.
    #[tokio::test]
    async fn list_orders_between_includes_an_order_stamped_just_after_local_midnight_ahead_of_utc() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;

        let just_after_local_midnight = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 1 }],
            "Cash".to_string(),
            None,
        )
        .await
        .unwrap();
        // 2026-06-16T00:15 in UTC+5:30 == 2026-06-15T18:45:00.000Z.
        sqlx::query("UPDATE orders SET updated_at = '2026-06-15T18:45:00.000Z' WHERE id = ?")
            .bind(&just_after_local_midnight.order.id)
            .execute(&pool)
            .await
            .unwrap();

        // UTC instant bounds for the local day 2026-06-16 in UTC+5:30.
        let results = do_list_orders_between(&pool, "2026-06-15T18:30:00.000Z", "2026-06-16T18:30:00.000Z")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, just_after_local_midnight.order.id);
    }

    #[tokio::test]
    async fn list_order_items_between_only_returns_items_for_orders_in_range() {
        let pool = setup_test_db().await;
        let product = seed_product(&pool, 10).await;

        let in_range = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 2 }],
            "Cash".to_string(),
            None,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE orders SET updated_at = '2026-06-15T10:00:00.000Z' WHERE id = ?")
            .bind(&in_range.order.id)
            .execute(&pool)
            .await
            .unwrap();

        let out_of_range = do_create_order(
            &pool,
            vec![CartItemInput { product_id: product.id.clone(), qty: 3 }],
            "Cash".to_string(),
            None,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE orders SET updated_at = '2026-07-01T10:00:00.000Z' WHERE id = ?")
            .bind(&out_of_range.order.id)
            .execute(&pool)
            .await
            .unwrap();

        let results = do_list_order_items_between(&pool, "2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].order_id, in_range.order.id);
        assert_eq!(results[0].qty, 2);
    }
}
