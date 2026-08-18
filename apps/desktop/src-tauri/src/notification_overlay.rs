use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

pub const OVERLAY_LABEL: &str = "notification-overlay";
pub const MAIN_LABEL: &str = "main";
pub const SHOW_EVENT: &str = "playcounter:overlay-show";
pub const CLEAR_EVENT: &str = "playcounter:overlay-clear";
pub const FINISHED_EVENT: &str = "playcounter:overlay-finished";

const CARD_LOGICAL_WIDTH: f64 = 440.0;
const CARD_LOGICAL_HEIGHT: f64 = 160.0;
const MARGIN_LOGICAL: f64 = 24.0;
#[cfg(target_os = "macos")]
const UNSUPPORTED: &str = "Desktop overlays are not supported on this platform.";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPayload {
    id: String,
    sequence: u64,
    kind: String,
    priority: i32,
    kicker: String,
    title: String,
    body: Option<String>,
    metric: Option<String>,
    status: Option<String>,
    cover_url: Option<String>,
    theme: String,
    accent_color: Option<String>,
    reduced_motion: bool,
    duration_ms: u64,
    created_at_ms: u64,
    expires_at_ms: u64,
}

#[derive(Default)]
pub struct OverlayState {
    pending: Mutex<Option<OverlayPayload>>,
    ready: AtomicBool,
    current_id: Mutex<Option<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn overlay_rect(work_area: PhysRect, scale_factor: f64) -> PhysRect {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let margin = (MARGIN_LOGICAL * scale).round().max(0.0) as i32;
    let width = ((CARD_LOGICAL_WIDTH * scale).round() as u32).min(work_area.width);
    let height = ((CARD_LOGICAL_HEIGHT * scale).round() as u32).min(work_area.height);
    let right = i64::from(work_area.x) + i64::from(work_area.width);
    let desired_x = right - i64::from(width) - i64::from(margin);
    let max_x = right - i64::from(width);
    let x = desired_x
        .clamp(i64::from(work_area.x), max_x)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    let bottom = i64::from(work_area.y) + i64::from(work_area.height);
    let desired_y = i64::from(work_area.y) + i64::from(margin);
    let max_y = bottom - i64::from(height);
    let y = desired_y
        .clamp(i64::from(work_area.y), max_y)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    PhysRect {
        x,
        y,
        width,
        height,
    }
}

fn truncate(value: String, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn truncate_optional(value: Option<String>, max_chars: usize) -> Option<String> {
    value.map(|item| truncate(item, max_chars))
}

fn sanitize(mut payload: OverlayPayload) -> OverlayPayload {
    payload.id = truncate(payload.id, 200);
    payload.kind = truncate(payload.kind, 64);
    payload.kicker = truncate(payload.kicker, 200);
    payload.title = truncate(payload.title, 200);
    payload.body = truncate_optional(payload.body, 200);
    payload.metric = truncate_optional(payload.metric, 200);
    payload.status = truncate_optional(payload.status, 32);
    payload.cover_url = truncate_optional(payload.cover_url, 2048);
    payload.theme = truncate(payload.theme, 16);
    payload.accent_color = truncate_optional(payload.accent_color, 16);
    payload.duration_ms = payload.duration_ms.clamp(500, 15_000);
    payload
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use tauri::{Emitter, Manager};

    fn ensure_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            return Ok(window);
        }
        let window = tauri::WebviewWindowBuilder::new(
            app,
            OVERLAY_LABEL,
            tauri::WebviewUrl::App("overlay.html".into()),
        )
        .title("PlayCounter notification")
        .inner_size(CARD_LOGICAL_WIDTH, CARD_LOGICAL_HEIGHT)
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
        Ok(window)
    }

