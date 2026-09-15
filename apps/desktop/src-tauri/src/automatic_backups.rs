use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use uuid::Uuid;

// Serialize writes and retention, including requests from a reloaded webview.
static BACKUP_WRITE_LOCK: Mutex<()> = Mutex::new(());
const PREFIX: &str = "playcounter-auto-";
const MAX_BACKUP_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    path: String,
    cleanup_warning: Option<String>,
}

fn backup_directory(app: &tauri::AppHandle, directory: Option<String>) -> Result<PathBuf, String> {
    let path = match directory {
        Some(directory) => PathBuf::from(directory),
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("backups")
            .join("automatic"),
    };
    if !path.is_absolute() {
        return Err("Choose an absolute backup folder path.".to_string());
    }
    Ok(path)
}

#[tauri::command]
pub fn default_backup_directory(app: tauri::AppHandle) -> Result<String, String> {
    Ok(backup_directory(&app, None)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn open_backup_directory(
    app: tauri::AppHandle,
    directory: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = backup_directory(&app, directory)?;
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        super::open_folder(&directory)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn write_automatic_backup(
    app: tauri::AppHandle,
    directory: Option<String>,
    contents: String,
    keep_count: usize,
) -> Result<BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = BACKUP_WRITE_LOCK
            .lock()
            .map_err(|error| error.to_string())?;
        write_snapshot(&backup_directory(&app, directory)?, &contents, keep_count)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn write_snapshot(
    directory: &Path,
    contents: &str,
    keep_count: usize,
) -> Result<BackupResult, String> {
    if !(1..=100).contains(&keep_count) {
        return Err("Keep between 1 and 100 automatic backups.".to_string());
    }
    if contents.len() > MAX_BACKUP_BYTES {
        return Err("Backup exceeds the 64 MB import limit.".to_string());
    }
    let envelope: serde_json::Value =
        serde_json::from_str(contents).map_err(|error| error.to_string())?;
    if envelope["format"] != "playcounter-backup"
        || envelope["version"] != 2
        || !envelope["data"].is_object()
    {
        return Err("Invalid PlayCounter backup.".to_string());
    }
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let name = format!("{PREFIX}{stamp}-{}", Uuid::new_v4());
    let path = directory.join(format!("{name}.json"));
    let temporary = directory.join(format!("{name}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let written = file
        .write_all(contents.as_bytes())
        .and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = written.and_then(|_| fs::rename(&temporary, &path)) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }

    // Prune only after the new, complete snapshot is in place. A cleanup
    // failure does not turn a successfully saved backup into a failed backup.
    let cleanup_warning = prune_snapshots(directory, &path, keep_count).err();
    Ok(BackupResult {
        path: path.to_string_lossy().into_owned(),
        cleanup_warning,
    })
}

fn snapshot_stamp(name: &str) -> Option<u128> {
    let name = name.strip_prefix(PREFIX)?.strip_suffix(".json")?;
    let (stamp, id) = name.split_once('-')?;
    if stamp.is_empty() || !stamp.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let id = Uuid::parse_str(id).ok()?;
    if id.get_version_num() != 4 {
        return None;
    }
    stamp.parse().ok()
}

fn prune_snapshots(directory: &Path, newest: &Path, keep_count: usize) -> Result<(), String> {
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        // Do not follow symlinks or descend into directories, even if named
        // like an automatic snapshot. Never touch manual/import safety backups.
        if entry.path() == newest
            || !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
        {
            continue;
        }
        let Some(stamp) = snapshot_stamp(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        snapshots.push((stamp, entry.path()));
    }
    snapshots.sort_unstable_by(|left, right| right.cmp(left));
    for (_, path) in snapshots.into_iter().skip(keep_count - 1) {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("playcounter-backup-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            // Only this test's uniquely created directory is removed.
            assert_eq!(
                self.0.parent().unwrap(),
                std::env::temp_dir().canonicalize().unwrap()
            );
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("playcounter-backup-test-"));
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const BACKUP: &str = r#"{"format":"playcounter-backup","version":2,"data":{"sessions":[]}}"#;

    #[test]
    fn creates_complete_unique_snapshots_without_temporary_files() {
        let directory = TestDirectory::new();
        let first = write_snapshot(&directory.0, BACKUP, 10).unwrap();
        let second = write_snapshot(&directory.0, BACKUP, 10).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(fs::read_to_string(first.path).unwrap(), BACKUP);
        assert_eq!(fs::read_to_string(second.path).unwrap(), BACKUP);
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 2);
    }

    #[test]
    fn retention_keeps_new_snapshot_and_only_removes_managed_files() {
        let directory = TestDirectory::new();
        for stamp in [1, 2, 3] {
            fs::write(
                directory
                    .0
                    .join(format!("{PREFIX}{stamp}-{}.json", Uuid::new_v4())),
                BACKUP,
            )
            .unwrap();
        }
        let preserved = [
            "notes.json",
            "playcounter-backup-123.json",
            "playcounter-auto-not-a-snapshot.json",
            "playcounter-auto-123.tmp",
        ];
        for name in preserved {
            fs::write(directory.0.join(name), "untouched").unwrap();
        }
        let nested = directory
            .0
            .join(format!("{PREFIX}0-{}.json", Uuid::new_v4()));
        fs::create_dir(&nested).unwrap();
        let result = write_snapshot(&directory.0, BACKUP, 2).unwrap();
        assert!(result.cleanup_warning.is_none());
        assert!(Path::new(&result.path).exists());
        let managed: Vec<_> = fs::read_dir(&directory.0)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_type().unwrap().is_file())
            .filter_map(|entry| snapshot_stamp(&entry.file_name().to_string_lossy()))
            .collect();
        assert_eq!(managed.len(), 2);
        assert!(managed.contains(&3));
        for name in preserved {
            assert_eq!(
                fs::read_to_string(directory.0.join(name)).unwrap(),
                "untouched"
            );
        }
        assert!(nested.is_dir());
    }

    #[test]
    fn rejected_writes_preserve_existing_backups() {
        let directory = TestDirectory::new();
        let first = write_snapshot(&directory.0, BACKUP, 10).unwrap();
        assert!(write_snapshot(&directory.0, "broken JSON", 1).is_err());
        assert!(write_snapshot(&directory.0, BACKUP, 0).is_err());
        assert!(write_snapshot(&directory.0, BACKUP, 101).is_err());
        assert!(write_snapshot(Path::new(&first.path), BACKUP, 1).is_err());
        assert_eq!(fs::read_to_string(first.path).unwrap(), BACKUP);
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
    }

    #[test]
    fn clock_rollback_does_not_prune_the_backup_just_written() {
        let directory = TestDirectory::new();
        let future = directory
            .0
            .join(format!("{PREFIX}99999999999999-{}.json", Uuid::new_v4()));
        fs::write(&future, BACKUP).unwrap();
        let result = write_snapshot(&directory.0, BACKUP, 1).unwrap();
        assert!(Path::new(&result.path).is_file());
        assert!(!future.exists());
    }

    #[cfg(windows)]
    #[test]
    fn locked_old_backup_reports_cleanup_warning_after_saving_new_backup() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = TestDirectory::new();
        let first = write_snapshot(&directory.0, BACKUP, 10).unwrap();
        let _locked = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&first.path)
            .unwrap();
        let result = write_snapshot(&directory.0, BACKUP, 1).unwrap();
        assert!(result.cleanup_warning.is_some());
        assert_eq!(fs::read_to_string(result.path).unwrap(), BACKUP);
        assert!(Path::new(&first.path).exists());
    }
}
