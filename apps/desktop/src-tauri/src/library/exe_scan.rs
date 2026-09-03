use serde::Serialize;
use std::{
    collections::VecDeque,
    fs,
    path::Path,
    time::{Duration, Instant},
};

const MAX_SCAN_DEPTH: usize = 4;
const MAX_DIRECTORY_ENTRIES_PER_GAME: usize = 600;
const MAX_EXE_CANDIDATES_PER_GAME: usize = 40;
pub const EXE_WALK_BUDGET: Duration = Duration::from_secs(45);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedExecutable {
    pub file_name: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub depth: usize,
    /// True when MicrosoftGame.config declares this file as the title executable.
    pub declared: bool,
}

pub fn scan_executables(root: &Path, deadline: Instant) -> (Vec<ScannedExecutable>, bool) {
    let mut result = Vec::new();
    let mut pending = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut visited_entries = 0usize;
    let mut capped = false;
    while let Some((folder, depth)) = pending.pop_front() {
        if Instant::now() >= deadline || visited_entries >= MAX_DIRECTORY_ENTRIES_PER_GAME {
            capped = true;
            break;
        }
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            visited_entries += 1;
            if Instant::now() >= deadline || visited_entries > MAX_DIRECTORY_ENTRIES_PER_GAME {
                capped = true;
                break;
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() && !kind.is_symlink() && depth < MAX_SCAN_DEPTH {
                if !should_skip_directory(root, &path) {
                    if is_likely_executable_directory(&path) {
                        pending.push_front((path, depth + 1));
                    } else {
                        pending.push_back((path, depth + 1));
                    }
                }
            } else if kind.is_file()
                && path
                    .extension()
                    .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
            {
                let relative = path.strip_prefix(root).unwrap_or(&path);
                result.push(ScannedExecutable {
                    file_name: entry.file_name().to_string_lossy().to_string(),
                    relative_path: path_string(relative),
                    size_bytes: entry.metadata().map(|value| value.len()).unwrap_or(0),
                    depth,
                    declared: false,
                });
            }
        }
    }
    result.sort_by(|left, right| {
        left.depth
            .cmp(&right.depth)
            .then_with(|| right.size_bytes.cmp(&left.size_bytes))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    if result.len() > MAX_EXE_CANDIDATES_PER_GAME {
        result.truncate(MAX_EXE_CANDIDATES_PER_GAME);
        capped = true;
    }
    (result, capped)
}

pub fn executable_from_path(
    install_path: &str,
    executable_path: &str,
) -> Result<ScannedExecutable, String> {
    let install_root = fs::canonicalize(install_path)
        .map_err(|error| format!("Could not open the game's install folder: {error}"))?;
    let selected = fs::canonicalize(executable_path)
        .map_err(|error| format!("Could not open the file you picked: {error}"))?;
    if !selected.is_file()
        || !selected
            .extension()
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
    {
        return Err("Pick a Windows program file (.exe).".to_string());
    }
    let relative = selected
        .strip_prefix(&install_root)
        .map_err(|_| "Pick a file inside this game's install folder.".to_string())?;
    let file_name = selected
        .file_name()
        .ok_or("The file you picked has no name.")?
        .to_string_lossy()
        .to_string();
    let size_bytes = selected
        .metadata()
        .map_err(|error| format!("Could not read the file you picked: {error}"))?
        .len();
    Ok(ScannedExecutable {
        file_name,
        relative_path: path_string(relative),
        size_bytes,
        depth: relative.components().count().saturating_sub(1),
        declared: false,
    })
}

pub fn is_likely_executable_directory(path: &Path) -> bool {
    matches!(
        path.file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .as_deref(),
        Some("binaries" | "binary" | "bin" | "win64" | "win32" | "x64" | "x86")
    )
}

pub fn should_skip_directory(root: &Path, path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name == "_commonredist"
        || name.starts_with("redist")
        || name.starts_with("directx")
        || name.starts_with("dotnet")
        || name.starts_with("vcredist")
        || name == "thirdparty"
        || name.ends_with("_data")
        || name == "crashreportclient"
        || name == "__installer"
    {
        return true;
    }
    path.strip_prefix(root)
        .ok()
        .map(|relative| {
            relative
                .to_string_lossy()
                .replace('/', "\\")
                .to_ascii_lowercase()
                .contains("engine\\extras")
        })
        .unwrap_or(false)
}

pub fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_redistributable_and_engine_utility_directories() {
        let root = Path::new(r"C:\Games\Example");
        for child in [
            "_CommonRedist",
            "redist_x64",
            "DirectX",
            "dotnet48",
            "vcredist",
            "thirdparty",
            "Example_Data",
            "CrashReportClient",
            "__Installer",
        ] {
            assert!(should_skip_directory(root, &root.join(child)), "{child}");
        }
        assert!(should_skip_directory(
            root,
            &root.join("Engine").join("Extras")
        ));
        assert!(!should_skip_directory(root, &root.join("bin")));
    }

    #[test]
    fn prioritizes_binary_folders_before_large_content_trees() {
        let root =
            std::env::temp_dir().join(format!("playcounter-exe-scan-{}", uuid::Uuid::new_v4()));
        let binaries = root.join("Nuts").join("Binaries").join("Win64");
        let scripts = root.join("Nuts").join("Script");
        fs::create_dir_all(&binaries).unwrap();
        fs::create_dir_all(&scripts).unwrap();
        fs::write(binaries.join("ItTakesTwo.exe"), b"game").unwrap();
        for index in 0..=MAX_DIRECTORY_ENTRIES_PER_GAME {
            fs::write(scripts.join(format!("asset-{index}.bin")), b"asset").unwrap();
        }

        let (executables, capped) =
            scan_executables(&root, Instant::now() + Duration::from_secs(5));

        assert!(capped);
        assert!(executables
            .iter()
            .any(|entry| entry.relative_path.ends_with("ItTakesTwo.exe")));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn validates_a_manually_selected_executable_against_the_install_root() {
        let container =
            std::env::temp_dir().join(format!("playcounter-exe-picker-{}", uuid::Uuid::new_v4()));
        let install_root = container.join("Game");
        let executable = install_root.join("Binaries").join("Win64").join("Game.exe");
        let outside = container.join("Other.exe");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, b"game executable").unwrap();
        fs::write(&outside, b"other executable").unwrap();

        let selected =
            executable_from_path(install_root.to_str().unwrap(), executable.to_str().unwrap())
                .unwrap();
        assert_eq!(selected.file_name, "Game.exe");
        assert_eq!(selected.depth, 2);
        assert!(selected.relative_path.ends_with(r"Binaries\Win64\Game.exe"));
        assert!(!selected.declared);
        assert!(
            executable_from_path(install_root.to_str().unwrap(), outside.to_str().unwrap())
                .is_err()
        );

        fs::remove_dir_all(&container).unwrap();
    }
}
