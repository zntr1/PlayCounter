use super::{
    exe_scan,
    types::{ProviderStatus, ScanResult, ScannedGame},
};
use crate::launch::{LaunchError, LaunchErrorKind};
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PRODUCTS: usize = 500;
const CATALOG: &str = include_str!("../../../../../packages/shared/src/battlenet-products.json");

#[derive(Deserialize)]
struct Product {
    id: String,
    name: String,
    folder: String,
    executables: Vec<String>,
}

#[derive(Debug, PartialEq)]
struct Installation {
    id: String,
    path: PathBuf,
    name: Option<String>,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn database_path() -> Option<PathBuf> {
    std::env::var_os("ProgramData")
        .map(|base| PathBuf::from(base).join("Battle.net/Agent/product.db"))
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| "Could not read a Battle.net data file.")?;
    let mut data = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| "Could not read a Battle.net data file.")?;
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err("Battle.net data file exceeds the size limit.".into());
    }
    Ok(data)
}

// Only the three installation fields are needed. Unknown protobuf fields are
// skipped; length and varint bounds are checked before advancing the reader.
fn varint(data: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut result = 0;
    for index in 0..10 {
        let byte = *data.get(*cursor).ok_or("Truncated Battle.net database.")?;
        *cursor += 1;
        if index == 9 && byte > 1 {
            return Err("Invalid Battle.net database integer.".into());
        }
        result |= u64::from(byte & 127) << (index * 7);
        if byte < 128 {
            return Ok(result);
        }
    }
    Err("Invalid Battle.net database integer.".into())
}

fn fields(data: &[u8]) -> Result<Vec<(u64, &[u8])>, String> {
    let mut cursor = 0;
    let mut result = Vec::new();
    let mut count = 0;
    while cursor < data.len() {
        count += 1;
        if count > 10_000 {
            return Err("Too many Battle.net database fields.".into());
        }
        let tag = varint(data, &mut cursor)?;
        if tag >> 3 == 0 {
            return Err("Invalid Battle.net database field.".into());
        }
        let size = match tag & 7 {
            0 => {
                varint(data, &mut cursor)?;
                continue;
            }
            1 => 8,
            2 => usize::try_from(varint(data, &mut cursor)?).map_err(|_| "Invalid field size.")?,
            5 => 4,
            _ => return Err("Unsupported Battle.net database field.".into()),
        };
        let end = cursor.checked_add(size).ok_or("Invalid field size.")?;
        let bytes = data
            .get(cursor..end)
            .ok_or("Truncated Battle.net database field.")?;
        if tag & 7 == 2 {
            result.push((tag >> 3, bytes));
        }
        cursor = end;
    }
    Ok(result)
}

fn text_field<'a>(items: &[(u64, &'a [u8])], number: u64) -> Option<&'a str> {
    items
        .iter()
        .find(|(field, _)| *field == number)
        .and_then(|(_, value)| std::str::from_utf8(value).ok())
}

fn parse_database(data: &[u8]) -> Result<Vec<Installation>, String> {
    let mut installs = Vec::new();
    for (_, record) in fields(data)?.into_iter().filter(|(field, _)| *field == 1) {
        if installs.len() >= MAX_PRODUCTS {
            return Err("Too many Battle.net products.".into());
        }
        let record = fields(record)?;
        let id = text_field(&record, 2)
            .or_else(|| text_field(&record, 1))
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(id.as_str(), "agent" | "bna" | "battle.net" | "battle_net") || !valid_id(&id) {
            continue;
        }
        let Some((_, settings)) = record.iter().find(|(field, _)| *field == 3) else {
            continue;
        };
        let settings = fields(settings)?;
        let Some(path) = text_field(&settings, 1) else {
            continue;
        };
        if path.len() > 4096 || path.contains('\0') {
            continue;
        }
        installs.push(Installation {
            id,
            path: PathBuf::from(path),
            name: None,
        });
    }
    Ok(installs)
}

fn last_played(config: &serde_json::Value, product: &str, now: u64) -> Option<u64> {
    let value = &config["Games"][product]["LastPlayed"];
    let timestamp = value
        .as_u64()
        .or_else(|| value.as_str()?.parse::<u64>().ok())?;
    // Local launcher dates are seconds, not milliseconds or file timestamps.
    (timestamp >= 946_684_800 && timestamp <= now.saturating_add(300)).then_some(timestamp)
}

