use std::path::Path;

/// Steam installs every app into `<library>\steamapps\common\<folder>\`.
/// A PlayCounter started from such a folder is the Steam copy: Steam
/// delivers its updates, so it must not update itself.
pub fn is_steam_install(exe: &Path) -> bool {
    // Split by hand, not by `components()`, so the Windows paths in the
    // tests mean the same on every OS.
    let parts: Vec<String> = exe
        .to_string_lossy()
        .split(['\\', '/'])
        .map(str::to_ascii_lowercase)
        .collect();
    parts
        .windows(2)
        .any(|pair| pair[0] == "steamapps" && pair[1] == "common")
}

/// "steam" for the Steam copy, "direct" for the one from the website.
#[tauri::command]
pub fn install_source() -> &'static str {
    match std::env::current_exe() {
        Ok(exe) if is_steam_install(&exe) => "steam",
        _ => "direct",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_steam_library_is_steam() {
        assert!(is_steam_install(Path::new(
            r"C:\Program Files (x86)\Steam\steamapps\common\PlayCounter\playcounter.exe"
        )));
    }

    #[test]
    fn a_steam_library_on_another_drive_is_steam() {
        assert!(is_steam_install(Path::new(
            r"D:\SteamLibrary\steamapps\common\PlayCounter\playcounter.exe"
        )));
    }

    #[test]
    fn case_does_not_matter() {
        assert!(is_steam_install(Path::new(
            r"D:\STEAMLIBRARY\SteamApps\Common\PlayCounter\playcounter.exe"
        )));
    }

    #[test]
    fn the_installer_folder_is_direct() {
        assert!(!is_steam_install(Path::new(
            r"C:\Users\phil\AppData\Local\PlayCounter\playcounter.exe"
        )));
    }

    #[test]
    fn a_folder_only_named_like_steamapps_is_direct() {
        assert!(!is_steam_install(Path::new(
            r"D:\steamapps-backup\common\playcounter.exe"
        )));
    }
}
