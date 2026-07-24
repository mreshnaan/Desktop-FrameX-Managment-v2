use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Session;
use crate::money::{calc_frame_amount, calc_time_amount};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// Used by the customer-balance calculation (useCustomers.ts), which needs
// every Credit session for a customer regardless of date, not just one day.
#[tauri::command]
pub async fn list_all_sessions(pool: State<'_, SqlitePool>) -> Result<Vec<Session>, String> {
    sqlx::query_as::<_, Session>(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at
         FROM sessions WHERE deleted_at IS NULL",
    )
    .fetch_all(pool.inner())
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
    sqlx::query_as::<_, Session>(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at
         FROM sessions WHERE date >= ? AND date <= ? AND deleted_at IS NULL",
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_sessions_for_date(
    pool: State<'_, SqlitePool>,
    date: String,
) -> Result<Vec<Session>, String> {
    sqlx::query_as::<_, Session>(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at
         FROM sessions WHERE date = ? AND deleted_at IS NULL",
    )
    .bind(date)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

fn session_payload(s: &Session) -> serde_json::Value {
    json!({
        "id": s.id, "stationId": s.station_id, "date": s.date, "start": s.start, "end": s.end,
        "amount": s.amount, "method": s.method, "customerId": s.customer_id,
        "updatedAt": s.updated_at, "deletedAt": s.deleted_at,
    })
}

#[tauri::command]
pub async fn create_session(
    pool: State<'_, SqlitePool>,
    station_id: String,
    category_id: String,
    billing_type: String,
    date: String,
) -> Result<Session, String> {
    let amount = if billing_type == "frame" {
        let rate: Option<(Option<i64>,)> =
            sqlx::query_as("SELECT frame_rate FROM rates WHERE category_id = ?")
                .bind(&category_id)
                .fetch_optional(pool.inner())
                .await
                .map_err(|e| e.to_string())?;
        calc_frame_amount(rate.and_then(|r| r.0).unwrap_or(0))
    } else {
        0
    };

    let session = Session {
        id: Uuid::new_v4().to_string(),
        station_id,
        date,
        start: String::new(),
        end: String::new(),
        amount,
        method: "Cash".to_string(),
        customer_id: None,
        updated_at: Utc::now().to_rfc3339(),
        deleted_at: None,
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sessions (id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
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
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "sessions", "upsert", &session.id, &session_payload(&session))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(session)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub start: Option<String>,
    pub end: Option<String>,
    pub amount: Option<i64>,
    pub method: Option<String>,
    pub customer_id: Option<Option<String>>,
}

#[tauri::command]
pub async fn update_session(
    pool: State<'_, SqlitePool>,
    id: String,
    patch: SessionPatch,
) -> Result<Session, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let mut existing: Session = sqlx::query_as(
        "SELECT id, station_id, date, start, \"end\", amount, method, customer_id, updated_at, deleted_at
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
            }
        }
    }
    existing.updated_at = Utc::now().to_rfc3339();

    sqlx::query(
        "UPDATE sessions SET start = ?, \"end\" = ?, amount = ?, method = ?, customer_id = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&existing.start)
    .bind(&existing.end)
    .bind(existing.amount)
    .bind(&existing.method)
    .bind(&existing.customer_id)
    .bind(&existing.updated_at)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "sessions", "upsert", &id, &session_payload(&existing))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(existing)
}

#[tauri::command]
pub async fn delete_session(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let result = sqlx::query("UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Ok(());
    }

    enqueue_outbox_tx(&mut tx, "sessions", "delete", &id, &json!({ "id": id }))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}
