use process::{create_scanner, ProcessSnapshot};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Manager, Wry,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

mod automatic_backups;
mod controller;
mod emulator_launch;
mod hotkeys;
mod ignored_processes;
mod launch;
mod library;
mod notification_overlay;
mod process;
mod reset;
mod session;
mod shell_open;

const TRAY_STATUS_IDLE: &str = "No game active";
const TRAY_STATUS_PREFIX: &str = "Playing ";
/// Index of "Open PlayCounter" in the tray menu built by `setup_tray`.
const TRAY_UPDATE_POSITION: usize = 4;
const WEBSITE_URL: &str = "https://playcounter.app/";
const DISCORD_URL: &str = "https://discord.gg/t2nG3jaEEY";

struct TrayState {
    icon: Mutex<Option<TrayIcon<Wry>>>,
    menu: Mutex<Option<Menu<Wry>>>,
    status_item: Mutex<Option<MenuItem<Wry>>>,
    update_item: Mutex<Option<MenuItem<Wry>>>,
}

/// The main window is created hidden so Windows never shows a bare white frame
/// while the webview boots and the saved geometry is restored. It is revealed
/// only once the frontend confirms that its draggable loader or app has painted.
/// Autostart launches stay in the tray.
struct StartupWindow {
    autostart: bool,
    progress: Mutex<StartupProgress>,
    display_state_restored: AtomicBool,
}

