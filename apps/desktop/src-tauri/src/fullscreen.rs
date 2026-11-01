// Fullscreen for the main window. tao keeps a maximized borderless window
// clear of the taskbar, also in fullscreen, so a maximized window has to stop
// being maximized. Restoring it first shows it at its normal size before it
// fills the screen. Instead tao goes fullscreen while the window is still
// maximized, which keeps that placement to return to, and the maximized style
// is cleared in place afterwards: one step in, one step out.

use serde::{Deserialize, Serialize};

/// The window's normal bounds as Windows keeps them (workspace coordinates)
/// and whether it was maximized. The frontend stores it: after a restart in
/// fullscreen, tao no longer knows where the window came from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    maximized: bool,
}

/// Async, because a sync command runs inside WebView2's request callback,
/// where resizing the window stalls. The steps run together on the main
/// thread instead, where tao applies each change before the next one.
#[tauri::command]
pub async fn set_main_fullscreen(
    window: tauri::WebviewWindow,
    fullscreen: bool,
    restore: Option<WindowPlacement>,
) -> Result<Option<WindowPlacement>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(apply(&target, fullscreen, restore));
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

fn apply(
    window: &tauri::WebviewWindow,
    fullscreen: bool,
    restore: Option<WindowPlacement>,
) -> Result<Option<WindowPlacement>, String> {
    if fullscreen {
        let placement = platform::placement(window);
        window.set_fullscreen(true).map_err(|error| error.to_string())?;
        platform::cover_taskbar(window);
        Ok(placement)
    } else {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
        if let Some(placement) = restore {
            platform::set_placement(window, placement);
        }
        Ok(None)
    }
}

#[cfg(windows)]
mod platform {
    use super::WindowPlacement;
    use windows_sys::Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, GetWindowPlacement, SetWindowLongPtrW, SetWindowPlacement,
            SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER,
            SW_SHOWMAXIMIZED, SW_SHOWNORMAL, WINDOWPLACEMENT, WS_MAXIMIZE,
        },
    };

    fn hwnd(window: &tauri::WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|hwnd| hwnd.0 as HWND)
    }

    fn get(hwnd: HWND) -> Option<WINDOWPLACEMENT> {
        let mut placement: WINDOWPLACEMENT = unsafe { std::mem::zeroed() };
        placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
        (unsafe { GetWindowPlacement(hwnd, &mut placement) } != 0).then_some(placement)
    }

    pub fn placement(window: &tauri::WebviewWindow) -> Option<WindowPlacement> {
        let placement = get(hwnd(window)?)?;
        let rect = placement.rcNormalPosition;
        Some(WindowPlacement {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            maximized: placement.showCmd == SW_SHOWMAXIMIZED as u32,
        })
    }

    /// Windows moves the window back on screen if its monitor is gone.
    pub fn set_placement(window: &tauri::WebviewWindow, placement: WindowPlacement) {
        let Some(hwnd) = hwnd(window) else {
            return;
        };
        let Some(mut current) = get(hwnd) else {
            return;
        };
        current.showCmd = if placement.maximized {
            SW_SHOWMAXIMIZED
        } else {
            SW_SHOWNORMAL
        } as u32;
        current.rcNormalPosition = RECT {
            left: placement.left,
            top: placement.top,
            right: placement.right,
            bottom: placement.bottom,
        };
        unsafe { SetWindowPlacement(hwnd, &current) };
    }

    /// Clearing the style does not move the window; stretching it over the
    /// monitor then lets tao lay it out unmaximized, taskbar covered.
    pub fn cover_taskbar(window: &tauri::WebviewWindow) {
        let Some(hwnd) = hwnd(window) else {
            return;
        };
        let Ok(Some(monitor)) = window.current_monitor() else {
            return;
        };
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            if style & WS_MAXIMIZE as isize == 0 {
                return;
            }
            SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_MAXIMIZE as isize));
            let position = monitor.position();
            let size = monitor.size();
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                position.x,
                position.y,
                size.width as i32,
                size.height as i32,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::WindowPlacement;

    pub fn placement(_window: &tauri::WebviewWindow) -> Option<WindowPlacement> {
        None
    }

    pub fn set_placement(_window: &tauri::WebviewWindow, _placement: WindowPlacement) {}

    pub fn cover_taskbar(_window: &tauri::WebviewWindow) {}
}
