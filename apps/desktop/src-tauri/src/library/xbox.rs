use super::exe_scan::{self, path_string, ScannedExecutable, EXE_WALK_BUDGET};
use crate::launch::{LaunchError, LaunchErrorKind};
use quick_xml::{events::Event, reader::Reader, XmlVersion};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    fs,
    path::{Component, Path, PathBuf},
    time::Instant,
};

#[cfg(windows)]
use windows::{
    core::PCWSTR,
    Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE},
    },
};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS},
    Storage::{
        FileSystem::GetLogicalDrives,
        Packaging::Appx::{PackageFamilyNameFromId, PACKAGE_ID},
    },
};

const MAX_GAMING_ROOT_BYTES: u64 = 4 * 1024;
const MAX_GAME_CONFIG_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XboxLocalGame {
    /// Xbox Live title ID in decimal, matching XboxImportGame.externalId.
    external_id: String,
    name: String,
    install_path: String,
    executables: Vec<ScannedExecutable>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XboxLocalScan {
    games: Vec<XboxLocalGame>,
    warnings: Vec<String>,
    partial: bool,
}

#[derive(Default)]
struct GameConfig {
    title_id: Option<String>,
    application_id: Option<String>,
    display_name: Option<String>,
    executable_names: Vec<String>,
}

#[derive(Default)]
struct AppIdentity {
    package_name: Option<String>,
    publisher: Option<String>,
    application_id: Option<String>,
}

#[derive(Debug)]
enum GameFolderError {
    MissingConfig,
    MissingTitleId,
    InvalidConfig,
}

pub fn scan_local_games() -> XboxLocalScan {
    #[cfg(windows)]
    {
        return scan_local_games_windows();
    }

    #[cfg(not(windows))]
    {
        XboxLocalScan {
            games: Vec::new(),
            warnings: Vec::new(),
            partial: false,
        }
    }
}

#[cfg(windows)]
fn scan_local_games_windows() -> XboxLocalScan {
    let deadline = Instant::now() + EXE_WALK_BUDGET;
    let mut games = Vec::new();
    let mut warnings = Vec::new();
    let mut partial = false;
    let mut missing_title_id = false;
    let mut invalid_config = false;
    let mut executable_scan_capped = false;

    'roots: for root in xbox_game_roots() {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if Instant::now() >= deadline {
                partial = true;
                warnings.push("Executable scanning reached its 45 second budget.".to_string());
                break 'roots;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            match read_game_folder(&entry.path(), deadline) {
                Ok((game, capped)) => {
                    executable_scan_capped |= capped;
                    games.push(game);
                }
                Err(GameFolderError::MissingConfig) => {}
                Err(GameFolderError::MissingTitleId) => missing_title_id = true,
                Err(GameFolderError::InvalidConfig) => {
                    invalid_config = true;
                    partial = true;
                }
            }
        }
    }

    if missing_title_id {
        warnings.push("Some Xbox games do not report a title ID and were skipped.".to_string());
    }
    if invalid_config {
        warnings.push("Some Xbox game configurations could not be read.".to_string());
    }
    if executable_scan_capped {
        partial = true;
        warnings.push(
            "Some executable folders reached their safe scan limit; found games remain usable."
                .to_string(),
        );
    }
    let mut seen_title_ids = BTreeSet::new();
    games.retain(|game| seen_title_ids.insert(game.external_id.clone()));
    games.sort_by(|left, right| left.name.cmp(&right.name));

    XboxLocalScan {
        games,
        warnings,
        partial,
    }
}

#[cfg(windows)]
fn xbox_game_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let drive_mask = unsafe { GetLogicalDrives() };
    for index in 0..26u8 {
        if drive_mask & (1u32 << index) == 0 {
            continue;
        }
        let drive = PathBuf::from(format!("{}:\\", char::from(b'A' + index)));
        roots.push(drive.join("XboxGames"));
        if let Some(relative) = read_gaming_root(&drive.join(".GamingRoot")) {
            roots.push(drive.join(relative));
        }
    }

    let mut seen = BTreeSet::new();
    roots.retain(|root| seen.insert(path_string(root).to_ascii_lowercase()) && root.is_dir());
    roots
}

#[cfg(windows)]
fn read_gaming_root(path: &Path) -> Option<PathBuf> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() < 6 || metadata.len() > MAX_GAMING_ROOT_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.get(..4) != Some(b"RGBX") {
        return None;
    }
    let mut units = bytes[4..]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .take_while(|unit| *unit != 0)
        .collect::<Vec<_>>();
    while units
        .first()
        .is_some_and(|unit| *unit == b'\\' as u16 || *unit == b'/' as u16)
    {
        units.remove(0);
    }
    let relative = PathBuf::from(String::from_utf16(&units).ok()?.trim());
    if relative.as_os_str().is_empty()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return None;
    }
    Some(relative)
}

