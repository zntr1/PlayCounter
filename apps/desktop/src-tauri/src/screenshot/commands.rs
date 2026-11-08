//! The screenshot key and what the main window asks for: take, list, preview,
//! open, show in folder, delete. Pictures live in Pictures\PlayCounter, one
//! folder per game, and that folder is the whole list: a picture deleted or
//! added in Explorer is gone or there the next time PlayCounter looks.

use super::{
    caption::{clean_caption, read_captions, write_caption},
    capture_window,
    files::{
        clean_file_name, is_picture, picture_inside, preview_name, screenshot_stem, unique_path,
        LocalTime,
    },
    fill_rounded_corners, looks_black, save_jpeg, save_preview, save_preview_from_file,
    sound::{play, Sound},
    start_capture, CaptureMode, PendingCapture, CAPTURE_TIMEOUT, MINIMIZED,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::Manager;

/// The folder inside the user's Pictures folder.
const FOLDER: &str = "PlayCounter";
/// Small copies for lists, in the app's data folder. Rebuilt when missing.
const PREVIEWS: &str = "screenshot-previews";
const PREVIEW_WIDTH: u32 = 480;
const PREVIEW_QUALITY: f32 = 0.8;
const QUALITY: f32 = 0.9;
/// More than this and Pictures\PlayCounter holds more than screenshots.
const MAX_LISTED: usize = 20_000;
const MAX_CANDIDATES: usize = 16;
/// One picture at a time: two presses within a second would otherwise both
/// find "… 19-14-03.jpg" free and write the same file.
static TAKING: Mutex<()> = Mutex::new(());
/// The captions PlayCounter last read, by preview name (the picture's path,
/// size and time), in the previews folder. Reading one from its picture
/// takes about 4 ms, too slow for a long list at every start.
const CAPTIONS: &str = "captions.json";
static CAPTIONS_FILE: Mutex<()> = Mutex::new(());

type CaptionCache = HashMap<String, Option<String>>;

#[derive(Default)]
pub struct ScreenshotState {
    /// The window in front when the key was pressed, as a raw HWND.
    foreground: Mutex<Option<isize>>,
    /// The picture taken the moment the key was pressed, while it waits for
    /// the main window to name the game.
    early: Mutex<Option<Early>>,
}

struct Early {
    pid: u32,
    time: LocalTime,
    capture: PendingCapture,
}

/// The screenshot key, called the moment it is pressed. The picture is taken
/// right away, so what you see when you press is what you get. Which session
/// it belongs to comes after.
pub fn key_pressed(app: &tauri::AppHandle) {
    let state = app.state::<ScreenshotState>();
    let foreground = window::foreground();
    if let Ok(mut slot) = state.foreground.lock() {
        *slot = foreground;
    }
    let early = foreground
        .map(|hwnd| (hwnd, window::process_id(hwnd)))
        // PlayCounter's own window is never the game.
        .filter(|&(_, pid)| pid != 0 && pid != std::process::id())
        .map(|(hwnd, pid)| Early {
            pid,
            time: window::local_time(),
            capture: start_capture(hwnd, CaptureMode::Auto),
        });
    *state
        .early
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = early;
}

/// A running game the key may take a picture of. The main window sends
/// them started last first.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    session_id: i64,
    pids: Vec<u32>,
    game_name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotFile {
    pub path: String,
    /// The game folder's name. Empty for pictures right in Pictures\PlayCounter.
    pub folder: String,
    pub name: String,
    pub bytes: u64,
    pub modified_ms: i64,
    pub preview_path: Option<String>,
    /// Kept in the picture file itself (caption.rs).
    pub caption: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TakeResult {
    Saved {
        session_id: i64,
        file: ScreenshotFile,
    },
    /// Windows handed back a black picture, usually exclusive fullscreen.
    Black {
        session_id: i64,
    },
    Minimized {
        session_id: i64,
    },
    /// None of the games has a window.
    NoWindow,
}

fn main_only(window: &tauri::Window) -> Result<(), String> {
    if window.label() == crate::notification_overlay::MAIN_LABEL {
        Ok(())
    } else {
        Err("unauthorized window".into())
    }
}

fn text(error: impl ToString) -> String {
    error.to_string()
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .picture_dir()
        .map(|pictures| pictures.join(FOLDER))
        .map_err(text)
}

fn previews(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|data| data.join(PREVIEWS))
        .map_err(text)
}

/// A path as text. Resolved Windows paths start with \\?\, which neither the
/// asset protocol nor the shell takes.
fn path_text(path: &Path) -> String {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => text.into_owned(),
    }
}

