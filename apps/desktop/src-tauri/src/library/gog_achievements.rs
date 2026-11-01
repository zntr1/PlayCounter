//! A game's GOG achievements, read with the kept GOG sign-in.
//!
//! GOG has no public API for them. Like Comet (the GOG GALAXY stand-in Heroic
//! uses) and other open tools, PlayCounter asks GOG's gameplay service with
//! the GOG GALAXY sign-in it already keeps. That service knows a game by its
//! GALAXY client id, which GOG's public build file of the game names; the
//! product id PlayCounter imports is another number.
//!
//! Answers are status codes, never sentences; the desktop words them. Tokens
//! and the GOG user id never leave Rust, and nothing goes to PlayCounter's
//! server.
use super::epic_achievements::unlock_time;
use super::gog_account::{
    debug_answer, finish_authentication, http_client, renew, secure_https, Token, TokenFailure,
    AUTHENTICATING,
};
use super::kept_logins::{KeptLogin, Service, Store};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, future::Future};
use tauri::{AppHandle, Url, WebviewWindow};

const BUILDS_URL: &str = "https://content-system.gog.com/products";
const ACHIEVEMENTS_URL: &str = "https://gameplay.gog.com/clients";
/// GOG's languages for the app's languages (see gog.ts), written the way GOG
/// GALAXY sends them.
const LOCALES: [&str; 8] = [
    "en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "pl-PL", "ru-RU", "zh-CN",
];
const ENGLISH: &str = "en-US";
const MAX_LIST_BYTES: usize = 1024 * 1024;
const MAX_BUILD_FILE_BYTES: usize = 1024 * 1024;
const MAX_UNPACKED_BYTES: usize = 8 * 1024 * 1024;
const MAX_ANSWER_BYTES: usize = 8 * 1024 * 1024;
const MAX_ACHIEVEMENTS: usize = 10_000;
const MAX_TEXT: usize = 4_000;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GogAchievement {
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
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum GogAchievementRead {
    Ok {
        achievements: Vec<GogAchievement>,
    },
    /// No GOG sign-in is kept on this PC.
    NoLogin,
    /// GOG refused the kept sign-in, which is gone now.
    NeedsSignIn,
    /// The game has no GALAXY client id, or GOG lists no achievements for it.
    NoAchievements,
    /// GOG didn't answer properly, or this PC couldn't ask.
    Unavailable,
}

/// What PlayCounter asks GOG, in this order.
#[derive(Debug, Clone, PartialEq)]
enum Request {
    /// GOG's public build list of the game for Windows. No sign-in.
    Builds { product_id: String },
    /// The newest generation-2 build's file on GOG's servers. No sign-in.
    BuildFile { url: Url },
    /// The player's achievements, with the sign-in.
    Achievements { client_id: String, locale: String },
}

/// What GOG answered to one request.
#[derive(Debug, Clone, PartialEq)]
struct Reply {
    status: u16,
    body: Vec<u8>,
}

#[tauri::command]
pub async fn gog_read_achievements(
    app: AppHandle,
    window: WebviewWindow,
    product_id: String,
    language: String,
) -> Result<GogAchievementRead, String> {
    if window.label() != "main" {
        return Err("main window only".into());
    }
    if !cfg!(windows) {
        return Ok(GogAchievementRead::NoLogin);
    }
    if !super::gog::valid_id(&product_id) {
        return Ok(GogAchievementRead::Unavailable);
    }
    let Ok(store) = Store::of(&app) else {
        return Ok(GogAchievementRead::Unavailable);
    };
    let login = match store.try_load(Service::Gog) {
        Ok(Some(login)) => login,
        Ok(None) => return Ok(GogAchievementRead::NoLogin),
        // An unreadable file doesn't prove the sign-in expired.
        Err(_) => return Ok(GogAchievementRead::Unavailable),
    };
    let Ok(client) = http_client() else {
        return Ok(GogAchievementRead::Unavailable);
    };
    // Same rule as the import: never redeem the kept token concurrently, and
    // save GOG's new one before anything else happens.
    let token = {
        let _guard = AUTHENTICATING.lock().await;
        let response = renew(&client, &login.secret).await;
        match finish_sign_in(&store, &client, &login, response).await {
            Ok(token) => token,
            Err(read) => return Ok(read),
        }
    };
    let Some(user) = token.user() else {
        return Ok(GogAchievementRead::Unavailable);
    };
    let read = read_game(&product_id, gog_locale(&language), |asked| {
        fetch(&client, &token, &user, asked)
    })
    .await;
    // Signed out meanwhile: that account's answer is not shown.
    if !store.is_current(Service::Gog) {
        return Ok(GogAchievementRead::NoLogin);
    }
    Ok(read)
}

/// The renewed sign-in, or why there is none. A confirmed refusal has
/// already ended the kept sign-in, as in the import.
async fn finish_sign_in(
    store: &Store,
    client: &reqwest::Client,
    login: &KeptLogin,
    response: Result<Token, TokenFailure>,
) -> Result<Token, GogAchievementRead> {
    match finish_authentication(store, client, Some(login), async { response }).await {
        Ok(Some(token)) => Ok(token),
        Ok(None) => Err(GogAchievementRead::NeedsSignIn),
        Err(_) if !store.is_current(Service::Gog) => Err(GogAchievementRead::NoLogin),
        Err(_) => Err(GogAchievementRead::Unavailable),
    }
}

/// One request as it goes out. Only the achievements carry the sign-in.
fn request(
    client: &reqwest::Client,
    token: &Token,
    user: &str,
    asked: &Request,
) -> reqwest::RequestBuilder {
    match asked {
        Request::Builds { product_id } => client.get(format!(
            "{BUILDS_URL}/{product_id}/os/windows/builds?generation=2"
        )),
        Request::BuildFile { url } => client.get(url.clone()),
        Request::Achievements { client_id, locale } => client
            .get(format!(
                "{ACHIEVEMENTS_URL}/{client_id}/users/{user}/achievements"
            ))
            .bearer_auth(&token.access_token)
            .header("X-Gog-Lc", locale.as_str())
            .header(reqwest::header::ACCEPT, "application/json"),
    }
}

/// GOG's answer, or None when it sent none or one too big to read. The
/// client follows no redirects.
async fn fetch(
    client: &reqwest::Client,
    token: &Token,
    user: &str,
    asked: Request,
) -> Option<Reply> {
    let (step, limit) = match asked {
        Request::Builds { .. } => ("builds", MAX_LIST_BYTES),
        Request::BuildFile { .. } => ("build file", MAX_BUILD_FILE_BYTES),
        Request::Achievements { .. } => ("achievements", MAX_ANSWER_BYTES),
    };
    let response = request(client, token, user, &asked).send().await.ok()?;
    let status = response.status().as_u16();
    if status != 200 {
        debug_answer(step, status);
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return None;
    }
    let body = response.bytes().await.ok()?;
    (body.len() <= limit).then(|| Reply {
        status,
        body: body.to_vec(),
    })
}

fn gog_locale(language: &str) -> &'static str {
    LOCALES
        .into_iter()
        .find(|locale| *locale == language)
        .unwrap_or(ENGLISH)
}

