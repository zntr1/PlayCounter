mod exe_scan;
pub mod steam;
mod vdf;
pub mod xbox;

use crate::launch::{LaunchError, LaunchErrorKind};

#[tauri::command]
pub async fn library_detect_providers() -> Result<Vec<steam::ProviderStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| vec![steam::detect()])
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_list_accounts(provider: String) -> Result<Vec<steam::LocalAccount>, String> {
    if provider != "steam" {
        return Err("This game library provider is not supported.".to_string());
    }
    tauri::async_runtime::spawn_blocking(steam::accounts)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_scan(provider: String, account_id: u32) -> Result<steam::ScanResult, String> {
    if provider != "steam" {
        return Err("This game library provider is not supported.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || steam::scan(account_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_inspect_executable(
    provider: String,
    install_path: String,
    executable_path: String,
) -> Result<exe_scan::ScannedExecutable, String> {
    require_local_provider(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        exe_scan::executable_from_path(&install_path, &executable_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_scan_xbox_local() -> Result<xbox::XboxLocalScan, String> {
    tauri::async_runtime::spawn_blocking(xbox::scan_local_games)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_launch_app(
    provider: String,
    external_id: String,
    mode: String,
) -> Result<(), LaunchError> {
    tauri::async_runtime::spawn_blocking(move || match provider.as_str() {
        "steam" => steam::launch_app(&external_id, &mode),
        "xbox" => xbox::launch_app(&external_id, &mode),
        _ => Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "This game library provider is not supported.",
        )),
    })
    .await
    .map_err(|error| LaunchError::new(LaunchErrorKind::SpawnFailed, error.to_string()))?
}

fn require_local_provider(provider: &str) -> Result<(), String> {
    if provider == "steam" || provider == "xbox" {
        Ok(())
    } else {
        Err("This game library provider is not supported.".to_string())
    }
}
