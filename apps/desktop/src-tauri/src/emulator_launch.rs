use crate::{
    launch::{
        is_absolute_windows_path, is_missing_at, map_spawn_error, LaunchError, LaunchErrorKind,
        LaunchPathReport, LaunchPathStatus,
    },
    process::{self, ProcessScanner, ProcessSnapshot},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

#[cfg(windows)]
use std::process::{Command, Stdio};

use crate::process::emulator::{
    CEMU_CONTENT_EXTENSIONS, DOLPHIN_CONTENT_EXTENSIONS, MGBA_CONTENT_EXTENSIONS,
    PCSX2_CONTENT_EXTENSIONS,
};
const RPCS3_EXTENSIONS: &[&str] = &["bin", "self", "elf", "iso"];
const PPSSPP_EXTENSIONS: &[&str] = &["iso", "cso", "chd", "pbp", "elf", "prx"];
const DUCKSTATION_EXTENSIONS: &[&str] = &[
    "cue", "bin", "img", "iso", "chd", "pbp", "ecm", "mds", "ccd", "m3u",
];
const SWITCH_EXTENSIONS: &[&str] = &["nsp", "xci", "nca", "nro", "nso"];
const DOSBOX_EXTENSIONS: &[&str] = &["conf", "exe", "com", "bat"];

struct EmulatorLaunchAdapter {
    id: &'static str,
    label: &'static str,
    extensions: &'static [&'static str],
    arguments: fn(&Path) -> Vec<OsString>,
    is_idle: fn(&ProcessSnapshot) -> bool,
}

fn dosbox_arguments(content_path: &Path) -> Vec<OsString> {
    let path = content_path.as_os_str().to_os_string();
    if content_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("conf"))
    {
        vec![OsString::from("-conf"), path, OsString::from("-exit")]
    } else {
        vec![path, OsString::from("-exit")]
    }
}

fn dolphin_arguments(content_path: &Path) -> Vec<OsString> {
    vec![
        OsString::from("--batch"),
        OsString::from(format!("--exec={}", content_path.to_string_lossy())),
    ]
}

fn is_dolphin_idle(process: &ProcessSnapshot) -> bool {
    if process
        .open_files
        .as_ref()
        .is_some_and(|files| !files.is_empty())
    {
        return false;
    }
    let Some(title) = process.window_title.as_deref().map(str::trim) else {
        return false;
    };
    let mut parts = title.split_whitespace();
    if !parts
        .next()
        .is_some_and(|part| part.eq_ignore_ascii_case("dolphin"))
    {
        return false;
    }
    let mut remainder = parts.collect::<Vec<_>>();
    if remainder
        .first()
        .is_some_and(|part| part.eq_ignore_ascii_case("emulator"))
    {
        remainder.remove(0);
    }
    remainder.is_empty()
        || (remainder.len() == 1
            && remainder[0]
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character)))
}

fn is_dosbox_idle(process: &ProcessSnapshot) -> bool {
    let Some(title) = process.window_title.as_deref() else {
        return false;
    };
    title
        .to_ascii_lowercase()
        .rsplit_once("program:")
        .map(|(_, program)| program.trim() == "dosbox")
        .unwrap_or(false)
}

/// "mGBA - <version>" is mGBA's title without a game. An instance started with a
/// ROM may only have its dynamic title turned off, so it is never closed.
fn is_mgba_idle(process: &ProcessSnapshot) -> bool {
    let started_with_rom = process.command_line.as_ref().is_some_and(|args| {
        args.iter().any(|arg| {
            let lower = file_name(arg).to_ascii_lowercase();
            MGBA_CONTENT_EXTENSIONS
                .iter()
                .any(|extension| lower.ends_with(&format!(".{extension}")))
        })
    });
    let Some(title) = process.window_title.as_deref().map(str::trim) else {
        return false;
    };
    let version = match title.get(..7) {
        Some(prefix) if prefix.eq_ignore_ascii_case("mgba - ") => &title[7..],
        _ => return false,
    };
    !started_with_rom && !version.is_empty() && !version.contains(char::is_whitespace)
}

/// True when an argument names a content file, i.e. the instance was started
/// with a game and may not show it in its title yet.
fn started_with_content(process: &ProcessSnapshot, extensions: &[&str]) -> bool {
    process.command_line.as_ref().is_some_and(|args| {
        args.iter().any(|arg| {
            let lower = file_name(arg).to_ascii_lowercase();
            extensions
                .iter()
                .any(|extension| lower.ends_with(&format!(".{extension}")))
        })
    })
}

fn trimmed_title(process: &ProcessSnapshot) -> Option<&str> {
    process.window_title.as_deref().map(str::trim)
}

