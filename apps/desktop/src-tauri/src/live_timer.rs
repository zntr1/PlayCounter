//! The live timer: a small pill that counts the running session up, in a
//! corner of the game's window while the game is in front, hidden otherwise.
//! A console timer has no window and sits in a screen corner. Like the
//! notification overlay it never takes focus, and its window exists only while
//! a session runs, since a hidden webview still holds its own renderer
//! process. Clicks pass through it, except while the mouse rests on it: then
//! its pause button can be clicked.

use crate::notification_overlay::PhysRect;
use serde::{Deserialize, Serialize};
use std::sync::{atomic::AtomicU64, Mutex};

/// How often the pill checks where the game's window went and whether the
/// game is still in front.
#[cfg(not(target_os = "macos"))]
const FOLLOW_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);

/// Every timer window gets this prefix plus a counter, so a new one never
/// waits for the previous one to finish closing.
pub const LABEL_PREFIX: &str = "live-timer-";
pub const UPDATE_EVENT: &str = "playcounter:live-timer-update";
/// To the pill: whether the mouse rests on it (it then takes clicks).
pub const HOVER_EVENT: &str = "playcounter:live-timer-hover";
/// To the main window: the pill's pause button was clicked.
pub const TOGGLE_PAUSE_EVENT: &str = "playcounter:live-timer-toggle-pause";