fn modified_ms(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_millis() as i64)
        .unwrap_or(0)
}

/// Where the preview of `path` goes. `root` and `path` are both resolved or
/// both as built from the Pictures folder, so the name comes out the same.
fn preview_path_for(root: &Path, previews: &Path, path: &Path, metadata: &fs::Metadata) -> PathBuf {
    let relative = path
        .strip_prefix(root)
        .map(path_text)
        .unwrap_or_else(|_| path_text(path));
    previews.join(preview_name(
        &relative,
        metadata.len(),
        modified_ms(metadata),
    ))
}

fn describe(
    root: &Path,
    previews: &Path,
    path: &Path,
    folder: &str,
    metadata: &fs::Metadata,
    has_preview: impl Fn(&Path) -> bool,
) -> ScreenshotFile {
    let preview = preview_path_for(root, previews, path, metadata);
    ScreenshotFile {
        path: path_text(path),
        folder: folder.to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        bytes: metadata.len(),
        modified_ms: modified_ms(metadata),
        preview_path: has_preview(&preview).then(|| path_text(&preview)),
        caption: None,
    }
}

/// The name the picture's preview and cached caption go by.
fn picture_key(root: &Path, previews: &Path, path: &Path, metadata: &fs::Metadata) -> String {
    preview_path_for(root, previews, path, metadata)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn load_captions(previews: &Path) -> CaptionCache {
    fs::read(previews.join(CAPTIONS))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Best effort: without the file, captions are just read again.
fn save_captions(previews: &Path, cache: &CaptionCache) {
    let Ok(json) = serde_json::to_vec(cache) else {
        return;
    };
    let temp = previews.join(format!("{CAPTIONS}.tmp"));
    if fs::create_dir_all(previews).is_ok() && fs::write(&temp, json).is_ok() {
        let _ = fs::rename(&temp, previews.join(CAPTIONS));
    }
}

/// The captions for these pictures: from the cache where it knows them, the
/// rest read by `read`, which gets their positions. Also the cache to keep:
/// just these pictures, so deleted and changed ones drop out.
fn captions_for(
    keys: &[String],
    cache: &CaptionCache,
    read: impl FnOnce(&[usize]) -> Vec<Option<String>>,
) -> (Vec<Option<String>>, CaptionCache) {
    let missing: Vec<usize> = (0..keys.len())
        .filter(|&index| !cache.contains_key(&keys[index]))
        .collect();
    let mut read_now = if missing.is_empty() {
        Vec::new()
    } else {
        read(&missing)
    }
    .into_iter();
    let mut next = CaptionCache::with_capacity(keys.len());
    let captions = keys
        .iter()
        .map(|key| {
            let caption = match cache.get(key) {
                Some(caption) => caption.clone(),
                None => read_now.next().flatten(),
            };
            next.insert(key.clone(), caption.clone());
            caption
        })
        .collect();
    (captions, next)
}

#[tauri::command]
pub async fn screenshot_take(
    app: tauri::AppHandle,
    window: tauri::Window,
    candidates: Vec<Candidate>,
) -> Result<TakeResult, String> {
    main_only(&window)?;
    let state = app.state::<ScreenshotState>();
    let foreground = state.foreground.lock().map_err(text)?.take();
    let early = state.early.lock().map_err(text)?.take();
    let (root, previews) = (root(&app)?, previews(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let result = take(foreground, early, candidates, &root, &previews);
        if result.is_err() {
            play(Sound::Failed);
        }
        result
    })
    .await
    .map_err(text)?
}

/// A sound says how it went, even over a fullscreen game where no popup
/// shows.
fn failed(result: TakeResult) -> Result<TakeResult, String> {
    play(Sound::Failed);
    Ok(result)
}

fn take(
    foreground: Option<isize>,
    early: Option<Early>,
    mut candidates: Vec<Candidate>,
    root: &Path,
    previews: &Path,
) -> Result<TakeResult, String> {
    let _one_at_a_time = TAKING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    candidates.truncate(MAX_CANDIDATES);
    // The picture from the key press counts when it shows one of the games.
    let early = early.and_then(|early| {
        candidates
            .iter()
            .position(|candidate| candidate.pids.contains(&early.pid))
            .map(|index| (index, early))
    });
    let (index, captured, time) = match early {
        Some((index, early)) => (index, early.capture.wait(CAPTURE_TIMEOUT), early.time),
        None => {
            let Some((index, hwnd)) = window::pick(foreground, &candidates) else {
                return failed(TakeResult::NoWindow);
            };
            (index, capture_window(hwnd), window::local_time())
        }
    };
    let candidate = &candidates[index];
    let session_id = candidate.session_id;
    let mut picture = match captured {
        Ok((picture, _)) => picture,
        Err(error) if error == MINIMIZED => return failed(TakeResult::Minimized { session_id }),
        Err(error) => return Err(error),
    };
    let stride = picture.width as usize * 4;
    if looks_black(&picture.bgra, picture.width, picture.height, stride) {
        return failed(TakeResult::Black { session_id });
    }
    // The picture is good: the click sounds now, before the file is written.
    play(Sound::Saved);
    fill_rounded_corners(&mut picture.bgra, picture.width, picture.height);

    let folder_name = clean_file_name(&candidate.game_name);
    let folder = root.join(&folder_name);
    fs::create_dir_all(&folder).map_err(text)?;
    let stem = screenshot_stem(&candidate.game_name, &time);
    let path = unique_path(&folder, &stem, "jpg");
    save_jpeg(&picture, &path, QUALITY)?;
    let metadata = fs::metadata(&path).map_err(text)?;
    // The picture is saved either way; a missing preview is made again later.
    let preview = preview_path_for(root, previews, &path, &metadata);
    let has_preview = fs::create_dir_all(previews).is_ok()
        && save_preview(&picture, &preview, PREVIEW_WIDTH, PREVIEW_QUALITY).is_ok();
    let file = describe(root, previews, &path, &folder_name, &metadata, |_| {
        has_preview
    });
    Ok(TakeResult::Saved { session_id, file })
}

/// Every picture in Pictures\PlayCounter and its game folders.
#[tauri::command]
pub async fn screenshot_list(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<Vec<ScreenshotFile>, String> {
    main_only(&window)?;
    let (root, previews) = (root(&app)?, previews(&app)?);
    tauri::async_runtime::spawn_blocking(move || list(&root, &previews))
        .await
        .map_err(text)
}

fn list(root: &Path, previews: &Path) -> Vec<ScreenshotFile> {
    let existing: HashSet<PathBuf> = fs::read_dir(previews)
        .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    let mut found = Vec::new();
    add_pictures(root, previews, root, "", &existing, &mut found);
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                let name = entry.file_name().to_string_lossy().into_owned();
                add_pictures(root, previews, &entry.path(), &name, &existing, &mut found);
            }
        }
    }
    let keys: Vec<String> = found.iter().map(|(_, _, key)| key.clone()).collect();
    let _one_at_a_time = CAPTIONS_FILE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let cache = load_captions(previews);
    let (captions, next) = captions_for(&keys, &cache, |missing| {
        let paths: Vec<PathBuf> = missing.iter().map(|&at| found[at].1.clone()).collect();
        read_captions(&paths)
    });
    if next != cache {
        save_captions(previews, &next);
    }
    found
        .into_iter()
        .zip(captions)
        .map(|((mut file, _, _), caption)| {
            file.caption = caption;
            file
        })
        .collect()
}

