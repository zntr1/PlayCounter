//! The quick note box: a small window over the game for writing a note to a
//! session, a caption to a screenshot just taken, (quick add) searching a
//! game to add to My Games, or (counter box) counting with the running game's
//! counters, or (screenshot box) showing the running game's pictures as big
//! as the game's screen. Unlike the notification overlay it takes keyboard
//! focus, and it hands focus back to the window that had it (usually the
//! game) when it closes.

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
/// The counter box is a little wider than the note box: each row has its
/// toggles, its number and its buttons. It fits itself like quick add.
#[cfg(not(target_os = "macos"))]
const COUNTER_BOX_WIDTH: f64 = 600.0;
#[cfg(not(target_os = "macos"))]
const COUNTER_BOX_START_HEIGHT: f64 = 300.0;
/// What the counter box asks the main window to do.
pub const COUNTER_BOX_ACTION_EVENT: &str = "playcounter:counter-box-action";
/// What the main window tells the counter box it shows now.
pub const COUNTER_BOX_UPDATE_EVENT: &str = "playcounter:counter-box-update";
/// Same limits as the main window's counters (counters.ts).
const COUNTER_LIMIT: usize = 50;
const COUNTER_NAME_LIMIT: usize = 60;
const COUNT_LIMIT: u32 = 10_000_000;
/// Texts the boxes get in the main window's language. The screenshot box
/// needs the most: mark up alone has about 26.
const LABEL_LIMIT: usize = 96;
/// What the screenshot box asks the main window to do.
pub const SCREENSHOT_BOX_ACTION_EVENT: &str = "playcounter:screenshot-box-action";
/// The main window's new list for the screenshot box.
pub const SCREENSHOT_BOX_UPDATE_EVENT: &str = "playcounter:screenshot-box-update";
/// The screenshot box keeps the game's newest pictures, this many
/// (screenshotBox.ts).
const SCREENSHOT_BOX_LIMIT: usize = 500;
/// The marks for one picture as base64 text. A see-through PNG of marks on
/// an 8K picture stays far below.
const MARKS_LIMIT: usize = 64 * 1024 * 1024;
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

/// Where a picture sits in the screenshot box's row: its session's day, or
/// "This session".
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureGroup {
    key: String,
    label: String,
    current: bool,
}

/// One picture as the screenshot box shows it, everything ready to show.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxPicture {
    path: String,
    url: String,
    thumb_url: String,
    taken_at: String,
    group: PictureGroup,
    caption: Option<String>,
    markable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BoxActionKind {
    Caption,
    Recycle,
    MarkUp,
}

/// What the main window did with the box's last action.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxDone {
    kind: BoxActionKind,
    path: String,
    ok: bool,
}

/// The game's pictures, oldest first, and the one to open at; with `done`
/// after an action.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotBox {
    pictures: Vec<BoxPicture>,
    index: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    done: Option<BoxDone>,
}

/// What the screenshot box asks the main window for.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScreenshotBoxAction {
    Caption { path: String, caption: Option<String> },
    Recycle { path: String },
    /// The marks as a see-through PNG, in base64.
    MarkUp { path: String, png: String },
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
    /// Set for the counter box.
    #[serde(default)]
    counter_box: Option<CounterBox>,
    /// Set for the screenshot box.
    #[serde(default)]
    screenshots: Option<ScreenshotBox>,
}

/// One counter as the counter box shows it.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterRow {
    id: String,
    name: String,
    shown: bool,
    /// View + D-pad up counts this one.
    #[serde(default)]
    controller: bool,
    key: Option<String>,
    key_label: Option<String>,
    key_error: Option<String>,
    session: u32,
    playthrough: u32,
}

/// What the counter box shows: the running game's counters.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterBox {
    session_id: i64,
    game_name: String,
    cover_url: Option<String>,
    playthrough_name: String,
    rows: Vec<CounterRow>,
    notice: Option<String>,
    /// "Ctrl+Alt+Z takes the last one back", when that key is set.
    #[serde(default)]
    undo_hint: Option<String>,
    /// "Count with controller" is on: rows show the controller icon.
    #[serde(default)]
    controller_enabled: bool,
}

