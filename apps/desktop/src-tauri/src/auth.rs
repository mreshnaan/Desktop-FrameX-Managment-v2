use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "cue-room-desktop";
const ACCESS_KEY: &str = "access_token";
const REFRESH_KEY: &str = "refresh_token";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
}

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

// Tokens are stored via the OS keychain (Credential Manager on Windows,
// Keychain on macOS, Secret Service on Linux), never in any JS-accessible
// storage -- see the desktop design spec's Auth section.
#[tauri::command]
pub fn store_auth_tokens(access_token: String, refresh_token: String) -> Result<(), String> {
    entry(ACCESS_KEY)?
        .set_password(&access_token)
        .map_err(|e| e.to_string())?;
    entry(REFRESH_KEY)?
        .set_password(&refresh_token)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_auth_tokens() -> Result<Option<AuthTokens>, String> {
    let access_token = match entry(ACCESS_KEY)?.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let refresh_token = match entry(REFRESH_KEY)?.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    Ok(Some(AuthTokens {
        access_token,
        refresh_token,
    }))
}

#[tauri::command]
pub fn clear_auth_tokens() -> Result<(), String> {
    for key in [ACCESS_KEY, REFRESH_KEY] {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}