/// A link GOG's build list names, if it stays on GOG's own servers.
fn gog_link(text: &str) -> Option<Url> {
    let url: Url = text.parse().ok()?;
    let host = url.host_str()?;
    (secure_https(&url) && (host == "gog.com" || host.ends_with(".gog.com"))).then_some(url)
}

/// The newest generation-2 build's file. `Ok(None)`: GOG has none for
/// Windows, so the game has no GALAXY features. `Err`: not GOG's list, or a
/// link PlayCounter won't follow.
fn build_file_link(body: &[u8]) -> Result<Option<Url>, ()> {
    let list: Value = serde_json::from_slice(body).map_err(|_| ())?;
    let items = list.get("items").and_then(Value::as_array).ok_or(())?;
    // GOG lists the newest build first.
    let Some(build) = items
        .iter()
        .find(|build| build.get("generation").and_then(Value::as_u64) == Some(2))
    else {
        return Ok(None);
    };
    build
        .get("link")
        .and_then(Value::as_str)
        .and_then(gog_link)
        .map(Some)
        .ok_or(())
}

/// The game's GALAXY client id from its packed build file. `Ok(None)`: the
/// build names none. `Err`: unreadable.
fn client_id(packed: &[u8]) -> Result<Option<String>, ()> {
    let unpacked =
        miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(packed, MAX_UNPACKED_BYTES)
            .map_err(|_| ())?;
    let file: Value = serde_json::from_slice(&unpacked).map_err(|_| ())?;
    let id = match file.get("clientId") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(text)) => text.trim().to_owned(),
        Some(Value::Number(number)) => number.to_string(),
        Some(_) => return Err(()),
    };
    (!id.is_empty() && id.len() <= 20 && id.bytes().all(|byte| byte.is_ascii_digit()))
        .then_some(Some(id))
        .ok_or(())
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