/// What the counter box asks the main window for.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CounterBoxAction {
    Count { counter_id: String, delta: i32 },
    Shown { counter_id: String, shown: bool },
    Controller { counter_id: String },
    Add { name: String },
    Key { counter_id: String, key: Option<String> },
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
    /// The open box is the counter box.
    counter_box: Mutex<bool>,
    /// The open box is the screenshot box.
    screenshot_box: Mutex<bool>,
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
        .take(LABEL_LIMIT)
        .map(|(key, value)| (truncate(key, 200), truncate(value, 200)))
        .collect();
    payload.counter_box = payload.counter_box.map(sanitize_counter_box);
    payload.monitor = payload.monitor.map(|value| truncate(value, 200));
    payload.locale = payload.locale.map(|value| truncate(value, 35));
    payload.theme = truncate(payload.theme, 16);
    payload.accent_color = payload.accent_color.map(|value| truncate(value, 16));
    payload.screenshots = payload.screenshots.map(sanitize_screenshot_box);
    payload.caption = payload.caption.map(|target| CaptionTarget {
        path: truncate(target.path, 4096),
        picture_url: truncate(target.picture_url, 8192),
        taken_at: truncate(target.taken_at, 64),
    });
    payload
}

fn sanitize_counter_box(mut counter_box: CounterBox) -> CounterBox {
    counter_box.game_name = truncate(counter_box.game_name, 200);
    counter_box.cover_url = counter_box.cover_url.map(|url| truncate(url, 2048));
    counter_box.playthrough_name = truncate(counter_box.playthrough_name, 200);
    counter_box.notice = counter_box.notice.map(|notice| truncate(notice, 500));
    counter_box.undo_hint = counter_box.undo_hint.map(|hint| truncate(hint, 200));
    counter_box.rows.truncate(COUNTER_LIMIT);
    for row in &mut counter_box.rows {
        row.id = truncate(std::mem::take(&mut row.id), 64);
        row.name = truncate(std::mem::take(&mut row.name), COUNTER_NAME_LIMIT);
        row.key = row.key.take().map(|key| truncate(key, 64));
        row.key_label = row.key_label.take().map(|label| truncate(label, 64));
        row.key_error = row.key_error.take().map(|error| truncate(error, 500));
        row.session = row.session.min(COUNT_LIMIT);
        row.playthrough = row.playthrough.min(COUNT_LIMIT);
    }
    counter_box
}

/// Keeps the newest pictures and cuts every text to size. The one shown stays
/// the one it was, or the newest when it was left out.
fn sanitize_screenshot_box(mut screenshots: ScreenshotBox) -> ScreenshotBox {
    let dropped = screenshots
        .pictures
        .len()
        .saturating_sub(SCREENSHOT_BOX_LIMIT);
    screenshots.pictures.drain(..dropped);
    screenshots.index = screenshots
        .index
        .saturating_sub(dropped)
        .min(screenshots.pictures.len().saturating_sub(1));
    screenshots.pictures = screenshots
        .pictures
        .into_iter()
        .map(|picture| BoxPicture {
            path: truncate(picture.path, 4096),
            url: truncate(picture.url, 8192),
            thumb_url: truncate(picture.thumb_url, 8192),
            taken_at: truncate(picture.taken_at, 64),
            group: PictureGroup {
                key: truncate(picture.group.key, 64),
                label: truncate(picture.group.label, 64),
                current: picture.group.current,
            },
            caption: picture
                .caption
                .map(|caption| truncate(caption, CAPTION_LIMIT)),
            markable: picture.markable,
        })
        .collect();
    screenshots.done = screenshots.done.map(|done| BoxDone {
        path: truncate(done.path, 4096),
        ..done
    });
    screenshots
}

