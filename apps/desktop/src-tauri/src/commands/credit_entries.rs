use crate::commands::sync::enqueue_outbox_tx;
use crate::models::CreditEntry;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_credit_entries(pool: &SqlitePool) -> Result<Vec<CreditEntry>, String> {
    sqlx::query_as::<_, CreditEntry>("SELECT id, customer_id, date, type, amount, updated_at FROM credit_entries")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_credit_entries(pool: State<'_, SqlitePool>) -> Result<Vec<CreditEntry>, String> {
    do_list_credit_entries(pool.inner()).await
}

pub(crate) async fn do_create_credit_entry(
    pool: &SqlitePool,
    customer_id: String,
    date: String,
    entry_type: String,
    amount: i64,
) -> Result<CreditEntry, String> {
    let entry = CreditEntry {
        id: Uuid::new_v4().to_string(),
        customer_id,
        date,
        entry_type,
        amount,
        updated_at: crate::time::now_iso(),
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO credit_entries (id, customer_id, date, type, amount, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&entry.id)
    .bind(&entry.customer_id)
    .bind(&entry.date)
    .bind(&entry.entry_type)
    .bind(entry.amount)
    .bind(&entry.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": entry.id, "customerId": entry.customer_id, "date": entry.date,
        "type": entry.entry_type, "amount": entry.amount, "updatedAt": entry.updated_at,
    });
    enqueue_outbox_tx(&mut tx, "creditEntries", "upsert", &entry.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(entry)
}

#[tauri::command]
pub async fn create_credit_entry(
    pool: State<'_, SqlitePool>,
    customer_id: String,
    date: String,
    entry_type: String,
    amount: i64,
) -> Result<CreditEntry, String> {
    do_create_credit_entry(pool.inner(), customer_id, date, entry_type, amount).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::customers::do_create_customer;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn records_a_credit_given_entry_for_a_real_customer() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        let entry = do_create_credit_entry(&pool, customer.id.clone(), "2026-07-25".to_string(), "CREDIT_GIVEN".to_string(), 300)
            .await
            .unwrap();

        assert_eq!(entry.amount, 300);
        let listed = do_list_credit_entries(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);
    }

    #[tokio::test]
    async fn rejects_an_entry_for_an_unknown_customer() {
        let pool = setup_test_db().await;
        let result = do_create_credit_entry(&pool, "does-not-exist".to_string(), "2026-07-25".to_string(), "CREDIT_GIVEN".to_string(), 300).await;
        assert!(result.is_err(), "customerId foreign key must be enforced");
    }
}
