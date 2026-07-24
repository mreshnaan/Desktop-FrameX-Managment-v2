use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Rate;
use chrono::Utc;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_rates(pool: &SqlitePool) -> Result<Vec<Rate>, String> {
    sqlx::query_as::<_, Rate>("SELECT id, category_id, hour_rate, half_rate, frame_rate, updated_at FROM rates")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_rates(pool: State<'_, SqlitePool>) -> Result<Vec<Rate>, String> {
    do_list_rates(pool.inner()).await
}

pub(crate) async fn do_upsert_rate(
    pool: &SqlitePool,
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

#[tauri::command]
pub async fn upsert_rate(
    pool: State<'_, SqlitePool>,
    category_id: String,
    hour_rate: Option<i64>,
    half_rate: Option<i64>,
    frame_rate: Option<i64>,
) -> Result<Rate, String> {
    do_upsert_rate(pool.inner(), category_id, hour_rate, half_rate, frame_rate).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::categories::do_create_category;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn creates_a_rate_for_a_category() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();

        let rate = do_upsert_rate(&pool, category.id.clone(), Some(200), Some(100), None).await.unwrap();

        assert_eq!(rate.category_id, category.id);
        assert_eq!(rate.hour_rate, Some(200));
    }

    #[tokio::test]
    async fn upserting_the_same_category_again_updates_the_existing_row_instead_of_creating_a_second_one() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();
        let first = do_upsert_rate(&pool, category.id.clone(), Some(200), Some(100), None).await.unwrap();

        let second = do_upsert_rate(&pool, category.id.clone(), Some(250), Some(125), None).await.unwrap();

        assert_eq!(first.id, second.id, "the same category must always resolve to the same rate row id");
        let all = do_list_rates(&pool).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].hour_rate, Some(250));
    }
}
