use process::{create_scanner, ProcessSnapshot};
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Wry,
};

mod ignored_processes;
mod process;
mod session;

const TRAY_STATUS_IDLE: &str = "No game active";
const TRAY_STATUS_PREFIX: &str = "Playing ";
const WEBSITE_URL: &str = "https://playcounter.app/";
const DISCORD_URL: &str = "https://discord.gg/t2nG3jaEEY";

struct TrayState {
    icon: Mutex<Option<TrayIcon<Wry>>>,
    status_item: Mutex<Option<MenuItem<Wry>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraySession {
    game_name: String,
    elapsed_seconds: u64,
}

#[tauri::command]
fn install_uuid() -> String {
    session::install_uuid()
}

#[tauri::command]
async fn scan_processes() -> Result<Vec<ProcessSnapshot>, String> {
    create_scanner()
        .scan()
        .await
        .map_err(|error| error.to_string())
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
fn open_user_ignored_processes_folder(app: tauri::AppHandle) -> Result<(), String> {
    let folder = ignored_processes::user_file_dir(&app)?;
    open_folder(&folder)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let url = match url.trim() {
        WEBSITE_URL | "https://playcounter.app" => WEBSITE_URL,
        DISCORD_URL => DISCORD_URL,
        _ => return Err("Unsupported external URL.".to_string()),
    };

    open_url(url)
}

#[tauri::command]
fn update_tray_now_playing(
    app: tauri::AppHandle,
    sessions: Vec<TraySession>,
) -> Result<(), String> {
    set_tray_status(&app, &format_tray_status(&sessions))
}

pub fn run() {
    tauri::Builder::default()
        .manage(TrayState {
            icon: Mutex::new(None),
            status_item: Mutex::new(None),
        })
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            install_uuid,
            ignored_processes,
            set_user_ignored_process,
            save_custom_cover,
            open_user_ignored_processes_folder,
            open_external_url,
            update_tray_now_playing,
            scan_processes
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            if launched_from_autostart() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(10)).await;
                watch_processes(handle).await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
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
            "tray_open" => show_main_window(app),
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
    *tray_state.icon.lock().unwrap() = Some(tray);
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

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
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("Opening links is not supported on this platform.".to_string());

    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

async fn watch_processes(app: tauri::AppHandle) {
    let scanner = create_scanner();
    let mut previous: Vec<ProcessSnapshot> = Vec::new();

    loop {
        match scanner.scan().await {
            Ok(current) => {
                if current != previous {
                    let _ = app.emit("processes-changed", &current);
                    previous = current;
                }
            }
            Err(error) => {
                let _ = app.emit("process-scan-error", error.to_string());
            }
        }

        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
