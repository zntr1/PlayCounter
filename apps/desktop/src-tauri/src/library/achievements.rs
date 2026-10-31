//! A game's Steam achievements, read from Steam's own files on this PC:
//! `appcache/stats/UserGameStatsSchema_<app>.bin` holds the list in every
//! language, `UserGameStats_<account>_<app>.bin` what the account unlocked.
//! Read only: no Steam API key, no sign-in, works offline. Answers are status
//! codes, never sentences; the desktop words them.
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{collections::HashMap, fs::File, io::Read, path::Path, time::Duration};

const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_RARITY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ACHIEVEMENTS: usize = 10_000;
const MAX_DEPTH: usize = 32;
const MAX_NODES: usize = 400_000;
const MAX_TEXT: usize = 4_000;
const ICON_BASE: &str = "https://shared.steamstatic.com/community_assets/images/apps";
/// Steam's language names for the texts in its files.
const STEAM_LANGUAGES: [&str; 8] = [
    "english",
    "german",
    "french",
    "spanish",
    "brazilian",
    "polish",
    "russian",
    "schinese",
];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievement {
    id: String,
    name: String,
    description: String,
    hidden: bool,
    unlocked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    unlocked_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locked_icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<Progress>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Progress {
    current: f64,
    target: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievementList {
    achievements: Vec<SteamAchievement>,
    /// False when Steam has the game's list but no file for the account:
    /// everything reads as locked, which may not be the whole truth.
    has_player_stats: bool,
}

/// One entry of Steam's public list. It is newer than the file on this PC
/// when a game got achievements after it last ran here.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAchievement {
    id: String,
    name: String,
    description: String,
    hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locked_icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    global_percent: Option<f64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SteamAchievementRead {
    Ok(SteamAchievementList),
    /// No Steam installation found.
    NoSteam,
    /// Steam never saved this game's list here (not started on this PC).
    NoSchema,
    /// The list exists and has no achievements.
    NoAchievements,
    /// A file is broken, too big or in a format this reader doesn't know.
    Unreadable,
}

#[tauri::command]
pub async fn steam_read_achievements(
    app_id: String,
    account_id: Option<u32>,
    language: String,
) -> Result<SteamAchievementRead, String> {
    let Some(app_id) = parse_app_id(&app_id) else {
        return Ok(SteamAchievementRead::NoSchema);
    };
    let language = steam_language(&language);
    tauri::async_runtime::spawn_blocking(move || {
        let (root, _) = super::steam::find_steam_root();
        let Some(root) = root else {
            return SteamAchievementRead::NoSteam;
        };
        // The import's account first; without one, the account Steam used last.
        let account_id = account_id.or_else(|| {
            super::steam::accounts()
                .ok()?
                .first()
                .map(|account| account.account_id)
        });
        read_list(
            &root.join("appcache").join("stats"),
            app_id,
            account_id,
            language,
        )
    })
    .await
    .map_err(|error| error.to_string())
}

/// Steam's public list of a game's achievements (no API key): texts in the
/// player's language, icons, and the share of players who have each one.
/// The webview can't ask: Steam sends no CORS header.
#[tauri::command]
pub async fn steam_achievement_catalog(
    app_id: String,
    language: String,
) -> Result<Vec<CatalogAchievement>, String> {
    let app_id = parse_app_id(&app_id).ok_or("app")?;
    let language = steam_language(&language);
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("PlayCounter")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "client")?;
    let response = client
        .get(format!(
            "https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid={app_id}&language={language}"
        ))
        .send()
        .await
        .map_err(|_| "offline")?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_RARITY_BYTES)
    {
        return Err("unavailable".into());
    }
    let bytes = response.bytes().await.map_err(|_| "offline")?;
    if bytes.len() as u64 > MAX_RARITY_BYTES {
        return Err("unavailable".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "unavailable")?;
    Ok(parse_catalog(&value, app_id))
}

fn parse_catalog(value: &Value, app_id: u32) -> Vec<CatalogAchievement> {
    let mut ids = std::collections::HashSet::new();
    value
        .get("response")
        .and_then(|response| response.get("achievements"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|achievement| {
            let id = achievement
                .get("internal_name")?
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 256)?;
            // Retired achievements can't be earned any more.
            if flag(achievement.get("archived")) || !ids.insert(id) {
                return None;
            }
            let name = localized(achievement.get("localized_name"), "english");
            Some(CatalogAchievement {
                id: id.to_string(),
                name: if name.is_empty() {
                    id.to_string()
                } else {
                    name
                },
                description: localized(achievement.get("localized_desc"), "english"),
                hidden: flag(achievement.get("hidden")),
                icon_url: icon(app_id, achievement.get("icon")),
                locked_icon_url: icon(app_id, achievement.get("icon_gray")),
                global_percent: achievement
                    .get("player_percent_unlocked")
                    .and_then(number)
                    .filter(|percent| (0.0..=100.0).contains(percent)),
            })
        })
        .take(MAX_ACHIEVEMENTS)
        .collect()
}

fn parse_app_id(value: &str) -> Option<u32> {
    value.parse::<u32>().ok().filter(|id| *id > 0)
}

fn steam_language(value: &str) -> &'static str {
    STEAM_LANGUAGES
        .into_iter()
        .find(|language| *language == value)
        .unwrap_or("english")
}

