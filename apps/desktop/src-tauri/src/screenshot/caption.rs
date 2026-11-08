//! A picture's caption, kept in the picture file itself as Windows' "Title"
//! file property. It stays with the picture when the folder is copied, and
//! Explorer shows it.

use std::path::{Path, PathBuf};

/// One line, like a photo caption. Longer text belongs in the session note.
pub const CAPTION_LIMIT: usize = 150;

/// The caption as it is saved: one line, at most `CAPTION_LIMIT` characters.
/// None when nothing is left.
pub fn clean_caption(text: &str) -> Option<String> {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = one_line.chars().take(CAPTION_LIMIT).collect();
    let cut = cut.trim_end();
    (!cut.is_empty()).then(|| cut.to_string())
}

/// The picture's caption, or None when it has none.
pub fn read_caption(path: &Path) -> Result<Option<String>, String> {
    imp::on_com_thread(|| imp::read(path))?
}

/// The captions of many pictures, in the same order. A picture whose
/// caption can't be read counts as having none.
pub fn read_captions(paths: &[PathBuf]) -> Vec<Option<String>> {
    imp::on_com_thread(|| {
        paths
            .iter()
            .map(|path| imp::read(path).ok().flatten())
            .collect()
    })
    .unwrap_or_else(|_| vec![None; paths.len()])
}

/// Saves the caption into the picture, or removes it for None. The picture
/// itself doesn't change.
pub fn write_caption(path: &Path, caption: Option<&str>) -> Result<(), String> {
    imp::on_com_thread(|| imp::write(path, caption))?
}

#[cfg(not(windows))]
mod imp {
    use std::path::Path;

    pub fn on_com_thread<T>(work: impl FnOnce() -> T) -> Result<T, String> {
        Ok(work())
    }

    pub fn read(_path: &Path) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn write(_path: &Path, _caption: Option<&str>) -> Result<(), String> {
        Err("Captions are not supported on this platform.".into())
    }
}

#[cfg(windows)]
mod imp {
    use std::{mem::ManuallyDrop, path::Path};
    use windows::{
        core::{HSTRING, PWSTR},
        Win32::{
            Storage::EnhancedStorage::PKEY_Title,
            System::{
                Com::{
                    CoInitializeEx, CoTaskMemAlloc, CoTaskMemFree, CoUninitialize,
                    StructuredStorage::{
                        PropVariantClear, PropVariantToStringAlloc, PROPVARIANT, PROPVARIANT_0,
                        PROPVARIANT_0_0, PROPVARIANT_0_0_0,
                    },
                    COINIT_MULTITHREADED,
                },
                Variant::{VT_EMPTY, VT_LPWSTR},
            },
            UI::Shell::PropertiesSystem::{
                IPropertyStore, SHGetPropertyStoreFromParsingName, GPS_DEFAULT, GPS_READWRITE,
            },
        },
    };

    fn text(error: windows::core::Error) -> String {
        error.message()
    }

    /// Runs `work` on a new thread with COM in the multithreaded apartment,
    /// which the property system needs.
    pub fn on_com_thread<T: Send>(work: impl FnOnce() -> T + Send) -> Result<T, String> {
        std::thread::scope(|scope| {
            scope
                .spawn(|| {
                    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
                    let result = work();
                    if initialized {
                        unsafe { CoUninitialize() };
                    }
                    result
                })
                .join()
                .map_err(|_| "The caption thread stopped.".to_string())
        })
    }

