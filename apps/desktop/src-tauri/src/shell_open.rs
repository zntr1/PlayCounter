//! Hands a URL to the shell's registered protocol handler.
//!
//! Windows deliberately avoids `rundll32.exe url.dll,FileProtocolHandler`.
//! That command line is a catalogued proxy-execution technique, so Defender's
//! behaviour monitoring scores it as suspicious even when the calling process
//! is signed. `FileProtocolHandler` only forwards to `ShellExecuteW` anyway,
//! so calling it directly keeps the same behaviour without spawning a helper
//! process. Callers are responsible for validating the URL first.

#[cfg(target_os = "windows")]
pub fn open_url(url: &str) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
            UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        },
    };

    let wide_url = url.encode_utf16().chain(Some(0)).collect::<Vec<_>>();

    unsafe {
        // A protocol handler can live in a COM server, so the calling thread
        // has to be initialised before ShellExecuteW dispatches to it. S_FALSE
        // (already initialised here) still needs a matching CoUninitialize,
        // while RPC_E_CHANGED_MODE means another mode owns the thread and we
        // must leave it alone.
        let owns_com = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        // A null verb selects the protocol's default action, which is what
        // FileProtocolHandler used to do for us.
        let result = ShellExecuteW(
            None,
            PCWSTR::null(),
            PCWSTR(wide_url.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        if owns_com {
            CoUninitialize();
        }

        // ShellExecuteW reports success as a pseudo-handle greater than 32.
        let code = result.0 as isize;
        if code > 32 {
            Ok(())
        } else {
            Err(format!("The shell could not open the link ({code})."))
        }
    }
}

#[cfg(target_os = "macos")]
pub fn open_url(url: &str) -> Result<(), String> {
    spawn_opener("open", url)
}

#[cfg(target_os = "linux")]
pub fn open_url(url: &str) -> Result<(), String> {
    spawn_opener("xdg-open", url)
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn open_url(url: &str) -> Result<(), String> {
    let _ = url;
    Err("Opening links is not supported on this platform.".to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn spawn_opener(program: &str, url: &str) -> Result<(), String> {
    std::process::Command::new(program)
        .arg(url)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}