/// The pictures in `folder`, each with its path and its cache key.
fn add_pictures(
    root: &Path,
    previews: &Path,
    folder: &Path,
    folder_name: &str,
    existing: &HashSet<PathBuf>,
    found: &mut Vec<(ScreenshotFile, PathBuf, String)>,
) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        if found.len() >= MAX_LISTED {
            return;
        }
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_file() && is_picture(&path) {
            let file = describe(root, previews, &path, folder_name, &metadata, |preview| {
                existing.contains(preview)
            });
            let key = picture_key(root, previews, &path, &metadata);
            found.push((file, path, key));
        }
    }
}

fn own_picture(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    picture_inside(&root(app)?, Path::new(path))
        .ok_or_else(|| "Not a PlayCounter picture.".to_string())
}

/// The preview of one picture, made now if it has none.
#[tauri::command]
pub async fn screenshot_preview(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<String, String> {
    main_only(&window)?;
    let picture = own_picture(&app, &path)?;
    let (root, previews) = (root(&app)?, previews(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let root = fs::canonicalize(&root).map_err(text)?;
        let metadata = fs::metadata(&picture).map_err(text)?;
        let preview = preview_path_for(&root, &previews, &picture, &metadata);
        if !preview.is_file() {
            fs::create_dir_all(&previews).map_err(text)?;
            save_preview_from_file(&picture, &preview, PREVIEW_WIDTH, PREVIEW_QUALITY)?;
        }
        Ok(path_text(&preview))
    })
    .await
    .map_err(text)?
}

/// Saves a caption into the picture, or removes it with None. Answers with
/// the picture as the list shows it now.
#[tauri::command]
pub async fn screenshot_caption(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
    caption: Option<String>,
) -> Result<ScreenshotFile, String> {
    main_only(&window)?;
    let picture = own_picture(&app, &path)?;
    let (root, previews) = (root(&app)?, previews(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        set_caption(&root, &previews, &picture, caption.as_deref())
    })
    .await
    .map_err(text)?
}

fn set_caption(
    root: &Path,
    previews: &Path,
    picture: &Path,
    caption: Option<&str>,
) -> Result<ScreenshotFile, String> {
    let root = fs::canonicalize(root).map_err(text)?;
    let caption = caption.and_then(clean_caption);
    let before = fs::metadata(picture).map_err(text)?;
    let old_preview = preview_path_for(&root, previews, picture, &before);
    let old_key = picture_key(&root, previews, picture, &before);
    write_caption(picture, caption.as_deref())?;
    // Writing the caption changes the file's size and time, not its picture:
    // the preview still fits under its new name.
    let after = fs::metadata(picture).map_err(text)?;
    let new_preview = preview_path_for(&root, previews, picture, &after);
    if new_preview != old_preview && old_preview.is_file() {
        let _ = fs::rename(&old_preview, &new_preview);
    }
    {
        let _one_at_a_time = CAPTIONS_FILE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut cache = load_captions(previews);
        cache.remove(&old_key);
        cache.insert(
            picture_key(&root, previews, picture, &after),
            caption.clone(),
        );
        save_captions(previews, &cache);
    }
    let folder = picture
        .parent()
        .and_then(|parent| parent.strip_prefix(&root).ok())
        .map(path_text)
        .unwrap_or_default();
    let mut file = describe(&root, previews, picture, &folder, &after, |preview| {
        preview.is_file()
    });
    file.caption = caption;
    Ok(file)
}

/// Opens the picture in the app Windows uses for pictures.
#[tauri::command]
pub async fn screenshot_open(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    main_only(&window)?;
    let picture = own_picture(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || crate::shell_open::open_url(&path_text(&picture)))
        .await
        .map_err(text)?
}

/// Opens Explorer with the picture selected.
#[tauri::command]
pub async fn screenshot_reveal(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    main_only(&window)?;
    let picture = own_picture(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || window::reveal(&picture))
        .await
        .map_err(text)?
}

/// Moves the picture to the Recycle Bin, so it can come back from there.
#[tauri::command]
pub async fn screenshot_delete(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    main_only(&window)?;
    let picture = own_picture(&app, &path)?;
    let (root, previews) = (root(&app)?, previews(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        if let (Ok(root), Ok(metadata)) = (fs::canonicalize(&root), fs::metadata(&picture)) {
            let _ = fs::remove_file(preview_path_for(&root, &previews, &picture, &metadata));
        }
        window::recycle(&picture)
    })
    .await
    .map_err(text)?
}

/// The folder the pictures go to, for Settings.
#[tauri::command]
pub fn screenshot_folder(app: tauri::AppHandle, window: tauri::Window) -> Result<String, String> {
    main_only(&window)?;
    root(&app).map(|root| path_text(&root))
}

#[tauri::command]
pub async fn screenshot_open_folder(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    main_only(&window)?;
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&root).map_err(text)?;
        crate::open_folder(&root)
    })
    .await
    .map_err(text)?
}

