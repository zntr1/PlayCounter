//! Where screenshots go and what they're called. Files are named after the
//! game and the local time ("Elden Ring 2026-11-07 19-14-03.jpg") in one
//! folder per game, so they make sense without PlayCounter too.

use std::path::{Path, PathBuf};

/// A local date and time, as Windows reports it.
#[derive(Clone, Copy, Debug)]
pub struct LocalTime {
    pub year: u16,
    pub month: u16,
    pub day: u16,
    pub hour: u16,
    pub minute: u16,
    pub second: u16,
}

/// A folder or file name made from a game's name: no characters Windows
/// forbids, no dots or spaces at the end, at most 80 characters, never a
/// device name like CON. "Screenshot" when nothing is left.
pub fn clean_file_name(name: &str) -> String {
    const FORBIDDEN: &str = r#"<>:"/\|?*"#;
    const MAX_CHARS: usize = 80;
    // Windows keeps these for devices, with or without an extension.
    const DEVICES: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let kept: String = name
        .chars()
        .filter(|c| !c.is_control() && !FORBIDDEN.contains(*c))
        .collect();
    let cut: String = kept.trim().chars().take(MAX_CHARS).collect();
    let cleaned = cut.trim_end_matches(['.', ' ']).trim();
    if cleaned.is_empty() {
        return "Screenshot".into();
    }
    let device = cleaned.split('.').next().unwrap_or_default();
    if DEVICES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(device))
    {
        return format!("{cleaned}_");
    }
    cleaned.to_string()
}

/// "Elden Ring 2026-11-07 19-14-03": the game and the local time.
pub fn screenshot_stem(game: &str, time: &LocalTime) -> String {
    format!(
        "{} {:04}-{:02}-{:02} {:02}-{:02}-{:02}",
        clean_file_name(game),
        time.year,
        time.month,
        time.day,
        time.hour,
        time.minute,
        time.second
    )
}

/// The first free name: "stem.ext", then "stem (2).ext", "stem (3).ext", …
pub fn unique_path(folder: &Path, stem: &str, extension: &str) -> PathBuf {
    let mut path = folder.join(format!("{stem}.{extension}"));
    let mut number = 2;
    while path.exists() {
        path = folder.join(format!("{stem} ({number}).{extension}"));
        number += 1;
    }
    path
}

/// The preview's file name for a picture. It changes with the picture's path,
/// size or time, so an edited picture gets a new preview.
pub fn preview_name(relative_path: &str, bytes: u64, modified_ms: i64) -> String {
    let key = format!(
        "{}|{bytes}|{modified_ms}",
        relative_path.replace('\\', "/").to_lowercase()
    );
    let digest = ring::digest::digest(&ring::digest::SHA256, key.as_bytes());
    let hex: String = digest.as_ref()[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{hex}.jpg")
}

/// Picture types the app can show.
pub fn is_picture(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["jpg", "jpeg", "png", "webp"]
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
        })
}

