use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Station;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_stations(pool: State<'_, SqlitePool>) -> Result<Vec<Station>, String> {
    sqlx::query_as::<_, Station>("SELECT id, category_id, name FROM stations ORDER BY name")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_station(
    pool: State<'_, SqlitePool>,
    category_id: String,
    name: String,
) -> Result<Station, String> {
    let station = Station { id: Uuid::new_v4().to_string(), category_id, name };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO stations (id, category_id, name) VALUES (?, ?, ?)")
        .bind(&station.id)
        .bind(&station.category_id)
        .bind(&station.name)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({ "id": station.id, "categoryId": station.category_id, "name": station.name });
    enqueue_outbox_tx(&mut tx, "stations", "upsert", &station.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(station)
}

#[tauri::command]
pub async fn update_station(
    pool: State<'_, SqlitePool>,
    id: String,
    name: String,
) -> Result<Station, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let existing: Station = sqlx::query_as("SELECT id, category_id, name FROM stations WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let station = Station { id: existing.id, category_id: existing.category_id, name };

    sqlx::query("UPDATE stations SET name = ? WHERE id = ?")
        .bind(&station.name)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({ "id": station.id, "categoryId": station.category_id, "name": station.name });
    enqueue_outbox_tx(&mut tx, "stations", "upsert", &id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(station)
}
