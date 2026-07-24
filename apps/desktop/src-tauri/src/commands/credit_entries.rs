use crate::commands::sync::enqueue_outbox_tx;
use crate::models::CreditEntry;
use chrono::Utc;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_credit_entries(pool: State<'_, SqlitePool>) -> Result<Vec<CreditEntry>, String> {
    sqlx::query_as::<_, CreditEntry>(
        "SELECT id, customer_id, date, type, amount, updated_at FROM credit_entries",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_credit_entry(
    pool: State<'_, SqlitePool>,
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
        updated_at: Utc::now().to_rfc3339(),
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
