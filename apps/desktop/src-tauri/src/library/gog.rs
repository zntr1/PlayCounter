//! Games GOG installed on this PC. GOG GALAXY and GOG's offline installers both
//! leave a Windows uninstall entry named `<id>_is1` (Publisher GOG.com) and a
//! `goggame-<id>.info` file in the game folder, which names the file that
//! starts the game. Playnite finds GOG installs the same way. No sign-in is
//! needed here.
use super::{
    exe_scan::{self, ScannedExecutable},
    types::{InstalledGame, ProviderStatus, ScanResult, ScannedGame},
};
use crate::launch::{LaunchError, LaunchErrorKind};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::Instant,
};

const MAX_INFO_BYTES: u64 = 256 * 1024;

/// GOG product ids: digits, 1 to 10 long, no leading zero.
pub(super) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 10
        && !value.starts_with('0')
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// What one Windows uninstall entry says.
#[derive(Debug, Clone, Default, PartialEq)]
pub(super) struct UninstallEntry {
    /// The registry key's own name, e.g. `1_is1`.
    pub key: String,
    pub publisher: Option<String>,
    pub display_name: Option<String>,
    pub install_location: Option<String>,
}

/// Windows' uninstall entries. `complete` is false when some could not be
/// read: then a game missing from them proves nothing.
pub(super) struct UninstallList {
    pub entries: Vec<UninstallEntry>,
    pub complete: bool,
}

/// GOG names its uninstall entries `<id>_is1`. GOG GALAXY's own is
/// `{GUID}_is1` and never matches.
fn id_of_key(key: &str) -> Option<&str> {
    let split = key.len().checked_sub(4)?;
    let (id, suffix) = (key.get(..split)?, key.get(split..)?);
    (suffix.eq_ignore_ascii_case("_is1") && valid_id(id)).then_some(id)
}

