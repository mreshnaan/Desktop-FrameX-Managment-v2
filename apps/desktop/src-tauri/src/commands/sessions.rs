use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Session;
use crate::money::{calc_frame_amount, calc_time_amount};
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_all_sessions(pool: &SqlitePool) -> Result<Vec<Session>, String> {
    sqlx::query_as::<_, Session>(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
         FROM sessions WHERE deleted_at IS NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

// Used by the customer-balance calculation (useCustomers.ts), which needs
// every Credit session for a customer regardless of date, not just one day.
#[tauri::command]
pub async fn list_all_sessions(pool: State<'_, SqlitePool>) -> Result<Vec<Session>, String> {
    do_list_all_sessions(pool.inner()).await
}

pub(crate) async fn do_list_sessions_between(
    pool: &SqlitePool,
    start_date: String,
    end_date: String,
) -> Result<Vec<Session>, String> {
    sqlx::query_as::<_, Session>(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
         FROM sessions WHERE date >= ? AND date <= ? AND deleted_at IS NULL",
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

// Used by Monthly Sales, which needs every session across a date range, not
// just one day.
#[tauri::command]
pub async fn list_sessions_between(
    pool: State<'_, SqlitePool>,
    start_date: String,
    end_date: String,
) -> Result<Vec<Session>, String> {
    do_list_sessions_between(pool.inner(), start_date, end_date).await
}

pub(crate) async fn do_list_sessions_for_date(pool: &SqlitePool, date: String) -> Result<Vec<Session>, String> {
    sqlx::query_as::<_, Session>(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
         FROM sessions WHERE date = ? AND deleted_at IS NULL",
    )
    .bind(date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_sessions_for_date(pool: State<'_, SqlitePool>, date: String) -> Result<Vec<Session>, String> {
    do_list_sessions_for_date(pool.inner(), date).await
}

fn session_payload(s: &Session, created_by: &Option<String>, updated_by: &Option<String>) -> serde_json::Value {
    json!({
        "id": s.id, "stationId": s.station_id, "date": s.date, "start": s.start, "end": s.end,
        "amount": s.amount, "method": s.method, "customerId": s.customer_id,
        "updatedAt": s.updated_at, "deletedAt": s.deleted_at,
        "createdBy": created_by, "updatedBy": updated_by,
        "metadata": s.metadata.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
    })
}

pub(crate) async fn do_create_session(
    pool: &SqlitePool,
    station_id: String,
    category_id: String,
    billing_type: String,
    date: String,
) -> Result<Session, String> {
    let (amount, metadata) = if billing_type == "frame" {
        let rate: Option<(Option<i64>,)> =
            sqlx::query_as("SELECT frame_rate FROM rates WHERE category_id = ?")
                .bind(&category_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?;
        let rate_value = rate.and_then(|r| r.0).unwrap_or(0);
        let metadata = json!({"billingType": "frame", "rateValue": rate_value}).to_string();
        (calc_frame_amount(rate_value), Some(metadata))
    } else {
        (0, None)
    };

    let session = Session {
        id: Uuid::new_v4().to_string(),
        station_id,
        date,
        start: String::new(),
        end: String::new(),
        amount,
        method: None,
        customer_id: None,
        updated_at: crate::time::now_iso(),
        deleted_at: None,
        metadata,
    };

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
    )
    .bind(&session.id)
    .bind(&session.station_id)
    .bind(&session.date)
    .bind(&session.start)
    .bind(&session.end)
    .bind(session.amount)
    .bind(&session.method)
    .bind(&session.customer_id)
    .bind(&session.updated_at)
    .bind(&session.metadata)
    .bind(&actor)
    .bind(&actor)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "sessions", "upsert", &session.id, &session_payload(&session, &actor, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(session)
}

#[tauri::command]
pub async fn create_session(
    pool: State<'_, SqlitePool>,
    station_id: String,
    category_id: String,
    billing_type: String,
    date: String,
) -> Result<Session, String> {
    do_create_session(pool.inner(), station_id, category_id, billing_type, date).await
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub start: Option<String>,
    pub end: Option<String>,
    pub amount: Option<i64>,
    pub method: Option<Option<String>>,
    pub customer_id: Option<Option<String>>,
}

pub(crate) async fn do_update_session(pool: &SqlitePool, id: String, patch: SessionPatch) -> Result<Session, String> {
    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let mut existing: Session = sqlx::query_as(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata
         FROM sessions WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let time_patched = patch.start.is_some() || patch.end.is_some();
    if let Some(v) = patch.start { existing.start = v; }
    if let Some(v) = patch.end { existing.end = v; }
    if let Some(v) = patch.amount { existing.amount = v; }
    if let Some(v) = patch.method { existing.method = v; }
    if let Some(v) = patch.customer_id { existing.customer_id = v; }

    if time_patched && !existing.start.is_empty() && !existing.end.is_empty() {
        let rate: Option<(String, Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT c.billing_type, r.hour_rate, r.half_rate
             FROM stations st JOIN categories c ON c.id = st.category_id
             LEFT JOIN rates r ON r.category_id = c.id
             WHERE st.id = ?",
        )
        .bind(&existing.station_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        if let Some((billing_type, hour_rate, half_rate)) = rate {
            if billing_type == "time" {
                existing.amount = calc_time_amount(
                    &existing.start,
                    &existing.end,
                    hour_rate.unwrap_or(0),
                    half_rate.unwrap_or(0),
                );
                existing.metadata = Some(
                    json!({"billingType": "time", "hourRate": hour_rate.unwrap_or(0), "halfRate": half_rate.unwrap_or(0)}).to_string(),
                );
            }
        }
    }
    existing.updated_at = crate::time::now_iso();

    sqlx::query(
        "UPDATE sessions SET start = ?, \"end\" = ?, amount = ?, method = ?, customer_id = ?, updated_at = ?, updated_by = ?, metadata = ? WHERE id = ?",
    )
    .bind(&existing.start)
    .bind(&existing.end)
    .bind(existing.amount)
    .bind(&existing.method)
    .bind(&existing.customer_id)
    .bind(&existing.updated_at)
    .bind(&actor)
    .bind(&existing.metadata)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "sessions", "upsert", &id, &session_payload(&existing, &None, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(existing)
}

#[tauri::command]
pub async fn update_session(pool: State<'_, SqlitePool>, id: String, patch: SessionPatch) -> Result<Session, String> {
    do_update_session(pool.inner(), id, patch).await
}

pub(crate) async fn do_delete_session(pool: &SqlitePool, id: String) -> Result<(), String> {
    let now = crate::time::now_iso();
    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let result = sqlx::query("UPDATE sessions SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&actor)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Ok(());
    }

    enqueue_outbox_tx(&mut tx, "sessions", "delete", &id, &json!({ "id": id, "updatedBy": actor }))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_session(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    do_delete_session(pool.inner(), id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::categories::do_create_category;
    use crate::commands::rates::do_upsert_rate;
    use crate::commands::stations::do_create_station;
    use crate::db::test_helpers::setup_test_db;

    async fn seed_time_station(pool: &SqlitePool, hour_rate: i64, half_rate: i64) -> (String, String) {
        let category = do_create_category(pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();
        do_upsert_rate(pool, category.id.clone(), Some(hour_rate), Some(half_rate), None).await.unwrap();
        let station = do_create_station(pool, category.id.clone(), "Table 1".to_string()).await.unwrap();
        (station.id, category.id)
    }

    async fn seed_frame_station(pool: &SqlitePool, frame_rate: i64) -> (String, String) {
        let category = do_create_category(pool, "Snooker".to_string(), "frame".to_string()).await.unwrap();
        do_upsert_rate(pool, category.id.clone(), None, None, Some(frame_rate)).await.unwrap();
        let station = do_create_station(pool, category.id.clone(), "Table 1".to_string()).await.unwrap();
        (station.id, category.id)
    }

    #[tokio::test]
    async fn a_frame_session_gets_its_amount_immediately_with_no_start_end() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;

        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        assert_eq!(session.amount, 150);
        assert_eq!(session.start, "");
    }

    #[tokio::test]
    async fn a_frame_session_stores_the_rate_used_as_metadata() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;

        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        let metadata: serde_json::Value = serde_json::from_str(session.metadata.as_deref().unwrap()).unwrap();
        assert_eq!(metadata["billingType"], "frame");
        assert_eq!(metadata["rateValue"], 150);
    }

    #[tokio::test]
    async fn a_time_session_has_no_metadata_until_the_first_recompute_then_stores_both_rates() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 200, 100).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();
        assert!(session.metadata.is_none(), "no rate has been used yet -- amount is still 0");

        let updated = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("09:00".to_string()), end: Some("10:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();

        let metadata: serde_json::Value = serde_json::from_str(updated.metadata.as_deref().unwrap()).unwrap();
        assert_eq!(metadata["billingType"], "time");
        assert_eq!(metadata["hourRate"], 200);
        assert_eq!(metadata["halfRate"], 100);
    }

    #[tokio::test]
    async fn a_time_session_starts_at_zero_and_recalculates_when_start_and_end_are_patched() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 200, 100).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();
        assert_eq!(session.amount, 0);

        let updated = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("09:00".to_string()), end: Some("10:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();

        // 1.5 hours at 200/hr + 100/half-hour = 300, matching money.rs's calc_time_amount tests.
        assert_eq!(updated.amount, 300);
    }

    #[tokio::test]
    async fn patching_only_the_method_does_not_recompute_the_amount() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 200, 100).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();
        let with_time = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("09:00".to_string()), end: Some("10:00".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(with_time.amount, 200);

        let updated = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { method: Some(Some("Card".to_string())), ..Default::default() },
        )
        .await
        .unwrap();

        assert_eq!(updated.amount, 200, "amount must be untouched when neither start nor end is patched");
        assert_eq!(updated.method, Some("Card".to_string()));
    }

    #[tokio::test]
    async fn soft_deletes_a_session() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        do_delete_session(&pool, session.id.clone()).await.unwrap();

        let for_date = do_list_sessions_for_date(&pool, "2026-07-25".to_string()).await.unwrap();
        assert!(for_date.is_empty());
    }

    #[tokio::test]
    async fn list_sessions_between_only_returns_sessions_in_range() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        do_create_session(&pool, station_id.clone(), category_id.clone(), "frame".to_string(), "2026-07-10".to_string()).await.unwrap();
        do_create_session(&pool, station_id.clone(), category_id.clone(), "frame".to_string(), "2026-07-20".to_string()).await.unwrap();
        do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-08-01".to_string()).await.unwrap();

        let in_july = do_list_sessions_between(&pool, "2026-07-01".to_string(), "2026-07-31".to_string()).await.unwrap();

        assert_eq!(in_july.len(), 2);
    }

    #[tokio::test]
    async fn a_new_session_has_no_method_chosen() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;

        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        assert_eq!(session.method, None);
    }
}
