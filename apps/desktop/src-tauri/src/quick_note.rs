//! The quick note box: a small window over the game for writing a note to a
//! session, a caption to a screenshot just taken, or (quick add) searching a
//! game to add to My Games. Unlike the notification overlay it takes keyboard
//! focus, and it hands focus back to the window that had it (usually the game)
//! when it closes.

use crate::screenshot::caption::CAPTION_LIMIT;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

pub const LABEL: &str = "quick-note";
pub const SAVE_EVENT: &str = "playcounter:quick-note-save";
/// Sent when the caption box closes, with or without a caption.
pub const CAPTION_EVENT: &str = "playcounter:screenshot-caption-close";
/// Same limit as the main window's session notes.
const NOTE_LIMIT: usize = 1000;
#[cfg(not(target_os = "macos"))]
const WINDOW_LOGICAL_WIDTH: f64 = 560.0;
#[cfg(not(target_os = "macos"))]
const WINDOW_LOGICAL_HEIGHT: f64 = 236.0;
/// The caption box shows the picture, with the caption under it.
#[cfg(not(target_os = "macos"))]
const CAPTION_WINDOW_LOGICAL_WIDTH: f64 = 488.0;
#[cfg(not(target_os = "macos"))]
const CAPTION_WINDOW_LOGICAL_HEIGHT: f64 = 430.0;
/// The quick add box is as wide as the note box. It starts with the field and
/// the buttons, grows with the search results up to its full height, and is
/// placed as if it had that height, so its top edge never moves.
#[cfg(not(target_os = "macos"))]
const QUICK_ADD_WIDTH: f64 = 560.0;
#[cfg(not(target_os = "macos"))]
const QUICK_ADD_START_HEIGHT: f64 = 140.0;
const QUICK_ADD_MIN_HEIGHT: f64 = 96.0;
const QUICK_ADD_MAX_HEIGHT: f64 = 440.0;
/// The quick add box asks the main window to search, and to add a picked game.
pub const QUICK_ADD_SEARCH_EVENT: &str = "playcounter:quick-add-search";
pub const QUICK_ADD_PICK_EVENT: &str = "playcounter:quick-add-pick";
/// The main window's answer to the quick add box.
pub const QUICK_ADD_REPLY_EVENT: &str = "playcounter:quick-add-reply";
const QUERY_LIMIT: usize = 200;
const RESULT_LIMIT: usize = 20;
#[cfg(target_os = "macos")]
const UNSUPPORTED: &str = "Desktop overlays are not supported on this platform.";

/// The screenshot a caption is written for, instead of a session note.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTarget {
    path: String,
    /// The picture as the box can load it.
    picture_url: String,
    /// When it was taken, ready to show.
    taken_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotePayload {
    /// The session fields are absent for the quick add box.
    #[serde(default)]
    session_id: i64,
    #[serde(default)]
    game_name: String,
    cover_url: Option<String>,
    #[serde(default)]
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
    /// Set for a screenshot caption.
    #[serde(default)]
    caption: Option<CaptionTarget>,
    /// Set for the quick add box.
    #[serde(default)]
    quick_add: bool,
}

/// A search result as the quick add box shows it.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddGame {
    igdb_id: i64,
    name: String,
    cover_url: Option<String>,
    release_year: Option<i32>,
    /// Already in My Games: the box says so instead of adding it.
    in_library: bool,
}

/// What the main window tells the quick add box: the results of a search (or
/// why it failed), and what a pick did.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum QuickAddReply {
    Results {
        query: String,
        games: Vec<QuickAddGame>,
    },
    Error {
        query: String,
        message: String,
    },
    Added {
        igdb_id: i64,
    },
    Already {
        igdb_id: i64,
    },
}

