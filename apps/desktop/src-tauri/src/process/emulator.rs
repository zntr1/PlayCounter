use std::{ffi::OsString, path::Path};

pub const DOLPHIN_CONTENT_EXTENSIONS: &[&str] = &[
    "elf", "dol", "gcm", "iso", "tgc", "wbfs", "ciso", "gcz", "wad", "dff", "wia", "rvz", "json",
];
pub const PCSX2_CONTENT_EXTENSIONS: &[&str] =
    &["iso", "bin", "img", "mdf", "chd", "cso", "zso", "gz", "elf"];
pub const MGBA_CONTENT_EXTENSIONS: &[&str] = &["gba", "gb", "gbc", "sgb", "zip", "7z"];
pub const CEMU_CONTENT_EXTENSIONS: &[&str] = &["wud", "wux", "wua", "wuhb", "iso", "rpx", "elf"];
/// Disc files DuckStation keeps open while a game runs.
pub const DUCKSTATION_DISC_EXTENSIONS: &[&str] = &["bin", "img", "iso", "chd", "pbp", "ecm", "mdf"];
/// melonDS's config is a few KB; anything far larger is not its config.
const MELONDS_CONFIG_MAX_BYTES: u64 = 256 * 1024;

pub struct EmulatorHost {
    pub id: &'static str,
    pub exe_names: &'static [&'static str],
    pub needs_command_line: bool,
    pub needs_window_title: bool,
    pub content_extensions: &'static [&'static str],
}

pub static EMULATOR_HOSTS: &[EmulatorHost] = &[
    EmulatorHost {
        id: "dosbox",
        exe_names: &[
            "dosbox.exe",
            "dosbox.com",
            "dosbox74.exe",
            "dosbox-x.exe",
            "dosbox_x.exe",
            "dosbox-staging.exe",
            "dosbox-staging-x64.exe",
        ],
        needs_command_line: true,
        needs_window_title: true,
        content_extensions: &[],
    },
    EmulatorHost {
        id: "dolphin",
        exe_names: &["dolphin.exe"],
        needs_command_line: true,
        needs_window_title: true,
        content_extensions: DOLPHIN_CONTENT_EXTENSIONS,
    },
    EmulatorHost {
        id: "pcsx2",
        exe_names: &[
            "pcsx2-qt.exe",
            "pcsx2-qtx64.exe",
            "pcsx2-qtx64-avx2.exe",
            "pcsx2.exe",
        ],
        needs_command_line: true,
        needs_window_title: true,
        content_extensions: PCSX2_CONTENT_EXTENSIONS,
    },
    EmulatorHost {
        id: "mgba",
        exe_names: &["mgba.exe", "mgba-sdl.exe"],
        needs_command_line: true,
        needs_window_title: true,
        // mGBA preloads ROMs into memory and closes the file by default, so
        // open handles are not a signal. The window title is.
        content_extensions: &[],
    },
    EmulatorHost {
        id: "cemu",
        exe_names: &["cemu.exe"],
        needs_command_line: true,
        needs_window_title: true,
        // The window title carries the title ID of the running game.
        content_extensions: &[],
    },
    EmulatorHost {
        id: "rpcs3",
        exe_names: &["rpcs3.exe"],
        needs_command_line: true,
        needs_window_title: true,
        // The game window's title carries the serial.
        content_extensions: &[],
    },
    EmulatorHost {
        id: "ppsspp",
        exe_names: &[
            "ppssppwindows64.exe",
            "ppssppwindows.exe",
            "ppssppwindowsarm64.exe",
        ],
        needs_command_line: true,
        needs_window_title: true,
        // The window title carries the disc ID.
        content_extensions: &[],
    },
    EmulatorHost {
        id: "duckstation",
        exe_names: &[
            "duckstation-qt-x64-releaseltcg.exe",
            "duckstation-qt-x64-releaseltcg-sse2.exe",
            "duckstation-qt-arm64-releaseltcg.exe",
        ],
        needs_command_line: true,
        needs_window_title: true,
        // The title is only the game's name; the open disc file identifies it.
        content_extensions: DUCKSTATION_DISC_EXTENSIONS,
    },
    EmulatorHost {
        id: "ryujinx",
        exe_names: &["ryujinx.exe"],
        needs_command_line: true,
        needs_window_title: true,
        // The window title carries the program ID.
        content_extensions: &[],
    },
    EmulatorHost {
        id: "eden",
        exe_names: &["eden.exe"],
        needs_command_line: true,
        needs_window_title: true,
        // The window title carries the game's name.
        content_extensions: &[],
    },
    EmulatorHost {
        id: "azahar",
        exe_names: &["azahar.exe"],
        needs_command_line: true,
        needs_window_title: true,
        // The window title carries the game's name.
        content_extensions: &[],
    },
    EmulatorHost {
        id: "melonds",
        exe_names: &["melonds.exe"],
        needs_command_line: true,
        // The title only says whether a game runs; melonds_recent_rom names it.
        needs_window_title: true,
        content_extensions: &[],
    },
    EmulatorHost {
        id: "xenia",
        exe_names: &["xenia_canary.exe", "xenia.exe"],
        needs_command_line: true,
        needs_window_title: true,
        // The window title carries the title ID.
        content_extensions: &[],
    },
];

