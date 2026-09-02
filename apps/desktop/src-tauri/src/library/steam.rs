use super::{
    exe_scan::{path_string, scan_executables, ScannedExecutable, EXE_WALK_BUDGET},
    vdf,
};
use crate::launch::{LaunchError, LaunchErrorKind};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::Instant,
};

#[cfg(windows)]
use std::{os::windows::ffi::OsStrExt, ptr};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::ERROR_SUCCESS,
    System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ, REG_SZ,
    },
};

const MAX_SCANNED_APPS: usize = 5_000;
const MAX_VDF_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    provider: &'static str,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    root_path: Option<String>,
    checked_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccount {
    account_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    persona_name: Option<String>,
    most_recent: bool,
    games_with_playtime: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedGame {
    external_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    playtime_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_played_unix: Option<u64>,
    installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    install_path: Option<String>,
    executables: Vec<ScannedExecutable>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    games: Vec<ScannedGame>,
    warnings: Vec<String>,
    partial: bool,
}

#[derive(Default)]
struct LoginUser {
    persona_name: Option<String>,
    most_recent: bool,
}

#[derive(Default)]
struct LocalPlaytime {
    seconds: u64,
    last_played: Option<u64>,
}

struct Manifest {
    name: Option<String>,
    install_path: PathBuf,
}

pub fn detect() -> ProviderStatus {
    let (root, checked_paths) = find_steam_root();
    ProviderStatus {
        provider: "steam",
        available: root.is_some(),
        root_path: root.as_ref().map(|path| path_string(path)),
        checked_paths,
    }
}

pub fn accounts() -> Result<Vec<LocalAccount>, String> {
    let (root, _) = find_steam_root();
    let root = root.ok_or_else(|| "Steam installation was not found.".to_string())?;
    let login_users = read_login_users(&root).unwrap_or_default();
    let mut ids = BTreeSet::new();
    ids.extend(login_users.keys().copied());
    if let Ok(entries) = fs::read_dir(root.join("userdata")) {
        for entry in entries.flatten() {
            if let Ok(id) = entry.file_name().to_string_lossy().parse::<u32>() {
                ids.insert(id);
            }
        }
    }
    let mut accounts = ids
        .into_iter()
        .map(|account_id| {
            let games_with_playtime = read_playtimes(&root, account_id)
                .map(|games| games.len())
                .unwrap_or(0);
            let login = login_users.get(&account_id);
            LocalAccount {
                account_id,
                persona_name: login.and_then(|value| value.persona_name.clone()),
                most_recent: login.map(|value| value.most_recent).unwrap_or(false),
                games_with_playtime,
            }
        })
        .collect::<Vec<_>>();
    accounts.sort_by_key(|account| {
        (
            !account.most_recent,
            std::cmp::Reverse(account.games_with_playtime),
        )
    });
    Ok(accounts)
}

pub fn scan(account_id: u32) -> Result<ScanResult, String> {
    let (root, _) = find_steam_root();
    let root = root.ok_or_else(|| "Steam installation was not found.".to_string())?;
    let playtimes = read_playtimes(&root, account_id)?;
    let mut warnings = Vec::new();
    let manifests = read_manifests(&root, &mut warnings);
    let mut games = Vec::with_capacity(playtimes.len().min(MAX_SCANNED_APPS));
    for (app_id, playtime) in playtimes {
        let manifest = manifests.get(&app_id);
        let install_path = manifest.map(|value| value.install_path.clone());
        let installed = install_path
            .as_ref()
            .map(|path| path.is_dir())
            .unwrap_or(false);
        games.push(ScannedGame {
            external_id: app_id,
            name: manifest.and_then(|value| value.name.clone()),
            playtime_seconds: playtime.seconds,
            last_played_unix: playtime.last_played,
            installed,
            install_path: install_path.as_ref().map(|value| path_string(value)),
            executables: Vec::new(),
        });
    }
    games.sort_by_key(|game| std::cmp::Reverse(game.playtime_seconds));
    let mut partial = !warnings.is_empty();
    if games.len() > MAX_SCANNED_APPS {
        games.truncate(MAX_SCANNED_APPS);
        partial = true;
        warnings.push(format!(
            "Steam library was capped at {MAX_SCANNED_APPS} games."
        ));
    }
    let deadline = Instant::now() + EXE_WALK_BUDGET;
    for game in &mut games {
        if Instant::now() >= deadline {
            partial = true;
            warnings.push("Executable scanning reached its 45 second budget.".to_string());
            break;
        }
        let Some(install_path) = game.install_path.as_deref() else {
            continue;
        };
        if !game.installed {
            continue;
        }
        let (executables, capped) = scan_executables(Path::new(install_path), deadline);
        game.executables = executables;
        if capped
            && !warnings
                .iter()
                .any(|warning| warning.starts_with("Some executable folders"))
        {
            warnings.push(
                "Some executable folders reached their safe scan limit; found games remain usable."
                    .to_string(),
            );
        }
        partial |= capped;
    }
    Ok(ScanResult {
        games,
        partial,
        warnings,
    })
}

pub fn launch_app(external_id: &str, mode: &str) -> Result<(), LaunchError> {
    let url = steam_url(external_id, mode)?;

    #[cfg(windows)]
    {
        Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                LaunchError::new(
                    LaunchErrorKind::SpawnFailed,
                    format!("Could not open Steam: {error}"),
                )
            })?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = url;
        Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "Local Steam launching is only available on Windows.",
        ))
    }
}

