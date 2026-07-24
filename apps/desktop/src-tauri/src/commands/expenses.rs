use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Expense;
use chrono::Utc;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_expenses_for_date(
    pool: State<'_, SqlitePool>,
    date: String,
) -> Result<Vec<Expense>, String> {
    sqlx::query_as::<_, Expense>(
        "SELECT id, date, description, amount, method, updated_at, deleted_at
         FROM expenses WHERE date = ? AND deleted_at IS NULL",
    )
    .bind(date)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

fn payload(e: &Expense) -> serde_json::Value {
    json!({
        "id": e.id, "date": e.date, "description": e.description, "amount": e.amount,
        "method": e.method, "updatedAt": e.updated_at, "deletedAt": e.deleted_at,
    })
}

#[tauri::command]
pub async fn create_expense(pool: State<'_, SqlitePool>, date: String) -> Result<Expense, String> {
    let expense = Expense {
        id: Uuid::new_v4().to_string(),
        date,
        description: String::new(),
        amount: 0,
        method: "Cash".to_string(),
        updated_at: Utc::now().to_rfc3339(),
        deleted_at: None,
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO expenses (id, date, description, amount, method, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(&expense.id)
    .bind(&expense.date)
    .bind(&expense.description)
    .bind(expense.amount)
    .bind(&expense.method)
    .bind(&expense.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "expenses", "upsert", &expense.id, &payload(&expense))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(expense)
}

#[tauri::command]
pub async fn update_expense(
    pool: State<'_, SqlitePool>,
    id: String,
    description: Option<String>,
    amount: Option<i64>,
    method: Option<String>,
) -> Result<Expense, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut existing: Expense = sqlx::query_as(
        "SELECT id, date, description, amount, method, updated_at, deleted_at FROM expenses WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(v) = description { existing.description = v; }
    if let Some(v) = amount { existing.amount = v; }
    if let Some(v) = method { existing.method = v; }
    existing.updated_at = Utc::now().to_rfc3339();

    sqlx::query("UPDATE expenses SET description = ?, amount = ?, method = ?, updated_at = ? WHERE id = ?")
        .bind(&existing.description)
        .bind(existing.amount)
        .bind(&existing.method)
        .bind(&existing.updated_at)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "expenses", "upsert", &id, &payload(&existing))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(existing)
}

#[tauri::command]
pub async fn delete_expense(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let result = sqlx::query("UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Ok(());
    }

    enqueue_outbox_tx(&mut tx, "expenses", "delete", &id, &json!({ "id": id }))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}