fn normalized_relative_path(path: &Path) -> String {
    path_string(path).replace('/', "\\")
}

fn game_config_path(folder: &Path) -> Option<PathBuf> {
    let content_config = folder.join("Content").join("MicrosoftGame.config");
    if content_config.is_file() {
        Some(content_config)
    } else {
        let root_config = folder.join("MicrosoftGame.config");
        root_config.is_file().then_some(root_config)
    }
}

fn read_game_folder(
    folder: &Path,
    deadline: Instant,
) -> Result<(XboxLocalGame, bool), GameFolderError> {
    let config_path = game_config_path(folder).ok_or(GameFolderError::MissingConfig)?;
    let install_path = config_path.parent().ok_or(GameFolderError::InvalidConfig)?;
    let config = read_game_config(&config_path).map_err(|_| GameFolderError::InvalidConfig)?;
    let title_id = config.title_id.ok_or(GameFolderError::MissingTitleId)?;
    let title_id = u32::from_str_radix(title_id.trim().trim_start_matches("0x"), 16)
        .ok()
        .filter(|id| *id != 0)
        .ok_or(GameFolderError::MissingTitleId)?;

    let mut executables = Vec::new();
    let mut seen = BTreeSet::new();
    for executable_name in config.executable_names {
        let relative = PathBuf::from(&executable_name);
        if relative.as_os_str().is_empty()
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            continue;
        }
        let executable_path = install_path.join(&relative);
        if !executable_path.is_file() {
            continue;
        }
        let Some(file_name) = executable_path.file_name() else {
            continue;
        };
        let relative_path = normalized_relative_path(&relative);
        seen.insert(relative_path.to_ascii_lowercase());
        executables.push(ScannedExecutable {
            file_name: file_name.to_string_lossy().to_string(),
            relative_path,
            size_bytes: executable_path
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            depth: relative.components().count().saturating_sub(1),
            declared: true,
        });
    }

    let (scanned, capped) = exe_scan::scan_executables(install_path, deadline);
    executables.extend(scanned.into_iter().filter(|executable| {
        seen.insert(
            normalized_relative_path(Path::new(&executable.relative_path)).to_ascii_lowercase(),
        )
    }));

    let name = config
        .display_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| {
            folder
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| title_id.to_string())
        });

    Ok((
        XboxLocalGame {
            external_id: title_id.to_string(),
            name,
            install_path: path_string(install_path),
            executables,
        },
        capped,
    ))
}

fn read_game_config(path: &Path) -> Result<GameConfig, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_GAME_CONFIG_BYTES {
        return Err("MicrosoftGame.config is too large to read safely.".to_string());
    }
    let xml = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut reader = Reader::from_str(xml.trim_start_matches('\u{feff}'));
    reader.config_mut().trim_text(true);
    let mut config = GameConfig::default();
    let mut reading_title_id = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                let name = element.local_name();
                if name.as_ref().eq_ignore_ascii_case("TitleId") {
                    reading_title_id = true;
                }
                read_element_attributes(&element, &mut config)?;
            }
            Ok(Event::Empty(element)) => {
                read_element_attributes(&element, &mut config)?;
            }
            Ok(Event::Text(text)) if reading_title_id && config.title_id.is_none() => {
                config.title_id = Some(text.xml_content(XmlVersion::Implicit1_0).into_owned());
            }
            Ok(Event::End(element))
                if element
                    .local_name()
                    .as_ref()
                    .eq_ignore_ascii_case("TitleId") =>
            {
                reading_title_id = false;
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(config)
}