    fn selected_monitor(app: &tauri::AppHandle) -> Result<tauri::Monitor, String> {
        if let Some((x, y)) = foreground_window_center() {
            if let Some(monitor) = app
                .monitor_from_point(x, y)
                .map_err(|error| error.to_string())?
            {
                return Ok(monitor);
            }
        }
        if let Ok(cursor) = app.cursor_position() {
            if let Some(monitor) = app
                .monitor_from_point(cursor.x, cursor.y)
                .map_err(|error| error.to_string())?
            {
                return Ok(monitor);
            }
        }
        app.primary_monitor()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "No monitor is available for the notification overlay.".to_string())
    }

    fn position_window(
        app: &tauri::AppHandle,
        window: &tauri::WebviewWindow,
    ) -> Result<(), String> {
        let monitor = selected_monitor(app)?;
        let area = monitor.work_area();
        let rect = overlay_rect(
            PhysRect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            },
            monitor.scale_factor(),
        );
        window
            .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn prepare(app: &tauri::AppHandle) -> Result<(), String> {
        ensure_window(app).map(|_| ())
    }

    pub fn show(
        app: &tauri::AppHandle,
        state: &OverlayState,
        payload: OverlayPayload,
    ) -> Result<(), String> {
        let window = ensure_window(app)?;
        position_window(app, &window)?;
        *state.current_id.lock().map_err(|error| error.to_string())? = Some(payload.id.clone());
        if state.ready.load(Ordering::Acquire) {
            app.emit_to(OVERLAY_LABEL, SHOW_EVENT, payload)
                .map_err(|error| error.to_string())?;
        } else {
            *state.pending.lock().map_err(|error| error.to_string())? = Some(payload);
        }
        window.show().map_err(|error| error.to_string())
    }

    pub fn hide(app: &tauri::AppHandle, state: &OverlayState, id: &str) -> Result<(), String> {
        let mut current = state.current_id.lock().map_err(|error| error.to_string())?;
        if current.as_deref() != Some(id) {
            return Ok(());
        }
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            window.hide().map_err(|error| error.to_string())?;
            app.emit_to(OVERLAY_LABEL, CLEAR_EVENT, ())
                .map_err(|error| error.to_string())?;
        }
        current.take();
        state
            .pending
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        Ok(())
    }

    pub fn close(app: &tauri::AppHandle, state: &OverlayState) -> Result<(), String> {
        state
            .pending
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        state
            .current_id
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            window.hide().map_err(|error| error.to_string())?;
            app.emit_to(OVERLAY_LABEL, CLEAR_EVENT, ())
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn ready(app: &tauri::AppHandle, state: &OverlayState) -> Result<(), String> {
        state.ready.store(true, Ordering::Release);
        if let Some(payload) = state
            .pending
            .lock()
            .map_err(|error| error.to_string())?
            .take()
        {
            app.emit_to(OVERLAY_LABEL, SHOW_EVENT, payload)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn finished(app: &tauri::AppHandle, state: &OverlayState, id: &str) -> Result<(), String> {
        let mut current = state.current_id.lock().map_err(|error| error.to_string())?;
        if current.as_deref() != Some(id) {
            return Ok(());
        }
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            window.hide().map_err(|error| error.to_string())?;
        }
        current.take();
        app.emit_to(MAIN_LABEL, FINISHED_EVENT, id)
            .map_err(|error| error.to_string())
    }

    #[cfg(target_os = "windows")]
    fn foreground_window_center() -> Option<(f64, f64)> {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};

        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            if GetWindowRect(hwnd, &mut rect) == 0
                || rect.right <= rect.left
                || rect.bottom <= rect.top
            {
                return None;
            }
            Some((
                f64::from(rect.left + (rect.right - rect.left) / 2),
                f64::from(rect.top + (rect.bottom - rect.top) / 2),
            ))
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn foreground_window_center() -> Option<(f64, f64)> {
        None
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    pub fn prepare(_app: &tauri::AppHandle) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn show(
        _app: &tauri::AppHandle,
        _state: &OverlayState,
        _payload: OverlayPayload,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn hide(_app: &tauri::AppHandle, _state: &OverlayState, _id: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn close(_app: &tauri::AppHandle, _state: &OverlayState) -> Result<(), String> {
        Ok(())
    }
    pub fn ready(_app: &tauri::AppHandle, _state: &OverlayState) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn finished(
        _app: &tauri::AppHandle,
        _state: &OverlayState,
        _id: &str,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
}

fn main_only(window: &tauri::Window) -> Result<(), String> {
    if window.label() == MAIN_LABEL {
        Ok(())
    } else {
        Err("unauthorized window".to_string())
    }
}

fn overlay_only(window: &tauri::Window) -> Result<(), String> {
    if window.label() == OVERLAY_LABEL {
        Ok(())
    } else {
        Err("unauthorized window".to_string())
    }
}

// Window and event operations dispatch onto Tauri's main loop. Run these
// commands through its async executor so a synchronous IPC handler cannot
// block the loop it is waiting on.
#[tauri::command(async)]
pub fn notification_overlay_prepare(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    main_only(&window)?;
    imp::prepare(&app)
}

#[tauri::command(async)]
pub fn notification_overlay_show(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, OverlayState>,
    payload: OverlayPayload,
) -> Result<(), String> {
    main_only(&window)?;
    imp::show(&app, &state, sanitize(payload))
}

#[tauri::command(async)]
pub fn notification_overlay_hide(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, OverlayState>,
    id: String,
) -> Result<(), String> {
    main_only(&window)?;
    imp::hide(&app, &state, &id)
}

#[tauri::command(async)]
pub fn notification_overlay_close(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, OverlayState>,
) -> Result<(), String> {
    main_only(&window)?;
    imp::close(&app, &state)
}

#[tauri::command(async)]
pub fn notification_overlay_ready(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, OverlayState>,
) -> Result<(), String> {
    overlay_only(&window)?;
    imp::ready(&app, &state)
}

#[tauri::command(async)]
pub fn notification_overlay_finished(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, OverlayState>,
    id: String,
) -> Result<(), String> {
    overlay_only(&window)?;
    imp::finished(&app, &state, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_the_card_at_the_top_right() {
        assert_eq!(
            overlay_rect(
                PhysRect {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1040,
                },
                1.0,
            ),
            PhysRect {
                x: 1456,
                y: 24,
                width: 440,
                height: 160,
            }
        );
    }

    #[test]
    fn scales_and_supports_negative_monitor_origins() {
        assert_eq!(
            overlay_rect(
                PhysRect {
                    x: -1920,
                    y: 0,
                    width: 1920,
                    height: 1080,
                },
                1.5,
            ),
            PhysRect {
                x: -696,
                y: 36,
                width: 660,
                height: 240,
            }
        );
    }

    #[test]
    fn clamps_to_a_small_work_area() {
        assert_eq!(
            overlay_rect(
                PhysRect {
                    x: 100,
                    y: 200,
                    width: 300,
                    height: 100,
                },
                2.0,
            ),
            PhysRect {
                x: 100,
                y: 200,
                width: 300,
                height: 100,
            }
        );
    }
}
