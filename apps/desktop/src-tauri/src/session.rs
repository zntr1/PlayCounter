use std::sync::OnceLock;
use uuid::Uuid;

static INSTALL_UUID: OnceLock<String> = OnceLock::new();

pub fn install_uuid() -> String {
    INSTALL_UUID
        .get_or_init(|| Uuid::new_v4().to_string())
        .clone()
}
