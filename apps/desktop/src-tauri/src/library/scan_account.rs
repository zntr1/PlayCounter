use serde::Serialize;

/// The launcher account a scan read, as the web UI may know it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanAccount {
    /// SHA-256 of "<launcher>:<account id>", 32 hex characters: the id itself
    /// never leaves Rust. Our server makes Xbox's the same way.
    pub key: String,
    /// The name the launcher shows, when this read has it.
    pub name: Option<String>,
}

impl ScanAccount {
    pub fn new(launcher: &str, account_id: &str, name: Option<&str>) -> Self {
        let digest = ring::digest::digest(
            &ring::digest::SHA256,
            format!("{launcher}:{account_id}").as_bytes(),
        );
        Self {
            key: digest.as_ref()[..16]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
            name: name
                .map(|name| name.trim().chars().take(64).collect::<String>())
                .filter(|name| !name.is_empty()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_accounts_key_is_made_from_its_id_like_our_servers_xbox_key() {
        // The expected keys were made with Node's crypto, as our server makes
        // Xbox's: sha256("<launcher>:<id>"), first 32 hex characters.
        let account = ScanAccount::new("steam", "12345", Some(" zesarex "));
        assert_eq!(account.key, "a08abd5b779f542093ed25f6a2859de2");
        assert_eq!(account.name.as_deref(), Some("zesarex"));
        assert_eq!(
            ScanAccount::new("xbox", "123", None).key,
            "e9862bda2c3b1ffda98b77d4e53a26a0"
        );
        // The same id on another launcher is another account.
        assert_ne!(ScanAccount::new("epic", "12345", None).key, account.key);
        assert_eq!(ScanAccount::new("gog", "1", Some("  ")).name, None);
    }
}
