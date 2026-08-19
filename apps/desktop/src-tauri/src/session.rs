use std::{
    fs,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static INSTALL_UUID: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn install_uuid_cache() -> &'static Mutex<Option<String>> {
    INSTALL_UUID.get_or_init(|| Mutex::new(None))
}

pub fn install_uuid(app: AppHandle, existing: Option<String>) -> Result<String, String> {
    let mut cached = install_uuid_cache()
        .lock()
        .map_err(|_| "Install UUID cache is unavailable.".to_string())?;
    if let Some(value) = cached.as_ref() {
        return Ok(value.clone());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let path = app_data_dir.join("install-uuid.txt");
    let from_file = fs::read_to_string(&path)
        .ok()
        .and_then(|value| normalize_uuid(&value));
    if let Some(value) = from_file {
        *cached = Some(value.clone());
        return Ok(value);
    }

    let value = existing
        .as_deref()
        .and_then(normalize_uuid)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    fs::write(path, &value).map_err(|error| error.to_string())?;
    *cached = Some(value.clone());
    Ok(value)
}

pub fn adopt_install_uuid(app: AppHandle, value: String) -> Result<String, String> {
    let value = normalize_uuid(&value).ok_or_else(|| "Invalid install UUID.".to_string())?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let path = app_data_dir.join("install-uuid.txt");
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    fs::write(path, &value).map_err(|error| error.to_string())?;

    let mut cached = install_uuid_cache()
        .lock()
        .map_err(|_| "Install UUID cache is unavailable.".to_string())?;
    *cached = Some(value.clone());
    Ok(value)
}

fn normalize_uuid(value: &str) -> Option<String> {
    Uuid::parse_str(value.trim())
        .ok()
        .map(|uuid| uuid.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_uuid;

    #[test]
    fn imported_install_uuid_is_validated_and_normalized() {
        assert_eq!(
            normalize_uuid(" 550E8400-E29B-41D4-A716-446655440000 "),
            Some("550e8400-e29b-41d4-a716-446655440000".to_string())
        );
        assert_eq!(normalize_uuid("not-a-uuid"), None);
    }
}
