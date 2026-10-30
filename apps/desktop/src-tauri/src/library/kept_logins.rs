//! Launcher sign-ins kept on this PC, so the next import needs no new sign-in.
//!
//! Each service gets one file in the app's local data folder, encrypted with
//! Windows' own data protection (DPAPI) for the signed-in Windows account: a
//! copy cannot be opened by another account or on another PC. Only this Rust
//! part reads them. The web UI sees the service, a display name and a date,
//! never a token. Other systems keep nothing for now.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Service {
    Xbox,
    Epic,
    BattleNet,
}

impl Service {
    pub(crate) const ALL: [Service; 3] = [Service::Xbox, Service::Epic, Service::BattleNet];

    pub(crate) fn id(self) -> &'static str {
        match self {
            Service::Xbox => "xbox",
            Service::Epic => "epic",
            Service::BattleNet => "battlenet",
        }
    }

    fn parse(value: &str) -> Option<Service> {
        Self::ALL.into_iter().find(|service| service.id() == value)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeptLogin {
    /// The refresh token. Empty for Battle.net, whose sign-in lives in its
    /// own browser profile.
    #[serde(default)]
    pub secret: String,
    /// "Signed in as …": the Xbox gamertag or the Epic display name.
    #[serde(default)]
    pub name: Option<String>,
    /// Xbox only: the PlayCounter server that can redeem the token.
    #[serde(default)]
    pub origin: Option<String>,
    /// Unix milliseconds.
    #[serde(default)]
    pub saved_at: u64,
}

impl KeptLogin {
    pub(crate) fn new(secret: String, name: Option<String>) -> Self {
        Self {
            secret,
            name: name
                .map(|name| name.trim().chars().take(64).collect::<String>())
                .filter(|name| !name.is_empty()),
            origin: None,
            saved_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as u64)
                .unwrap_or_default(),
        }
    }
}

/// What the web UI may know about a kept sign-in.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeptLoginSummary {
    service: &'static str,
    name: Option<String>,
    saved_at: u64,
}

pub(crate) struct Store {
    dir: PathBuf,
}

impl Store {
    pub(crate) fn of(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            dir: app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?
                .join("logins"),
        })
    }

    /// A store in a fresh temporary folder.
    #[cfg(test)]
    pub(crate) fn for_test() -> (Self, PathBuf) {
        let dir = std::env::temp_dir().join(format!("playcounter-logins-{}", uuid::Uuid::new_v4()));
        (Self { dir: dir.clone() }, dir)
    }

    pub(crate) fn dir(&self) -> &PathBuf {
        &self.dir
    }

    fn path(&self, service: Service) -> PathBuf {
        self.dir.join(format!("{}.bin", service.id()))
    }

    /// `None` when nothing is kept. A file that cannot be opened counts as
    /// signed out and is deleted.
    pub(crate) fn load(&self, service: Service) -> Option<KeptLogin> {
        let path = self.path(service);
        let sealed = fs::read(&path).ok()?;
        match unseal(&sealed).and_then(|bytes| serde_json::from_slice(&bytes).map_err(|_| ())) {
            Ok(login) => Some(login),
            Err(()) => {
                let _ = fs::remove_file(&path);
                None
            }
        }
    }

    pub(crate) fn save(&self, service: Service, login: &KeptLogin) -> Result<(), String> {
        let bytes = serde_json::to_vec(login).map_err(|error| error.to_string())?;
        let sealed = seal(&bytes)?;
        fs::create_dir_all(&self.dir).map_err(|error| error.to_string())?;
        let path = self.path(service);
        let temporary = path.with_extension("tmp");
        fs::write(&temporary, sealed).map_err(|error| error.to_string())?;
        fs::rename(&temporary, &path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            error.to_string()
        })
    }

    pub(crate) fn delete(&self, service: Service) -> Result<(), String> {
        match fs::remove_file(self.path(service)) {
            Err(error) if error.kind() != ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        }
    }

    fn list(&self) -> Vec<KeptLoginSummary> {
        Service::ALL
            .into_iter()
            .filter_map(|service| {
                self.load(service).map(|login| KeptLoginSummary {
                    service: service.id(),
                    name: login.name,
                    saved_at: login.saved_at,
                })
            })
            .collect()
    }
}

/// Binds the encryption to this purpose: another app's DPAPI data is not a
/// kept sign-in, and ours is no use to a tool that does not know this.
#[cfg(windows)]
const ENTROPY: &[u8] = b"playcounter.kept-sign-in.v1";

#[cfg(windows)]
fn seal(bytes: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(bytes, true).ok_or_else(|| "Windows could not encrypt the sign-in.".into())
}

#[cfg(windows)]
fn unseal(bytes: &[u8]) -> Result<Vec<u8>, ()> {
    dpapi(bytes, false).ok_or(())
}

