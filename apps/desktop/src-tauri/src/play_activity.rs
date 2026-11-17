//! What auto pause asks every few seconds (docs/auto-pause-plan.md): how long
//! ago the last input came, and whether each running game is in front. Only
//! the time of the last input is read, never which key or button: no hooks.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayActivity {
    /// Since the last keyboard or mouse input anywhere on this PC.
    input_idle_ms: u64,
    /// Since a controller last moved; None until one did (controller.rs).
    pad_idle_ms: Option<u64>,
    /// Per pid group: the window in front belongs to it.
    in_front: Vec<bool>,
    /// Per pid group: it shows a window at all, minimized ones included.
    has_window: Vec<bool>,
}

/// Milliseconds between two `GetTickCount` values. Both are 32-bit and wrap
/// after 49.7 days, so the difference has to wrap with them.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn idle_ms(now_tick: u32, last_input_tick: u32) -> u64 {
    u64::from(now_tick.wrapping_sub(last_input_tick))
}

#[tauri::command]
pub fn play_activity(pid_groups: Vec<Vec<u32>>) -> Result<PlayActivity, String> {
    Ok(PlayActivity {
        input_idle_ms: imp::input_idle_ms()?,
        pad_idle_ms: crate::controller::pad_idle_ms(),
        in_front: pid_groups.iter().map(|pids| game_in_front(pids)).collect(),
        has_window: pid_groups.iter().map(|pids| imp::has_window(pids)).collect(),
    })
}

/// Whether the window in front belongs to one of these processes. The live
/// timer hides with the same check, so a game the pill shows in is a game
/// auto pause sees in front.
#[cfg(target_os = "windows")]
pub(crate) fn game_in_front(target_pids: &[u32]) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return false;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    target_pids.contains(&pid)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn game_in_front(_target_pids: &[u32]) -> bool {
    true
}

#[cfg(target_os = "windows")]
mod imp {
    use windows_sys::Win32::{
        Foundation::{BOOL, HWND, LPARAM, RECT},
        System::SystemInformation::GetTickCount,
        UI::{
            Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
            WindowsAndMessaging::{
                EnumWindows, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
            },
        },
    };

    pub fn input_idle_ms() -> Result<u64, String> {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return Err("GetLastInputInfo failed".to_string());
        }
        Ok(super::idle_ms(unsafe { GetTickCount() }, info.dwTime))
    }

    /// A window that stands for the game: shown, and either minimized or at
    /// least as big as the live timer's smallest game window. Hidden helper
    /// windows and tiny popups don't count.
    pub fn counts_as_game_window(hwnd: HWND) -> bool {
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            return false;
        }
        if unsafe { IsIconic(hwnd) } != 0 {
            return true;
        }
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
            return false;
        }
        i64::from(rect.right) - i64::from(rect.left) >= 200
            && i64::from(rect.bottom) - i64::from(rect.top) >= 120
    }

    pub fn has_window(target_pids: &[u32]) -> bool {
        struct Search<'a> {
            target_pids: &'a [u32],
            found: bool,
        }

        unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let search = &mut *(lparam as *mut Search);
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if search.target_pids.contains(&pid) && counts_as_game_window(hwnd) {
                search.found = true;
                return 0;
            }
            1
        }

        if target_pids.is_empty() {
            return false;
        }
        let mut search = Search {
            target_pids,
            found: false,
        };
        unsafe { EnumWindows(Some(visit), &mut search as *mut Search as LPARAM) };
        search.found
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub fn input_idle_ms() -> Result<u64, String> {
        Err("auto pause is Windows only".to_string())
    }

    pub fn has_window(_target_pids: &[u32]) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_time_survives_the_tick_count_wrapping() {
        assert_eq!(idle_ms(1_000, 400), 600);
        // Last input just before the wrap, now just after it.
        assert_eq!(idle_ms(5, u32::MAX - 4), 10);
        assert_eq!(idle_ms(7, 7), 0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn a_group_without_processes_has_no_window_and_is_not_in_front() {
        assert!(!imp::has_window(&[]));
        assert!(!game_in_front(&[]));
    }

    /// A game window counts while shown and while minimized, not while
    /// hidden, and a small popup never does. Off screen, so nothing flashes.
    #[cfg(target_os = "windows")]
    #[test]
    fn a_game_window_counts_shown_or_minimized_not_hidden() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, ShowWindow, SW_HIDE, SW_SHOWMINNOACTIVE,
            SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, WS_POPUP,
        };
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let window = |width, height| unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE,
                class.as_ptr(),
                std::ptr::null(),
                WS_POPUP,
                -20_000,
                -20_000,
                width,
                height,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!hwnd.is_null(), "no test window");
            hwnd
        };
        let game = window(1280, 720);
        let popup = window(216, 56);
        unsafe {
            ShowWindow(game, SW_SHOWNOACTIVATE);
            ShowWindow(popup, SW_SHOWNOACTIVATE);
        }
        let shown = imp::counts_as_game_window(game);
        let small = imp::counts_as_game_window(popup);
        unsafe { ShowWindow(game, SW_SHOWMINNOACTIVE) };
        let minimized = imp::counts_as_game_window(game);
        unsafe { ShowWindow(game, SW_HIDE) };
        let hidden = imp::counts_as_game_window(game);
        unsafe {
            DestroyWindow(game);
            DestroyWindow(popup);
        }

        assert!(shown, "a shown game window");
        assert!(minimized, "a minimized game window");
        assert!(!hidden, "a hidden window");
        assert!(!small, "a small popup");
    }
}