fn steam_url(external_id: &str, mode: &str) -> Result<String, LaunchError> {
    if external_id.is_empty()
        || external_id.starts_with('0')
        || external_id.len() > 10
        || !external_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "Invalid Steam AppID.",
        ));
    }
    let action = match mode {
        "play" => "rungameid",
        "store" => "store",
        _ => {
            return Err(LaunchError::new(
                LaunchErrorKind::InvalidPath,
                "Invalid Steam launch mode.",
            ));
        }
    };

    Ok(format!("steam://{action}/{external_id}"))
}

fn find_steam_root() -> (Option<PathBuf>, Vec<String>) {
    let mut candidates = Vec::new();
    #[cfg(windows)]
    if let Some(path) = registry_steam_path() {
        candidates.push(path);
    }
    if let Ok(program_files) = std::env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(program_files).join("Steam"));
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("Steam"));
    }
    let mut seen = BTreeSet::new();
    candidates.retain(|path| seen.insert(path_string(path).to_ascii_lowercase()));
    let checked_paths = candidates.iter().map(|path| path_string(path)).collect();
    let root = candidates
        .into_iter()
        .find(|path| path.join("steamapps").is_dir());
    (root, checked_paths)
}

#[cfg(windows)]
fn registry_steam_path() -> Option<PathBuf> {
    let subkey = std::ffi::OsStr::new(r"Software\Valve\Steam")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let value_name = std::ffi::OsStr::new("SteamPath")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe {
        let mut key = ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut key) != ERROR_SUCCESS
        {
            return None;
        }
        let mut value_type = 0u32;
        let mut byte_count = 0u32;
        let size_status = RegQueryValueExW(
            key,
            value_name.as_ptr(),
            ptr::null_mut(),
            &mut value_type,
            ptr::null_mut(),
            &mut byte_count,
        );
        if size_status != ERROR_SUCCESS || value_type != REG_SZ || byte_count < 2 {
            RegCloseKey(key);
            return None;
        }
        let mut buffer = vec![0u16; (byte_count as usize).div_ceil(2)];
        let read_status = RegQueryValueExW(
            key,
            value_name.as_ptr(),
            ptr::null_mut(),
            &mut value_type,
            buffer.as_mut_ptr().cast::<u8>(),
            &mut byte_count,
        );
        RegCloseKey(key);
        if read_status != ERROR_SUCCESS {
            return None;
        }
        let length = buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(buffer.len());
        let value = String::from_utf16_lossy(&buffer[..length]);
        (!value.trim().is_empty()).then(|| PathBuf::from(value.trim()))
    }
}

fn read_login_users(root: &Path) -> Result<HashMap<u32, LoginUser>, String> {
    let parsed = read_vdf(root.join("config").join("loginusers.vdf"))?;
    let users = vdf::object(&parsed, "users").unwrap_or(&parsed);
    let mut result = HashMap::new();
    for (steam_id, value) in users {
        let vdf::Value::Object(user) = value else {
            continue;
        };
        let Ok(steam_id) = steam_id.parse::<u64>() else {
            continue;
        };
        result.insert(
            account_id_from_steam_id(steam_id),
            LoginUser {
                persona_name: vdf::text(user, "PersonaName").map(str::to_string),
                most_recent: vdf::text(user, "MostRecent") == Some("1"),
            },
        );
    }
    Ok(result)
}

fn account_id_from_steam_id(steam_id: u64) -> u32 {
    steam_id as u32
}