fn read_list(
    stats: &Path,
    app_id: u32,
    account_id: Option<u32>,
    language: &str,
) -> SteamAchievementRead {
    let schema = match read_bounded(&stats.join(format!("UserGameStatsSchema_{app_id}.bin"))) {
        Ok(Some(bytes)) => match parse_kv(&bytes) {
            Ok(value) => value,
            Err(Unreadable) => return SteamAchievementRead::Unreadable,
        },
        Ok(None) => return SteamAchievementRead::NoSchema,
        Err(Unreadable) => return SteamAchievementRead::Unreadable,
    };
    let player = match account_id {
        Some(account) => {
            match read_bounded(&stats.join(format!("UserGameStats_{account}_{app_id}.bin"))) {
                Ok(Some(bytes)) => match parse_kv(&bytes) {
                    Ok(value) => Some(value),
                    Err(Unreadable) => return SteamAchievementRead::Unreadable,
                },
                Ok(None) => None,
                Err(Unreadable) => return SteamAchievementRead::Unreadable,
            }
        }
        None => None,
    };
    normalize(&schema, player.as_ref(), app_id, language)
}

fn normalize(
    schema: &Value,
    player: Option<&Value>,
    app_id: u32,
    language: &str,
) -> SteamAchievementRead {
    let Some(groups) = schema
        .get(app_id.to_string())
        .and_then(|game| game.get("stats"))
        .and_then(Value::as_object)
    else {
        return SteamAchievementRead::NoAchievements;
    };
    let cache = player.and_then(|player| player.get("cache"));
    // Progress rules point at a stat by name; the player's value sits under
    // that stat's group id.
    let stat_values: HashMap<&str, f64> = groups
        .iter()
        .filter_map(|(group_id, group)| {
            let name = group.get("name")?.as_str()?;
            let is_int = match group.get("type")? {
                Value::String(kind) => kind.eq_ignore_ascii_case("int"),
                kind => kind.as_u64() == Some(1),
            };
            let value = cache?.get(group_id)?.get("data")?.as_f64()?;
            is_int.then_some((name, value))
        })
        .collect();
    let mut achievements = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for (group_id, group) in groups {
        let Some(bits) = group.get("bits").and_then(Value::as_object) else {
            continue;
        };
        let player_group = cache.and_then(|cache| cache.get(group_id));
        let mask = player_group
            .and_then(|group| group.get("data"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        for (bit_id, definition) in bits {
            let Some(bit) = bit_id.parse::<u32>().ok().filter(|bit| *bit < 32) else {
                return SteamAchievementRead::Unreadable;
            };
            let Some(id) = definition
                .get("name")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= 256)
            else {
                return SteamAchievementRead::Unreadable;
            };
            if !ids.insert(id) {
                continue;
            }
            let display = definition.get("display").unwrap_or(&Value::Null);
            let unlocked = mask & (1u64 << bit) != 0;
            let unlocked_at = unlocked
                .then(|| {
                    player_group?
                        .get("AchievementTimes")?
                        .get(bit_id)?
                        .as_u64()
                        .filter(|time| *time > 0)
                        .map(|time| time * 1000)
                })
                .flatten();
            let progress = (!unlocked && player.is_some())
                .then(|| progress(definition.get("progress")?, &stat_values))
                .flatten();
            let name = localized(display.get("name"), language);
            achievements.push(SteamAchievement {
                id: id.to_string(),
                name: if name.is_empty() {
                    id.to_string()
                } else {
                    name
                },
                description: localized(display.get("desc"), language),
                hidden: flag(display.get("hidden")),
                unlocked,
                unlocked_at,
                icon_url: icon(app_id, display.get("icon")),
                locked_icon_url: icon(app_id, display.get("icon_gray")),
                progress,
            });
            if achievements.len() > MAX_ACHIEVEMENTS {
                return SteamAchievementRead::Unreadable;
            }
        }
    }
    if achievements.is_empty() {
        return SteamAchievementRead::NoAchievements;
    }
    SteamAchievementRead::Ok(SteamAchievementList {
        achievements,
        has_player_stats: player.is_some(),
    })
}

fn progress(rule: &Value, stat_values: &HashMap<&str, f64>) -> Option<Progress> {
    let value = rule.get("value")?;
    if value.get("operation")?.as_str()? != "statvalue" {
        return None;
    }
    let stat = value.get("operand1")?.as_str()?;
    let target = number(rule.get("max_val")?)?;
    if !(target > 0.0 && target.is_finite()) {
        return None;
    }
    let current = stat_values.get(stat).copied().unwrap_or(0.0);
    Some(Progress {
        current: current.clamp(0.0, target),
        target,
    })
}

/// The player's language, else English, else any text but Steam's token.
fn localized(value: Option<&Value>, language: &str) -> String {
    let usable = |text: &&str| !text.trim().is_empty();
    let text = match value {
        Some(Value::String(text)) => Some(text.as_str()),
        Some(Value::Object(texts)) => texts
            .get(language)
            .and_then(Value::as_str)
            .filter(usable)
            .or_else(|| texts.get("english").and_then(Value::as_str).filter(usable))
            .or_else(|| {
                texts
                    .iter()
                    .filter(|(key, _)| key.as_str() != "token")
                    .find_map(|(_, text)| text.as_str().filter(usable))
            }),
        _ => None,
    };
    text.unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_TEXT)
        .collect()
}

