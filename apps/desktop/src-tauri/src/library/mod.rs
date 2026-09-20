pub mod battlenet;
pub mod battlenet_account;
mod exe_scan;
pub mod steam;
mod types;
mod vdf;
pub mod xbox;

use crate::launch::{LaunchError, LaunchErrorKind};

#[tauri::command]
pub async fn library_detect_providers() -> Result<Vec<types::ProviderStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| vec![steam::detect(), battlenet::detect()])
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_list_accounts(provider: String) -> Result<Vec<types::LocalAccount>, String> {
    if provider != "steam" {
        return Err("PlayCounter cannot import from this launcher.".to_string());
    }
    tauri::async_runtime::spawn_blocking(steam::accounts)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_scan(provider: String, account_id: u32) -> Result<types::ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || match provider.as_str() {
        "steam" => steam::scan(account_id),
        "battlenet" => battlenet::scan(),
        _ => Err("PlayCounter cannot import from this launcher.".to_string()),
    })
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
        let candidate = exe_scan::executable_from_path(&install_path, &executable_path)?;
        if provider == "battlenet" && !battlenet::game_executable(&candidate.file_name) {
            return Err(
                "Pick the game's executable, rather than a Battle.net launcher or helper."
                    .to_string(),
            );
        }
        Ok(candidate)
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
        "battlenet" => battlenet::launch_app(&external_id, &mode),
        _ => Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "PlayCounter cannot import from this launcher.",
        )),
    })
    .await
    .map_err(|error| LaunchError::new(LaunchErrorKind::SpawnFailed, error.to_string()))?
}

fn require_local_provider(provider: &str) -> Result<(), String> {
    if matches!(provider, "steam" | "xbox" | "battlenet") {
        Ok(())
    } else {
        Err("PlayCounter cannot import from this launcher.".to_string())
    }
}
