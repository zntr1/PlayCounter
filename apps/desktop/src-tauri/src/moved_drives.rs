//! A disk that got another drive letter (docs/drive-letter-plan.md).
//!
//! When Windows gives a disk a new letter, every path PlayCounter stored on
//! it is gone. Like Playnite, a gone path is tried with every other drive
//! letter, and the first drive that has it wins. Only local disks are tried:
//! an offline network drive could stall the start for seconds.

use serde::Serialize;
use std::{fs, path::Path};

use crate::launch::{is_definitely_missing, volume_is_present};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedPathReport {
    pub path: String,
    pub moved_to: Option<String>,
}

/// The upper-case letter of `X:\…` or `X:/…`. None for anything else, such as
/// `\\server\share\…` or `\\?\X:\…`.
fn drive_letter(path: &str) -> Option<u8> {
    let bytes = path.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/'))
    .then(|| bytes[0].to_ascii_uppercase())
}

/// Where a gone path is now: the same path on the first of `drives` that has
/// it. None when the path still exists, has no drive letter, or no drive has
/// it.
pub(crate) fn find_moved_path(
    path: &str,
    drives: &[u8],
    is_gone: impl Fn(&Path) -> bool,
    exists: impl Fn(&Path) -> bool,
) -> Option<String> {
    let own = drive_letter(path)?;
    if !is_gone(Path::new(path)) {
        return None;
    }
    // The letter is one ASCII byte, so the rest starts at byte 1 (":\…").
    let rest = &path[1..];
    drives
        .iter()
        .filter(|letter| letter.to_ascii_uppercase() != own)
        .map(|letter| format!("{}{rest}", letter.to_ascii_uppercase() as char))
        .find(|candidate| exists(Path::new(candidate)))
}

/// Gone for sure: its drive is missing, or the drive says it has no such
/// path. A path PlayCounter may not read is not gone.
fn is_gone_here(path: &Path) -> bool {
    match fs::metadata(path) {
        Ok(_) => false,
        Err(error) => !volume_is_present(path) || is_definitely_missing(&error),
    }
}

fn exists_here(path: &Path) -> bool {
    fs::metadata(path).is_ok()
}

fn find_moved_path_here(path: &str, drives: &[u8]) -> Option<String> {
    find_moved_path(path, drives, is_gone_here, exists_here)
}

/// This PC's local disks (fixed and removable), A to Z.
#[cfg(windows)]
fn local_drive_letters() -> Vec<u8> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    // winbase.h; WindowsProgramming is not among the enabled features.
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;

    let present = unsafe { GetLogicalDrives() };
    (b'A'..=b'Z')
        .filter(|letter| present & (1 << (letter - b'A')) != 0)
        .filter(|letter| {
            let root: Vec<u16> = format!("{}:\\", *letter as char)
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let kind = unsafe { GetDriveTypeW(root.as_ptr()) };
            kind == DRIVE_FIXED || kind == DRIVE_REMOVABLE
        })
        .collect()
}

#[cfg(not(windows))]
fn local_drive_letters() -> Vec<u8> {
    Vec::new()
}

#[tauri::command]
pub async fn find_moved_paths(paths: Vec<String>) -> Vec<MovedPathReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let drives = local_drive_letters();
        paths
            .into_iter()
            .map(|path| {
                let moved_to = find_moved_path_here(&path, &drives);
                MovedPathReport { path, moved_to }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake PC: the paths in `there` exist, every other path is gone.
    fn pc(there: &'static [&'static str]) -> impl Fn(&Path) -> bool {
        move |path| there.iter().any(|item| Path::new(item) == path)
    }

    #[test]
    fn a_gone_path_moves_to_the_first_other_drive_that_has_it() {
        let there = pc(&[r"E:\Games\Tupac\Game.exe", r"F:\Games\Tupac\Game.exe"]);
        assert_eq!(
            find_moved_path(r"D:\Games\Tupac\Game.exe", b"CEF", |_| true, &there),
            Some(r"E:\Games\Tupac\Game.exe".to_string())
        );
        // A folder, written with forward slashes, keeps its spelling.
        let there = pc(&["F:/Games/Tupac"]);
        assert_eq!(
            find_moved_path("D:/Games/Tupac", b"CEF", |_| true, &there),
            Some("F:/Games/Tupac".to_string())
        );
    }

    #[test]
    fn a_path_that_still_exists_never_moves() {
        let there = pc(&[r"D:\Games\Tupac\Game.exe", r"E:\Games\Tupac\Game.exe"]);
        assert_eq!(
            find_moved_path(r"D:\Games\Tupac\Game.exe", b"CE", |_| false, &there),
            None
        );
    }

    #[test]
    fn a_path_no_other_drive_has_stays() {
        assert_eq!(
            find_moved_path(r"D:\Games\Tupac\Game.exe", b"CEF", |_| true, pc(&[])),
            None
        );
    }

    #[test]
    fn paths_without_a_drive_letter_never_move() {
        for path in [
            r"\\nas\games\Tupac\Game.exe",
            r"\\?\D:\Games\Tupac\Game.exe",
            r"Games\Tupac\Game.exe",
            "",
        ] {
            assert_eq!(find_moved_path(path, b"CDEF", |_| true, |_| true), None);
        }
    }

    #[cfg(windows)]
    fn letter_of(path: &Path) -> u8 {
        path.to_string_lossy().as_bytes()[0].to_ascii_uppercase()
    }

    #[cfg(windows)]
    fn temp_game() -> (std::path::PathBuf, std::path::PathBuf) {
        let folder =
            std::env::temp_dir().join(format!("playcounter-moved-drives-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let file = folder.join("Game.exe");
        fs::write(&file, b"MZ").unwrap();
        (folder, file)
    }

    /// A letter no drive on this PC has.
    #[cfg(windows)]
    fn missing_letter() -> u8 {
        let present = unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() };
        (b'D'..=b'Z')
            .rev()
            .find(|letter| present & (1 << (letter - b'A')) == 0)
            .expect("a free drive letter")
    }

    #[cfg(windows)]
    #[test]
    fn this_pcs_disk_is_on_the_drive_list() {
        let (folder, _) = temp_game();
        assert!(local_drive_letters().contains(&letter_of(&folder)));
        fs::remove_dir_all(folder).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_file_on_a_missing_letter_is_found_on_this_pcs_disk() {
        let (folder, file) = temp_game();
        let real = file.to_string_lossy().to_string();
        let gone = format!("{}{}", missing_letter() as char, &real[1..]);

        let found = find_moved_path_here(&gone, &local_drive_letters());

        assert_eq!(
            found.map(|path| path.to_lowercase()),
            Some(real.to_lowercase())
        );
        fs::remove_dir_all(folder).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_file_that_exists_on_this_pc_stays() {
        let (folder, file) = temp_game();
        let real = file.to_string_lossy().to_string();

        assert_eq!(find_moved_path_here(&real, &local_drive_letters()), None);
        fs::remove_dir_all(folder).unwrap();
    }
}