fn read_app_identity(
    path: &Path,
    expected_application_id: Option<&str>,
) -> Result<AppIdentity, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_GAME_CONFIG_BYTES {
        return Err("appxmanifest.xml is too large to read safely.".to_string());
    }
    let xml = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut reader = Reader::from_str(xml.trim_start_matches('\u{feff}'));
    reader.config_mut().trim_text(true);
    let mut identity = AppIdentity::default();

    loop {
        match reader.read_event() {
            Ok(Event::Start(element) | Event::Empty(element)) => {
                let name = element.local_name();
                if name.as_ref().eq_ignore_ascii_case("Identity") {
                    identity.package_name = attribute_value(&element, "Name")?;
                    identity.publisher = attribute_value(&element, "Publisher")?;
                } else if name.as_ref().eq_ignore_ascii_case("Application") {
                    let candidate = attribute_value(&element, "Id")?;
                    if candidate.as_deref().is_some_and(|candidate| {
                        expected_application_id
                            .map(|expected| candidate.eq_ignore_ascii_case(expected))
                            .unwrap_or(identity.application_id.is_none())
                    }) {
                        identity.application_id = candidate;
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(identity)
}

fn read_element_attributes(
    element: &quick_xml::events::BytesStart<'_>,
    config: &mut GameConfig,
) -> Result<(), String> {
    let name = element.local_name();
    if name.as_ref().eq_ignore_ascii_case("ShellVisuals") && config.display_name.is_none() {
        config.display_name = attribute_value(element, "DefaultDisplayName")?;
    }
    if name.as_ref().eq_ignore_ascii_case("Executable") {
        let is_dev_only = attribute_value(element, "IsDevOnly")?
            .is_some_and(|value| value.eq_ignore_ascii_case("true"));
        if !is_dev_only {
            if config.application_id.is_none() {
                config.application_id = attribute_value(element, "Id")?;
            }
            if let Some(executable_name) = attribute_value(element, "Name")? {
                config.executable_names.push(executable_name);
            }
        }
    }
    Ok(())
}

fn attribute_value(
    element: &quick_xml::events::BytesStart<'_>,
    key: &str,
) -> Result<Option<String>, String> {
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|error| error.to_string())?;
        if attribute.key.as_ref().eq_ignore_ascii_case(key) {
            return attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .map(|value| Some(value.into_owned()))
                .map_err(|error| error.to_string());
        }
    }
    Ok(None)
}
pub fn launch_app(external_id: &str, mode: &str) -> Result<(), LaunchError> {
    let title_id = parse_external_id(external_id, mode)?;

    #[cfg(windows)]
    {
        let aumid = find_application_user_model_id(title_id).ok_or_else(|| {
            LaunchError::new(
                LaunchErrorKind::NotFound,
                "The local Xbox game registration could not be found.",
            )
        })?;
        activate_application(&aumid)?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = title_id;
        Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "Local Xbox launching is only available on Windows.",
        ))
    }
}

fn parse_external_id(external_id: &str, mode: &str) -> Result<u32, LaunchError> {
    if mode != "play" {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "Invalid Xbox launch mode.",
        ));
    }
    if external_id.is_empty()
        || external_id.starts_with('0')
        || external_id.len() > 10
        || !external_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "Invalid Xbox title ID.",
        ));
    }
    external_id
        .parse::<u32>()
        .ok()
        .filter(|id| *id != 0)
        .ok_or_else(|| LaunchError::new(LaunchErrorKind::InvalidPath, "Invalid Xbox title ID."))
}

#[cfg(windows)]
fn find_application_user_model_id(title_id: u32) -> Option<String> {
    for root in xbox_game_roots() {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let Some(config_path) = game_config_path(&entry.path()) else {
                continue;
            };
            let Ok(config) = read_game_config(&config_path) else {
                continue;
            };
            let config_title_id = config.title_id.as_deref().and_then(|value| {
                u32::from_str_radix(value.trim().trim_start_matches("0x"), 16).ok()
            });
            if config_title_id != Some(title_id) {
                continue;
            }
            let Some(install_path) = config_path.parent() else {
                continue;
            };
            if let Some(aumid) =
                application_user_model_id(install_path, config.application_id.as_deref())
            {
                return Some(aumid);
            }
        }
    }
    None
}

#[cfg(windows)]
fn application_user_model_id(
    install_path: &Path,
    expected_application_id: Option<&str>,
) -> Option<String> {
    let identity = read_app_identity(
        &install_path.join("appxmanifest.xml"),
        expected_application_id,
    )
    .ok()?;
    let package_name = identity.package_name?;
    let publisher = identity.publisher?;
    let application_id = identity.application_id?;
    let family_name = package_family_name(&package_name, &publisher).ok()?;
    Some(format!("{family_name}!{application_id}"))
}

