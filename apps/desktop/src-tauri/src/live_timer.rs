//! The live timer: a small pill that counts the running session up, in a
//! corner of the game's window, or of the screen while the game shows none.
//! Like the notification overlay it never takes focus or clicks, and its
//! window exists only while it is shown, since a hidden webview still holds
//! its own renderer process.

use crate::notification_overlay::PhysRect;
use serde::{Deserialize, Serialize};
use std::sync::{atomic::AtomicU64, Mutex};

/// How often the pill checks where the game's window went.
#[cfg(not(target_os = "macos"))]
const FOLLOW_INTERVAL: std::time::Duration = std::time::Duration::from_millis(500);

/// Every timer window gets this prefix plus a counter, so a new one never
/// waits for the previous one to finish closing.
pub const LABEL_PREFIX: &str = "live-timer-";
pub const UPDATE_EVENT: &str = "playcounter:live-timer-update";

#[cfg(not(target_os = "macos"))]
const WINDOW_LOGICAL_WIDTH: f64 = 188.0;
#[cfg(not(target_os = "macos"))]
const WINDOW_LOGICAL_HEIGHT: f64 = 56.0;
const MARGIN_LOGICAL: f64 = 12.0;
#[cfg(target_os = "macos")]
const UNSUPPORTED: &str = "Desktop overlays are not supported on this platform.";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTimerPayload {
    started_at_ms: u64,
    corner: String,
    #[serde(default)]
    monitor: Option<String>,
    accent_color: Option<String>,
    /// The game's processes; the pill sits in their biggest window.
    #[serde(default)]
    target_pids: Vec<u32>,
}

#[derive(Default)]
pub struct LiveTimerState {
    payload: Mutex<Option<LiveTimerPayload>>,
    window_label: Mutex<Option<String>>,
    windows_opened: AtomicU64,
}

