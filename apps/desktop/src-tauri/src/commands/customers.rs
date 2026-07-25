use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Customer;
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
        updated_at: crate::time::now_iso(),
        deleted_at: None,
    };
    let actor = get_current_actor(pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO customers (id, name, phone, updated_at, deleted_at, created_by, updated_by) VALUES (?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(&customer.id)
    .bind(&customer.name)
    .bind(&customer.phone)
    .bind(&customer.updated_at)
    .bind(&actor)
    .bind(&actor)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": customer.id, "name": customer.name, "phone": customer.phone,
        "updatedAt": customer.updated_at, "deletedAt": null,
        "createdBy": actor, "updatedBy": actor,
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
    let now = crate::time::now_iso();
    let actor = get_current_actor(pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let result = sqlx::query("UPDATE customers SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
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

    let payload = json!({ "id": id, "updatedBy": actor });
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
    async fn stamps_created_by_and_updated_by_from_the_current_actor() {
        let pool = setup_test_db().await;
        crate::commands::current_actor::do_set_current_actor(&pool, "user-1".to_string()).await.unwrap();

        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        let (created_by, updated_by): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT created_by, updated_by FROM customers WHERE id = ?")
                .bind(&customer.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(created_by, Some("user-1".to_string()));
        assert_eq!(updated_by, Some("user-1".to_string()));
    }

    #[tokio::test]
    async fn deleting_updates_updated_by_to_whoever_is_now_acting() {
        let pool = setup_test_db().await;
        crate::commands::current_actor::do_set_current_actor(&pool, "user-1".to_string()).await.unwrap();
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        crate::commands::current_actor::do_set_current_actor(&pool, "user-2".to_string()).await.unwrap();
        do_delete_customer(&pool, customer.id.clone()).await.unwrap();

        let (created_by, updated_by): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT created_by, updated_by FROM customers WHERE id = ?")
                .bind(&customer.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(created_by, Some("user-1".to_string()), "created_by must survive later writes by someone else");
        assert_eq!(updated_by, Some("user-2".to_string()));
    }

    #[tokio::test]
    async fn no_current_actor_leaves_created_by_and_updated_by_null_instead_of_erroring() {
        let pool = setup_test_db().await;
        let customer = do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        let (created_by, updated_by): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT created_by, updated_by FROM customers WHERE id = ?")
                .bind(&customer.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(created_by, None);
        assert_eq!(updated_by, None);
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