#[cfg(windows)]
mod window {
    use super::{path_text, Candidate, LocalTime};
    use std::path::Path;
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{BOOL, HWND},
            System::SystemInformation::GetLocalTime,
            UI::{
                Shell::{
                    SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
                    FO_DELETE, SHFILEOPSTRUCTW,
                },
                WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
            },
        },
    };

    fn hwnd(raw: isize) -> HWND {
        HWND(raw as *mut _)
    }

    pub fn foreground() -> Option<isize> {
        let window = unsafe { GetForegroundWindow() };
        (!window.is_invalid()).then_some(window.0 as isize)
    }

    pub fn process_id(window: isize) -> u32 {
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd(window), Some(&mut pid)) };
        pid
    }

    /// The game in front when it's one of them. Otherwise the biggest window
    /// of the first game (the one started last) that has a window.
    pub fn pick(foreground: Option<isize>, candidates: &[Candidate]) -> Option<(usize, isize)> {
        if let Some(window) = foreground {
            let pid = process_id(window);
            if let Some(index) = candidates
                .iter()
                .position(|candidate| pid != 0 && candidate.pids.contains(&pid))
            {
                return Some((index, window));
            }
        }
        candidates
            .iter()
            .enumerate()
            .find_map(|(index, candidate)| {
                crate::notification_overlay::largest_process_window(&candidate.pids)
                    .map(|window| (index, window))
            })
    }

    pub fn local_time() -> LocalTime {
        let now = unsafe { GetLocalTime() };
        LocalTime {
            year: now.wYear,
            month: now.wMonth,
            day: now.wDay,
            hour: now.wHour,
            minute: now.wMinute,
            second: now.wSecond,
        }
    }

    pub fn reveal(path: &Path) -> Result<(), String> {
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(path_text(path))
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn recycle(path: &Path) -> Result<(), String> {
        // The shell wants a list of paths, so the text ends with two nulls.
        let mut from: Vec<u16> = path_text(path).encode_utf16().collect();
        from.extend([0, 0]);
        let mut operation = SHFILEOPSTRUCTW {
            hwnd: HWND::default(),
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            pTo: PCWSTR::null(),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT).0 as u16,
            fAnyOperationsAborted: BOOL(0),
            hNameMappings: std::ptr::null_mut(),
            lpszProgressTitle: PCWSTR::null(),
        };
        let result = unsafe { SHFileOperationW(&mut operation) };
        if result == 0 && !operation.fAnyOperationsAborted.as_bool() {
            Ok(())
        } else {
            Err(format!(
                "The Recycle Bin did not take the picture ({result})."
            ))
        }
    }
}