fn read_playtimes(root: &Path, account_id: u32) -> Result<BTreeMap<String, LocalPlaytime>, String> {
    let path = root
        .join("userdata")
        .join(account_id.to_string())
        .join("config")
        .join("localconfig.vdf");
    let parsed = read_vdf(path)?;
    let store = vdf::object(&parsed, "UserLocalConfigStore").unwrap_or(&parsed);
    let software =
        vdf::object(store, "Software").ok_or("Steam localconfig has no Software section.")?;
    let valve = vdf::object(software, "Valve").ok_or("Steam localconfig has no Valve section.")?;
    let steam = vdf::object(valve, "Steam").ok_or("Steam localconfig has no Steam section.")?;
    let apps = vdf::object(steam, "apps").ok_or("Steam localconfig has no apps section.")?;
    let mut result = BTreeMap::new();
    for (app_id, value) in apps {
        if !app_id.chars().all(|character| character.is_ascii_digit()) {
            continue;
        }
        let vdf::Value::Object(app) = value else {
            continue;
        };
        let connected = parse_u64(vdf::text(app, "Playtime"));
        let disconnected = parse_u64(vdf::text(app, "PlaytimeDisconnected"));
        let last_played = parse_u64(vdf::text(app, "LastPlayed"));
        if connected == 0 && disconnected == 0 && last_played == 0 {
            continue;
        }
        result.insert(
            app_id.clone(),
            LocalPlaytime {
                seconds: connected.saturating_add(disconnected).saturating_mul(60),
                last_played: (last_played > 0).then_some(last_played),
            },
        );
    }
    Ok(result)
}

fn read_manifests(root: &Path, warnings: &mut Vec<String>) -> HashMap<String, Manifest> {
    let libraries = read_library_paths(root).unwrap_or_else(|error| {
        warnings.push(error);
        vec![root.to_path_buf()]
    });
    let mut result = HashMap::new();
    for library in libraries {
        let steamapps = library.join("steamapps");
        let Ok(entries) = fs::read_dir(&steamapps) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let Some(app_id) = file_name
                .strip_prefix("appmanifest_")
                .and_then(|value| value.strip_suffix(".acf"))
            else {
                continue;
            };
            let Ok(parsed) = read_vdf(entry.path()) else {
                warnings.push(format!("Could not read {file_name}."));
                continue;
            };
            let state = vdf::object(&parsed, "AppState").unwrap_or(&parsed);
            let Some(install_dir) = vdf::text(state, "installdir") else {
                continue;
            };
            let relative = Path::new(install_dir);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
            {
                warnings.push(format!("Ignored unsafe install path in {file_name}."));
                continue;
            }
            result.insert(
                app_id.to_string(),
                Manifest {
                    name: vdf::text(state, "name").map(str::to_string),
                    install_path: steamapps.join("common").join(install_dir),
                },
            );
        }
    }
    result
}

fn read_library_paths(root: &Path) -> Result<Vec<PathBuf>, String> {
    let path = root.join("steamapps").join("libraryfolders.vdf");
    let parsed = read_vdf(path)?;
    let folders = vdf::object(&parsed, "libraryfolders").unwrap_or(&parsed);
    let mut result = vec![root.to_path_buf()];
    for value in folders.values() {
        let path = match value {
            vdf::Value::Text(value) => Some(value.as_str()),
            vdf::Value::Object(folder) => vdf::text(folder, "path"),
        };
        if let Some(path) = path {
            result.push(PathBuf::from(path));
        }
    }
    result.sort();
    result.dedup();
    Ok(result)
}

fn read_vdf(path: PathBuf) -> Result<BTreeMap<String, vdf::Value>, String> {
    let size = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {error}", path_string(&path)))?
        .len();
    if size > MAX_VDF_BYTES {
        return Err(format!(
            "{} is too large to read safely.",
            path_string(&path)
        ));
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path_string(&path)))?;
    vdf::parse(contents.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Could not parse {}: {error}", path_string(&path)))
}

fn parse_u64(value: Option<&str>) -> u64 {
    value.and_then(|value| value.parse().ok()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_steam_protocol_inputs_without_launching() {
        assert_eq!(steam_url("730", "play").unwrap(), "steam://rungameid/730");
        assert_eq!(steam_url("730", "store").unwrap(), "steam://store/730");
        for invalid in ["", "0", "012", "12a", "1 && calc", "../../x"] {
            assert!(steam_url(invalid, "play").is_err(), "accepted {invalid}");
        }
        assert!(steam_url("730", "other").is_err());
    }

    #[test]
    fn derives_the_local_account_id_from_steam_id64() {
        assert_eq!(account_id_from_steam_id(76_561_198_000_000_000), 39_734_272);
    }
}
