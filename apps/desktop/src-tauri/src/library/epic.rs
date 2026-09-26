//! Games the Epic Games Launcher installed on this PC. The launcher keeps one
//! JSON `.item` manifest per installation; no Epic sign-in is needed here.
use super::{
    exe_scan::{self, ScannedExecutable},
    types::{InstalledGame, ProviderStatus, ScanResult, ScannedGame},
};
use crate::launch::{LaunchError, LaunchErrorKind};
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::Instant,
};

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_MANIFESTS: usize = 1_000;
/// Categories of launcher installs that are not games.
const NON_GAME_CATEGORIES: &[&str] = &["plugins", "engines", "digitalextras"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Manifest {
    app_name: String,
    #[serde(default)]
    display_name: Option<String>,
    install_location: String,
    #[serde(default)]
    launch_executable: Option<String>,
    #[serde(default)]
    catalog_namespace: Option<String>,
    #[serde(default)]
    catalog_item_id: Option<String>,
    #[serde(default)]
    main_game_app_name: Option<String>,
    #[serde(default)]
    app_categories: Vec<String>,
    #[serde(default, rename = "bIsIncompleteInstall")]
    incomplete_install: bool,
}

/// Epic app names are the launcher's own install identifiers, such as
/// `Fortnite` or a 32-character hex id. They are also used in launch URLs.
pub(super) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn manifests_dir() -> Option<PathBuf> {
    std::env::var_os("ProgramData")
        .map(|base| PathBuf::from(base).join("Epic/EpicGamesLauncher/Data/Manifests"))
}

fn read_manifest(path: &Path) -> Result<Manifest, String> {
    let file = fs::File::open(path).map_err(|_| "Could not read an Epic Games manifest.")?;
    let mut data = Vec::new();
    file.take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| "Could not read an Epic Games manifest.")?;
    if data.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("An Epic Games manifest exceeds the size limit.".into());
    }
    serde_json::from_slice(&data).map_err(|_| "Could not read an Epic Games manifest.".into())
}

/// All manifests the launcher wrote, plus whether any could not be read.
fn read_manifests(dir: &Path, warnings: &mut Vec<String>) -> Vec<Manifest> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(_) => {
            warnings.push("Could not read the Epic Games install list.".into());
            return Vec::new();
        }
    };
    let mut manifests = Vec::new();
    for entry in entries.flatten().take(MAX_MANIFESTS) {
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|value| value.eq_ignore_ascii_case("item"))
        {
            continue;
        }
        match read_manifest(&path) {
            Ok(manifest) => manifests.push(manifest),
            Err(error) => warnings.push(error),
        }
    }
    manifests
}

/// A complete game install, not a DLC, engine, plugin or half-finished download.
fn is_game_install(manifest: &Manifest) -> bool {
    valid_id(&manifest.app_name)
        && !manifest.incomplete_install
        && manifest
            .main_game_app_name
            .as_deref()
            .is_none_or(|main| main.is_empty() || main == manifest.app_name)
        && !manifest.app_categories.iter().any(|category| {
            NON_GAME_CATEGORIES
                .iter()
                .any(|blocked| category.eq_ignore_ascii_case(blocked))
        })
}

fn install_root(manifest: &Manifest) -> Option<PathBuf> {
    let path = PathBuf::from(&manifest.install_location);
    let valid = path.is_absolute()
        && !manifest.install_location.contains('\0')
        && !path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        && path
            .parent()
            .is_some_and(|parent| parent.parent().is_some());
    (valid && path.is_dir()).then_some(path)
}

pub(super) fn game_executable(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ![
        "epicgameslauncher",
        "easyanticheat",
        "crashreport",
        "unins",
        "setup",
        "redist",
        "prereq",
    ]
    .iter()
    .any(|part| name.contains(part))
}

/// The executable Epic starts. Unreal games often start a small bootstrap
/// that immediately runs `<Name>-Win64-Shipping.exe`, which is the process
/// PlayCounter sees while the game runs, so that one is preferred.
fn declared_executable(
    root: &Path,
    launch_executable: Option<&str>,
    executables: &[ScannedExecutable],
) -> Option<String> {
    let relative = launch_executable?.trim().replace('\\', "/");
    let stem = Path::new(&relative)
        .file_stem()?
        .to_string_lossy()
        .to_ascii_lowercase();
    let shipping = format!("{stem}-win64-shipping.exe");
    if let Some(found) = executables
        .iter()
        .find(|item| item.file_name.to_ascii_lowercase() == shipping)
    {
        return Some(found.relative_path.clone());
    }
    let launched = exe_scan::executable_from_path(
        &exe_scan::path_string(root),
        &exe_scan::path_string(&root.join(&relative)),
    )
    .ok()?;
    Some(launched.relative_path)
}

