use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::ProductCategory;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_product_categories(pool: &SqlitePool) -> Result<Vec<ProductCategory>, String> {
    sqlx::query_as::<_, ProductCategory>("SELECT id, name FROM product_categories ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_product_categories(pool: State<'_, SqlitePool>) -> Result<Vec<ProductCategory>, String> {
    do_list_product_categories(pool.inner()).await
}

pub(crate) async fn do_create_product_category(pool: &SqlitePool, name: String) -> Result<ProductCategory, String> {
    let category = ProductCategory { id: Uuid::new_v4().to_string(), name };
    let actor = get_current_actor(pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO product_categories (id, name, created_by, updated_by) VALUES (?, ?, ?, ?)")
        .bind(&category.id)
        .bind(&category.name)
        .bind(&actor)
        .bind(&actor)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({ "id": category.id, "name": category.name, "createdBy": actor, "updatedBy": actor });
    enqueue_outbox_tx(&mut tx, "productCategories", "upsert", &category.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(category)
}

#[tauri::command]
pub async fn create_product_category(pool: State<'_, SqlitePool>, name: String) -> Result<ProductCategory, String> {
    do_create_product_category(pool.inner(), name).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn creates_a_product_category_and_enqueues_an_outbox_entry() {
        let pool = setup_test_db().await;

        let category = do_create_product_category(&pool, "Snacks".to_string()).await.unwrap();

        let listed = do_list_product_categories(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, category.id);

        let (outbox_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM outbox WHERE table_name = 'productCategories'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(outbox_count, 1);
    }
}
