use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Customer;
use chrono::Utc;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_customers(pool: &SqlitePool) -> Result<Vec<Customer>, String> {
    sqlx::query_as::<_, Customer>(
        "SELECT id, name, phone, updated_at, deleted_at FROM customers WHERE deleted_at IS NULL ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_customers(pool: State<'_, SqlitePool>) -> Result<Vec<Customer>, String> {
    do_list_customers(pool.inner()).await
}

pub(crate) async fn do_create_customer(pool: &SqlitePool, name: String, phone: String) -> Result<Customer, String> {
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
pub async fn create_customer(pool: State<'_, SqlitePool>, name: String, phone: String) -> Result<Customer, String> {
    do_create_customer(pool.inner(), name, phone).await
}

pub(crate) async fn do_delete_customer(pool: &SqlitePool, id: String) -> Result<(), String> {
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

#[tauri::command]
pub async fn delete_customer(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    do_delete_customer(pool.inner(), id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn creates_a_customer_and_lists_it() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "555-1234".to_string()).await.unwrap();

        let listed = do_list_customers(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, customer.id);
        assert_eq!(listed[0].phone, "555-1234");
    }

    #[tokio::test]
    async fn soft_deletes_a_customer_instead_of_removing_the_row() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        do_delete_customer(&pool, customer.id.clone()).await.unwrap();

        assert!(do_list_customers(&pool).await.unwrap().is_empty(), "soft-deleted customers must not be listed");
        let (deleted_at,): (Option<String>,) = sqlx::query_as("SELECT deleted_at FROM customers WHERE id = ?")
            .bind(&customer.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(deleted_at.is_some(), "the row must still exist with deleted_at set, not be hard-deleted");
    }

    #[tokio::test]
    async fn deleting_an_unknown_customer_is_a_no_op_not_an_error() {
        let pool = setup_test_db().await;
        let result = do_delete_customer(&pool, "does-not-exist".to_string()).await;
        assert!(result.is_ok());
    }
}
