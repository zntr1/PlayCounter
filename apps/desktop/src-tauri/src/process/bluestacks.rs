//! BlueStacks 5 runs Android in a VM. Windows only sees `HD-Player.exe`, and
//! neither its window title nor its command line names the game. HD-Player
//! writes one line to `Player.log` for every activity Android shows, with its
//! own PID and the app's package, so a PID's newest such line is the app in
//! front. The instance's `AppCache.json` adds the app's name and Play
//! category.

use super::ForegroundApp;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex, PoisonError},
    time::SystemTime,
};

/// One read takes the end of the log, this much at most. The log grows by
/// about 2 MB per hour.
const MAX_LOG_READ_BYTES: u64 = 8 * 1024 * 1024;
/// A real app list is a few KB.
const MAX_APP_LIST_BYTES: u64 = 1024 * 1024;
const LAUNCHED: &str = "Player state : launched";
const ACTIVITY: &str = "plrOnActivityDisplayedHcall: package: ";

struct Player {
    instance: Option<String>,
    package: String,
}

#[derive(Clone, Default)]
struct AppInfo {
    label: Option<String>,
    category: Option<String>,
}

struct AppList {
    modified: Option<SystemTime>,
    apps: HashMap<String, AppInfo>,
}

#[derive(Default)]
pub struct Reader {
    /// Where the next read of Player.log starts.
    offset: u64,
    /// The players with an activity line, by PID.
    players: HashMap<u32, Player>,
    /// AppCache.json as last read, by instance.
    app_lists: HashMap<String, AppList>,
}

impl Reader {
    /// The app each of the running players shows, by PID. A player without an
    /// activity line (yet) is left out.
    pub fn foreground_apps(
        &mut self,
        log_dir: &Path,
        data_dir: &Path,
        pids: &[u32],
    ) -> HashMap<u32, ForegroundApp> {
        self.read_log(&log_dir.join("Player.log"));
        self.players.retain(|pid, _| pids.contains(pid));
        let shown = self
            .players
            .iter()
            .map(|(pid, player)| (*pid, player.instance.clone(), player.package.clone()))
            .collect::<Vec<_>>();
        shown
            .into_iter()
            .map(|(pid, instance, package)| {
                let info = instance
                    .and_then(|instance| self.app_info(data_dir, &instance, &package))
                    .unwrap_or_default();
                let app = ForegroundApp {
                    package,
                    label: info.label,
                    category: info.category,
                };
                (pid, app)
            })
            .collect()
    }

