use super::{emulator, ProcessScanner, ProcessSnapshot};
use async_trait::async_trait;
use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
};
use sysinfo::{ProcessesToUpdate, System};

pub struct WindowsScanner;

pub fn create_scanner() -> Box<dyn ProcessScanner> {
    Box::new(WindowsScanner)
}

#[async_trait]
impl ProcessScanner for WindowsScanner {
    async fn scan(&self) -> Result<Vec<ProcessSnapshot>, Box<dyn Error + Send + Sync>> {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let mut processes = BTreeMap::new();
        let mut emulator_processes = Vec::new();
        for process in system.processes().values() {
            let exe_path = process.exe().map(|path| path.to_string_lossy().to_string());
            let exe_name = exe_path
                .as_deref()
                .and_then(|exe_path_value| exe_path_value.rsplit(['\\', '/']).next())
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| process.name().to_string_lossy().to_string());
            if exe_name.is_empty() {
                continue;
            }

            let pid = process.pid().as_u32();
            if let Some(host) = emulator::host_for(&exe_name) {
                if emulator_processes.len() >= 16 {
                    continue;
                }
                emulator_processes.push(ProcessSnapshot {
                    exe_name,
                    exe_path,
                    pid,
                    started_at_unix: process.start_time(),
                    emulator_id: Some(host.id),
                    command_line: host
                        .needs_command_line
                        .then(|| emulator::sanitize_args(process.cmd())),
                    window_title: None,
                    open_files: (host.id == "dolphin")
                        .then(|| emulator::open_content_files(pid))
                        .filter(|paths| !paths.is_empty()),
                });
                continue;
            }

            processes
                .entry(exe_name.to_lowercase())
                .or_insert(ProcessSnapshot {
                    exe_name,
                    exe_path,
                    pid,
                    started_at_unix: process.start_time(),
                    emulator_id: None,
                    command_line: None,
                    window_title: None,
                    open_files: None,
                });
        }

        let title_pids = emulator_processes
            .iter()
            .filter(|snapshot| {
                snapshot
                    .emulator_id
                    .and_then(|id| emulator::EMULATOR_HOSTS.iter().find(|host| host.id == id))
                    .map(|host| host.needs_window_title)
                    .unwrap_or(false)
            })
            .map(|snapshot| snapshot.pid)
            .collect::<HashSet<_>>();
        let titles = emulator::window_titles_for(&title_pids);
        for snapshot in &mut emulator_processes {
            snapshot.window_title = titles.get(&snapshot.pid).cloned();
        }

        let mut snapshots = processes.into_values().collect::<Vec<_>>();
        snapshots.extend(emulator_processes);
        Ok(snapshots)
    }
}
