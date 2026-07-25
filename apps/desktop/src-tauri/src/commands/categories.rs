use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Category;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_categories(pool: &SqlitePool) -> Result<Vec<Category>, String> {
    sqlx::query_as::<_, Category>("SELECT id, name, billing_type FROM categories ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_categories(pool: State<'_, SqlitePool>) -> Result<Vec<Category>, String> {
    do_list_categories(pool.inner()).await
}

// Category/station writes are admin-only in the UI (gated by the
// 'categoryManagement' permission) but, unlike every other domain here,
// categories/stations have no updated_at column locally (see the desktop
// design spec) -- the outbox payload still needs an updatedAt for
// apps/api's last-write-wins comparison on other tables, so we stamp one at
// push time without persisting it locally.
pub(crate) async fn do_create_category(
    pool: &SqlitePool,
    name: String,
    billing_type: String,
) -> Result<Category, String> {
    let category = Category { id: Uuid::new_v4().to_string(), name, billing_type };
    let actor = get_current_actor(pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO categories (id, name, billing_type, created_by, updated_by) VALUES (?, ?, ?, ?, ?)")
        .bind(&category.id)
        .bind(&category.name)
        .bind(&category.billing_type)
        .bind(&actor)
        .bind(&actor)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": category.id, "name": category.name, "billingType": category.billing_type,
        "createdBy": actor, "updatedBy": actor,
    });
    enqueue_outbox_tx(&mut tx, "categories", "upsert", &category.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(category)
}

#[tauri::command]
pub async fn create_category(
    pool: State<'_, SqlitePool>,
    name: String,
    billing_type: String,
) -> Result<Category, String> {
    do_create_category(pool.inner(), name, billing_type).await
}

pub(crate) async fn do_update_category(
    pool: &SqlitePool,
    id: String,
    name: String,
    billing_type: String,
) -> Result<Category, String> {
    let category = Category { id: id.clone(), name, billing_type };
    let actor = get_current_actor(pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE categories SET name = ?, billing_type = ?, updated_by = ? WHERE id = ?")
        .bind(&category.name)
        .bind(&category.billing_type)
        .bind(&actor)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": category.id, "name": category.name, "billingType": category.billing_type,
        "updatedBy": actor,
    });
    enqueue_outbox_tx(&mut tx, "categories", "upsert", &id, &payload)
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
    do_update_category(pool.inner(), id, name, billing_type).await
}

// No delete command: categories/stations have no soft-delete column
// (deleted_at) locally or on apps/api, and every session/rate references
// them by FK -- deleting one would either orphan history or require a much
// larger cascade/reassignment flow that's out of scope here. Renaming
// (update_category/update_station) covers the realistic "we misnamed this"
// case.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn creates_and_lists_a_category() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();

        let listed = do_list_categories(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, category.id);
        assert_eq!(listed[0].billing_type, "time");
    }

    #[tokio::test]
    async fn updates_a_category_name_and_billing_type() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();

        let updated = do_update_category(&pool, category.id.clone(), "9-Ball".to_string(), "frame".to_string())
            .await
            .unwrap();

        assert_eq!(updated.name, "9-Ball");
        assert_eq!(updated.billing_type, "frame");
    }

    #[tokio::test]
    async fn create_and_update_each_enqueue_exactly_one_outbox_entry() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();
        do_update_category(&pool, category.id, "9-Ball".to_string(), "time".to_string()).await.unwrap();

        let (outbox_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM outbox WHERE table_name = 'categories'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(outbox_count, 2);
    }
}