/// The main window "RPCS3 <version> | <branch>" without a game window.
fn is_rpcs3_idle(process: &ProcessSnapshot) -> bool {
    !started_with_content(process, RPCS3_EXTENSIONS)
        && trimmed_title(process).is_some_and(|title| {
            title
                .get(..6)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("rpcs3 "))
        })
}

/// "PPSSPP <version>" (optionally "Gold", " (debug)", " (instance: N)").
fn is_ppsspp_idle(process: &ProcessSnapshot) -> bool {
    !started_with_content(process, PPSSPP_EXTENSIONS)
        && trimmed_title(process).is_some_and(|title| {
            let lower = title.to_ascii_lowercase();
            lower.starts_with("ppsspp ") && !lower.contains(" - ")
        })
}

/// "DuckStation <version>" with no disc file open.
fn is_duckstation_idle(process: &ProcessSnapshot) -> bool {
    if process
        .open_files
        .as_ref()
        .is_some_and(|files| !files.is_empty())
    {
        return false;
    }
    !started_with_content(process, DUCKSTATION_EXTENSIONS)
        && trimmed_title(process).is_some_and(|title| {
            let mut parts = title.split_whitespace();
            parts
                .next()
                .is_some_and(|part| part.eq_ignore_ascii_case("duckstation"))
                && parts.next().is_some()
                && parts.all(|part| part.starts_with('['))
        })
}

/// "Ryujinx <version>" or "Ryujinx Canary <version>".
fn is_ryujinx_idle(process: &ProcessSnapshot) -> bool {
    !started_with_content(process, SWITCH_EXTENSIONS)
        && trimmed_title(process).is_some_and(|title| {
            let parts = title.split_whitespace().collect::<Vec<_>>();
            match parts.as_slice() {
                [name, _] => name.eq_ignore_ascii_case("ryujinx"),
                [name, channel, _] => {
                    name.eq_ignore_ascii_case("ryujinx") && channel.eq_ignore_ascii_case("canary")
                }
                _ => false,
            }
        })
}

/// "Eden | <version> | <compiler>"; a running game adds more segments.
fn is_eden_idle(process: &ProcessSnapshot) -> bool {
    !started_with_content(process, SWITCH_EXTENSIONS)
        && trimmed_title(process).is_some_and(|title| {
            let segments = title.split(" | ").collect::<Vec<_>>();
            segments.len() == 3
                && (segments[0].eq_ignore_ascii_case("eden")
                    || segments[0].eq_ignore_ascii_case("eden nightly"))
        })
}

/// "Cemu <version>" is Cemu's title without a game. It is also the title right
/// after start-up, so an instance started with a game is never closed.
fn is_cemu_idle(process: &ProcessSnapshot) -> bool {
    let started_with_game = process.command_line.as_ref().is_some_and(|args| {
        args.iter().any(|arg| {
            let lower = arg.to_ascii_lowercase();
            ["-g", "--game", "-t", "--title-id"]
                .iter()
                .any(|option| lower == *option || lower.starts_with(&format!("{option}=")))
        })
    });
    let Some(title) = process.window_title.as_deref().map(str::trim) else {
        return false;
    };
    let version = match title.get(..5) {
        Some(prefix) if prefix.eq_ignore_ascii_case("cemu ") => &title[5..],
        _ => return false,
    };
    !started_with_game && !version.is_empty() && !version.contains(char::is_whitespace)
}