#[cfg(not(windows))]
mod window {
    use super::{Candidate, LocalTime};
    use std::path::Path;

    const UNSUPPORTED: &str = "Screenshots are not supported on this platform.";

    pub fn foreground() -> Option<isize> {
        None
    }

    pub fn process_id(_window: isize) -> u32 {
        0
    }

    pub fn pick(_foreground: Option<isize>, _candidates: &[Candidate]) -> Option<(usize, isize)> {
        None
    }

    pub fn local_time() -> LocalTime {
        LocalTime {
            year: 1970,
            month: 1,
            day: 1,
            hour: 0,
            minute: 0,
            second: 0,
        }
    }

    pub fn reveal(_path: &Path) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    pub fn recycle(_path: &Path) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn reads_only_the_pictures_the_cache_doesnt_know() {
        let cache = CaptionCache::from([
            ("a".to_string(), Some("Boss arena".to_string())),
            ("b".to_string(), None),
        ]);
        let mut asked = Vec::new();
        let (captions, _) = captions_for(&keys(&["a", "b", "c", "d"]), &cache, |missing| {
            asked = missing.to_vec();
            vec![Some("New one".into()), None]
        });
        assert_eq!(asked, vec![2, 3]);
        assert_eq!(
            captions,
            vec![
                Some("Boss arena".into()),
                None,
                Some("New one".into()),
                None
            ]
        );
    }

