use crate::commands::sync::enqueue_outbox_tx;
use crate::models::ProductCategory;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_product_categories(pool: State<'_, SqlitePool>) -> Result<Vec<ProductCategory>, String> {
    sqlx::query_as::<_, ProductCategory>("SELECT id, name FROM product_categories ORDER BY name")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_product_category(
    pool: State<'_, SqlitePool>,
    name: String,
) -> Result<ProductCategory, String> {
    let category = ProductCategory { id: Uuid::new_v4().to_string(), name };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO product_categories (id, name) VALUES (?, ?)")
        .bind(&category.id)
        .bind(&category.name)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({ "id": category.id, "name": category.name });
    enqueue_outbox_tx(&mut tx, "productCategories", "upsert", &category.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(category)
}
