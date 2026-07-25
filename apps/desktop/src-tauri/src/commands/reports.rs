use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use std::collections::HashMap;
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

/// Returns customer balances as a plain JSON object keyed by customer id:
///   { "<uuid>": 450, "<uuid2>": 0, ... }
///
/// The frontend does ZERO work — it just reads `data[customerId]`. No
/// array-to-map conversion, no reduce, no filter.
///
/// Balance = sum(Credit sessions) + sum(Credit cafe orders)
///         + sum(CREDIT_GIVEN entries) − sum(PAYMENT_RECEIVED entries)
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

    // Collected into a HashMap in Rust — serialises as a plain JSON object.
    // The frontend receives { customerId: balance } and does zero work.
    Ok(rows.into_iter().map(|r| (r.customer_id, r.balance)).collect())
}

#[tauri::command]
pub async fn get_customer_balances(
    pool: State<'_, SqlitePool>,
) -> Result<HashMap<String, i64>, String> {
    do_get_customer_balances(pool.inner()).await
}

/// A merged timeline row returned by get_customer_credit_history.
/// Combines Credit sessions (table charges) and credit_entries (manual
/// adjustments) for one customer — sorted date-descending — so the
/// frontend has nothing left to compute, filter, or sort.
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
    // `date` is a plain calendar day (see Session/CreditEntry's schema), so
    // two entries recorded on the same day sort as ties on it alone --
    // ORDER BY date DESC would then fall back to whatever order SQLite
    // happens to return them in, not necessarily the order they were
    // actually recorded. updated_at (a full timestamp both tables already
    // carry) breaks that tie by actual recency; it's only used inside the
    // ORDER BY of the outer query below, not selected into the final
    // result, so CustomerHistoryRow's shape is unaffected.
    sqlx::query_as::<_, CustomerHistoryRow>(
        "SELECT id, date, label, amount, direction FROM (
             SELECT
                 'session-' || id         AS id,
                 date                     AS date,
                 'Table charge'           AS label,
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
                     WHEN 'CREDIT_GIVEN'     THEN 'Credit given'
                     WHEN 'PAYMENT_RECEIVED' THEN 'Payment received'
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
         ORDER BY date DESC, updated_at DESC",
    )
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
    use crate::commands::categories::do_create_category;
    use crate::commands::credit_entries::do_create_credit_entry;
    use crate::commands::customers::do_create_customer;
    use crate::commands::stations::do_create_station;
    use crate::db::test_helpers::setup_test_db;

    // -----------------------------------------------------------------------
    // get_customer_balances
    // -----------------------------------------------------------------------

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

        // Insert a Credit session directly via SQL — do_create_session's
        // public API doesn't accept method/customer_id at creation time.
        // A fresh test DB has no stations of its own, unlike the real app
        // (seeded via the UI) -- create one first rather than assuming any
        // row is already there to select.
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

    // -----------------------------------------------------------------------
    // get_customer_credit_history
    // -----------------------------------------------------------------------

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