fn active_product(data: &[u8], product: &str) -> bool {
    let Ok(text) = std::str::from_utf8(data) else {
        return false;
    };
    let mut lines = text.lines();
    let columns: Vec<_> = lines
        .next()
        .unwrap_or("")
        .trim_start_matches('\u{feff}')
        .split('|')
        .map(|column| column.split('!').next().unwrap_or(""))
        .collect();
    let (Some(product_col), Some(active_col)) = (
        columns.iter().position(|v| *v == "Product"),
        columns.iter().position(|v| *v == "Active"),
    ) else {
        return false;
    };
    lines.take(MAX_PRODUCTS).any(|line| {
        let values: Vec<_> = line.split('|').collect();
        values
            .get(product_col)
            .is_some_and(|value| value.eq_ignore_ascii_case(product))
            && values.get(active_col) == Some(&"1")
    })
}

pub(super) fn game_executable(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ![
        "launcher",
        "battle.net",
        "blizzard",
        "voiceproxy",
        "world editor",
        "clientsdk",
        "jass",
        "unins",
        "setup",
        "redist",
        "crash",
        "update",
        "helper",
    ]
    .iter()
    .any(|part| name.contains(part))
}

fn inspect_install(
    install: Installation,
    catalog: &[Product],
    config: &serde_json::Value,
    now: u64,
    deadline: Instant,
) -> Result<Option<ScannedGame>, String> {
    if !install.path.is_absolute()
        || install
            .path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        || install
            .path
            .parent()
            .is_none_or(|parent| parent.parent().is_none())
    {
        return Err(format!(
            "Skipped an invalid installation for {}.",
            install.id
        ));
    }
    if !install.path.is_dir() {
        return Ok(None);
    }
    let build = read_bounded(&install.path.join(".build.info"))?;
    if !active_product(&build, &install.id) {
        return Ok(None);
    }
    let product = catalog.iter().find(|product| product.id == install.id);
    if product.is_none() && install.id.starts_with("wow") {
        return Err(format!(
            "{} needs a supported variant folder before it can be imported.",
            install.id
        ));
    }
    let root = product
        .map(|product| install.path.join(&product.folder))
        .unwrap_or_else(|| install.path.clone());
    if !root.is_dir() {
        return Ok(None);
    }
    let canonical_install =
        fs::canonicalize(&install.path).map_err(|_| "Could not open installation.")?;
    let canonical_root = fs::canonicalize(&root).map_err(|_| "Could not open game folder.")?;
    if !canonical_root.starts_with(&canonical_install) {
        return Err("Battle.net game folder is outside its installation.".into());
    }
    // Prefer known game entry points so asset folders do not exhaust the walk.
    let mut executables = product
        .map(|product| {
            product
                .executables
                .iter()
                .filter_map(|relative| {
                    let executable = root.join(relative);
                    let candidate = exe_scan::executable_from_path(
                        &exe_scan::path_string(&root),
                        &exe_scan::path_string(&executable),
                    )
                    .ok()?;
                    game_executable(&candidate.file_name).then_some(candidate)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if executables.is_empty() {
        let (scanned, capped) = exe_scan::scan_executables(&root, deadline);
        executables = scanned
            .into_iter()
            .filter(|candidate| game_executable(&candidate.file_name))
            .collect();
        if capped {
            return Err(format!("The executable scan for {} was incomplete. Try again after Battle.net finishes updating.", install.id));
        }
    }
    if executables.is_empty() {
        return Err(format!("{} has no installed game executable yet. Finish installing it in Battle.net, then scan again.", install.id));
    }
    let last_played_unix = last_played(config, &install.id, now);
    Ok(Some(ScannedGame {
        external_id: install.id.clone(),
        name: Some(
            product
                .map(|product| product.name.clone())
                .or(install.name)
                .unwrap_or(install.id),
        ),
        playtime_seconds: None,
        has_played_evidence: Some(last_played_unix.is_some()),
        last_played_unix,
        installed: true,
        install_path: Some(exe_scan::path_string(&root)),
        executables,
    }))
}

pub fn detect() -> ProviderStatus {
    let database = database_path();
    let launcher = launcher_path();
    ProviderStatus {
        provider: "battlenet",
        // Account imports also work without the launcher or any installed games.
        available: cfg!(windows),
        root_path: launcher.and_then(|path| path.parent().map(exe_scan::path_string)),
        checked_paths: database
            .as_ref()
            .map(|path| vec![exe_scan::path_string(path)])
            .unwrap_or_default(),
    }
}

pub fn scan() -> Result<ScanResult, String> {
    if !cfg!(windows) {
        return Err("Battle.net import is available on Windows.".into());
    }
    scan_sources(
        database_path().as_deref(),
        std::env::var_os("APPDATA")
            .map(|base| PathBuf::from(base).join("Battle.net/Battle.net.config"))
            .as_deref(),
        registry_installs(),
    )
}

fn scan_sources(
    database: Option<&Path>,
    config_path: Option<&Path>,
    registry: Vec<Installation>,
) -> Result<ScanResult, String> {
    let mut warnings = Vec::new();
    let mut installs = match database
        .filter(|path| !matches!(path.try_exists(), Ok(false)))
        .map(read_bounded)
        .transpose()
        .and_then(|data| data.map(|data| parse_database(&data)).transpose())
    {
        Ok(installs) => installs.unwrap_or_default(),
        Err(error) => {
            warnings.push(error);
            Vec::new()
        }
    };
    let catalog: Vec<Product> =
        serde_json::from_str(CATALOG).map_err(|_| "Invalid Battle.net product catalogue.")?;
    installs.extend(registry);
    let config = match config_path
        .filter(|path| path.exists())
        .map(read_bounded)
        .transpose()
        .and_then(|data| {
            data.map(|data| {
                serde_json::from_slice::<serde_json::Value>(&data)
                    .map_err(|_| "Could not read Battle.net last-played dates.".into())
            })
            .transpose()
        }) {
        Ok(config) => config.unwrap_or(serde_json::Value::Null),
        Err(error) => {
            warnings.push(error);
            serde_json::Value::Null
        }
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let deadline = Instant::now() + exe_scan::EXE_WALK_BUDGET;
    let mut games = Vec::new();
    let mut seen = BTreeSet::new();
    for install in installs.into_iter().take(MAX_PRODUCTS) {
        if seen.contains(&install.id) {
            continue;
        }
        if Instant::now() >= deadline {
            warnings.push("Battle.net scan reached its time limit. Scan again to retry.".into());
            break;
        }
        match inspect_install(install, &catalog, &config, now, deadline) {
            Ok(Some(game)) => {
                seen.insert(game.external_id.clone());
                games.push(game);
            }
            Ok(None) => {}
            Err(error) => warnings.push(error),
        }
    }
    games.sort_by(|left, right| left.name.cmp(&right.name));
    warnings.sort();
    warnings.dedup();
    Ok(ScanResult {
        games,
        partial: !warnings.is_empty(),
        warnings,
    })
}

fn launcher_path() -> Option<PathBuf> {
    let from_db = database_path()
        .and_then(|path| read_bounded(&path).ok())
        .and_then(|data| {
            fields(&data)
                .ok()?
                .into_iter()
                .filter(|(field, _)| *field == 1)
                .find_map(|(_, record)| {
                    let record = fields(record).ok()?;
                    if !matches!(
                        text_field(&record, 2),
                        Some("bna" | "battle.net" | "battle_net")
                    ) {
                        return None;
                    }
                    let settings = fields(record.iter().find(|(field, _)| *field == 3)?.1).ok()?;
                    Some(PathBuf::from(text_field(&settings, 1)?).join("Battle.net.exe"))
                })
        });
    from_db
        .into_iter()
        .chain(
            ["ProgramFiles(x86)", "ProgramFiles"]
                .into_iter()
                .filter_map(std::env::var_os)
                .map(|base| PathBuf::from(base).join("Battle.net/Battle.net.exe")),
        )
        .find(|path| path.is_absolute() && path.is_file())
}

pub fn launch_app(external_id: &str, mode: &str) -> Result<(), LaunchError> {
    if !cfg!(windows) || !valid_id(external_id) || !matches!(mode, "play" | "store") {
        return Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "Invalid Battle.net open request.",
        ));
    }
    let launcher = launcher_path().ok_or_else(|| {
        LaunchError::new(
            LaunchErrorKind::NotFound,
            "Battle.net was not found on this PC.",
        )
    })?;
    // Open the launcher. Launch codes vary independently from installation IDs;
    // the UI says Open Battle.net rather than claiming the game has started.
    std::process::Command::new(launcher)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            LaunchError::new(
                LaunchErrorKind::SpawnFailed,
                format!("Could not open Battle.net: {error}"),
            )
        })
}

#[cfg(not(windows))]
fn registry_installs() -> Vec<Installation> {
    Vec::new()
}

#[cfg(windows)]
fn registry_installs() -> Vec<Installation> {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS},
        System::Registry::*,
    };
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    fn open(parent: HKEY, name: &str) -> Option<Key> {
        let mut key = ptr::null_mut();
        (unsafe { RegOpenKeyExW(parent, wide(name).as_ptr(), 0, KEY_READ, &mut key) }
            == ERROR_SUCCESS)
            .then(|| Key(key))
    }
    fn value(key: &Key, name: &str) -> Option<String> {
        let mut data = vec![0u16; 4096];
        let mut size = (data.len() * 2) as u32;
        let mut kind = 0;
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                wide(name).as_ptr(),
                ptr::null_mut(),
                &mut kind,
                data.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || kind != REG_SZ {
            return None;
        }
        Some(String::from_utf16_lossy(
            &data[..data.iter().position(|v| *v == 0).unwrap_or(data.len())],
        ))
    }
    let mut installs = Vec::new();
    for (hive, path) in [
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ] {
        let Some(root) = open(hive, path) else {
            continue;
        };
        for index in 0..4096 {
            let mut name = [0u16; 512];
            let mut size = name.len() as u32;
            let status = unsafe {
                RegEnumKeyExW(
                    root.0,
                    index,
                    name.as_mut_ptr(),
                    &mut size,
                    ptr::null(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            };
            if status == ERROR_NO_MORE_ITEMS {
                break;
            }
            if status != ERROR_SUCCESS {
                continue;
            }
            let Some(key) = open(root.0, &String::from_utf16_lossy(&name[..size as usize])) else {
                continue;
            };
            let Some(command) = value(&key, "UninstallString") else {
                continue;
            };
            if !command.to_ascii_lowercase().contains("battle.net") {
                continue;
            }
            let Some(id) = command
                .split("--uid=")
                .nth(1)
                .and_then(|value| value.split_whitespace().next())
                .map(|value| value.trim_matches('"').to_ascii_lowercase())
            else {
                continue;
            };
            if !valid_id(&id) {
                continue;
            }
            let Some(path) = value(&key, "InstallLocation") else {
                continue;
            };
            installs.push(Installation {
                id,
                path: PathBuf::from(path),
                name: value(&key, "DisplayName"),
            });
        }
    }
    installs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(number: u8, value: &[u8]) -> Vec<u8> {
        assert!(value.len() < 128);
        [vec![(number << 3) | 2, value.len() as u8], value.to_vec()].concat()
    }

    #[test]
    fn reads_installations_and_skips_components_and_unknown_fields() {
        let install = [
            field(1, b"wow_classic_era"),
            field(2, b"wow_classic_era"),
            field(3, &field(1, b"C:/Games/WoW")),
            vec![72, 1],
        ]
        .concat();
        let component = field(1, &field(2, b"agent"));
        let data = [field(1, &install), component, vec![80, 42]].concat();
        assert_eq!(
            parse_database(&data).unwrap(),
            vec![Installation {
                id: "wow_classic_era".into(),
                path: PathBuf::from("C:/Games/WoW"),
                name: None
            }]
        );
    }

    #[test]
    fn rejects_truncated_and_overflowing_protobuf() {
        for data in [
            vec![10, 127, 1],
            vec![0],
            vec![128; 11],
            vec![9, 1],
            vec![10, 255, 255, 255, 255, 255, 255, 255, 255, 255, 127],
        ] {
            assert!(parse_database(&data).is_err());
        }
    }

    #[test]
    fn dates_must_be_plausible_seconds_and_builds_must_be_active() {
        let config = serde_json::json!({"Games": {"w3": {"LastPlayed": "1787054964"}, "wow": {"LastPlayed": "1787054964000"}}});
        assert_eq!(last_played(&config, "w3", 1787055000), Some(1787054964));
        assert_eq!(last_played(&config, "wow", 1787055000), None);
        assert_eq!(last_played(&config, "missing", 1787055000), None);
        let build = b"Active!DEC:1|Product!STRING:0\n1|wow_classic_era\n0|wow\n";
        assert!(active_product(build, "wow_classic_era"));
        assert!(!active_product(build, "wow"));
        assert!(!active_product(b"invalid", "wow"));
    }

    #[test]
    fn filters_helpers_and_validates_product_codes() {
        for name in [
            "BlizzardError.exe",
            "World of Warcraft Launcher.exe",
            "WowVoiceProxy.exe",
            "World Editor.exe",
            "ClientSdkFirewallHelper.exe",
        ] {
            assert!(!game_executable(name));
        }
        assert!(game_executable("WowClassic.exe"));
        assert!(valid_id("wow_classic_era"));
        for id in ["../wow", "wow --exec=launch", "", "WoW", "bna.exe"] {
            assert!(!valid_id(id));
        }
    }

    #[test]
    fn missing_launcher_data_is_an_empty_scan_not_a_failed_account_import() {
        let missing =
            std::env::temp_dir().join(format!("playcounter-missing-{}", uuid::Uuid::new_v4()));
        let result = scan_sources(Some(&missing.join("product.db")), None, vec![]).unwrap();
        assert!(result.games.is_empty());
        assert!(result.warnings.is_empty());
        assert!(!result.partial);
    }

    #[test]
    fn scans_variant_subfolder_and_keeps_missing_activity_unknown() {
        let root = std::env::temp_dir().join(format!("playcounter-bnet-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("_classic_era_")).unwrap();
        fs::create_dir_all(root.join("_retail_")).unwrap();
        fs::write(
            root.join(".build.info"),
            "Active!DEC:1|Product!STRING:0\n1|wow_classic_era\n",
        )
        .unwrap();
        fs::write(root.join("_classic_era_/WowClassic.exe"), b"fixture").unwrap();
        fs::write(root.join("_retail_/Wow.exe"), b"fixture").unwrap();
        let result = scan_sources(
            None,
            None,
            vec![Installation {
                id: "wow_classic_era".into(),
                path: root.clone(),
                name: None,
            }],
        )
        .unwrap();
        assert_eq!(result.games.len(), 1);
        let game = &result.games[0];
        assert!(game
            .install_path
            .as_ref()
            .unwrap()
            .ends_with("_classic_era_"));
        assert_eq!(game.playtime_seconds, None);
        assert_eq!(game.has_played_evidence, Some(false));
        assert_eq!(game.executables[0].file_name, "WowClassic.exe");

        // An unreadable product database must leave registry discovery usable,
        // with an explicit partial result rather than an empty successful scan.
        fs::write(root.join("product.db"), [10, 127, 1]).unwrap();
        fs::write(root.join("Battle.net.config"), "invalid json").unwrap();
        let fallback = scan_sources(
            Some(&root.join("product.db")),
            Some(&root.join("Battle.net.config")),
            vec![
                Installation {
                    id: "wow_classic_era".into(),
                    path: root.clone(),
                    name: None,
                },
                Installation {
                    id: "wow".into(),
                    path: root.clone(),
                    name: None,
                },
            ],
        )
        .unwrap();
        assert!(fallback.partial);
        assert_eq!(fallback.warnings.len(), 2);
        assert_eq!(fallback.games.len(), 1);
        assert_eq!(fallback.games[0].last_played_unix, None);

        let resolved = fs::canonicalize(&root).unwrap();
        assert!(resolved.starts_with(fs::canonicalize(std::env::temp_dir()).unwrap()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("playcounter-bnet-"));
        fs::remove_dir_all(resolved).unwrap();
    }

    #[test]
    #[ignore = "Read-only inspection of this Windows machine's Battle.net installation"]
    fn inspect_local_installations() {
        println!(
            "{}",
            serde_json::to_string_pretty(&scan().unwrap()).unwrap()
        );
    }
}