fn find_executables(
    manifest: &Manifest,
    root: &Path,
    deadline: Instant,
) -> Result<Vec<ScannedExecutable>, String> {
    let (scanned, capped) = exe_scan::scan_executables(root, deadline);
    let mut executables: Vec<_> = scanned
        .into_iter()
        .filter(|candidate| game_executable(&candidate.file_name))
        .collect();
    let declared = declared_executable(root, manifest.launch_executable.as_deref(), &executables);
    if let Some(declared) = declared {
        match executables
            .iter_mut()
            .find(|item| item.relative_path.eq_ignore_ascii_case(&declared))
        {
            Some(item) => item.declared = true,
            None => {
                // The walk is capped; the declared file may lie beyond it.
                if let Ok(mut item) = exe_scan::executable_from_path(
                    &exe_scan::path_string(root),
                    &exe_scan::path_string(&root.join(&declared)),
                ) {
                    item.declared = true;
                    executables.insert(0, item);
                }
            }
        }
    }
    let name = manifest
        .display_name
        .as_deref()
        .unwrap_or(&manifest.app_name);
    if executables.is_empty() {
        return Err(if capped {
            format!("The executable scan for {name} was incomplete. Try again after Epic Games finishes updating.")
        } else {
            format!("{name} has no installed game executable yet. Finish installing it in Epic Games, then scan again.")
        });
    }
    Ok(executables)
}

pub fn detect() -> ProviderStatus {
    ProviderStatus {
        provider: "epic",
        // Account imports also work without the launcher or any installed games.
        available: cfg!(windows),
        root_path: launcher_path()
            .and_then(|path| path.ancestors().nth(5).map(exe_scan::path_string)),
        checked_paths: manifests_dir()
            .map(|path| vec![exe_scan::path_string(&path)])
            .unwrap_or_default(),
    }
}

pub fn scan() -> Result<ScanResult, String> {
    scan_local(true)
}

fn scan_local(with_executables: bool) -> Result<ScanResult, String> {
    if !cfg!(windows) {
        return Err("Epic Games import is available on Windows.".into());
    }
    Ok(scan_manifests(manifests_dir().as_deref(), with_executables))
}

fn scan_manifests(dir: Option<&Path>, with_executables: bool) -> ScanResult {
    let mut warnings = Vec::new();
    let manifests = dir
        .map(|dir| read_manifests(dir, &mut warnings))
        .unwrap_or_default();
    let deadline = Instant::now() + exe_scan::EXE_WALK_BUDGET;
    let mut games = Vec::new();
    let mut seen = BTreeSet::new();
    for manifest in manifests {
        if !is_game_install(&manifest) || seen.contains(&manifest.app_name) {
            continue;
        }
        let Some(root) = install_root(&manifest) else {
            continue;
        };
        if with_executables && Instant::now() >= deadline {
            warnings.push("Epic Games scan reached its time limit. Scan again to retry.".into());
            break;
        }
        let executables = if with_executables {
            match find_executables(&manifest, &root, deadline) {
                Ok(executables) => executables,
                Err(error) => {
                    warnings.push(error);
                    continue;
                }
            }
        } else {
            Vec::new()
        };
        seen.insert(manifest.app_name.clone());
        games.push(ScannedGame {
            name: Some(
                manifest
                    .display_name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| manifest.app_name.clone()),
            ),
            external_id: manifest.app_name,
            // Epic keeps playtime in the account, not on this PC.
            playtime_seconds: None,
            has_played_evidence: Some(false),
            last_played_unix: None,
            installed: true,
            install_path: Some(exe_scan::path_string(&root)),
            executables,
        });
    }
    games.sort_by(|left, right| left.name.cmp(&right.name));
    warnings.sort();
    warnings.dedup();
    ScanResult {
        games,
        partial: !warnings.is_empty(),
        warnings,
    }
}

/// Epic's own record of what is installed, read once per check.
pub struct InstalledApps {
    ids: BTreeSet<String>,
    /// False when some manifests could not be read.
    complete: bool,
}

