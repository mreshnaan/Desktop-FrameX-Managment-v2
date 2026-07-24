use chrono::Utc;
use serde::Serialize;
use sqlx::SqlitePool;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const KEEP_BACKUPS: usize = 30;

// Every function below takes a plain `&Path`/`&SqlitePool` instead of
// deriving the backup directory from Tauri's `AppHandle` internally -- that
// split is what makes this module testable with `tempfile::tempdir()`
// (AppHandle isn't constructible outside a running app). The
// `#[tauri::command]` wrappers resolve the real paths and delegate.

fn app_backup_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    ensure_dir(&dir)?;
    Ok(dir)
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())
}

fn quote_sqlite_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct BackupInfo {
    pub filename: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
}

fn do_prune_old_backups(dir: &Path) -> std::io::Result<()> {
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

pub(crate) async fn do_backup_now(pool: &SqlitePool, dir: &Path) -> Result<BackupInfo, String> {
    ensure_dir(dir)?;
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S%.f").to_string();
    let filename = format!("cue-room-backup-{timestamp}.sqlite");
    let path = dir.join(&filename);

    sqlx::query(&format!("VACUUM INTO '{}'", quote_sqlite_path(&path)))
        .execute(pool)
        .await
        .map_err(|e| format!("VACUUM INTO failed: {e}"))?;

    do_prune_old_backups(dir).map_err(|e| format!("prune failed: {e}"))?;

    let metadata = fs::metadata(&path).map_err(|e| format!("metadata failed for {}: {e}", path.display()))?;
    Ok(BackupInfo {
        filename,
        created_at: Utc::now().to_rfc3339(),
        size_bytes: metadata.len(),
    })
}

#[tauri::command]
pub async fn backup_now(app_handle: AppHandle, pool: State<'_, SqlitePool>) -> Result<BackupInfo, String> {
    let dir = app_backup_dir(&app_handle)?;
    do_backup_now(pool.inner(), &dir).await
}

pub(crate) fn do_list_backups(dir: &Path) -> Result<Vec<BackupInfo>, String> {
    ensure_dir(dir)?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
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

#[tauri::command]
pub fn list_backups(app_handle: AppHandle) -> Result<Vec<BackupInfo>, String> {
    do_list_backups(&app_backup_dir(&app_handle)?)
}

// Path-traversal-safe: resolves the requested filename strictly within the
// backup directory, rejecting anything that escapes it (e.g. "../../etc").
fn resolve_backup_path(dir: &Path, filename: &str) -> Result<PathBuf, String> {
    let candidate = dir.join(filename);
    let canonical_dir = fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let canonical_candidate =
        fs::canonicalize(&candidate).map_err(|_| "Backup file not found".to_string())?;
    if !canonical_candidate.starts_with(&canonical_dir) {
        return Err("Invalid backup filename".to_string());
    }
    Ok(canonical_candidate)
}

pub(crate) async fn do_restore_backup(
    pool: SqlitePool,
    dir: &Path,
    db_path: &Path,
    filename: &str,
) -> Result<(), String> {
    let backup_path = resolve_backup_path(dir, filename)?;

    // Integrity check before touching the live database. Built via
    // SqliteConnectOptions::filename() rather than a hand-formatted
    // "sqlite://{path}" string -- resolve_backup_path canonicalizes its
    // result, and on Windows a canonicalized path carries the `\\?\`
    // extended-length prefix, which a naive URL string breaks on (the
    // leading backslashes get parsed as query syntax). The options builder
    // takes a Path directly and sidesteps that entirely.
    let backup_pool = SqlitePool::connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&backup_path))
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
    let safety_path = dir.join(format!("pre-restore-{}.sqlite", Utc::now().format("%Y%m%d-%H%M%S%.f")));
    sqlx::query(&format!("VACUUM INTO '{}'", quote_sqlite_path(&safety_path)))
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    // Closes this connection pool -- the swapped-in file only takes effect
    // after the app restarts (the frontend must tell the user to restart).
    pool.close().await;
    fs::copy(&backup_path, db_path).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn restore_backup(
    app_handle: AppHandle,
    pool: State<'_, SqlitePool>,
    filename: String,
) -> Result<(), String> {
    let dir = app_backup_dir(&app_handle)?;
    let db_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cue-room.sqlite");
    // pool.inner().clone() -- State can't be moved out, but SqlitePool
    // itself is a cheap Arc-backed handle, so cloning it is the intended way
    // to hand ownership to a function that needs to close it.
    do_restore_backup(pool.inner().clone(), &dir, &db_path, &filename).await
}

#[tauri::command]
pub fn get_backup_dir(app_handle: AppHandle) -> Result<String, String> {
    Ok(app_backup_dir(&app_handle)?.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::setup_test_db;
    use tempfile::tempdir;

    #[tokio::test]
    async fn backup_now_creates_a_restorable_sqlite_file() {
        let pool = setup_test_db().await;
        let dir = tempdir().unwrap();

        let info = do_backup_now(&pool, dir.path()).await.unwrap();

        let path = dir.path().join(&info.filename);
        assert!(path.exists());
        assert!(info.size_bytes > 0);
    }

    #[tokio::test]
    async fn list_backups_returns_only_sqlite_files_newest_first() {
        let pool = setup_test_db().await;
        let dir = tempdir().unwrap();
        let first = do_backup_now(&pool, dir.path()).await.unwrap();
        // Filenames are timestamp-sorted with sub-second precision, so a
        // second real backup a moment later is guaranteed to sort after it.
        let second = do_backup_now(&pool, dir.path()).await.unwrap();
        std::fs::write(dir.path().join("not-a-backup.txt"), "ignore me").unwrap();

        let backups = do_list_backups(dir.path()).unwrap();

        assert_eq!(backups.len(), 2);
        assert_eq!(backups[0].filename, second.filename, "newest backup must be listed first");
        assert!(backups.iter().any(|b| b.filename == first.filename));
    }

    #[tokio::test]
    async fn prune_keeps_only_the_newest_30_backups() {
        let pool = setup_test_db().await;
        let dir = tempdir().unwrap();
        for _ in 0..35 {
            do_backup_now(&pool, dir.path()).await.unwrap();
        }

        let backups = do_list_backups(dir.path()).unwrap();

        assert_eq!(backups.len(), KEEP_BACKUPS);
    }

    #[tokio::test]
    async fn prune_ignores_pre_restore_safety_snapshots() {
        let pool = setup_test_db().await;
        let dir = tempdir().unwrap();
        // A pre-restore snapshot must survive pruning even past the normal
        // backup retention count, since it exists specifically to undo a
        // recent restore.
        std::fs::write(dir.path().join("pre-restore-19990101-000000.sqlite"), "fake").unwrap();
        for _ in 0..35 {
            do_backup_now(&pool, dir.path()).await.unwrap();
        }

        let backups = do_list_backups(dir.path()).unwrap();

        assert!(backups.iter().any(|b| b.filename == "pre-restore-19990101-000000.sqlite"));
    }

    async fn connect_creating(db_path: &Path) -> SqlitePool {
        use sqlx::sqlite::SqliteConnectOptions;
        use std::str::FromStr;
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))
            .unwrap()
            .create_if_missing(true);
        SqlitePool::connect_with(options).await.unwrap()
    }

    #[tokio::test]
    async fn restore_replaces_the_live_db_file_with_the_backup_contents() {
        let live_dir = tempdir().unwrap();
        let db_path = live_dir.path().join("cue-room.sqlite");
        let live_pool = connect_creating(&db_path).await;
        sqlx::migrate!("./migrations").run(&live_pool).await.unwrap();
        crate::commands::customers::do_create_customer(&live_pool, "Live Customer".to_string(), "".to_string()).await.unwrap();

        let backup_dir = tempdir().unwrap();
        let backup_pool = setup_test_db().await;
        crate::commands::customers::do_create_customer(&backup_pool, "Backup Customer".to_string(), "".to_string()).await.unwrap();
        let info = do_backup_now(&backup_pool, backup_dir.path()).await.unwrap();

        do_restore_backup(live_pool, backup_dir.path(), &db_path, &info.filename).await.unwrap();

        let restored_pool = SqlitePool::connect(&format!("sqlite://{}", db_path.display())).await.unwrap();
        let customers = crate::commands::customers::do_list_customers(&restored_pool).await.unwrap();
        assert_eq!(customers.len(), 1);
        assert_eq!(customers[0].name, "Backup Customer", "the live db must now contain the backup's data, not its own");
    }

    #[tokio::test]
    async fn restore_rejects_a_path_traversal_filename() {
        let pool = setup_test_db().await;
        let dir = tempdir().unwrap();
        do_backup_now(&pool, dir.path()).await.unwrap();

        let result = resolve_backup_path(dir.path(), "../../../../etc/passwd");

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn restore_rejects_a_backup_that_fails_integrity_check() {
        let live_dir = tempdir().unwrap();
        let db_path = live_dir.path().join("cue-room.sqlite");
        let live_pool = connect_creating(&db_path).await;
        sqlx::migrate!("./migrations").run(&live_pool).await.unwrap();

        let backup_dir = tempdir().unwrap();
        let fake_backup_path = backup_dir.path().join("corrupt.sqlite");
        std::fs::write(&fake_backup_path, b"not a real sqlite file").unwrap();

        let result = do_restore_backup(live_pool, backup_dir.path(), &db_path, "corrupt.sqlite").await;

        assert!(result.is_err());
    }
}