#[derive(Serialize, Clone)]
struct QuickAddSearch {
    query: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuickAddPick {
    igdb_id: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SavedNote {
    session_id: i64,
    note: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClosedCaption {
    path: String,
    /// None when the player skipped it.
    caption: Option<String>,
}

#[derive(Default)]
pub struct QuickNoteState {
    pending: Mutex<Option<QuickNotePayload>>,
    session_id: Mutex<Option<i64>>,
    /// The window in front when the note was asked for, as a raw HWND.
    foreground: Mutex<Option<isize>>,
    /// The picture the open box writes a caption for.
    caption_path: Mutex<Option<String>>,
    /// The open box is the quick add box.
    quick_add: Mutex<bool>,
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
    payload.caption = payload.caption.map(|target| CaptionTarget {
        path: truncate(target.path, 4096),
        picture_url: truncate(target.picture_url, 8192),
        taken_at: truncate(target.taken_at, 64),
    });
    payload
}

fn sanitize_reply(reply: QuickAddReply) -> QuickAddReply {
    match reply {
        QuickAddReply::Results { query, games } => QuickAddReply::Results {
            query: truncate(query, QUERY_LIMIT),
            games: games
                .into_iter()
                .take(RESULT_LIMIT)
                .map(|game| QuickAddGame {
                    name: truncate(game.name, 200),
                    cover_url: game.cover_url.map(|url| truncate(url, 2048)),
                    ..game
                })
                .collect(),
        },
        QuickAddReply::Error { query, message } => QuickAddReply::Error {
            query: truncate(query, QUERY_LIMIT),
            message: truncate(message, 500),
        },
        other => other,
    }
}

/// The session a note box writes to. The quick add box has none, so nothing it
/// closes with can land on a session.
fn session_of(payload: &QuickNotePayload) -> Option<i64> {
    (!payload.quick_add).then_some(payload.session_id)
}

/// The quick add box's height in logical pixels, within its limits. None for a
/// height that isn't a number.
fn fit_height(height: f64) -> Option<f64> {
    height
        .is_finite()
        .then(|| height.clamp(QUICK_ADD_MIN_HEIGHT, QUICK_ADD_MAX_HEIGHT))
}

/// The box's size in logical pixels when it opens.
#[cfg(not(target_os = "macos"))]
fn window_size(payload: &QuickNotePayload) -> (f64, f64) {
    if payload.quick_add {
        (QUICK_ADD_WIDTH, QUICK_ADD_START_HEIGHT)
    } else if payload.caption.is_some() {
        (CAPTION_WINDOW_LOGICAL_WIDTH, CAPTION_WINDOW_LOGICAL_HEIGHT)
    } else {
        (WINDOW_LOGICAL_WIDTH, WINDOW_LOGICAL_HEIGHT)
    }
}

/// The height the box is placed for. The quick add box grows downwards, so it
/// is placed for its full height from the start.
#[cfg(not(target_os = "macos"))]
fn placement_height(payload: &QuickNotePayload) -> f64 {
    if payload.quick_add {
        QUICK_ADD_MAX_HEIGHT
    } else {
        window_size(payload).1
    }
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

    /// False when a box was already open: it comes back instead.
    pub fn open(
        app: &tauri::AppHandle,
        state: &QuickNoteState,
        payload: QuickNotePayload,
    ) -> Result<bool, String> {
        // A second press while the box is open brings it back instead of
        // replacing what is being typed.
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.show();
            window.set_focus().map_err(|error| error.to_string())?;
            return Ok(false);
        }
        {
            let mut foreground = state.foreground.lock().map_err(|error| error.to_string())?;
            if foreground.is_none() {
                *foreground = foreground_window();
            }
        }
        let monitor = crate::notification_overlay::popup_monitor(app, payload.monitor.as_deref())?;
        let (logical_width, logical_height) = window_size(&payload);
        let logical_placement = placement_height(&payload);
        *state.session_id.lock().map_err(|error| error.to_string())? = session_of(&payload);
        *state
            .caption_path
            .lock()
            .map_err(|error| error.to_string())? =
            payload.caption.as_ref().map(|target| target.path.clone());
        *state.quick_add.lock().map_err(|error| error.to_string())? = payload.quick_add;
        *state.pending.lock().map_err(|error| error.to_string())? = Some(payload);
        let window = tauri::WebviewWindowBuilder::new(
            app,
            LABEL,
            tauri::WebviewUrl::App("quick-note.html".into()),
        )
        .title("PlayCounter quick note")
        .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
        .inner_size(logical_width, logical_height)
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
        let width = ((logical_width * scale).round() as u32).min(area.size.width);
        let height = ((logical_height * scale).round() as u32).min(area.size.height);
        let placed = ((logical_placement * scale).round() as u32).min(area.size.height);
        let x = area.position.x + ((area.size.width - width) / 2) as i32;
        // High enough to stay clear of subtitles and HUDs at the bottom.
        let y = area.position.y + ((area.size.height - placed) / 5) as i32;
        window
            .set_size(tauri::PhysicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        Ok(true)
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
        state
            .caption_path
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        *state.quick_add.lock().map_err(|error| error.to_string())? = false;
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

    /// Sets the box's height, keeping its width and its top edge.
    pub fn fit(window: &tauri::Window, logical_height: f64) -> Result<(), String> {
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let height = (logical_height * scale).round() as u32;
        if size.height == height {
            return Ok(());
        }
        window
            .set_size(tauri::PhysicalSize::new(size.width, height))
            .map_err(|error| error.to_string())
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
    ) -> Result<bool, String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn close(
        _app: &tauri::AppHandle,
        _state: &QuickNoteState,
        _restore_focus: bool,
    ) -> Result<(), String> {
        Ok(())
    }
    pub fn fit(_window: &tauri::Window, _logical_height: f64) -> Result<(), String> {
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

fn quick_add_open(state: &QuickNoteState) -> Result<bool, String> {
    Ok(*state.quick_add.lock().map_err(|error| error.to_string())?)
}

/// Only the quick add box searches, picks and fits itself.
fn quick_add_box_only(window: &tauri::Window, state: &QuickNoteState) -> Result<(), String> {
    note_window_only(window)?;
    if quick_add_open(state)? {
        Ok(())
    } else {
        Err("no quick add box is open".to_string())
    }
}

// Window operations dispatch onto Tauri's main loop; see notification_overlay.
/// False when a box was already open and came back instead.
#[tauri::command(async)]
pub fn quick_note_open(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    payload: QuickNotePayload,
) -> Result<bool, String> {
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

/// `note` is None for Cancel, and for Skip in the caption box. `restore_focus`
/// is false when the box closes because the player clicked somewhere else.
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
    let caption_path = state
        .caption_path
        .lock()
        .map_err(|error| error.to_string())?
        .take();
    if let Some(path) = caption_path {
        // Always sent: the main window shows the screenshot popup then.
        app.emit_to(
            crate::notification_overlay::MAIN_LABEL,
            CAPTION_EVENT,
            ClosedCaption {
                path,
                caption: note.map(|caption| truncate(caption, CAPTION_LIMIT)),
            },
        )
        .map_err(|error| error.to_string())?;
    } else if let (Some(note), Some(session_id)) = (note, session_id) {
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

/// The quick add box asks the main window to search for a game.
#[tauri::command(async)]
pub fn quick_add_search(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    query: String,
) -> Result<(), String> {
    quick_add_box_only(&window, &state)?;
    use tauri::Emitter;
    app.emit_to(
        crate::notification_overlay::MAIN_LABEL,
        QUICK_ADD_SEARCH_EVENT,
        QuickAddSearch {
            query: truncate(query, QUERY_LIMIT),
        },
    )
    .map_err(|error| error.to_string())
}

/// The quick add box asks the main window to add the game it marked.
#[tauri::command(async)]
pub fn quick_add_pick(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    igdb_id: i64,
) -> Result<(), String> {
    quick_add_box_only(&window, &state)?;
    use tauri::Emitter;
    app.emit_to(
        crate::notification_overlay::MAIN_LABEL,
        QUICK_ADD_PICK_EVENT,
        QuickAddPick { igdb_id },
    )
    .map_err(|error| error.to_string())
}

/// The main window answers the quick add box. Dropped when the box closed in
/// the meantime.
#[tauri::command(async)]
pub fn quick_add_reply(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    reply: QuickAddReply,
) -> Result<(), String> {
    main_only(&window)?;
    if !quick_add_open(&state)? {
        return Ok(());
    }
    use tauri::Emitter;
    app.emit_to(LABEL, QUICK_ADD_REPLY_EVENT, sanitize_reply(reply))
        .map_err(|error| error.to_string())
}

/// The quick add box grows and shrinks with what it shows.
#[tauri::command(async)]
pub fn quick_add_fit(
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    height: f64,
) -> Result<(), String> {
    quick_add_box_only(&window, &state)?;
    let height = fit_height(height).ok_or_else(|| "invalid box height".to_string())?;
    imp::fit(&window, height)
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
            caption: None,
            quick_add: false,
        }
    }

    /// What the main window sends for the quick add box: no session at all.
    fn quick_add_payload() -> QuickNotePayload {
        serde_json::from_value(serde_json::json!({
            "quickAdd": true,
            "labels": { "Quick add game": "Spiel schnell hinzufügen" },
            "monitor": "primary",
            "locale": "de",
            "theme": "dark",
            "accentColor": null,
            "reducedMotion": false
        }))
        .expect("a quick add payload needs no session")
    }

    fn found(igdb_id: i64) -> QuickAddGame {
        QuickAddGame {
            igdb_id,
            name: "n".repeat(300),
            cover_url: Some("u".repeat(3000)),
            release_year: Some(2020),
            in_library: false,
        }
    }

    #[test]
    fn a_quick_add_box_needs_and_keeps_no_session() {
        let quick_add = quick_add_payload();
        assert!(quick_add.quick_add);
        assert_eq!(session_of(&quick_add), None);
        assert_eq!(session_of(&payload()), Some(1));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_quick_add_box_starts_small_and_is_placed_for_its_full_height() {
        let quick_add = quick_add_payload();
        assert_eq!(
            window_size(&quick_add),
            (QUICK_ADD_WIDTH, QUICK_ADD_START_HEIGHT)
        );
        assert!(QUICK_ADD_START_HEIGHT < QUICK_ADD_MAX_HEIGHT);
        assert_eq!(placement_height(&quick_add), QUICK_ADD_MAX_HEIGHT);
        // The note box is placed for the size it has.
        assert_eq!(placement_height(&payload()), WINDOW_LOGICAL_HEIGHT);
    }

    #[test]
    fn the_quick_add_box_grows_and_shrinks_within_its_limits() {
        assert_eq!(fit_height(300.0), Some(300.0));
        assert_eq!(fit_height(10.0), Some(QUICK_ADD_MIN_HEIGHT));
        assert_eq!(fit_height(5000.0), Some(QUICK_ADD_MAX_HEIGHT));
        assert_eq!(fit_height(f64::NAN), None);
        assert_eq!(fit_height(f64::INFINITY), None);
    }

    #[test]
    fn caps_what_the_main_window_replies() {
        let QuickAddReply::Results { query, games } = sanitize_reply(QuickAddReply::Results {
            query: "q".repeat(300),
            games: (0..30).map(found).collect(),
        }) else {
            panic!("results stay results");
        };
        assert_eq!(query.chars().count(), QUERY_LIMIT);
        assert_eq!(games.len(), RESULT_LIMIT);
        assert!(games.iter().all(|game| game.name.chars().count() == 200
            && game.cover_url.as_ref().map(|url| url.chars().count()) == Some(2048)));
        let QuickAddReply::Error { message, .. } = sanitize_reply(QuickAddReply::Error {
            query: String::new(),
            message: "m".repeat(2000),
        }) else {
            panic!("errors stay errors");
        };
        assert_eq!(message.chars().count(), 500);
    }

    #[test]
    fn reads_the_replies_the_way_the_main_window_writes_them() {
        let added: QuickAddReply =
            serde_json::from_value(serde_json::json!({ "kind": "added", "igdbId": 100 })).unwrap();
        assert_eq!(added, QuickAddReply::Added { igdb_id: 100 });
        let already: QuickAddReply =
            serde_json::from_value(serde_json::json!({ "kind": "already", "igdbId": 100 }))
                .unwrap();
        assert_eq!(already, QuickAddReply::Already { igdb_id: 100 });
        let results: QuickAddReply = serde_json::from_value(serde_json::json!({
            "kind": "results",
            "query": "hades",
            "games": [{
                "igdbId": 100,
                "name": "Hades",
                "coverUrl": null,
                "releaseYear": 2020,
                "inLibrary": true
            }]
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&results).unwrap(),
            serde_json::json!({
                "kind": "results",
                "query": "hades",
                "games": [{
                    "igdbId": 100,
                    "name": "Hades",
                    "coverUrl": null,
                    "releaseYear": 2020,
                    "inLibrary": true
                }]
            })
        );
        let error: QuickAddReply = serde_json::from_value(serde_json::json!({
            "kind": "error",
            "query": "hades",
            "message": "Game search failed (503)."
        }))
        .unwrap();
        assert!(matches!(error, QuickAddReply::Error { .. }));
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

    #[test]
    fn caps_the_picture_a_caption_is_for() {
        let clean = sanitize(QuickNotePayload {
            caption: Some(CaptionTarget {
                path: "p".repeat(5000),
                picture_url: "u".repeat(9000),
                taken_at: "t".repeat(100),
            }),
            ..payload()
        });
        let caption = clean.caption.unwrap();
        assert_eq!(caption.path.chars().count(), 4096);
        assert_eq!(caption.picture_url.chars().count(), 8192);
        assert_eq!(caption.taken_at.chars().count(), 64);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_caption_box_is_bigger_than_the_note_box() {
        let note = window_size(&payload());
        let caption = window_size(&QuickNotePayload {
            caption: Some(CaptionTarget {
                path: "C:\\pictures\\shot.jpg".into(),
                picture_url: "asset://shot.jpg".into(),
                taken_at: "21:44".into(),
            }),
            ..payload()
        });
        assert_eq!(note, (WINDOW_LOGICAL_WIDTH, WINDOW_LOGICAL_HEIGHT));
        assert_eq!(
            caption,
            (CAPTION_WINDOW_LOGICAL_WIDTH, CAPTION_WINDOW_LOGICAL_HEIGHT)
        );
        assert!(caption.1 > note.1);
    }
}