#[cfg(windows)]
fn activate_application(aumid: &str) -> Result<u32, LaunchError> {
    let wide_aumid = aumid.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|error| {
                LaunchError::new(
                    LaunchErrorKind::SpawnFailed,
                    format!("Could not initialize Xbox app activation: {error}"),
                )
            })?;
        let result = (|| {
            let manager: IApplicationActivationManager =
                CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)
                    .map_err(|error| {
                        LaunchError::new(
                            LaunchErrorKind::SpawnFailed,
                            format!("Could not create the Xbox app activator: {error}"),
                        )
                    })?;
            manager
                .ActivateApplication(PCWSTR(wide_aumid.as_ptr()), PCWSTR::null(), AO_NONE)
                .map_err(|error| {
                    LaunchError::new(
                        LaunchErrorKind::SpawnFailed,
                        format!("Could not start Xbox game: {error}"),
                    )
                })
        })();
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn package_family_name(name: &str, publisher: &str) -> Result<String, String> {
    let mut name = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut publisher = publisher.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut package_id: PACKAGE_ID = unsafe { std::mem::zeroed() };
    package_id.name = name.as_mut_ptr();
    package_id.publisher = publisher.as_mut_ptr();

    let mut length = 0u32;
    let result = unsafe { PackageFamilyNameFromId(&package_id, &mut length, std::ptr::null_mut()) };
    if result != ERROR_INSUFFICIENT_BUFFER {
        return Err(format!(
            "Could not size the Xbox package family name ({result})."
        ));
    }
    let mut buffer = vec![0u16; length as usize];
    let result = unsafe { PackageFamilyNameFromId(&package_id, &mut length, buffer.as_mut_ptr()) };
    if result != ERROR_SUCCESS || length == 0 {
        return Err(format!(
            "Could not create the Xbox package family name ({result})."
        ));
    }
    buffer.truncate(length.saturating_sub(1) as usize);
    String::from_utf16(&buffer).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_xbox_external_ids_without_launching() {
        assert_eq!(parse_external_id("4294967295", "play").unwrap(), u32::MAX);
        assert_eq!(parse_external_id("1", "play").unwrap(), 1);
        for invalid in ["", "0", "012", "12a", "4294967296", "1 && calc"] {
            assert!(
                parse_external_id(invalid, "play").is_err(),
                "accepted {invalid}"
            );
        }
        assert!(parse_external_id("1", "store").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn derives_a_package_family_name_with_the_windows_api() {
        assert_eq!(
            package_family_name(
                "MijuGames.ThePlanetCrafter",
                "CN=59D7003F-441B-48BA-9EB9-44C1E1738970"
            )
            .unwrap(),
            "MijuGames.ThePlanetCrafter_ta6nvwnbx9v7t"
        );
    }

    #[test]
    fn reads_a_local_xbox_game_from_its_configuration() {
        let root =
            std::env::temp_dir().join(format!("playcounter-xbox-config-{}", uuid::Uuid::new_v4()));
        let game_root = root.join("Example Game");
        let content = game_root.join("Content");
        let binary = content.join("Bin").join("ExampleGame.exe");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, b"game executable").unwrap();
        fs::write(
            content.join("MicrosoftGame.config"),
            r#"<?xml version="1.0" encoding="utf-8"?>
<Game configVersion="1">
  <TitleId>1234ABCD</TitleId>
  <ShellVisuals DefaultDisplayName="Example &amp; Game" />
  <ExecutableList>
    <Executable Name="Bin/ExampleGame.exe" Id="Game" />
    <Executable Name="ExampleGame_Debug.exe" IsDevOnly="true" />
  </ExecutableList>
</Game>"#,
        )
        .unwrap();
        fs::write(
            content.join("appxmanifest.xml"),
            r#"<?xml version="1.0" encoding="utf-8"?>
<Package>
  <Identity Name="MijuGames.ThePlanetCrafter" Publisher="CN=59D7003F-441B-48BA-9EB9-44C1E1738970" />
  <Applications>
    <Application Id="Helper" Executable="Helper.exe" />
    <Application Id="Game" Executable="GameLaunchHelper.exe" />
  </Applications>
</Package>"#,
        )
        .unwrap();

        let (game, _) = read_game_folder(&game_root, Instant::now() + EXE_WALK_BUDGET).unwrap();

        assert_eq!(
            game.external_id,
            u32::from_str_radix("1234ABCD", 16).unwrap().to_string()
        );
        assert_eq!(game.name, "Example & Game");
        assert_eq!(Path::new(&game.install_path), content);
        assert_eq!(game.executables.len(), 1);
        assert_eq!(game.executables[0].file_name, "ExampleGame.exe");
        assert_eq!(game.executables[0].relative_path, r"Bin\ExampleGame.exe");
        assert!(game.executables[0].declared);
        #[cfg(windows)]
        assert_eq!(
            application_user_model_id(&content, Some("Game")).as_deref(),
            Some("MijuGames.ThePlanetCrafter_ta6nvwnbx9v7t!Game")
        );
        fs::remove_dir_all(root).unwrap();
    }
}
