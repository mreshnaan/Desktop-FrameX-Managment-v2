use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Offer;
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) const OFFER_COLUMNS: &str = "id, name, active, applies_to_all_categories, category_ids, \
    days, start_time, end_time, start_date, end_date, min_duration_minutes, \
    min_game_count, effect_type, effect_value, updated_at";

pub(crate) async fn do_list_offers(pool: &SqlitePool) -> Result<Vec<Offer>, String> {
    sqlx::query_as::<_, Offer>(&format!("SELECT {OFFER_COLUMNS} FROM offers"))
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_offers(pool: State<'_, SqlitePool>) -> Result<Vec<Offer>, String> {
    do_list_offers(pool.inner()).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferInput {
    pub name: String,
    pub active: bool,
    pub applies_to_all_categories: bool,
    pub category_ids: Option<String>,
    pub days: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub min_duration_minutes: Option<i64>,
    pub min_game_count: Option<i64>,
    pub effect_type: String,
    pub effect_value: i64,
}

fn offer_payload(o: &Offer, created_by: &Option<String>, updated_by: &Option<String>) -> serde_json::Value {
    json!({
        "id": o.id, "name": o.name, "active": o.active,
        "appliesToAllCategories": o.applies_to_all_categories, "categoryIds": o.category_ids,
        "days": o.days, "startTime": o.start_time, "endTime": o.end_time,
        "startDate": o.start_date, "endDate": o.end_date,
        "minDurationMinutes": o.min_duration_minutes, "minGameCount": o.min_game_count,
        "effectType": o.effect_type, "effectValue": o.effect_value,
        "updatedAt": o.updated_at, "createdBy": created_by, "updatedBy": updated_by,
    })
}

pub(crate) async fn do_create_offer(pool: &SqlitePool, input: OfferInput) -> Result<Offer, String> {
    let offer = Offer {
        id: Uuid::new_v4().to_string(),
        name: input.name,
        active: true,
        applies_to_all_categories: input.applies_to_all_categories,
        category_ids: input.category_ids,
        days: input.days,
        start_time: input.start_time,
        end_time: input.end_time,
        start_date: input.start_date,
        end_date: input.end_date,
        min_duration_minutes: input.min_duration_minutes,
        min_game_count: input.min_game_count,
        effect_type: input.effect_type,
        effect_value: input.effect_value,
        updated_at: crate::time::now_iso(),
    };

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO offers (id, name, active, applies_to_all_categories, category_ids, \
         days, start_time, end_time, start_date, end_date, min_duration_minutes, \
         min_game_count, effect_type, effect_value, updated_at, created_by, updated_by) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&offer.id)
    .bind(&offer.name)
    .bind(offer.active)
    .bind(offer.applies_to_all_categories)
    .bind(&offer.category_ids)
    .bind(&offer.days)
    .bind(&offer.start_time)
    .bind(&offer.end_time)
    .bind(&offer.start_date)
    .bind(&offer.end_date)
    .bind(offer.min_duration_minutes)
    .bind(offer.min_game_count)
    .bind(&offer.effect_type)
    .bind(offer.effect_value)
    .bind(&offer.updated_at)
    .bind(&actor)
    .bind(&actor)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "offers", "upsert", &offer.id, &offer_payload(&offer, &actor, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(offer)
}

#[tauri::command]
pub async fn create_offer(pool: State<'_, SqlitePool>, input: OfferInput) -> Result<Offer, String> {
    do_create_offer(pool.inner(), input).await
}

// Full-object update, mirroring Product's active-toggle precedent: there is no
// dedicated "toggle active" command -- the caller always resends every field,
// including active, whether they changed it or just flipped the toggle.
pub(crate) async fn do_update_offer(pool: &SqlitePool, id: String, input: OfferInput) -> Result<Offer, String> {
    let offer = Offer {
        id: id.clone(),
        name: input.name,
        active: input.active,
        applies_to_all_categories: input.applies_to_all_categories,
        category_ids: input.category_ids,
        days: input.days,
        start_time: input.start_time,
        end_time: input.end_time,
        start_date: input.start_date,
        end_date: input.end_date,
        min_duration_minutes: input.min_duration_minutes,
        min_game_count: input.min_game_count,
        effect_type: input.effect_type,
        effect_value: input.effect_value,
        updated_at: crate::time::now_iso(),
    };

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE offers SET name = ?, active = ?, applies_to_all_categories = ?, category_ids = ?, \
         days = ?, start_time = ?, end_time = ?, start_date = ?, end_date = ?, \
         min_duration_minutes = ?, min_game_count = ?, effect_type = ?, effect_value = ?, \
         updated_at = ?, updated_by = ? WHERE id = ?",
    )
    .bind(&offer.name)
    .bind(offer.active)
    .bind(offer.applies_to_all_categories)
    .bind(&offer.category_ids)
    .bind(&offer.days)
    .bind(&offer.start_time)
    .bind(&offer.end_time)
    .bind(&offer.start_date)
    .bind(&offer.end_date)
    .bind(offer.min_duration_minutes)
    .bind(offer.min_game_count)
    .bind(&offer.effect_type)
    .bind(offer.effect_value)
    .bind(&offer.updated_at)
    .bind(&actor)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    enqueue_outbox_tx(&mut tx, "offers", "upsert", &id, &offer_payload(&offer, &None, &actor))
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(offer)
}

#[tauri::command]
pub async fn update_offer(pool: State<'_, SqlitePool>, id: String, input: OfferInput) -> Result<Offer, String> {
    do_update_offer(pool.inner(), id, input).await
}

// Test-only helper used by sessions.rs's own tests to build a minimal
// extraTime OfferInput without duplicating every field default inline.
pub(crate) fn tests_helpers_offer_input_extra_time(free_minutes: i64, min_duration_minutes: Option<i64>) -> OfferInput {
    OfferInput {
        name: "Weekday Special".to_string(),
        active: true,
        applies_to_all_categories: true,
        category_ids: None,
        days: None,
        start_time: None,
        end_time: None,
        start_date: None,
        end_date: None,
        min_duration_minutes,
        min_game_count: None,
        effect_type: "extraTime".to_string(),
        effect_value: free_minutes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;

    fn sample_input(effect_type: &str, effect_value: i64) -> OfferInput {
        OfferInput {
            name: "Weekday Special".to_string(),
            active: true,
            applies_to_all_categories: false,
            category_ids: Some("cat-1".to_string()),
            days: Some("mon,tue,wed,thu,fri".to_string()),
            start_time: None,
            end_time: None,
            start_date: None,
            end_date: None,
            min_duration_minutes: Some(90),
            min_game_count: None,
            effect_type: effect_type.to_string(),
            effect_value,
        }
    }

    #[tokio::test]
    async fn creates_an_offer_active_by_default() {
        let pool = setup_test_db().await;
        let offer = do_create_offer(&pool, sample_input("extraTime", 30)).await.unwrap();
        assert!(offer.active);
        assert_eq!(offer.name, "Weekday Special");
        assert_eq!(offer.min_duration_minutes, Some(90));
    }

    #[tokio::test]
    async fn lists_created_offers() {
        let pool = setup_test_db().await;
        do_create_offer(&pool, sample_input("extraTime", 30)).await.unwrap();
        let offers = do_list_offers(&pool).await.unwrap();
        assert_eq!(offers.len(), 1);
    }

    #[tokio::test]
    async fn updating_can_toggle_active_off() {
        let pool = setup_test_db().await;
        let created = do_create_offer(&pool, sample_input("percentOff", 10)).await.unwrap();
        assert!(created.active);

        let mut input = sample_input("percentOff", 10);
        input.active = false;
        let updated = do_update_offer(&pool, created.id, input).await.unwrap();
        assert!(!updated.active);
    }

    #[tokio::test]
    async fn applies_to_all_categories_and_category_ids_can_both_be_stored_as_given() {
        // The Rust layer doesn't validate/clear category_ids when
        // applies_to_all_categories is true -- that's a frontend zod-level
        // concern (the form only shows the checklist when "All categories" is
        // unchecked). This test documents that the CRUD layer is a faithful
        // store, not a validator, so a future reader doesn't mistake the
        // absence of that clearing logic for a bug.
        let pool = setup_test_db().await;
        let mut input = sample_input("percentOff", 10);
        input.applies_to_all_categories = true;
        input.category_ids = Some("cat-1,cat-2".to_string());
        let offer = do_create_offer(&pool, input).await.unwrap();
        assert!(offer.applies_to_all_categories);
        assert_eq!(offer.category_ids, Some("cat-1,cat-2".to_string()));
    }
}
