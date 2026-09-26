//! Product name and publisher from an executable's version resource. Discovered
//! shows them so people can tell what an unknown .exe is. Read locally, never
//! sent anywhere.

use serde::Serialize;

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExeDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company_name: Option<String>,
}

#[cfg(windows)]
pub fn read(path: &str) -> ExeDetails {
    use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW};

    let wide = to_wide(path);
    let mut ignored = 0u32;
    // SAFETY: `wide` is a NUL-terminated UTF-16 path that outlives the call.
    let size = unsafe { GetFileVersionInfoSizeW(wide.as_ptr(), &mut ignored) };
    if size == 0 {
        return ExeDetails::default();
    }
    let mut block = vec![0u8; size as usize];
    // SAFETY: `block` has exactly `size` writable bytes.
    let ok = unsafe { GetFileVersionInfoW(wide.as_ptr(), 0, size, block.as_mut_ptr().cast()) };
    if ok == 0 {
        return ExeDetails::default();
    }

    let translations = translations(&block);
    let value = |name: &str| {
        translations.iter().find_map(|(language, codepage)| {
            query_string(
                &block,
                &format!("\\StringFileInfo\\{language:04x}{codepage:04x}\\{name}"),
            )
        })
    };
    ExeDetails {
        product_name: value("ProductName"),
        file_description: value("FileDescription"),
        company_name: value("CompanyName"),
    }
}

#[cfg(not(windows))]
pub fn read(_path: &str) -> ExeDetails {
    ExeDetails::default()
}

#[cfg(windows)]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The language/codepage pairs the file declares, then the usual fallbacks for
/// files that omit or misdeclare them.
#[cfg(windows)]
fn translations(block: &[u8]) -> Vec<(u16, u16)> {
    use windows_sys::Win32::Storage::FileSystem::VerQueryValueW;

    let mut pairs = Vec::new();
    let query = to_wide("\\VarFileInfo\\Translation");
    let mut pointer: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut length = 0u32;
    // SAFETY: `block` came from GetFileVersionInfoW; the returned pointer
    // points into it and `length` is in bytes.
    let found = unsafe {
        VerQueryValueW(
            block.as_ptr().cast(),
            query.as_ptr(),
            &mut pointer,
            &mut length,
        )
    };
    if found != 0 && !pointer.is_null() {
        // SAFETY: the translation table is an array of u16 pairs inside `block`.
        let words =
            unsafe { std::slice::from_raw_parts(pointer as *const u16, length as usize / 2) };
        for pair in words.chunks_exact(2) {
            pairs.push((pair[0], pair[1]));
        }
    }
    for fallback in [(0x0409, 0x04b0), (0x0409, 0x04e4), (0x0000, 0x04b0)] {
        if !pairs.contains(&fallback) {
            pairs.push(fallback);
        }
    }
    pairs
}

#[cfg(windows)]
fn query_string(block: &[u8], sub_block: &str) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::VerQueryValueW;

    let query = to_wide(sub_block);
    let mut pointer: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut length = 0u32;
    // SAFETY: as in `translations`; for strings `length` counts UTF-16 units.
    let found = unsafe {
        VerQueryValueW(
            block.as_ptr().cast(),
            query.as_ptr(),
            &mut pointer,
            &mut length,
        )
    };
    if found == 0 || pointer.is_null() || length == 0 {
        return None;
    }
    // SAFETY: the string lies inside `block` and is `length` units long.
    let units = unsafe { std::slice::from_raw_parts(pointer as *const u16, length as usize) };
    let end = units
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(units.len());
    let text = String::from_utf16_lossy(&units[..end]).trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn reads_the_publisher_of_a_windows_executable() {
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let notepad = format!("{windows}\\System32\\notepad.exe");
        if !std::path::Path::new(&notepad).is_file() {
            return;
        }
        let details = read(&notepad);
        assert!(details
            .company_name
            .as_deref()
            .is_some_and(|company| company.contains("Microsoft")));
        assert!(details.file_description.is_some());
    }

    #[test]
    fn returns_nothing_for_a_file_without_version_info() {
        assert_eq!(
            read("C:\\does-not-exist\\nothing.exe"),
            ExeDetails::default()
        );
    }
}
