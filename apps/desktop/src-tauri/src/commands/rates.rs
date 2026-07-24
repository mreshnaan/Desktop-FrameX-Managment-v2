use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Rate;
use chrono::Utc;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_rates(pool: State<'_, SqlitePool>) -> Result<Vec<Rate>, String> {
    sqlx::query_as::<_, Rate>(
        "SELECT id, category_id, hour_rate, half_rate, frame_rate, updated_at FROM rates",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_rate(
    pool: State<'_, SqlitePool>,
    category_id: String,
    hour_rate: Option<i64>,
    half_rate: Option<i64>,
    frame_rate: Option<i64>,
) -> Result<Rate, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let existing_id: Option<(String,)> = sqlx::query_as("SELECT id FROM rates WHERE category_id = ?")
        .bind(&category_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let rate = Rate {
        id: existing_id.map(|(id,)| id).unwrap_or_else(|| Uuid::new_v4().to_string()),
        category_id,
        hour_rate,
        half_rate,
        frame_rate,
        updated_at: Utc::now().to_rfc3339(),
    };

    sqlx::query(
        "INSERT INTO rates (id, category_id, hour_rate, half_rate, frame_rate, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET hour_rate = excluded.hour_rate, half_rate = excluded.half_rate,
           frame_rate = excluded.frame_rate, updated_at = excluded.updated_at",
    )
    .bind(&rate.id)
    .bind(&rate.category_id)
    .bind(rate.hour_rate)
    .bind(rate.half_rate)
    .bind(rate.frame_rate)
    .bind(&rate.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let payload = json!({
        "categoryId": rate.category_id, "hour": rate.hour_rate, "half": rate.half_rate,
        "value": rate.frame_rate, "updatedAt": rate.updated_at,
    });
    enqueue_outbox_tx(&mut tx, "rates", "upsert", &rate.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(rate)
}