/// Room for the pill with its pause button at ten hours and more. Counts make
/// it wider: the page measures itself (live_timer_fit).
const WINDOW_LOGICAL_WIDTH: f64 = 216.0;
const MAX_WINDOW_LOGICAL_WIDTH: f64 = 900.0;
/// Counts shown after the time, at most.
const COUNT_LIMIT: usize = 8;
#[cfg(not(target_os = "macos"))]
const WINDOW_LOGICAL_HEIGHT: f64 = 56.0;
const MARGIN_LOGICAL: f64 = 12.0;
#[cfg(target_os = "macos")]
const UNSUPPORTED: &str = "Desktop overlays are not supported on this platform.";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTimerPayload {
    /// The start, moved later by the session's finished pauses.
    count_from_ms: u64,
    /// Set while paused: the pill stands at this moment.
    #[serde(default)]
    paused_at_ms: Option<u64>,
    corner: String,
    #[serde(default)]
    monitor: Option<String>,
    accent_color: Option<String>,
    /// The game's processes; the pill sits in their biggest window.
    #[serde(default)]
    target_pids: Vec<u32>,
    /// The pause button's names, in the app's language.
    #[serde(default)]
    pause_label: String,
    #[serde(default)]
    resume_label: String,
    /// The game's counters shown while playing (docs/counters-plan.md).
    #[serde(default)]
    counts: Vec<LiveTimerCount>,
    /// The count to pulse once; a new `seq` pulses again.
    #[serde(default)]
    pulse: Option<LiveTimerPulse>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTimerCount {
    id: String,
    /// None for Deaths, which shows a skull instead of its name.
    label: Option<String>,
    value: u32,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTimerPulse {
    id: String,
    seq: u64,
}

#[derive(Default)]
pub struct LiveTimerState {
    payload: Mutex<Option<LiveTimerPayload>>,
    window_label: Mutex<Option<String>>,
    windows_opened: AtomicU64,
    /// The width the page asked for; None = WINDOW_LOGICAL_WIDTH.
    width: Mutex<Option<f64>>,
}

/// The window's width in logical pixels: what the page measured, within
/// limits.
fn fit_width(width: f64) -> Option<f64> {
    width
        .is_finite()
        .then(|| width.clamp(WINDOW_LOGICAL_WIDTH, MAX_WINDOW_LOGICAL_WIDTH))
}

fn logical_width(state: &LiveTimerState) -> f64 {
    state
        .width
        .lock()
        .ok()
        .and_then(|width| *width)
        .unwrap_or(WINDOW_LOGICAL_WIDTH)
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
    payload.pause_label = truncate(payload.pause_label, 200);
    payload.resume_label = truncate(payload.resume_label, 200);
    payload.counts.truncate(COUNT_LIMIT);
    for count in &mut payload.counts {
        count.id = truncate(std::mem::take(&mut count.id), 64);
        count.label = count.label.take().map(|label| truncate(label, 100));
    }
    payload.pulse = payload.pulse.map(|pulse| LiveTimerPulse {
        id: truncate(pulse.id, 64),
        seq: pulse.seq,
    });
    payload
}

/// Whether a screen point lies on the pill's window.
pub fn rect_contains(rect: PhysRect, x: i32, y: i32) -> bool {
    let (x, y) = (i64::from(x), i64::from(y));
    let left = i64::from(rect.x);
    let top = i64::from(rect.y);
    x >= left && y >= top && x < left + i64::from(rect.width) && y < top + i64::from(rect.height)
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

    /// Whether the window in front belongs to the game.
    #[cfg(target_os = "windows")]
    fn game_in_front(target_pids: &[u32]) -> bool {
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
    fn game_in_front(_target_pids: &[u32]) -> bool {
        true
    }

    /// Whether a visible mouse pointer rests on the pill. A game that hides
    /// or locks the pointer while you play never makes the pill take clicks.
    #[cfg(target_os = "windows")]
    fn pointer_over(rect: PhysRect) -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetCursorInfo, CURSORINFO, CURSOR_SHOWING,
        };
        // SAFETY: CURSORINFO is plain data; all zeroes is a valid value.
        let mut info: CURSORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
        if unsafe { GetCursorInfo(&mut info) } == 0 {
            return false;
        }
        info.flags & CURSOR_SHOWING != 0
            && !info.hCursor.is_null()
            && rect_contains(rect, info.ptScreenPos.x, info.ptScreenPos.y)
    }

    #[cfg(not(target_os = "windows"))]
    fn pointer_over(_rect: PhysRect) -> bool {
        false
    }

    /// Where the pill goes now; None while the game is not the active
    /// window (alt-tabbed, minimized, another app clicked).
    fn target_rect(
        app: &tauri::AppHandle,
        payload: &LiveTimerPayload,
        width: f64,
    ) -> Result<Option<PhysRect>, String> {
        let size = (width, WINDOW_LOGICAL_HEIGHT);
        // A console timer has no process, so nothing to follow or hide for.
        if !payload.target_pids.is_empty() {
            if !game_in_front(&payload.target_pids) {
                return Ok(None);
            }
            if let Some(area) = game_area(&payload.target_pids) {
                let center_x = f64::from(area.x) + f64::from(area.width) / 2.0;
                let center_y = f64::from(area.y) + f64::from(area.height) / 2.0;
                let scale = app
                    .monitor_from_point(center_x, center_y)
                    .ok()
                    .flatten()
                    .map_or(1.0, |monitor| monitor.scale_factor());
                return Ok(Some(timer_rect(area, scale, &payload.corner, size)));
            }
        }
        let monitor = crate::notification_overlay::popup_monitor(app, payload.monitor.as_deref())?;
        let area = monitor.work_area();
        Ok(Some(timer_rect(
            PhysRect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            },
            monitor.scale_factor(),
            &payload.corner,
            size,
        )))
    }

    /// Shows or hides without ever activating the pill, so the game keeps
    /// focus, and without waiting on the window's thread.
    #[cfg(target_os = "windows")]
    fn set_shown(window: &tauri::WebviewWindow, shown: bool) -> Result<(), String> {
        use windows_sys::Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{ShowWindowAsync, SW_HIDE, SW_SHOWNOACTIVATE},
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            ShowWindowAsync(
                hwnd.0 as HWND,
                if shown { SW_SHOWNOACTIVATE } else { SW_HIDE },
            )
        };
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    fn set_shown(window: &tauri::WebviewWindow, shown: bool) -> Result<(), String> {
        if shown { window.show() } else { window.hide() }.map_err(|error| error.to_string())
    }

    /// Lets clicks pass through the pill to the game, or makes it take them
    /// for its pause button. Set on the window itself, like set_shown: tao's
    /// own setter re-applies all of tao's flags, and those still say hidden
    /// because set_shown goes around tao, so the pill vanished as soon as the
    /// mouse came onto it (tao 0.35.2 WindowState::apply_diff).
    #[cfg(target_os = "windows")]
    fn let_clicks_through(window: &tauri::WebviewWindow, through: bool) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        set_click_through_style(hwnd.0 as windows_sys::Win32::Foundation::HWND, through);
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    fn let_clicks_through(window: &tauri::WebviewWindow, through: bool) -> Result<(), String> {
        window
            .set_ignore_cursor_events(through)
            .map_err(|error| error.to_string())
    }

    /// The two styles tao sets for click-through, and nothing else: the pill
    /// stays shown, on top and unable to take focus.
    #[cfg(target_os = "windows")]
    pub(super) fn set_click_through_style(
        hwnd: windows_sys::Win32::Foundation::HWND,
        through: bool,
    ) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
        };
        let bits = (WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize;
        unsafe {
            let styles = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let next = if through { styles | bits } else { styles & !bits };
            if next != styles {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            }
        }
    }

    fn apply(window: &tauri::WebviewWindow, target: Option<PhysRect>) -> Result<(), String> {
        let Some(rect) = target else {
            return set_shown(window, false);
        };
        window
            .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
            .map_err(|error| error.to_string())?;
        set_shown(window, true)
    }

    /// Moves the pill along with the game's window, and hides it while the
    /// game is not in front, until the pill is closed. While the mouse rests
    /// on it, it takes clicks for its pause button.
    fn follow(app: tauri::AppHandle, label: String) {
        tauri::async_runtime::spawn(async move {
            let mut applied = None;
            let mut hovered = false;
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
                let width = logical_width(&app.state::<LiveTimerState>());
                let Ok(target) = target_rect(&app, &payload, width) else {
                    continue;
                };
                if applied != Some(target) && apply(&window, target).is_ok() {
                    applied = Some(target);
                }
                let over = target.is_some_and(pointer_over);
                if over != hovered && let_clicks_through(&window, !over).is_ok() {
                    hovered = over;
                    let _ = app.emit_to(&label, HOVER_EVENT, over);
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
        apply(&window, target_rect(app, &payload, logical_width(state))?)
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
        state.width.lock().map_err(|error| error.to_string())?.take();
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

/// The pill's pause button: the main window pauses or resumes the game the
/// pill shows.
#[tauri::command(async)]
pub fn live_timer_toggle_pause(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, LiveTimerState>,
) -> Result<(), String> {
    use tauri::Emitter;
    let label = state
        .window_label
        .lock()
        .map_err(|error| error.to_string())?;
    if label.as_deref() != Some(window.label()) {
        return Err("unauthorized window".to_string());
    }
    app.emit_to(crate::notification_overlay::MAIN_LABEL, TOGGLE_PAUSE_EVENT, ())
        .map_err(|error| error.to_string())
}

/// The pill page says how wide it needs its window: wider with counts, back
/// to the usual width without.
#[tauri::command(async)]
pub fn live_timer_fit(
    window: tauri::Window,
    state: tauri::State<'_, LiveTimerState>,
    width: f64,
) -> Result<(), String> {
    let label = state
        .window_label
        .lock()
        .map_err(|error| error.to_string())?;
    if label.as_deref() != Some(window.label()) {
        return Err("unauthorized window".to_string());
    }
    let width = fit_width(width).ok_or_else(|| "invalid timer width".to_string())?;
    *state.width.lock().map_err(|error| error.to_string())? = Some(width);
    Ok(())
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
    fn the_window_grows_with_the_counts_within_limits() {
        assert_eq!(fit_width(330.0), Some(330.0));
        assert_eq!(fit_width(100.0), Some(WINDOW_LOGICAL_WIDTH));
        assert_eq!(fit_width(5000.0), Some(MAX_WINDOW_LOGICAL_WIDTH));
        assert_eq!(fit_width(f64::NAN), None);
    }

    #[test]
    fn reads_counts_the_way_the_main_window_writes_them_and_caps_them() {
        let payload: LiveTimerPayload = serde_json::from_value(serde_json::json!({
            "countFromMs": 1,
            "pausedAtMs": null,
            "corner": "top-left",
            "monitor": "primary",
            "accentColor": null,
            "targetPids": [],
            "pauseLabel": "Pause",
            "resumeLabel": "Resume",
            "counts": (0..12).map(|index| serde_json::json!({
                "id": format!("c{index}"),
                "label": if index == 0 { serde_json::Value::Null } else { serde_json::json!("m".repeat(300)) },
                "value": 313
            })).collect::<Vec<_>>(),
            "pulse": { "id": "c0", "seq": 4 }
        }))
        .unwrap();
        let clean = sanitize(payload);
        assert_eq!(clean.counts.len(), COUNT_LIMIT);
        assert_eq!(clean.counts[0].label, None);
        assert_eq!(clean.counts[1].label.as_ref().unwrap().chars().count(), 100);
        assert_eq!(clean.pulse, Some(LiveTimerPulse { id: "c0".into(), seq: 4 }));
        // Older main windows send no counts.
        let old: LiveTimerPayload = serde_json::from_value(serde_json::json!({
            "countFromMs": 1,
            "corner": "top-left",
            "accentColor": null
        }))
        .unwrap();
        assert!(old.counts.is_empty() && old.pulse.is_none());
    }

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
            count_from_ms: 0,
            paused_at_ms: None,
            corner: "middle".to_string(),
            monitor: Some("m".repeat(500)),
            accent_color: None,
            target_pids: vec![30, 0, 7, 30],
            pause_label: "p".repeat(500),
            resume_label: String::new(),
            counts: Vec::new(),
            pulse: None,
        });
        assert_eq!(payload.corner, "top-left");
        assert_eq!(payload.pause_label.chars().count(), 200);
        assert_eq!(
            payload.monitor.map(|value| value.chars().count()),
            Some(200)
        );
        assert_eq!(payload.target_pids, vec![7, 30]);
    }

    #[test]
    fn takes_clicks_only_with_the_pointer_on_the_pill() {
        let pill = PhysRect {
            x: -200,
            y: 12,
            width: 216,
            height: 56,
        };
        assert!(rect_contains(pill, -200, 12));
        assert!(rect_contains(pill, 15, 67));
        assert!(!rect_contains(pill, 16, 40));
        assert!(!rect_contains(pill, -100, 68));
        assert!(!rect_contains(pill, -201, 40));
    }

    #[test]
    fn reads_a_paused_session_from_the_main_window() {
        let payload: LiveTimerPayload = serde_json::from_value(serde_json::json!({
            "countFromMs": 1_793_185_200_000_u64,
            "pausedAtMs": 1_793_188_800_000_u64,
            "corner": "top-right",
            "accentColor": null,
            "targetPids": [4],
            "pauseLabel": "Pause",
            "resumeLabel": "Resume",
        }))
        .unwrap();
        assert_eq!(payload.paused_at_ms, Some(1_793_188_800_000));
        let running: LiveTimerPayload = serde_json::from_value(serde_json::json!({
            "countFromMs": 1_793_185_200_000_u64,
            "pausedAtMs": null,
            "corner": "top-left",
            "accentColor": null,
        }))
        .unwrap();
        assert_eq!(running.paused_at_ms, None);
    }

    /// The pill takes clicks while the mouse rests on it, for its pause
    /// button, and lets them through to the game again once the mouse leaves
    /// (docs/pause-timer-plan.md, option C). It stays shown, on top and
    /// unable to take focus all along. On 2026-11-09 it vanished as soon as
    /// the mouse came onto it.
    #[cfg(target_os = "windows")]
    #[test]
    fn the_pill_stays_shown_and_on_top_while_the_mouse_rests_on_it() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindowLongPtrW, IsWindowVisible, ShowWindow,
            GWL_EXSTYLE, SW_SHOWNOACTIVATE, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
            WS_EX_TRANSPARENT, WS_POPUP,
        };
        let click_through = WS_EX_TRANSPARENT | WS_EX_LAYERED;
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        // The pill as it first shows: on top, never activated, clicks pass
        // through, shown without activating as set_shown does. Off screen,
        // so nothing flashes while the tests run.
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_NOACTIVATE | click_through,
                class.as_ptr(),
                std::ptr::null(),
                WS_POPUP,
                -20_000,
                -20_000,
                216,
                56,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!hwnd.is_null(), "no test window");
        unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
        let state = || unsafe {
            (
                IsWindowVisible(hwnd) != 0,
                GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32,
            )
        };

        imp::set_click_through_style(hwnd, false);
        let (shown_on_pill, styles_on_pill) = state();
        imp::set_click_through_style(hwnd, true);
        let (shown_after, styles_after) = state();
        unsafe { DestroyWindow(hwnd) };

        assert!(shown_on_pill, "the pill vanished when the mouse came onto it");
        assert_eq!(styles_on_pill & click_through, 0, "its pause button can't be clicked");
        assert!(shown_after, "the pill vanished when the mouse left it");
        assert_eq!(
            styles_after & click_through,
            click_through,
            "clicks no longer reach the game"
        );
        for styles in [styles_on_pill, styles_after] {
            assert_ne!(styles & WS_EX_TOPMOST, 0, "the pill fell behind the game");
            assert_ne!(styles & WS_EX_NOACTIVATE, 0, "the pill could take the game's focus");
        }
    }

    /// Guard, not a behaviour test. set_shown shows the pill around tao, so
    /// tao's own flags keep saying hidden, and any tao flag setter re-applies
    /// them and hides the pill (tao 0.35.2 WindowState::apply_diff). So the
    /// code that runs while the pill shows changes its window only through
    /// our own Win32 calls, its size and its place.
    #[test]
    fn the_shown_pill_never_goes_through_tao_window_flags() {
        let source = include_str!("live_timer.rs");
        let start = source.find("fn apply(").expect("apply");
        let end = source.find("pub fn show(").expect("show");
        let while_shown = &source[start..end];
        for (at, _) in while_shown.match_indices(".set_") {
            let call = &while_shown[at..];
            assert!(
                call.starts_with(".set_size(") || call.starts_with(".set_position("),
                "tao window setter while the pill shows: {}",
                call.lines().next().unwrap_or_default()
            );
        }
        for call in [".show()", ".hide()"] {
            assert!(
                !while_shown.contains(call),
                "tao {call} while the pill shows"
            );
        }
    }
}