    #[test]
    fn a_picture_without_a_caption_is_not_read_again() {
        let cache = CaptionCache::from([("a".to_string(), None)]);
        let (captions, next) = captions_for(&keys(&["a"]), &cache, |_| {
            panic!("the cache knew this picture")
        });
        assert_eq!(captions, vec![None]);
        assert_eq!(next, cache);
    }

    /// What the viewer and the caption box ask for: the picture's resolved
    /// path (\\?\C:\…), as `own_picture` hands it on.
    #[cfg(windows)]
    #[test]
    fn saves_a_caption_the_way_the_app_asks_for_it() {
        let base = std::env::temp_dir().join(format!(
            "playcounter-caption-command-{}",
            uuid::Uuid::new_v4()
        ));
        let (root, previews) = (base.join("PlayCounter"), base.join("previews"));
        let path = root
            .join("Elden Ring")
            .join("Elden Ring 2026-11-08 21-44-07.jpg");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let picture = crate::screenshot::Picture {
            width: 64,
            height: 36,
            bgra: vec![90; 64 * 36 * 4],
        };
        save_jpeg(&picture, &path, QUALITY).unwrap();
        assert_eq!(list(&root, &previews)[0].caption, None);
        let old_preview = preview_path_for(&root, &previews, &path, &fs::metadata(&path).unwrap());
        fs::create_dir_all(&previews).unwrap();
        fs::write(&old_preview, b"preview").unwrap();

        let resolved = fs::canonicalize(&path).unwrap();
        let file = set_caption(&root, &previews, &resolved, Some("  Boss arena  ")).unwrap();
        assert_eq!(file.caption.as_deref(), Some("Boss arena"));
        assert_eq!(file.folder, "Elden Ring");
        assert!(!file.path.starts_with(r"\\?\"));
        // The preview moved to the picture's new name instead of being made again.
        assert!(!old_preview.exists());
        assert!(Path::new(file.preview_path.as_deref().unwrap()).is_file());
        // The next list knows the caption without reading the picture again.
        assert_eq!(
            list(&root, &previews)[0].caption.as_deref(),
            Some("Boss arena")
        );

        // An empty caption removes it.
        let file = set_caption(&root, &previews, &resolved, Some("   ")).unwrap();
        assert_eq!(file.caption, None);
        assert_eq!(list(&root, &previews)[0].caption, None);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn forgets_pictures_that_are_gone_or_changed() {
        let cache = CaptionCache::from([
            ("kept".to_string(), Some("Still here".to_string())),
            ("deleted".to_string(), Some("Gone".to_string())),
        ]);
        let (_, next) = captions_for(&keys(&["kept", "added"]), &cache, |_| vec![None]);
        assert_eq!(
            next,
            CaptionCache::from([
                ("kept".to_string(), Some("Still here".to_string())),
                ("added".to_string(), None),
            ])
        );
    }
}
