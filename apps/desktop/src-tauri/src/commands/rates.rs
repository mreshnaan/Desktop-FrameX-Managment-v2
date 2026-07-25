use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Rate;
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
    // Resolved before pool.begin() below -- get_current_actor(pool) acquires
    // its own connection from the pool, which would otherwise contend with
    // (or, on a pool sized down to a single connection, silently fail
    // against) the one tx already holds. Caught by a real test failure, not
    // assumed: a max_connections(1) test pool made this deadlock/starve
    // into a silently-swallowed None instead of the real actor id.
    let actor = get_current_actor(pool).await;
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
        updated_at: crate::time::now_iso(),
    };

    // created_by is deliberately absent from the ON CONFLICT UPDATE SET
    // clause -- it's set once on the initial INSERT and never touched
    // again, so a later edit's updated_by doesn't clobber who originally
    // created the rate.
    sqlx::query(
        "INSERT INTO rates (id, category_id, hour_rate, half_rate, frame_rate, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET hour_rate = excluded.hour_rate, half_rate = excluded.half_rate,
           frame_rate = excluded.frame_rate, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    )
    .bind(&rate.id)
    .bind(&rate.category_id)
    .bind(rate.hour_rate)
    .bind(rate.half_rate)
    .bind(rate.frame_rate)
    .bind(&rate.updated_at)
    .bind(&actor)
    .bind(&actor)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let payload = json!({
        "categoryId": rate.category_id, "hour": rate.hour_rate, "half": rate.half_rate,
        "value": rate.frame_rate, "updatedAt": rate.updated_at, "updatedBy": actor,
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
    async fn upserting_again_updates_updated_by_but_never_overwrites_the_original_created_by() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();
        crate::commands::current_actor::do_set_current_actor(&pool, "owner-1".to_string()).await.unwrap();
        let rate = do_upsert_rate(&pool, category.id.clone(), Some(200), Some(100), None).await.unwrap();

        crate::commands::current_actor::do_set_current_actor(&pool, "owner-2".to_string()).await.unwrap();
        do_upsert_rate(&pool, category.id.clone(), Some(250), Some(125), None).await.unwrap();

        let (created_by, updated_by): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT created_by, updated_by FROM rates WHERE id = ?")
                .bind(&rate.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(created_by, Some("owner-1".to_string()), "created_by must survive a later edit by someone else");
        assert_eq!(updated_by, Some("owner-2".to_string()));
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
