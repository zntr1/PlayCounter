use std::{fs, sync::OnceLock};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static INSTALL_UUID: OnceLock<String> = OnceLock::new();

pub fn install_uuid(app: AppHandle, existing: Option<String>) -> Result<String, String> {
    if let Some(value) = INSTALL_UUID.get() {
        return Ok(value.clone());
    }

    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let path = app_data_dir.join("install-uuid.txt");
    let from_file = fs::read_to_string(&path)
        .ok()
        .and_then(|value| normalize_uuid(&value));
    if let Some(value) = from_file {
        let _ = INSTALL_UUID.set(value.clone());
        return Ok(value);
    }

    let value = existing
        .as_deref()
        .and_then(normalize_uuid)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    fs::write(path, &value).map_err(|error| error.to_string())?;
    let _ = INSTALL_UUID.set(value.clone());
    Ok(value)
}

fn normalize_uuid(value: &str) -> Option<String> {
    Uuid::parse_str(value.trim()).ok().map(|uuid| uuid.to_string())
}