static EMULATOR_LAUNCH_ADAPTERS: &[EmulatorLaunchAdapter] = &[
    EmulatorLaunchAdapter {
        id: "dosbox",
        label: "DOSBox",
        extensions: DOSBOX_EXTENSIONS,
        arguments: dosbox_arguments,
        is_idle: is_dosbox_idle,
    },
    EmulatorLaunchAdapter {
        id: "dolphin",
        label: "Dolphin",
        extensions: DOLPHIN_CONTENT_EXTENSIONS,
        arguments: dolphin_arguments,
        is_idle: is_dolphin_idle,
    },
    EmulatorLaunchAdapter {
        id: "pcsx2",
        label: "PCSX2",
        extensions: PCSX2_CONTENT_EXTENSIONS,
        // A positional boot file works with both Qt and legacy wx builds.
        arguments: |path| vec![path.as_os_str().to_os_string()],
        // A generic PCSX2 window may coexist with a separate game window.
        // Do not close a running instance based on its title alone.
        is_idle: |_| false,
    },
    EmulatorLaunchAdapter {
        id: "mgba",
        label: "mGBA",
        extensions: MGBA_CONTENT_EXTENSIONS,
        // mGBA [options] [game]: one positional ROM path.
        arguments: |path| vec![path.as_os_str().to_os_string()],
        is_idle: is_mgba_idle,
    },
    EmulatorLaunchAdapter {
        id: "cemu",
        label: "Cemu",
        extensions: CEMU_CONTENT_EXTENSIONS,
        arguments: |path| vec![OsString::from("-g"), path.as_os_str().to_os_string()],
        is_idle: is_cemu_idle,
    },
    EmulatorLaunchAdapter {
        id: "rpcs3",
        label: "RPCS3",
        extensions: RPCS3_EXTENSIONS,
        // rpcs3 [options] <boot path>: EBOOT.BIN, (S)ELF or ISO.
        arguments: |path| vec![path.as_os_str().to_os_string()],
        is_idle: is_rpcs3_idle,
    },
    EmulatorLaunchAdapter {
        id: "ppsspp",
        label: "PPSSPP",
        extensions: PPSSPP_EXTENSIONS,
        arguments: |path| vec![path.as_os_str().to_os_string()],
        is_idle: is_ppsspp_idle,
    },
    EmulatorLaunchAdapter {
        id: "duckstation",
        label: "DuckStation",
        extensions: DUCKSTATION_EXTENSIONS,
        // "--" ends the options, so no file name is read as one.
        arguments: |path| vec![OsString::from("--"), path.as_os_str().to_os_string()],
        is_idle: is_duckstation_idle,
    },
    EmulatorLaunchAdapter {
        id: "ryujinx",
        label: "Ryujinx",
        extensions: SWITCH_EXTENSIONS,
        arguments: |path| vec![path.as_os_str().to_os_string()],
        is_idle: is_ryujinx_idle,
    },
    EmulatorLaunchAdapter {
        id: "eden",
        label: "Eden",
        extensions: SWITCH_EXTENSIONS,
        arguments: |path| vec![OsString::from("-g"), path.as_os_str().to_os_string()],
        is_idle: is_eden_idle,
    },
];

fn launch_adapter_for(emulator_id: &str) -> Option<&'static EmulatorLaunchAdapter> {
    EMULATOR_LAUNCH_ADAPTERS
        .iter()
        .find(|adapter| adapter.id == emulator_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorLaunchRequest {
    pub emulator_id: String,
    pub exe_path: String,
    pub content_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorContentPathRequest {
    pub emulator_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EmulatorLaunchOutcome {
    Spawned { pid: u32 },
    HostRunning { instance_count: usize },
    Busy,
}

#[derive(Debug)]
struct EmulatorLaunchPlan {
    emulator_id: String,
    exe_path: PathBuf,
    working_directory: PathBuf,
    arguments: Vec<OsString>,
}

#[derive(Default)]
pub struct EmulatorLaunchGuard {
    active: Mutex<HashSet<String>>,
}

struct GuardLease<'a> {
    guard: &'a EmulatorLaunchGuard,
    emulator_id: String,
}

impl EmulatorLaunchGuard {
    fn try_acquire(&self, emulator_id: &str) -> Option<GuardLease<'_>> {
        let mut active = self.active.lock().ok()?;
        if !active.insert(emulator_id.to_string()) {
            return None;
        }
        Some(GuardLease {
            guard: self,
            emulator_id: emulator_id.to_string(),
        })
    }
}

impl Drop for GuardLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.guard.active.lock() {
            active.remove(&self.emulator_id);
        }
    }
}

trait EmulatorProcessSpawner: Send + Sync {
    fn spawn(&self, plan: &EmulatorLaunchPlan) -> Result<u32, io::Error>;
}

trait EmulatorHostCloser: Send + Sync {
    fn request_close(&self, pids: &HashSet<u32>) -> Result<usize, io::Error>;
}

struct NativeHostCloser;

#[cfg(windows)]
impl EmulatorHostCloser for NativeHostCloser {
    fn request_close(&self, pids: &HashSet<u32>) -> Result<usize, io::Error> {
        Ok(process::emulator::request_close_windows(pids))
    }
}

#[cfg(not(windows))]
impl EmulatorHostCloser for NativeHostCloser {
    fn request_close(&self, _pids: &HashSet<u32>) -> Result<usize, io::Error> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Closing emulator windows is only supported on Windows.",
        ))
    }
}

struct NativeSpawner;

#[cfg(windows)]
impl EmulatorProcessSpawner for NativeSpawner {
    fn spawn(&self, plan: &EmulatorLaunchPlan) -> Result<u32, io::Error> {
        Command::new(&plan.exe_path)
            .args(&plan.arguments)
            .current_dir(&plan.working_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|child| child.id())
    }
}

