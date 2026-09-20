use super::exe_scan::ScannedExecutable;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: &'static str,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    pub checked_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccount {
    pub account_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona_name: Option<String>,
    pub most_recent: bool,
    pub games_with_playtime: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedGame {
    pub external_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub playtime_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_played_evidence: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played_unix: Option<u64>,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_path: Option<String>,
    pub executables: Vec<ScannedExecutable>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub games: Vec<ScannedGame>,
    pub warnings: Vec<String>,
    pub partial: bool,
}
