use crate::commands::current_actor::get_current_actor;
use crate::commands::sync::enqueue_outbox_tx;
use crate::models::Station;
use serde_json::json;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn do_list_stations(pool: &SqlitePool) -> Result<Vec<Station>, String> {
    sqlx::query_as::<_, Station>("SELECT id, category_id, name FROM stations ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_stations(pool: State<'_, SqlitePool>) -> Result<Vec<Station>, String> {
    do_list_stations(pool.inner()).await
}

pub(crate) async fn do_create_station(pool: &SqlitePool, category_id: String, name: String) -> Result<Station, String> {
    let station = Station { id: Uuid::new_v4().to_string(), category_id, name };
    let actor = get_current_actor(pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO stations (id, category_id, name, created_by, updated_by) VALUES (?, ?, ?, ?, ?)")
        .bind(&station.id)
        .bind(&station.category_id)
        .bind(&station.name)
        .bind(&actor)
        .bind(&actor)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": station.id, "categoryId": station.category_id, "name": station.name,
        "createdBy": actor, "updatedBy": actor,
    });
    enqueue_outbox_tx(&mut tx, "stations", "upsert", &station.id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(station)
}

#[tauri::command]
pub async fn create_station(pool: State<'_, SqlitePool>, category_id: String, name: String) -> Result<Station, String> {
    do_create_station(pool.inner(), category_id, name).await
}

pub(crate) async fn do_update_station(pool: &SqlitePool, id: String, name: String) -> Result<Station, String> {
    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let existing: Station = sqlx::query_as("SELECT id, category_id, name FROM stations WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let station = Station { id: existing.id, category_id: existing.category_id, name };

    sqlx::query("UPDATE stations SET name = ?, updated_by = ? WHERE id = ?")
        .bind(&station.name)
        .bind(&actor)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let payload = json!({
        "id": station.id, "categoryId": station.category_id, "name": station.name, "updatedBy": actor,
    });
    enqueue_outbox_tx(&mut tx, "stations", "upsert", &id, &payload)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(station)
}

#[tauri::command]
pub async fn update_station(pool: State<'_, SqlitePool>, id: String, name: String) -> Result<Station, String> {
    do_update_station(pool.inner(), id, name).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::categories::do_create_category;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn creates_a_station_under_a_category() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();

        let station = do_create_station(&pool, category.id.clone(), "Table 1".to_string()).await.unwrap();

        let listed = do_list_stations(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].category_id, category.id);
        assert_eq!(station.name, "Table 1");
    }

    #[tokio::test]
    async fn rejects_a_station_for_an_unknown_category() {
        let pool = setup_test_db().await;
        let result = do_create_station(&pool, "does-not-exist".to_string(), "Table 1".to_string()).await;
        assert!(result.is_err(), "the categoryId foreign key must be enforced");
    }

    #[tokio::test]
    async fn renames_a_station_without_changing_its_category() {
        let pool = setup_test_db().await;
        let category = do_create_category(&pool, "8-Ball".to_string(), "time".to_string()).await.unwrap();
        let station = do_create_station(&pool, category.id.clone(), "Table 1".to_string()).await.unwrap();

        let updated = do_update_station(&pool, station.id, "Table 1A".to_string()).await.unwrap();

        assert_eq!(updated.name, "Table 1A");
        assert_eq!(updated.category_id, category.id);
    }
}