fn flag(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(value)) => *value,
        Some(Value::String(value)) => value.trim() == "1",
        Some(value) => value.as_u64().is_some_and(|value| value != 0),
        None => false,
    }
}

fn number(value: &Value) -> Option<f64> {
    match value {
        Value::String(text) => text.trim().parse::<f64>().ok(),
        value => value.as_f64(),
    }
    .filter(|value| value.is_finite())
}

fn icon(app_id: u32, value: Option<&Value>) -> Option<String> {
    let file = value?.as_str()?;
    let safe = !file.is_empty()
        && file.len() <= 128
        && !file.starts_with('.')
        && !file.contains("..")
        && file
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    safe.then(|| format!("{ICON_BASE}/{app_id}/{file}"))
}

/// Any problem with a file. Never shown: it becomes the "unreadable" status.
#[derive(Debug, PartialEq)]
struct Unreadable;

fn read_bounded(path: &Path) -> Result<Option<Vec<u8>>, Unreadable> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Unreadable),
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Unreadable)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(Unreadable);
    }
    Ok(Some(bytes))
}

/// Steam's binary key-values: a type byte, a NUL-terminated key, the value.
fn parse_kv(bytes: &[u8]) -> Result<Value, Unreadable> {
    KvParser {
        bytes,
        cursor: 0,
        nodes: 0,
    }
    .object(0)
}

struct KvParser<'a> {
    bytes: &'a [u8],
    cursor: usize,
    nodes: usize,
}