#[cfg(not(windows))]
impl EmulatorProcessSpawner for NativeSpawner {
    fn spawn(&self, _plan: &EmulatorLaunchPlan) -> Result<u32, io::Error> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Emulator launching is only supported on Windows.",
        ))
    }
}

fn file_name(path: &str) -> &str {
    path.split(['\\', '/'])
        .rfind(|part| !part.is_empty())
        .unwrap_or_default()
}

fn validate_absolute_path(raw: &str) -> Result<PathBuf, LaunchError> {
    let path = raw.trim();
    if path.is_empty()
        || path.contains('\0')
        || !is_absolute_windows_path(path)
        || path.split(['\\', '/']).any(|part| part == "..")
    {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "PlayCounter requires a full Windows path without traversal segments.",
        ));
    }
    Ok(PathBuf::from(path))
}

fn verify_file(path: &Path, label: &str) -> Result<(), LaunchError> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(LaunchError::new(
            LaunchErrorKind::NotAFile,
            format!("The configured {label} is not a file."),
        )),
        Err(error) if is_missing_at(path, &error) => Err(LaunchError::new(
            LaunchErrorKind::NotFound,
            format!("PlayCounter no longer finds the configured {label}."),
        )),
        Err(error) => Err(LaunchError::new(
            LaunchErrorKind::Unreadable,
            format!("Could not read the configured {label}: {error}"),
        )),
    }
}

fn has_supported_extension(adapter: &EmulatorLaunchAdapter, path: &str) -> bool {
    let lower = file_name(path).to_ascii_lowercase();
    adapter
        .extensions
        .iter()
        .any(|extension| lower.ends_with(&format!(".{extension}")))
}

fn plan_emulator_launch(
    request: &EmulatorLaunchRequest,
) -> Result<EmulatorLaunchPlan, LaunchError> {
    let adapter = launch_adapter_for(&request.emulator_id).ok_or_else(|| {
        LaunchError::new(
            LaunchErrorKind::Unsupported,
            "This emulator does not provide a launch adapter yet.",
        )
    })?;

    let exe_path = validate_absolute_path(&request.exe_path)?;
    let exe_name = file_name(&request.exe_path);
    let host = process::emulator::host_for(exe_name).ok_or_else(|| {
        LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "The selected program is not a supported emulator binary.",
        )
    })?;
    if host.id != request.emulator_id {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "The selected program does not match the requested emulator.",
        ));
    }
    verify_file(&exe_path, "emulator program")?;

    let content_path = validate_absolute_path(&request.content_path)?;
    if !has_supported_extension(adapter, &request.content_path) {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            format!(
                "The selected file type is not supported by {}.",
                adapter.label
            ),
        ));
    }
    verify_file(&content_path, "emulator content")?;
    let working_directory = exe_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            LaunchError::new(
                LaunchErrorKind::InvalidPath,
                "The emulator program has no usable parent directory.",
            )
        })?;

    let arguments = (adapter.arguments)(&content_path);
    Ok(EmulatorLaunchPlan {
        emulator_id: request.emulator_id.clone(),
        exe_path,
        working_directory,
        arguments,
    })
}

