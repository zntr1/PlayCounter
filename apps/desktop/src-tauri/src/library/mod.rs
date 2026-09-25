pub mod battlenet;
pub mod battlenet_account;
mod exe_scan;
pub mod steam;
mod types;
mod vdf;
pub mod xbox;

use crate::launch::{
    is_absolute_windows_path, is_missing_at, volume_is_present, LaunchError, LaunchErrorKind,
    LaunchPathStatus,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

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

/// Rechecks a stored Steam or Xbox install when a saved game file vanished, so
/// a game that was uninstalled outside PlayCounter loses its Play action.
#[tauri::command]
pub async fn library_install_exists(provider: String, external_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || match provider.as_str() {
        "steam" => Ok(steam::install_state(&external_id) != Some(false)),
        "xbox" => Ok(xbox::is_installed(&external_id)),
        _ => Err("PlayCounter cannot check installs for this launcher.".to_string()),
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCheckRequest {
    provider: String,
    external_id: String,
    install_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCheckReport {
    provider: String,
    external_id: String,
    status: LaunchPathStatus,
}

/// Checks stored launcher installs in the background. `missing` means the
/// launcher no longer has the game; `unreadable` means PlayCounter cannot tell,
/// for example because the drive holding the game is not connected.
#[tauri::command]
pub async fn library_verify_installs(
    installs: Vec<InstallCheckRequest>,
) -> Vec<InstallCheckReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let steam = installs
            .iter()
            .any(|install| install.provider == "steam")
            .then(steam::Installs::read)
            .flatten();
        installs
            .into_iter()
            .map(|install| {
                let status = install_status(&install, steam.as_ref());
                InstallCheckReport {
                    provider: install.provider,
                    external_id: install.external_id,
                    status,
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn install_status(
    install: &InstallCheckRequest,
    steam: Option<&steam::Installs>,
) -> LaunchPathStatus {
    if !cfg!(windows) {
        return LaunchPathStatus::Unreadable;
    }
    if !is_absolute_windows_path(&install.install_path) {
        return LaunchPathStatus::Invalid;
    }
    let path = Path::new(&install.install_path);
    if !volume_is_present(path) {
        return LaunchPathStatus::Unreadable;
    }
    let installed = match install.provider.as_str() {
        "steam" => steam.and_then(|installs| installs.state(&install.external_id)),
        "xbox" => Some(xbox::is_installed(&install.external_id)),
        "battlenet" => match fs::metadata(path) {
            Ok(metadata) => Some(metadata.is_dir()),
            Err(error) if is_missing_at(path, &error) => Some(false),
            Err(_) => None,
        },
        _ => return LaunchPathStatus::Invalid,
    };
    match installed {
        Some(true) => LaunchPathStatus::Ok,
        Some(false) => LaunchPathStatus::Missing,
        None => LaunchPathStatus::Unreadable,
    }
}

fn require_local_provider(provider: &str) -> Result<(), String> {
    if matches!(provider, "steam" | "xbox" | "battlenet") {
        Ok(())
    } else {
        Err("PlayCounter cannot import from this launcher.".to_string())
    }
}
