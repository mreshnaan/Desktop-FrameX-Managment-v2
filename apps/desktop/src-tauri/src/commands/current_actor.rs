use sqlx::SqlitePool;
use tauri::State;

// Single-row table holding "who is acting right now" -- there's no local
// users table, so every mutating command reads this via get_current_actor
// to stamp created_by/updated_by. Kept in sync with login/logout.

pub(crate) async fn do_set_current_actor(pool: &SqlitePool, user_id: String) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO current_actor (id, user_id) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id",
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) async fn do_clear_current_actor(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("DELETE FROM current_actor WHERE id = 1")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Internal helper -- returns None (not an error) if nobody is set, so a
// missing actor degrades to "unattributed" rather than failing the write.
//
// IMPORTANT: call this BEFORE opening a transaction, never after -- it
// acquires its own connection, which can contend with (or, on a 1-connection
// pool, silently fail against) an already-open transaction on the same pool.
// Broke rates.rs's upsert this way once; see
// upserting_again_updates_updated_by_but_never_overwrites_the_original_created_by.
pub(crate) async fn get_current_actor(pool: &SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT user_id FROM current_actor WHERE id = 1")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn set_current_actor(pool: State<'_, SqlitePool>, user_id: String) -> Result<(), String> {
    do_set_current_actor(pool.inner(), user_id).await
}

#[tauri::command]
pub async fn clear_current_actor(pool: State<'_, SqlitePool>) -> Result<(), String> {
    do_clear_current_actor(pool.inner()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;

    #[tokio::test]
    async fn set_then_get_returns_the_stored_actor() {
        let pool = setup_test_db().await;
        assert_eq!(get_current_actor(&pool).await, None);

        do_set_current_actor(&pool, "user-1".to_string()).await.unwrap();
        assert_eq!(get_current_actor(&pool).await, Some("user-1".to_string()));
    }

    #[tokio::test]
    async fn setting_again_replaces_the_previous_actor() {
        let pool = setup_test_db().await;
        do_set_current_actor(&pool, "user-1".to_string()).await.unwrap();
        do_set_current_actor(&pool, "user-2".to_string()).await.unwrap();
        assert_eq!(get_current_actor(&pool).await, Some("user-2".to_string()));
    }

    #[tokio::test]
    async fn clear_removes_the_actor() {
        let pool = setup_test_db().await;
        do_set_current_actor(&pool, "user-1".to_string()).await.unwrap();
        do_clear_current_actor(&pool).await.unwrap();
        assert_eq!(get_current_actor(&pool).await, None);
    }
}