impl InstalledApps {
    pub fn read() -> Self {
        match scan_local(false) {
            Ok(result) => Self {
                complete: !result.partial,
                ids: result
                    .games
                    .into_iter()
                    .map(|game| game.external_id)
                    .collect(),
            },
            Err(_) => Self {
                ids: BTreeSet::new(),
                complete: false,
            },
        }
    }

    /// `Some(true)` when Epic lists the game as installed, `Some(false)` when
    /// it no longer does, `None` when it cannot tell.
    pub fn state(&self, id: &str) -> Option<bool> {
        if self.ids.contains(id) {
            Some(true)
        } else {
            self.complete.then_some(false)
        }
    }
}

pub fn installed_games() -> Vec<InstalledGame> {
    scan_local(false)
        .map(|result| {
            result
                .games
                .into_iter()
                .filter_map(|game| {
                    Some(InstalledGame {
                        install_path: game.install_path?,
                        external_id: game.external_id,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn launcher_path() -> Option<PathBuf> {
    ["ProgramFiles(x86)", "ProgramFiles"]
        .into_iter()
        .filter_map(std::env::var_os)
        .flat_map(|base| {
            ["Win64", "Win32"].map(|arch| {
                PathBuf::from(&base).join(format!(
                    "Epic Games/Launcher/Portal/Binaries/{arch}/EpicGamesLauncher.exe"
                ))
            })
        })
        .find(|path| path.is_file())
}

/// Launch URLs name the catalog item, which only the install manifest knows.
fn launch_url(manifest: &Manifest) -> Option<String> {
    let namespace = manifest.catalog_namespace.as_deref()?;
    let item = manifest.catalog_item_id.as_deref()?;
    (valid_id(namespace) && valid_id(item) && valid_id(&manifest.app_name)).then(|| {
        format!(
            "com.epicgames.launcher://apps/{namespace}%3A{item}%3A{}?action=launch&silent=true",
            manifest.app_name
        )
    })
}

fn epic_url(external_id: &str, mode: &str) -> Result<String, LaunchError> {
    if !valid_id(external_id) {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "Invalid Epic Games app name.",
        ));
    }
    match mode {
        "store" => Ok("com.epicgames.launcher://store/library".into()),
        "play" => {
            let mut warnings = Vec::new();
            manifests_dir()
                .map(|dir| read_manifests(&dir, &mut warnings))
                .unwrap_or_default()
                .into_iter()
                .find(|manifest| {
                    manifest.app_name == external_id
                        && is_game_install(manifest)
                        && install_root(manifest).is_some()
                })
                .and_then(|manifest| launch_url(&manifest))
                .ok_or_else(|| {
                    LaunchError::new(
                        LaunchErrorKind::NotFound,
                        "Epic Games no longer has this game installed.",
                    )
                })
        }
        _ => Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "Invalid Epic Games launch mode.",
        )),
    }
}

pub fn launch_app(external_id: &str, mode: &str) -> Result<(), LaunchError> {
    if !cfg!(windows) {
        return Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "Epic Games launching is only available on Windows.",
        ));
    }
    let url = epic_url(external_id, mode)?;
    #[cfg(windows)]
    {
        crate::shell_open::open_url(&url).map_err(|error| {
            LaunchError::new(
                LaunchErrorKind::SpawnFailed,
                format!("Could not open Epic Games: {error}"),
            )
        })
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("playcounter-epic-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_manifest(dir: &Path, file: &str, value: serde_json::Value) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(file), serde_json::to_vec(&value).unwrap()).unwrap();
    }

    fn manifest(app_name: &str, install: &Path) -> serde_json::Value {
        serde_json::json!({
            "FormatVersion": 0,
            "bIsIncompleteInstall": false,
            "AppName": app_name,
            "DisplayName": "Sample Game",
            "InstallLocation": install.to_string_lossy(),
            "LaunchExecutable": "Sample.exe",
            "CatalogNamespace": "0a1b2c3d",
            "CatalogItemId": "4e5f6a7b",
            "MainGameAppName": app_name,
            "AppCategories": ["public", "games", "applications"],
            "UnknownField": {"nested": true}
        })
    }

    #[test]
    fn validates_app_names_used_in_launch_urls() {
        for id in [
            "Fortnite",
            "Sugar",
            "9d2d0eb64d5c44529cece33fe2a46482",
            "a.b_c-d",
        ] {
            assert!(valid_id(id));
        }
        for id in [
            "",
            "../x",
            "a b",
            "a%3Ab",
            "a?action=x",
            "-lead",
            &"a".repeat(65),
        ] {
            assert!(!valid_id(id));
        }
        assert!(epic_url("../x", "play").is_err());
        assert!(epic_url("Fortnite", "install").is_err());
        assert_eq!(
            epic_url("Fortnite", "store").unwrap(),
            "com.epicgames.launcher://store/library"
        );
    }

    #[test]
    fn builds_the_launch_url_from_the_manifest() {
        let root = temp_root();
        let parsed: Manifest = serde_json::from_value(manifest("Sugar", &root)).unwrap();
        assert_eq!(
            launch_url(&parsed).unwrap(),
            "com.epicgames.launcher://apps/0a1b2c3d%3A4e5f6a7b%3ASugar?action=launch&silent=true"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_launcher_data_is_an_empty_scan() {
        let result = scan_manifests(Some(&temp_root().join("missing")), true);
        assert!(result.games.is_empty());
        assert!(!result.partial);
    }

    #[test]
    fn skips_dlc_engines_partial_installs_and_unreadable_manifests() {
        let root = temp_root();
        let manifests = root.join("Manifests");
        let game = root.join("Games/Sample");
        fs::create_dir_all(&game).unwrap();
        fs::write(game.join("Sample.exe"), vec![0u8; 128 * 1024]).unwrap();
        write_manifest(&manifests, "game.item", manifest("Sample", &game));
        let mut dlc = manifest("SampleDlc", &game);
        dlc["MainGameAppName"] = "Sample".into();
        write_manifest(&manifests, "dlc.item", dlc);
        let mut engine = manifest("UE_5.3", &game);
        engine["AppCategories"] = serde_json::json!(["engines"]);
        write_manifest(&manifests, "engine.item", engine);
        let mut partial = manifest("Downloading", &game);
        partial["bIsIncompleteInstall"] = true.into();
        write_manifest(&manifests, "partial.item", partial);
        write_manifest(
            &manifests,
            "gone.item",
            manifest("Gone", &root.join("Games/Gone")),
        );
        fs::write(manifests.join("broken.item"), "not json").unwrap();
        fs::write(manifests.join("ignored.txt"), "not a manifest").unwrap();

        let result = scan_manifests(Some(&manifests), true);
        assert_eq!(
            result
                .games
                .iter()
                .map(|game| game.external_id.as_str())
                .collect::<Vec<_>>(),
            vec!["Sample"]
        );
        assert!(result.partial);
        assert_eq!(result.warnings.len(), 1);
        let game = &result.games[0];
        assert_eq!(game.name.as_deref(), Some("Sample Game"));
        assert_eq!(game.playtime_seconds, None);
        assert_eq!(game.has_played_evidence, Some(false));
        assert!(game.executables[0].declared);

        let listed = scan_manifests(Some(&manifests), false);
        assert!(listed.games[0].executables.is_empty());
        let apps = InstalledApps {
            ids: listed
                .games
                .iter()
                .map(|game| game.external_id.clone())
                .collect(),
            complete: !listed.partial,
        };
        assert_eq!(apps.state("Sample"), Some(true));
        // A manifest could not be read, so a missing game proves nothing.
        assert_eq!(apps.state("Gone"), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn prefers_the_unreal_shipping_executable_over_its_bootstrap() {
        let root = temp_root();
        let manifests = root.join("Manifests");
        let game = root.join("Games/Sample");
        let binaries = game.join("Sample/Binaries/Win64");
        fs::create_dir_all(&binaries).unwrap();
        fs::write(game.join("Sample.exe"), vec![0u8; 128 * 1024]).unwrap();
        fs::write(
            binaries.join("Sample-Win64-Shipping.exe"),
            vec![0u8; 256 * 1024],
        )
        .unwrap();
        fs::write(
            binaries.join("EasyAntiCheat_EOS_Setup.exe"),
            vec![0u8; 128 * 1024],
        )
        .unwrap();
        write_manifest(&manifests, "game.item", manifest("Sample", &game));

        let result = scan_manifests(Some(&manifests), true);
        let executables = &result.games[0].executables;
        let declared: Vec<_> = executables.iter().filter(|item| item.declared).collect();
        assert_eq!(declared.len(), 1);
        assert_eq!(declared[0].file_name, "Sample-Win64-Shipping.exe");
        assert!(executables
            .iter()
            .all(|item| !item.file_name.starts_with("EasyAntiCheat")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "Read-only inspection of this Windows machine's Epic Games installations"]
    fn inspect_local_installations() {
        println!(
            "{}",
            serde_json::to_string_pretty(&scan().unwrap()).unwrap()
        );
    }
}
