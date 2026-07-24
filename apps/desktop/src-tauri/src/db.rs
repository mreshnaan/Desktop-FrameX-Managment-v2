use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use tauri::{AppHandle, Manager};

pub async fn init_pool(app_handle: &AppHandle) -> Result<SqlitePool, sqlx::Error> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("resolvable app data dir");
    std::fs::create_dir_all(&data_dir).expect("create app data dir");

    let db_path = data_dir.join("cue-room.sqlite");
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))?
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

#[cfg(test)]
pub mod test_helpers {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::SqlitePool;
    use std::str::FromStr;

    // Deliberately file-backed, not `sqlite::memory:`. Verified directly
    // (not assumed): `VACUUM INTO` against an in-memory source silently
    // returns Ok() without ever writing the destination file on this
    // sqlx/libsqlite3-sys build on Windows -- a real, reproducible quirk,
    // not a guess. A file-backed test db matches what the real app always
    // uses (see init_pool above) and sidesteps that quirk for every test,
    // not just backup.rs's.
    //
    // Each call gets its own temp file so tests never share state; the
    // TempDir guard is intentionally leaked (`into_path`) rather than
    // dropped, since dropping it would delete the file out from under a
    // SqlitePool that may still hold it open on Windows. The leaked files
    // are tiny and land in the OS temp dir, which is cleaned up externally.
    pub async fn setup_test_db() -> SqlitePool {
        let dir = tempfile::tempdir().expect("create temp dir for test db").keep();
        let db_path = dir.join("test.sqlite");
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))
            .expect("valid sqlite connect options")
            .create_if_missing(true)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("connect file-backed test sqlite db");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("run migrations against test db");
        pool
    }
}
