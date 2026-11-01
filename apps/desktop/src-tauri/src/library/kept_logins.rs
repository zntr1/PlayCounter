//! Launcher sign-ins kept on this PC, so the next import needs no new sign-in.
//!
//! Each service gets one file in the app's local data folder, encrypted with
//! Windows' own data protection (DPAPI) for the signed-in Windows account: a
//! copy cannot be opened by another account or on another PC. Only this Rust
//! part reads them. The web UI sees the service, a display name and a date,
//! never a token. Other systems keep nothing for now.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Service {
    Xbox,
    Epic,
    BattleNet,
    Gog,
}

impl Service {
    pub(crate) const ALL: [Service; 4] = [
        Service::Xbox,
        Service::Epic,
        Service::BattleNet,
        Service::Gog,
    ];

    pub(crate) fn id(self) -> &'static str {
        match self {
            Service::Xbox => "xbox",
            Service::Epic => "epic",
            Service::BattleNet => "battlenet",
            Service::Gog => "gog",
        }
    }

    fn parse(value: &str) -> Option<Service> {
        Self::ALL.into_iter().find(|service| service.id() == value)
    }

    fn index(self) -> usize {
        match self {
            Service::Xbox => 0,
            Service::Epic => 1,
            Service::BattleNet => 2,
            Service::Gog => 3,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeptLogin {
    /// The refresh token, or Battle.net's native cookie snapshot. Older
    /// Battle.net records have an empty marker and rely on the browser profile.
    #[serde(default)]
    pub secret: String,
    /// "Signed in as …": the Xbox gamertag, the Epic display name or the GOG
    /// user name.
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
    generations: [u64; Service::ALL.len()],
}

// A sign-out invalidates every operation already using that service. Hold
// this lock through the file mutation so a late network response cannot
// recreate a credential after sign-out (or delete a newer account's login).
static GENERATIONS: LazyLock<Mutex<HashMap<PathBuf, [u64; Service::ALL.len()]>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

impl Store {
    pub(crate) fn of(app: &AppHandle) -> Result<Self, String> {
        Self::at(
            app.path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?
                .join("logins"),
        )
    }

    fn at(dir: PathBuf) -> Result<Self, String> {
        let generations = *GENERATIONS
            .lock()
            .map_err(|_| "Could not open saved sign-ins.")?
            .entry(dir.clone())
            .or_default();
        Ok(Self { dir, generations })
    }

    pub(crate) fn is_current(&self, service: Service) -> bool {
        GENERATIONS.lock().ok().is_some_and(|generations| {
            generations.get(&self.dir).is_some_and(|current| {
                current[service.index()] == self.generations[service.index()]
            })
        })
    }

    /// A store in a fresh temporary folder.
    #[cfg(test)]
    pub(crate) fn for_test() -> (Self, PathBuf) {
        let dir = std::env::temp_dir().join(format!("playcounter-logins-{}", uuid::Uuid::new_v4()));
        (Self::at(dir.clone()).unwrap(), dir)
    }

    pub(crate) fn dir(&self) -> &PathBuf {
        &self.dir
    }

    fn path(&self, service: Service) -> PathBuf {
        self.dir.join(format!("{}.bin", service.id()))
    }

    /// Best-effort access for explicit sign-out, which must also remove
    /// unreadable records. Authentication and summaries must use try_load.
    pub(crate) fn load(&self, service: Service) -> Option<KeptLogin> {
        self.try_load(service).ok().flatten()
    }

    /// Only a missing file or invalidated operation means there is no login.
    /// Read/decryption errors preserve the file: they do not prove expiry.
    pub(crate) fn try_load(&self, service: Service) -> Result<Option<KeptLogin>, String> {
        let generations = GENERATIONS
            .lock()
            .map_err(|_| "Could not open saved sign-ins.")?;
        if generations
            .get(&self.dir)
            .map(|current| current[service.index()])
            != Some(self.generations[service.index()])
        {
            return Ok(None);
        }
        let path = self.path(service);
        let sealed = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Could not open saved sign-ins.".into()),
        };
        let bytes = unseal(&sealed).map_err(|_| "Could not open saved sign-ins.")?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "Could not open saved sign-ins.".into())
    }

    pub(crate) fn save(&self, service: Service, login: &KeptLogin) -> Result<(), String> {
        let generations = GENERATIONS
            .lock()
            .map_err(|_| "Could not save the sign-in.")?;
        if generations
            .get(&self.dir)
            .map(|current| current[service.index()])
            != Some(self.generations[service.index()])
        {
            return Err("This sign-in was cancelled by signing out.".into());
        }
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
        let generations = GENERATIONS
            .lock()
            .map_err(|_| "Could not remove the sign-in.")?;
        if generations
            .get(&self.dir)
            .map(|current| current[service.index()])
            != Some(self.generations[service.index()])
        {
            return Ok(());
        }
        self.delete_file(service)
    }

    fn invalidate(&self, service: Service) -> Result<(), String> {
        let mut generations = GENERATIONS
            .lock()
            .map_err(|_| "Could not remove the sign-in.")?;
        let current = generations.entry(self.dir.clone()).or_default();
        current[service.index()] = current[service.index()].wrapping_add(1);
        self.delete_file(service)
    }

    fn delete_file(&self, service: Service) -> Result<(), String> {
        match fs::remove_file(self.path(service)) {
            Err(error) if error.kind() != ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        }
    }

    fn list(&self) -> Result<Vec<KeptLoginSummary>, String> {
        let mut summaries = Vec::new();
        for service in Service::ALL {
            if let Some(login) = self.try_load(service)? {
                summaries.push(KeptLoginSummary {
                    service: service.id(),
                    name: login.name,
                    saved_at: login.saved_at,
                });
            }
        }
        Ok(summaries)
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
    store.invalidate(service)?;
    match service {
        Service::Epic => {
            super::epic_account::cancel_active(app);
            if let Some(login) = kept {
                super::epic_account::end_kept_session(&login.secret).await;
            }
        }
        Service::BattleNet => {
            super::battlenet_account::cancel_active(app);
            super::battlenet_account::forget_profile(app);
        }
        // GOG has no call to end it from here, as far as known.
        Service::Gog => super::gog_account::cancel_active(app),
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
pub fn logins_list(app: AppHandle) -> Result<Vec<KeptLoginSummary>, String> {
    Store::of(&app)?.list()
}

/// Validate a saved connection without ever starting interactive sign-in.
#[tauri::command]
pub async fn logins_check(
    app: AppHandle,
    window: WebviewWindow,
    service: String,
    api_endpoint: String,
) -> super::login_status::LoginStatus {
    use super::login_status::LoginStatus;
    if window.label() != "main" || !cfg!(windows) {
        return LoginStatus::Unavailable;
    }
    match Service::parse(&service) {
        Some(Service::Xbox) => super::xbox_login::check_saved_login(&app, &api_endpoint).await,
        Some(Service::Epic) => super::epic_account::check_saved_login(&app).await,
        Some(Service::BattleNet) => super::battlenet_account::check_saved_login(&app).await,
        Some(Service::Gog) => super::gog_account::check_saved_login(&app).await,
        None => LoginStatus::Unavailable,
    }
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
    fn sign_out_prevents_late_refreshes_and_claims_from_recreating_each_login() {
        for service in Service::ALL {
            let (pending, dir) = store();
            let old = KeptLogin::new("old-token".into(), None);
            pending.save(service, &old).unwrap();
            let signing_out = Store::at(dir.clone()).unwrap();
            signing_out.invalidate(service).unwrap();

            // A network request/claim began before sign-out, then completed.
            assert!(pending.save(service, &old).is_err());
            assert!(!pending.is_current(service));
            let next = Store::at(dir.clone()).unwrap();
            assert_eq!(next.load(service), None);

            // An explicitly started sign-in can save, and an old failure
            // cannot delete that newer account's credentials.
            let new = KeptLogin::new("new-token".into(), Some("New account".into()));
            next.save(service, &new).unwrap();
            pending.delete(service).unwrap();
            assert_eq!(pending.load(service), None);
            assert_eq!(next.load(service), Some(new));
            let _ = fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn signing_out_one_service_does_not_cancel_another() {
        let (pending, dir) = store();
        let signing_out = Store::at(dir.clone()).unwrap();
        signing_out.invalidate(Service::Xbox).unwrap();
        let login = KeptLogin::new("epic-token".into(), None);
        pending.save(Service::Epic, &login).unwrap();
        assert_eq!(pending.load(Service::Epic), Some(login));
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
    fn an_unreadable_or_invalid_file_is_preserved_and_reports_unavailable() {
        let (store, dir) = store();
        store
            .save(Service::Xbox, &KeptLogin::new("healthy-token".into(), None))
            .unwrap();
        let healthy_bytes = fs::read(dir.join("xbox.bin")).unwrap();
        store
            .save(Service::Epic, &KeptLogin::new("token".into(), None))
            .unwrap();
        let path = dir.join("epic.bin");
        let mut bytes = fs::read(&path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        fs::write(&path, &bytes).unwrap();
        assert!(store.try_load(Service::Epic).is_err());
        // A partial list would hide Epic and falsely show it signed out.
        assert!(store.list().is_err());
        assert_eq!(store.load(Service::Epic), None);
        assert_eq!(fs::read(&path).unwrap(), bytes);

        fs::write(&path, b"not encrypted").unwrap();
        assert!(store.try_load(Service::Epic).is_err());
        assert!(store.list().is_err());
        assert_eq!(store.load(Service::Epic), None);
        assert_eq!(fs::read(&path).unwrap(), b"not encrypted");

        let invalid_json = seal(b"not json").unwrap();
        fs::write(&path, &invalid_json).unwrap();
        assert!(store.try_load(Service::Epic).is_err());
        assert!(store.list().is_err());
        assert_eq!(fs::read(&path).unwrap(), invalid_json);
        assert_eq!(fs::read(dir.join("xbox.bin")).unwrap(), healthy_bytes);

        // Explicit sign-out can still remove an unavailable saved record.
        store.invalidate(Service::Epic).unwrap();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_temporarily_locked_file_remains_signed_in_when_it_becomes_readable() {
        use std::os::windows::fs::OpenOptionsExt;
        let (store, dir) = store();
        let login = KeptLogin::new("synthetic-refresh-token".into(), None);
        store.save(Service::Xbox, &login).unwrap();
        let path = dir.join("xbox.bin");
        let saved_bytes = fs::read(&path).unwrap();
        let summaries = store.list().unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(store.try_load(Service::Xbox).is_err());
        assert!(store.list().is_err());
        drop(held);
        assert_eq!(fs::read(&path).unwrap(), saved_bytes);
        assert_eq!(store.list().unwrap(), summaries);
        assert_eq!(store.try_load(Service::Xbox).unwrap(), Some(login));
        store.delete(Service::Xbox).unwrap();
        assert_eq!(store.try_load(Service::Xbox).unwrap(), None);
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

        let list = store.list().unwrap();
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
