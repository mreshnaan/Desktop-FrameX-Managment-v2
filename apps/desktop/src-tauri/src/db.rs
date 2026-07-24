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