#[cfg(windows)]
fn dpapi(input: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(input.len()).ok()?,
        pbData: input.as_ptr().cast_mut(),
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // SAFETY: DPAPI only reads the two input blobs, which point at live
    // slices, and allocates the output, which is copied and freed below.
    unsafe {
        let ok = if protect {
            CryptProtectData(
                &input,
                std::ptr::null(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pbData.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        // Plain text must not linger in freed memory.
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData.cast());
        Some(bytes)
    }
}

#[cfg(not(windows))]
fn seal(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Sign-ins are kept only on Windows.".into())
}

#[cfg(not(windows))]
fn unseal(_: &[u8]) -> Result<Vec<u8>, ()> {
    Err(())
}

/// Deletes the sign-in first, so nothing uses it again whatever happens next,
/// then ends it where the service allows that.
pub(crate) async fn sign_out(app: &AppHandle, service: Service) -> Result<(), String> {
    let store = Store::of(app)?;
    let kept = store.load(service);
    store.delete(service)?;
    match service {
        Service::Epic => {
            if let Some(login) = kept {
                super::epic_account::end_kept_session(&login.secret).await;
            }
        }
        Service::BattleNet => super::battlenet_account::forget_profile(app),
        // Microsoft has no call to end it from here. Unused, it ends by itself.
        Service::Xbox => {}
    }
    Ok(())
}

/// For "Reset local data".
pub(crate) async fn sign_out_everywhere(app: &AppHandle) -> Result<(), String> {
    for service in Service::ALL {
        sign_out(app, service).await?;
    }
    if let Ok(store) = Store::of(app) {
        let _ = fs::remove_dir_all(store.dir());
    }
    Ok(())
}

#[tauri::command]
pub fn logins_list(app: AppHandle) -> Vec<KeptLoginSummary> {
    Store::of(&app)
        .map(|store| store.list())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn logins_sign_out(
    app: AppHandle,
    window: WebviewWindow,
    service: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Sign-ins can only be removed in PlayCounter.".into());
    }
    let service = Service::parse(&service).ok_or("Unknown sign-in.")?;
    sign_out(&app, service).await
}

// DPAPI only exists on Windows.
#[cfg(windows)]
#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Store, PathBuf) {
        Store::for_test()
    }

    #[test]
    fn a_kept_sign_in_comes_back_as_saved_and_is_gone_after_delete() {
        let (store, dir) = store();
        let login = KeptLogin::new("refresh-token-123".into(), Some("Master Chief".into()));
        store.save(Service::Epic, &login).unwrap();

        assert_eq!(store.load(Service::Epic), Some(login));
        assert_eq!(store.load(Service::Xbox), None);
        store.delete(Service::Epic).unwrap();
        assert_eq!(store.load(Service::Epic), None);
        store.delete(Service::Epic).unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_file_never_holds_the_token_as_text() {
        let (store, dir) = store();
        store
            .save(
                Service::Xbox,
                &KeptLogin::new("M.C5_BAY.refresh-token".into(), Some("Chief".into())),
            )
            .unwrap();
        let bytes = fs::read(dir.join("xbox.bin")).unwrap();

        for plain in ["refresh-token", "Chief", "secret"] {
            assert!(!bytes
                .windows(plain.len())
                .any(|window| window == plain.as_bytes()));
        }
        assert!(!dir.join("xbox.tmp").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn an_unreadable_file_counts_as_signed_out_and_is_deleted() {
        let (store, dir) = store();
        store
            .save(Service::Epic, &KeptLogin::new("token".into(), None))
            .unwrap();
        let path = dir.join("epic.bin");
        let mut bytes = fs::read(&path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        fs::write(&path, bytes).unwrap();

        assert_eq!(store.load(Service::Epic), None);
        assert!(!path.exists());
        fs::write(&path, b"not encrypted").unwrap();
        assert_eq!(store.load(Service::Epic), None);
        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn data_encrypted_without_our_purpose_is_not_a_kept_sign_in() {
        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB},
        };
        let plain = br#"{"secret":"stolen"}"#;
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let sealed = unsafe {
            assert_ne!(
                CryptProtectData(
                    &input,
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    0,
                    &mut output
                ),
                0
            );
            let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData.cast());
            bytes
        };

        assert!(unseal(&sealed).is_err());
    }

    #[test]
    fn the_web_ui_sees_service_name_and_date_only() {
        let (store, dir) = store();
        store
            .save(
                Service::Xbox,
                &KeptLogin::new("xbox-token".into(), Some("Chief".into())),
            )
            .unwrap();
        store
            .save(Service::BattleNet, &KeptLogin::new(String::new(), None))
            .unwrap();

        let list = store.list();
        let text = serde_json::to_string(&list).unwrap();
        assert_eq!(list.len(), 2);
        assert!(text.contains(r#""service":"xbox","name":"Chief""#));
        assert!(text.contains(r#""service":"battlenet","name":null"#));
        assert!(!text.contains("xbox-token"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn names_are_trimmed_and_capped() {
        assert_eq!(KeptLogin::new("t".into(), Some("  ".into())).name, None);
        assert_eq!(
            KeptLogin::new("t".into(), Some("x".repeat(100)))
                .name
                .unwrap()
                .chars()
                .count(),
            64
        );
    }
}
