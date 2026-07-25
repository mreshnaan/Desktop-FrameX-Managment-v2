use sqlx::SqlitePool;
use tauri::State;

// Every create/update command stamps created_by/updated_by from whoever is
// currently logged in on this device. There's no local `users` table (see
// migrations/0003_audit_trail.sql), so this is the one source of truth for
// "who is acting right now" -- a single-row table AuthContext keeps in sync
// with login/logout, read by every mutating command via get_current_actor.

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

// Not a #[tauri::command] -- an internal helper every mutating command
// calls to stamp created_by/updated_by. Returns None if nobody is
// currently set (shouldn't happen in practice since every mutating screen
// requires login first, but a missing actor should degrade to "unattributed"
// rather than fail the write).
//
// IMPORTANT: always call this BEFORE opening a transaction (pool.begin()),
// never after. It acquires its own connection from `pool`; calling it while
// a transaction on that same pool is already open makes it contend with (or,
// on a pool sized down to one connection -- as the sqlite test pool is --
// silently fail against) the connection the transaction is holding, and the
// failure is swallowed into a plain None rather than surfaced. This is not
// hypothetical: it broke rates.rs's upsert this way, caught by
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
