use serde::Serialize;
use std::{fs, io, path::PathBuf};

#[cfg(windows)]
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchErrorKind {
    InvalidPath,
    NotAFile,
    NotFound,
    Unreadable,
    #[allow(dead_code)]
    Unsupported,
    SpawnFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchError {
    pub kind: LaunchErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchPathStatus {
    Ok,
    Missing,
    NotAFile,
    Unreadable,
    Invalid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPathReport {
    pub path: String,
    pub status: LaunchPathStatus,
}

impl LaunchError {
    pub(crate) fn new(kind: LaunchErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

pub(crate) fn is_absolute_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    let drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    let unc_absolute = path.starts_with("\\\\")
        && path[2..]
            .split(['\\', '/'])
            .filter(|part| !part.is_empty())
            .take(2)
            .count()
            == 2;
    drive_absolute || unc_absolute
}

#[cfg_attr(not(windows), allow(dead_code))]
fn validate_launch_path(raw: &str) -> Result<PathBuf, LaunchError> {
    let path = raw.trim();
    let file_name = path
        .split(['\\', '/'])
        .rfind(|part| !part.is_empty())
        .unwrap_or_default();
    if path.is_empty()
        || path.contains('\0')
        || !is_absolute_windows_path(path)
        || path.split(['\\', '/']).any(|part| part == "..")
        || file_name.eq_ignore_ascii_case(".exe")
        || !file_name.to_ascii_lowercase().ends_with(".exe")
    {
        return Err(LaunchError::new(
            LaunchErrorKind::InvalidPath,
            "PlayCounter can only start .exe files with a full Windows path.",
        ));
    }
    Ok(PathBuf::from(path))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_launch_target(raw: &str) -> Result<(PathBuf, Option<PathBuf>), LaunchError> {
    let path = validate_launch_path(raw)?;
    match fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => {
            let parent = path.parent().filter(|value| !value.as_os_str().is_empty());
            Ok((path.clone(), parent.map(PathBuf::from)))
        }
        Ok(_) => Err(LaunchError::new(
            LaunchErrorKind::NotAFile,
            format!("{} is not a program file.", path.display()),
        )),
        Err(error) if is_definitely_missing(&error) => Err(LaunchError::new(
            LaunchErrorKind::NotFound,
            format!("PlayCounter no longer finds {}.", path.display()),
        )),
        Err(error) => Err(LaunchError::new(
            LaunchErrorKind::Unreadable,
            format!("Could not read {}: {error}", path.display()),
        )),
    }
}

pub(crate) fn is_definitely_missing(error: &io::Error) -> bool {
    match error.raw_os_error() {
        Some(2 | 3 | 15 | 123 | 267) => true,
        Some(_) => false,
        None => error.kind() == io::ErrorKind::NotFound,
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn map_spawn_error(error: io::Error) -> LaunchError {
    if is_definitely_missing(&error) {
        return LaunchError::new(LaunchErrorKind::NotFound, "The game file no longer exists.");
    }
    if error.raw_os_error() == Some(740) {
        return LaunchError::new(
            LaunchErrorKind::SpawnFailed,
            "This game needs administrator rights. Start it once as administrator, or use its own shortcut.",
        );
    }
    LaunchError::new(LaunchErrorKind::SpawnFailed, error.to_string())
}

#[cfg(windows)]
fn launch_blocking(raw: &str) -> Result<(), LaunchError> {
    let (path, working_directory) = resolve_launch_target(raw)?;
    let mut command = Command::new(&path);
    if let Some(directory) = working_directory {
        command.current_dir(directory);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(map_spawn_error)
}

#[cfg(not(windows))]
fn launch_blocking(_raw: &str) -> Result<(), LaunchError> {
    Err(LaunchError::new(
        LaunchErrorKind::Unsupported,
        "Starting games from the library is only supported on Windows.",
    ))
}

#[tauri::command]
pub async fn launch_executable(path: String) -> Result<(), LaunchError> {
    tauri::async_runtime::spawn_blocking(move || launch_blocking(&path))
        .await
        .map_err(|error| LaunchError::new(LaunchErrorKind::SpawnFailed, error.to_string()))?
}

#[cfg(windows)]
fn verify_launch_path(path: String) -> LaunchPathReport {
    let status = match validate_launch_path(&path) {
        Err(_) => LaunchPathStatus::Invalid,
        Ok(validated) => match fs::metadata(validated) {
            Ok(metadata) if metadata.is_file() => LaunchPathStatus::Ok,
            Ok(_) => LaunchPathStatus::NotAFile,
            Err(error) if is_definitely_missing(&error) => LaunchPathStatus::Missing,
            Err(_) => LaunchPathStatus::Unreadable,
        },
    };
    LaunchPathReport { path, status }
}

#[cfg(not(windows))]
fn verify_launch_path(path: String) -> LaunchPathReport {
    LaunchPathReport {
        path,
        status: LaunchPathStatus::Unreadable,
    }
}

#[tauri::command]
pub async fn verify_launch_paths(paths: Vec<String>) -> Vec<LaunchPathReport> {
    tauri::async_runtime::spawn_blocking(move || {
        paths.into_iter().map(verify_launch_path).collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_windows_executable_paths() {
        assert!(validate_launch_path(r"C:\Games\Foo\Game.exe").is_ok());
        assert!(validate_launch_path("c:/games/Game.EXE").is_ok());
        assert!(validate_launch_path(r"\\nas\share\Game.exe").is_ok());
        for invalid in [
            "",
            "   ",
            "Game.exe",
            r"C:\Games\..\Game.exe",
            r"C:\Games\Game.bat",
            r"C:\Games\Game.exe.txt",
            "/usr/games/game.exe",
            "C:\\Games\\Bad\0Game.exe",
        ] {
            assert_eq!(
                validate_launch_path(invalid).unwrap_err().kind,
                LaunchErrorKind::InvalidPath
            );
        }
    }

    #[test]
    fn maps_spawn_errors_precisely() {
        assert_eq!(
            map_spawn_error(io::Error::from(io::ErrorKind::NotFound)).kind,
            LaunchErrorKind::NotFound
        );
        assert_eq!(
            map_spawn_error(io::Error::from(io::ErrorKind::PermissionDenied)).kind,
            LaunchErrorKind::SpawnFailed
        );
        for code in [2, 3, 15, 123, 267] {
            assert!(is_definitely_missing(&io::Error::from_raw_os_error(code)));
        }
        for code in [5, 21, 53, 1231] {
            assert!(!is_definitely_missing(&io::Error::from_raw_os_error(code)));
        }
    }

    #[test]
    fn missing_target_is_not_found() {
        assert_eq!(
            resolve_launch_target(r"C:\playcounter-missing\Game.exe")
                .unwrap_err()
                .kind,
            LaunchErrorKind::NotFound
        );
    }

    #[cfg(windows)]
    #[test]
    fn verifies_missing_directory_and_invalid_targets() {
        assert_eq!(
            verify_launch_path(r"C:\playcounter-missing\Game.exe".to_string()).status,
            LaunchPathStatus::Missing
        );
        assert_eq!(
            verify_launch_path("Game.exe".to_string()).status,
            LaunchPathStatus::Invalid
        );
        let directory = std::env::temp_dir().join(format!(
            "playcounter-launch-directory-{}-{}.exe",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        assert_eq!(
            verify_launch_path(directory.to_string_lossy().to_string()).status,
            LaunchPathStatus::NotAFile
        );
        fs::remove_dir(directory).unwrap();
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_launch_is_unsupported() {
        assert_eq!(
            launch_blocking(r"C:\Games\Game.exe").unwrap_err().kind,
            LaunchErrorKind::Unsupported
        );
    }
}
