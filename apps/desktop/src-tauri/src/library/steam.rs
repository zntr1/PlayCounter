use super::types::{LocalAccount, ProviderStatus, ScanResult, ScannedGame};
use super::{
    exe_scan::{path_string, scan_executables, EXE_WALK_BUDGET},
    vdf,
};
use crate::launch::{volume_is_present, LaunchError, LaunchErrorKind};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Component, Path, PathBuf},
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
/// Steamworks Common Redistributables: installed with most games, never a game.
const REDISTRIBUTABLES_APP_ID: &str = "228980";
const MAX_VDF_BYTES: u64 = 8 * 1024 * 1024;

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
    /// Steam's StateFlags "fully installed" bit. It stays set while an update is
    /// pending, so an outdated game still counts; a partial download does not.
    fully_installed: bool,
}

/// Steam's AppState StateFlags bit for a completely installed app.
const STATE_FULLY_INSTALLED: u64 = 4;

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

/// Scans the account's played games plus every completely installed game.
/// `only_app_ids` limits the result (and the slow executable walk) to those
/// apps, for picking up newly installed games in the background.
pub fn scan(account_id: u32, only_app_ids: Option<&[String]>) -> Result<ScanResult, String> {
    let (root, _) = find_steam_root();
    let root = root.ok_or_else(|| "Steam installation was not found.".to_string())?;
    scan_root(&root, account_id, only_app_ids)
}