    /// The path as the shell parses it. Resolved paths start with \\?\,
    /// which it rejects as a wrong parameter.
    pub(super) fn shell_path(path: &Path) -> String {
        let text = path.to_string_lossy();
        if let Some(share) = text.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{share}")
        } else if let Some(rest) = text.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            text.into_owned()
        }
    }

    fn store(path: &Path, writable: bool) -> Result<IPropertyStore, String> {
        let flags = if writable { GPS_READWRITE } else { GPS_DEFAULT };
        unsafe { SHGetPropertyStoreFromParsingName(&HSTRING::from(shell_path(path)), None, flags) }
            .map_err(text)
    }

    pub fn read(path: &Path) -> Result<Option<String>, String> {
        let store = store(path, false)?;
        let mut value = unsafe { store.GetValue(&PKEY_Title) }.map_err(text)?;
        let empty = unsafe { value.Anonymous.Anonymous.vt } == VT_EMPTY;
        let caption = if empty {
            Ok(None)
        } else {
            unsafe { PropVariantToStringAlloc(&value) }
                .map_err(text)
                .and_then(|raw| {
                    let caption = unsafe { raw.to_string() }.map_err(|error| error.to_string());
                    unsafe { CoTaskMemFree(Some(raw.0 as *const _)) };
                    caption
                })
                .map(|caption| (!caption.is_empty()).then_some(caption))
        };
        let _ = unsafe { PropVariantClear(&mut value) };
        caption
    }

    pub fn write(path: &Path, caption: Option<&str>) -> Result<(), String> {
        let store = store(path, true)?;
        let mut value = match caption {
            Some(caption) => string_value(caption)?,
            None => PROPVARIANT::default(),
        };
        let result = unsafe { store.SetValue(&PKEY_Title, &value) }
            .and_then(|()| unsafe { store.Commit() })
            .map_err(text);
        let _ = unsafe { PropVariantClear(&mut value) };
        result
    }

    /// A string PROPVARIANT whose text COM owns, like InitPropVariantFromString.
    /// The store may swap that text for its own copy and free ours, so it
    /// must never be Rust memory: that was a double free.
    fn string_value(caption: &str) -> Result<PROPVARIANT, String> {
        let wide: Vec<u16> = caption.encode_utf16().chain(Some(0)).collect();
        let text = unsafe { CoTaskMemAlloc(wide.len() * 2) } as *mut u16;
        if text.is_null() {
            return Err("Out of memory.".into());
        }
        unsafe { std::ptr::copy_nonoverlapping(wide.as_ptr(), text, wide.len()) };
        Ok(PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_LPWSTR,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        pwszVal: PWSTR(text),
                    },
                }),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_caption_on_one_line() {
        assert_eq!(
            clean_caption("  Finally\nbeat\r\n Malenia\t "),
            Some("Finally beat Malenia".into())
        );
    }

    #[test]
    fn cuts_a_caption_at_the_limit() {
        let long = "ä".repeat(CAPTION_LIMIT + 20);
        let cleaned = clean_caption(&long).unwrap();
        assert_eq!(cleaned.chars().count(), CAPTION_LIMIT);
    }

    #[test]
    fn an_empty_caption_is_none() {
        assert_eq!(clean_caption(""), None);
        assert_eq!(clean_caption(" \n\t "), None);
    }

    #[cfg(windows)]
    mod files {
        use super::super::*;
        use crate::screenshot::{save_jpeg, Picture};
        use std::sync::atomic::{AtomicU32, Ordering};
        use windows::{
            core::HSTRING,
            Win32::{
                Foundation::GENERIC_READ,
                Graphics::Imaging::{
                    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICImagingFactory,
                    WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom,
                    WICDecodeMetadataCacheOnDemand,
                },
                System::Com::{
                    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                    COINIT_MULTITHREADED,
                },
            },
        };

        static NEXT: AtomicU32 = AtomicU32::new(0);

        /// A real JPEG like the screenshot key writes, with a pattern in it.
        fn picture_file() -> PathBuf {
            let folder = std::env::temp_dir().join(format!(
                "playcounter-caption-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&folder).unwrap();
            let (width, height) = (320u32, 180u32);
            let mut bgra = Vec::with_capacity((width * height * 4) as usize);
            for y in 0..height {
                for x in 0..width {
                    let noise = ((x * 7919 + y * 104_729) % 37) as u8;
                    bgra.extend_from_slice(&[
                        (x % 256) as u8,
                        (y * 255 / height) as u8,
                        noise.wrapping_mul(6),
                        255,
                    ]);
                }
            }
            let path = folder.join("Elden Ring 2026-11-08 21-44-07.jpg");
            save_jpeg(
                &Picture {
                    width,
                    height,
                    bgra,
                },
                &path,
                0.9,
            )
            .unwrap();
            path
        }

        fn remove(path: &Path) {
            let _ = std::fs::remove_dir_all(path.parent().unwrap());
        }

        /// The picture's pixels as WIC decodes them.
        fn pixels(path: &Path) -> Vec<u8> {
            std::thread::scope(|scope| {
                scope
                    .spawn(|| unsafe {
                        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
                        let factory: IWICImagingFactory =
                            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                                .unwrap();
                        let decoder = factory
                            .CreateDecoderFromFilename(
                                &HSTRING::from(path.as_os_str()),
                                None,
                                GENERIC_READ,
                                WICDecodeMetadataCacheOnDemand,
                            )
                            .unwrap();
                        let frame = decoder.GetFrame(0).unwrap();
                        let converter = factory.CreateFormatConverter().unwrap();
                        converter
                            .Initialize(
                                &frame,
                                &GUID_WICPixelFormat32bppBGRA,
                                WICBitmapDitherTypeNone,
                                None,
                                0.0,
                                WICBitmapPaletteTypeCustom,
                            )
                            .unwrap();
                        let (mut width, mut height) = (0, 0);
                        converter.GetSize(&mut width, &mut height).unwrap();
                        let mut out = vec![0u8; (width * height * 4) as usize];
                        converter
                            .CopyPixels(std::ptr::null(), width * 4, &mut out)
                            .unwrap();
                        drop((converter, frame, decoder, factory));
                        if initialized {
                            CoUninitialize();
                        }
                        out
                    })
                    .join()
                    .unwrap()
            })
        }

        #[test]
        fn a_new_picture_has_no_caption() {
            let path = picture_file();
            assert_eq!(read_caption(&path), Ok(None));
            remove(&path);
        }

        #[test]
        fn reads_back_the_caption_it_wrote() {
            let path = picture_file();
            write_caption(&path, Some("Finally beat Malenia, attempt 47")).unwrap();
            assert_eq!(
                read_caption(&path),
                Ok(Some("Finally beat Malenia, attempt 47".into()))
            );
            remove(&path);
        }

        #[test]
        fn keeps_captions_in_any_language() {
            let path = picture_file();
            for caption in [
                "Endlich geschafft! Größter Moment",
                "终于打败了她",
                "GG 🎉🔥",
            ] {
                write_caption(&path, Some(caption)).unwrap();
                assert_eq!(read_caption(&path), Ok(Some(caption.into())));
            }
            remove(&path);
        }

        #[test]
        fn the_picture_stays_exactly_the_same() {
            let path = picture_file();
            let before = pixels(&path);
            write_caption(&path, Some("That view from the tower")).unwrap();
            write_caption(&path, Some("Changed my mind about the caption")).unwrap();
            assert!(before == pixels(&path), "the caption changed the picture");
            remove(&path);
        }

        #[test]
        fn hands_the_shell_paths_it_can_parse() {
            use super::super::imp::shell_path;
            assert_eq!(
                shell_path(Path::new(r"\\?\C:\Users\me\Pictures\PlayCounter\a.jpg")),
                r"C:\Users\me\Pictures\PlayCounter\a.jpg"
            );
            assert_eq!(
                shell_path(Path::new(r"\\?\UNC\nas\pictures\PlayCounter\a.jpg")),
                r"\\nas\pictures\PlayCounter\a.jpg"
            );
            assert_eq!(
                shell_path(Path::new(r"D:\Pictures\PlayCounter\a.jpg")),
                r"D:\Pictures\PlayCounter\a.jpg"
            );
        }

        #[test]
        fn works_with_resolved_windows_paths() {
            // The app checks a picture's path by resolving it first, which on
            // Windows gives \\?\C:\…, the form the viewer and the box use.
            let path = picture_file();
            let resolved = std::fs::canonicalize(&path).unwrap();
            assert!(resolved.to_string_lossy().starts_with(r"\\?\"));
            write_caption(&resolved, Some("Boss arena")).unwrap();
            assert_eq!(read_caption(&resolved), Ok(Some("Boss arena".into())));
            assert_eq!(read_caption(&path), Ok(Some("Boss arena".into())));
            remove(&path);
        }

        #[test]
        fn removing_the_caption_leaves_none() {
            let path = picture_file();
            write_caption(&path, Some("Boss arena")).unwrap();
            write_caption(&path, None).unwrap();
            assert_eq!(read_caption(&path), Ok(None));
            // Removing it again, or from a picture without one, is fine too.
            write_caption(&path, None).unwrap();
            assert_eq!(read_caption(&path), Ok(None));
            remove(&path);
        }

        #[test]
        fn survives_many_changes_in_a_row() {
            let path = picture_file();
            for round in 0..20 {
                let caption = format!("Caption number {round}");
                write_caption(&path, Some(&caption)).unwrap();
                assert_eq!(read_caption(&path), Ok(Some(caption)));
            }
            remove(&path);
        }

        #[test]
        fn reads_many_captions_in_order() {
            let first = picture_file();
            let second = picture_file();
            write_caption(&second, Some("Second")).unwrap();
            let missing = first.with_file_name("gone.jpg");
            let captions = read_captions(&[first.clone(), second.clone(), missing]);
            assert_eq!(captions, vec![None, Some("Second".into()), None]);
            remove(&first);
            remove(&second);
        }
    }
}
