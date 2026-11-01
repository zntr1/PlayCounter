//! A game's Epic Games achievements, read with the kept Epic sign-in.
//!
//! Epic has no public API for a player's achievements. Like Playnite's
//! SuccessStory, PlayCounter asks Epic's store GraphQL as the Epic Games
//! Launcher: the store answers every other client with a bot check, even
//! signed in. Phil 2026-11-01: players read their own achievements with their
//! own sign-in. Nothing more: when Epic shows the bot check anyway,
//! PlayCounter says so and stops. No captcha solving, no other hosts or
//! headers.
//!
//! Answers are status codes, never sentences; the desktop words them. Tokens
//! and the account id never leave Rust, and nothing goes to PlayCounter's
//! server.
use super::epic_account::{
    finish_authentication, http_client, read_records, renew, LibraryRecord, Token, TokenFailure,
    AUTHENTICATING,
};
use super::kept_logins::{KeptLogin, Service, Store};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    time::Duration,
};
use tauri::{AppHandle, WebviewWindow};

const GRAPHQL_URL: &str = "https://launcher.store.epicgames.com/graphql";
/// What the Epic Games Launcher (and SuccessStory) send to the store.
const LAUNCHER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) EpicGamesLauncher";
const LIST_QUERY: &str = "query Achievement($SandboxId: String!, $Locale: String!) { Achievement { productAchievementsRecordBySandbox(sandboxId: $SandboxId, locale: $Locale) { achievements { achievement { name hidden XP unlockedDisplayName unlockedDescription unlockedIconLink lockedIconLink rarity { percent } } } } } }";
const UNLOCKS_QUERY: &str = "query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) { PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) { records { playerAchievements { playerAchievement { achievementName unlocked unlockDate } } } } } }";
/// Epic's locales for the app's languages (see epic.ts).
const LOCALES: [&str; 8] = ["en-US", "de", "fr", "es-ES", "pt-BR", "pl", "ru", "zh-CN"];
const ENGLISH: &str = "en-US";
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_ACHIEVEMENTS: usize = 10_000;
const MAX_TEXT: usize = 4_000;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpicAchievement {
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
    global_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    xp: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum EpicAchievementRead {
    Ok {
        achievements: Vec<EpicAchievement>,
    },
    /// No Epic sign-in is kept on this PC.
    NoLogin,
    /// Epic refused the kept sign-in (now gone) or wants the account looked at.
    NeedsSignIn,
    /// The signed-in account has no such game.
    NotInAccount,
    NoAchievements,
    /// Epic's bot check, or the store refused the request.
    Blocked,
    /// Epic didn't answer properly, or this PC couldn't ask.
    Unavailable,
}

/// What the store answered to one question.
#[derive(Debug, PartialEq)]
enum Answer {
    /// JSON. `data` is null when Epic sent only errors.
    Json {
        data: Value,
        errors: bool,
    },
    Blocked,
    Unavailable,
}

/// One entry of a game's list, before the player's unlocks join it.
#[derive(Debug, PartialEq)]
struct ListEntry {
    id: String,
    name: String,
    description: String,
    hidden: bool,
    xp: Option<u64>,
    icon_url: Option<String>,
    locked_icon_url: Option<String>,
    global_percent: Option<f64>,
}

#[tauri::command]
pub async fn epic_read_achievements(
    app: AppHandle,
    window: WebviewWindow,
    app_name: String,
    language: String,
) -> Result<EpicAchievementRead, String> {
    if window.label() != "main" {
        return Err("main window only".into());
    }
    if !cfg!(windows) {
        return Ok(EpicAchievementRead::NoLogin);
    }
    if !super::epic::valid_id(&app_name) {
        return Ok(EpicAchievementRead::NotInAccount);
    }
    let Ok(store) = Store::of(&app) else {
        return Ok(EpicAchievementRead::Unavailable);
    };
    let login = match store.try_load(Service::Epic) {
        Ok(Some(login)) => login,
        Ok(None) => return Ok(EpicAchievementRead::NoLogin),
        // An unreadable file doesn't prove the sign-in expired.
        Err(_) => return Ok(EpicAchievementRead::Unavailable),
    };
    let (Ok(client), Ok(store_client)) = (http_client(), store_client()) else {
        return Ok(EpicAchievementRead::Unavailable);
    };
    // Same rule as the import: never redeem the kept token concurrently, and
    // save a rotated one before anything else happens.
    let token = {
        let _guard = AUTHENTICATING.lock().await;
        let response = renew(&client, &login.secret).await;
        match finish_sign_in(&store, &client, &login, response).await {
            Ok(token) => token,
            Err(read) => return Ok(read),
        }
    };
    let Ok((records, truncated)) = read_records(&client, &token).await else {
        return Ok(EpicAchievementRead::Unavailable);
    };
    let read = read_game(
        &records,
        truncated,
        &app_name,
        &token.account_id,
        epic_locale(&language),
        |body| ask(&store_client, &token, body),
    )
    .await;
    // Signed out meanwhile: that account's answer is not shown.
    if !store.is_current(Service::Epic) {
        return Ok(EpicAchievementRead::NoLogin);
    }
    Ok(read)
}

/// Asks with the launcher's user agent. Redirects stay unfollowed: the bot
/// check answers with one, and the token must not travel along. Built after
/// `http_client`, which sets up TLS.
fn store_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .user_agent(LAUNCHER_USER_AGENT)
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

async fn ask(client: &reqwest::Client, token: &Token, body: Value) -> Answer {
    let Ok(response) = client
        .post(GRAPHQL_URL)
        .bearer_auth(&token.access_token)
        .json(&body)
        .send()
        .await
    else {
        return Answer::Unavailable;
    };
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        return Answer::Unavailable;
    }
    match response.bytes().await {
        Ok(bytes) => answer(status, &bytes),
        Err(_) => Answer::Unavailable,
    }
}

