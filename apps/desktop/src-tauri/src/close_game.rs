// Closes a running game from My Games. A polite close asks its windows to
// close, like clicking their ✕, so the game can save. A force close ends the
// processes right away. PlayCounter runs without administrator rights, so a
// game that runs as administrator (or is protected by anti-cheat) refuses both.

use serde::{Deserialize, Serialize};

#[cfg(windows)]
const POLITE_WAIT_MS: u64 = 10_000;
#[cfg(windows)]
const FORCE_WAIT_MS: u64 = 3_000;
#[cfg(windows)]
const EXIT_POLL_MS: u64 = 250;

/// One process of the game, as the last scan saw it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTarget {
    pub pid: u32,
    pub started_at_unix: u64,
    pub exe_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseOutcome {
    /// None of the processes runs any more.
    Closed,
    /// The game ignored the close request, or has no window to ask.
    StillRunning,
    /// Windows refused to end a process.
    Blocked,
}

/// Windows reuses PIDs: a PID is only the game while it still runs the same
/// file and started at the same time. PlayCounter never closes itself.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_same_process(target: &CloseTarget, started_at_unix: u64, exe_path: Option<&str>) -> bool {
    if target.pid == std::process::id() || target.started_at_unix != started_at_unix {
        return false;
    }
    match (target.exe_path.as_deref(), exe_path) {
        (Some(expected), Some(actual)) => expected.eq_ignore_ascii_case(actual),
        (Some(_), None) => false,
        (None, _) => true,
    }
}

#[cfg(windows)]
fn running_targets(targets: &[CloseTarget]) -> Vec<u32> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    let pids = targets
        .iter()
        .map(|target| Pid::from_u32(target.pid))
        .collect::<Vec<_>>();
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    targets
        .iter()
        .filter(|target| {
            system
                .process(Pid::from_u32(target.pid))
                .is_some_and(|process| {
                    let exe_path = process.exe().map(|path| path.to_string_lossy().to_string());
                    is_same_process(target, process.start_time(), exe_path.as_deref())
                })
        })
        .map(|target| target.pid)
        .collect()
}

#[cfg(windows)]
fn wait_for_exit(targets: &[CloseTarget], timeout_ms: u64) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        if running_targets(targets).is_empty() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(EXIT_POLL_MS));
    }
}

/// Returns how many processes Windows refused to end.
#[cfg(windows)]
fn terminate(pids: &[u32]) -> usize {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED},
        System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE},
    };

    let mut refused = 0;
    for &pid in pids {
        // SAFETY: plain Win32 calls; the handle is closed before the next PID.
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if handle.is_null() {
                if GetLastError() == ERROR_ACCESS_DENIED {
                    refused += 1;
                }
                continue;
            }
            if TerminateProcess(handle, 1) == 0 && GetLastError() == ERROR_ACCESS_DENIED {
                refused += 1;
            }
            CloseHandle(handle);
        }
    }
    refused
}

#[cfg(windows)]
fn close_blocking(targets: &[CloseTarget], force: bool) -> CloseOutcome {
    let running = running_targets(targets);
    if running.is_empty() {
        return CloseOutcome::Closed;
    }
    if force {
        let refused = terminate(&running);
        if wait_for_exit(targets, FORCE_WAIT_MS) {
            return CloseOutcome::Closed;
        }
        return if refused > 0 {
            CloseOutcome::Blocked
        } else {
            CloseOutcome::StillRunning
        };
    }
    let pids = running.into_iter().collect();
    if super::process::emulator::request_close_windows(&pids) == 0 {
        return CloseOutcome::StillRunning;
    }
    if wait_for_exit(targets, POLITE_WAIT_MS) {
        CloseOutcome::Closed
    } else {
        CloseOutcome::StillRunning
    }
}

#[cfg(windows)]
#[tauri::command]
pub async fn close_game_processes(
    targets: Vec<CloseTarget>,
    force: bool,
) -> Result<CloseOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || close_blocking(&targets, force))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn close_game_processes(
    _targets: Vec<CloseTarget>,
    _force: bool,
) -> Result<CloseOutcome, String> {
    Err("Closing games is only supported on Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(pid: u32, exe_path: Option<&str>) -> CloseTarget {
        CloseTarget {
            pid,
            started_at_unix: 1_000,
            exe_path: exe_path.map(str::to_string),
        }
    }

    #[test]
    fn a_reused_pid_is_not_the_game() {
        let game = target(42, Some(r"C:\Games\Game.exe"));
        assert!(is_same_process(&game, 1_000, Some(r"c:\games\GAME.exe")));
        assert!(!is_same_process(&game, 1_001, Some(r"C:\Games\Game.exe")));
        assert!(!is_same_process(
            &game,
            1_000,
            Some(r"C:\Windows\notepad.exe")
        ));
        assert!(!is_same_process(&game, 1_000, None));
        assert!(is_same_process(&target(42, None), 1_000, None));
    }

    #[test]
    fn playcounter_never_closes_itself() {
        let own = target(std::process::id(), None);
        assert!(!is_same_process(&own, 1_000, None));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn force_closes_a_running_process() {
        use crate::process::create_scanner;
        use std::{
            os::windows::process::CommandExt,
            process::{Command, Stdio},
        };
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

        let command = std::env::var_os("COMSPEC").expect("Windows command interpreter");
        // An open input pipe keeps the interpreter alive without a window.
        let mut child = Command::new(&command)
            .args(["/D", "/Q"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("start test process");
        let snapshot = create_scanner()
            .scan()
            .await
            .expect("scan processes")
            .into_iter()
            .find(|snapshot| snapshot.pid == child.id())
            .expect("the scan sees the test process");
        let targets = vec![CloseTarget {
            pid: snapshot.pid,
            started_at_unix: snapshot.started_at_unix,
            exe_path: snapshot.exe_path,
        }];

        // No window to ask: the polite close gives up at once.
        assert_eq!(close_blocking(&targets, false), CloseOutcome::StillRunning);
        assert_eq!(close_blocking(&targets, true), CloseOutcome::Closed);
        assert!(child.wait().is_ok());
        assert_eq!(close_blocking(&targets, true), CloseOutcome::Closed);
    }
}
