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
}
