use async_trait::async_trait;
use serde::Serialize;
use std::error::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSnapshot {
    pub exe_name: String,
    pub exe_path: Option<String>,
    pub pid: u32,
    pub started_at_unix: u64,
    pub emulator_id: Option<&'static str>,
    pub command_line: Option<Vec<String>>,
    pub window_title: Option<String>,
}

#[async_trait]
pub trait ProcessScanner: Send + Sync {
    async fn scan(&self) -> Result<Vec<ProcessSnapshot>, Box<dyn Error + Send + Sync>>;
}

mod emulator;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::create_scanner;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::create_scanner;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::create_scanner;