pub fn host_for(exe_name: &str) -> Option<&'static EmulatorHost> {
    EMULATOR_HOSTS.iter().find(|host| {
        host.exe_names
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(exe_name))
    })
}

pub fn sanitize_args(args: &[OsString]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|arg| arg.to_str())
        .take(32)
        .map(|arg| arg.chars().take(512).collect())
        .collect()
}

/// melonDS reads a ROM into memory and closes it, and its title never names
/// the game. After every load it moves the ROM to the top of `RecentROM` in
/// melonDS.toml and saves, so that entry is the running game. Windows builds
/// keep the file next to the exe, or in "portable" when that folder exists.
pub fn melonds_recent_rom(exe_path: &str) -> Option<String> {
    let exe_dir = Path::new(exe_path).parent()?;
    let portable = exe_dir.join("portable");
    let config_dir = if portable.is_dir() {
        portable
    } else {
        exe_dir.to_path_buf()
    };
    let config = config_dir.join("melonDS.toml");
    if std::fs::metadata(&config).ok()?.len() > MELONDS_CONFIG_MAX_BYTES {
        return None;
    }
    first_recent_rom(&std::fs::read_to_string(config).ok()?)
}

/// `RecentROM = ["D:\\DS\\game.nds", "D:\\DS\\games.zip|other.nds"]`
fn first_recent_rom(config: &str) -> Option<String> {
    let table = config.parse::<toml::Table>().ok()?;
    let first = table.get("RecentROM")?.as_array()?.first()?.as_str()?;
    (!first.trim().is_empty() && first.chars().count() <= 1024).then(|| first.to_string())
}

#[cfg(target_os = "windows")]
pub fn window_titles_for(
    pids: &std::collections::HashSet<u32>,
) -> std::collections::HashMap<u32, String> {
    use std::collections::HashMap;
    use windows_sys::Win32::{
        Foundation::{BOOL, HWND, LPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
            IsWindowVisible,
        },
    };

    struct EnumContext<'a> {
        pids: &'a std::collections::HashSet<u32>,
        titles: HashMap<u32, String>,
    }

    unsafe extern "system" fn visit_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam as *mut EnumContext<'_>);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let mut pid = 0_u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if !context.pids.contains(&pid) {
            return 1;
        }

        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return 1;
        }
        let capacity = (length as usize + 1).min(257);
        let mut buffer = vec![0_u16; capacity];
        let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), capacity as i32);
        if copied <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buffer[..copied as usize]);
        if title.trim().is_empty() {
            return 1;
        }

        let replace = context
            .titles
            .get(&pid)
            .map(|existing| title.len() > existing.len())
            .unwrap_or(true);
        if replace {
            context.titles.insert(pid, title);
        }
        1
    }

    let mut context = EnumContext {
        pids,
        titles: HashMap::new(),
    };
    unsafe {
        EnumWindows(
            Some(visit_window),
            &mut context as *mut EnumContext<'_> as LPARAM,
        );
    }
    context.titles
}

