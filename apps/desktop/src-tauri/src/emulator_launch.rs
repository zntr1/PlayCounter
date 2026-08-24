use crate::{
    launch::{
        is_absolute_windows_path, is_definitely_missing, map_spawn_error, LaunchError,
        LaunchErrorKind, LaunchPathReport, LaunchPathStatus,
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

const DOLPHIN_EXTENSIONS: &[&str] = &[
    "elf", "dol", "gcm", "iso", "tgc", "wbfs", "ciso", "gcz", "wad", "dff", "wia", "rvz", "json",
];

struct EmulatorLaunchAdapter {
    id: &'static str,
    extensions: &'static [&'static str],
    arguments: fn(&Path) -> Vec<OsString>,
    is_idle: fn(&ProcessSnapshot) -> bool,
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

static EMULATOR_LAUNCH_ADAPTERS: &[EmulatorLaunchAdapter] = &[EmulatorLaunchAdapter {
    id: "dolphin",
    extensions: DOLPHIN_EXTENSIONS,
    arguments: dolphin_arguments,
    is_idle: is_dolphin_idle,
}];

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
    Spawned,
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
    fn spawn(&self, plan: &EmulatorLaunchPlan) -> Result<(), io::Error>;
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
    fn spawn(&self, plan: &EmulatorLaunchPlan) -> Result<(), io::Error> {
        Command::new(&plan.exe_path)
            .args(&plan.arguments)
            .current_dir(&plan.working_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
    }
}

#[cfg(not(windows))]
impl EmulatorProcessSpawner for NativeSpawner {
    fn spawn(&self, _plan: &EmulatorLaunchPlan) -> Result<(), io::Error> {
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
        Err(error) if is_definitely_missing(&error) => Err(LaunchError::new(
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
    if host.id != request.emulator_id || !exe_name.to_ascii_lowercase().ends_with(".exe") {
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
            "The selected file type is not supported by Dolphin.",
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
    spawner.spawn(&plan).map_err(map_spawn_error)?;
    Ok(EmulatorLaunchOutcome::Spawned)
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
        Ok(validated) => match fs::metadata(validated) {
            Ok(metadata) if metadata.is_file() => LaunchPathStatus::Ok,
            Ok(_) => LaunchPathStatus::NotAFile,
            Err(error) if is_definitely_missing(&error) => LaunchPathStatus::Missing,
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
        fn spawn(&self, _plan: &EmulatorLaunchPlan) -> Result<(), io::Error> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
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
            EmulatorLaunchOutcome::Spawned
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
            EmulatorLaunchOutcome::Spawned
        );
        assert_eq!(spawner.0.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
