use sqlx::{FromRow, SqlitePool};
use std::collections::HashMap;

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
