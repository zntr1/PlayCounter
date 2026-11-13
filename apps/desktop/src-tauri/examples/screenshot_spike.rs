//! Spike for docs/memory-book-plan.md (not part of the app). Press
//! Ctrl+Shift+F9 in a game: this saves what Windows Graphics Capture sees of
//! the window in front, and writes one log line per picture.
//!
//!   cargo run --example screenshot_spike
//!   cargo run --example screenshot_spike -- --gamebar     after a black picture, also press Game Bar's shortcut (Win+Alt+PrtScn)
//!   cargo run --example screenshot_spike -- --self-test   capture a test window of a known color and check the result
//!   --out <folder>   where pictures and spike-log.txt go (default: Pictures\PlayCounter spike)

#[cfg(not(windows))]
fn main() {
    eprintln!("The screenshot spike runs on Windows only.");
}

#[cfg(windows)]
fn main() {
    std::process::exit(spike::run());
}

#[cfg(windows)]
mod spike {
    use playcounter_lib::screenshot::{
        black_share, capture_window, capture_window_as, monitor_is_hdr, request_borderless_capture,
        save_jpeg,
        sound::{play, Sound},
        CaptureInfo, CaptureMode, Picture, BLACK_SHARE_LIMIT,
    };
    use std::{
        io::Write,
        path::{Path, PathBuf},
        time::{Duration, Instant},
    };
    use windows::{
        core::{w, PWSTR},
        Win32::{
            Foundation::{CloseHandle, COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM},
            Graphics::Gdi::CreateSolidBrush,
            System::{
                Com::CoTaskMemFree,
                LibraryLoader::GetModuleHandleW,
                SystemInformation::GetLocalTime,
                Threading::{
                    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                    PROCESS_QUERY_LIMITED_INFORMATION,
                },
            },
            UI::{
                HiDpi::{
                    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
                },
                Input::KeyboardAndMouse::{
                    GetAsyncKeyState, RegisterHotKey, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD,
                    KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, MOD_CONTROL, MOD_NOREPEAT,
                    MOD_SHIFT, VIRTUAL_KEY, VK_CONTROL, VK_F9, VK_LWIN, VK_MENU, VK_SHIFT,
                    VK_SNAPSHOT,
                },
                Shell::{FOLDERID_Pictures, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
                WindowsAndMessaging::{
                    AdjustWindowRect, CreateWindowExW, DefWindowProcW, DestroyWindow,
                    DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowTextW,
                    GetWindowThreadProcessId, PeekMessageW, RegisterClassW, TranslateMessage, MSG,
                    PM_REMOVE, WINDOW_EX_STYLE, WM_HOTKEY, WNDCLASSW, WS_OVERLAPPEDWINDOW,
                    WS_VISIBLE,
                },
            },
        },
    };

    const HOTKEY_ID: i32 = 1;
    const JPEG_QUALITY: f32 = 0.9;

    pub fn run() -> i32 {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let self_test = args.iter().any(|arg| arg == "--self-test");
        let gamebar = args.iter().any(|arg| arg == "--gamebar");
        let compare = args.iter().any(|arg| arg == "--compare-hdr");
        let out = args
            .iter()
            .position(|arg| arg == "--out")
            .and_then(|at| args.get(at + 1))
            .map(PathBuf::from)
            .unwrap_or_else(|| pictures_folder().join("PlayCounter spike"));

        // Physical pixels everywhere, like the app (Tauri is per-monitor aware).
        let _ =
            unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        if let Err(error) = std::fs::create_dir_all(&out) {
            eprintln!("Can't create {}: {error}", out.display());
            return 1;
        }
        println!("PlayCounter screenshot spike");
        println!("Pictures and spike-log.txt go to: {}", out.display());
        let border = request_borderless_capture();
        println!("Capture without the yellow border: {border}");

        if self_test {
            return match run_self_test(&out) {
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("SELF-TEST FAILED: {error}");
                    1
                }
            };
        }

        if let Err(error) = unsafe {
            RegisterHotKey(
                None,
                HOTKEY_ID,
                MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
                VK_F9.0 as u32,
            )
        } {
            eprintln!("Ctrl+Shift+F9 is taken by another app: {}", error.message());
            return 1;
        }
        log_line(
            &out,
            &format!(
                "--- start, borderless capture: {border}, gamebar fallback: {gamebar}, compare HDR: {compare}"
            ),
        );
        println!("Press Ctrl+Shift+F9 in a game. Close this window or press Ctrl+C to stop.");
        let mut message = MSG::default();
        while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
            if message.message == WM_HOTKEY && message.wParam.0 == HOTKEY_ID as usize {
                take_screenshot(&out, gamebar, compare);
            }
        }
        0
    }

    fn take_screenshot(out: &Path, gamebar: bool, compare: bool) {
        let hwnd = unsafe { GetForegroundWindow() };
        let stamp = local_time(" ", "-");
        // First the picture as the app takes it; with --compare-hdr also
        // Windows' own 8-bit picture, right after.
        save_capture(
            out,
            hwnd,
            CaptureMode::Auto,
            &stamp,
            if compare { " playcounter" } else { "" },
            gamebar,
        );
        if compare {
            save_capture(out, hwnd, CaptureMode::Sdr, &stamp, " windows", false);
        }
    }

    fn save_capture(
        out: &Path,
        hwnd: HWND,
        mode: CaptureMode,
        stamp: &str,
        label: &str,
        gamebar: bool,
    ) {
        let started = Instant::now();
        let title = window_title(hwnd);
        let exe = window_exe(hwnd);
        let hdr = match monitor_is_hdr(hwnd.0 as isize) {
            Some(true) => "HDR on",
            Some(false) => "HDR off",
            None => "HDR unknown",
        };
        let head = format!("{}  {exe}  \"{title}\"  {hdr}", local_time(" ", ":"));
        let (picture, info) = match capture_window_as(hwnd.0 as isize, mode) {
            Ok(captured) => captured,
            Err(error) => {
                if mode == CaptureMode::Auto {
                    play(Sound::Failed);
                }
                log_line(out, &format!("{head}  FAILED: {error}"));
                return;
            }
        };
        let share = black_share(
            &picture.bgra,
            picture.width,
            picture.height,
            picture.width as usize * 4,
        );
        let black = share >= BLACK_SHARE_LIMIT;
        // The same sounds as in the app.
        if mode == CaptureMode::Auto {
            play(if black { Sound::Failed } else { Sound::Saved });
        }
        let stem = clean_stem(exe.trim_end_matches(".exe"));
        let path = unique_path(
            out,
            &format!("{stem} {stamp}{label}"),
            if black { " BLACK" } else { "" },
        );
        let encode_started = Instant::now();
        let saved = save_jpeg(&picture, &path, JPEG_QUALITY);
        let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
        let total_ms = started.elapsed().as_secs_f64() * 1000.0;
        let file = match saved {
            Ok(bytes) => format!("{:.2} MB  {}", bytes as f64 / 1_048_576.0, file_name(&path)),
            Err(error) => format!("JPEG FAILED: {error}"),
        };
        log_line(
            out,
            &format!(
                "{head}  {}  black {:.1}%{}  {}  {file}",
                sizes(&picture, &info),
                share * 100.0,
                if black { " -> BLACK" } else { "" },
                timings(&info, encode_ms, total_ms),
            ),
        );
        if black && gamebar {
            press_game_bar_shortcut();
            log_line(
                out,
                "  sent Win+Alt+PrtScn (check Videos\\Captures for a new file)",
            );
        }
    }

    fn sizes(picture: &Picture, info: &CaptureInfo) -> String {
        let hdr = match info.sdr_white_nits {
            Some(white) if info.hdr => format!("  HDR brought down, white = {white:.0} nits"),
            _ => String::new(),
        };
        format!(
            "{}x{} (window {}x{}){hdr}{}{}",
            picture.width,
            picture.height,
            info.frame_width,
            info.frame_height,
            if info.cursor_hidden {
                ""
            } else {
                "  cursor NOT hidden"
            },
            if info.border_off_accepted {
                ""
            } else {
                "  border-off NOT accepted"
            },
        )
    }

    fn timings(info: &CaptureInfo, encode_ms: f64, total_ms: f64) -> String {
        format!(
            "device {:.0} ms, window {:.0} ms, first frame {:.0} ms, copy {:.0} ms, jpeg {:.0} ms, total {:.0} ms",
            info.device_ms, info.item_ms, info.first_frame_ms, info.copy_ms, encode_ms, total_ms
        )
    }

    /// Game Bar's screenshot shortcut, pressed for the player. Waits until
    /// Ctrl, Shift and F9 are up, or Windows would see Ctrl+Shift+Win+Alt.
    fn press_game_bar_shortcut() {
        let deadline = Instant::now() + Duration::from_millis(1500);
        let held = |key: VIRTUAL_KEY| unsafe { GetAsyncKeyState(key.0 as i32) } < 0;
        while Instant::now() < deadline && (held(VK_CONTROL) || held(VK_SHIFT) || held(VK_F9)) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [
            key(VK_LWIN, false),
            key(VK_MENU, false),
            key(VK_SNAPSHOT, false),
            key(VK_SNAPSHOT, true),
            key(VK_MENU, true),
            key(VK_LWIN, true),
        ];
        unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    }

    /// Opens a window whose client area is one known color, captures it like
    /// a game and checks size and color. Proves the crop and the colors.
    fn run_self_test(out: &Path) -> Result<(), String> {
        const WIDTH: i32 = 640;
        const HEIGHT: i32 = 360;
        // COLORREF is 0x00BBGGRR: red 255, green 128, blue 0.
        const ORANGE: u32 = 0x0000_80FF;
        let hwnd = unsafe {
            let module = GetModuleHandleW(None).map_err(|error| error.message())?;
            let instance = HINSTANCE(module.0);
            let class = w!("PlayCounterScreenshotSpike");
            RegisterClassW(&WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                lpszClassName: class,
                hbrBackground: CreateSolidBrush(COLORREF(ORANGE)),
                ..Default::default()
            });
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: WIDTH,
                bottom: HEIGHT,
            };
            AdjustWindowRect(&mut rect, WS_OVERLAPPEDWINDOW, false)
                .map_err(|error| error.message())?;
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                class,
                w!("PlayCounter screenshot self-test"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                120,
                120,
                rect.right - rect.left,
                rect.bottom - rect.top,
                None,
                None,
                Some(instance),
                None,
            )
            .map_err(|error| error.message())?
        };
        // Let Windows paint and compose the window first.
        let shown = Instant::now();
        let mut message = MSG::default();
        while shown.elapsed() < Duration::from_millis(700) {
            while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                unsafe {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        // Like the app: each picture makes its own graphics device and lets it
        // go after. The first one also loads Windows' graphics code and the
        // next few fill caches, which stay; after that memory must stay flat.
        let take = |count: usize| {
            let mut last = capture_window(hwnd.0 as isize);
            for _ in 1..count {
                last = capture_window(hwnd.0 as isize);
            }
            std::thread::sleep(Duration::from_millis(500));
            (last, private_mb())
        };
        let before = private_mb();
        let (first, after_first) = take(1);
        let (_, after_20) = take(19);
        let (result, after_40) = take(20);
        unsafe {
            let _ = DestroyWindow(hwnd);
        }
        if let Ok((_, info)) = &first {
            println!(
                "First picture: {}",
                timings(
                    info,
                    0.0,
                    info.device_ms + info.item_ms + info.first_frame_ms + info.copy_ms
                )
            );
        }
        println!(
            "Private memory: {before:.1} MB before any picture, {after_first:.1} MB after the first, {after_20:.1} MB after 20, {after_40:.1} MB after 40"
        );
        if after_40 - after_20 > 3.0 {
            return Err(format!(
                "each picture holds more memory: {:+.1} MB from picture 20 to 40",
                after_40 - after_20
            ));
        }
        let (picture, info) = result?;
        if picture.width != WIDTH as u32 || picture.height != HEIGHT as u32 {
            return Err(format!(
                "expected the {WIDTH}x{HEIGHT} client area, got {}x{} (crop {:?})",
                picture.width, picture.height, info.crop
            ));
        }
        let pixel = |x: i32, y: i32| {
            let at = (y as usize * picture.width as usize + x as usize) * 4;
            [
                picture.bgra[at],
                picture.bgra[at + 1],
                picture.bgra[at + 2],
                picture.bgra[at + 3],
            ]
        };
        // The first row and column: a crop one pixel too high or too far left
        // would show the title bar or the border here.
        let mut wrong = Vec::new();
        let mut check = |name: &str, x: i32, y: i32| {
            let [b, g, r, _] = pixel(x, y);
            let close = |value: u8, expected: u8| value.abs_diff(expected) <= 3;
            if !(close(b, 0) && close(g, 128) && close(r, 255)) {
                wrong.push(format!("{name} ({x}, {y}) is BGR [{b}, {g}, {r}]"));
            }
        };
        check("top left", 0, 0);
        check("top right", WIDTH - 1, 0);
        check("center", WIDTH / 2, HEIGHT / 2);
        // Windows 11 rounds the bottom corners of windows that aren't
        // maximized or fullscreen; check just inside the curve, and the
        // middle of the last row and of the outer columns.
        check("bottom row", WIDTH / 2, HEIGHT - 1);
        check("left column", 0, HEIGHT / 2);
        check("right column", WIDTH - 1, HEIGHT / 2);
        check("inside bottom left", 12, HEIGHT - 12);
        check("inside bottom right", WIDTH - 13, HEIGHT - 12);
        println!(
            "Bottom left corner pixel BGRA {:?} (black and see-through = a Windows 11 rounded corner)",
            pixel(0, HEIGHT - 1)
        );
        let path = out.join("self-test.jpg");
        let encode_started = Instant::now();
        let bytes = save_jpeg(&picture, &path, JPEG_QUALITY)?;
        let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
        println!(
            "Captured {}  {}",
            sizes(&picture, &info),
            timings(
                &info,
                encode_ms,
                info.device_ms + info.item_ms + info.first_frame_ms + info.copy_ms + encode_ms
            )
        );
        println!("Saved {} ({bytes} bytes)", path.display());
        if !wrong.is_empty() {
            return Err(format!(
                "expected orange BGR [0, 128, 255]: {}",
                wrong.join(", ")
            ));
        }
        println!("SELF-TEST OK: right size, no title bar, right colors.");
        Ok(())
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }

    /// This process's private memory, in MB.
    fn private_mb() -> f64 {
        use windows::Win32::System::{
            ProcessStatus::{
                GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
            },
            Threading::GetCurrentProcess,
        };
        let mut counters = PROCESS_MEMORY_COUNTERS_EX {
            cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
            ..Default::default()
        };
        let read = unsafe {
            GetProcessMemoryInfo(
                GetCurrentProcess(),
                &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX as *mut PROCESS_MEMORY_COUNTERS,
                counters.cb,
            )
        };
        if read.is_err() {
            return 0.0;
        }
        counters.PrivateUsage as f64 / 1_048_576.0
    }

    fn pictures_folder() -> PathBuf {
        unsafe {
            match SHGetKnownFolderPath(&FOLDERID_Pictures, KF_FLAG_DEFAULT, None) {
                Ok(path) => {
                    let folder = PathBuf::from(path.to_string().unwrap_or_default());
                    CoTaskMemFree(Some(path.0 as *const _));
                    folder
                }
                Err(_) => {
                    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join("Pictures")
                }
            }
        }
    }

    fn window_title(hwnd: HWND) -> String {
        let mut buffer = [0u16; 256];
        let length = unsafe { GetWindowTextW(hwnd, &mut buffer) }.max(0) as usize;
        String::from_utf16_lossy(&buffer[..length])
    }

    fn window_exe(hwnd: HWND) -> String {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
        else {
            return format!("pid {pid}");
        };
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let name = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        }
        .ok()
        .map(|_| String::from_utf16_lossy(&buffer[..length as usize]))
        .and_then(|path| {
            Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| format!("pid {pid}"));
        unsafe {
            let _ = CloseHandle(process);
        }
        name
    }

    /// Local time as "2026-11-07<between>19<colon>14<colon>03".
    fn local_time(between: &str, colon: &str) -> String {
        let now = unsafe { GetLocalTime() };
        format!(
            "{:04}-{:02}-{:02}{between}{:02}{colon}{:02}{colon}{:02}",
            now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond
        )
    }

    fn clean_stem(name: &str) -> String {
        let cleaned: String = name
            .chars()
            .filter(|c| !c.is_control() && !r#"<>:"/\|?*"#.contains(*c))
            .take(80)
            .collect();
        let cleaned = cleaned.trim_end_matches(['.', ' ']).trim().to_string();
        if cleaned.is_empty() {
            "Screenshot".into()
        } else {
            cleaned
        }
    }

    fn unique_path(out: &Path, stem: &str, suffix: &str) -> PathBuf {
        let mut path = out.join(format!("{stem}{suffix}.jpg"));
        let mut number = 2;
        while path.exists() {
            path = out.join(format!("{stem} ({number}){suffix}.jpg"));
            number += 1;
        }
        path
    }

    fn file_name(path: &Path) -> String {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    fn log_line(out: &Path, line: &str) {
        println!("{line}");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(out.join("spike-log.txt"))
        {
            let _ = writeln!(file, "{line}");
        }
    }
}
