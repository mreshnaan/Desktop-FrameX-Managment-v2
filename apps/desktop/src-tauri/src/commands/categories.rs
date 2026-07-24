use crate::models::Category;
use sqlx::SqlitePool;
use tauri::State;

// Read-only: categories are seeded server-side and populated locally by
// sync -- nothing in this app ever writes to the categories table directly.
#[tauri::command]
pub async fn list_categories(pool: State<'_, SqlitePool>) -> Result<Vec<Category>, String> {
    sqlx::query_as::<_, Category>("SELECT id, name, billing_type FROM categories ORDER BY name")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}
