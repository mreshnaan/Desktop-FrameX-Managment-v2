use chrono::Utc;
use serde::Serialize;
use sqlx::SqlitePool;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const KEEP_BACKUPS: usize = 30;

fn backup_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn quote_sqlite_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub filename: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
}

fn prune_old_backups(dir: &Path) -> std::io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "sqlite"))
        .filter(|e| !e.file_name().to_string_lossy().starts_with("pre-restore-"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    while entries.len() > KEEP_BACKUPS {
        let oldest = entries.remove(0);
        fs::remove_file(oldest.path())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn backup_now(app_handle: AppHandle, pool: State<'_, SqlitePool>) -> Result<BackupInfo, String> {
    let dir = backup_dir(&app_handle)?;
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!("cue-room-backup-{timestamp}.sqlite");
    let path = dir.join(&filename);

    sqlx::query(&format!("VACUUM INTO '{}'", quote_sqlite_path(&path)))
        .execute(pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    prune_old_backups(&dir).map_err(|e| e.to_string())?;

    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(BackupInfo {
        filename,
        created_at: Utc::now().to_rfc3339(),
        size_bytes: metadata.len(),
    })
}

#[tauri::command]
pub fn list_backups(app_handle: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let dir = backup_dir(&app_handle)?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "sqlite") {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let created_at = metadata
                .created()
                .ok()
                .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                .unwrap_or_default();
            backups.push(BackupInfo {
                filename: entry.file_name().to_string_lossy().to_string(),
                created_at,
                size_bytes: metadata.len(),
            });
        }
    }
    backups.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(backups)
}

// Path-traversal-safe: resolves the requested filename strictly within the
// backup directory, rejecting anything that escapes it (e.g. "../../etc").
fn resolve_backup_path(app_handle: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let dir = backup_dir(app_handle)?;
    let candidate = dir.join(filename);
    let canonical_dir = fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    let canonical_candidate =
        fs::canonicalize(&candidate).map_err(|_| "Backup file not found".to_string())?;
    if !canonical_candidate.starts_with(&canonical_dir) {
        return Err("Invalid backup filename".to_string());
    }
    Ok(canonical_candidate)
}

#[tauri::command]
pub async fn restore_backup(
    app_handle: AppHandle,
    pool: State<'_, SqlitePool>,
    filename: String,
) -> Result<(), String> {
    let backup_path = resolve_backup_path(&app_handle, &filename)?;

    // Integrity check before touching the live database.
    let backup_pool = SqlitePool::connect(&format!("sqlite://{}", backup_path.display()))
        .await
        .map_err(|e| e.to_string())?;
    let (check,): (String,) = sqlx::query_as("PRAGMA quick_check")
        .fetch_one(&backup_pool)
        .await
        .map_err(|e| e.to_string())?;
    backup_pool.close().await;
    if check != "ok" {
        return Err(format!("Backup failed integrity check: {check}"));
    }

    // Safety snapshot of the current (pre-restore) database, so a bad
    // restore is itself recoverable.
    let dir = backup_dir(&app_handle)?;
    let safety_path = dir.join(format!("pre-restore-{}.sqlite", Utc::now().format("%Y%m%d-%H%M%S")));
    sqlx::query(&format!("VACUUM INTO '{}'", quote_sqlite_path(&safety_path)))
        .execute(pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    let db_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cue-room.sqlite");

    // Closes this connection pool -- the swapped-in file only takes effect
    // after the app restarts (the frontend must tell the user to restart).
    pool.close().await;
    fs::copy(&backup_path, &db_path).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_backup_dir(app_handle: AppHandle) -> Result<String, String> {
    Ok(backup_dir(&app_handle)?.display().to_string())
}