fn scan_root(
    root: &Path,
    account_id: u32,
    only_app_ids: Option<&[String]>,
) -> Result<ScanResult, String> {
    let mut playtimes = read_playtimes(root, account_id)?;
    let mut warnings = Vec::new();
    let manifests = read_manifests(root, &mut warnings);
    let never_played = manifests
        .iter()
        .filter(|(app_id, manifest)| {
            !playtimes.contains_key(*app_id)
                && app_id.as_str() != REDISTRIBUTABLES_APP_ID
                && manifest_installed(manifest)
        })
        .map(|(app_id, _)| app_id.clone())
        .collect::<Vec<_>>();
    if let Some(only) = only_app_ids {
        playtimes.retain(|app_id, _| only.contains(app_id));
    }
    let mut games = Vec::with_capacity(playtimes.len().min(MAX_SCANNED_APPS));
    for app_id in never_played {
        if only_app_ids.is_some_and(|only| !only.contains(&app_id)) {
            continue;
        }
        let manifest = &manifests[&app_id];
        games.push(ScannedGame {
            name: manifest.name.clone(),
            // Steam knows this installed game has no playtime yet.
            playtime_seconds: Some(0),
            has_played_evidence: Some(false),
            last_played_unix: None,
            installed: true,
            install_path: Some(path_string(&manifest.install_path)),
            executables: Vec::new(),
            external_id: app_id,
        });
    }
    for (app_id, playtime) in playtimes {
        let manifest = manifests.get(&app_id);
        let install_path = manifest.map(|value| value.install_path.clone());
        let installed = manifest.is_some_and(manifest_installed);
        games.push(ScannedGame {
            external_id: app_id,
            name: manifest.and_then(|value| value.name.clone()),
            playtime_seconds: Some(playtime.seconds),
            has_played_evidence: None,
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

/// Steam's local install records, read once so many games can be checked.
pub struct Installs {
    manifests: HashMap<String, Manifest>,
    /// False while a Steam library sits on a drive that is not connected; its
    /// games can then be neither confirmed nor ruled out.
    all_libraries_reachable: bool,
}

impl Installs {
    /// `None` when Steam itself is not found on this PC.
    pub fn read() -> Option<Self> {
        let (root, _) = find_steam_root();
        root.map(|root| Self::read_from(&root))
    }

    fn read_from(root: &Path) -> Self {
        let (manifests, all_libraries_reachable) = read_manifest_index(root, &mut Vec::new());
        Self {
            manifests,
            all_libraries_reachable,
        }
    }

    /// `Some(true)` when the app is completely installed, `Some(false)` when it
    /// is not, and `None` when an offline library might still hold it.
    pub fn state(&self, app_id: &str) -> Option<bool> {
        match self.manifests.get(app_id) {
            Some(manifest) => Some(manifest_installed(manifest)),
            None => self.all_libraries_reachable.then_some(false),
        }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub app_id: String,
    pub install_path: String,
}

impl Installs {
    pub fn installed_apps(&self) -> Vec<InstalledApp> {
        let mut apps = self
            .manifests
            .iter()
            .filter(|(app_id, manifest)| {
                app_id.as_str() != REDISTRIBUTABLES_APP_ID && manifest_installed(manifest)
            })
            .map(|(app_id, manifest)| InstalledApp {
                app_id: app_id.clone(),
                install_path: path_string(&manifest.install_path),
            })
            .collect::<Vec<_>>();
        apps.sort_by(|left, right| left.app_id.cmp(&right.app_id));
        apps
    }
}

/// Whether Steam still has this app installed; `None` when it cannot tell.
pub fn install_state(external_id: &str) -> Option<bool> {
    Installs::read().and_then(|installs| installs.state(external_id))
}

fn manifest_installed(manifest: &Manifest) -> bool {
    manifest.fully_installed && manifest.install_path.is_dir()
}

pub fn launch_app(external_id: &str, mode: &str) -> Result<(), LaunchError> {
    let url = steam_url(external_id, mode)?;

    #[cfg(windows)]
    {
        // steam://rungameid never fails: for a missing game Steam just offers to
        // install it. Check first so a stale import reports "not installed".
        if mode == "play" && install_state(external_id) == Some(false) {
            return Err(LaunchError::new(
                LaunchErrorKind::NotFound,
                "Steam no longer has this game installed.",
            ));
        }
        crate::shell_open::open_url(&url).map_err(|error| {
            LaunchError::new(
                LaunchErrorKind::SpawnFailed,
                format!("Could not open Steam: {error}"),
            )
        })
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
        "install" => "install",
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
    read_manifest_index(root, warnings).0
}

/// Also reports whether every Steam library was reachable. A library whose
/// drive is present but whose folder is gone no longer holds any games.
fn read_manifest_index(
    root: &Path,
    warnings: &mut Vec<String>,
) -> (HashMap<String, Manifest>, bool) {
    let libraries = read_library_paths(root).unwrap_or_else(|error| {
        warnings.push(error);
        vec![root.to_path_buf()]
    });
    let mut result = HashMap::new();
    let mut all_libraries_reachable = true;
    for library in libraries {
        let steamapps = library.join("steamapps");
        let Ok(entries) = fs::read_dir(&steamapps) else {
            all_libraries_reachable &= volume_is_present(&library);
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
                    // A manifest without StateFlags proves nothing either way.
                    fully_installed: vdf::text(state, "StateFlags")
                        .is_none_or(|flags| parse_u64(Some(flags)) & STATE_FULLY_INSTALLED != 0),
                },
            );
        }
    }
    (result, all_libraries_reachable)
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
        assert_eq!(steam_url("730", "install").unwrap(), "steam://install/730");
        for invalid in ["", "0", "012", "12a", "1 && calc", "../../x"] {
            assert!(steam_url(invalid, "play").is_err(), "accepted {invalid}");
        }
        assert!(steam_url("730", "other").is_err());
    }

    fn steam_root_with_manifest(app_id: &str, state_flags: &str, create_folder: bool) -> PathBuf {
        steam_root_with_libraries(app_id, state_flags, create_folder, &[])
    }

    fn steam_root_with_libraries(
        app_id: &str,
        state_flags: &str,
        create_folder: bool,
        extra_libraries: &[&Path],
    ) -> PathBuf {
        let root = std::env::temp_dir().join(format!("playcounter-steam-{}", uuid::Uuid::new_v4()));
        let steamapps = root.join("steamapps");
        fs::create_dir_all(&steamapps).unwrap();
        let folders = extra_libraries
            .iter()
            .enumerate()
            .map(|(index, path)| {
                let path = path_string(path).replace('\\', "\\\\");
                format!("\t\"{index}\"\n\t{{\n\t\t\"path\"\t\t\"{path}\"\n\t}}\n")
            })
            .collect::<String>();
        fs::write(
            steamapps.join("libraryfolders.vdf"),
            format!("\"libraryfolders\"\n{{\n{folders}}}\n"),
        )
        .unwrap();
        fs::write(
            steamapps.join(format!("appmanifest_{app_id}.acf")),
            format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"name\"\t\t\"Test Game\"\n\t\"StateFlags\"\t\t\"{state_flags}\"\n\t\"installdir\"\t\t\"Test Game\"\n}}\n"
            ),
        )
        .unwrap();
        if create_folder {
            fs::create_dir_all(steamapps.join("common").join("Test Game")).unwrap();
        }
        root
    }

    #[test]
    fn counts_only_complete_steam_installs_as_installed() {
        for (flags, folder, expected) in [
            ("4", true, true),     // fully installed
            ("6", true, true),     // update pending, still playable through Steam
            ("1026", true, false), // partial download: installed bit not set
            ("4", false, false),   // folder deleted
        ] {
            let root = steam_root_with_manifest("730", flags, folder);
            let installs = Installs::read_from(&root);
            assert_eq!(
                installs.state("730"),
                Some(expected),
                "StateFlags {flags}, folder {folder}"
            );
            assert_eq!(
                installs.state("440"),
                Some(false),
                "unknown app counted as installed"
            );
            let _ = fs::remove_dir_all(root);
        }
    }

    fn add_manifest(root: &Path, app_id: &str, name: &str, installdir: &str) {
        let steamapps = root.join("steamapps");
        fs::write(
            steamapps.join(format!("appmanifest_{app_id}.acf")),
            format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"name\"\t\t\"{name}\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"{installdir}\"\n}}\n"
            ),
        )
        .unwrap();
        fs::create_dir_all(steamapps.join("common").join(installdir)).unwrap();
    }

    fn add_playtime(root: &Path, account_id: u32, app_id: &str, minutes: u32) {
        let config = root
            .join("userdata")
            .join(account_id.to_string())
            .join("config");
        fs::create_dir_all(&config).unwrap();
        fs::write(
            config.join("localconfig.vdf"),
            format!(
                "\"UserLocalConfigStore\"\n{{\n\"Software\"\n{{\n\"Valve\"\n{{\n\"Steam\"\n{{\n\"apps\"\n{{\n\"{app_id}\"\n{{\n\"Playtime\"\t\"{minutes}\"\n}}\n}}\n}}\n}}\n}}\n}}\n"
            ),
        )
        .unwrap();
    }

    #[test]
    fn lists_installed_games_that_were_never_played() {
        let root = steam_root_with_manifest("730", "4", true);
        add_manifest(&root, "440", "Played Game", "Played Game");
        add_manifest(
            &root,
            "228980",
            "Steamworks Common Redistributables",
            "Steamworks Shared",
        );
        add_playtime(&root, 7, "440", 10);

        let result = scan_root(&root, 7, None).unwrap();
        let ids = result
            .games
            .iter()
            .map(|game| game.external_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, ["440", "730"]);
        let played = &result.games[0];
        assert_eq!(played.playtime_seconds, Some(600));
        assert_eq!(played.has_played_evidence, None);
        let never_played = &result.games[1];
        assert_eq!(never_played.playtime_seconds, Some(0));
        assert_eq!(never_played.has_played_evidence, Some(false));
        assert!(never_played.installed);
        assert_eq!(never_played.name.as_deref(), Some("Test Game"));

        let only = scan_root(&root, 7, Some(&["730".to_string()])).unwrap();
        assert_eq!(only.games.len(), 1);
        assert_eq!(only.games[0].external_id, "730");

        let apps = Installs::read_from(&root).installed_apps();
        assert_eq!(
            apps.iter()
                .map(|app| app.app_id.as_str())
                .collect::<Vec<_>>(),
            ["440", "730"]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_removed_library_folder_on_a_present_drive_holds_no_games() {
        let removed =
            std::env::temp_dir().join(format!("playcounter-gone-{}", uuid::Uuid::new_v4()));
        let root = steam_root_with_libraries("730", "4", true, &[&removed]);
        let installs = Installs::read_from(&root);
        assert_eq!(installs.state("730"), Some(true));
        assert_eq!(installs.state("440"), Some(false));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn an_offline_library_leaves_games_it_might_hold_unknown() {
        let Some(offline) = ('D'..='Z')
            .rev()
            .map(|letter| PathBuf::from(format!(r"{letter}:\SteamLibrary")))
            .find(|path| !volume_is_present(path))
        else {
            return;
        };
        let root = steam_root_with_libraries("730", "4", true, &[&offline]);
        let installs = Installs::read_from(&root);
        assert_eq!(installs.state("730"), Some(true));
        assert_eq!(installs.state("440"), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn derives_the_local_account_id_from_steam_id64() {
        assert_eq!(account_id_from_steam_id(76_561_198_000_000_000), 39_734_272);
    }
}
