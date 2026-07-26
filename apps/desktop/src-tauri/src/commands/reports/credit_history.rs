use serde::Serialize;
use sqlx::{FromRow, SqlitePool};

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