#[derive(Default)]
struct StartupProgress {
    painted: bool,
    /// The tray, a hotkey or a second launch asked for the window before the
    /// frontend painted. The frameless window has no move or close controls
    /// until then, so it opens as soon as the loader is on screen.
    open_requested: bool,
    revealed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraySession {
    game_name: String,
    elapsed_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivacyContext {
    user_name: String,
    home_dir_name: String,
}

/// Called by the frontend once the first frame is on screen.
#[tauri::command]
fn main_window_ready(app: tauri::AppHandle) {
    let startup = app.state::<StartupWindow>();
    let (show, stays_in_tray) = {
        let mut progress = startup.progress.lock().unwrap();
        progress.painted = true;
        let waiting = !progress.revealed;
        let open = !startup.autostart || progress.open_requested;
        (waiting && open, waiting && !open)
    };
    if show {
        show_main_window(&app);
    } else if stays_in_tray {
        if let Some(window) = app.get_webview_window("main") {
            set_main_window_in_tray(&window, true);
        }
    }
}

/// Called by the frontend after it dropped its views in the tray. WebView2
/// trimmed its memory when the window was hidden, and removing the views
/// brought much of it back, so switch the memory target once more.
#[tauri::command]
fn main_window_parked(app: tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(true) {
        return;
    }
    set_webview_memory_low(&window, false);
    set_webview_memory_low(&window, true);
}

#[tauri::command]
fn install_uuid(app: tauri::AppHandle, existing: Option<String>) -> Result<String, String> {
    session::install_uuid(app, existing)
}

#[tauri::command]
fn adopt_install_uuid(app: tauri::AppHandle, value: String) -> Result<String, String> {
    session::adopt_install_uuid(app, value)
}

#[tauri::command]
async fn scan_processes() -> Result<Vec<ProcessSnapshot>, String> {
    create_scanner()
        .scan()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn privacy_context() -> PrivacyContext {
    let user_name = std::env::var("USERNAME").unwrap_or_default();
    let home_dir_name = std::env::var("USERPROFILE")
        .ok()
        .and_then(|path| {
            Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .unwrap_or_default();
    PrivacyContext {
        user_name,
        home_dir_name,
    }
}

#[tauri::command]
fn ignored_processes(app: tauri::AppHandle) -> Result<ignored_processes::IgnoredProcesses, String> {
    ignored_processes::load(&app)
}

#[tauri::command]
fn set_user_ignored_process(
    app: tauri::AppHandle,
    exe_name: String,
    ignored: bool,
) -> Result<ignored_processes::IgnoredProcesses, String> {
    ignored_processes::set_user_ignored(&app, &exe_name, ignored)
}

#[tauri::command]
fn save_custom_cover(
    app: tauri::AppHandle,
    game_id: i64,
    extension: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    const MAX_COVER_BYTES: usize = 8 * 1024 * 1024;

    if bytes.is_empty() {
        return Err("Cover image is empty.".to_string());
    }
    if bytes.len() > MAX_COVER_BYTES {
        return Err("Cover image must be 8 MB or smaller.".to_string());
    }

    let extension = normalize_cover_extension(&extension, &bytes)?;
    let cover_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("covers");
    fs::create_dir_all(&cover_dir).map_err(|error| error.to_string())?;

    let path = cover_dir.join(format!("{game_id}.{extension}"));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    path_to_string(path)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

    let path = PathBuf::from(path);
    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_IMPORT_BYTES {
        return Err("Backup file is too large to import.".to_string());
    }
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(PathBuf::from(path), contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn backup_local_data(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    let backup_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("backups");
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let path = backup_dir.join(format!("playcounter-backup-{stamp}.json"));
    fs::write(&path, contents).map_err(|error| error.to_string())?;
    path_to_string(path)
}

#[tauri::command]
fn open_user_ignored_processes_folder(app: tauri::AppHandle) -> Result<(), String> {
    let folder = ignored_processes::user_file_dir(&app)?;
    open_folder(&folder)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let url = match trimmed {
        WEBSITE_URL | "https://playcounter.app" => WEBSITE_URL,
        DISCORD_URL => DISCORD_URL,
        // The game details view links out to IGDB. Unlike the two fixed URLs
        // above this one is built at runtime, so it is validated rather than
        // compared.
        _ if is_allowed_igdb_url(trimmed) => trimmed,
        _ => return Err("Unsupported external URL.".to_string()),
    };

    open_url(url)
}

/// True only for an `https://www.igdb.com/...` URL safe to hand to the shell.
///
/// The prefix check settles the host on its own: a URL's authority ends at the
/// first `/` after the scheme, so anything matching this prefix cannot smuggle
/// in userinfo (`user@evil.test`) or a different host. What is left to reject
/// is whitespace and control characters, which have no place in a URL and
/// could otherwise be used to confuse the shell.
fn is_allowed_igdb_url(url: &str) -> bool {
    const IGDB_PREFIX: &str = "https://www.igdb.com/";

    url.starts_with(IGDB_PREFIX)
        && url.len() <= 2048
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

#[tauri::command]
fn open_microsoft_signin_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !url.starts_with("https://login.microsoftonline.com/") {
        return Err("Unsupported Microsoft sign-in URL.".to_string());
    }

    open_url(url)
}
#[tauri::command]
fn open_xbox_app() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return open_url("xbox://");
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("The Xbox app is only available on Windows.".to_string())
    }
}

#[tauri::command]
async fn get_exe_icon(exe_path: String) -> Result<String, String> {
    if !Path::new(&exe_path).is_file() {
        return Err("Executable not found.".to_string());
    }
    // Icon extraction goes through OS APIs (GDI on Windows); run it off the
    // async runtime so a slow disk cannot stall other commands.
    tauri::async_runtime::spawn_blocking(move || {
        let png = systemicons::get_icon(&exe_path, 32)
            .map_err(|error| format!("Icon extraction failed: {error:?}"))?;
        use base64::Engine as _;
        Ok(base64::engine::general_purpose::STANDARD.encode(png))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn update_tray_now_playing(
    app: tauri::AppHandle,
    sessions: Vec<TraySession>,
) -> Result<(), String> {
    set_tray_status(&app, &format_tray_status(&sessions))
}

/// Adds, renames or removes the tray entry that points at a pending update.
#[tauri::command]
fn set_tray_update(app: tauri::AppHandle, version: Option<String>) -> Result<(), String> {
    let tray_state = app.state::<TrayState>();
    let menu = tray_state.menu.lock().unwrap();
    let Some(menu) = menu.as_ref() else {
        return Ok(());
    };
    let mut update_item = tray_state.update_item.lock().unwrap();
    match (version, update_item.as_ref()) {
        (Some(version), Some(item)) => item
            .set_text(format_tray_update(&version))
            .map_err(|error| error.to_string()),
        (Some(version), None) => {
            let item = MenuItem::with_id(
                &app,
                "tray_update",
                format_tray_update(&version),
                true,
                None::<&str>,
            )
            .map_err(|error| error.to_string())?;
            // Above "Open PlayCounter".
            menu.insert(&item, TRAY_UPDATE_POSITION)
                .map_err(|error| error.to_string())?;
            *update_item = Some(item);
            Ok(())
        }
        (None, Some(item)) => {
            menu.remove(item).map_err(|error| error.to_string())?;
            *update_item = None;
            Ok(())
        }
        (None, None) => Ok(()),
    }
}

fn format_tray_update(version: &str) -> String {
    escape_menu_text(&format!("Update available ({version})"))
}

/// Autostart keeps the window hidden; a found update brings it forward once.
#[tauri::command]
fn show_main_window_for_update(app: tauri::AppHandle) {
    show_main_window(&app);
}

fn configure_macos_test_storage(config: &mut tauri::Config) {
    if config.identifier != "app.playcounter.desktop.test" {
        return;
    }

    // tauri-utils 2.9.2 emits a Vec for a configured dataStoreIdentifier, but
    // WindowConfig requires [u8; 16]. Set the same persistent test-store ID
    // after generate_context! and before Tauri creates any configured windows.
    for window in &mut config.app.windows {
        window.data_store_identifier = Some([
            93, 166, 17, 135, 225, 44, 72, 81, 170, 198, 202, 39, 76, 203, 110, 162,
        ]);
    }
}

pub fn run() {
    let mut context = tauri::generate_context!();
    if cfg!(target_os = "macos") {
        configure_macos_test_storage(context.config_mut());
    }

    tauri::Builder::default()
        .manage(TrayState {
            icon: Mutex::new(None),
            menu: Mutex::new(None),
            status_item: Mutex::new(None),
            update_item: Mutex::new(None),
        })
        .manage(controller::ControllerWatcher::default())
        .manage(emulator_launch::EmulatorLaunchGuard::default())
        .manage(notification_overlay::OverlayState::default())
        .manage(hotkeys::HotkeyState::default())
        .manage(library::battlenet_account::AccountState::default())
        .manage(library::epic_account::EpicAccountState::default())
        .manage(reset::ResetState::default())
        .manage(StartupWindow {
            autostart: launched_from_autostart(),
            progress: Mutex::new(StartupProgress::default()),
            display_state_restored: AtomicBool::new(false),
        })
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Restore geometry while hidden. Maximizing/fullscreen can
                // reveal a native window too, so defer those until first show.
                // Visibility and decorations always belong to the app.
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
                .with_filter(|label| {
                    !label.starts_with("battlenet-sign-in-")
                        && !label.starts_with("epic-sign-in-")
                        && !label.starts_with(notification_overlay::OVERLAY_LABEL_PREFIX)
                })
                .build(),
        )
        .plugin(
            tauri::plugin::Builder::<Wry>::new("startup-window")
                .on_event(|app, event| {
                    if matches!(event, tauri::RunEvent::Exit)
                        && app.state::<reset::ResetState>().0.load(Ordering::SeqCst)
                    {
                        let _ = reset::clear_window_state(app);
                        return;
                    }
                    if matches!(event, tauri::RunEvent::Exit)
                        && app
                            .state::<StartupWindow>()
                            .display_state_restored
                            .load(Ordering::SeqCst)
                    {
                        // Run after window-state's geometry save. Until first
                        // show, retain its cached maximized/fullscreen values:
                        // quitting from autostart must not replace them with
                        // the temporary hidden window's normal state.
                        let _ = app.save_window_state(
                            StateFlags::SIZE
                                | StateFlags::POSITION
                                | StateFlags::MAXIMIZED
                                | StateFlags::FULLSCREEN,
                        );
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            main_window_ready,
            main_window_parked,
            hotkeys::set_global_hotkey,
            install_uuid,
            adopt_install_uuid,
            ignored_processes,
            set_user_ignored_process,
            save_custom_cover,
            read_text_file,
            write_text_file,
            backup_local_data,
            reset::reset_local_data,
            automatic_backups::default_backup_directory,
            automatic_backups::write_automatic_backup,
            automatic_backups::open_backup_directory,
            open_user_ignored_processes_folder,
            open_external_url,
            open_microsoft_signin_url,
            open_xbox_app,
            update_tray_now_playing,
            set_tray_update,
            show_main_window_for_update,
            scan_processes,
            privacy_context,
            get_exe_icon,
            launch::launch_executable,
            launch::reveal_executable,
            launch::verify_launch_paths,
            library::library_detect_providers,
            library::library_list_accounts,
            library::library_scan,
            library::library_scan_xbox_local,
            library::battlenet_account::library_battlenet_account_games,
            library::battlenet_account::library_cancel_battlenet_account,
            library::epic_account::library_epic_account_games,
            library::epic_account::library_cancel_epic_account,
            library::library_inspect_executable,
            library::library_launch_app,
            library::library_verify_installs,
            library::library_installed_games,
            library::watch_folders::watch_folder_game_folders,
            library::watch_folders::watch_folder_scan,
            emulator_launch::launch_emulator_content,
            emulator_launch::verify_emulator_content_paths,
            controller::controller_watch_start,
            controller::controller_watch_stop,
            notification_overlay::notification_overlay_monitors,
            notification_overlay::notification_overlay_wait_for_game_window,
            notification_overlay::notification_overlay_show,
            notification_overlay::notification_overlay_hide,
            notification_overlay::notification_overlay_close,
            notification_overlay::notification_overlay_ready,
            notification_overlay::notification_overlay_finished,
            notification_overlay::notification_overlay_activate
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            // The loader (including its startup-error/retry state) and the app
            // call main_window_ready after painting. A timer must not bypass
            // that handshake: a slow WebView would expose an empty, immovable
            // frameless window before its drag region exists.
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != notification_overlay::MAIN_LABEL {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                if let Some(window) = window.app_handle().get_webview_window(window.label()) {
                    set_main_window_in_tray(&window, true);
                }
            }
        })
        .run(context)
        .expect("error while running PlayCounter");
}

fn launched_from_autostart() -> bool {
    std::env::args().any(|arg| arg == "--autostart")
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let title_item = MenuItem::with_id(app, "tray_title", "PlayCounter", false, None::<&str>)?;
    let status_item = MenuItem::with_id(app, "tray_status", TRAY_STATUS_IDLE, false, None::<&str>)?;
    let open_item = MenuItem::with_id(app, "tray_open", "Open PlayCounter", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "Quit PlayCounter", true, None::<&str>)?;
    let header_separator = PredefinedMenuItem::separator(app)?;
    let action_separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &title_item,
            &header_separator,
            &status_item,
            &action_separator,
            &open_item,
            &quit_item,
        ],
    )?;
    let tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip(TRAY_STATUS_IDLE)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_open" | "tray_update" => show_main_window(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    let tray_state = app.state::<TrayState>();
    *tray_state.status_item.lock().unwrap() = Some(status_item);
    *tray_state.menu.lock().unwrap() = Some(menu);
    *tray_state.icon.lock().unwrap() = Some(tray);
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    let startup = app.state::<StartupWindow>();
    {
        let mut progress = startup.progress.lock().unwrap();
        if !progress.painted {
            progress.open_requested = true;
            return;
        }
        progress.revealed = true;
    }
    if let Some(window) = app.get_webview_window("main") {
        if !startup.display_state_restored.swap(true, Ordering::SeqCst) {
            let _ = window.restore_state(StateFlags::MAXIMIZED | StateFlags::FULLSCREEN);
        }
        set_main_window_in_tray(&window, false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Tells the page whether the main window sits in the tray, so it can stop
/// rendering its views there, and sets WebView2's memory target to match.
fn set_main_window_in_tray(window: &tauri::WebviewWindow, in_tray: bool) {
    use tauri::Emitter;

    let _ = window.emit_to(
        window.label(),
        "playcounter:main-window-in-tray",
        in_tray,
    );
    set_webview_memory_low(window, in_tray);
}

/// While the window sits in the tray, ask WebView2 to shrink its processes.
/// Scripts keep running, so the tracker is unaffected. WebView2 never switches
/// back by itself: every reveal has to set it to normal again.
#[cfg(windows)]
fn set_webview_memory_low(window: &tauri::WebviewWindow, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;

    let level = if low {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    let _ = window.with_webview(move |platform| unsafe {
        // Best effort: older WebView2 runtimes lack the interface.
        if let Ok(webview) = platform
            .controller()
            .CoreWebView2()
            .and_then(|webview| webview.cast::<ICoreWebView2_19>())
        {
            let _ = webview.SetMemoryUsageTargetLevel(level);
        }
    });
}

#[cfg(not(windows))]
fn set_webview_memory_low(_window: &tauri::WebviewWindow, _low: bool) {}

fn set_tray_status(app: &tauri::AppHandle, status: &str) -> Result<(), String> {
    let tray_state = app.state::<TrayState>();

    if let Some(status_item) = tray_state.status_item.lock().unwrap().as_ref() {
        status_item
            .set_text(escape_menu_text(status))
            .map_err(|error| error.to_string())?;
    }

    if let Some(icon) = tray_state.icon.lock().unwrap().as_ref() {
        icon.set_tooltip(Some(status))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn format_tray_status(sessions: &[TraySession]) -> String {
    let sessions = sessions
        .iter()
        .filter(|session| !session.game_name.trim().is_empty())
        .collect::<Vec<_>>();

    match sessions.as_slice() {
        [] => TRAY_STATUS_IDLE.to_string(),
        [session] => truncate_tray_text(&format_session_status(session)),
        [first, ..] => truncate_tray_text(&format!(
            "{} (+{} more)",
            format_session_status(first),
            sessions.len() - 1
        )),
    }
}

fn format_session_status(session: &TraySession) -> String {
    format!(
        "{TRAY_STATUS_PREFIX}{} - {}",
        session.game_name.trim(),
        format_duration(session.elapsed_seconds)
    )
}

fn format_duration(seconds: u64) -> String {
    let total_minutes = seconds / 60;
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;

    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else if minutes > 0 {
        format!("{minutes}m")
    } else {
        "<1m".to_string()
    }
}

fn truncate_tray_text(text: &str) -> String {
    const MAX_CHARS: usize = 96;
    if text.chars().count() <= MAX_CHARS {
        return text.to_string();
    }

    let mut truncated = text.chars().take(MAX_CHARS - 3).collect::<String>();
    truncated.push_str("...");
    truncated
}

fn escape_menu_text(text: &str) -> String {
    text.replace('&', "&&")
}

fn normalize_cover_extension(extension: &str, bytes: &[u8]) -> Result<&'static str, String> {
    let requested = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();

    match requested.as_str() {
        "jpg" | "jpeg" if is_jpeg(bytes) => Ok("jpg"),
        "png" if is_png(bytes) => Ok("png"),
        "webp" if is_webp(bytes) => Ok("webp"),
        _ => Err("Cover image must be a PNG, JPG, or WebP file.".to_string()),
    }
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xFF, 0xD8, 0xFF])
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
}

fn path_to_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "Cover path is not valid UTF-8.".to_string())
}

fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("Opening folders is not supported on this platform.".to_string());

    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

fn open_url(url: &str) -> Result<(), String> {
    shell_open::open_url(url)
}

#[cfg(test)]
mod tests {
    use super::is_allowed_igdb_url;

    #[test]
    fn accepts_igdb_game_and_search_urls() {
        assert!(is_allowed_igdb_url(
            "https://www.igdb.com/games/the-witcher-3-wild-hunt"
        ));
        assert!(is_allowed_igdb_url(
            "https://www.igdb.com/search?type=1&q=Half-Life%202"
        ));
    }

    #[test]
    fn rejects_other_hosts_and_schemes() {
        for url in [
            "https://igdb.com/games/doom",
            "http://www.igdb.com/games/doom",
            "https://www.igdb.com.evil.test/games/doom",
            "https://evil.test/https://www.igdb.com/",
            "file:///C:/Windows/System32/cmd.exe",
            "javascript:alert(1)",
            "",
        ] {
            assert!(!is_allowed_igdb_url(url), "should reject {url}");
        }
    }

    #[test]
    fn rejects_whitespace_and_control_characters() {
        assert!(!is_allowed_igdb_url("https://www.igdb.com/games/a b"));
        assert!(!is_allowed_igdb_url("https://www.igdb.com/games/a\nb"));
        assert!(!is_allowed_igdb_url("https://www.igdb.com/games/a\0b"));
    }

    #[test]
    fn rejects_an_absurdly_long_url() {
        let long = format!("https://www.igdb.com/search?q={}", "a".repeat(4096));
        assert!(!is_allowed_igdb_url(&long));
    }
}
