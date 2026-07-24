use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Customer;
use chrono::Utc;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_customers(pool: State<'_, SqlitePool>) -> Result<Vec<Customer>, String> {
    sqlx::query_as::<_, Customer>(
        "SELECT id, name, phone, updated_at, deleted_at FROM customers WHERE deleted_at IS NULL ORDER BY name",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_customer(
    pool: State<'_, SqlitePool>,
    name: String,
    phone: String,
) -> Result<Customer, String> {
    let customer = Customer {
        id: Uuid::new_v4().to_string(),
        name,
        phone,
        updated_at: Utc::now().to_rfc3339(),
        deleted_at: None,
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO customers (id, name, phone, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)")
        .bind(&customer.id)
        .bind(&customer.name)
        .bind(&customer.phone)
        .bind(&customer.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": customer.id, "name": customer.name, "phone": customer.phone,
        "updatedAt": customer.updated_at, "deletedAt": null,
    });
    enqueue_outbox_tx(&mut tx, "customers", "upsert", &customer.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(customer)
}

#[tauri::command]
pub async fn delete_customer(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let result = sqlx::query("UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Ok(());
    }

    let payload = json!({ "id": id });
    enqueue_outbox_tx(&mut tx, "customers", "delete", &id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}