/// The renewed sign-in, or why there is none. A confirmed refusal has
/// already ended the kept sign-in, as in the import.
async fn finish_sign_in(
    store: &Store,
    client: &reqwest::Client,
    login: &KeptLogin,
    response: Result<Token, TokenFailure>,
) -> Result<Token, EpicAchievementRead> {
    let action_required = matches!(response, Err(TokenFailure::ActionRequired(_)));
    match finish_authentication(store, client, Some(login), async { response }).await {
        Ok(Some(token)) => Ok(token),
        Ok(None) => Err(EpicAchievementRead::NeedsSignIn),
        Err(_) if action_required => Err(EpicAchievementRead::NeedsSignIn),
        Err(_) if !store.is_current(Service::Epic) => Err(EpicAchievementRead::NoLogin),
        Err(_) => Err(EpicAchievementRead::Unavailable),
    }
}

fn epic_locale(language: &str) -> &'static str {
    LOCALES
        .into_iter()
        .find(|locale| *locale == language)
        .unwrap_or(ENGLISH)
}

/// Sorts the store's answer. Its bot check redirects to a captcha page; 401
/// and 403 refuse the token.
fn answer(status: u16, body: &[u8]) -> Answer {
    if (300..400).contains(&status) || status == 401 || status == 403 {
        return Answer::Blocked;
    }
    if status >= 500 || status == 429 || body.len() > MAX_BODY_BYTES {
        return Answer::Unavailable;
    }
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(mut answer)) => Answer::Json {
            errors: answer
                .get("errors")
                .and_then(Value::as_array)
                .is_some_and(|errors| !errors.is_empty()),
            data: answer.remove("data").unwrap_or(Value::Null),
        },
        _ if String::from_utf8_lossy(body)
            .to_ascii_lowercase()
            .contains("captcha") =>
        {
            Answer::Blocked
        }
        _ => Answer::Unavailable,
    }
}

