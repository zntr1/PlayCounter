use serde::Serialize;
use std::{collections::BTreeSet, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const USER_FILE_NAME: &str = "ignored-processes.user.txt";

#[cfg(target_os = "windows")]
const BUILT_IN_IGNORED_PROCESSES: &str = include_str!("../resources/ignored-processes/windows.txt");

#[cfg(target_os = "macos")]
const BUILT_IN_IGNORED_PROCESSES: &str = include_str!("../resources/ignored-processes/macos.txt");

#[cfg(target_os = "linux")]
const BUILT_IN_IGNORED_PROCESSES: &str = include_str!("../resources/ignored-processes/linux.txt");

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
const BUILT_IN_IGNORED_PROCESSES: &str = "";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoredProcesses {
    pub processes: Vec<String>,
    pub user_processes: Vec<String>,
    pub user_file_path: String,
}

pub fn load(app: &AppHandle) -> Result<IgnoredProcesses, String> {
    let user_file_path = user_file_path(app)?;
    ensure_user_file(&user_file_path)?;

    let user_ignored = fs::read_to_string(&user_file_path).map_err(|error| error.to_string())?;
    let user_processes: BTreeSet<String> = parse_process_list(&user_ignored).collect();

    let mut processes = BTreeSet::new();
    processes.extend(parse_process_list(BUILT_IN_IGNORED_PROCESSES));
    processes.extend(user_processes.iter().cloned());

    Ok(IgnoredProcesses {
        processes: processes.into_iter().collect(),
        user_processes: user_processes.into_iter().collect(),
        user_file_path: user_file_path.to_string_lossy().to_string(),
    })
}

pub fn set_user_ignored(
    app: &AppHandle,
    exe_name: &str,
    ignored: bool,
) -> Result<IgnoredProcesses, String> {
    let user_file_path = user_file_path(app)?;
    ensure_user_file(&user_file_path)?;

    let user_ignored = fs::read_to_string(&user_file_path).map_err(|error| error.to_string())?;
    let mut user_processes: BTreeSet<String> = parse_process_list(&user_ignored).collect();
    let exe_name = normalize_process_name(exe_name)?;

    if ignored {
        user_processes.insert(exe_name);
    } else {
        user_processes.retain(|process| {
            process != &exe_name && !(has_wildcard(process) && wildcard_matches(process, &exe_name))
        });
    }

    fs::write(&user_file_path, format_user_file(&user_processes))
        .map_err(|error| error.to_string())?;

    load(app)
}

pub fn user_file_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let user_file_path = user_file_path(app)?;
    ensure_user_file(&user_file_path)?;
    user_file_path
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "User ignored processes folder is unavailable.".to_string())
}

fn user_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join(USER_FILE_NAME))
}

fn ensure_user_file(user_file_path: &std::path::Path) -> Result<(), String> {
    if let Some(parent) = user_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    if !user_file_path.exists() {
        fs::write(user_file_path, default_user_file()).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn parse_process_list(contents: &str) -> impl Iterator<Item = String> + '_ {
    contents.lines().filter_map(|line| {
        let process = line.trim().trim_start_matches('\u{feff}');
        if process.is_empty() || process.starts_with('#') {
            return None;
        }

        Some(process.to_lowercase())
    })
}

fn normalize_process_name(exe_name: &str) -> Result<String, String> {
    let exe_name = exe_name
        .trim()
        .trim_start_matches('\u{feff}')
        .to_lowercase();
    if exe_name.is_empty() {
        return Err("Executable name cannot be empty.".to_string());
    }
    if exe_name.contains('\n') || exe_name.contains('\r') {
        return Err("Executable name cannot contain line breaks.".to_string());
    }

    Ok(exe_name)
}

fn has_wildcard(process: &str) -> bool {
    process.contains('*') || process.contains('?')
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    wildcard_matches_inner(pattern.as_bytes(), value.as_bytes(), 0, 0, None, None)
}

fn wildcard_matches_inner(
    pattern: &[u8],
    value: &[u8],
    mut pattern_index: usize,
    mut value_index: usize,
    mut star_pattern_index: Option<usize>,
    mut star_value_index: Option<usize>,
) -> bool {
    while value_index < value.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == b'?' || pattern[pattern_index] == value[value_index])
        {
            pattern_index += 1;
            value_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
            star_pattern_index = Some(pattern_index);
            pattern_index += 1;
            star_value_index = Some(value_index);
        } else if let (Some(star_pattern), Some(star_value)) =
            (star_pattern_index, star_value_index)
        {
            pattern_index = star_pattern + 1;
            value_index = star_value + 1;
            star_value_index = Some(value_index);
        } else {
            return false;
        }
    }

    while pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
        pattern_index += 1;
    }

    pattern_index == pattern.len()
}

fn format_user_file(user_processes: &BTreeSet<String>) -> String {
    let mut contents = default_user_file().to_string();
    for process in user_processes {
        contents.push_str(process);
        contents.push('\n');
    }
    contents
}

fn default_user_file() -> &'static str {
    "# PlayCounter user ignored processes.\n\
     # Add one process name or wildcard pattern per line. Lines starting with # are ignored.\n\
     # Wildcards: * matches any text, ? matches one character.\n\
     # Windows example: chrome.exe\n\
     # Windows wildcard example: claude*.exe\n\
     # macOS/Linux example: chrome\n"
}