async fn launch_with_dependencies(
    request: EmulatorLaunchRequest,
    guard: &EmulatorLaunchGuard,
    scanner: &dyn ProcessScanner,
    spawner: &dyn EmulatorProcessSpawner,
    closer: &dyn EmulatorHostCloser,
) -> Result<EmulatorLaunchOutcome, LaunchError> {
    let plan = plan_emulator_launch(&request)?;
    let Some(_lease) = guard.try_acquire(&plan.emulator_id) else {
        return Ok(EmulatorLaunchOutcome::Busy);
    };
    let processes = scanner.scan().await.map_err(|error| {
        LaunchError::new(
            LaunchErrorKind::Unreadable,
            format!("Could not verify whether the emulator is already running: {error}"),
        )
    })?;
    let matching_processes = processes
        .iter()
        .filter(|process| process.emulator_id == Some(plan.emulator_id.as_str()))
        .collect::<Vec<_>>();
    let instance_count = matching_processes.len();
    if instance_count > 0 {
        let adapter = launch_adapter_for(&plan.emulator_id).expect("validated launch adapter");
        if matching_processes
            .iter()
            .any(|process| !(adapter.is_idle)(process))
        {
            return Ok(EmulatorLaunchOutcome::HostRunning { instance_count });
        }

        let idle_pids = matching_processes
            .iter()
            .map(|process| process.pid)
            .collect::<HashSet<_>>();
        let posted = closer.request_close(&idle_pids).map_err(|error| {
            LaunchError::new(
                LaunchErrorKind::Unreadable,
                format!("Could not close the idle emulator window: {error}"),
            )
        })?;
        if posted == 0 {
            return Ok(EmulatorLaunchOutcome::HostRunning { instance_count });
        }

        let mut remaining_count = instance_count;
        for _ in 0..30 {
            let remaining = scanner.scan().await.map_err(|error| {
                LaunchError::new(
                    LaunchErrorKind::Unreadable,
                    format!("Could not verify whether the emulator closed: {error}"),
                )
            })?;
            remaining_count = remaining
                .iter()
                .filter(|process| process.emulator_id == Some(plan.emulator_id.as_str()))
                .count();
            if remaining_count == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if remaining_count > 0 {
            return Ok(EmulatorLaunchOutcome::HostRunning {
                instance_count: remaining_count,
            });
        }
    }
    let pid = spawner.spawn(&plan).map_err(map_spawn_error)?;
    Ok(EmulatorLaunchOutcome::Spawned { pid })
}

#[tauri::command]
pub async fn launch_emulator_content(
    request: EmulatorLaunchRequest,
    guard: tauri::State<'_, EmulatorLaunchGuard>,
) -> Result<EmulatorLaunchOutcome, LaunchError> {
    let scanner = process::create_scanner();
    launch_with_dependencies(
        request,
        guard.inner(),
        scanner.as_ref(),
        &NativeSpawner,
        &NativeHostCloser,
    )
    .await
}

fn verify_content_path(request: EmulatorContentPathRequest) -> LaunchPathReport {
    let adapter = launch_adapter_for(&request.emulator_id);
    let status = match validate_absolute_path(&request.path) {
        Err(_) => LaunchPathStatus::Invalid,
        Ok(_validated)
            if adapter
                .map(|adapter| !has_supported_extension(adapter, &request.path))
                .unwrap_or(true) =>
        {
            LaunchPathStatus::Invalid
        }
        Ok(validated) => match fs::metadata(&validated) {
            Ok(metadata) if metadata.is_file() => LaunchPathStatus::Ok,
            Ok(_) => LaunchPathStatus::NotAFile,
            Err(error) if is_missing_at(&validated, &error) => LaunchPathStatus::Missing,
            Err(_) => LaunchPathStatus::Unreadable,
        },
    };
    LaunchPathReport {
        path: request.path,
        status,
    }
}

#[tauri::command]
pub async fn verify_emulator_content_paths(
    targets: Vec<EmulatorContentPathRequest>,
) -> Vec<LaunchPathReport> {
    tauri::async_runtime::spawn_blocking(move || {
        targets.into_iter().map(verify_content_path).collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::ProcessSnapshot;
    use async_trait::async_trait;
    use std::{
        error::Error,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };

    struct FakeScanner(Vec<ProcessSnapshot>);

    #[async_trait]
    impl ProcessScanner for FakeScanner {
        async fn scan(&self) -> Result<Vec<ProcessSnapshot>, Box<dyn Error + Send + Sync>> {
            Ok(self.0.clone())
        }
    }

    #[derive(Default)]
    struct FakeSpawner(AtomicUsize);

    impl EmulatorProcessSpawner for FakeSpawner {
        fn spawn(&self, _plan: &EmulatorLaunchPlan) -> Result<u32, io::Error> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(123)
        }
    }

    struct FakeCloser {
        posted: usize,
        state: Option<Arc<Mutex<Vec<ProcessSnapshot>>>>,
    }

    impl EmulatorHostCloser for FakeCloser {
        fn request_close(&self, _pids: &HashSet<u32>) -> Result<usize, io::Error> {
            if let Some(state) = &self.state {
                state.lock().unwrap().clear();
            }
            Ok(self.posted)
        }
    }

    struct SharedScanner(Arc<Mutex<Vec<ProcessSnapshot>>>);

    #[async_trait]
    impl ProcessScanner for SharedScanner {
        async fn scan(&self) -> Result<Vec<ProcessSnapshot>, Box<dyn Error + Send + Sync>> {
            Ok(self.0.lock().unwrap().clone())
        }
    }

    #[test]
    fn validates_dolphin_extensions_and_guard_reentry() {
        let adapter = launch_adapter_for("dolphin").expect("Dolphin adapter");
        assert!(has_supported_extension(adapter, r"C:\Games\Game.RVZ"));
        assert!(!has_supported_extension(adapter, r"C:\Games\save.sav"));
        assert_eq!(
            (adapter.arguments)(Path::new(r"C:\Games\Game.RVZ")),
            vec![
                OsString::from("--batch"),
                OsString::from(r"--exec=C:\Games\Game.RVZ")
            ]
        );
        let guard = EmulatorLaunchGuard::default();
        let first = guard.try_acquire("dolphin").expect("first lease");
        assert!(guard.try_acquire("dolphin").is_none());
        drop(first);
        assert!(guard.try_acquire("dolphin").is_some());

        let idle = ProcessSnapshot {
            exe_name: "Dolphin.exe".to_string(),
            exe_path: None,
            pid: 1,
            started_at_unix: 1,
            emulator_id: Some("dolphin"),
            command_line: None,
            working_directory: None,
            window_title: Some("Dolphin 2606".to_string()),
            open_files: None,
        };
        assert!(is_dolphin_idle(&idle));
        assert!(!is_dolphin_idle(&ProcessSnapshot {
            window_title: Some("The Sims 2 | Dolphin 2606".to_string()),
            ..idle.clone()
        }));
        assert!(!is_dolphin_idle(&ProcessSnapshot {
            open_files: Some(vec![r"C:\Games\The Sims 2.rvz".to_string()]),
            ..idle
        }));
    }

    #[test]
    fn builds_dosbox_program_and_config_launches() {
        let adapter = launch_adapter_for("dosbox").expect("DOSBox adapter");
        assert!(has_supported_extension(adapter, r"C:\Games\Doom\DOOM.EXE"));
        assert!(has_supported_extension(
            adapter,
            r"C:\Games\Doom\dosbox_DOOM.conf"
        ));
        assert!(!has_supported_extension(
            adapter,
            r"C:\Games\Doom\README.TXT"
        ));
        assert_eq!(
            (adapter.arguments)(Path::new(r"C:\Games\Doom\DOOM.EXE")),
            vec![
                OsString::from(r"C:\Games\Doom\DOOM.EXE"),
                OsString::from("-exit")
            ]
        );
        assert_eq!(
            (adapter.arguments)(Path::new(r"C:\Games\Doom\dosbox_DOOM.conf")),
            vec![
                OsString::from("-conf"),
                OsString::from(r"C:\Games\Doom\dosbox_DOOM.conf"),
                OsString::from("-exit")
            ]
        );

        let idle = ProcessSnapshot {
            exe_name: "DOSBox.exe".to_string(),
            exe_path: None,
            pid: 1,
            started_at_unix: 1,
            emulator_id: Some("dosbox"),
            command_line: None,
            working_directory: None,
            window_title: Some(
                "DOSBox 0.74-3, Cpu speed: max 100% cycles, Program: DOSBOX".to_string(),
            ),
            open_files: None,
        };
        assert!(is_dosbox_idle(&idle));
        assert!(!is_dosbox_idle(&ProcessSnapshot {
            window_title: Some(
                "DOSBox 0.74-3, Cpu speed: max 100% cycles, Program: DOOM".to_string(),
            ),
            ..idle
        }));
    }

    #[test]
    fn builds_pcsx2_launch_without_shell_interpretation() {
        let adapter = launch_adapter_for("pcsx2").unwrap();
        for extension in ["iso", "CHD", "cso", "zso", "bin", "img", "mdf", "gz", "elf"] {
            assert!(has_supported_extension(
                adapter,
                &format!(r"D:\PS2\Game.{extension}")
            ));
        }
        assert!(!has_supported_extension(adapter, r"D:\PS2\save.p2s"));
        let path = Path::new(r"D:\PS2\Ratchet & Clank.chd");
        assert_eq!(
            (adapter.arguments)(path),
            vec![path.as_os_str().to_os_string()]
        );
    }

    #[test]
    fn builds_mgba_launch_and_closes_only_an_idle_instance() {
        let adapter = launch_adapter_for("mgba").unwrap();
        for extension in ["gba", "GB", "gbc", "sgb", "zip", "7z"] {
            assert!(has_supported_extension(
                adapter,
                &format!(r"D:\ROMs\Game.{extension}")
            ));
        }
        assert!(!has_supported_extension(adapter, r"D:\ROMs\Game.sav"));
        let path = Path::new(r"D:\ROMs\Pokemon FireRed.gba");
        assert_eq!(
            (adapter.arguments)(path),
            vec![path.as_os_str().to_os_string()]
        );

        let idle = ProcessSnapshot {
            exe_name: "mGBA.exe".to_string(),
            exe_path: None,
            pid: 1,
            started_at_unix: 1,
            emulator_id: Some("mgba"),
            command_line: Some(Vec::new()),
            working_directory: None,
            window_title: Some("mGBA - 0.10.5".to_string()),
            open_files: None,
        };
        assert!(is_mgba_idle(&idle));
        assert!(!is_mgba_idle(&ProcessSnapshot {
            window_title: Some("mGBA - POKEMON FIRE (59.7 fps) - 0.10.5".to_string()),
            ..idle.clone()
        }));
        assert!(!is_mgba_idle(&ProcessSnapshot {
            command_line: Some(vec![r"D:\ROMs\Pokemon FireRed.gba".to_string()]),
            ..idle.clone()
        }));
        assert!(!is_mgba_idle(&ProcessSnapshot {
            window_title: Some("mGBA".to_string()),
            ..idle
        }));
    }

    #[test]
    fn builds_cemu_launch_and_closes_only_an_idle_instance() {
        let adapter = launch_adapter_for("cemu").unwrap();
        for extension in ["wud", "WUX", "wua", "wuhb", "iso", "rpx", "elf"] {
            assert!(has_supported_extension(
                adapter,
                &format!(r"D:\WiiU\Game.{extension}")
            ));
        }
        assert!(!has_supported_extension(adapter, r"D:\WiiU\meta.xml"));
        let path = Path::new(r"D:\WiiU\Breath of the Wild.wua");
        assert_eq!(
            (adapter.arguments)(path),
            vec![OsString::from("-g"), path.as_os_str().to_os_string()]
        );

        let idle = ProcessSnapshot {
            exe_name: "Cemu.exe".to_string(),
            exe_path: None,
            pid: 1,
            started_at_unix: 1,
            emulator_id: Some("cemu"),
            command_line: Some(Vec::new()),
            working_directory: None,
            window_title: Some("Cemu 2.6".to_string()),
            open_files: None,
        };
        assert!(is_cemu_idle(&idle));
        assert!(!is_cemu_idle(&ProcessSnapshot {
            window_title: Some(
                "Cemu 2.6 - FPS: 59.94 [Vulkan] [NVIDIA GPU] [TitleId: 00050000-101c9500] Breath of the Wild [EU v208]"
                    .to_string()
            ),
            ..idle.clone()
        }));
        assert!(!is_cemu_idle(&ProcessSnapshot {
            window_title: Some("Cemu 2.6 - Loading...".to_string()),
            ..idle.clone()
        }));
        assert!(!is_cemu_idle(&ProcessSnapshot {
            command_line: Some(vec!["-g".to_string(), r"D:\WiiU\BotW.wua".to_string()]),
            ..idle.clone()
        }));
        assert!(!is_cemu_idle(&ProcessSnapshot {
            window_title: Some("Cemu".to_string()),
            ..idle
        }));
    }

    fn snapshot(emulator_id: &'static str, title: &str) -> ProcessSnapshot {
        ProcessSnapshot {
            exe_name: format!("{emulator_id}.exe"),
            exe_path: None,
            pid: 1,
            started_at_unix: 1,
            emulator_id: Some(emulator_id),
            command_line: Some(Vec::new()),
            working_directory: None,
            window_title: Some(title.to_string()),
            open_files: None,
        }
    }

    #[test]
    fn builds_launches_for_the_title_based_emulators() {
        for (id, path, arguments) in [
            (
                "rpcs3",
                r"D:\PS3\dev_hdd0\game\BLUS30443\USRDIR\EBOOT.BIN",
                vec![],
            ),
            ("ppsspp", r"D:\PSP\Crisis Core.iso", vec![]),
            ("duckstation", r"D:\PS1\Final Fantasy VII.cue", vec!["--"]),
            ("ryujinx", r"D:\Switch\Odyssey.nsp", vec![]),
            ("eden", r"D:\Switch\Odyssey.xci", vec!["-g"]),
        ] {
            let adapter = launch_adapter_for(id).unwrap();
            assert!(has_supported_extension(adapter, path), "{id}");
            let mut expected = arguments
                .into_iter()
                .map(OsString::from)
                .collect::<Vec<_>>();
            expected.push(Path::new(path).as_os_str().to_os_string());
            assert_eq!((adapter.arguments)(Path::new(path)), expected, "{id}");
        }
        for (id, path) in [
            ("rpcs3", r"D:\PS3\save.sav"),
            ("ppsspp", r"D:\PSP\save.sav"),
            ("duckstation", r"D:\PS1\card.mcd"),
            ("ryujinx", r"D:\Switch\prod.keys"),
            ("eden", r"D:\Switch\title.keys"),
        ] {
            assert!(
                !has_supported_extension(launch_adapter_for(id).unwrap(), path),
                "{id}"
            );
        }
    }

    #[test]
    fn closes_only_idle_title_based_emulators() {
        for (id, idle, running) in [
            (
                "rpcs3",
                "RPCS3 0.0.38-18000-a1b2c3d4 Alpha | master",
                "FPS: 59.94 | Vulkan | 0.0.38 | Demon's Souls [BLUS30443]",
            ),
            (
                "ppsspp",
                "PPSSPP v1.18.1 (instance: 2)",
                "PPSSPP v1.18.1 - ULUS10336 : CRISIS CORE",
            ),
            (
                "duckstation",
                "DuckStation v0.1-9876 [Portable]",
                "Final Fantasy VII",
            ),
            (
                "ryujinx",
                "Ryujinx Canary 1.3.250",
                "Ryujinx 1.3.2 - Celeste (01002B30028F6000) (64-bit)",
            ),
            (
                "eden",
                "Eden | v0.0.4 | msvc-19.44",
                "Eden | v0.0.4 | msvc-19.44 | Celeste (64-bit) | NVIDIA",
            ),
        ] {
            let adapter = launch_adapter_for(id).unwrap();
            assert!((adapter.is_idle)(&snapshot(id, idle)), "{id} idle");
            assert!(!(adapter.is_idle)(&snapshot(id, running)), "{id} running");
            assert!(
                !(adapter.is_idle)(&ProcessSnapshot {
                    command_line: Some(vec![
                        r"D:\Games\game.iso".to_string(),
                        r"D:\Games\game.nsp".to_string(),
                        r"D:\Games\EBOOT.BIN".to_string()
                    ]),
                    ..snapshot(id, idle)
                }),
                "{id} started with a game"
            );
        }
        let duckstation = launch_adapter_for("duckstation").unwrap();
        assert!(!(duckstation.is_idle)(&ProcessSnapshot {
            open_files: Some(vec![r"D:\PS1\Final Fantasy VII.bin".to_string()]),
            ..snapshot("duckstation", "DuckStation v0.1-9876")
        }));
    }

    #[cfg(windows)]
    fn test_request() -> (EmulatorLaunchRequest, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "playcounter-emulator-launch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Dolphin.exe");
        let content = dir.join("The Sims 2.rvz");
        fs::write(&exe, b"test").unwrap();
        fs::write(&content, b"test").unwrap();
        (
            EmulatorLaunchRequest {
                emulator_id: "dolphin".to_string(),
                exe_path: exe.to_string_lossy().to_string(),
                content_path: content.to_string_lossy().to_string(),
            },
            dir,
        )
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn blocks_running_host_and_spawns_only_when_clear() {
        let (request, dir) = test_request();
        let guard = EmulatorLaunchGuard::default();
        let spawner = FakeSpawner::default();
        let running = FakeScanner(vec![ProcessSnapshot {
            exe_name: "Dolphin.exe".to_string(),
            exe_path: Some(request.exe_path.clone()),
            pid: 1,
            started_at_unix: 1,
            emulator_id: Some("dolphin"),
            command_line: None,
            working_directory: None,
            window_title: None,
            open_files: None,
        }]);
        assert_eq!(
            launch_with_dependencies(
                request.clone(),
                &guard,
                &running,
                &spawner,
                &FakeCloser {
                    posted: 0,
                    state: None,
                },
            )
            .await
            .unwrap(),
            EmulatorLaunchOutcome::HostRunning { instance_count: 1 }
        );
        assert_eq!(spawner.0.load(Ordering::SeqCst), 0);

        let clear = FakeScanner(vec![]);
        assert_eq!(
            launch_with_dependencies(
                request,
                &guard,
                &clear,
                &spawner,
                &FakeCloser {
                    posted: 0,
                    state: None,
                },
            )
            .await
            .unwrap(),
            EmulatorLaunchOutcome::Spawned { pid: 123 }
        );
        assert_eq!(spawner.0.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn closes_an_idle_host_before_spawning() {
        let (request, dir) = test_request();
        let process = ProcessSnapshot {
            exe_name: "Dolphin.exe".to_string(),
            exe_path: Some(request.exe_path.clone()),
            pid: 7,
            started_at_unix: 1,
            emulator_id: Some("dolphin"),
            command_line: None,
            working_directory: None,
            window_title: Some("Dolphin 2606".to_string()),
            open_files: None,
        };
        let state = Arc::new(Mutex::new(vec![process]));
        let scanner = SharedScanner(Arc::clone(&state));
        let closer = FakeCloser {
            posted: 1,
            state: Some(state),
        };
        let spawner = FakeSpawner::default();

        assert_eq!(
            launch_with_dependencies(
                request,
                &EmulatorLaunchGuard::default(),
                &scanner,
                &spawner,
                &closer,
            )
            .await
            .unwrap(),
            EmulatorLaunchOutcome::Spawned { pid: 123 }
        );
        assert_eq!(spawner.0.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