/// Unix ms from Epic's ISO 8601 time, such as "2026-10-31T18:24:07.123Z"
/// (what SuccessStory reads). None for anything else or before 1970.
fn unlock_time(text: &str) -> Option<u64> {
    let digits = |part: &str| -> Option<i64> {
        (!part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| part.parse().ok())
            .flatten()
    };
    let bytes = text.as_bytes();
    if !text.is_ascii()
        || bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let (year, month, day) = (
        digits(&text[0..4])?,
        digits(&text[5..7])?,
        digits(&text[8..10])?,
    );
    let (hour, minute, second) = (
        digits(&text[11..13])?,
        digits(&text[14..16])?,
        digits(&text[17..19])?,
    );
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut rest = &text[19..];
    let mut millis = 0;
    if let Some(fraction) = rest.strip_prefix('.') {
        let length = fraction.bytes().take_while(u8::is_ascii_digit).count();
        let first = &fraction[..length.min(3)];
        millis = digits(first)? * 10_i64.pow(3 - first.len() as u32);
        rest = &fraction[length..];
    }
    let offset_minutes = match rest {
        "Z" => 0,
        _ if rest.len() == 6 && rest.as_bytes()[3] == b':' => {
            let minutes = digits(&rest[1..3])? * 60 + digits(&rest[4..6])?;
            match rest.as_bytes()[0] {
                b'+' => minutes,
                b'-' => -minutes,
                _ => return None,
            }
        }
        _ => return None,
    };
    // Days since 1970-01-01 (Howard Hinnant's days_from_civil).
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = shifted.div_euclid(400);
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let days = era * 146_097 + year_of_era * 365 + year_of_era / 4 - year_of_era / 100
        + day_of_year
        - 719_468;
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60;
    let unix_ms = seconds * 1_000 + millis;
    (unix_ms > 0).then_some(unix_ms as u64)
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_TEXT)
        .collect()
}

/// An icon address; the desktop keeps only Epic's own hosts.
fn link(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .filter(|link| link.starts_with("https://") && link.len() <= 2048)
        .map(str::to_owned)
}

/// The game's list, or None when Epic sent no record for it.
fn list_entries(data: &Value) -> Option<Vec<ListEntry>> {
    let entries = data
        .pointer("/Achievement/productAchievementsRecordBySandbox/achievements")?
        .as_array()?;
    let mut ids = HashSet::new();
    Some(
        entries
            .iter()
            .filter_map(|entry| {
                let item = entry.get("achievement")?;
                let id = item
                    .get("name")?
                    .as_str()
                    .filter(|id| !id.is_empty() && id.len() <= 256)?;
                if !ids.insert(id) {
                    return None;
                }
                let name = text(item.get("unlockedDisplayName"));
                Some(ListEntry {
                    id: id.to_owned(),
                    name: if name.is_empty() { id.to_owned() } else { name },
                    description: text(item.get("unlockedDescription")),
                    hidden: item.get("hidden").and_then(Value::as_bool) == Some(true),
                    xp: item.get("XP").and_then(Value::as_u64),
                    icon_url: link(item.get("unlockedIconLink")),
                    locked_icon_url: link(item.get("lockedIconLink")),
                    global_percent: item
                        .pointer("/rarity/percent")
                        .and_then(Value::as_f64)
                        .filter(|percent| (0.0..=100.0).contains(percent)),
                })
            })
            .take(MAX_ACHIEVEMENTS)
            .collect(),
    )
}

/// Unlock times by achievement name, for unlocked rows. None when Epic sent
/// no records: that is not "nothing unlocked".
fn unlock_times(data: &Value) -> Option<HashMap<String, Option<u64>>> {
    let records = data
        .pointer("/PlayerAchievement/playerAchievementGameRecordsBySandbox/records")?
        .as_array()?;
    let mut unlocks = HashMap::new();
    for row in records
        .iter()
        .filter_map(|record| record.get("playerAchievements")?.as_array())
        .flatten()
    {
        let Some(item) = row.get("playerAchievement") else {
            continue;
        };
        let Some(name) = item.get("achievementName").and_then(Value::as_str) else {
            continue;
        };
        if item.get("unlocked").and_then(Value::as_bool) == Some(true) {
            let time = item
                .get("unlockDate")
                .and_then(Value::as_str)
                .and_then(unlock_time);
            unlocks.entry(name.to_owned()).or_insert(time);
        }
    }
    Some(unlocks)
}

