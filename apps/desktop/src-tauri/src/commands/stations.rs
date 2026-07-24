use crate::models::Station;
use sqlx::SqlitePool;
use tauri::State;

// Read-only, same rationale as categories.rs.
#[tauri::command]
pub async fn list_stations(pool: State<'_, SqlitePool>) -> Result<Vec<Station>, String> {
    sqlx::query_as::<_, Station>("SELECT id, category_id, name FROM stations ORDER BY name")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}
