use super::{ProcessScanner, ProcessSnapshot};
use async_trait::async_trait;
use std::{collections::BTreeMap, error::Error};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

pub struct MacOsScanner;

pub fn create_scanner() -> Box<dyn ProcessScanner> {
    Box::new(MacOsScanner)
}

#[async_trait]
impl ProcessScanner for MacOsScanner {
    async fn scan(&self) -> Result<Vec<ProcessSnapshot>, Box<dyn Error + Send + Sync>> {
        // Scans run every few seconds and need only exe paths, so nothing
        // else is read.
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );

        let mut processes = BTreeMap::new();
        for process in system.processes().values() {
            let exe_path = process.exe().map(|path| path.to_string_lossy().to_string());
            let exe_name = exe_path
                .as_deref()
                .and_then(|exe_path_value| exe_path_value.rsplit('/').next())
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| process.name().to_string_lossy().to_string());
            if exe_name.is_empty() {
                continue;
            }

            processes
                .entry(process.pid().as_u32())
                .or_insert(ProcessSnapshot {
                    exe_name,
                    exe_path,
                    pid: process.pid().as_u32(),
                    started_at_unix: process.start_time(),
                    emulator_id: None,
                    command_line: None,
                    working_directory: None,
                    window_title: None,
                    open_files: None,
                    recent_file: None,
                });
        }

        Ok(processes.into_values().collect())
    }
}