fn truncate(value: String, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn sanitize(mut payload: LiveTimerPayload) -> LiveTimerPayload {
    if !matches!(
        payload.corner.as_str(),
        "top-left" | "top-right" | "bottom-left" | "bottom-right"
    ) {
        payload.corner = "top-left".to_string();
    }
    payload.monitor = payload.monitor.map(|value| truncate(value, 200));
    payload.accent_color = payload.accent_color.map(|value| truncate(value, 16));
    payload.target_pids.retain(|pid| *pid > 0);
    payload.target_pids.sort_unstable();
    payload.target_pids.dedup();
    payload.target_pids.truncate(16);
    payload
}

/// The window's place in a corner of an area (the game's window or the work
/// area), in physical pixels.
pub fn timer_rect(
    work_area: PhysRect,
    scale_factor: f64,
    corner: &str,
    logical: (f64, f64),
) -> PhysRect {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let margin = i64::from((MARGIN_LOGICAL * scale).round().max(0.0) as i32);
    let width = ((logical.0 * scale).round() as u32).min(work_area.width);
    let height = ((logical.1 * scale).round() as u32).min(work_area.height);
    let left = i64::from(work_area.x);
    let top = i64::from(work_area.y);
    let right = left + i64::from(work_area.width) - i64::from(width);
    let bottom = top + i64::from(work_area.height) - i64::from(height);
    let x = if corner.ends_with("right") {
        right - margin
    } else {
        left + margin
    };
    let y = if corner.starts_with("bottom") {
        bottom - margin
    } else {
        top + margin
    };
    let clamp = |value: i64, low: i64, high: i64| {
        value
            .clamp(low, high.max(low))
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
    };
    PhysRect {
        x: clamp(x, left, right),
        y: clamp(y, top, bottom),
        width,
        height,
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager};

    /// The inside of the game's biggest window (no title bar or borders), in
    /// screen pixels. None while it shows no window, e.g. minimized.
    #[cfg(target_os = "windows")]
    fn game_area(target_pids: &[u32]) -> Option<PhysRect> {
        use windows_sys::Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{GetWindowInfo, WINDOWINFO},
        };
        let hwnd = crate::notification_overlay::largest_process_window(target_pids)?;
        // SAFETY: WINDOWINFO is plain data; all zeroes is a valid value.
        let mut info: WINDOWINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<WINDOWINFO>() as u32;
        if unsafe { GetWindowInfo(hwnd as HWND, &mut info) } == 0 {
            return None;
        }
        let client = info.rcClient;
        (client.right > client.left && client.bottom > client.top).then(|| PhysRect {
            x: client.left,
            y: client.top,
            width: (client.right - client.left) as u32,
            height: (client.bottom - client.top) as u32,
        })
    }

    #[cfg(not(target_os = "windows"))]
    fn game_area(_target_pids: &[u32]) -> Option<PhysRect> {
        None
    }

    fn target_rect(app: &tauri::AppHandle, payload: &LiveTimerPayload) -> Result<PhysRect, String> {
        let size = (WINDOW_LOGICAL_WIDTH, WINDOW_LOGICAL_HEIGHT);
        if let Some(area) = game_area(&payload.target_pids) {
            let center_x = f64::from(area.x) + f64::from(area.width) / 2.0;
            let center_y = f64::from(area.y) + f64::from(area.height) / 2.0;
            let scale = app
                .monitor_from_point(center_x, center_y)
                .ok()
                .flatten()
                .map_or(1.0, |monitor| monitor.scale_factor());
            return Ok(timer_rect(area, scale, &payload.corner, size));
        }
        let monitor = crate::notification_overlay::popup_monitor(app, payload.monitor.as_deref())?;
        let area = monitor.work_area();
        Ok(timer_rect(
            PhysRect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            },
            monitor.scale_factor(),
            &payload.corner,
            size,
        ))
    }

    fn place(window: &tauri::WebviewWindow, rect: PhysRect) -> Result<(), String> {
        window
            .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
            .map_err(|error| error.to_string())
    }

    /// Moves the pill along with the game's window until the pill is closed.
    fn follow(app: tauri::AppHandle, label: String) {
        tauri::async_runtime::spawn(async move {
            let mut placed = None;
            loop {
                tokio::time::sleep(FOLLOW_INTERVAL).await;
                let Some(window) = app.get_webview_window(&label) else {
                    return;
                };
                let payload = match app.state::<LiveTimerState>().payload.lock() {
                    Ok(payload) => payload.clone(),
                    Err(_) => return,
                };
                let Some(payload) = payload else {
                    return;
                };
                let Ok(rect) = target_rect(&app, &payload) else {
                    continue;
                };
                if placed != Some(rect) && place(&window, rect).is_ok() {
                    placed = Some(rect);
                }
            }
        });
    }

    pub fn show(
        app: &tauri::AppHandle,
        state: &LiveTimerState,
        payload: LiveTimerPayload,
    ) -> Result<(), String> {
        // Held throughout, so a hide cannot close the window being updated.
        let mut label = state
            .window_label
            .lock()
            .map_err(|error| error.to_string())?;
        // Stored before any event: a page that is still loading asks for it.
        *state.payload.lock().map_err(|error| error.to_string())? = Some(payload.clone());
        let existing = label
            .as_deref()
            .and_then(|label| app.get_webview_window(label));
        let window = match existing {
            Some(window) => {
                app.emit_to(window.label(), UPDATE_EVENT, payload.clone())
                    .map_err(|error| error.to_string())?;
                window
            }
            None => {
                let next = format!(
                    "{LABEL_PREFIX}{}",
                    state.windows_opened.fetch_add(1, Ordering::Relaxed)
                );
                let window = tauri::WebviewWindowBuilder::new(
                    app,
                    &next,
                    tauri::WebviewUrl::App("live-timer.html".into()),
                )
                .title("PlayCounter timer")
                .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
                .inner_size(WINDOW_LOGICAL_WIDTH, WINDOW_LOGICAL_HEIGHT)
                .decorations(false)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .closable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focusable(false)
                .shadow(false)
                .transparent(true)
                .visible(false)
                .build()
                .map_err(|error| error.to_string())?;
                window
                    .set_ignore_cursor_events(true)
                    .map_err(|error| error.to_string())?;
                follow(app.clone(), next.clone());
                *label = Some(next);
                window
            }
        };
        place(&window, target_rect(app, &payload)?)?;
        window.show().map_err(|error| error.to_string())
    }

    pub fn hide(app: &tauri::AppHandle, state: &LiveTimerState) -> Result<(), String> {
        let mut label = state
            .window_label
            .lock()
            .map_err(|error| error.to_string())?;
        state
            .payload
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        if let Some(window) = label
            .take()
            .and_then(|label| app.get_webview_window(&label))
        {
            window.destroy().map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    pub fn show(
        _app: &tauri::AppHandle,
        _state: &LiveTimerState,
        _payload: LiveTimerPayload,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn hide(_app: &tauri::AppHandle, _state: &LiveTimerState) -> Result<(), String> {
        Ok(())
    }
}

fn main_only(window: &tauri::Window) -> Result<(), String> {
    if window.label() == crate::notification_overlay::MAIN_LABEL {
        Ok(())
    } else {
        Err("unauthorized window".to_string())
    }
}

// Window operations dispatch onto Tauri's main loop; see notification_overlay.
#[tauri::command(async)]
pub fn live_timer_show(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, LiveTimerState>,
    payload: LiveTimerPayload,
) -> Result<(), String> {
    main_only(&window)?;
    imp::show(&app, &state, sanitize(payload))
}

#[tauri::command(async)]
pub fn live_timer_hide(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, LiveTimerState>,
) -> Result<(), String> {
    main_only(&window)?;
    imp::hide(&app, &state)
}

/// The timer window asks for its session once its page listens for updates.
#[tauri::command(async)]
pub fn live_timer_ready(
    window: tauri::Window,
    state: tauri::State<'_, LiveTimerState>,
) -> Result<Option<LiveTimerPayload>, String> {
    let label = state
        .window_label
        .lock()
        .map_err(|error| error.to_string())?;
    if label.as_deref() != Some(window.label()) {
        return Err("unauthorized window".to_string());
    }
    Ok(state
        .payload
        .lock()
        .map_err(|error| error.to_string())?
        .clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: PhysRect = PhysRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn places_the_timer_in_each_corner() {
        let size = (188.0, 56.0);
        let at = |corner| {
            let rect = timer_rect(AREA, 1.0, corner, size);
            (rect.x, rect.y)
        };
        assert_eq!(at("top-left"), (12, 12));
        assert_eq!(at("top-right"), (1920 - 188 - 12, 12));
        assert_eq!(at("bottom-left"), (12, 1040 - 56 - 12));
        assert_eq!(at("bottom-right"), (1920 - 188 - 12, 1040 - 56 - 12));
    }

    #[test]
    fn scales_and_supports_negative_monitor_origins() {
        let rect = timer_rect(
            PhysRect {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1080,
            },
            1.5,
            "top-right",
            (188.0, 56.0),
        );
        assert_eq!(
            rect,
            PhysRect {
                x: -282 - 18,
                y: 18,
                width: 282,
                height: 84,
            }
        );
    }

    #[test]
    fn stays_inside_a_tiny_work_area() {
        let rect = timer_rect(
            PhysRect {
                x: 100,
                y: 200,
                width: 150,
                height: 40,
            },
            2.0,
            "bottom-right",
            (188.0, 56.0),
        );
        assert_eq!(
            rect,
            PhysRect {
                x: 100,
                y: 200,
                width: 150,
                height: 40,
            }
        );
    }

    #[test]
    fn cleans_what_the_main_window_sends() {
        let payload = sanitize(LiveTimerPayload {
            started_at_ms: 0,
            corner: "middle".to_string(),
            monitor: Some("m".repeat(500)),
            accent_color: None,
            target_pids: vec![30, 0, 7, 30],
        });
        assert_eq!(payload.corner, "top-left");
        assert_eq!(
            payload.monitor.map(|value| value.chars().count()),
            Some(200)
        );
        assert_eq!(payload.target_pids, vec![7, 30]);
    }
}