impl KvParser<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], Unreadable> {
        let end = self.cursor.checked_add(N).ok_or(Unreadable)?;
        let slice = self.bytes.get(self.cursor..end).ok_or(Unreadable)?;
        self.cursor = end;
        slice.try_into().map_err(|_| Unreadable)
    }

    fn string(&mut self) -> Result<String, Unreadable> {
        let rest = self.bytes.get(self.cursor..).ok_or(Unreadable)?;
        let length = rest
            .iter()
            .position(|byte| *byte == 0)
            .filter(|length| *length <= 64_000)
            .ok_or(Unreadable)?;
        let text = String::from_utf8_lossy(&rest[..length]).into_owned();
        self.cursor += length + 1;
        Ok(text)
    }

    fn wide_string(&mut self) -> Result<String, Unreadable> {
        let mut units = Vec::new();
        loop {
            let unit = u16::from_le_bytes(self.take::<2>()?);
            if unit == 0 {
                return Ok(String::from_utf16_lossy(&units));
            }
            if units.len() >= 64_000 {
                return Err(Unreadable);
            }
            units.push(unit);
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value, Unreadable> {
        if depth > MAX_DEPTH {
            return Err(Unreadable);
        }
        let mut object = Map::new();
        loop {
            let kind = self.take::<1>()?[0];
            if kind == 8 || kind == 11 {
                return Ok(Value::Object(object));
            }
            self.nodes += 1;
            if self.nodes > MAX_NODES {
                return Err(Unreadable);
            }
            let key = self.string()?;
            let value = match kind {
                0 => self.object(depth + 1)?,
                1 => Value::String(self.string()?),
                // Unsigned on purpose: achievement masks use all 32 bits.
                2 | 4 | 6 => json!(u32::from_le_bytes(self.take::<4>()?)),
                3 => json!(f32::from_le_bytes(self.take::<4>()?)),
                5 => Value::String(self.wide_string()?),
                7 => json!(u64::from_le_bytes(self.take::<8>()?)),
                10 => json!(i64::from_le_bytes(self.take::<8>()?)),
                _ => return Err(Unreadable),
            };
            object.insert(key, value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(read: SteamAchievementRead) -> SteamAchievementList {
        match read {
            SteamAchievementRead::Ok(list) => list,
            other => panic!("expected a list, got {other:?}"),
        }
    }

    fn find<'a>(list: &'a SteamAchievementList, id: &str) -> &'a SteamAchievement {
        list.achievements
            .iter()
            .find(|achievement| achievement.id == id)
            .unwrap()
    }

    /// Writes JSON objects, strings and unsigned integers as Steam's binary
    /// key-values.
    fn encode(value: &Value, out: &mut Vec<u8>) {
        for (key, value) in value.as_object().unwrap() {
            match value {
                Value::Object(_) => {
                    out.push(0);
                    out.extend(key.as_bytes());
                    out.push(0);
                    encode(value, out);
                }
                Value::String(text) => {
                    out.push(1);
                    out.extend(key.as_bytes());
                    out.push(0);
                    out.extend(text.as_bytes());
                    out.push(0);
                }
                value => {
                    out.push(2);
                    out.extend(key.as_bytes());
                    out.push(0);
                    out.extend((value.as_u64().unwrap() as u32).to_le_bytes());
                }
            }
        }
        out.push(8);
    }

    fn binary(value: Value) -> Vec<u8> {
        let mut out = Vec::new();
        encode(&value, &mut out);
        out
    }

    fn schema() -> Value {
        json!({"42": {"gamename": "Test", "stats": {
            "1": {"type": "ACHIEVEMENTS", "bits": {
                "0": {"name": "FIRST", "display": {
                    "name": {"english": "The Fool", "german": "Der Narr", "token": "T"},
                    "desc": {"english": "Become a mercenary.", "german": "Werde zum Söldner."},
                    "hidden": 0,
                    "icon": "42d64a86.jpg",
                    "icon_gray": "cd7fc82d.jpg"}},
                "31": {"name": "SECRET", "display": {
                    "name": {"english": "Rare"}, "desc": {"english": "Hidden one."}, "hidden": 1}},
                "2": {"name": "TOOLS", "display": {"name": {"english": "All tools"}},
                    "progress": {"min_val": 0, "max_val": 51,
                        "value": {"operation": "statvalue", "operand1": "ALL_TOOLS_STAT"}}}
            }},
            "4": {"type": "INT", "name": "ALL_TOOLS_STAT", "max": 51}
        }}})
    }

    fn player() -> Value {
        json!({"cache": {
            "crc": 715570739,
            "1": {"data": 2147483648u64, "AchievementTimes": {"31": 1234, "0": 999}},
            "4": {"data": 42}
        }})
    }

    #[test]
    fn bit_31_unlocks_and_times_belong_to_unlocked_achievements_only() {
        let list = list(normalize(&schema(), Some(&player()), 42, "english"));
        let secret = find(&list, "SECRET");
        assert!(secret.unlocked);
        assert_eq!(secret.unlocked_at, Some(1_234_000));
        assert!(secret.hidden);
        let first = find(&list, "FIRST");
        assert!(!first.unlocked);
        assert_eq!(first.unlocked_at, None);
        assert!(!first.hidden);
        assert!(list.has_player_stats);
    }

    #[test]
    fn texts_come_in_the_app_language_then_english() {
        let german = list(normalize(&schema(), Some(&player()), 42, "german"));
        assert_eq!(find(&german, "FIRST").name, "Der Narr");
        assert_eq!(find(&german, "FIRST").description, "Werde zum Söldner.");
        // No German text: English, never the token.
        assert_eq!(find(&german, "SECRET").name, "Rare");
        let polish_only = json!({"42": {"stats": {"1": {"bits": {"0": {"name": "ONLY",
            "display": {"name": {"token": "TOKEN", "polish": "Głupiec"}}}}}}}});
        assert_eq!(
            find(&list(normalize(&polish_only, None, 42, "french")), "ONLY").name,
            "Głupiec"
        );
        let nameless = json!({"42": {"stats": {"1": {"bits": {"0": {"name": "API_NAME"}}}}}});
        assert_eq!(
            find(&list(normalize(&nameless, None, 42, "english")), "API_NAME").name,
            "API_NAME"
        );
    }

    #[test]
    fn progress_comes_from_the_int_stat_it_names() {
        let list = list(normalize(&schema(), Some(&player()), 42, "english"));
        assert_eq!(
            find(&list, "TOOLS").progress,
            Some(Progress {
                current: 42.0,
                target: 51.0
            })
        );
        // Unlocked rows and rows without a rule have none.
        assert_eq!(find(&list, "SECRET").progress, None);
        assert_eq!(find(&list, "FIRST").progress, None);
    }

    #[test]
    fn icons_point_at_steams_image_server() {
        let list = list(normalize(&schema(), None, 42, "english"));
        let first = find(&list, "FIRST");
        assert_eq!(
            first.icon_url.as_deref(),
            Some("https://shared.steamstatic.com/community_assets/images/apps/42/42d64a86.jpg")
        );
        assert_eq!(
            first.locked_icon_url.as_deref(),
            Some("https://shared.steamstatic.com/community_assets/images/apps/42/cd7fc82d.jpg")
        );
        assert_eq!(icon(42, Some(&json!("../evil.jpg"))), None);
        assert_eq!(icon(42, Some(&json!("a/b.jpg"))), None);
    }

    #[test]
    fn without_a_player_file_everything_reads_locked_without_progress() {
        let list = list(normalize(&schema(), None, 42, "english"));
        assert!(!list.has_player_stats);
        assert!(list.achievements.iter().all(|a| !a.unlocked));
        assert!(list.achievements.iter().all(|a| a.progress.is_none()));
    }

    #[test]
    fn a_list_without_achievements_says_so() {
        let stats_only = json!({"42": {"stats": {"4": {"type": "INT", "name": "KILLS"}}}});
        assert_eq!(
            normalize(&stats_only, None, 42, "english"),
            SteamAchievementRead::NoAchievements
        );
        assert_eq!(
            normalize(&json!({"7": {}}), None, 42, "english"),
            SteamAchievementRead::NoAchievements
        );
    }

    #[test]
    fn bits_past_31_make_the_file_unreadable() {
        let bad = json!({"42": {"stats": {"1": {"bits": {"32": {"name": "X"}}}}}});
        assert_eq!(
            normalize(&bad, None, 42, "english"),
            SteamAchievementRead::Unreadable
        );
    }

    #[test]
    fn reads_the_files_from_disk() {
        let dir = std::env::temp_dir().join(format!(
            "playcounter-steam-achievements-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(
            read_list(&dir, 42, Some(7), "english"),
            SteamAchievementRead::NoSchema
        );
        std::fs::write(dir.join("UserGameStatsSchema_42.bin"), binary(schema())).unwrap();
        let without_player = list(read_list(&dir, 42, Some(7), "german"));
        assert!(!without_player.has_player_stats);
        assert_eq!(find(&without_player, "FIRST").name, "Der Narr");
        std::fs::write(dir.join("UserGameStats_7_42.bin"), binary(player())).unwrap();
        let with_player = list(read_list(&dir, 42, Some(7), "english"));
        assert!(find(&with_player, "SECRET").unlocked);
        // Another account's file is never read.
        assert!(!list(read_list(&dir, 42, Some(8), "english")).has_player_stats);
        std::fs::write(dir.join("UserGameStats_7_42.bin"), [0u8, b'a']).unwrap();
        assert_eq!(
            read_list(&dir, 42, Some(7), "english"),
            SteamAchievementRead::Unreadable
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn truncated_unknown_and_too_deep_files_fail_closed() {
        assert_eq!(parse_kv(&[0, b'a', 0]), Err(Unreadable));
        assert_eq!(parse_kv(&[55, b'a', 0, 8]), Err(Unreadable));
        assert_eq!(parse_kv(&[2, b'a', 0, 1, 2]), Err(Unreadable));
        assert_eq!(parse_kv(&[0, b'a', 0].repeat(40)), Err(Unreadable));
        assert_eq!(parse_kv(&[0, b'a', 0, 8, 8]).unwrap(), json!({"a": {}}));
        assert_eq!(
            parse_kv(&[2, b'a', 0, 255, 255, 255, 255, 8]).unwrap()["a"],
            u32::MAX
        );
        // UTF-16 text (type 5).
        assert_eq!(
            parse_kv(&[5, b'w', 0, b'h', 0, b'i', 0, 0, 0, 8]).unwrap()["w"],
            "hi"
        );
    }

    #[test]
    fn the_public_list_brings_texts_icons_and_share_of_players() {
        let catalog = parse_catalog(
            &json!({"response": {"achievements": [
                {"internal_name": "FIRST", "localized_name": "Der Narr",
                 "localized_desc": "Werde zum Söldner.", "icon": "0abc.jpg",
                 "icon_gray": "5ae7.jpg", "hidden": false,
                 "player_percent_unlocked": "74.0", "archived": false},
                {"internal_name": "SECRET", "localized_name": "", "hidden": true,
                 "player_percent_unlocked": "0.3"},
                {"internal_name": "BROKEN", "player_percent_unlocked": "lots"},
                {"internal_name": "OVER", "player_percent_unlocked": "101"},
                {"internal_name": "RETIRED", "archived": true},
                {"internal_name": "FIRST", "localized_name": "Duplicate"}
            ]}}),
            42,
        );
        assert_eq!(
            catalog.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["FIRST", "SECRET", "BROKEN", "OVER"]
        );
        assert_eq!(
            catalog[0],
            CatalogAchievement {
                id: "FIRST".into(),
                name: "Der Narr".into(),
                description: "Werde zum Söldner.".into(),
                hidden: false,
                icon_url: Some(
                    "https://shared.steamstatic.com/community_assets/images/apps/42/0abc.jpg"
                        .into()
                ),
                locked_icon_url: Some(
                    "https://shared.steamstatic.com/community_assets/images/apps/42/5ae7.jpg"
                        .into()
                ),
                global_percent: Some(74.0),
            }
        );
        // No name: the id. Hidden flag kept. Bad or impossible % dropped.
        assert_eq!(catalog[1].name, "SECRET");
        assert!(catalog[1].hidden);
        assert_eq!(catalog[1].global_percent, Some(0.3));
        assert_eq!(catalog[2].global_percent, None);
        assert_eq!(catalog[3].global_percent, None);
        assert!(parse_catalog(&json!({}), 42).is_empty());
    }

    #[test]
    fn unknown_languages_fall_back_to_english() {
        assert_eq!(steam_language("german"), "german");
        assert_eq!(steam_language("klingon"), "english");
        assert_eq!(steam_language("../x"), "english");
    }

    #[test]
    #[ignore = "Reads every Steam achievement file on this PC, read only"]
    fn every_local_steam_file_reads() {
        let (root, _) = super::super::steam::find_steam_root();
        let stats = root
            .expect("Steam installed")
            .join("appcache")
            .join("stats");
        let account = super::super::steam::accounts()
            .ok()
            .and_then(|accounts| accounts.first().map(|account| account.account_id));
        let mut lists = 0;
        let mut unlocked = 0;
        for entry in std::fs::read_dir(&stats).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(app) = name
                .strip_prefix("UserGameStatsSchema_")
                .and_then(|rest| rest.strip_suffix(".bin"))
            else {
                continue;
            };
            match read_list(&stats, app.parse().unwrap(), account, "german") {
                SteamAchievementRead::Ok(list) => {
                    lists += 1;
                    unlocked += list.achievements.iter().filter(|a| a.unlocked).count();
                }
                SteamAchievementRead::NoAchievements => {}
                other => panic!("app {app}: {other:?}"),
            }
        }
        println!("{lists} games with achievements, {unlocked} unlocked, read without changes.");
        assert!(lists > 0);
    }
}
