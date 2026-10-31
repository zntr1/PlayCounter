//! Non-secret results of checking a saved launcher session without opening UI.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoginStatus {
    Valid,
    NeedsSignIn,
    Unavailable,
    SignedOut,
    Busy,
}