/// GOG's installs are `<digits>_is1` from publisher GOG.com.
fn gog_install_id(entry: &UninstallEntry) -> Option<&str> {
    let from_gog = entry
        .publisher
        .as_deref()
        .is_some_and(|publisher| publisher.trim().eq_ignore_ascii_case("GOG.com"));
    id_of_key(&entry.key).filter(|_| from_gog)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameInfo {
    #[serde(default)]
    game_id: Value,
    #[serde(default)]
    root_game_id: Value,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    play_tasks: Vec<PlayTask>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayTask {
    #[serde(default)]
    is_primary: bool,
    #[serde(default)]
    is_hidden: bool,
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    working_dir: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

fn id_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_owned()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

impl GameInfo {
    /// What GOG GALAXY's Play starts. Never a hidden task.
    fn primary_task(&self) -> Option<&PlayTask> {
        self.play_tasks.iter().find(|task| {
            task.is_primary
                && !task.is_hidden
                && task.kind.eq_ignore_ascii_case("FileTask")
                && task
                    .path
                    .as_deref()
                    .is_some_and(|path| !path.trim().is_empty())
        })
    }

    /// The game's own file. A DLC's file names another game as its root, or
    /// has no start file.
    fn is_game(&self, id: &str) -> bool {
        id_text(&self.game_id).as_deref() == Some(id)
            && id_text(&self.root_game_id)
                .filter(|root| !root.is_empty())
                .is_none_or(|root| root == id)
            && self.primary_task().is_some()
    }

    fn start_path(&self) -> Option<&str> {
        self.primary_task()
            .and_then(|task| task.path.as_deref())
            .map(str::trim)
    }
}

fn parse_info(bytes: &[u8]) -> Option<GameInfo> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    serde_json::from_slice(bytes).ok()
}

/// `Ok(None)`: the folder has no such file. `Err(())`: it could not be read.
fn read_info(root: &Path, id: &str) -> Result<Option<GameInfo>, ()> {
    let file = match fs::File::open(root.join(format!("goggame-{id}.info"))) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    let mut data = Vec::new();
    file.take(MAX_INFO_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| ())?;
    if data.len() as u64 > MAX_INFO_BYTES {
        return Err(());
    }
    parse_info(&data).map(Some).ok_or(())
}

fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

/// DOSBox and ScummVM run many games; GOG ships a copy with each game.
fn emulator_file(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("dosbox") || name.starts_with("scummvm")
}

/// Leaves out what isn't the game itself: uninstallers, installers, GOG
/// GALAXY helpers, and DOSBox and ScummVM, which run many games.
pub(super) fn game_executable(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    !emulator_file(&name)
        && !["unins", "setup", "redist", "prereq", "crashreport"]
            .iter()
            .any(|part| name.contains(part))
        && ![
            "galaxyclient",
            "galaxycommunication",
            "galaxyoverlay",
            "galaxypeer",
            "galaxyupdater",
        ]
        .iter()
        .any(|helper| name.starts_with(helper))
}

/// A path GOG wrote relative to the game folder, kept inside it.
fn inside(root: &Path, relative: &str) -> Option<PathBuf> {
    let path = Path::new(relative);
    path.components()
        .all(|part| matches!(part, Component::Normal(_) | Component::CurDir))
        .then(|| root.join(path))
}

fn install_root(location: &str) -> Option<PathBuf> {
    let trimmed = location.trim().trim_end_matches(['\\', '/']);
    let path = PathBuf::from(trimmed);
    let valid = !trimmed.contains('\0')
        && path.is_absolute()
        && !path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        // Never a drive root.
        && path.parent().is_some();
    (valid && path.is_dir()).then_some(path)
}

/// One GOG game installed here.
struct Install {
    id: String,
    name: String,
    root: PathBuf,
    info: GameInfo,
}

/// The games the uninstall entries name. A file that could not be read adds
/// a warning: then a missing game proves nothing.
fn installs(list: &UninstallList, warnings: &mut Vec<String>) -> Vec<Install> {
    if !list.complete {
        warnings.push("Could not read the GOG install list.".into());
    }
    let mut seen = BTreeSet::new();
    let mut found = Vec::new();
    for entry in &list.entries {
        let Some(id) = gog_install_id(entry) else {
            continue;
        };
        if seen.contains(id) {
            continue;
        }
        let Some(root) = entry.install_location.as_deref().and_then(install_root) else {
            continue;
        };
        match read_info(&root, id) {
            Ok(Some(info)) if info.is_game(id) => {
                seen.insert(id.to_owned());
                let name = [info.name.as_deref(), entry.display_name.as_deref()]
                    .into_iter()
                    .flatten()
                    .map(str::trim)
                    .find(|name| !name.is_empty())
                    .unwrap_or(id)
                    .chars()
                    .take(256)
                    .collect();
                found.push(Install {
                    id: id.to_owned(),
                    name,
                    root,
                    info,
                });
            }
            Ok(_) => {}
            Err(()) => warnings.push("Could not read a GOG game's install file.".into()),
        }
    }
    found
}

/// The primary play task's file, when it is a game file.
fn declared_executable(install: &Install) -> Option<ScannedExecutable> {
    let relative = install.info.start_path()?;
    if !game_executable(file_name(relative)) {
        return None;
    }
    let program = inside(&install.root, relative)?;
    exe_scan::executable_from_path(
        &exe_scan::path_string(&install.root),
        &exe_scan::path_string(&program),
    )
    .ok()
}

fn find_executables(
    install: &Install,
    deadline: Instant,
) -> Result<Vec<ScannedExecutable>, String> {
    let (scanned, capped) = exe_scan::scan_executables(&install.root, deadline);
    let mut executables: Vec<_> = scanned
        .into_iter()
        .filter(|candidate| game_executable(&candidate.file_name))
        .collect();
    if let Some(mut declared) = declared_executable(install) {
        match executables.iter_mut().find(|item| {
            item.relative_path
                .eq_ignore_ascii_case(&declared.relative_path)
        }) {
            Some(item) => item.declared = true,
            None => {
                // The walk is capped; the declared file may lie beyond it.
                declared.declared = true;
                executables.insert(0, declared);
            }
        }
    }
    if executables.is_empty() {
        let game = &install.name;
        return Err(if capped {
            format!("The file scan for {game} was incomplete. Scan again to retry.")
        } else {
            format!("{game} has no game file yet. Finish installing it, then scan again.")
        });
    }
    Ok(executables)
}

fn scan_entries(list: &UninstallList, with_executables: bool, deadline: Instant) -> ScanResult {
    let mut warnings = Vec::new();
    let mut games = Vec::new();
    for install in installs(list, &mut warnings) {
        if with_executables && Instant::now() >= deadline {
            warnings.push("GOG scan reached its time limit. Scan again to retry.".into());
            break;
        }
        let runs_in_emulator = install
            .info
            .start_path()
            .is_some_and(|path| emulator_file(file_name(path)));
        let executables = if with_executables && !runs_in_emulator {
            match find_executables(&install, deadline) {
                Ok(executables) => executables,
                Err(error) => {
                    warnings.push(error);
                    continue;
                }
            }
        } else {
            Vec::new()
        };
        games.push(ScannedGame {
            install_path: Some(exe_scan::path_string(&install.root)),
            external_id: install.id,
            name: Some(install.name),
            // GOG keeps playtime in the account, not on this PC.
            playtime_seconds: None,
            has_played_evidence: Some(false),
            last_played_unix: None,
            installed: true,
            executables,
            runs_in_emulator,
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

/// What Play runs: the primary play task, as GOG wrote it.
#[derive(Debug, PartialEq)]
struct StartFile {
    program: PathBuf,
    arguments: Option<String>,
    working_dir: PathBuf,
}

fn start_file(install: &Install) -> Result<StartFile, LaunchError> {
    let invalid = || {
        LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "PlayCounter can only start .exe files with a full Windows path.",
        )
    };
    let task = install.info.primary_task().ok_or_else(invalid)?;
    let relative = task.path.as_deref().map(str::trim).ok_or_else(invalid)?;
    if !relative.to_ascii_lowercase().ends_with(".exe") {
        return Err(invalid());
    }
    let program = inside(&install.root, relative).ok_or_else(invalid)?;
    let working_dir = match task
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    {
        Some(dir) => inside(&install.root, dir).ok_or_else(invalid)?,
        None => install.root.clone(),
    };
    Ok(StartFile {
        program,
        arguments: task
            .arguments
            .clone()
            .filter(|arguments| !arguments.trim().is_empty()),
        working_dir,
    })
}

pub fn detect() -> ProviderStatus {
    ProviderStatus {
        provider: "gog",
        // Account imports also work without GOG GALAXY or any installed game.
        available: cfg!(windows),
        root_path: None,
        checked_paths: Vec::new(),
    }
}

pub fn scan() -> Result<ScanResult, String> {
    if !cfg!(windows) {
        return Err("GOG import is available on Windows.".into());
    }
    Ok(scan_entries(
        &uninstall_entries(),
        true,
        Instant::now() + exe_scan::EXE_WALK_BUDGET,
    ))
}

/// GOG's own record of what is installed, read once per check.
pub struct InstalledApps {
    ids: BTreeSet<String>,
    /// False when some install could not be read.
    complete: bool,
}

impl InstalledApps {
    pub fn read() -> Self {
        Self::from_list(&uninstall_entries())
    }

    fn from_list(list: &UninstallList) -> Self {
        let mut warnings = Vec::new();
        let ids = installs(list, &mut warnings)
            .into_iter()
            .map(|install| install.id)
            .collect();
        Self {
            ids,
            complete: warnings.is_empty(),
        }
    }

    /// `Some(true)` when GOG lists the game as installed, `Some(false)` when
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
    let mut warnings = Vec::new();
    installs(&uninstall_entries(), &mut warnings)
        .into_iter()
        .map(|install| InstalledGame {
            install_path: exe_scan::path_string(&install.root),
            external_id: install.id,
        })
        .collect()
}

/// Play: the game's own start file. GOG games need no launcher.
pub fn launch_app(external_id: &str, mode: &str) -> Result<(), LaunchError> {
    if !cfg!(windows) {
        return Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "GOG launching is only available on Windows.",
        ));
    }
    if !valid_id(external_id) {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "Invalid GOG game id.",
        ));
    }
    if mode != "play" {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "Invalid GOG launch mode.",
        ));
    }
    spawn(&start_file(&find_install(
        &uninstall_entries(),
        external_id,
    )?)?)
}