/// An icon address; the desktop keeps only GOG's own hosts.
fn link(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .filter(|link| link.starts_with("https://") && link.len() <= 2048)
        .map(str::to_owned)
}

/// GOG's list for the player, and the total GOG says it has. `Err` for
/// anything but a readable list.
fn achievement_rows(reply: &Reply) -> Result<(Vec<GogAchievement>, Option<u64>), ()> {
    if reply.status != 200 {
        return Err(());
    }
    let answer: Value = serde_json::from_slice(&reply.body).map_err(|_| ())?;
    let items = answer.get("items").and_then(Value::as_array).ok_or(())?;
    let mut ids = HashSet::new();
    let rows = items
        .iter()
        .filter_map(|item| {
            let id = [item.get("achievement_key"), item.get("achievement_id")]
                .into_iter()
                .map(text)
                .find(|id| !id.is_empty() && id.len() <= 256)?;
            if !ids.insert(id.clone()) {
                return None;
            }
            let name = text(item.get("name"));
            // GOG writes the unlock time, or null while locked.
            let unlocked = item
                .get("date_unlocked")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|date| !date.is_empty());
            Some(GogAchievement {
                name: if name.is_empty() { id.clone() } else { name },
                description: text(item.get("description")),
                hidden: item.get("visible").and_then(Value::as_bool) == Some(false),
                unlocked: unlocked.is_some(),
                unlocked_at: unlocked.and_then(unlock_time),
                icon_url: link(item.get("image_url_unlocked")),
                locked_icon_url: link(item.get("image_url_locked")),
                global_percent: item
                    .get("rarity")
                    .and_then(Value::as_f64)
                    .filter(|percent| (0.0..=100.0).contains(percent)),
                id,
            })
        })
        .take(MAX_ACHIEVEMENTS)
        .collect();
    Ok((rows, answer.get("total_count").and_then(Value::as_u64)))
}