    /// Reads what BlueStacks wrote since the last read. A file smaller than
    /// before is a new one and is read from its start.
    fn read_log(&mut self, log: &Path) {
        let Ok(mut file) = File::open(log) else {
            return;
        };
        let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
            return;
        };
        if length < self.offset {
            self.offset = 0;
        }
        if length == self.offset {
            return;
        }
        let start = self.offset.max(length.saturating_sub(MAX_LOG_READ_BYTES));
        // A read that skips ahead starts somewhere in a line. Starting one
        // byte early and dropping everything up to the first line break
        // leaves whole lines, including one that begins exactly at `start`.
        let skipped = start > self.offset;
        let from = if skipped { start - 1 } else { start };
        let mut bytes = Vec::new();
        if file.seek(SeekFrom::Start(from)).is_err()
            || file.take(length - from).read_to_end(&mut bytes).is_err()
        {
            return;
        }
        let mut lines = &bytes[..];
        if skipped {
            let Some(line_break) = lines.iter().position(|byte| *byte == b'\n') else {
                self.offset = length;
                return;
            };
            lines = &lines[line_break + 1..];
        }
        let lines_from = from + (bytes.len() - lines.len()) as u64;
        // BlueStacks may be in the middle of writing the last line.
        let Some(last_break) = lines.iter().rposition(|byte| *byte == b'\n') else {
            self.offset = lines_from;
            return;
        };
        self.offset = lines_from + last_break as u64 + 1;
        // The log holds bytes that are no UTF-8.
        for line in String::from_utf8_lossy(&lines[..last_break]).lines() {
            self.read_line(line);
        }
    }

    fn read_line(&mut self, line: &str) {
        let Some((pid, instance, message)) = parse_line(line) else {
            return;
        };
        if message.starts_with("main:") && message.contains(LAUNCHED) {
            // A new player. Whatever an older process with this PID showed
            // is over.
            self.players.remove(&pid);
            return;
        }
        let package = message
            .strip_prefix(ACTIVITY)
            .and_then(|rest| rest.split_whitespace().next())
            .filter(|package| is_package(package));
        if let Some(package) = package {
            self.players.insert(
                pid,
                Player {
                    instance: instance
                        .filter(|name| is_instance_name(name))
                        .map(str::to_string),
                    package: package.to_string(),
                },
            );
        }
    }

    /// The app's entry in `<data>\<instance>\AppCache\AppCache.json`. The
    /// file is read again only when its modified time changes.
    fn app_info(&mut self, data_dir: &Path, instance: &str, package: &str) -> Option<AppInfo> {
        let path = data_dir
            .join(instance)
            .join("AppCache")
            .join("AppCache.json");
        let metadata = fs::metadata(&path).ok()?;
        let modified = metadata.modified().ok();
        let known = self
            .app_lists
            .get(instance)
            .is_some_and(|list| list.modified == modified);
        if !known {
            let apps = if metadata.len() <= MAX_APP_LIST_BYTES {
                parse_app_list(&fs::read(&path).ok()?)
            } else {
                HashMap::new()
            };
            self.app_lists
                .insert(instance.to_string(), AppList { modified, apps });
        }
        self.app_lists.get(instance)?.apps.get(package).cloned()
    }
}

/// `<date> <time> <pid> <thread> <tag> [<instance>] [<state>] <level>: <message>`.
/// A player's first lines have no instance.
fn parse_line(line: &str) -> Option<(u32, Option<&str>, &str)> {
    let mut rest = line;
    let mut field = || {
        let (field, tail) = rest.trim_start().split_once(char::is_whitespace)?;
        rest = tail;
        Some(field)
    };
    if !field()?.starts_with(|first: char| first.is_ascii_digit()) {
        return None;
    }
    field()?;
    let pid = field()?.parse().ok()?;
    field()?;
    field()?;
    let mut state = field()?;
    let mut instance = None;
    if !state.starts_with('[') {
        instance = Some(state);
        state = field()?;
    }
    if !state.starts_with('[') {
        return None;
    }
    field()?;
    Some((pid, instance, rest.trim_start()))
}

fn is_package(value: &str) -> bool {
    value.len() <= 255
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'.')
}

/// Instance names are folder names below the data folder (`Nougat32`,
/// `Pie64_1`). Anything else must not become part of a path.
fn is_instance_name(value: &str) -> bool {
    value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn parse_app_list(json: &[u8]) -> HashMap<String, AppInfo> {
    let text = |entry: &serde_json::Value, key: &str| {
        let value = entry.get(key)?.as_str()?.trim();
        (!value.is_empty() && value.chars().count() <= 120).then(|| value.to_string())
    };
    serde_json::from_slice::<Vec<serde_json::Value>>(json)
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| {
            let info = AppInfo {
                label: text(entry, "appLabel"),
                category: text(entry, "category"),
            };
            Some((entry.get("package")?.as_str()?.to_string(), info))
        })
        .collect()
}

/// The app each running BlueStacks player (`HD-Player.exe`) shows, by PID.
pub fn foreground_apps(pids: &[u32]) -> HashMap<u32, ForegroundApp> {
    static READER: LazyLock<Mutex<Reader>> = LazyLock::new(Mutex::default);
    let (log_dir, data_dir) = folders();
    READER
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .foreground_apps(&log_dir, &data_dir, pids)
}

