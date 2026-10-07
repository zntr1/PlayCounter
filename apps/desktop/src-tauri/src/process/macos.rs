use super::{ProcessScanner, ProcessSnapshot};
use async_trait::async_trait;
use std::{collections::BTreeMap, error::Error};
use sysinfo::{get_current_pid, ProcessesToUpdate, System};

pub struct MacOsScanner;

pub fn create_scanner() -> Box<dyn ProcessScanner> {
    Box::new(MacOsScanner)
}

#[async_trait]
impl ProcessScanner for MacOsScanner {
    async fn scan(&self) -> Result<Vec<ProcessSnapshot>, Box<dyn Error + Send + Sync>> {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let current_user = get_current_pid()
            .ok()
            .and_then(|pid| system.process(pid))
            .and_then(|process| process.user_id().cloned());
        let mut processes = BTreeMap::new();
        for process in system.processes().values() {
            let exe_path = process.exe().map(|path| path.to_string_lossy().to_string());
            let owned_by_user = current_user
                .as_ref()
                .is_none_or(|user| process.user_id() == Some(user));
            if !may_be_game(owned_by_user, exe_path.as_deref()) {
                continue;
            }
            let exe_name = exe_path
                .as_deref()
                .and_then(|exe_path_value| exe_path_value.rsplit('/').next())
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| process.name().to_string_lossy().to_string());
            if exe_name.is_empty() {
                continue;
            }

            processes
                .entry(process.pid().as_u32())
                .or_insert(ProcessSnapshot {
                    exe_name,
                    exe_path,
                    pid: process.pid().as_u32(),
                    started_at_unix: process.start_time(),
                    emulator_id: None,
                    command_line: None,
                    working_directory: None,
                    window_title: None,
                    open_files: None,
                });
        }

        Ok(processes.into_values().collect())
    }
}

/// Whether a discovery cached by an older scan belongs to a process this
/// scanner now skips. Every process of the user has a readable path, so a
/// cached entry without one came from another user's process.
pub fn never_a_game(exe_path: Option<&str>) -> bool {
    exe_path.is_none_or(|path| !may_be_game(true, Some(path)))
}

/// Hundreds of processes on a Mac can never be a game, and listing them would
/// bury the few that might be. Games run as the signed-in user, never from
/// the read-only system volume (SIP: /System, /usr, /bin, /sbin, /Library/Apple;
/// /usr/local is the user's) or the folders macOS installs privileged helpers
/// and system extensions into, and an app's main program lives in its own
/// Contents/MacOS, not among the helpers, extensions and services an app
/// bundle carries elsewhere in Contents or inside a framework.
fn may_be_game(owned_by_user: bool, exe_path: Option<&str>) -> bool {
    const SYSTEM_DIRS: [&str; 7] = [
        "/System/",
        "/usr/",
        "/bin/",
        "/sbin/",
        "/Library/Apple/",
        "/Library/PrivilegedHelperTools/",
        "/Library/SystemExtensions/",
    ];
    const BUNDLE_HELPER_DIRS: [&str; 7] = [
        ".app/Contents/Frameworks/",
        ".app/Contents/Helpers/",
        ".app/Contents/XPCServices/",
        ".app/Contents/PlugIns/",
        ".app/Contents/Extensions/",
        ".app/Contents/Library/",
        ".framework/",
    ];

    if !owned_by_user {
        return false;
    }
    let Some(path) = exe_path else {
        return true;
    };
    let system =
        SYSTEM_DIRS.iter().any(|dir| path.starts_with(dir)) && !path.starts_with("/usr/local/");
    !system && !BUNDLE_HELPER_DIRS.iter().any(|dir| path.contains(dir))
}

#[cfg(test)]
mod tests {
    use super::{may_be_game, never_a_game};

    #[test]
    fn forgets_cached_discoveries_the_scanner_now_skips() {
        assert!(never_a_game(None));
        assert!(never_a_game(Some("/usr/libexec/trustd")));
        assert!(!never_a_game(Some(
            "/Applications/Stardew Valley.app/Contents/MacOS/Stardew Valley"
        )));
    }

    #[test]
    fn keeps_games_and_apps() {
        for path in [
            "/Users/me/Library/Application Support/Steam/steamapps/common/Celeste/Celeste.app/Contents/MacOS/Celeste",
            "/Applications/Stardew Valley.app/Contents/MacOS/Stardew Valley",
            "/Users/me/Applications/Game.app/Contents/MacOS/Game",
            "/Users/me/Games/doom/gzdoom",
            "/usr/local/bin/dosbox",
            "/opt/homebrew/bin/scummvm",
            "/Applications/Discord.app/Contents/MacOS/Discord",
        ] {
            assert!(may_be_game(true, Some(path)), "{path}");
        }
        assert!(may_be_game(true, None));
    }

    #[test]
    fn skips_other_users_and_system_programs() {
        assert!(!may_be_game(
            false,
            Some("/Applications/Game.app/Contents/MacOS/Game")
        ));
        assert!(!may_be_game(false, None));
        for path in [
            "/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock",
            "/System/Applications/Chess.app/Contents/MacOS/Chess",
            "/usr/libexec/trustd",
            "/usr/sbin/cfprefsd",
            "/bin/zsh",
            "/sbin/launchd",
            "/Library/Apple/System/Library/CoreServices/XProtect.app/Contents/MacOS/XProtect",
            "/Library/PrivilegedHelperTools/com.docker.vmnetd",
            "/Library/SystemExtensions/0000/org.example.driver.dext/org.example.driver",
        ] {
            assert!(!may_be_game(true, Some(path)), "{path}");
        }
    }

    #[test]
    fn skips_helpers_inside_app_bundles() {
        for path in [
            "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)",
            "/Applications/Discord.app/Contents/Frameworks/Discord Helper.app/Contents/MacOS/Discord Helper",
            "/Applications/Microsoft Teams.app/Contents/XPCServices/notifications.xpc/Contents/MacOS/notifications",
            "/Applications/OneDrive.app/Contents/PlugIns/OneDrive File Provider.appex/Contents/MacOS/OneDrive File Provider",
            "/Applications/Raycast.app/Contents/Extensions/RaycastAppIntents.appex/Contents/MacOS/RaycastAppIntents",
            "/Applications/FortiTray.app/Contents/Library/LaunchServices/com.fortinet.helper",
            "/Applications/Microsoft Teams.app/Contents/Helpers/Microsoft Teams ModuleHost.app/Contents/MacOS/Microsoft Teams ModuleHost",
        ] {
            assert!(!may_be_game(true, Some(path)), "{path}");
        }
    }
}
