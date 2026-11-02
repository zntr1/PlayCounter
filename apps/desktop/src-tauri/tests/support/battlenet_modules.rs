// Compile the real Battle.net and encrypted-store modules in isolated test
// executables. Epic revocation is deliberately unavailable in these fixtures.
#[allow(dead_code)]
#[path = "../../src/library/battlenet_account.rs"]
pub mod battlenet_account;
#[allow(dead_code)]
#[path = "../../src/library/battlenet_cookies.rs"]
pub mod battlenet_cookies;
#[allow(dead_code)]
#[path = "../../src/library/kept_logins.rs"]
pub mod kept_logins;
#[allow(dead_code)]
#[path = "../../src/library/login_status.rs"]
pub mod login_status;

#[allow(dead_code)]
mod epic_account {
    pub async fn check_saved_login(_: &tauri::AppHandle) -> super::login_status::LoginStatus {
        panic!("Battle.net fixtures must never check Epic sessions");
    }

    pub fn cancel_active(_: &tauri::AppHandle) {
        panic!("Battle.net fixtures must never cancel Epic sessions");
    }

    pub async fn end_kept_session(_: &str) {
        panic!("Battle.net fixtures must never revoke Epic sessions");
    }
}

#[allow(dead_code)]
mod xbox_login {
    pub async fn check_saved_login(
        _: &tauri::AppHandle,
        _: &str,
    ) -> super::login_status::LoginStatus {
        panic!("Battle.net fixtures must never check Xbox sessions");
    }
}

#[allow(dead_code)]
mod gog_account {
    pub async fn check_saved_login(_: &tauri::AppHandle) -> super::login_status::LoginStatus {
        panic!("Battle.net fixtures must never check GOG sessions");
    }

    pub fn cancel_active(_: &tauri::AppHandle) {
        panic!("Battle.net fixtures must never cancel GOG sessions");
    }
}

#[allow(dead_code)]
mod playstation_account {
    pub async fn check_saved_login(_: &tauri::AppHandle) -> super::login_status::LoginStatus {
        panic!("Battle.net fixtures must never check PlayStation sessions");
    }

    pub fn cancel_active(_: &tauri::AppHandle) {
        panic!("Battle.net fixtures must never cancel PlayStation sessions");
    }
}