#[cfg(target_os = "windows")]
pub fn request_close_windows(pids: &std::collections::HashSet<u32>) -> usize {
    use windows_sys::Win32::{
        Foundation::{BOOL, HWND, LPARAM, WPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
        },
    };

    struct EnumContext<'a> {
        pids: &'a std::collections::HashSet<u32>,
        posted: usize,
    }

    unsafe extern "system" fn visit_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam as *mut EnumContext<'_>);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let mut pid = 0_u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if context.pids.contains(&pid)
            && PostMessageW(hwnd, WM_CLOSE, 0 as WPARAM, 0 as LPARAM) != 0
        {
            context.posted += 1;
        }
        1
    }

    let mut context = EnumContext { pids, posted: 0 };
    unsafe {
        EnumWindows(
            Some(visit_window),
            &mut context as *mut EnumContext<'_> as LPARAM,
        );
    }
    context.posted
}

#[cfg(target_os = "windows")]
pub fn open_content_files(pid: u32, extensions: &[&str]) -> Option<Vec<String>> {
    use std::{collections::HashSet, ffi::c_void, mem, ptr};
    use windows_sys::{
        Wdk::System::Threading::{NtQueryInformationProcess, ProcessHandleInformation},
        Win32::{
            Foundation::{CloseHandle, DuplicateHandle, DUPLICATE_SAME_ACCESS, HANDLE},
            Storage::FileSystem::{GetFileType, GetFinalPathNameByHandleW, FILE_TYPE_DISK},
            System::Threading::{
                GetCurrentProcess, OpenProcess, PROCESS_DUP_HANDLE, PROCESS_QUERY_INFORMATION,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    };

    const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC0000004_u32 as i32;
    const MAX_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;
    const MAX_HANDLES: usize = 16_384;
    const MAX_CONTENT_PATHS: usize = 8;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ProcessHandleTableEntryInfo {
        handle_value: HANDLE,
        handle_count: usize,
        pointer_count: usize,
        granted_access: u32,
        object_type_index: u32,
        handle_attributes: u32,
        reserved: u32,
    }

    #[repr(C)]
    struct ProcessHandleSnapshotHeader {
        number_of_handles: usize,
        reserved: usize,
    }

    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    fn supported_content_path(path: &str, extensions: &[&str]) -> bool {
        path.rsplit_once('.').is_some_and(|(_, ext)| {
            extensions
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(ext))
        })
    }

    fn normalize_final_path(path: String) -> String {
        if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
    }

    unsafe fn final_path(handle: HANDLE) -> Option<String> {
        if GetFileType(handle) != FILE_TYPE_DISK {
            return None;
        }
        let required = GetFinalPathNameByHandleW(handle, ptr::null_mut(), 0, 0);
        if required == 0 || required > 32_767 {
            return None;
        }
        let mut buffer = vec![0_u16; required as usize + 1];
        let copied = GetFinalPathNameByHandleW(handle, buffer.as_mut_ptr(), buffer.len() as u32, 0);
        if copied == 0 || copied as usize >= buffer.len() {
            return None;
        }
        Some(normalize_final_path(String::from_utf16_lossy(
            &buffer[..copied as usize],
        )))
    }

    let process = unsafe {
        OpenProcess(
            PROCESS_DUP_HANDLE | PROCESS_QUERY_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        )
    };
    if process.is_null() {
        return None;
    }
    let process = OwnedHandle(process);

    // NtQueryInformationProcess writes pointer-sized fields. A usize buffer
    // guarantees the alignment that casting the returned snapshot requires.
    let word_size = mem::size_of::<usize>();
    let mut buffer = vec![0_usize; (64 * 1024) / word_size];
    loop {
        let mut required = 0_u32;
        let buffer_bytes = buffer.len() * word_size;
        let status = unsafe {
            NtQueryInformationProcess(
                process.0,
                ProcessHandleInformation,
                buffer.as_mut_ptr().cast::<c_void>(),
                buffer_bytes as u32,
                &mut required,
            )
        };
        if status >= 0 {
            break;
        }
        if status != STATUS_INFO_LENGTH_MISMATCH {
            return None;
        }
        let next_size = (required as usize)
            .max(buffer_bytes.saturating_mul(2))
            .min(MAX_SNAPSHOT_BYTES);
        if next_size <= buffer_bytes {
            return None;
        }
        buffer.resize(next_size.div_ceil(word_size), 0);
    }

    let buffer_bytes = buffer.len() * word_size;
    if buffer_bytes < mem::size_of::<ProcessHandleSnapshotHeader>() {
        return None;
    }
    let header = unsafe { &*(buffer.as_ptr().cast::<ProcessHandleSnapshotHeader>()) };
    let available_entries = buffer_bytes
        .saturating_sub(mem::size_of::<ProcessHandleSnapshotHeader>())
        / mem::size_of::<ProcessHandleTableEntryInfo>();
    let count = header
        .number_of_handles
        .min(available_entries)
        .min(MAX_HANDLES);
    let entries = unsafe {
        std::slice::from_raw_parts(
            buffer
                .as_ptr()
                .cast::<u8>()
                .add(mem::size_of::<ProcessHandleSnapshotHeader>())
                .cast::<ProcessHandleTableEntryInfo>(),
            count,
        )
    };

    let current_process = unsafe { GetCurrentProcess() };
    let mut seen = HashSet::new();
    let mut content_paths = Vec::new();
    for entry in entries {
        let mut duplicated: HANDLE = ptr::null_mut();
        let duplicated_ok = unsafe {
            DuplicateHandle(
                process.0,
                entry.handle_value,
                current_process,
                &mut duplicated,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if duplicated_ok == 0 || duplicated.is_null() {
            continue;
        }
        let duplicated = OwnedHandle(duplicated);
        let Some(path) = (unsafe { final_path(duplicated.0) }) else {
            continue;
        };
        if supported_content_path(&path, extensions) && seen.insert(path.to_ascii_lowercase()) {
            content_paths.push(path);
            if content_paths.len() >= MAX_CONTENT_PATHS {
                break;
            }
        }
    }
    Some(content_paths)
}

#[cfg(test)]
mod tests {
    use super::{host_for, sanitize_args};
    use std::ffi::OsString;

    #[test]
    fn matches_hosts_exactly_and_case_insensitively() {
        assert_eq!(host_for("DOSBox.exe").map(|host| host.id), Some("dosbox"));
        assert_eq!(host_for("DOLPHIN.EXE").map(|host| host.id), Some("dolphin"));
        assert!(host_for("notdosbox.exe").is_none());
        assert!(host_for("dolphin-tool.exe").is_none());
        for name in [
            "PCSX2-QT.EXE",
            "pcsx2-qtx64.exe",
            "pcsx2-qtx64-avx2.exe",
            "pcsx2.exe",
        ] {
            assert_eq!(host_for(name).map(|host| host.id), Some("pcsx2"));
        }
        for name in [
            "notpcsx2.exe",
            "pcsx2-updater.exe",
            "pcsx2-qt-helper.exe",
            "pcsx2-gsrunner.exe",
        ] {
            assert!(host_for(name).is_none());
        }
        for name in ["mGBA.exe", "MGBA-SDL.EXE"] {
            assert_eq!(host_for(name).map(|host| host.id), Some("mgba"));
        }
        for name in ["mgba-updater.exe", "notmgba.exe", "mgba-qt.exe"] {
            assert!(host_for(name).is_none());
        }
        assert_eq!(host_for("Cemu.exe").map(|host| host.id), Some("cemu"));
        for name in ["cemu_release.exe", "notcemu.exe", "cemuhook.exe"] {
            assert!(host_for(name).is_none());
        }
        for (name, id) in [
            ("rpcs3.exe", "rpcs3"),
            ("PPSSPPWindows64.exe", "ppsspp"),
            ("PPSSPPWindows.exe", "ppsspp"),
            ("PPSSPPWindowsARM64.exe", "ppsspp"),
            ("duckstation-qt-x64-ReleaseLTCG.exe", "duckstation"),
            ("duckstation-qt-x64-ReleaseLTCG-SSE2.exe", "duckstation"),
            ("duckstation-qt-ARM64-ReleaseLTCG.exe", "duckstation"),
            ("Ryujinx.exe", "ryujinx"),
            ("eden.exe", "eden"),
            ("azahar.exe", "azahar"),
            ("melonDS.exe", "melonds"),
            ("xenia_canary.exe", "xenia"),
            ("xenia.exe", "xenia"),
        ] {
            assert_eq!(host_for(name).map(|host| host.id), Some(id));
        }
        for name in [
            "rpcs3-updater.exe",
            "ppsspp.exe",
            "updater-x64-ReleaseLTCG.exe",
            "duckstation.exe",
            "Ryujinx.Headless.SDL3.exe",
            "eden-cli.exe",
            "yuzu.exe",
            "azahar-room.exe",
            "citra-qt.exe",
            "melonDS-x64.exe",
            "xenia-canary.exe",
            "xenia_canary_netplay.exe",
        ] {
            assert!(host_for(name).is_none());
        }
    }

    #[test]
    fn reads_the_newest_melonds_rom() {
        let config = r#"
LastROMFolder = "D:\\DS"
RecentROM = ["D:\\DS\\Pokemon - Platinum Version (USA).nds", "D:\\DS\\old.nds"]

[Instance0]
JoystickID = 0
"#;
        assert_eq!(
            super::first_recent_rom(config).as_deref(),
            Some(r"D:\DS\Pokemon - Platinum Version (USA).nds")
        );
        let multiline = r"RecentROM = [
  'D:\DS\games.zip|Mario Kart DS (USA).nds',
]
";
        assert_eq!(
            super::first_recent_rom(multiline).as_deref(),
            Some(r"D:\DS\games.zip|Mario Kart DS (USA).nds")
        );
        for config in [
            "RecentROM = []",
            r#"RecentROM = [""]"#,
            "[Instance0]\nRecentROM = ['D:/DS/game.nds']",
            "RecentROM = 'D:/DS/game.nds'",
            "RecentROM = ['D:/DS/game.nds'",
            "",
        ] {
            assert_eq!(super::first_recent_rom(config), None, "{config}");
        }
    }

    #[test]
    fn finds_the_melonds_config_next_to_the_exe_or_in_portable() {
        let dir = std::env::temp_dir().join(format!(
            "playcounter-melonds-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("melonDS.exe");
        let exe = exe.to_str().unwrap();
        assert_eq!(super::melonds_recent_rom(exe), None);

        std::fs::write(dir.join("melonDS.toml"), r"RecentROM = ['D:\next.nds']").unwrap();
        assert_eq!(
            super::melonds_recent_rom(exe).as_deref(),
            Some(r"D:\next.nds")
        );

        std::fs::create_dir(dir.join("portable")).unwrap();
        assert_eq!(super::melonds_recent_rom(exe), None);
        std::fs::write(
            dir.join("portable").join("melonDS.toml"),
            r"RecentROM = ['D:\portable.nds']",
        )
        .unwrap();
        assert_eq!(
            super::melonds_recent_rom(exe).as_deref(),
            Some(r"D:\portable.nds")
        );

        std::fs::write(
            dir.join("portable").join("melonDS.toml"),
            format!("RecentROM = ['D:/big.nds']\n#{}", "x".repeat(300 * 1024)),
        )
        .unwrap();
        assert_eq!(super::melonds_recent_rom(exe), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sanitizes_and_caps_arguments() {
        let mut args = vec![OsString::from("dosbox.exe")];
        args.extend((0..40).map(|_| OsString::from("x".repeat(600))));
        let sanitized = sanitize_args(&args);
        assert_eq!(sanitized.len(), 32);
        assert!(sanitized.iter().all(|arg| arg.chars().count() == 512));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn finds_a_supported_file_held_open_by_a_process() {
        let file_name = format!(
            "playcounter-open-content-{}-{}.rvz",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(&file_name);
        let file = std::fs::File::create(&path).expect("create test content");

        let paths =
            super::open_content_files(std::process::id(), super::DOLPHIN_CONTENT_EXTENSIONS)
                .unwrap();
        assert!(paths.iter().any(|candidate| {
            candidate
                .replace('/', "\\")
                .to_ascii_lowercase()
                .ends_with(&file_name.to_ascii_lowercase())
        }));

        drop(file);
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn captures_pcsx2_disc_files_and_distinguishes_unavailable_access() {
        let name = format!("playcounter-pcsx2-{}.CHD", std::process::id());
        let path = std::env::temp_dir().join(&name);
        let file = std::fs::File::create(&path).unwrap();
        let paths =
            super::open_content_files(std::process::id(), super::PCSX2_CONTENT_EXTENSIONS).unwrap();
        assert!(paths.iter().any(|candidate| candidate.ends_with(&name)));
        let dolphin =
            super::open_content_files(std::process::id(), super::DOLPHIN_CONTENT_EXTENSIONS)
                .unwrap();
        assert!(!dolphin.iter().any(|candidate| candidate.ends_with(&name)));
        assert!(super::open_content_files(0, super::PCSX2_CONTENT_EXTENSIONS).is_none());
        drop(file);
        std::fs::remove_file(path).unwrap();
    }
}