/// The list in the player's language, then what the player unlocked.
async fn read_game<F, Fut>(
    records: &[LibraryRecord],
    truncated: bool,
    app_name: &str,
    account_id: &str,
    locale: &str,
    ask: F,
) -> EpicAchievementRead
where
    F: Fn(Value) -> Fut,
    Fut: Future<Output = Answer>,
{
    let Some(namespace) = records
        .iter()
        .find(|record| {
            record.app_name == app_name
                && record.namespace != "ue"
                && super::epic::valid_id(&record.namespace)
        })
        .map(|record| record.namespace.as_str())
    else {
        // A library Epic cut short may hold the game further on.
        return if truncated {
            EpicAchievementRead::Unavailable
        } else {
            EpicAchievementRead::NotInAccount
        };
    };
    let locales: &[&str] = if locale == ENGLISH {
        &[ENGLISH]
    } else {
        &[locale, ENGLISH]
    };
    let list = 'list: {
        for (index, locale) in locales.iter().enumerate() {
            let question = json!({
                "query": LIST_QUERY,
                "variables": { "SandboxId": namespace, "Locale": locale },
            });
            match ask(question).await {
                Answer::Json { data, errors } => {
                    if let Some(entries) = list_entries(&data) {
                        break 'list entries;
                    }
                    // The errors may be about the language: one more try in
                    // English.
                    if errors && index + 1 < locales.len() {
                        continue;
                    }
                    // Epic answered without a record for the game.
                    return if data.is_object() {
                        EpicAchievementRead::NoAchievements
                    } else {
                        EpicAchievementRead::Unavailable
                    };
                }
                Answer::Blocked => return EpicAchievementRead::Blocked,
                Answer::Unavailable => return EpicAchievementRead::Unavailable,
            }
        }
        return EpicAchievementRead::Unavailable;
    };
    if list.is_empty() {
        return EpicAchievementRead::NoAchievements;
    }
    let question = json!({
        "query": UNLOCKS_QUERY,
        "variables": { "epicAccountId": account_id, "sandboxId": namespace },
    });
    let unlocks = match ask(question).await {
        Answer::Json { data, .. } => match unlock_times(&data) {
            Some(unlocks) => unlocks,
            None => return EpicAchievementRead::Unavailable,
        },
        Answer::Blocked => return EpicAchievementRead::Blocked,
        Answer::Unavailable => return EpicAchievementRead::Unavailable,
    };
    EpicAchievementRead::Ok {
        achievements: list
            .into_iter()
            .map(|entry| {
                let unlock = unlocks.get(&entry.id);
                EpicAchievement {
                    unlocked: unlock.is_some(),
                    unlocked_at: unlock.copied().flatten(),
                    id: entry.id,
                    name: entry.name,
                    description: entry.description,
                    hidden: entry.hidden,
                    icon_url: entry.icon_url,
                    locked_icon_url: entry.locked_icon_url,
                    global_percent: entry.global_percent,
                    xp: entry.xp,
                }
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex};

    /// Epic's real answer for Rocket League on 2026-11-01 (app name "Sugar"),
    /// trimmed to 3 of its 88 achievements.
    const ROCKET_LEAGUE_LIST: &str = r##"{"data":{"Achievement":{"productAchievementsRecordBySandbox":{"productId":"e6bcca5b37d0457ca881aec508205542","sandboxId":"9773aa1aa54f4f7b80e44bef04986cea","totalAchievements":88,"totalProductXP":1000,"achievementSets":[{"achievementSetId":"db8gc6i","isBase":true,"totalAchievements":88,"totalXP":1000}],"platinumRarity":{"percent":0.1},"achievements":[{"achievement":{"name":"0","hidden":false,"isBase":true,"achievementSetId":"db8gc6i","unlockedDisplayName":"Virtuoso","lockedDisplayName":"Virtuoso","unlockedDescription":"Unlock All Original Achievements","lockedDescription":"Unlock All Original Achievements","XP":100,"unlockedIconLink":"https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons/c6d1f088e2529eef0d25854228ef6d56","lockedIconLink":"https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons/89599f95e0e80c184826f4c563956cf7","tier":{"name":"gold","hexColor":"#FFE83C","min":96,"max":200},"rarity":{"percent":0.1}}},{"achievement":{"name":"1","hidden":false,"isBase":true,"achievementSetId":"db8gc6i","unlockedDisplayName":"Stocked","lockedDisplayName":"Stocked","unlockedDescription":"Collect 150 Items","lockedDescription":"Collect 150 Items","XP":50,"unlockedIconLink":"https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons/d4ecb934e2415a74c66f75c49fee22ee","lockedIconLink":"https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons/4b370970a13bf6933ed19baf50373115","tier":{"name":"silver","hexColor":"#AFB4BD","min":46,"max":95},"rarity":{"percent":35}}},{"achievement":{"name":"10","hidden":false,"isBase":true,"achievementSetId":"db8gc6i","unlockedDisplayName":"Grease Monkey","lockedDisplayName":"Grease Monkey","unlockedDescription":"Customize the Decal, Topper, Rocket Boost and Wheel on a car","lockedDescription":"Customize the Decal, Topper, Rocket Boost and Wheel on a car","XP":15,"unlockedIconLink":"https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons/b60dfccbaa22d80ce451bdf8c6133638","lockedIconLink":"https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons/200d123c8c5dc9f1dcb3a24ffd802fa3","tier":{"name":"bronze","hexColor":"#CA512B","min":0,"max":45},"rarity":{"percent":13}}}]}}}}"##;
    /// The bot check Epic sent PlayCounter's own user agent on 2026-11-01.
    const CAPTCHA: &str = r#"<html>
<head><title>302 Found</title><script src="https://js.hcaptcha.com/1/api.js?render=explicit&uj=true" async defer></script></head>
<body>
<center><h1>302 Found</h1></center>
</body>
</html>"#;
    const ROCKET_LEAGUE: &str = "9773aa1aa54f4f7b80e44bef04986cea";
    const ACCOUNT_ID: &str = "4f3c2b1a09e8d7c6b5a4f3e2d1c0b9a8";
    const ICONS: &str = "https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons";

    /// The account's library as Epic's library service lists it.
    fn library() -> Vec<LibraryRecord> {
        serde_json::from_str(&format!(
            r#"[{{"namespace":"ue","catalogItemId":"u1","appName":"Marketplace","sandboxType":"PUBLIC"}},
               {{"namespace":"{ROCKET_LEAGUE}","catalogItemId":"9773a1","appName":"Sugar","productId":"e6bcca5b37d0457ca881aec508205542","sandboxType":"PUBLIC","recordType":"APPLICATION"}},
               {{"namespace":"jaguar","catalogItemId":"j1","appName":"Jaguar","sandboxType":"PUBLIC","recordType":"APPLICATION"}}]"#
        ))
        .unwrap()
    }

    fn json_answer(text: &str) -> Answer {
        answer(200, text.as_bytes())
    }

    /// No unlocked row has been seen live yet (Phil has none): a written
    /// example in the shape of SuccessStory's model of this query.
    fn unlocks(rows: &str) -> Answer {
        json_answer(&format!(
            r#"{{"data":{{"PlayerAchievement":{{"playerAchievementGameRecordsBySandbox":{{"records":[{{"totalXP":115,"totalUnlocked":2,"playerAchievements":[{rows}]}}]}}}}}}}}"#
        ))
    }

    fn row(name: &str, unlocked: bool, date: &str) -> String {
        format!(
            r#"{{"playerAchievement":{{"sandboxId":"{ROCKET_LEAGUE}","epicAccountId":"{ACCOUNT_ID}","achievementName":"{name}","unlocked":{unlocked},"progress":1,"XP":15,"unlockDate":"{date}"}}}}"#
        )
    }

    /// Reads one game against canned store answers, in order. Returns what
    /// was asked.
    async fn run(
        app_name: &str,
        locale: &str,
        answers: Vec<Answer>,
    ) -> (EpicAchievementRead, Vec<Value>) {
        let asked = Mutex::new(Vec::new());
        let answers = Mutex::new(VecDeque::from(answers));
        let read = read_game(&library(), false, app_name, ACCOUNT_ID, locale, |body| {
            asked.lock().unwrap().push(body);
            std::future::ready(
                answers
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("asked more than the test answers"),
            )
        })
        .await;
        (read, asked.into_inner().unwrap())
    }

    fn achievements(read: EpicAchievementRead) -> Vec<EpicAchievement> {
        match read {
            EpicAchievementRead::Ok { achievements } => achievements,
            other => panic!("expected achievements, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn reads_the_list_from_epics_real_rocket_league_answer() {
        let (read, asked) = run(
            "Sugar",
            "en-US",
            vec![json_answer(ROCKET_LEAGUE_LIST), unlocks("")],
        )
        .await;
        // The game's namespace from the library is its sandbox id.
        assert_eq!(
            asked[0]["variables"],
            json!({ "SandboxId": ROCKET_LEAGUE, "Locale": "en-US" })
        );
        assert_eq!(
            asked[1]["variables"],
            json!({ "epicAccountId": ACCOUNT_ID, "sandboxId": ROCKET_LEAGUE })
        );
        let list = achievements(read);
        assert_eq!(
            list[0],
            EpicAchievement {
                id: "0".into(),
                name: "Virtuoso".into(),
                description: "Unlock All Original Achievements".into(),
                hidden: false,
                unlocked: false,
                unlocked_at: None,
                icon_url: Some(format!("{ICONS}/c6d1f088e2529eef0d25854228ef6d56")),
                locked_icon_url: Some(format!("{ICONS}/89599f95e0e80c184826f4c563956cf7")),
                global_percent: Some(0.1),
                xp: Some(100),
            }
        );
        assert_eq!(
            list.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(),
            ["Virtuoso", "Stocked", "Grease Monkey"]
        );
        assert_eq!(
            list.iter().map(|a| a.global_percent).collect::<Vec<_>>(),
            [Some(0.1), Some(35.0), Some(13.0)]
        );
        assert_eq!(list.iter().filter_map(|a| a.xp).sum::<u64>(), 165);
        assert!(list.iter().all(|a| !a.unlocked));
    }

    #[tokio::test]
    async fn unlocked_rows_join_the_list_by_name_with_their_time() {
        let rows = [
            row("10", true, "2026-10-31T18:24:07.123Z"),
            row("1", false, "0001-01-01T00:00:00.000Z"),
            row("0", true, "yesterday"),
            // Not in the list: dropped.
            row("999", true, "2026-10-30T10:00:00.000Z"),
        ]
        .join(",");
        let (read, _) = run(
            "Sugar",
            "en-US",
            vec![json_answer(ROCKET_LEAGUE_LIST), unlocks(&rows)],
        )
        .await;
        let list = achievements(read);
        let find = |id: &str| list.iter().find(|a| a.id == id).unwrap();
        assert!(find("10").unlocked);
        // 2026-10-31 18:24:07.123 UTC
        assert_eq!(find("10").unlocked_at, Some(1_793_471_047_123));
        assert!(!find("1").unlocked);
        assert_eq!(find("1").unlocked_at, None);
        // Unlocked, date unknown.
        assert!(find("0").unlocked);
        assert_eq!(find("0").unlocked_at, None);
        assert_eq!(
            list.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["0", "1", "10"]
        );
    }

    #[test]
    fn unlock_times_with_an_offset_or_without_milliseconds_read_too() {
        assert_eq!(
            unlock_time("2026-10-31T20:24:07.123+02:00"),
            Some(1_793_471_047_123)
        );
        assert_eq!(unlock_time("2026-10-31T18:24:07Z"), Some(1_793_471_047_000));
        for text in ["", "2026-13-01T00:00:00Z", "0001-01-01T00:00:00.000Z"] {
            assert_eq!(unlock_time(text), None, "{text}");
        }
    }

    #[tokio::test]
    async fn the_bot_check_stops_the_read() {
        let captcha = answer(302, CAPTCHA.as_bytes());
        assert_eq!(captcha, Answer::Blocked);
        // A non-English player: still no second question in English.
        let (read, asked) = run("Sugar", "de", vec![captcha]).await;
        assert_eq!(read, EpicAchievementRead::Blocked);
        assert_eq!(asked.len(), 1);
        // The captcha page without the redirect, and a refused token.
        assert_eq!(answer(200, CAPTCHA.as_bytes()), Answer::Blocked);
        assert_eq!(answer(401, b""), Answer::Blocked);
        assert_eq!(answer(403, b"{}"), Answer::Blocked);
    }

    #[tokio::test]
    async fn a_game_the_account_does_not_have_is_never_asked_for() {
        let (read, asked) = run("Fortnite", "en-US", vec![]).await;
        assert_eq!(read, EpicAchievementRead::NotInAccount);
        assert!(asked.is_empty());
    }

    #[tokio::test]
    async fn a_library_epic_cut_short_proves_nothing_about_ownership() {
        let read = read_game(&library(), true, "Fortnite", ACCOUNT_ID, "en-US", |_| {
            std::future::ready(Answer::Unavailable)
        })
        .await;
        assert_eq!(read, EpicAchievementRead::Unavailable);
    }

    #[tokio::test]
    async fn a_game_without_achievements_says_so_without_asking_for_unlocks() {
        // Epic's real answer for Subnautica (app name "Jaguar"), 2026-11-01.
        let (read, asked) = run(
            "Jaguar",
            "en-US",
            vec![json_answer(
                r#"{"data":{"Achievement":{"productAchievementsRecordBySandbox":{"achievements":null}}}}"#,
            )],
        )
        .await;
        assert_eq!(read, EpicAchievementRead::NoAchievements);
        assert_eq!(asked[0]["variables"]["SandboxId"], "jaguar");
        assert_eq!(asked.len(), 1);
        // Not seen live: no record at all, or an empty list.
        for list in [
            r#"{"data":{"Achievement":{"productAchievementsRecordBySandbox":null}}}"#,
            r#"{"data":{"Achievement":{"productAchievementsRecordBySandbox":{"totalAchievements":0,"achievements":[]}}}}"#,
        ] {
            let (read, asked) = run("Sugar", "en-US", vec![json_answer(list)]).await;
            assert_eq!(read, EpicAchievementRead::NoAchievements, "{list}");
            assert_eq!(asked.len(), 1);
        }
    }

    #[tokio::test]
    async fn a_locale_epic_answers_with_an_error_gets_one_more_try_in_english() {
        let refused = json_answer(
            r#"{"errors":[{"message":"Unsupported locale"}],"data":{"Achievement":{"productAchievementsRecordBySandbox":null}}}"#,
        );
        let (read, asked) = run(
            "Sugar",
            "pl",
            vec![refused, json_answer(ROCKET_LEAGUE_LIST), unlocks("")],
        )
        .await;
        assert_eq!(achievements(read).len(), 3);
        assert_eq!(asked[0]["variables"]["Locale"], "pl");
        assert_eq!(asked[1]["variables"]["Locale"], "en-US");

        // English that fails stays failed.
        let only_errors = || json_answer(r#"{"errors":[{"message":"Internal"}],"data":null}"#);
        let (read, asked) = run("Sugar", "en-US", vec![only_errors()]).await;
        assert_eq!(read, EpicAchievementRead::Unavailable);
        assert_eq!(asked.len(), 1);
    }

    #[tokio::test]
    async fn epic_down_or_missing_unlocks_never_read_as_all_locked() {
        for unlock_answer in [
            answer(503, b"Service Unavailable"),
            answer(200, b"not json"),
            json_answer(
                r#"{"data":{"PlayerAchievement":{"playerAchievementGameRecordsBySandbox":null}}}"#,
            ),
            json_answer(r#"{"errors":[{"message":"Internal"}],"data":null}"#),
        ] {
            let (read, _) = run(
                "Sugar",
                "en-US",
                vec![json_answer(ROCKET_LEAGUE_LIST), unlock_answer],
            )
            .await;
            assert_eq!(read, EpicAchievementRead::Unavailable);
        }
        let (read, _) = run("Sugar", "en-US", vec![answer(500, b"{}")]).await;
        assert_eq!(read, EpicAchievementRead::Unavailable);
    }

    #[tokio::test]
    async fn neither_a_token_nor_the_account_id_reach_the_result() {
        // Epic's rows name the account, and a field nobody asked for carries
        // a token: only known fields are copied.
        let list = ROCKET_LEAGUE_LIST.replace(
            r#""name":"1","#,
            r#""name":"1","access_token":"eg1~planted-access","#,
        );
        let rows = [row("1", true, "2026-10-31T18:24:07.123Z")].join(",");
        let (read, asked) = run("Sugar", "en-US", vec![json_answer(&list), unlocks(&rows)]).await;
        let sent = serde_json::to_string(&read).unwrap();
        assert!(
            sent.starts_with(r#"{"status":"ok","achievements":["#),
            "{sent}"
        );
        assert!(!sent.contains(ACCOUNT_ID));
        assert!(!sent.contains("eg1~planted-access"));
        // The account id goes to Epic only, in the unlock question.
        assert!(!asked[0].to_string().contains(ACCOUNT_ID));
    }

    #[test]
    fn the_app_languages_map_to_epic_locales_and_others_to_english() {
        assert_eq!(epic_locale("de"), "de");
        assert_eq!(epic_locale("pt-BR"), "pt-BR");
        assert_eq!(epic_locale("klingon"), "en-US");
        assert_eq!(
            serde_json::to_string(&EpicAchievementRead::NeedsSignIn).unwrap(),
            r#"{"status":"needsSignIn"}"#
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn a_refused_sign_in_needs_a_new_one_and_ends_the_kept_sign_in() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        let keep = || {
            store
                .save(
                    Service::Epic,
                    &KeptLogin::new("eg1~refresh".into(), Some("Player One".into())),
                )
                .unwrap();
            store.load(Service::Epic).unwrap()
        };
        let login = keep();
        let refused = finish_sign_in(
            &store,
            &client,
            &login,
            Err(TokenFailure::Refused("Expired".into())),
        )
        .await;
        assert!(matches!(refused, Err(EpicAchievementRead::NeedsSignIn)));
        assert_eq!(store.load(Service::Epic), None);

        // Epic down or an account action: the kept sign-in stays.
        let login = keep();
        let down = finish_sign_in(&store, &client, &login, Err(TokenFailure::Unavailable)).await;
        assert!(matches!(down, Err(EpicAchievementRead::Unavailable)));
        let action = finish_sign_in(
            &store,
            &client,
            &login,
            Err(TokenFailure::ActionRequired("Confirm".into())),
        )
        .await;
        assert!(matches!(action, Err(EpicAchievementRead::NeedsSignIn)));
        assert_eq!(store.load(Service::Epic).unwrap().secret, "eg1~refresh");

        // A rotated token is saved before the read goes on.
        let rotated: Token = serde_json::from_str(
            r#"{"access_token":"eg1~access","account_id":"4f3c","refresh_token":"eg1~rotated"}"#,
        )
        .unwrap();
        let token = finish_sign_in(&store, &client, &login, Ok(rotated))
            .await
            .unwrap_or_else(|read| panic!("{read:?}"));
        assert_eq!(token.account_id, "4f3c");
        assert_eq!(store.load(Service::Epic).unwrap().secret, "eg1~rotated");
        let _ = std::fs::remove_dir_all(dir);
    }
}
