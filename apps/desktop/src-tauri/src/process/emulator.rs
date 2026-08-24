use std::ffi::OsString;

pub struct EmulatorHost {
    pub id: &'static str,
    pub exe_names: &'static [&'static str],
    pub needs_command_line: bool,
    pub needs_window_title: bool,
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
    },
    EmulatorHost {
        id: "dolphin",
        exe_names: &["dolphin.exe"],
        needs_command_line: true,
        needs_window_title: true,
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
pub fn open_content_files(pid: u32) -> Vec<String> {
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

    fn supported_content_path(path: &str) -> bool {
        let lower = path.to_ascii_lowercase();
        [
            ".elf", ".dol", ".gcm", ".iso", ".tgc", ".wbfs", ".ciso", ".gcz", ".wad", ".dff",
            ".wia", ".rvz", ".json",
        ]
        .iter()
        .any(|extension| lower.ends_with(extension))
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
        return Vec::new();
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
            return Vec::new();
        }
        let next_size = (required as usize)
            .max(buffer_bytes.saturating_mul(2))
            .min(MAX_SNAPSHOT_BYTES);
        if next_size <= buffer_bytes {
            return Vec::new();
        }
        buffer.resize(next_size.div_ceil(word_size), 0);
    }

    let buffer_bytes = buffer.len() * word_size;
    if buffer_bytes < mem::size_of::<ProcessHandleSnapshotHeader>() {
        return Vec::new();
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
        if supported_content_path(&path) && seen.insert(path.to_ascii_lowercase()) {
            content_paths.push(path);
            if content_paths.len() >= MAX_CONTENT_PATHS {
                break;
            }
        }
    }
    content_paths
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

        let paths = super::open_content_files(std::process::id());
        assert!(paths.iter().any(|candidate| {
            candidate
                .replace('/', "\\")
                .to_ascii_lowercase()
                .ends_with(&file_name.to_ascii_lowercase())
        }));

        drop(file);
        std::fs::remove_file(path).unwrap();
    }
}
