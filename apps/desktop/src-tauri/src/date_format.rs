//! The computer's own short date format. Settings' "Automatic" writes dates
//! in numbers the way Windows does (dd.MM.yyyy on a German PC), whatever
//! language PlayCounter's texts are in.

/// The short date pattern of the signed-in user, e.g. "dd.MM.yyyy". None on
/// other systems, or when Windows can't tell.
#[tauri::command]
pub fn system_date_pattern() -> Option<String> {
    short_date_pattern()
}

#[cfg(windows)]
fn short_date_pattern() -> Option<String> {
    use windows_sys::Win32::Globalization::{GetLocaleInfoEx, LOCALE_SSHORTDATE};

    let mut buffer = [0u16; 80];
    // A null locale name is the user's default locale, with their own changes.
    let written = unsafe {
        GetLocaleInfoEx(
            std::ptr::null(),
            LOCALE_SSHORTDATE,
            buffer.as_mut_ptr(),
            buffer.len() as i32,
        )
    };
    // The count includes the closing null.
    if written <= 1 {
        return None;
    }
    let pattern = String::from_utf16_lossy(&buffer[..written as usize - 1]);
    let pattern = pattern.trim();
    (!pattern.is_empty()).then(|| pattern.to_string())
}

#[cfg(not(windows))]
fn short_date_pattern() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn reads_the_users_short_date_pattern() {
        let pattern = super::short_date_pattern().expect("Windows has a short date format");
        assert!(
            pattern.contains('d') && pattern.contains('M') && pattern.contains('y'),
            "{pattern}"
        );
    }
}
