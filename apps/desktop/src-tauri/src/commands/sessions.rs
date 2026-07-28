use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::{Session, Offer};
use crate::money::{calc_frame_amount, calc_time_amount, calc_time_amount_for_duration, apply_discount_effect, billable_minutes_after_extra_time};
use crate::money::duration_minutes;
use crate::commands::offers::OFFER_COLUMNS;
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_all_sessions(pool: &SqlitePool) -> Result<Vec<Session>, String> {
    sqlx::query_as::<_, Session>(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at, offer_id, discount_amount
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
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at, offer_id, discount_amount
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
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at, offer_id, discount_amount
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

pub(crate) async fn do_count_sessions_today(
    pool: &SqlitePool,
    date: String,
    category_id: String,
    customer_id: String,
) -> Result<i64, String> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sessions s
         JOIN stations st ON s.station_id = st.id
         WHERE st.category_id = ? AND s.customer_id = ? AND s.date = ? AND s.deleted_at IS NULL",
    )
    .bind(&category_id)
    .bind(&customer_id)
    .bind(&date)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(count.0)
}

#[tauri::command]
pub async fn count_sessions_today(
    pool: State<'_, SqlitePool>,
    date: String,
    category_id: String,
    customer_id: String,
) -> Result<i64, String> {
    do_count_sessions_today(pool.inner(), date, category_id, customer_id).await
}

fn session_payload(s: &Session, created_by: &Option<String>, updated_by: &Option<String>) -> serde_json::Value {
    json!({
        "id": s.id, "stationId": s.station_id, "date": s.date, "start": s.start, "end": s.end,
        "amount": s.amount, "method": s.method, "customerId": s.customer_id,
        "updatedAt": s.updated_at, "deletedAt": s.deleted_at,
        "createdBy": created_by, "updatedBy": updated_by,
        "metadata": s.metadata.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
        "paidAt": s.paid_at,
        "offerId": s.offer_id,
        "discountAmount": s.discount_amount,
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
        paid_at: None,
        offer_id: None,
        discount_amount: None,
    };

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, created_by, updated_by, paid_at, offer_id, discount_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL)",
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
    #[serde(default, deserialize_with = "deserialize_some")]
    pub method: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub customer_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub paid_at: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub offer_id: Option<Option<String>>,
}

// Distinguishes "field absent" (outer None, via #[serde(default)]) from
// "field present" -- whether its value is JSON null (inner None, a clear)
// or a real value (inner Some) -- which a plain Option<Option<T>> cannot
// do on its own, since serde's Option deserializer short-circuits on
// `null` before ever reaching the inner type.
fn deserialize_some<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(deserializer).map(Some)
}