/// BlueStacks' log and data folders: from its registry key, else where it
/// puts them by default.
fn folders() -> (PathBuf, PathBuf) {
    let default =
        PathBuf::from(std::env::var_os("ProgramData").unwrap_or_else(|| r"C:\ProgramData".into()))
            .join("BlueStacks_nxt");
    (
        registry_folder("LogDir").unwrap_or_else(|| default.join("Logs")),
        registry_folder("DataDir").unwrap_or_else(|| default.join("Engine")),
    )
}

fn registry_folder(name: &str) -> Option<PathBuf> {
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
    };
    let wide = |value: &str| value.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let key = wide(r"SOFTWARE\BlueStacks_nxt");
    let name = wide(name);
    let mut text = [0_u16; 1024];
    let mut size = std::mem::size_of_val(&text) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            text.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let length = text.iter().position(|unit| *unit == 0).unwrap_or(0);
    let folder = String::from_utf16_lossy(&text[..length]);
    (!folder.trim().is_empty()).then(|| PathBuf::from(folder.trim()))
}

#[cfg(test)]
mod tests {
    use super::Reader;
    use crate::process::ForegroundApp;
    use std::{
        fs::{self, File, OpenOptions},
        io::Write,
        path::{Path, PathBuf},
    };

    // Lines of a real Player.log (BlueStacks 5.22.290, instance Nougat32).
    // 10228 was a hidden warm-up player, 29836 the one the user saw.
    const WARMUP_GAMECENTER: &str = "2026-11-10 22:04:39.216+0200 10228 32464 PLR    Nougat32 [Stopping] I: plrOnActivityDisplayedHcall: package: com.bluestacks.gamecenter activity:  callingPackage: ";
    const LAUNCHED: &str = "2026-11-10 22:04:44.289+0200 29836 9736  PLR    [Initializing] I: main: #################### Player state : launched with args: '--instance Nougat32 --cmd installApp --store  --package  --appname  ' by Parent PID 10160";
    const HOME: &str = "2026-11-10 22:04:50.436+0200 29836 30044 PLR    Nougat32 [StartingAndroid] I: plrOnActivityDisplayedHcall: package: com.uncube.launcher3 activity: com.bluestacks.launcher.activity.HomeActivity callingPackage: ";
    const CATEGORY: &str = "2026-11-10 22:07:00.376+0200 29836 2020  PLR    Nougat32 [Ready] I: Category for package: com.kiloo.subwaysurf category:Arcade";
    const CALLBACK: &str = "2026-11-10 22:07:02.448+0200 29836 31940 HCALL  Nougat32 [Ready] I: hcallOnActivityDisplayedClbk : package = com.kiloo.subwaysurf activity = com.sybogames.chili.multidex.ChiliMultidexSupportActivity callingPackage = com.uncube.launcher3";
    const SUBWAY: &str = "2026-11-10 22:11:01.768+0200 29836 30044 PLR    Nougat32 [Ready] I: plrOnActivityDisplayedHcall: package: com.kiloo.subwaysurf activity: com.sybogames.chili.multidex.ChiliMultidexSupportActivity callingPackage: com.uncube.launcher3";
    const RECENTS: &str = "2026-11-10 22:11:06.761+0200 29836 30044 PLR    Nougat32 [Ready] I: plrOnActivityDisplayedHcall: package: com.android.systemui activity: com.android.systemui.recents.RecentsActivity callingPackage: com.android.systemui";
    // The real line has bytes that are no UTF-8 after "attemptId : PU".
    const INSTALL_STATS: &[u8] = b"2026-11-10 22:07:00.207+0200 29836 30044 CLD    Nougat32 [Ready] I: Sending App Install Stats app_name : Subway Surf app_pkg : com.kiloo.subwaysurf version_code : 97327 source : local-apk isUpdate : 0 attemptId : PU\x12\x95\xc0\x02 versionName :3.71.0 packageInstallerName : com.bluestacks.BstCommandProcessor";
    // The real AppCache.json of that instance.
    const APP_CACHE: &str = r#"[
    {
        "activity": "com.sybogames.chili.multidex.ChiliMultidexSupportActivity",
        "appLabel": "Subway Surf",
        "category": "Arcade",
        "iconFileName": "com.kiloo.subwaysurf.png",
        "installDate": "10.11.2026",
        "isFirstLaunch": false,
        "isFullScreen": false,
        "isGameControlsToogleHintShown": true,
        "isHomeApp": false,
        "orientation": "",
        "package": "com.kiloo.subwaysurf",
        "versionCode": 97327,
        "versionName": "3.71.0"
    }
]
"#;
    const PLAYER: u32 = 29836;
    const WARMUP: u32 = 10228;

    /// A BlueStacks folder with `Logs` and `Engine`, gone when dropped.
    struct Folders(PathBuf);

    impl Folders {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "playcounter-bluestacks-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(dir.join("Logs")).unwrap();
            fs::create_dir_all(dir.join("Engine")).unwrap();
            Self(dir)
        }

        fn logs(&self) -> PathBuf {
            self.0.join("Logs")
        }

        fn engine(&self) -> PathBuf {
            self.0.join("Engine")
        }

        fn log(&self) -> PathBuf {
            self.logs().join("Player.log")
        }

        fn append(&self, bytes: &[u8]) {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.log())
                .unwrap()
                .write_all(bytes)
                .unwrap();
        }

        fn append_lines(&self, lines: &[&str]) {
            for line in lines {
                self.append(format!("{line}\n").as_bytes());
            }
        }

        fn app_cache(&self, instance: &str) -> PathBuf {
            let dir = self.engine().join(instance).join("AppCache");
            fs::create_dir_all(&dir).unwrap();
            dir.join("AppCache.json")
        }

        fn package(&self, reader: &mut Reader, pid: u32) -> Option<String> {
            self.app(reader, pid).map(|app| app.package)
        }

        fn app(&self, reader: &mut Reader, pid: u32) -> Option<ForegroundApp> {
            reader
                .foreground_apps(&self.logs(), &self.engine(), &[PLAYER, WARMUP])
                .remove(&pid)
        }
    }

    impl Drop for Folders {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn set_modified(path: &Path, modified: std::time::SystemTime) {
        File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(modified)
            .unwrap();
    }

    #[test]
    fn the_newest_activity_line_of_a_player_is_its_app() {
        let folders = Folders::new("activity");
        let mut reader = Reader::default();
        folders.append_lines(&[LAUNCHED, HOME]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.uncube.launcher3")
        );
        folders.append_lines(&[SUBWAY]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );
        folders.append_lines(&[RECENTS]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.android.systemui")
        );
    }

    #[test]
    fn a_player_without_an_activity_line_has_no_app() {
        let folders = Folders::new("none");
        let mut reader = Reader::default();
        // No log at all.
        assert_eq!(folders.app(&mut reader, PLAYER), None);
        folders.append_lines(&[LAUNCHED]);
        assert_eq!(folders.app(&mut reader, PLAYER), None);
    }

    #[test]
    fn lines_of_another_player_do_not_change_this_one() {
        let folders = Folders::new("pids");
        let mut reader = Reader::default();
        folders.append_lines(&[SUBWAY, WARMUP_GAMECENTER]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );
        assert_eq!(
            folders.package(&mut reader, WARMUP).as_deref(),
            Some("com.bluestacks.gamecenter")
        );
    }

    #[test]
    fn only_the_activity_line_names_the_app() {
        let folders = Folders::new("other-lines");
        let mut reader = Reader::default();
        // Both lines name Subway Surfers, neither says it is in front.
        folders.append_lines(&[HOME, CATEGORY, CALLBACK]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.uncube.launcher3")
        );
    }

    #[test]
    fn a_launched_line_forgets_the_app_of_a_reused_pid() {
        let folders = Folders::new("launched");
        let mut reader = Reader::default();
        folders.append_lines(&[SUBWAY]);
        assert!(folders.package(&mut reader, PLAYER).is_some());
        folders.append_lines(&[LAUNCHED]);
        assert_eq!(folders.app(&mut reader, PLAYER), None);
        // Also when both lines arrive in one read.
        let mut fresh = Reader::default();
        assert_eq!(folders.app(&mut fresh, PLAYER), None);
    }

    #[test]
    fn a_player_that_no_longer_runs_is_forgotten() {
        let folders = Folders::new("gone");
        let mut reader = Reader::default();
        folders.append_lines(&[SUBWAY]);
        assert!(folders.package(&mut reader, PLAYER).is_some());
        // The player closed, and nothing new is in the log.
        assert!(reader
            .foreground_apps(&folders.logs(), &folders.engine(), &[WARMUP])
            .is_empty());
        // Windows gave the PID to a new player that has no line yet.
        assert_eq!(folders.app(&mut reader, PLAYER), None);
    }

    #[test]
    fn reads_only_what_is_new_since_the_last_read() {
        let folders = Folders::new("offset");
        let mut reader = Reader::default();
        folders.append_lines(&[SUBWAY]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );
        // As many bytes with another package: read again, it would win.
        let other = SUBWAY.replace("com.kiloo.subwaysurf", "com.rovio.angrybirds");
        assert_eq!(other.len(), SUBWAY.len());
        fs::write(folders.log(), format!("{other}\n")).unwrap();
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );
        folders.append_lines(&[HOME]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.uncube.launcher3")
        );
    }

    #[test]
    fn waits_for_the_rest_of_a_half_written_line() {
        let folders = Folders::new("partial");
        let mut reader = Reader::default();
        // Cut where the written half looks like a whole package.
        let (head, tail) = SUBWAY.split_at(SUBWAY.find(".subwaysurf").unwrap());
        assert!(head.ends_with("package: com.kiloo"));
        folders.append_lines(&[HOME]);
        folders.append(head.as_bytes());
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.uncube.launcher3")
        );
        folders.append(format!("{tail}\n").as_bytes());
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );
    }

    #[test]
    fn starts_over_when_the_file_got_smaller() {
        let folders = Folders::new("rotated");
        let mut reader = Reader::default();
        folders.append_lines(&[LAUNCHED, HOME, CATEGORY, CALLBACK]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.uncube.launcher3")
        );
        // BlueStacks started a new, shorter log.
        fs::write(folders.log(), format!("{SUBWAY}\n")).unwrap();
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );
    }

    #[test]
    fn the_first_read_covers_the_last_8_mb_only() {
        const EIGHT_MB: usize = 8 * 1024 * 1024;
        let filler = format!("{CATEGORY}\n");
        let size = |folders: &Folders| fs::metadata(folders.log()).unwrap().len() as usize;

        // The game's line lies more than 8 MB before the end.
        let old = Folders::new("cap-old");
        old.append_lines(&[SUBWAY]);
        old.append(filler.repeat(EIGHT_MB.div_ceil(filler.len())).as_bytes());
        assert_eq!(old.app(&mut Reader::default(), PLAYER), None);

        // Here it is the first line of the last 8 MB.
        let first = Folders::new("cap-first");
        first.append_lines(&[HOME, SUBWAY]);
        let rest = EIGHT_MB - SUBWAY.len() - 1;
        first.append(filler.repeat(rest / filler.len() - 1).as_bytes());
        let last_line = "x".repeat(rest % filler.len() + filler.len() - 1);
        first.append(format!("{last_line}\n").as_bytes());
        assert_eq!(size(&first), HOME.len() + 1 + EIGHT_MB);
        assert_eq!(
            first.package(&mut Reader::default(), PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );

        // And here the last 8 MB begin in the middle of its line.
        let cut = Folders::new("cap-cut");
        cut.append_lines(&[HOME, SUBWAY]);
        cut.append(filler.repeat((EIGHT_MB - 1) / filler.len()).as_bytes());
        let start = size(&cut) - EIGHT_MB;
        assert!(start > HOME.len() + 1 && start < HOME.len() + 1 + SUBWAY.len());
        assert_eq!(cut.app(&mut Reader::default(), PLAYER), None);
    }

    #[test]
    fn reads_lines_after_bytes_that_are_no_utf8() {
        let folders = Folders::new("bytes");
        let mut reader = Reader::default();
        folders.append(INSTALL_STATS);
        folders.append(b"\n");
        folders.append_lines(&[SUBWAY]);
        assert_eq!(
            folders.package(&mut reader, PLAYER).as_deref(),
            Some("com.kiloo.subwaysurf")
        );
    }

    #[test]
    fn adds_name_and_category_from_the_instances_app_list() {
        let folders = Folders::new("app-cache");
        let mut reader = Reader::default();
        fs::write(folders.app_cache("Nougat32"), APP_CACHE).unwrap();
        folders.append_lines(&[SUBWAY]);
        assert_eq!(
            folders.app(&mut reader, PLAYER),
            Some(ForegroundApp {
                package: "com.kiloo.subwaysurf".to_string(),
                label: Some("Subway Surf".to_string()),
                category: Some("Arcade".to_string()),
            })
        );
        // The home screen is not in the list.
        folders.append_lines(&[HOME]);
        assert_eq!(
            folders.app(&mut reader, PLAYER),
            Some(ForegroundApp {
                package: "com.uncube.launcher3".to_string(),
                label: None,
                category: None,
            })
        );
    }

    #[test]
    fn an_app_without_a_list_entry_has_only_its_package() {
        let folders = Folders::new("no-app-cache");
        let mut reader = Reader::default();
        folders.append_lines(&[SUBWAY]);
        // No AppCache.json at all.
        assert_eq!(
            folders.app(&mut reader, PLAYER),
            Some(ForegroundApp {
                package: "com.kiloo.subwaysurf".to_string(),
                label: None,
                category: None,
            })
        );
        // A list that is no JSON, and one of more than 1 MB.
        fs::write(folders.app_cache("Nougat32"), "[{").unwrap();
        assert_eq!(folders.app(&mut reader, PLAYER).unwrap().label, None);
        fs::write(
            folders.app_cache("Nougat32"),
            format!("{}{}", APP_CACHE, " ".repeat(1024 * 1024)),
        )
        .unwrap();
        assert_eq!(
            folders.app(&mut Reader::default(), PLAYER).unwrap().label,
            None
        );
    }

    #[test]
    fn reads_the_app_list_again_only_when_its_modified_time_changes() {
        let folders = Folders::new("app-cache-time");
        let mut reader = Reader::default();
        let path = folders.app_cache("Nougat32");
        fs::write(&path, APP_CACHE).unwrap();
        let written = fs::metadata(&path).unwrap().modified().unwrap();
        folders.append_lines(&[SUBWAY]);
        assert_eq!(
            folders.app(&mut reader, PLAYER).unwrap().label.as_deref(),
            Some("Subway Surf")
        );

        fs::write(&path, APP_CACHE.replace("Subway Surf", "Subway Surfers")).unwrap();
        set_modified(&path, written);
        assert_eq!(
            folders.app(&mut reader, PLAYER).unwrap().label.as_deref(),
            Some("Subway Surf")
        );

        set_modified(&path, written + std::time::Duration::from_secs(2));
        assert_eq!(
            folders.app(&mut reader, PLAYER).unwrap().label.as_deref(),
            Some("Subway Surfers")
        );
    }

    #[test]
    fn an_instance_name_never_leaves_the_data_folder() {
        let folders = Folders::new("instance");
        let mut reader = Reader::default();
        // The list sits one folder above the data folder.
        fs::create_dir_all(folders.0.join("AppCache")).unwrap();
        fs::write(folders.0.join("AppCache").join("AppCache.json"), APP_CACHE).unwrap();
        folders.append_lines(&[&SUBWAY.replace("Nougat32", "..")]);
        assert_eq!(
            folders.app(&mut reader, PLAYER),
            Some(ForegroundApp {
                package: "com.kiloo.subwaysurf".to_string(),
                label: None,
                category: None,
            })
        );
    }
}