/// The game's client id from GOG's build file, then the player's list.
async fn read_game<F, Fut>(product_id: &str, locale: &str, ask: F) -> GogAchievementRead
where
    F: Fn(Request) -> Fut,
    Fut: Future<Output = Option<Reply>>,
{
    let link = match ask(Request::Builds {
        product_id: product_id.to_owned(),
    })
    .await
    {
        Some(reply) if reply.status == 200 => match build_file_link(&reply.body) {
            Ok(Some(link)) => link,
            Ok(None) => return GogAchievementRead::NoAchievements,
            Err(()) => return GogAchievementRead::Unavailable,
        },
        _ => return GogAchievementRead::Unavailable,
    };
    let client_id = match ask(Request::BuildFile { url: link }).await {
        Some(reply) if reply.status == 200 => match client_id(&reply.body) {
            Ok(Some(id)) => id,
            Ok(None) => return GogAchievementRead::NoAchievements,
            Err(()) => return GogAchievementRead::Unavailable,
        },
        _ => return GogAchievementRead::Unavailable,
    };
    let Some(reply) = ask(Request::Achievements {
        client_id,
        locale: locale.to_owned(),
    })
    .await
    else {
        return GogAchievementRead::Unavailable;
    };
    match achievement_rows(&reply) {
        Ok((rows, total)) => {
            // Shows in a debug build whether GOG sends a list in pages.
            debug_answer(
                "achievements",
                format!("rows: {}, total_count: {total:?}", rows.len()),
            );
            if rows.is_empty() {
                GogAchievementRead::NoAchievements
            } else {
                GogAchievementRead::Ok { achievements: rows }
            }
        }
        Err(()) => GogAchievementRead::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex};

    /// GOG's real build list for The Riftbreaker on 2026-11-01, trimmed to 2
    /// of the 5 builds it sent.
    const RIFTBREAKER_BUILDS: &str = r#"{
    "total_count": 179,
    "count": 5,
    "items": [
        {
            "build_id": "59566604350908871",
            "product_id": "2147483111",
            "os": "windows",
            "branch": "Experimental",
            "version_name": "2.0.58485",
            "tags": [
                "receiver_v2",
                "csb_10_6_7_w_15"
            ],
            "public": true,
            "date_published": "2026-04-03T13:46:57+0000",
            "generation": 2,
            "link": "https:\/\/gog-cdn-fastly.gog.com\/content-system\/v2\/meta\/0b\/ea\/0beaf16de6fa7b0df9ad4664ca6fbb89"
        },
        {
            "build_id": "58468019099258818",
            "product_id": "2147483111",
            "os": "windows",
            "branch": "Experimental",
            "version_name": "1.51903",
            "tags": [
                "receiver_v2",
                "csb_10_6_7_w_15"
            ],
            "public": true,
            "date_published": "2025-03-20T15:29:52+0000",
            "generation": 2,
            "link": "https:\/\/gog-cdn-fastly.gog.com\/content-system\/v2\/meta\/8e\/9c\/8e9c3a74ccbd4c4c41c89561a02cad2e"
        }
    ],
    "has_private_branches": true
}"#;
    const RIFTBREAKER_FILE_URL: &str = "https://gog-cdn-fastly.gog.com/content-system/v2/meta/0b/ea/0beaf16de6fa7b0df9ad4664ca6fbb89";
    /// That build's file, unpacked, with 2 of its 12 depots and without its
    /// client secret (2026-11-01).
    const RIFTBREAKER_FILE: &str = r#"{"version":2,"baseProductId":"2147483111","platform":"windows","offlineDepot":{"manifest":"63e9dc42327582a476e52c9138f8bf10","size":4437,"compressedSize":711,"productId":"2147483111","languages":["*"]},"depots":[{"manifest":"47152a767badd896c8f0efe4a2dc1b59","size":10820706360,"compressedSize":10356539538,"productId":"2147483111","languages":["en-US"],"osBitness":["64"]},{"manifest":"c2b643e8e5b43ca13e9704ed41e40621","size":4688,"compressedSize":4609,"productId":"2147483111","languages":["en-US"],"osBitness":["64"],"isGogDepot":true}],"products":[{"name":"The Riftbreaker","productId":"2147483111","temp_executable":"","temp_arguments":""},{"name":"The Riftbreaker: Metal Terror","productId":"1315197539","temp_executable":"","temp_arguments":""},{"name":"The Riftbreaker: Into The Dark","productId":"1165918628","temp_executable":"","temp_arguments":""},{"name":"The Riftbreaker: Heart of the Swamp","productId":"1790657081","temp_executable":"","temp_arguments":""}],"dependencies":["dotNet46","MSVC2012_x64","MSVC2019_x64"],"tags":["csb_10_6_7_w_15"],"buildId":"59566604350908871","installDirectory":"The Riftbreaker","scriptInterpreter":true,"clientId":"53617145805957396","clientSecret":"<removed>"}"#;
    /// GOG's real build list for Middle-earth: Shadow of Mordor GOTY
    /// (1213504814), in Phil's account, on 2026-11-01.
    const MORDOR_BUILDS: &str = r#"{
    "total_count": 4,
    "count": 1,
    "items": [
        {
            "build_id": "55701555937600834",
            "product_id": "1213504814",
            "os": "windows",
            "branch": null,
            "version_name": "RC2",
            "tags": [
                "csb_10_6_1_w_158"
            ],
            "public": true,
            "date_published": "2022-08-09T09:39:29+0000",
            "generation": 2,
            "link": "https:\/\/gog-cdn-fastly.gog.com\/content-system\/v2\/meta\/5e\/50\/5e507a150a8c5003b3990f7a85324279"
        }
    ],
    "has_private_branches": true
}"#;
    /// That build's file, unpacked, with 2 of its depots and without its
    /// client secret (2026-11-01).
    const MORDOR_FILE: &str = r#"{"version":2,"baseProductId":"1213504814","platform":"windows","offlineDepot":{"manifest":"46b18739fc50b6ab14bc72b98b548b51","size":4663,"compressedSize":808,"productId":"1213504814","languages":["*"]},"depots":[{"manifest":"501c6e6301146ac8a97e74ec83cda514","size":57664404560,"compressedSize":57311403279,"productId":"1213504814","languages":["de-DE","pt-BR","fr-FR","pl-PL","ru-RU","es-ES","it-IT","en-US"],"osBitness":["64"]},{"manifest":"f5e426e2a3c9f0bb210be23d1eddc180","size":157,"compressedSize":97,"productId":"1213504814","languages":["fr-FR"],"osBitness":["64"],"isGogDepot":true}],"products":[{"name":"Middle-earth™: Shadow of Mordor™","productId":"1213504814","temp_executable":"","temp_arguments":""}],"dependencies":["DirectX","MSVC2010","MSVC2019"],"tags":["csb_10_6_1_w_158","galaxy"],"buildId":"55701555937600834","installDirectory":"Shadow of Mordor","scriptInterpreter":true,"clientId":"55687131321183296","clientSecret":"<removed>"}"#;
    /// GOG's real build list for Fallout (1) on 2026-11-01: older builds only.
    const FALLOUT_BUILDS: &str = r#"{
    "total_count": 2,
    "count": 2,
    "items": [
        {
            "build_id": "48338351542741408",
            "product_id": "1",
            "os": "windows",
            "branch": null,
            "version_name": "1.2",
            "tags": [],
            "public": true,
            "date_published": "2015-08-26T13:18:56+0000",
            "generation": 1,
            "link": "https:\/\/gog-cdn-fastly.gog.com\/content-system\/v1\/manifests\/1\/windows\/46964406\/repository.json",
            "legacy_build_id": 46964406
        },
        {
            "build_id": "1",
            "product_id": "1",
            "os": "windows",
            "branch": null,
            "version_name": "",
            "tags": [],
            "public": true,
            "date_published": "2015-01-02T17:48:48+0000",
            "generation": 1,
            "link": "https:\/\/gog-cdn-fastly.gog.com\/content-system\/v1\/manifests\/1\/windows\/26592528\/repository.json",
            "legacy_build_id": 26592528
        }
    ],
    "has_private_branches": false
}"#;
    /// GOG's answer without a token, seen live on 2026-11-01.
    const NOT_SIGNED_IN: &str =
        r#"{"error":"access_denied","error_description":"OAuth2 authentication required"}"#;
    const USER: &str = "60181324713465405";

    /// No real list has been seen yet (it needs Phil's sign-in): a written
    /// example in the shape Comet and the GOG achievement tools read, with
    /// the time form they send to GOG.
    fn list(items: &str) -> Reply {
        ok(&format!(
            r#"{{"total_count":4,"limit":1000,"page_token":"0","items":[{items}],"achievements_mode":"all_visible"}}"#
        ))
    }

    fn item(key: &str, name: &str, visible: bool, unlocked: Option<&str>, rarity: f64) -> String {
        let date = unlocked.map_or("null".to_owned(), |date| format!(r#""{date}""#));
        format!(
            r#"{{"achievement_id":"5{len}","achievement_key":"{key}","visible":{visible},"name":"{name}","description":"About {name}","image_url_unlocked":"https://images.gog.com/{key}_unlocked.png","image_url_locked":"https://images.gog.com/{key}_locked.png","date_unlocked":{date},"rarity":{rarity},"rarity_level_description":"Common","rarity_level_slug":"common"}}"#,
            len = key.len()
        )
    }

    fn ok(body: &str) -> Reply {
        Reply {
            status: 200,
            body: body.as_bytes().to_vec(),
        }
    }

    fn reply(status: u16, body: &[u8]) -> Reply {
        Reply {
            status,
            body: body.to_vec(),
        }
    }

    /// A build file as GOG sends it: zlib-packed JSON.
    fn packed(json: &str) -> Reply {
        reply(
            200,
            &miniz_oxide::deflate::compress_to_vec_zlib(json.as_bytes(), 6),
        )
    }

    /// Reads one game against canned answers, in order. Returns what was
    /// asked.
    async fn run(
        product_id: &str,
        locale: &str,
        answers: Vec<Option<Reply>>,
    ) -> (GogAchievementRead, Vec<Request>) {
        let asked = Mutex::new(Vec::new());
        let answers = Mutex::new(VecDeque::from(answers));
        let read = read_game(product_id, locale, |question| {
            asked.lock().unwrap().push(question);
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

    fn achievements(read: GogAchievementRead) -> Vec<GogAchievement> {
        match read {
            GogAchievementRead::Ok { achievements } => achievements,
            other => panic!("expected achievements, got {other:?}"),
        }
    }

    fn token() -> Token {
        serde_json::from_str(&format!(
            r#"{{"access_token":"gog-access","refresh_token":"gog-refresh","user_id":"{USER}"}}"#
        ))
        .unwrap()
    }

    #[tokio::test]
    async fn finds_the_client_id_in_gogs_real_build_list_and_file() {
        let (read, asked) = run(
            "2147483111",
            "en-US",
            vec![
                Some(ok(RIFTBREAKER_BUILDS)),
                Some(packed(RIFTBREAKER_FILE)),
                Some(list(&item("WIN", "Win", true, None, 40.0))),
            ],
        )
        .await;
        assert_eq!(
            asked,
            vec![
                Request::Builds {
                    product_id: "2147483111".into()
                },
                // The newest build first.
                Request::BuildFile {
                    url: RIFTBREAKER_FILE_URL.parse().unwrap()
                },
                // The client id its install file names too.
                Request::Achievements {
                    client_id: "53617145805957396".into(),
                    locale: "en-US".into()
                },
            ]
        );
        assert_eq!(achievements(read).len(), 1);

        let (_, asked) = run(
            "1213504814",
            "de-DE",
            vec![
                Some(ok(MORDOR_BUILDS)),
                Some(packed(MORDOR_FILE)),
                Some(list(&item("WIN", "Win", true, None, 40.0))),
            ],
        )
        .await;
        assert_eq!(
            asked[2],
            Request::Achievements {
                client_id: "55687131321183296".into(),
                locale: "de-DE".into()
            }
        );
    }

    #[tokio::test]
    async fn a_game_without_a_galaxy_build_has_no_achievements_and_nothing_more_is_asked() {
        // Fallout: older builds only.
        let (read, asked) = run("1", "en-US", vec![Some(ok(FALLOUT_BUILDS))]).await;
        assert_eq!(read, GogAchievementRead::NoAchievements);
        assert_eq!(asked.len(), 1);
        // No builds for Windows at all.
        let (read, asked) = run(
            "1",
            "en-US",
            vec![Some(ok(r#"{"total_count":0,"count":0,"items":[]}"#))],
        )
        .await;
        assert_eq!(read, GogAchievementRead::NoAchievements);
        assert_eq!(asked.len(), 1);
        // A build file that names no client id: the list is never asked for.
        let no_client = RIFTBREAKER_FILE.replace(r#","clientId":"53617145805957396""#, "");
        let (read, asked) = run(
            "2147483111",
            "en-US",
            vec![Some(ok(RIFTBREAKER_BUILDS)), Some(packed(&no_client))],
        )
        .await;
        assert_eq!(read, GogAchievementRead::NoAchievements);
        assert_eq!(asked.len(), 2);
    }

    #[tokio::test]
    async fn links_off_gogs_servers_are_never_followed() {
        for link in [
            r"http:\/\/gog-cdn-fastly.gog.com\/content-system\/v2\/meta\/0b",
            r"https:\/\/gog-cdn-fastly.gog.com.evil.test\/content-system\/v2\/meta\/0b",
            r"https:\/\/evil.test\/gog.com\/meta",
            r"https:\/\/user@gog-cdn-fastly.gog.com\/meta",
            r"https:\/\/gog-cdn-fastly.gog.com:8443\/meta",
            "file:///C:/private.txt",
            "",
        ] {
            let builds = MORDOR_BUILDS.replace(
                r"https:\/\/gog-cdn-fastly.gog.com\/content-system\/v2\/meta\/5e\/50\/5e507a150a8c5003b3990f7a85324279",
                link,
            );
            let (read, asked) = run("1213504814", "en-US", vec![Some(ok(&builds))]).await;
            assert_eq!(read, GogAchievementRead::Unavailable, "{link}");
            assert_eq!(asked.len(), 1, "{link}");
        }
    }

    #[tokio::test]
    async fn reads_names_hidden_rows_unlock_times_and_the_share_of_players() {
        let items = [
            item(
                "WIN_10",
                "Ten Wins",
                true,
                Some("2026-10-31T18:24:07+0000"),
                12.5,
            ),
            item("FIRST_STEP", "First Step", true, None, 85.0),
            // Hidden while locked.
            item("SECRET", "Secret Ending", false, None, 1.25),
            // Unlocked on a day GOG wrote in a form PlayCounter can't read.
            item("ODD_DATE", "Odd Date", true, Some("yesterday"), 50.0),
            // Not a share of players.
            item("BAD_RARITY", "Bad Rarity", true, None, 150.0),
            // A repeat of the first.
            item("WIN_10", "Ten Wins again", true, None, 1.0),
        ]
        .join(",");
        let (read, _) = run(
            "1213504814",
            "en-US",
            vec![
                Some(ok(MORDOR_BUILDS)),
                Some(packed(MORDOR_FILE)),
                Some(list(&items)),
            ],
        )
        .await;
        let list = achievements(read);
        assert_eq!(
            list[0],
            GogAchievement {
                id: "WIN_10".into(),
                name: "Ten Wins".into(),
                description: "About Ten Wins".into(),
                hidden: false,
                unlocked: true,
                // 2026-10-31 18:24:07 UTC
                unlocked_at: Some(1_793_471_047_000),
                icon_url: Some("https://images.gog.com/WIN_10_unlocked.png".into()),
                locked_icon_url: Some("https://images.gog.com/WIN_10_locked.png".into()),
                global_percent: Some(12.5),
            }
        );
        let find = |id: &str| list.iter().find(|a| a.id == id).unwrap();
        assert!(!find("FIRST_STEP").unlocked);
        assert_eq!(find("FIRST_STEP").unlocked_at, None);
        assert!(find("SECRET").hidden);
        assert!(!find("SECRET").unlocked);
        assert!(find("ODD_DATE").unlocked);
        assert_eq!(find("ODD_DATE").unlocked_at, None);
        assert_eq!(find("BAD_RARITY").global_percent, None);
        assert_eq!(
            list.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["WIN_10", "FIRST_STEP", "SECRET", "ODD_DATE", "BAD_RARITY"]
        );
    }

    #[tokio::test]
    async fn names_and_ids_fall_back_and_texts_are_cut() {
        let items = [
            // No key: GOG's own id. No name: the id.
            r#"{"achievement_id":"58133","achievement_key":"","visible":true,"name":"","description":"","date_unlocked":null}"#.to_owned(),
            format!(
                r#"{{"achievement_id":"58134","achievement_key":"LONG","visible":true,"name":"{}","description":"","date_unlocked":null}}"#,
                "x".repeat(MAX_TEXT + 10)
            ),
            // Neither: dropped.
            r#"{"achievement_key":"","name":"Nameless","date_unlocked":null}"#.to_owned(),
        ]
        .join(",");
        let (read, _) = run(
            "1213504814",
            "en-US",
            vec![
                Some(ok(MORDOR_BUILDS)),
                Some(packed(MORDOR_FILE)),
                Some(list(&items)),
            ],
        )
        .await;
        let list = achievements(read);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "58133");
        assert_eq!(list[0].name, "58133");
        assert!(!list[0].hidden);
        assert_eq!(list[0].icon_url, None);
        assert_eq!(list[1].name.chars().count(), MAX_TEXT);
    }

    #[tokio::test]
    async fn an_empty_list_means_no_achievements() {
        let (read, asked) = run(
            "1213504814",
            "en-US",
            vec![
                Some(ok(MORDOR_BUILDS)),
                Some(packed(MORDOR_FILE)),
                Some(list("")),
            ],
        )
        .await;
        assert_eq!(read, GogAchievementRead::NoAchievements);
        assert_eq!(asked.len(), 3);
    }

    #[tokio::test]
    async fn gog_down_or_anything_but_a_list_never_reads_as_all_locked() {
        let builds = || Some(ok(MORDOR_BUILDS));
        let file = || Some(packed(MORDOR_FILE));
        for answers in [
            // The list.
            vec![builds(), file(), Some(reply(401, NOT_SIGNED_IN.as_bytes()))],
            vec![builds(), file(), Some(reply(403, b"{}"))],
            vec![builds(), file(), Some(reply(404, b"{}"))],
            vec![builds(), file(), Some(reply(503, b"Service Unavailable"))],
            vec![builds(), file(), Some(ok("not json"))],
            vec![builds(), file(), Some(ok(r#"{"items":null}"#))],
            vec![builds(), file(), Some(ok(r#"[]"#))],
            vec![builds(), file(), None],
            // The build file.
            vec![builds(), Some(reply(404, b"Not Found"))],
            vec![builds(), Some(ok(MORDOR_FILE))],
            vec![builds(), Some(reply(200, b"\x78\x9c broken"))],
            vec![
                builds(),
                Some(packed(&MORDOR_FILE.replace("55687131321183296", "5568x"))),
            ],
            vec![builds(), None],
            // The build list.
            vec![Some(reply(500, b"{}"))],
            vec![Some(ok("<html>"))],
            vec![Some(ok(r#"{"items":"none"}"#))],
            vec![None],
        ] {
            let steps = answers.len();
            let (read, asked) = run("1213504814", "en-US", answers).await;
            assert_eq!(read, GogAchievementRead::Unavailable, "after {steps} steps");
            assert_eq!(asked.len(), steps);
        }
    }

    #[test]
    fn only_the_achievements_request_carries_the_sign_in() {
        let client = http_client().unwrap();
        let token = token();
        let built = |asked: Request| request(&client, &token, USER, &asked).build().unwrap();

        let builds = built(Request::Builds {
            product_id: "1213504814".into(),
        });
        assert_eq!(
            builds.url().as_str(),
            "https://content-system.gog.com/products/1213504814/os/windows/builds?generation=2"
        );
        let file = built(Request::BuildFile {
            url: RIFTBREAKER_FILE_URL.parse().unwrap(),
        });
        assert_eq!(file.url().as_str(), RIFTBREAKER_FILE_URL);
        for public in [&builds, &file] {
            assert!(public.headers().get("authorization").is_none());
            assert!(!format!("{:?}", public.headers()).contains("gog-access"));
        }

        let list = built(Request::Achievements {
            client_id: "55687131321183296".into(),
            locale: "de-DE".into(),
        });
        assert_eq!(
            list.url().as_str(),
            format!("https://gameplay.gog.com/clients/55687131321183296/users/{USER}/achievements")
        );
        assert_eq!(list.headers()["authorization"], "Bearer gog-access");
        assert_eq!(list.headers()["x-gog-lc"], "de-DE");
        assert_eq!(list.headers()["accept"], "application/json");
    }

    #[tokio::test]
    async fn neither_the_token_nor_the_user_id_reach_the_result() {
        // A field nobody asked for carries both: only known fields are copied.
        let planted = item("WIN", "Win", true, None, 40.0).replace(
            r#""visible":true,"#,
            &format!(r#""visible":true,"user_id":"{USER}","access_token":"gog-access","#),
        );
        let (read, _) = run(
            "1213504814",
            "en-US",
            vec![
                Some(ok(MORDOR_BUILDS)),
                Some(packed(MORDOR_FILE)),
                Some(list(&planted)),
            ],
        )
        .await;
        let sent = serde_json::to_string(&read).unwrap();
        assert!(
            sent.starts_with(r#"{"status":"ok","achievements":["#),
            "{sent}"
        );
        assert!(!sent.contains(USER));
        assert!(!sent.contains("gog-access"));
    }

    #[test]
    fn the_app_languages_map_to_gogs_and_others_to_english() {
        assert_eq!(gog_locale("de-DE"), "de-DE");
        assert_eq!(gog_locale("zh-CN"), "zh-CN");
        assert_eq!(gog_locale("pt-BR"), "pt-BR");
        assert_eq!(gog_locale("klingon"), "en-US");
        assert_eq!(gog_locale(""), "en-US");
        assert_eq!(
            serde_json::to_string(&GogAchievementRead::NoAchievements).unwrap(),
            r#"{"status":"noAchievements"}"#
        );
    }

    #[test]
    fn gogs_time_form_reads() {
        // What the GOG tools send, and what GOG's build list shows.
        assert_eq!(
            unlock_time("2026-10-31T18:24:07+0000"),
            Some(1_793_471_047_000)
        );
        assert_eq!(
            unlock_time("2026-10-31T20:24:07+0200"),
            Some(1_793_471_047_000)
        );
        assert_eq!(
            unlock_time("2026-10-31T18:24:07.5+0000"),
            Some(1_793_471_047_500)
        );
        for text in [
            "2026-10-31T18:24:07+00",
            "2026-10-31T18:24:07 0000",
            "2026-10-31T18:24:07+00x0",
        ] {
            assert_eq!(unlock_time(text), None, "{text}");
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn a_refused_sign_in_needs_a_new_one_and_ends_the_kept_sign_in() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        let keep = || {
            store
                .save(
                    Service::Gog,
                    &KeptLogin::new("gog-refresh".into(), Some("zesarex".into())),
                )
                .unwrap();
            store.load(Service::Gog).unwrap()
        };
        let login = keep();
        let refused = finish_sign_in(
            &store,
            &client,
            &login,
            Err(TokenFailure::Refused("Expired".into())),
        )
        .await;
        assert!(matches!(refused, Err(GogAchievementRead::NeedsSignIn)));
        assert_eq!(store.load(Service::Gog), None);

        // GOG down: the kept sign-in stays.
        let login = keep();
        let down = finish_sign_in(&store, &client, &login, Err(TokenFailure::Unavailable)).await;
        assert!(matches!(down, Err(GogAchievementRead::Unavailable)));
        assert_eq!(store.load(Service::Gog).unwrap().secret, "gog-refresh");

        // GOG's new token is saved before the read goes on.
        let rotated: Token = serde_json::from_str(&format!(
            r#"{{"access_token":"gog-access","refresh_token":"gog-rotated","user_id":"{USER}"}}"#
        ))
        .unwrap();
        let token = finish_sign_in(&store, &client, &login, Ok(rotated))
            .await
            .unwrap_or_else(|read| panic!("{read:?}"));
        assert_eq!(token.user().as_deref(), Some(USER));
        let kept = store.load(Service::Gog).unwrap();
        assert_eq!(kept.secret, "gog-rotated");
        assert_eq!(kept.name.as_deref(), Some("zesarex"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