/// A caption is cut to one caption's size; marks too big for any picture are
/// refused.
fn sanitize_screenshot_action(action: ScreenshotBoxAction) -> Result<ScreenshotBoxAction, String> {
    Ok(match action {
        ScreenshotBoxAction::Caption { path, caption } => ScreenshotBoxAction::Caption {
            path: truncate(path, 4096),
            caption: caption.map(|caption| truncate(caption, CAPTION_LIMIT)),
        },
        ScreenshotBoxAction::Recycle { path } => ScreenshotBoxAction::Recycle {
            path: truncate(path, 4096),
        },
        ScreenshotBoxAction::MarkUp { path, png } => {
            if png.len() > MARKS_LIMIT {
                return Err("the marks are too big".to_string());
            }
            ScreenshotBoxAction::MarkUp {
                path: truncate(path, 4096),
                png,
            }
        }
    })
}

/// The box sends one press or one change at a time; anything bigger is cut.
fn sanitize_action(action: CounterBoxAction) -> CounterBoxAction {
    match action {
        CounterBoxAction::Count { counter_id, delta } => CounterBoxAction::Count {
            counter_id: truncate(counter_id, 64),
            delta: delta.clamp(-1, 1),
        },
        CounterBoxAction::Shown { counter_id, shown } => CounterBoxAction::Shown {
            counter_id: truncate(counter_id, 64),
            shown,
        },
        CounterBoxAction::Controller { counter_id } => CounterBoxAction::Controller {
            counter_id: truncate(counter_id, 64),
        },
        CounterBoxAction::Add { name } => CounterBoxAction::Add {
            name: truncate(name, COUNTER_NAME_LIMIT),
        },
        CounterBoxAction::Key { counter_id, key } => CounterBoxAction::Key {
            counter_id: truncate(counter_id, 64),
            key: key.map(|key| truncate(key, 64)),
        },
    }
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

/// The session a note box writes to. The quick add box, the counter box and
/// the screenshot box have none, so nothing they close with can land on a
/// session as a note.
fn session_of(payload: &QuickNotePayload) -> Option<i64> {
    (!payload.quick_add && payload.counter_box.is_none() && payload.screenshots.is_none())
        .then_some(payload.session_id)
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
    } else if payload.counter_box.is_some() {
        (COUNTER_BOX_WIDTH, COUNTER_BOX_START_HEIGHT)
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
    if payload.quick_add || payload.counter_box.is_some() {
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
        // replacing what is being typed. The screenshot key closes its box
        // instead, back to the game.
        if let Some(window) = app.get_webview_window(LABEL) {
            let screenshot_box_open =
                *state.screenshot_box.lock().map_err(|error| error.to_string())?;
            if screenshot_box_open && payload.screenshots.is_some() {
                close(app, state, true)?;
                return Ok(false);
            }
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
        *state.counter_box.lock().map_err(|error| error.to_string())? =
            payload.counter_box.is_some();
        let screenshot_box = payload.screenshots.is_some();
        *state.screenshot_box.lock().map_err(|error| error.to_string())? = screenshot_box;
        // The screenshot box covers the game's screen, not the popup screen.
        let game_screen = if screenshot_box {
            let foreground = *state.foreground.lock().map_err(|error| error.to_string())?;
            game_monitor(app, foreground)
        } else {
            None
        };
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
        if screenshot_box {
            let screen = game_screen.unwrap_or(monitor);
            window
                .set_size(*screen.size())
                .map_err(|error| error.to_string())?;
            window
                .set_position(*screen.position())
                .map_err(|error| error.to_string())?;
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
            return Ok(true);
        }
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
        *state.counter_box.lock().map_err(|error| error.to_string())? = false;
        *state.screenshot_box.lock().map_err(|error| error.to_string())? = false;
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

    /// The screen the window (the game) is on, by its middle.
    #[cfg(target_os = "windows")]
    fn game_monitor(app: &tauri::AppHandle, hwnd: Option<isize>) -> Option<tauri::Monitor> {
        use windows_sys::Win32::{Foundation::RECT, UI::WindowsAndMessaging::GetWindowRect};
        let hwnd = hwnd? as windows_sys::Win32::Foundation::HWND;
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
            return None;
        }
        let x = (f64::from(rect.left) + f64::from(rect.right)) / 2.0;
        let y = (f64::from(rect.top) + f64::from(rect.bottom)) / 2.0;
        app.monitor_from_point(x, y).ok().flatten()
    }

    #[cfg(not(target_os = "windows"))]
    fn game_monitor(_app: &tauri::AppHandle, _hwnd: Option<isize>) -> Option<tauri::Monitor> {
        None
    }

    /// The process a window belongs to; 0 when it has none any more.
    #[cfg(target_os = "windows")]
    pub fn process_id(hwnd: isize) -> u32 {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd as windows_sys::Win32::Foundation::HWND, &mut pid) };
        pid
    }

    #[cfg(not(target_os = "windows"))]
    pub fn process_id(_hwnd: isize) -> u32 {
        0
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
    pub fn process_id(_hwnd: isize) -> u32 {
        0
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

fn screenshot_box_open(state: &QuickNoteState) -> Result<bool, String> {
    Ok(*state.screenshot_box.lock().map_err(|error| error.to_string())?)
}

/// Only the screenshot box asks for captions, marks and the Recycle Bin.
fn screenshot_box_only(window: &tauri::Window, state: &QuickNoteState) -> Result<(), String> {
    note_window_only(window)?;
    if screenshot_box_open(state)? {
        Ok(())
    } else {
        Err("no screenshot box is open".to_string())
    }
}

fn counter_box_open(state: &QuickNoteState) -> Result<bool, String> {
    Ok(*state.counter_box.lock().map_err(|error| error.to_string())?)
}

/// Only the counter box counts.
fn counter_box_only(window: &tauri::Window, state: &QuickNoteState) -> Result<(), String> {
    note_window_only(window)?;
    if counter_box_open(state)? {
        Ok(())
    } else {
        Err("no counter box is open".to_string())
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

/// The counter box asks the main window to count, add or change a counter.
#[tauri::command(async)]
pub fn counter_box_action(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    action: CounterBoxAction,
) -> Result<(), String> {
    counter_box_only(&window, &state)?;
    use tauri::Emitter;
    app.emit_to(
        crate::notification_overlay::MAIN_LABEL,
        COUNTER_BOX_ACTION_EVENT,
        sanitize_action(action),
    )
    .map_err(|error| error.to_string())
}

/// The main window tells the counter box what it shows now. False when no
/// counter box is open any more.
#[tauri::command(async)]
pub fn counter_box_update(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    update: CounterBox,
) -> Result<bool, String> {
    main_only(&window)?;
    if !counter_box_open(&state)? {
        return Ok(false);
    }
    use tauri::Emitter;
    app.emit_to(LABEL, COUNTER_BOX_UPDATE_EVENT, sanitize_counter_box(update))
        .map_err(|error| error.to_string())?;
    Ok(true)
}

/// The process of the window that was in front when the hotkey was pressed,
/// so the main window knows which running game it was. None without one.
#[tauri::command(async)]
pub fn quick_note_foreground_pid(
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
) -> Result<Option<u32>, String> {
    main_only(&window)?;
    let foreground = *state.foreground.lock().map_err(|error| error.to_string())?;
    Ok(foreground
        .map(imp::process_id)
        .filter(|&pid| pid != 0 && pid != std::process::id()))
}

/// The screenshot box asks the main window to write a caption, mark up or
/// recycle a picture.
#[tauri::command(async)]
pub fn screenshot_box_action(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    action: ScreenshotBoxAction,
) -> Result<(), String> {
    screenshot_box_only(&window, &state)?;
    use tauri::Emitter;
    app.emit_to(
        crate::notification_overlay::MAIN_LABEL,
        SCREENSHOT_BOX_ACTION_EVENT,
        sanitize_screenshot_action(action)?,
    )
    .map_err(|error| error.to_string())
}

/// The main window sends the screenshot box its new list. False when no
/// screenshot box is open any more.
#[tauri::command(async)]
pub fn screenshot_box_update(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    update: ScreenshotBox,
) -> Result<bool, String> {
    main_only(&window)?;
    if !screenshot_box_open(&state)? {
        return Ok(false);
    }
    use tauri::Emitter;
    app.emit_to(LABEL, SCREENSHOT_BOX_UPDATE_EVENT, sanitize_screenshot_box(update))
        .map_err(|error| error.to_string())?;
    Ok(true)
}

/// The quick add box and the counter box grow and shrink with what they
/// show.
#[tauri::command(async)]
pub fn quick_add_fit(
    window: tauri::Window,
    state: tauri::State<'_, QuickNoteState>,
    height: f64,
) -> Result<(), String> {
    note_window_only(&window)?;
    if !quick_add_open(&state)? && !counter_box_open(&state)? {
        return Err("no box that fits itself is open".to_string());
    }
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
            counter_box: None,
            screenshots: None,
        }
    }

    fn counter_row(index: usize) -> CounterRow {
        CounterRow {
            id: "i".repeat(100),
            name: "n".repeat(100),
            shown: index % 2 == 0,
            controller: index == 0,
            key: Some("k".repeat(100)),
            key_label: Some("l".repeat(100)),
            key_error: Some("e".repeat(1000)),
            session: u32::MAX,
            playthrough: 3,
        }
    }

    /// What the main window sends for the counter box (counterBox.ts).
    fn counter_box_payload() -> QuickNotePayload {
        serde_json::from_value(serde_json::json!({
            "counterBox": {
                "sessionId": 7,
                "gameName": "Elden Ring",
                "coverUrl": null,
                "playthroughName": "Default playthrough",
                "rows": [{
                    "id": "deaths",
                    "name": "Deaths",
                    "shown": true,
                    "key": null,
                    "keyLabel": null,
                    "keyError": null,
                    "session": 14,
                    "playthrough": 313
                }],
                "notice": null
            },
            "labels": { "Counters": "Zähler" },
            "monitor": "primary",
            "locale": "de",
            "theme": "dark",
            "accentColor": null,
            "reducedMotion": false
        }))
        .expect("a counter box payload needs no note session")
    }

    #[test]
    fn a_counter_box_keeps_no_note_session() {
        let counter_box = counter_box_payload();
        assert!(counter_box.counter_box.is_some());
        assert_eq!(session_of(&counter_box), None);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_counter_box_is_placed_for_its_full_height() {
        let counter_box = counter_box_payload();
        assert_eq!(
            window_size(&counter_box),
            (COUNTER_BOX_WIDTH, COUNTER_BOX_START_HEIGHT)
        );
        assert_eq!(placement_height(&counter_box), QUICK_ADD_MAX_HEIGHT);
    }

    #[test]
    fn caps_what_the_counter_box_gets() {
        let clean = sanitize_counter_box(CounterBox {
            session_id: 1,
            game_name: "g".repeat(300),
            cover_url: Some("u".repeat(3000)),
            playthrough_name: "p".repeat(300),
            rows: (0..80).map(counter_row).collect(),
            notice: Some("n".repeat(900)),
            undo_hint: Some("u".repeat(300)),
            controller_enabled: true,
        });
        assert_eq!(clean.rows.len(), COUNTER_LIMIT);
        assert_eq!(clean.game_name.chars().count(), 200);
        assert_eq!(clean.notice.unwrap().chars().count(), 500);
        let row = &clean.rows[0];
        assert_eq!(row.id.chars().count(), 64);
        assert_eq!(row.name.chars().count(), COUNTER_NAME_LIMIT);
        assert_eq!(row.key_error.as_ref().unwrap().chars().count(), 500);
        assert_eq!(row.session, COUNT_LIMIT);
    }

    #[test]
    fn a_count_from_the_box_moves_by_one_at_most() {
        let action: CounterBoxAction = serde_json::from_value(serde_json::json!({
            "kind": "count",
            "counterId": "deaths",
            "delta": 50
        }))
        .unwrap();
        assert_eq!(
            sanitize_action(action),
            CounterBoxAction::Count {
                counter_id: "deaths".into(),
                delta: 1
            }
        );
        let key: CounterBoxAction = serde_json::from_value(serde_json::json!({
            "kind": "key",
            "counterId": "deaths",
            "key": null
        }))
        .unwrap();
        assert_eq!(
            key,
            CounterBoxAction::Key {
                counter_id: "deaths".into(),
                key: None
            }
        );
        let add: CounterBoxAction =
            serde_json::from_value(serde_json::json!({ "kind": "add", "name": "m".repeat(90) }))
                .unwrap();
        let CounterBoxAction::Add { name } = sanitize_action(add) else {
            panic!("an add stays an add");
        };
        assert_eq!(name.chars().count(), COUNTER_NAME_LIMIT);
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
        assert_eq!(clean.labels.len(), 40);
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

    /// What the main window sends for the screenshot box (screenshotBox.ts).
    fn screenshot_box_payload(pictures: usize, index: usize) -> QuickNotePayload {
        serde_json::from_value(serde_json::json!({
            "gameName": "Elden Ring",
            "coverUrl": null,
            "screenshots": {
                "pictures": (0..pictures).map(|number| serde_json::json!({
                    "path": format!("C:\\Pictures\\PlayCounter\\Elden Ring\\{number}.jpg"),
                    "url": format!("asset://{number}.jpg"),
                    "thumbUrl": format!("asset://previews/{number}.jpg"),
                    "takenAt": "23 Nov 2026, 19:40",
                    "group": { "key": "session:1", "label": "Sat 23 Nov", "current": false },
                    "caption": null,
                    "markable": true
                })).collect::<Vec<_>>(),
                "index": index
            },
            "labels": { "Mark up": "Markieren" },
            "monitor": "primary",
            "locale": "de",
            "theme": "dark",
            "accentColor": null,
            "reducedMotion": false
        }))
        .expect("a screenshot box payload needs no note session")
    }

    fn long_picture() -> BoxPicture {
        BoxPicture {
            path: "p".repeat(5000),
            url: "u".repeat(9000),
            thumb_url: "t".repeat(9000),
            taken_at: "a".repeat(100),
            group: PictureGroup {
                key: "k".repeat(100),
                label: "l".repeat(100),
                current: true,
            },
            caption: Some("c".repeat(400)),
            markable: true,
        }
    }

    #[test]
    fn a_screenshot_box_keeps_no_note_session() {
        let screenshots = screenshot_box_payload(3, 2);
        assert!(screenshots.screenshots.is_some());
        assert_eq!(session_of(&screenshots), None);
    }

    #[test]
    fn caps_the_screenshot_box_and_keeps_the_newest_pictures() {
        let clean = sanitize_screenshot_box(ScreenshotBox {
            pictures: (0..SCREENSHOT_BOX_LIMIT + 100)
                .map(|number| BoxPicture {
                    path: format!("{number}.jpg"),
                    ..long_picture()
                })
                .collect(),
            index: SCREENSHOT_BOX_LIMIT + 99,
            done: None,
        });
        assert_eq!(clean.pictures.len(), SCREENSHOT_BOX_LIMIT);
        // The oldest are left out; the one shown stays the newest.
        assert_eq!(clean.pictures[0].path, "100.jpg");
        assert_eq!(clean.index, SCREENSHOT_BOX_LIMIT - 1);
        let picture = &clean.pictures[0];
        assert_eq!(picture.url.chars().count(), 8192);
        assert_eq!(picture.thumb_url.chars().count(), 8192);
        assert_eq!(picture.taken_at.chars().count(), 64);
        assert_eq!(picture.group.key.chars().count(), 64);
        assert_eq!(picture.group.label.chars().count(), 64);
        assert_eq!(
            picture.caption.as_ref().unwrap().chars().count(),
            CAPTION_LIMIT
        );
        let long = sanitize_screenshot_box(ScreenshotBox {
            pictures: vec![long_picture()],
            index: 0,
            done: None,
        });
        assert_eq!(long.pictures[0].path.chars().count(), 4096);
    }

    #[test]
    fn a_screenshot_box_opens_at_a_picture_it_has() {
        let clean = sanitize(screenshot_box_payload(3, 40));
        assert_eq!(clean.screenshots.unwrap().index, 2);
        let empty = sanitize(screenshot_box_payload(0, 5));
        assert_eq!(empty.screenshots.unwrap().index, 0);
    }

    #[test]
    fn the_screenshot_box_gets_all_of_its_texts() {
        let mut many = screenshot_box_payload(1, 0);
        many.labels = (0..120)
            .map(|index| (format!("key {index}"), "v".to_string()))
            .collect();
        assert_eq!(sanitize(many).labels.len(), LABEL_LIMIT);
        assert!(LABEL_LIMIT >= 64);
    }

    #[test]
    fn reads_the_screenshot_box_actions_the_way_the_box_writes_them() {
        let caption: ScreenshotBoxAction = serde_json::from_value(serde_json::json!({
            "kind": "caption",
            "path": "C:\\shot.jpg",
            "caption": "c".repeat(400)
        }))
        .unwrap();
        let ScreenshotBoxAction::Caption { caption, .. } =
            sanitize_screenshot_action(caption).unwrap()
        else {
            panic!("a caption stays a caption");
        };
        assert_eq!(caption.unwrap().chars().count(), CAPTION_LIMIT);
        let none: ScreenshotBoxAction = serde_json::from_value(serde_json::json!({
            "kind": "caption",
            "path": "C:\\shot.jpg",
            "caption": null
        }))
        .unwrap();
        assert!(matches!(
            none,
            ScreenshotBoxAction::Caption { caption: None, .. }
        ));
        let recycle: ScreenshotBoxAction = serde_json::from_value(serde_json::json!({
            "kind": "recycle",
            "path": "C:\\shot.jpg"
        }))
        .unwrap();
        assert_eq!(
            recycle,
            ScreenshotBoxAction::Recycle {
                path: "C:\\shot.jpg".into()
            }
        );
        let mark_up: ScreenshotBoxAction = serde_json::from_value(serde_json::json!({
            "kind": "markUp",
            "path": "C:\\shot.jpg",
            "png": "iVBORw0KGgo="
        }))
        .unwrap();
        assert_eq!(
            sanitize_screenshot_action(mark_up.clone()).unwrap(),
            mark_up
        );
    }

    #[test]
    fn refuses_marks_bigger_than_any_picture_needs() {
        let huge = ScreenshotBoxAction::MarkUp {
            path: "C:\\shot.jpg".into(),
            png: "A".repeat(MARKS_LIMIT + 1),
        };
        assert!(sanitize_screenshot_action(huge).is_err());
    }

    #[test]
    fn says_what_was_done_the_way_the_box_reads_it() {
        let update = ScreenshotBox {
            pictures: vec![],
            index: 0,
            done: Some(BoxDone {
                kind: BoxActionKind::MarkUp,
                path: "C:\\shot.jpg".into(),
                ok: true,
            }),
        };
        assert_eq!(
            serde_json::to_value(&update).unwrap(),
            serde_json::json!({
                "pictures": [],
                "index": 0,
                "done": { "kind": "markUp", "path": "C:\\shot.jpg", "ok": true }
            })
        );
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
