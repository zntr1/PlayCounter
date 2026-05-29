use super::{ProcessScanner, ProcessSnapshot};
use async_trait::async_trait;
use std::{collections::BTreeMap, error::Error};
use sysinfo::{ProcessesToUpdate, System};

pub struct LinuxScanner;

pub fn create_scanner() -> Box<dyn ProcessScanner> {
    Box::new(LinuxScanner)
}

#[async_trait]
impl ProcessScanner for LinuxScanner {
    async fn scan(&self) -> Result<Vec<ProcessSnapshot>, Box<dyn Error + Send + Sync>> {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

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
                .entry(exe_name.to_lowercase())
                .or_insert(ProcessSnapshot { exe_name, exe_path });
        }

        Ok(processes.into_values().collect())
    }
}