/// The picture's resolved path when it is a picture inside `root`, after
/// resolving ".." and links. PlayCounter only shows, opens and deletes its
/// own pictures.
pub fn picture_inside(root: &Path, path: &Path) -> Option<PathBuf> {
    let root = std::fs::canonicalize(root).ok()?;
    let path = std::fs::canonicalize(path).ok()?;
    (path.starts_with(&root) && path.is_file() && is_picture(&path)).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempFolder(PathBuf);

    impl TempFolder {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("playcounter-screenshots-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempFolder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn removes_characters_windows_forbids() {
        assert_eq!(
            clean_file_name("Halo: The Master Chief Collection"),
            "Halo The Master Chief Collection"
        );
        assert_eq!(
            clean_file_name("What? <Why> \"Not\" A/B\\C|D*"),
            "What Why Not ABCD"
        );
        assert_eq!(clean_file_name("Tab\there"), "Tabhere");
    }

    #[test]
    fn keeps_letters_from_every_language() {
        assert_eq!(clean_file_name("Pokémon Légendes"), "Pokémon Légendes");
        assert_eq!(clean_file_name("ゼルダの伝説"), "ゼルダの伝説");
        assert_eq!(clean_file_name("Ведьмак 3"), "Ведьмак 3");
    }

    #[test]
    fn drops_dots_and_spaces_at_the_ends() {
        assert_eq!(clean_file_name("  Game...  "), "Game");
        assert_eq!(clean_file_name("S.T.A.L.K.E.R."), "S.T.A.L.K.E.R");
    }

    #[test]
    fn cuts_long_names_to_80_characters() {
        // The cut lands on a space, which then goes too.
        let long = "A".repeat(79) + " B and more";
        assert_eq!(clean_file_name(&long), "A".repeat(79));
        assert_eq!(clean_file_name(&"é".repeat(100)).chars().count(), 80);
    }

    #[test]
    fn never_uses_a_device_name() {
        assert_eq!(clean_file_name("CON"), "CON_");
        assert_eq!(clean_file_name("nul"), "nul_");
        assert_eq!(clean_file_name("com1"), "com1_");
        assert_eq!(clean_file_name("Aux.Game"), "Aux.Game_");
        assert_eq!(clean_file_name("Console"), "Console");
    }

    #[test]
    fn falls_back_when_nothing_is_left() {
        assert_eq!(clean_file_name(""), "Screenshot");
        assert_eq!(clean_file_name("???"), "Screenshot");
        assert_eq!(clean_file_name(" . "), "Screenshot");
    }

    #[test]
    fn names_a_screenshot_after_the_game_and_the_local_time() {
        let time = LocalTime {
            year: 2026,
            month: 11,
            day: 7,
            hour: 9,
            minute: 4,
            second: 3,
        };
        assert_eq!(
            screenshot_stem("Halo: Reach", &time),
            "Halo Reach 2026-11-07 09-04-03"
        );
    }

    #[test]
    fn numbers_a_second_picture_in_the_same_second() {
        let folder = TempFolder::new();
        let folder = &folder.0;
        assert_eq!(unique_path(folder, "A", "jpg"), folder.join("A.jpg"));
        fs::write(folder.join("A.jpg"), b"x").unwrap();
        assert_eq!(unique_path(folder, "A", "jpg"), folder.join("A (2).jpg"));
        fs::write(folder.join("A (2).jpg"), b"x").unwrap();
        assert_eq!(unique_path(folder, "A", "jpg"), folder.join("A (3).jpg"));
    }

    #[test]
    fn gives_an_edited_picture_a_new_preview() {
        let name = "Elden Ring/Elden Ring 2026-11-07 19-14-03.jpg";
        let first = preview_name(name, 1000, 5);
        // Windows paths ignore case and use either slash.
        assert_eq!(
            first,
            preview_name("elden ring\\ELDEN RING 2026-11-07 19-14-03.jpg", 1000, 5)
        );
        assert_ne!(first, preview_name(name, 1001, 5));
        assert_ne!(first, preview_name(name, 1000, 6));
        assert_ne!(first, preview_name("Elden Ring/other.jpg", 1000, 5));
        let stem = first.strip_suffix(".jpg").expect("a .jpg name");
        assert!(stem.len() >= 16 && stem.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn knows_the_pictures_the_app_can_show() {
        for name in ["a.jpg", "a.JPEG", "a.png", "a.webp"] {
            assert!(is_picture(Path::new(name)), "{name}");
        }
        for name in ["a.jxr", "a.txt", "a", "a.jpg.lnk"] {
            assert!(!is_picture(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn only_accepts_pictures_inside_the_screenshots_folder() {
        let temp = TempFolder::new();
        let root = temp.0.join("PlayCounter");
        fs::create_dir_all(root.join("Game")).unwrap();
        fs::write(root.join("Game").join("a.jpg"), b"x").unwrap();
        fs::write(root.join("Game").join("notes.txt"), b"x").unwrap();
        fs::write(temp.0.join("outside.jpg"), b"x").unwrap();

        assert!(picture_inside(&root, &root.join("Game").join("a.jpg")).is_some());
        assert!(picture_inside(&root, &temp.0.join("outside.jpg")).is_none());
        let sneaky = root.join("Game").join("..").join("..").join("outside.jpg");
        assert!(picture_inside(&root, &sneaky).is_none());
        assert!(picture_inside(&root, &root.join("Game").join("notes.txt")).is_none());
        assert!(picture_inside(&root, &root.join("Game").join("missing.jpg")).is_none());
    }
}
