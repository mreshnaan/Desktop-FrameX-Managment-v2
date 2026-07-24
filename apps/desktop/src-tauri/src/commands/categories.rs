use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Category;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_categories(pool: State<'_, SqlitePool>) -> Result<Vec<Category>, String> {
    sqlx::query_as::<_, Category>("SELECT id, name, billing_type FROM categories ORDER BY name")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

// Category/station writes are admin-only in the UI (gated by the
// 'categoryManagement' permission) but, unlike every other domain here,
// categories/stations have no updated_at column locally (see the desktop
// design spec) -- the outbox payload still needs an updatedAt for
// apps/api's last-write-wins comparison on other tables, so we stamp one at
// push time without persisting it locally.
#[tauri::command]
pub async fn create_category(
    pool: State<'_, SqlitePool>,
    name: String,
    billing_type: String,
) -> Result<Category, String> {
    let category = Category {
        id: Uuid::new_v4().to_string(),
        name,
        billing_type,
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO categories (id, name, billing_type) VALUES (?, ?, ?)")
        .bind(&category.id)
        .bind(&category.name)
        .bind(&category.billing_type)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": category.id, "name": category.name, "billingType": category.billing_type,
    });
    enqueue_outbox_tx(&mut tx, "categories", "upsert", &category.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(category)
}

#[tauri::command]
pub async fn update_category(
    pool: State<'_, SqlitePool>,
    id: String,
    name: String,
    billing_type: String,
) -> Result<Category, String> {
    let category = Category { id: id.clone(), name, billing_type };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE categories SET name = ?, billing_type = ? WHERE id = ?")
        .bind(&category.name)
        .bind(&category.billing_type)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": category.id, "name": category.name, "billingType": category.billing_type,
    });
    enqueue_outbox_tx(&mut tx, "categories", "upsert", &id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(category)
}

// No delete command: categories/stations have no soft-delete column
// (deleted_at) locally or on apps/api, and every session/rate references
// them by FK -- deleting one would either orphan history or require a much
// larger cascade/reassignment flow that's out of scope here. Renaming
// (update_category/update_station) covers the realistic "we misnamed this"
// case.