pub(crate) async fn do_update_session(pool: &SqlitePool, id: String, patch: SessionPatch) -> Result<Session, String> {
    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let mut existing: Session = sqlx::query_as(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at, metadata, paid_at, offer_id, discount_amount
         FROM sessions WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let time_patched = patch.start.is_some() || patch.end.is_some();
    let offer_patched = patch.offer_id.is_some();
    if let Some(v) = patch.start { existing.start = v; }
    if let Some(v) = patch.end { existing.end = v; }
    if let Some(v) = patch.amount { existing.amount = v; }
    if let Some(v) = patch.method { existing.method = v; }
    if let Some(v) = patch.customer_id { existing.customer_id = v; }
    if let Some(v) = patch.paid_at { existing.paid_at = v; }
    if let Some(v) = patch.offer_id.clone() {
        // discount_amount is only ever meaningful alongside a real offer_id --
        // clearing the offer must clear the recorded discount immediately,
        // not wait for the recompute gate below (which may never fire again
        // once offer_id is None, since its trigger condition depends on
        // offer_id being Some).
        if v.is_none() {
            existing.discount_amount = None;
        }
        existing.offer_id = v;
    }

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

    if offer_patched || (time_patched && existing.offer_id.is_some()) {
        // Applying (or clearing) an offer always recomputes from the category's
        // base rate, ignoring any prior manual amount edit or previously
        // applied offer's discount -- see the plan's Global Constraints for why
        // (predictability: "price this session correctly, with the discount,"
        // never "discount whatever number happens to be in the box"). But that
        // recompute is only trustworthy when a fresh base amount can actually
        // be derived from the rate right now; otherwise (a still-running
        // time-billed session with no end time yet) any fallback -- including
        // `existing.amount`, which may already be a previously discounted
        // number -- risks compounding a discount on top of itself. So when no
        // trustworthy fresh base is available, this whole block is a no-op.
        let category_row: Option<(String, Option<i64>, Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT c.billing_type, r.hour_rate, r.half_rate, r.frame_rate
             FROM stations st JOIN categories c ON c.id = st.category_id
             LEFT JOIN rates r ON r.category_id = c.id
             WHERE st.id = ?",
        )
        .bind(&existing.station_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let has_full_time_range = !existing.start.is_empty() && !existing.end.is_empty();
        let is_time_billed = category_row.as_ref().map(|r| r.0.as_str()) == Some("time");
        let is_frame_billed = category_row.as_ref().map(|r| r.0.as_str()) == Some("frame");
        let can_compute_fresh_base = is_frame_billed || (is_time_billed && has_full_time_range);

        if can_compute_fresh_base {
            let base_amount = if is_time_billed {
                let hour_rate = category_row.as_ref().and_then(|r| r.1).unwrap_or(0);
                let half_rate = category_row.as_ref().and_then(|r| r.2).unwrap_or(0);
                calc_time_amount(&existing.start, &existing.end, hour_rate, half_rate)
            } else {
                let frame_rate = category_row.as_ref().and_then(|r| r.3).unwrap_or(0);
                calc_frame_amount(frame_rate)
            };

            match &existing.offer_id {
                None => {
                    existing.amount = base_amount;
                    existing.discount_amount = None;
                }
                Some(offer_id) => {
                    let offer: Option<Offer> = sqlx::query_as(&format!(
                        "SELECT {OFFER_COLUMNS} FROM offers WHERE id = ?"
                    ))
                    .bind(offer_id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

                    if let Some(offer) = offer {
                        let (final_amount, discount) = if offer.effect_type == "extraTime" && is_time_billed {
                            let actual_minutes = duration_minutes(&existing.start, &existing.end);
                            let billable = billable_minutes_after_extra_time(actual_minutes, offer.effect_value);
                            let hour_rate = category_row.as_ref().and_then(|r| r.1).unwrap_or(0);
                            let half_rate = category_row.as_ref().and_then(|r| r.2).unwrap_or(0);
                            let discounted_base = calc_time_amount_for_duration(billable, hour_rate, half_rate);
                            (discounted_base, (base_amount - discounted_base).max(0))
                        } else if offer.effect_type == "extraTime" {
                            // extraTime doesn't apply to a non-time-billed category -- a no-op.
                            (base_amount, 0)
                        } else {
                            apply_discount_effect(base_amount, &offer.effect_type, offer.effect_value)
                        };
                        existing.amount = final_amount;
                        existing.discount_amount = Some(discount);
                    } else {
                        // Referenced offer no longer resolves -- fall back to
                        // the undiscounted base and clear the dangling reference.
                        existing.amount = base_amount;
                        existing.discount_amount = None;
                        existing.offer_id = None;
                    }
                }
            }
        }
        // else: no trustworthy fresh base available right now (e.g. a
        // still-running time-billed session with no end time yet) -- leave
        // amount/discount_amount exactly as they already are. offer_id was
        // already updated by the merge step above if patched; the money
        // catches up next time this block runs with a full time range.
    }

    existing.updated_at = crate::time::now_iso();

    sqlx::query(
        "UPDATE sessions SET start = ?, \"end\" = ?, amount = ?, method = ?, customer_id = ?, updated_at = ?, updated_by = ?, metadata = ?, paid_at = ?, offer_id = ?, discount_amount = ? WHERE id = ?",
    )
    .bind(&existing.start)
    .bind(&existing.end)
    .bind(existing.amount)
    .bind(&existing.method)
    .bind(&existing.customer_id)
    .bind(&existing.updated_at)
    .bind(&actor)
    .bind(&existing.metadata)
    .bind(&existing.paid_at)
    .bind(&existing.offer_id)
    .bind(existing.discount_amount)
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
    use crate::commands::offers::do_create_offer;
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

    #[tokio::test]
    async fn a_new_session_has_no_paid_at() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;

        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        assert_eq!(session.paid_at, None);
    }

    #[tokio::test]
    async fn paid_at_can_be_set_and_cleared_through_a_patch() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-25".to_string())
            .await
            .unwrap();

        let paid = do_update_session(
            &pool,
            session.id.clone(),
            SessionPatch { paid_at: Some(Some("2026-07-25T10:00:00Z".to_string())), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(paid.paid_at, Some("2026-07-25T10:00:00Z".to_string()));

        let cleared = do_update_session(
            &pool,
            session.id,
            SessionPatch { paid_at: Some(None), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(cleared.paid_at, None);
    }

    #[test]
    fn session_patch_distinguishes_absent_null_and_present_for_nested_option_fields() {
        let absent: SessionPatch = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.customer_id, None, "field absent from JSON must not touch the existing value");

        let explicit_null: SessionPatch = serde_json::from_str(r#"{"customerId": null}"#).unwrap();
        assert_eq!(explicit_null.customer_id, Some(None), "an explicit JSON null must clear the field");

        let explicit_value: SessionPatch = serde_json::from_str(r#"{"customerId": "abc123"}"#).unwrap();
        assert_eq!(explicit_value.customer_id, Some(Some("abc123".to_string())), "a real value must set the field");
    }

    #[tokio::test]
    async fn applying_an_offer_recomputes_from_the_base_rate_and_records_the_discount() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id.clone(), "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        let with_time = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("13:00".to_string()), end: Some("14:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(with_time.amount, 600); // 1.5h at 400/hr + 200/half = 600

        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, Some(90))).await.unwrap();

        let with_offer = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { offer_id: Some(Some(offer.id.clone())), ..Default::default() },
        )
        .await
        .unwrap();

        assert_eq!(with_offer.amount, 400); // billable drops to 60 min -> 1h at 400
        assert_eq!(with_offer.discount_amount, Some(200));
        assert_eq!(with_offer.offer_id, Some(offer.id));
    }

    #[tokio::test]
    async fn clearing_an_offer_restores_the_undiscounted_amount() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        let with_time = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("13:00".to_string()), end: Some("14:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, Some(90))).await.unwrap();
        let with_offer = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { offer_id: Some(Some(offer.id)), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(with_offer.amount, 400);

        let cleared = do_update_session(
            &pool,
            with_offer.id,
            SessionPatch { offer_id: Some(None), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(cleared.amount, 600);
        assert_eq!(cleared.discount_amount, None);
        assert_eq!(cleared.offer_id, None);
    }

    #[tokio::test]
    async fn clearing_an_offer_resets_discount_amount_even_without_a_full_time_range() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        let with_time = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("13:00".to_string()), end: Some("14:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, Some(90))).await.unwrap();
        let with_offer = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { offer_id: Some(Some(offer.id)), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(with_offer.amount, 400);
        assert_eq!(with_offer.discount_amount, Some(200));

        // Clear the end time first, leaving the range incomplete -- the
        // recompute gate will be false for this patch.
        let end_cleared = do_update_session(
            &pool,
            with_offer.id,
            SessionPatch { end: Some("".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(end_cleared.amount, 400, "amount is untouched -- the gate is a true no-op");

        // Now clear the offer itself, still without a full time range.
        let offer_cleared = do_update_session(
            &pool,
            end_cleared.id,
            SessionPatch { offer_id: Some(None), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(offer_cleared.offer_id, None);
        assert_eq!(offer_cleared.discount_amount, None, "discount_amount must not survive the offer that produced it being cleared");
    }

    #[tokio::test]
    async fn editing_end_time_after_applying_an_offer_keeps_the_discount() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        let with_time = do_update_session(
            &pool,
            session.id,
            SessionPatch { start: Some("13:00".to_string()), end: Some("14:30".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, Some(90))).await.unwrap();
        let with_offer = do_update_session(
            &pool,
            with_time.id,
            SessionPatch { offer_id: Some(Some(offer.id.clone())), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(with_offer.amount, 400);

        // Extend the session by 30 minutes (now 2h total) without resending offer_id.
        let extended = do_update_session(
            &pool,
            with_offer.id,
            SessionPatch { end: Some("15:00".to_string()), ..Default::default() },
        )
        .await
        .unwrap();

        // 2h actual - 30 free = 90 billable min = 1h at 400 + 30min at 200 = 600.
        assert_eq!(extended.amount, 600);
        assert_eq!(extended.offer_id, Some(offer.id));
        // Fresh base for the full 2h range is 800; discounted is 600 -> discount 200.
        assert_eq!(extended.discount_amount, Some(200));
    }

    #[tokio::test]
    async fn extra_time_offer_is_a_no_op_on_a_frame_billed_session() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let session = do_create_session(&pool, station_id, category_id, "frame".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        assert_eq!(session.amount, 150);

        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, None)).await.unwrap();
        let with_offer = do_update_session(
            &pool,
            session.id,
            SessionPatch { offer_id: Some(Some(offer.id)), ..Default::default() },
        )
        .await
        .unwrap();

        assert_eq!(with_offer.amount, 150, "extraTime must not apply to a frame-billed session");
        assert_eq!(with_offer.discount_amount, Some(0));
    }

    #[tokio::test]
    async fn applying_an_offer_to_a_still_running_session_does_not_zero_the_amount() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        // Manually set a nonzero amount without a full start/end range, so
        // "unchanged" and "spuriously recomputed" are distinguishable.
        let with_amount = do_update_session(
            &pool,
            session.id,
            SessionPatch { amount: Some(600), ..Default::default() },
        )
        .await
        .unwrap();
        // No start/end patched -- session is still "running".
        let offer = do_create_offer(&pool, crate::commands::offers::tests_helpers_offer_input_extra_time(30, None)).await.unwrap();

        let with_offer = do_update_session(
            &pool,
            with_amount.id,
            SessionPatch { offer_id: Some(Some(offer.id)), ..Default::default() },
        )
        .await
        .unwrap();

        assert_eq!(with_offer.amount, 600, "no trustworthy fresh base could be computed -- amount must stay exactly as it was");
        assert_eq!(with_offer.discount_amount, None, "nothing was applied yet since no fresh base could be computed");
    }

    #[tokio::test]
    async fn percent_off_does_not_compound_when_reapplied_without_a_full_time_range() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_time_station(&pool, 400, 200).await;
        let session = do_create_session(&pool, station_id, category_id, "time".to_string(), "2026-07-27".to_string())
            .await
            .unwrap();
        // Manually set a starting amount without a full start/end range, so
        // no fresh base can ever be computed for this session.
        let with_amount = do_update_session(
            &pool,
            session.id,
            SessionPatch { amount: Some(600), ..Default::default() },
        )
        .await
        .unwrap();

        // The existing test helper only builds extraTime offers -- build a
        // percentOff offer directly.
        let percent_offer_input = crate::commands::offers::OfferInput {
            name: "10 Percent Off".to_string(),
            active: true,
            applies_to_all_categories: true,
            category_ids: None,
            days: None,
            start_time: None,
            end_time: None,
            start_date: None,
            end_date: None,
            min_duration_minutes: None,
            min_game_count: None,
            effect_type: "percentOff".to_string(),
            effect_value: 10,
        };
        let percent_offer = do_create_offer(&pool, percent_offer_input).await.unwrap();

        let first_apply = do_update_session(
            &pool,
            with_amount.id,
            SessionPatch { offer_id: Some(Some(percent_offer.id.clone())), ..Default::default() },
        )
        .await
        .unwrap();
        // No full time range exists (start/end are still empty) -- the
        // offer-recompute block must be a no-op, leaving amount/discount
        // exactly as they were before this patch, not compounding a 10%
        // cut onto 600.
        assert_eq!(first_apply.amount, 600);
        assert_eq!(first_apply.discount_amount, None);

        // Re-applying (same offer id patched again) must still not compound.
        let second_apply = do_update_session(
            &pool,
            first_apply.id,
            SessionPatch { offer_id: Some(Some(percent_offer.id)), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(second_apply.amount, 600);
        assert_eq!(second_apply.discount_amount, None);
    }

    #[tokio::test]
    async fn count_sessions_today_counts_only_matching_customer_category_and_date() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let customer = crate::commands::customers::do_create_customer(&pool, "Ravi".to_string(), "".to_string()).await.unwrap();

        for _ in 0..3 {
            let s = do_create_session(&pool, station_id.clone(), category_id.clone(), "frame".to_string(), "2026-07-27".to_string()).await.unwrap();
            do_update_session(&pool, s.id, SessionPatch { customer_id: Some(Some(customer.id.clone())), ..Default::default() }).await.unwrap();
        }

        let count = do_count_sessions_today(&pool, "2026-07-27".to_string(), category_id, customer.id).await.unwrap();
        assert_eq!(count, 3);
    }

    #[tokio::test]
    async fn count_sessions_today_excludes_soft_deleted_sessions() {
        let pool = setup_test_db().await;
        let (station_id, category_id) = seed_frame_station(&pool, 150).await;
        let customer = crate::commands::customers::do_create_customer(&pool, "Priya".to_string(), "".to_string()).await.unwrap();

        let mut last_id = String::new();
        for _ in 0..3 {
            let s = do_create_session(&pool, station_id.clone(), category_id.clone(), "frame".to_string(), "2026-07-27".to_string()).await.unwrap();
            do_update_session(&pool, s.id.clone(), SessionPatch { customer_id: Some(Some(customer.id.clone())), ..Default::default() }).await.unwrap();
            last_id = s.id;
        }
        do_delete_session(&pool, last_id).await.unwrap();

        let count = do_count_sessions_today(&pool, "2026-07-27".to_string(), category_id, customer.id).await.unwrap();
        assert_eq!(count, 2, "the soft-deleted session must not count toward the day's total");
    }
}