/// The install Play starts. Only a game missing from a list that was read in
/// full is gone; the app then forgets its install.
fn find_install(list: &UninstallList, id: &str) -> Result<Install, LaunchError> {
    let mut warnings = Vec::new();
    installs(list, &mut warnings)
        .into_iter()
        .find(|install| install.id == id)
        .ok_or_else(|| {
            if warnings.is_empty() {
                LaunchError::new(
                    LaunchErrorKind::NotFound,
                    "GOG no longer has this game installed.",
                )
            } else {
                LaunchError::new(
                    LaunchErrorKind::Unreadable,
                    "Could not read the GOG install list.",
                )
            }
        })
}

#[cfg(windows)]
fn spawn(start: &StartFile) -> Result<(), LaunchError> {
    use std::{os::windows::process::CommandExt, process::Stdio};
    let mut command = std::process::Command::new(&start.program);
    if let Some(arguments) = &start.arguments {
        // GOG writes one command line; pass it on unchanged.
        command.raw_arg(arguments);
    }
    command
        .current_dir(&start.working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(crate::launch::map_spawn_error)
}

#[cfg(not(windows))]
fn spawn(_: &StartFile) -> Result<(), LaunchError> {
    Err(LaunchError::new(
        LaunchErrorKind::Unsupported,
        "GOG launching is only available on Windows.",
    ))
}

#[cfg(not(windows))]
fn uninstall_entries() -> UninstallList {
    UninstallList {
        entries: Vec::new(),
        complete: false,
    }
}

#[cfg(windows)]
fn uninstall_entries() -> UninstallList {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS},
        System::Registry::*,
    };
    const MAX_ENTRIES: u32 = 8192;
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
    /// `Ok(None)`: there is no such key.
    fn open(parent: HKEY, name: &str) -> Result<Option<Key>, ()> {
        let mut key = ptr::null_mut();
        match unsafe { RegOpenKeyExW(parent, wide(name).as_ptr(), 0, KEY_READ, &mut key) } {
            ERROR_SUCCESS => Ok(Some(Key(key))),
            ERROR_FILE_NOT_FOUND => Ok(None),
            _ => Err(()),
        }
    }
    /// `Ok(None)`: there is no such text.
    fn value(key: &Key, name: &str) -> Result<Option<String>, ()> {
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
        match status {
            ERROR_SUCCESS if kind == REG_SZ => Ok(Some(String::from_utf16_lossy(
                &data[..data.iter().position(|v| *v == 0).unwrap_or(data.len())],
            ))),
            ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => Ok(None),
            _ => Err(()),
        }
    }
    let mut list = UninstallList {
        entries: Vec::new(),
        complete: true,
    };
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
        let root = match open(hive, path) {
            Ok(Some(root)) => root,
            Ok(None) => continue,
            Err(()) => {
                list.complete = false;
                continue;
            }
        };
        let mut index = 0;
        loop {
            if index == MAX_ENTRIES {
                list.complete = false;
                break;
            }
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
            index += 1;
            if status == ERROR_NO_MORE_ITEMS {
                break;
            }
            if status != ERROR_SUCCESS {
                list.complete = false;
                continue;
            }
            let key_name = String::from_utf16_lossy(&name[..size as usize]);
            // Only these can be GOG's; other programs' entries never matter.
            if id_of_key(&key_name).is_none() {
                continue;
            }
            let key = match open(root.0, &key_name) {
                Ok(Some(key)) => key,
                // Uninstalled while reading.
                Ok(None) => continue,
                Err(()) => {
                    list.complete = false;
                    continue;
                }
            };
            match (
                value(&key, "Publisher"),
                value(&key, "DisplayName"),
                value(&key, "InstallLocation"),
            ) {
                (Ok(publisher), Ok(display_name), Ok(install_location)) => {
                    list.entries.push(UninstallEntry {
                        key: key_name,
                        publisher,
                        display_name,
                        install_location,
                    })
                }
                _ => list.complete = false,
            }
        }
    }
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;

    // The real files of the two GOG games on the development PC.
    const FALLOUT_INFO: &str = "\r\n{\r\n\t\"version\" : 1,\r\n\t\"gameId\" : \"1\",\r\n\t\"rootGameId\" : \"1\",\r\n\t\"standalone\" : true,\r\n\t\"dependencyGameId\" : \"\",\r\n\t\"language\"         : \"english\",\r\n\t\"name\"             : \"Fallout\",\r\n\t\"playTasks\"        : [\r\n\t\t{\r\n\t\t\t\"isPrimary\" : true,\r\n\t\t\t\"type\"      : \"FileTask\",\r\n\t\t\t\"path\"      : \"FalloutLauncher.exe\",\r\n\t\t\t\"workingDir\" : \"\"\r\n\t\t},\r\n\t\t{\r\n\t\t\t\"name\" : \"Reference Card\",\r\n\t\t\t\"type\" : \"FileTask\",\r\n\t\t\t\"path\" : \"RefCard.pdf\",\r\n\t\t\t\"workingDir\" : \"\"\r\n\t\t},\r\n\t\t{\r\n\t\t\t\"name\" : \"HI-Res Config\",\r\n\t\t\t\"type\" : \"FileTask\",\r\n\t\t\t\"path\" : \"f1_res_Config.exe\",\r\n\t\t\t\"workingDir\" : \"\"\r\n\t\t},\r\n\t\t{\r\n\t\t\t\"name\" : \"Fallout (Classic)\",\r\n\t\t\t\"type\" : \"FileTask\",\r\n\t\t\t\"path\" : \"falloutw.exe\",\r\n\t\t\t\"workingDir\" : \"\"\r\n\t\t}\r\n\t],\r\n\t\"supportTasks\"     : [\r\n\t\t{\r\n\t\t\t\"name\" : \"Support\",\r\n\t\t\t\"type\" : \"URLTask\",\r\n\t\t\t\"link\" : \"http://www.gog.com/en/support/fallout\"\r\n\t\t},\r\n\t\t{\r\n\t\t\t\"name\" : \"Manual\",\r\n\t\t\t\"type\" : \"FileTask\",\r\n\t\t\t\"path\" : \"Manual.pdf\",\r\n\t\t\t\"workingDir\" : \"\"\r\n\t\t}\r\n\t]\r\n}";
    const RIFTBREAKER_INFO: &str = r#"{
    "buildId": "59566604350908871",
    "clientId": "53617145805957396",
    "gameId": "2147483111",
    "language": "English",
    "languages": [
        "en-US"
    ],
    "name": "The Riftbreaker",
    "osBitness": [
        "64"
    ],
    "playTasks": [
        {
            "category": "game",
            "isPrimary": true,
            "languages": [
                "en-US"
            ],
            "name": "The Riftbreaker",
            "osBitness": [
                "64"
            ],
            "path": "bin/riftbreaker_win_release.exe",
            "type": "FileTask",
            "workingDir": "bin"
        },
        {
            "category": "launcher",
            "languages": [
                "en-US"
            ],
            "name": "Configure game options",
            "osBitness": [
                "64"
            ],
            "path": "bin/Launcher.exe",
            "type": "FileTask",
            "workingDir": "bin"
        },
        {
            "category": "game",
            "isHidden": true,
            "languages": [
                "en-US"
            ],
            "name": "Configure game options - launcher process bin/riftbreaker_win_release_exe",
            "osBitness": [
                "64"
            ],
            "path": "bin/riftbreaker_win_release.exe",
            "type": "FileTask"
        }
    ],
    "rootGameId": "2147483111",
    "version": 1
}"#;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("playcounter-gog-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn file(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![0u8; bytes]).unwrap();
    }

    fn entry(key: &str, publisher: &str, name: &str, location: &Path) -> UninstallEntry {
        UninstallEntry {
            key: key.into(),
            publisher: Some(publisher.into()),
            display_name: Some(name.into()),
            // Inno Setup writes the folder with a trailing backslash.
            install_location: Some(format!("{}\\", location.to_string_lossy())),
        }
    }

    /// Fallout and The Riftbreaker as they are installed on the development PC.
    fn real_installs(root: &Path) -> Vec<UninstallEntry> {
        let fallout = root.join("GOG Games").join("Fallout");
        fs::create_dir_all(&fallout).unwrap();
        fs::write(fallout.join("goggame-1.info"), FALLOUT_INFO).unwrap();
        for exe in [
            "FalloutLauncher.exe",
            "falloutw.exe",
            "falloutwHR.exe",
            "f1_res_Config.exe",
        ] {
            file(&fallout.join(exe), 64 * 1024);
        }
        file(&fallout.join("unins000.exe"), 64 * 1024);
        let riftbreaker = root.join("GOG Games").join("The Riftbreaker");
        fs::create_dir_all(&riftbreaker).unwrap();
        fs::write(
            riftbreaker.join("goggame-2147483111.info"),
            RIFTBREAKER_INFO,
        )
        .unwrap();
        file(
            &riftbreaker.join("bin").join("riftbreaker_win_release.exe"),
            256 * 1024,
        );
        file(&riftbreaker.join("bin").join("Launcher.exe"), 64 * 1024);
        file(&riftbreaker.join("unins000.exe"), 64 * 1024);
        vec![
            entry("1_is1", "GOG.com", "Fallout", &fallout),
            entry("2147483111_is1", "GOG.com", "The Riftbreaker", &riftbreaker),
            // GOG GALAXY's own entry.
            entry(
                "{7258BA11-600C-430E-A759-27E2C691A335}_is1",
                "GOG.com",
                "GOG GALAXY",
                &root.join("GOG Galaxy"),
            ),
        ]
    }

    /// Entries Windows gave in full.
    fn listed(entries: Vec<UninstallEntry>) -> UninstallList {
        UninstallList {
            entries,
            complete: true,
        }
    }

    fn later() -> Instant {
        Instant::now() + Duration::from_secs(30)
    }

    fn info(json: &str) -> GameInfo {
        parse_info(json.as_bytes()).unwrap()
    }

    fn install(root: &Path, id: &str, json: &str) -> Install {
        Install {
            id: id.into(),
            name: "Game".into(),
            root: root.to_path_buf(),
            info: info(json),
        }
    }

    #[test]
    fn gog_ids_are_one_to_ten_digits() {
        for id in ["1", "1213504814", "2147483111"] {
            assert!(valid_id(id), "{id}");
        }
        for id in ["", "0", "01", "12345678901", "a1", "1 ", "-1", "1.0"] {
            assert!(!valid_id(id), "{id}");
        }
    }

    #[test]
    fn only_numbered_entries_from_gog_are_gog_installs() {
        let root = temp_root();
        let entries = real_installs(&root);
        assert_eq!(gog_install_id(&entries[0]), Some("1"));
        assert_eq!(gog_install_id(&entries[1]), Some("2147483111"));
        // GOG GALAXY itself.
        assert_eq!(gog_install_id(&entries[2]), None);
        let other = entry("42_is1", "Someone Else", "Other", &root);
        assert_eq!(gog_install_id(&other), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finds_both_real_installs_with_their_start_files() {
        let root = temp_root();
        let result = scan_entries(&listed(real_installs(&root)), true, later());
        assert!(!result.partial, "{:?}", result.warnings);
        let found: Vec<_> = result
            .games
            .iter()
            .map(|game| (game.external_id.as_str(), game.name.as_deref()))
            .collect();
        assert_eq!(
            found,
            vec![
                ("1", Some("Fallout")),
                ("2147483111", Some("The Riftbreaker"))
            ]
        );
        for game in &result.games {
            assert!(game.installed);
            assert_eq!(game.playtime_seconds, None);
            assert_eq!(game.has_played_evidence, Some(false));
            assert!(!game.runs_in_emulator);
        }
        let declared = |index: usize| {
            result.games[index]
                .executables
                .iter()
                .filter(|item| item.declared)
                .map(|item| item.relative_path.replace('\\', "/"))
                .collect::<Vec<_>>()
        };
        assert_eq!(declared(0), vec!["FalloutLauncher.exe"]);
        assert_eq!(declared(1), vec!["bin/riftbreaker_win_release.exe"]);
        // The install folder is the game's own folder.
        assert!(result.games[1]
            .install_path
            .as_deref()
            .unwrap()
            .ends_with("The Riftbreaker"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dlc_files_without_a_start_file_and_missing_folders_are_not_games() {
        let root = temp_root();
        let mut entries = real_installs(&root);
        // DLC: its file names another game as the root.
        let dlc = root.join("GOG Games").join("Expansion");
        fs::create_dir_all(&dlc).unwrap();
        fs::write(
            dlc.join("goggame-1500.info"),
            r#"{"gameId":"1500","rootGameId":"1","name":"Expansion","playTasks":[{"isPrimary":true,"type":"FileTask","path":"x.exe"}]}"#,
        )
        .unwrap();
        file(&dlc.join("x.exe"), 64 * 1024);
        entries.push(entry("1500_is1", "GOG.com", "Expansion", &dlc));
        // No primary play task: DLC too.
        let extra = root.join("GOG Games").join("Extra");
        fs::create_dir_all(&extra).unwrap();
        fs::write(
            extra.join("goggame-1600.info"),
            r#"{"gameId":"1600","rootGameId":"1600","name":"Extra","playTasks":[{"type":"FileTask","path":"y.exe"}]}"#,
        )
        .unwrap();
        file(&extra.join("y.exe"), 64 * 1024);
        entries.push(entry("1600_is1", "GOG.com", "Extra", &extra));
        // Uninstalled by hand: the folder is gone.
        entries.push(entry("1700_is1", "GOG.com", "Gone", &root.join("Gone")));

        let result = scan_entries(&listed(entries), true, later());
        let ids: Vec<_> = result
            .games
            .iter()
            .map(|game| game.external_id.as_str())
            .collect();
        assert_eq!(ids, vec!["1", "2147483111"]);
        assert!(!result.partial);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn an_unreadable_install_file_makes_the_scan_incomplete() {
        let root = temp_root();
        let mut entries = real_installs(&root);
        let broken = root.join("GOG Games").join("Broken");
        fs::create_dir_all(&broken).unwrap();
        fs::write(broken.join("goggame-1800.info"), "not json").unwrap();
        entries.push(entry("1800_is1", "GOG.com", "Broken", &broken));
        let list = listed(entries);

        let result = scan_entries(&list, false, later());
        assert_eq!(result.games.len(), 2);
        assert!(result.partial);
        assert_eq!(result.warnings.len(), 1);
        let apps = InstalledApps::from_list(&list);
        assert_eq!(apps.state("1"), Some(true));
        // Something could not be read, so a missing game proves nothing.
        assert_eq!(apps.state("1700"), None);
        let readable = listed(list.entries[..2].to_vec());
        assert_eq!(
            InstalledApps::from_list(&readable).state("1700"),
            Some(false)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn an_uninstall_list_windows_gave_only_in_part_makes_the_scan_incomplete() {
        let root = temp_root();
        let list = UninstallList {
            entries: real_installs(&root),
            complete: false,
        };

        let result = scan_entries(&list, false, later());
        // What could be read still counts.
        assert_eq!(result.games.len(), 2);
        assert!(result.partial);
        assert_eq!(
            result.warnings,
            vec!["Could not read the GOG install list."]
        );
        let apps = InstalledApps::from_list(&list);
        assert_eq!(apps.state("2147483111"), Some(true));
        assert_eq!(apps.state("1700"), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn play_says_a_game_is_gone_only_when_the_whole_list_was_read() {
        let root = temp_root();
        let entries = real_installs(&root);
        let found = |list: &UninstallList, id: &str| {
            find_install(list, id)
                .map(|install| install.root)
                .map_err(|error| error.kind)
        };
        assert_eq!(
            found(&listed(entries.clone()), "2147483111"),
            Ok(root.join("GOG Games").join("The Riftbreaker"))
        );
        // Uninstalled: the app may forget the install.
        assert_eq!(
            found(&listed(entries.clone()), "1700"),
            Err(LaunchErrorKind::NotFound)
        );
        // Windows gave only part of the list: PlayCounter cannot tell.
        let partial = UninstallList {
            entries: entries.clone(),
            complete: false,
        };
        assert_eq!(found(&partial, "1700"), Err(LaunchErrorKind::Unreadable));
        // The missing game's own file may be the one that could not be read.
        let broken = root.join("GOG Games").join("Broken");
        fs::create_dir_all(&broken).unwrap();
        fs::write(broken.join("goggame-1800.info"), "not json").unwrap();
        let mut with_broken = entries;
        with_broken.push(entry("1800_is1", "GOG.com", "Broken", &broken));
        assert_eq!(
            found(&listed(with_broken), "1800"),
            Err(LaunchErrorKind::Unreadable)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_file_with_a_byte_order_mark_still_reads() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(RIFTBREAKER_INFO.as_bytes());
        assert_eq!(
            parse_info(&bytes).unwrap().name.as_deref(),
            Some("The Riftbreaker")
        );
    }

    #[test]
    fn the_file_list_leaves_out_uninstallers_galaxy_helpers_dosbox_and_scummvm() {
        for name in [
            "unins000.exe",
            "setup.exe",
            "GalaxyPeer.exe",
            "DOSBox.exe",
            "dosbox-x.exe",
            "scummvm.exe",
            "vcredist_x64.exe",
        ] {
            assert!(!game_executable(name), "{name}");
        }
        for name in [
            "FalloutLauncher.exe",
            "falloutwHR.exe",
            "riftbreaker_win_release.exe",
        ] {
            assert!(game_executable(name), "{name}");
        }
        let root = temp_root();
        let result = scan_entries(&listed(real_installs(&root)), true, later());
        assert!(result
            .games
            .iter()
            .flat_map(|game| &game.executables)
            .all(|item| !item.file_name.eq_ignore_ascii_case("unins000.exe")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_game_gog_runs_in_dosbox_is_installed_without_a_game_file() {
        let root = temp_root();
        let game = root.join("GOG Games").join("DOOM");
        fs::create_dir_all(&game).unwrap();
        fs::write(
            game.join("goggame-1435848814.info"),
            r#"{"gameId":"1435848814","rootGameId":"1435848814","name":"DOOM","playTasks":[{"isPrimary":true,"type":"FileTask","path":"DOSBOX\\DOSBox.exe","workingDir":"DOSBOX","arguments":"-conf \"..\\dosboxDOOM.conf\" -noconsole -c \"exit\""}]}"#,
        )
        .unwrap();
        file(&game.join("DOSBOX").join("DOSBox.exe"), 64 * 1024);
        file(&game.join("DOOM.EXE"), 64 * 1024);

        let result = scan_entries(
            &listed(vec![entry("1435848814_is1", "GOG.com", "DOOM", &game)]),
            true,
            later(),
        );
        assert_eq!(result.games.len(), 1);
        let doom = &result.games[0];
        assert!(doom.installed);
        assert!(doom.runs_in_emulator);
        assert!(doom.executables.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hidden_and_non_primary_tasks_never_start_the_game() {
        let root = temp_root();
        let hidden_primary = install(
            &root,
            "5",
            r#"{"gameId":"5","playTasks":[{"isPrimary":true,"isHidden":true,"type":"FileTask","path":"hidden.exe"},{"isPrimary":true,"type":"FileTask","path":"game.exe"}]}"#,
        );
        assert_eq!(
            start_file(&hidden_primary).unwrap().program,
            root.join("game.exe")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn play_starts_the_primary_task_with_its_arguments_and_working_folder() {
        let root = temp_root();
        let riftbreaker = install(&root, "2147483111", RIFTBREAKER_INFO);
        assert_eq!(
            start_file(&riftbreaker).unwrap(),
            StartFile {
                program: root.join("bin").join("riftbreaker_win_release.exe"),
                arguments: None,
                working_dir: root.join("bin"),
            }
        );
        // No working folder: the game's folder.
        let fallout = install(&root, "1", FALLOUT_INFO);
        assert_eq!(
            start_file(&fallout).unwrap(),
            StartFile {
                program: root.join("FalloutLauncher.exe"),
                arguments: None,
                working_dir: root.clone(),
            }
        );
        let dosbox = install(
            &root,
            "6",
            r#"{"gameId":"6","playTasks":[{"isPrimary":true,"type":"FileTask","path":"DOSBOX\\DOSBox.exe","workingDir":"DOSBOX","arguments":"-conf \"..\\dosboxGAME.conf\" -c \"exit\""}]}"#,
        );
        assert_eq!(
            start_file(&dosbox).unwrap(),
            StartFile {
                program: root.join("DOSBOX").join("DOSBox.exe"),
                arguments: Some("-conf \"..\\dosboxGAME.conf\" -c \"exit\"".into()),
                working_dir: root.join("DOSBOX"),
            }
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn play_refuses_start_files_outside_the_game_folder_or_without_exe() {
        let root = temp_root();
        for task in [
            r#"{"isPrimary":true,"type":"FileTask","path":"..\\other\\game.exe"}"#,
            r#"{"isPrimary":true,"type":"FileTask","path":"C:\\Windows\\notepad.exe"}"#,
            r#"{"isPrimary":true,"type":"FileTask","path":"game.exe","workingDir":"..\\.."}"#,
            r#"{"isPrimary":true,"type":"FileTask","path":"manual.pdf"}"#,
        ] {
            let json = format!(r#"{{"gameId":"7","playTasks":[{task}]}}"#);
            assert!(start_file(&install(&root, "7", &json)).is_err(), "{task}");
        }
        let _ = fs::remove_dir_all(root);
    }
}
