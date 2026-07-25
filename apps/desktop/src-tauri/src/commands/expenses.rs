use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Expense;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_expenses_for_date(pool: &SqlitePool, date: String) -> Result<Vec<Expense>, String> {
    sqlx::query_as::<_, Expense>(
        "SELECT id, date, description, amount, method, updated_at, deleted_at
         FROM expenses WHERE date = ? AND deleted_at IS NULL",
    )
    .bind(date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_expenses_for_date(pool: State<'_, SqlitePool>, date: String) -> Result<Vec<Expense>, String> {
    do_list_expenses_for_date(pool.inner(), date).await
}

fn payload(e: &Expense, created_by: &Option<String>, updated_by: &Option<String>) -> serde_json::Value {
    json!({
        "id": e.id, "date": e.date, "description": e.description, "amount": e.amount,
        "method": e.method, "updatedAt": e.updated_at, "deletedAt": e.deleted_at,
        "createdBy": created_by, "updatedBy": updated_by,
    })
}

pub(crate) async fn do_create_expense(pool: &SqlitePool, date: String) -> Result<Expense, String> {
    let expense = Expense {
        id: Uuid::new_v4().to_string(),
        date,
        description: String::new(),
        amount: 0,
        method: "Cash".to_string(),
        updated_at: crate::time::now_iso(),
        deleted_at: None,
    };
    let actor = get_current_actor(pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO expenses (id, date, description, amount, method, updated_at, deleted_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(&expense.id)
    .bind(&expense.date)
    .bind(&expense.description)
    .bind(expense.amount)
    .bind(&expense.method)
    .bind(&expense.updated_at)
    .bind(&actor)
    .bind(&actor)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "expenses", "upsert", &expense.id, &payload(&expense, &actor, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(expense)
}

#[tauri::command]
pub async fn create_expense(pool: State<'_, SqlitePool>, date: String) -> Result<Expense, String> {
    do_create_expense(pool.inner(), date).await
}

pub(crate) async fn do_update_expense(
    pool: &SqlitePool,
    id: String,
    description: Option<String>,
    amount: Option<i64>,
    method: Option<String>,
) -> Result<Expense, String> {
    let actor = get_current_actor(pool).await;
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
    existing.updated_at = crate::time::now_iso();

    sqlx::query("UPDATE expenses SET description = ?, amount = ?, method = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .bind(&existing.description)
        .bind(existing.amount)
        .bind(&existing.method)
        .bind(&existing.updated_at)
        .bind(&actor)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "expenses", "upsert", &id, &payload(&existing, &None, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(existing)
}

#[tauri::command]
pub async fn update_expense(
    pool: State<'_, SqlitePool>,
    id: String,
    description: Option<String>,
    amount: Option<i64>,
    method: Option<String>,
) -> Result<Expense, String> {
    do_update_expense(pool.inner(), id, description, amount, method).await
}

pub(crate) async fn do_delete_expense(pool: &SqlitePool, id: String) -> Result<(), String> {
    let now = crate::time::now_iso();
    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let result = sqlx::query("UPDATE expenses SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&actor)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Ok(());
    }

    enqueue_outbox_tx(&mut tx, "expenses", "delete", &id, &json!({ "id": id, "updatedBy": actor }))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_expense(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    do_delete_expense(pool.inner(), id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn creates_an_expense_with_zero_amount_for_a_date() {
        let pool = setup_test_db().await;
        let expense = do_create_expense(&pool, "2026-07-25".to_string()).await.unwrap();

        assert_eq!(expense.amount, 0);
        let listed = do_list_expenses_for_date(&pool, "2026-07-25".to_string()).await.unwrap();
        assert_eq!(listed.len(), 1);
    }

    #[tokio::test]
    async fn updates_only_the_provided_fields() {
        let pool = setup_test_db().await;
        let expense = do_create_expense(&pool, "2026-07-25".to_string()).await.unwrap();

        let updated = do_update_expense(&pool, expense.id, Some("Rent".to_string()), Some(500), None).await.unwrap();

        assert_eq!(updated.description, "Rent");
        assert_eq!(updated.amount, 500);
        assert_eq!(updated.method, "Cash", "unpatched fields must be left unchanged");
    }

    #[tokio::test]
    async fn soft_deletes_and_excludes_from_the_day_list() {
        let pool = setup_test_db().await;
        let expense = do_create_expense(&pool, "2026-07-25".to_string()).await.unwrap();

        do_delete_expense(&pool, expense.id).await.unwrap();

        assert!(do_list_expenses_for_date(&pool, "2026-07-25".to_string()).await.unwrap().is_empty());
    }
}
