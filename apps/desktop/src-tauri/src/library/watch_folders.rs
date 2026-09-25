//! Folders the user asked PlayCounter to watch for games outside any launcher.
//! Every folder directly inside a watched folder counts as one game.

use super::exe_scan::{path_string, scan_executables, ScannedExecutable, EXE_WALK_BUDGET};
use crate::launch::is_absolute_windows_path;
use serde::Serialize;
use std::{fs, path::Path, time::Instant};

/// A watched folder with thousands of entries is not a games folder.
const MAX_CHILDREN_PER_FOLDER: usize = 2_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFolder {
    pub watch_folder: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFolderListing {
    pub game_folders: Vec<GameFolder>,
    /// Watched folders that could be read. A folder on an unplugged drive is
    /// left out, so its games are not mistaken for deleted ones.
    pub readable: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFolderScan {
    pub executables: Vec<ScannedExecutable>,
    /// The walk stopped at its budget; the folder is worth another look later.
    pub capped: bool,
}

#[tauri::command]
pub async fn watch_folder_game_folders(folders: Vec<String>) -> WatchFolderListing {
    tauri::async_runtime::spawn_blocking(move || {
        let mut listing = WatchFolderListing {
            game_folders: Vec::new(),
            readable: Vec::new(),
        };
        for folder in folders {
            if let Some(found) = game_folders(&folder) {
                listing.game_folders.extend(found);
                listing.readable.push(folder);
            }
        }
        listing
    })
    .await
    .unwrap_or(WatchFolderListing {
        game_folders: Vec::new(),
        readable: Vec::new(),
    })
}

#[tauri::command]
pub async fn watch_folder_scan(path: String) -> Result<GameFolderScan, String> {
    tauri::async_runtime::spawn_blocking(move || scan_game_folder(&path))
        .await
        .map_err(|error| error.to_string())?
}

/// `None` when the watched folder cannot be read right now.
fn game_folders(watch_folder: &str) -> Option<Vec<GameFolder>> {
    if !is_absolute_windows_path(watch_folder) {
        return None;
    }
    let entries = fs::read_dir(watch_folder).ok()?;
    if launcher_managed(Path::new(watch_folder)) {
        return Some(Vec::new());
    }
    let mut folders = entries
        .flatten()
        .take(MAX_CHILDREN_PER_FOLDER)
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|file_type| file_type.is_dir() && !file_type.is_symlink())
        })
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            (!system_folder(&name) && !launcher_managed(&path)).then(|| GameFolder {
                watch_folder: watch_folder.to_string(),
                path: path_string(&path),
                name,
            })
        })
        .collect::<Vec<_>>();
    folders.sort_by(|left, right| left.path.cmp(&right.path));
    Some(folders)
}

fn scan_game_folder(path: &str) -> Result<GameFolderScan, String> {
    let folder = Path::new(path);
    if !is_absolute_windows_path(path) || !folder.is_dir() {
        return Err("This game folder no longer exists.".to_string());
    }
    let (executables, capped) = scan_executables(folder, Instant::now() + EXE_WALK_BUDGET);
    Ok(GameFolderScan {
        executables,
        capped,
    })
}

fn system_folder(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with('$')
        || name.eq_ignore_ascii_case("System Volume Information")
}

/// Folders a launcher already manages; their games come from launcher imports.
fn launcher_managed(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    name.eq_ignore_ascii_case("XboxGames")
        || path
            .components()
            .any(|part| part.as_os_str().eq_ignore_ascii_case("steamapps"))
        // A Steam library root.
        || path.join("steamapps").is_dir()
        // A Battle.net installation.
        || path.join(".build.info").is_file()
        // An Xbox app installation.
        || path.join("Content").join("MicrosoftGame.config").is_file()
        || path.join("MicrosoftGame.config").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("playcounter-watch-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn lists_game_folders_and_skips_launcher_folders() {
        let root = temp_root();
        for folder in ["Hollow Knight", "Celeste", "$RECYCLE.BIN", ".cache"] {
            fs::create_dir_all(root.join(folder)).unwrap();
        }
        fs::create_dir_all(root.join("SteamLibrary").join("steamapps")).unwrap();
        fs::create_dir_all(root.join("XboxGames")).unwrap();
        fs::create_dir_all(root.join("Diablo IV")).unwrap();
        fs::write(root.join("Diablo IV").join(".build.info"), "").unwrap();
        fs::create_dir_all(root.join("Halo").join("Content")).unwrap();
        fs::write(
            root.join("Halo")
                .join("Content")
                .join("MicrosoftGame.config"),
            "",
        )
        .unwrap();
        fs::write(root.join("readme.txt"), "").unwrap();

        let watch = path_string(&root);
        let names = game_folders(&watch)
            .unwrap()
            .into_iter()
            .map(|folder| folder.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["Celeste", "Hollow Knight"]);

        // Watching a Steam library itself finds nothing.
        let steam = path_string(&root.join("SteamLibrary").join("steamapps"));
        assert_eq!(game_folders(&steam).unwrap().len(), 0);
        // Unreadable or invalid watched folders are reported as such.
        assert!(game_folders(&path_string(&root.join("Missing"))).is_none());
        assert!(game_folders("relative\\folder").is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scans_one_game_folder() {
        let root = temp_root();
        let game = root.join("Celeste");
        fs::create_dir_all(&game).unwrap();
        fs::write(game.join("Celeste.exe"), vec![0; 128 * 1024]).unwrap();

        let scan = scan_game_folder(&path_string(&game)).unwrap();
        assert_eq!(scan.executables.len(), 1);
        assert_eq!(scan.executables[0].file_name, "Celeste.exe");
        assert!(!scan.capped);
        assert!(scan_game_folder(&path_string(&root.join("Missing"))).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
