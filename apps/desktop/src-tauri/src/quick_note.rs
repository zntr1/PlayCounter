//! The quick note box: a small window over the game for writing a note to a
//! session. Unlike the notification overlay it takes keyboard focus, and it
//! hands focus back to the window that had it (usually the game) when it
//! closes.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

pub const LABEL: &str = "quick-note";
pub const SAVE_EVENT: &str = "playcounter:quick-note-save";
/// Same limit as the main window's session notes.
const NOTE_LIMIT: usize = 1000;
#[cfg(not(target_os = "macos"))]
const WINDOW_LOGICAL_WIDTH: f64 = 560.0;
#[cfg(not(target_os = "macos"))]
const WINDOW_LOGICAL_HEIGHT: f64 = 236.0;
#[cfg(target_os = "macos")]
const UNSUPPORTED: &str = "Desktop overlays are not supported on this platform.";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotePayload {
    session_id: i64,
    game_name: String,
    cover_url: Option<String>,
    note: String,
    /// Running sessions count up from here.
    started_at: Option<String>,
    /// Finished sessions show their length instead.
    duration: Option<String>,
    /// Texts in the main window's language, by English key.
    labels: HashMap<String, String>,
    #[serde(default)]
    monitor: Option<String>,
    #[serde(default)]
    locale: Option<String>,
    theme: String,
    accent_color: Option<String>,
    reduced_motion: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SavedNote {
    session_id: i64,
    note: String,
}

#[derive(Default)]
pub struct QuickNoteState {
    pending: Mutex<Option<QuickNotePayload>>,
    session_id: Mutex<Option<i64>>,
    /// The window in front when the note was asked for, as a raw HWND.
    foreground: Mutex<Option<isize>>,
}

fn truncate(value: String, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn sanitize(mut payload: QuickNotePayload) -> QuickNotePayload {
    payload.game_name = truncate(payload.game_name, 200);
    payload.cover_url = payload.cover_url.map(|url| truncate(url, 2048));
    payload.note = truncate(payload.note, NOTE_LIMIT);
    payload.started_at = payload.started_at.map(|value| truncate(value, 64));
    payload.duration = payload.duration.map(|value| truncate(value, 64));
    payload.labels = payload
        .labels
        .into_iter()
        .take(16)
        .map(|(key, value)| (truncate(key, 200), truncate(value, 200)))
        .collect();
    payload.monitor = payload.monitor.map(|value| truncate(value, 200));
    payload.locale = payload.locale.map(|value| truncate(value, 35));
    payload.theme = truncate(payload.theme, 16);
    payload.accent_color = payload.accent_color.map(|value| truncate(value, 16));
    payload
}

/// Called when a hotkey or a popup asks for a note, while the game is still in
/// front. Keeps the first window until the note closes.
pub fn remember_foreground(app: &tauri::AppHandle) {
    use tauri::Manager;
    if app.get_webview_window(LABEL).is_some() {
        return;
    }
    let state = app.state::<QuickNoteState>();
    if let Ok(mut foreground) = state.foreground.lock() {
        *foreground = imp::foreground_window();
    };
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use tauri::Manager;

    pub fn open(
        app: &tauri::AppHandle,
        state: &QuickNoteState,
        payload: QuickNotePayload,
    ) -> Result<(), String> {
        // A second press while the box is open brings it back instead of
        // replacing what is being typed.
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.show();
            return window.set_focus().map_err(|error| error.to_string());
        }
        {
            let mut foreground = state.foreground.lock().map_err(|error| error.to_string())?;
            if foreground.is_none() {
                *foreground = foreground_window();
            }
        }
        let monitor = crate::notification_overlay::popup_monitor(app, payload.monitor.as_deref())?;
        *state.session_id.lock().map_err(|error| error.to_string())? = Some(payload.session_id);
        *state.pending.lock().map_err(|error| error.to_string())? = Some(payload);
        let window = tauri::WebviewWindowBuilder::new(
            app,
            LABEL,
            tauri::WebviewUrl::App("quick-note.html".into()),
        )
        .title("PlayCounter quick note")
        .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
        .inner_size(WINDOW_LOGICAL_WIDTH, WINDOW_LOGICAL_HEIGHT)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .transparent(true)
        .visible(false)
        .focused(true)
        .build()
        .map_err(|error| error.to_string())?;
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = ((WINDOW_LOGICAL_WIDTH * scale).round() as u32).min(area.size.width);
        let height = ((WINDOW_LOGICAL_HEIGHT * scale).round() as u32).min(area.size.height);
        let x = area.position.x + ((area.size.width - width) / 2) as i32;
        // High enough to stay clear of subtitles and HUDs at the bottom.
        let y = area.position.y + ((area.size.height - height) / 5) as i32;
        window
            .set_size(tauri::PhysicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())
    }

    pub fn close(
        app: &tauri::AppHandle,
        state: &QuickNoteState,
        restore_focus: bool,
    ) -> Result<(), String> {
        state
            .pending
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        state
            .session_id
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        let foreground = state
            .foreground
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        if let Some(window) = app.get_webview_window(LABEL) {
            window.destroy().map_err(|error| error.to_string())?;
        }
        if restore_focus {
            if let Some(hwnd) = foreground {
                focus_window(hwnd);
            }
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    pub fn foreground_window() -> Option<isize> {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        let hwnd = unsafe { GetForegroundWindow() };
        (!hwnd.is_null()).then_some(hwnd as isize)
    }

    #[cfg(not(target_os = "windows"))]
    pub fn foreground_window() -> Option<isize> {
        None
    }

    #[cfg(target_os = "windows")]
    fn focus_window(hwnd: isize) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
        let hwnd = hwnd as windows_sys::Win32::Foundation::HWND;
        unsafe {
            if IsWindow(hwnd) != 0 {
                SetForegroundWindow(hwnd);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn focus_window(_hwnd: isize) {}
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    pub fn open(
        _app: &tauri::AppHandle,
        _state: &QuickNoteState,
        _payload: QuickNotePayload,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn close(
        _app: &tauri::AppHandle,
        _state: &QuickNoteState,
        _restore_focus: bool,
    ) -> Result<(), String> {
        Ok(())
    }
    pub fn foreground_window() -> Option<isize> {
        None
    }
}

fn main_only(window: &tauri::Window) -> Result<(), String> {
    if window.label() == crate::notification_overlay::MAIN_LABEL {
        Ok(())
    } else {
        Err("unauthorized window".to_string())
    }
}

fn note_window_only(window: &tauri::Window) -> Result<(), String> {
    if window.label() == LABEL {
        Ok(())
    } else {
        Err("unauthorized window".to_string())
    }
}

// Window operations dispatch onto Tauri's main loop; see notification_overlay.
#[tauri::command(async)]
pub fn quick_note_open(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    payload: QuickNotePayload,
) -> Result<(), String> {
    main_only(&window)?;
    imp::open(&app, &state, sanitize(payload))
}

/// The note window asks for its session once its page is ready.
#[tauri::command(async)]
pub fn quick_note_ready(
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
) -> Result<Option<QuickNotePayload>, String> {
    note_window_only(&window)?;
    Ok(state
        .pending
        .lock()
        .map_err(|error| error.to_string())?
        .clone())
}

/// `note` is None for Cancel. `restore_focus` is false when the box closes
/// because the player clicked somewhere else.
#[tauri::command(async)]
pub fn quick_note_close(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    note: Option<String>,
    restore_focus: bool,
) -> Result<(), String> {
    note_window_only(&window)?;
    use tauri::Emitter;
    let session_id = *state.session_id.lock().map_err(|error| error.to_string())?;
    if let (Some(note), Some(session_id)) = (note, session_id) {
        app.emit_to(
            crate::notification_overlay::MAIN_LABEL,
            SAVE_EVENT,
            SavedNote {
                session_id,
                note: truncate(note, NOTE_LIMIT),
            },
        )
        .map_err(|error| error.to_string())?;
    }
    imp::close(&app, &state, restore_focus)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> QuickNotePayload {
        QuickNotePayload {
            session_id: 1,
            game_name: "g".repeat(300),
            cover_url: None,
            note: "n".repeat(1500),
            started_at: None,
            duration: None,
            labels: (0..40)
                .map(|index| (format!("key {index}"), "v".repeat(300)))
                .collect(),
            monitor: None,
            locale: None,
            theme: "dark".to_string(),
            accent_color: None,
            reduced_motion: false,
        }
    }

    #[test]
    fn caps_what_the_main_window_sends() {
        let clean = sanitize(payload());
        assert_eq!(clean.game_name.chars().count(), 200);
        assert_eq!(clean.note.chars().count(), NOTE_LIMIT);
        assert_eq!(clean.labels.len(), 16);
        assert!(clean
            .labels
            .values()
            .all(|value| value.chars().count() == 200));
    }
}
