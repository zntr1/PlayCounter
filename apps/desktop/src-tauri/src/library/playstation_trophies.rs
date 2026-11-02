//! A PlayStation game's trophies, read with the kept PlayStation sign-in.
//!
//! Sony has no public API for them. Like psn-api and PSNAWP, PlayCounter asks
//! Sony's trophy service with the sign-in the PlayStation import keeps: which
//! trophy lists the game's copies have, then each list's trophies and which of
//! them the player earned. Sony names only the lists of games the player
//! started. Only PS4 and PS5 copies are asked about: PlayCounter imports no
//! PS3 or Vita games.
//!
//! Tokens and the account id never leave Rust, and nothing goes to
//! PlayCounter's server.
use super::epic_achievements::unlock_time;
use super::playstation_account::{debug_answer, image_url, saved_read, valid_title_id, SavedRead};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    future::Future,
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, WebviewWindow};

const TROPHY_URL: &str = "https://m.np.playstation.com/api/trophy/v1";
/// Sony answers "Bad Request" to more title ids in one request (psn-api).
const TITLE_IDS_PER_REQUEST: usize = 5;
/// A game keeps at most 32 copies (`build_library`).
const MAX_TITLE_IDS: usize = 32;
const MAX_LISTS: usize = 10;
const MAX_PAGES: usize = 20;
const MAX_TROPHIES: usize = 10_000;
const MAX_TEXT: usize = 4_000;
const MAX_ANSWER_BYTES: usize = 8 * 1024 * 1024;
const MAX_UNKNOWN_COPIES: usize = 10_000;
/// Sony's languages for the app's languages (see playstation.ts).
const LANGUAGES: [&str; 8] = [
    "en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "pl-PL", "ru-RU", "zh-CN",
];
const ENGLISH: &str = "en-US";

/// Copies Sony's trophy service doesn't know ("Resource not found"), for this
/// run of the app: other regions and editions of a game. Never asked again.
static UNKNOWN_COPIES: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Progress {
    current: f64,
    target: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trophy {
    /// `<npCommunicationId>:<trophyId>`, so two lists never mix.
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
    global_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<Progress>,
    /// "bronze", "silver", "gold" or "platinum".
    #[serde(skip_serializing_if = "Option::is_none")]
    trophy_type: Option<&'static str>,
    /// "PS5" or "PS4", only when the game has lists for both.
    #[serde(skip_serializing_if = "Option::is_none")]
    platform: Option<&'static str>,
}

/// What PlayCounter asks Sony, in this order.
#[derive(Debug, Clone, PartialEq)]
enum Request {
    /// The player's trophy lists of up to five copies.
    Lists { title_ids: Vec<String> },
    /// One list's trophies, from `offset` on.
    Trophies {
        list: String,
        service: &'static str,
        offset: u64,
    },
    /// Which of them the player earned, from `offset` on.
    Earned {
        list: String,
        service: &'static str,
        offset: u64,
    },
}

/// Why Sony sent no data for one request.
#[derive(Debug, Clone, PartialEq)]
enum Refusal {
    /// "Resource not found", with the copy Sony names, if it names one.
    NotFound(Option<String>),
    /// Any other status; 0 when Sony sent no answer or one too big to read.
    Status(u16),
}

impl Refusal {
    fn status(self) -> u16 {
        match self {
            Refusal::NotFound(_) => 404,
            Refusal::Status(status) => status,
        }
    }
}

/// One trophy list of the game.
#[derive(Debug, Clone, PartialEq)]
struct List {
    id: String,
    service: &'static str,
    platform: &'static str,
}

/// The game's trophies with the kept PlayStation sign-in. Background-safe:
/// never opens a window. An empty list: the player has no trophy list for
/// any of these copies.
#[tauri::command]
pub async fn playstation_read_trophies(
    app: AppHandle,
    window: WebviewWindow,
    title_ids: Vec<String>,
    language: String,
) -> Result<SavedRead<Vec<Trophy>>, String> {
    if window.label() != "main" {
        return Err("PlayStation trophies are read from PlayCounter.".into());
    }
    let language = sony_language(&language);
    let title_ids = &title_ids;
    Ok(saved_read(&app, |client, token, _| async move {
        let mut unknown = UNKNOWN_COPIES
            .lock()
            .map(|known| known.clone())
            .unwrap_or_default();
        let read = tokio::time::timeout(
            Duration::from_secs(120),
            read_trophies(title_ids, &mut unknown, |asked| {
                fetch(&client, &token, language, asked)
            }),
        )
        .await
        .unwrap_or(Err(0));
        // What this read learned, also when it failed later on.
        if let Ok(mut known) = UNKNOWN_COPIES.lock() {
            for id in unknown {
                if known.len() >= MAX_UNKNOWN_COPIES {
                    break;
                }
                known.insert(id);
            }
        }
        read
    })
    .await)
}

fn sony_language(language: &str) -> &'static str {
    LANGUAGES
        .into_iter()
        .find(|known| *known == language)
        .unwrap_or(ENGLISH)
}

/// One request as it goes out: every one carries the sign-in and the
/// player's language. "me" is the signed-in account.
fn request(
    client: &reqwest::Client,
    token: &str,
    language: &str,
    asked: &Request,
) -> reqwest::RequestBuilder {
    let mut url = tauri::Url::parse(TROPHY_URL).expect("fixed Sony URL");
    {
        let mut path = url.path_segments_mut().expect("fixed Sony URL");
        match asked {
            Request::Lists { .. } => {
                path.extend(["users", "me", "titles", "trophyTitles"]);
            }
            Request::Trophies { list, .. } => {
                path.extend([
                    "npCommunicationIds",
                    list,
                    "trophyGroups",
                    "all",
                    "trophies",
                ]);
            }
            Request::Earned { list, .. } => {
                path.extend([
                    "users",
                    "me",
                    "npCommunicationIds",
                    list,
                    "trophyGroups",
                    "all",
                    "trophies",
                ]);
            }
        }
    }
    {
        let mut query = url.query_pairs_mut();
        match asked {
            Request::Lists { title_ids } => {
                query.append_pair("npTitleIds", &title_ids.join(","));
            }
            Request::Trophies {
                service, offset, ..
            }
            | Request::Earned {
                service, offset, ..
            } => {
                query.append_pair("npServiceName", service);
                if *offset > 0 {
                    query.append_pair("offset", &offset.to_string());
                }
            }
        }
    }
    client
        .get(url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT_LANGUAGE, language)
        .header(reqwest::header::ACCEPT, "application/json")
}

/// Sony's answer, or why it sent none. The client follows no redirects.
async fn fetch(
    client: &reqwest::Client,
    token: &str,
    language: &str,
    asked: Request,
) -> Result<Value, Refusal> {
    let step = match asked {
        Request::Lists { .. } => "trophy lists",
        Request::Trophies { .. } => "trophies",
        Request::Earned { .. } => "earned trophies",
    };
    let response = request(client, token, language, &asked)
        .send()
        .await
        .map_err(|_| Refusal::Status(0))?;
    let status = response.status();
    let not_found = status.as_u16() == 404;
    if !status.is_success() {
        debug_answer(step, status);
        if !not_found {
            return Err(Refusal::Status(status.as_u16()));
        }
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ANSWER_BYTES as u64)
    {
        return Err(Refusal::Status(0));
    }
    let body = response.bytes().await.map_err(|_| Refusal::Status(0))?;
    if body.len() > MAX_ANSWER_BYTES {
        return Err(Refusal::Status(0));
    }
    if not_found {
        return Err(Refusal::NotFound(unknown_copy(&body)));
    }
    serde_json::from_slice(&body).map_err(|_| Refusal::Status(0))
}

/// The copy Sony's "Resource not found" names:
/// `{"error":{…,"code":2240525,"message":"Resource not found (npTitleId='CUSA14351_00')"}}`.
fn unknown_copy(body: &[u8]) -> Option<String> {
    let answer: Value = serde_json::from_slice(body).ok()?;
    let message = answer.pointer("/error/message")?.as_str()?;
    let (_, named) = message.split_once("npTitleId='")?;
    let (id, _) = named.split_once('\'')?;
    valid_title_id(id).then(|| id.to_owned())
}

/// PS4 (CUSA) and PS5 (PPSA) copies. Sony's game data also names a game's
/// PS3 and Vita copies, which the trophy service doesn't know.
fn asked_copy(id: &str) -> bool {
    valid_title_id(id) && (id.starts_with("CUSA") || id.starts_with("PPSA"))
}

fn remember(unknown: &mut BTreeSet<String>, id: String) {
    if unknown.len() < MAX_UNKNOWN_COPIES {
        unknown.insert(id);
    }
}

/// The game's lists, then each list's trophies and the player's progress.
/// `unknown` holds the copies Sony doesn't know; this read adds the ones it
/// finds. `Err` carries Sony's status (0: no answer or not Sony's shape); it
/// never reads as "no trophies".
async fn read_trophies<F, Fut>(
    title_ids: &[String],
    unknown: &mut BTreeSet<String>,
    ask: F,
) -> Result<Vec<Trophy>, u16>
where
    F: Fn(Request) -> Fut,
    Fut: Future<Output = Result<Value, Refusal>>,
{
    let mut copies: Vec<String> = Vec::new();
    for id in title_ids {
        if asked_copy(id)
            && !unknown.contains(id)
            && !copies.contains(id)
            && copies.len() < MAX_TITLE_IDS
        {
            copies.push(id.clone());
        }
    }
    let mut lists = Vec::new();
    for batch in copies.chunks(TITLE_IDS_PER_REQUEST) {
        let mut batch = batch.to_vec();
        while !batch.is_empty() {
            match ask(Request::Lists {
                title_ids: batch.clone(),
            })
            .await
            {
                Ok(answer) => {
                    add_lists(&mut lists, &answer)?;
                    break;
                }
                // One copy Sony doesn't know fails the whole request, and
                // Sony names it: the others are asked again without it.
                Err(Refusal::NotFound(Some(id))) if batch.contains(&id) => {
                    batch.retain(|copy| *copy != id);
                    remember(unknown, id);
                }
                // It names none of them: each copy alone.
                Err(Refusal::NotFound(_)) if batch.len() > 1 => {
                    for id in std::mem::take(&mut batch) {
                        match ask(Request::Lists {
                            title_ids: vec![id.clone()],
                        })
                        .await
                        {
                            Ok(answer) => add_lists(&mut lists, &answer)?,
                            Err(Refusal::NotFound(_)) => remember(unknown, id),
                            Err(refusal) => return Err(refusal.status()),
                        }
                    }
                }
                Err(Refusal::NotFound(_)) => remember(unknown, batch.remove(0)),
                Err(refusal) => return Err(refusal.status()),
            }
        }
    }
    // PS5 first, otherwise in Sony's order.
    lists.sort_by_key(|list| list.platform != "PS5");
    lists.truncate(MAX_LISTS);
    let both = lists.iter().any(|list| list.platform == "PS5")
        && lists.iter().any(|list| list.platform == "PS4");
    let mut trophies = Vec::new();
    for list in &lists {
        let defined = pages(&ask, |offset| Request::Trophies {
            list: list.id.clone(),
            service: list.service,
            offset,
        })
        .await?;
        let earned = pages(&ask, |offset| Request::Earned {
            list: list.id.clone(),
            service: list.service,
            offset,
        })
        .await?;
        // Sony names every trophy of a started game, earned or not.
        if earned.is_empty() && !defined.is_empty() {
            return Err(0);
        }
        add_trophies(
            &mut trophies,
            list,
            both.then_some(list.platform),
            &defined,
            &earned,
        );
    }
    // Shows in a debug build what Sony sent. Never names.
    debug_answer(
        "trophies",
        format!("lists: {}, trophies: {}", lists.len(), trophies.len()),
    );
    Ok(trophies)
}

/// The lists Sony names for these copies. `Err(0)`: not Sony's answer.
fn add_lists(lists: &mut Vec<List>, answer: &Value) -> Result<(), u16> {
    let copies = answer.get("titles").and_then(Value::as_array).ok_or(0u16)?;
    for copy in copies {
        // A copy the player never started names none.
        let Some(named) = copy.get("trophyTitles").and_then(Value::as_array) else {
            continue;
        };
        for list in named.iter().filter_map(list_of) {
            if !lists.iter().any(|known| known.id == list.id) {
                lists.push(list);
            }
        }
    }
    Ok(())
}

/// A PS5 or PS4 list. Sony's answer names no console: `trophy2` is the PS5's
/// service, and `trophy` the PS4's for the PS4 and PS5 copies PlayCounter
/// asks about. Other services are left out.
fn list_of(named: &Value) -> Option<List> {
    let id = named.get("npCommunicationId")?.as_str()?.trim();
    // A list id has a title id's shape: NPWR22810_00.
    if !valid_title_id(id) {
        return None;
    }
    let (service, platform) = match named.get("npServiceName")?.as_str()? {
        "trophy2" => ("trophy2", "PS5"),
        "trophy" => ("trophy", "PS4"),
        _ => return None,
    };
    Some(List {
        id: id.to_owned(),
        service,
        platform,
    })
}

/// Every row of one list, page by page as Sony sends them. `Err(0)`: not
/// Sony's answer, or more than any list has.
async fn pages<F, Fut>(ask: &F, page: impl Fn(u64) -> Request) -> Result<Vec<Value>, u16>
where
    F: Fn(Request) -> Fut,
    Fut: Future<Output = Result<Value, Refusal>>,
{
    let mut rows = Vec::new();
    let mut offset = 0;
    for _ in 0..MAX_PAGES {
        let answer = ask(page(offset)).await.map_err(Refusal::status)?;
        let found = answer
            .get("trophies")
            .and_then(Value::as_array)
            .ok_or(0u16)?;
        rows.extend(found.iter().cloned());
        if rows.len() > MAX_TROPHIES {
            return Err(0);
        }
        match answer.get("nextOffset").and_then(Value::as_u64) {
            Some(next) if next > offset && !found.is_empty() => offset = next,
            _ => return Ok(rows),
        }
    }
    Err(0)
}

/// One list's trophies with the player's progress. Only known fields are
/// copied.
fn add_trophies(
    trophies: &mut Vec<Trophy>,
    list: &List,
    platform: Option<&'static str>,
    defined: &[Value],
    earned: &[Value],
) {
    let mine: HashMap<u64, &Value> = earned
        .iter()
        .filter_map(|row| Some((row.get("trophyId")?.as_u64()?, row)))
        .collect();
    let mut seen = HashSet::new();
    for row in defined {
        let Some(number) = row.get("trophyId").and_then(Value::as_u64) else {
            continue;
        };
        if !seen.insert(number) || trophies.len() >= MAX_TROPHIES {
            continue;
        }
        let player = mine.get(&number).copied();
        let field = |name: &str| player.and_then(|row| row.get(name));
        let unlocked = field("earned").and_then(Value::as_bool) == Some(true);
        trophies.push(Trophy {
            id: format!("{}:{number}", list.id),
            name: text(row.get("trophyName")),
            description: text(row.get("trophyDetail")),
            hidden: row.get("trophyHidden").and_then(Value::as_bool) == Some(true),
            unlocked,
            unlocked_at: field("earnedDateTime")
                .and_then(Value::as_str)
                .map(str::trim)
                .and_then(unlock_time)
                .filter(|_| unlocked),
            icon_url: image_url(row.get("trophyIconUrl").and_then(Value::as_str)),
            global_percent: amount(field("trophyEarnedRate"))
                .filter(|percent| (0.0..=100.0).contains(percent)),
            progress: progress(row, player),
            trophy_type: cup(row.get("trophyType")),
            platform,
        });
    }
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

/// A number Sony sends as a number or as text ("12.5").
fn amount(value: Option<&Value>) -> Option<f64> {
    let number = match value? {
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => text.trim().parse().ok()?,
        _ => return None,
    };
    number.is_finite().then_some(number)
}

/// PS5 progress trophies: how far the player is, of how much.
fn progress(row: &Value, player: Option<&Value>) -> Option<Progress> {
    let target = amount(row.get("trophyProgressTargetValue"))
        .or_else(|| amount(player?.get("trophyProgressTargetValue")))
        .filter(|target| *target > 0.0)?;
    let current = amount(player?.get("progress")).filter(|current| *current >= 0.0)?;
    Some(Progress { current, target })
}

/// The trophy's cup. Anything else leaves it without one.
fn cup(value: Option<&Value>) -> Option<&'static str> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "bronze" => Some("bronze"),
        "silver" => Some("silver"),
        "gold" => Some("gold"),
        "platinum" => Some("platinum"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;

    // Sony's real answers, read with Phil's account on 2026-11-02, give the
    // shapes and ids below; trophy names and texts are made up. The list
    // answer names no console (no `trophyTitlePlatform`, unlike psn-api's
    // model), and a game's copies include other regions, editions, PS3 and
    // Vita copies that the trophy service doesn't know.
    const PS5_COPY: &str = "PPSA04609_00";
    const PS4_COPY: &str = "CUSA18638_00";
    const PS5_LIST: &str = "NPWR22810_00";
    const PS4_LIST: &str = "NPWR22809_00";
    const ACCOUNT_ID: &str = "1234567890123456789";
    /// Fortnite (concept 228748): its six copies as Sony's game data names
    /// them. Only CUSA07669_00 has the player's list; CUSA14351_00 and
    /// CUSA17471_00 are unknown to the trophy service.
    const FORTNITE: [&str; 6] = [
        "CUSA07669_00",
        "PPSA01923_00",
        "CUSA14351_00",
        "PPSA01922_00",
        "CUSA07022_00",
        "CUSA17471_00",
    ];
    const FORTNITE_LIST: &str = "NPWR13412_00";

    /// One copy's trophy lists, as `users/me/titles/trophyTitles` named them.
    fn copy(title_id: &str, lists: &[(&str, &str)]) -> Value {
        let lists: Vec<Value> = lists
            .iter()
            .map(|(list, service)| {
                json!({
                    "npServiceName": service,
                    "npCommunicationId": list,
                    "trophyTitleName": "ELDEN RING",
                    "trophyTitleDetail": "",
                    "trophyTitleIconUrl": format!("https://image.api.playstation.com/trophy/np/{list}_00/icon.PNG"),
                    "hasTrophyGroups": false,
                    "trophyGroupCount": 1,
                    "rarestTrophies": [],
                    "progress": 60,
                    "earnedTrophies": {"bronze": 4, "silver": 1, "gold": 1, "platinum": 0},
                    "definedTrophies": {"bronze": 4, "silver": 2, "gold": 2, "platinum": 0},
                    "lastUpdatedDateTime": "2026-08-03T09:46:55Z"
                })
            })
            .collect();
        json!({ "npTitleId": title_id, "trophyTitles": lists })
    }

    fn lists(copies: Vec<Value>) -> Result<Value, Refusal> {
        Ok(json!({ "titles": copies }))
    }

    /// Sony's 404 for a request with a copy it doesn't know.
    fn not_found(title_id: &str) -> Result<Value, Refusal> {
        Err(Refusal::NotFound(Some(title_id.into())))
    }

    fn refused(status: u16) -> Result<Value, Refusal> {
        Err(Refusal::Status(status))
    }

    /// A list's trophies, as `npCommunicationIds/<id>/trophyGroups/all/trophies`
    /// sends them.
    fn defined(rows: Vec<Value>) -> Result<Value, Refusal> {
        Ok(json!({
            "trophySetVersion": "01.00",
            "hasTrophyGroups": false,
            "totalItemCount": rows.len(),
            "trophies": rows
        }))
    }

    fn trophy(list: &str, id: u64, kind: &str, name: &str) -> Value {
        json!({
            "trophyId": id,
            "trophyHidden": false,
            "trophyType": kind,
            "trophyName": name,
            "trophyDetail": format!("About {name}"),
            "trophyIconUrl": format!("https://image.api.playstation.com/trophy/np/{list}_00/{id}.PNG"),
            "trophyGroupId": "default"
        })
    }

    /// Which of them the player earned, as
    /// `users/me/npCommunicationIds/<id>/trophyGroups/all/trophies` sends them.
    fn earned(rows: Vec<Value>) -> Result<Value, Refusal> {
        Ok(json!({
            "trophySetVersion": "01.00",
            "hasTrophyGroups": false,
            "lastUpdatedDateTime": "2026-08-03T09:46:55Z",
            "totalItemCount": rows.len(),
            "trophies": rows
        }))
    }

    fn mine(id: u64, earned_at: Option<&str>, rate: &str) -> Value {
        let mut row = json!({
            "trophyId": id,
            "trophyHidden": false,
            "earned": earned_at.is_some(),
            "trophyType": "bronze",
            "trophyRare": 3,
            "trophyEarnedRate": rate
        });
        if let Some(at) = earned_at {
            row["earnedDateTime"] = json!(at);
        }
        row
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn lists_of(title_ids: &[&str]) -> Request {
        Request::Lists {
            title_ids: ids(title_ids),
        }
    }

    fn trophies_of(list: &str, service: &'static str) -> Request {
        Request::Trophies {
            list: list.into(),
            service,
            offset: 0,
        }
    }

    fn earned_of(list: &str, service: &'static str) -> Request {
        Request::Earned {
            list: list.into(),
            service,
            offset: 0,
        }
    }

    /// Reads against canned answers, in order, with these copies already
    /// known to be unknown. Returns what was asked.
    async fn run_knowing(
        unknown: &mut BTreeSet<String>,
        title_ids: &[&str],
        answers: Vec<Result<Value, Refusal>>,
    ) -> (Result<Vec<Trophy>, u16>, Vec<Request>) {
        let asked = Mutex::new(Vec::new());
        let answers = Mutex::new(VecDeque::from(answers));
        let read = read_trophies(&ids(title_ids), unknown, |question| {
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

    async fn run(
        title_ids: &[&str],
        answers: Vec<Result<Value, Refusal>>,
    ) -> (Result<Vec<Trophy>, u16>, Vec<Request>) {
        run_knowing(&mut BTreeSet::new(), title_ids, answers).await
    }

    /// One PS5 list with these trophies and progress.
    async fn ps5_game(rows: Vec<Value>, progress: Vec<Value>) -> Vec<Trophy> {
        let (read, _) = run(
            &[PS5_COPY],
            vec![
                lists(vec![copy(PS5_COPY, &[(PS5_LIST, "trophy2")])]),
                defined(rows),
                earned(progress),
            ],
        )
        .await;
        read.unwrap_or_else(|status| panic!("Sony answered {status}"))
    }

    fn find<'a>(trophies: &'a [Trophy], id: &str) -> &'a Trophy {
        trophies
            .iter()
            .find(|trophy| trophy.id == id)
            .unwrap_or_else(|| panic!("no {id}"))
    }

    #[tokio::test]
    async fn asks_sony_for_the_lists_five_copies_at_a_time() {
        let copies = [
            "PPSA00001_00",
            "PPSA00002_00",
            "PPSA00003_00",
            "PPSA00004_00",
            "PPSA00005_00",
            "PPSA00006_00",
            PS5_COPY,
        ];
        let (read, asked) = run(
            &copies,
            vec![
                // Copies without a list of the player's: no trophy lists.
                lists(copies[..5].iter().map(|id| copy(id, &[])).collect()),
                lists(vec![
                    copy("PPSA00006_00", &[]),
                    copy(PS5_COPY, &[(PS5_LIST, "trophy2")]),
                ]),
                defined(vec![trophy(PS5_LIST, 0, "platinum", "Elden Ring")]),
                earned(vec![mine(0, None, "7.4")]),
            ],
        )
        .await;
        assert_eq!(
            asked,
            vec![
                lists_of(&copies[..5]),
                lists_of(&copies[5..]),
                trophies_of(PS5_LIST, "trophy2"),
                earned_of(PS5_LIST, "trophy2"),
            ]
        );
        assert_eq!(read.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn two_copies_of_one_list_count_it_once() {
        // Two regions' copies share one list.
        let (read, asked) = run(
            &[PS5_COPY, "PPSA04608_00"],
            vec![
                lists(vec![
                    copy(PS5_COPY, &[(PS5_LIST, "trophy2")]),
                    copy("PPSA04608_00", &[(PS5_LIST, "trophy2")]),
                ]),
                defined(vec![
                    trophy(PS5_LIST, 0, "platinum", "Elden Ring"),
                    trophy(PS5_LIST, 1, "gold", "Elden Lord"),
                ]),
                earned(vec![mine(0, None, "7.4"), mine(1, None, "20.1")]),
            ],
        )
        .await;
        assert_eq!(asked.len(), 3);
        let trophies = read.unwrap();
        assert_eq!(
            trophies.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            [format!("{PS5_LIST}:0"), format!("{PS5_LIST}:1")]
        );
        // One list: no PS5/PS4 buttons.
        assert!(trophies.iter().all(|t| t.platform.is_none()));
    }

    #[tokio::test]
    async fn the_console_comes_from_sonys_service_trophy2_is_ps5_and_trophy_ps4() {
        // Sony's list answer names no console.
        let (read, asked) = run(
            &[PS4_COPY, PS5_COPY],
            vec![
                // Sony names the PS4 copy first.
                lists(vec![
                    copy(PS4_COPY, &[(PS4_LIST, "trophy")]),
                    copy(PS5_COPY, &[(PS5_LIST, "trophy2")]),
                ]),
                defined(vec![
                    trophy(PS5_LIST, 0, "platinum", "Elden Ring"),
                    trophy(PS5_LIST, 1, "gold", "Elden Lord"),
                ]),
                earned(vec![mine(0, None, "7.4"), mine(1, None, "20.1")]),
                defined(vec![trophy(PS4_LIST, 0, "platinum", "Elden Ring")]),
                earned(vec![mine(0, Some("2024-01-02T10:00:00Z"), "9.9")]),
            ],
        )
        .await;
        assert_eq!(
            asked,
            vec![
                lists_of(&[PS4_COPY, PS5_COPY]),
                trophies_of(PS5_LIST, "trophy2"),
                earned_of(PS5_LIST, "trophy2"),
                trophies_of(PS4_LIST, "trophy"),
                earned_of(PS4_LIST, "trophy"),
            ]
        );
        let trophies = read.unwrap();
        assert_eq!(
            trophies
                .iter()
                .map(|t| (t.id.as_str(), t.platform))
                .collect::<Vec<_>>(),
            [
                ("NPWR22810_00:0", Some("PS5")),
                ("NPWR22810_00:1", Some("PS5")),
                ("NPWR22809_00:0", Some("PS4")),
            ]
        );
        // Both lists have a trophy 0; each keeps its own.
        assert!(!trophies[0].unlocked);
        assert!(trophies[2].unlocked);

        // A service PlayCounter doesn't know is left out.
        let (read, asked) = run(
            &[PS5_COPY],
            vec![lists(vec![copy(PS5_COPY, &[("NPWR10004_00", "trophy3")])])],
        )
        .await;
        assert_eq!(read, Ok(vec![]));
        assert_eq!(asked.len(), 1);
    }

    #[tokio::test]
    async fn reads_a_ps4_list_the_way_sony_sent_roblox() {
        // Roblox: two copies, only the PS4 one has the player's list, 4
        // bronze, 2 silver and 2 gold trophies, 6 of them earned.
        let kinds = [
            "bronze", "bronze", "bronze", "bronze", "silver", "silver", "gold", "gold",
        ];
        let won = [0, 1, 2, 3, 4, 6];
        let (read, asked) = run(
            &["CUSA06122_00", "PPSA10990_00"],
            vec![
                lists(vec![
                    copy("PPSA10990_00", &[]),
                    copy("CUSA06122_00", &[("NPWR38289_00", "trophy")]),
                ]),
                defined(
                    kinds
                        .iter()
                        .enumerate()
                        .map(|(id, kind)| trophy("NPWR38289_00", id as u64, kind, "Trophy"))
                        .collect(),
                ),
                earned(
                    (0..8)
                        .map(|id| {
                            let at = won.contains(&id).then_some("2026-08-03T09:46:55Z");
                            mine(id, at, "88.2")
                        })
                        .collect(),
                ),
            ],
        )
        .await;
        assert_eq!(
            asked[1..],
            [
                trophies_of("NPWR38289_00", "trophy"),
                earned_of("NPWR38289_00", "trophy"),
            ]
        );
        let trophies = read.unwrap();
        assert_eq!(trophies.len(), 8);
        assert_eq!(trophies.iter().filter(|t| t.unlocked).count(), 6);
        assert_eq!(
            find(&trophies, "NPWR38289_00:0").unlocked_at,
            // 2026-08-03 09:46:55 UTC
            Some(1_785_750_415_000)
        );
        assert_eq!(find(&trophies, "NPWR38289_00:0").global_percent, Some(88.2));
        assert_eq!(find(&trophies, "NPWR38289_00:7").trophy_type, Some("gold"));
        // One list: no PS5/PS4 buttons.
        assert!(trophies.iter().all(|t| t.platform.is_none()));
    }

    #[tokio::test]
    async fn ps3_and_vita_copies_are_never_asked() {
        // Minecraft's copies include PS3 (NPEB, NPUB) and Vita (PCSE, PCSB)
        // ones; Sony's trophy service doesn't know them.
        let (_, asked) = run(
            &[
                "CUSA00265_00",
                "NPEB01899_00",
                "PCSE00491_00",
                "PCSB00560_00",
                "NPUB31419_00",
                "PPSA19640_00",
            ],
            vec![lists(vec![
                copy("CUSA00265_00", &[]),
                copy("PPSA19640_00", &[]),
            ])],
        )
        .await;
        assert_eq!(asked, vec![lists_of(&["CUSA00265_00", "PPSA19640_00"])]);
    }

    #[tokio::test]
    async fn a_copy_sony_doesnt_know_is_dropped_and_the_others_asked_again() {
        let mut unknown = BTreeSet::new();
        let (read, asked) = run_knowing(
            &mut unknown,
            &FORTNITE,
            vec![
                not_found("CUSA14351_00"),
                lists(vec![
                    copy("CUSA07669_00", &[(FORTNITE_LIST, "trophy")]),
                    copy("PPSA01923_00", &[]),
                    copy("PPSA01922_00", &[]),
                    copy("CUSA07022_00", &[]),
                ]),
                not_found("CUSA17471_00"),
                defined(vec![trophy(FORTNITE_LIST, 0, "platinum", "Fortnite")]),
                earned(vec![mine(0, None, "1.2")]),
            ],
        )
        .await;
        assert_eq!(
            asked,
            vec![
                lists_of(&FORTNITE[..5]),
                lists_of(&[
                    "CUSA07669_00",
                    "PPSA01923_00",
                    "PPSA01922_00",
                    "CUSA07022_00"
                ]),
                lists_of(&["CUSA17471_00"]),
                trophies_of(FORTNITE_LIST, "trophy"),
                earned_of(FORTNITE_LIST, "trophy"),
            ]
        );
        assert_eq!(read.unwrap().len(), 1);
        assert_eq!(
            unknown.iter().map(String::as_str).collect::<Vec<_>>(),
            ["CUSA14351_00", "CUSA17471_00"]
        );

        // The next read doesn't ask for them.
        let (_, asked) = run_knowing(
            &mut unknown,
            &FORTNITE,
            vec![
                lists(vec![copy("CUSA07669_00", &[(FORTNITE_LIST, "trophy")])]),
                defined(vec![trophy(FORTNITE_LIST, 0, "platinum", "Fortnite")]),
                earned(vec![mine(0, None, "1.2")]),
            ],
        )
        .await;
        assert_eq!(
            asked[0],
            lists_of(&[
                "CUSA07669_00",
                "PPSA01923_00",
                "PPSA01922_00",
                "CUSA07022_00"
            ])
        );
        assert_eq!(asked.len(), 3);
    }

    #[tokio::test]
    async fn a_not_found_that_names_no_copy_of_the_request_asks_each_copy_alone() {
        let mut unknown = BTreeSet::new();
        let (read, asked) = run_knowing(
            &mut unknown,
            &[PS5_COPY, "PPSA99999_00"],
            vec![
                Err(Refusal::NotFound(None)),
                lists(vec![copy(PS5_COPY, &[(PS5_LIST, "trophy2")])]),
                Err(Refusal::NotFound(Some("CUSA00000_00".into()))),
                defined(vec![trophy(PS5_LIST, 0, "platinum", "Elden Ring")]),
                earned(vec![mine(0, None, "7.4")]),
            ],
        )
        .await;
        assert_eq!(
            asked[..3],
            [
                lists_of(&[PS5_COPY, "PPSA99999_00"]),
                lists_of(&[PS5_COPY]),
                lists_of(&["PPSA99999_00"]),
            ]
        );
        assert_eq!(read.unwrap().len(), 1);
        assert_eq!(
            unknown.iter().map(String::as_str).collect::<Vec<_>>(),
            ["PPSA99999_00"]
        );
        // The game's only copy.
        let (read, asked) = run(&["PPSA99999_00"], vec![Err(Refusal::NotFound(None))]).await;
        assert_eq!(read, Ok(vec![]));
        assert_eq!(asked.len(), 1);
    }

    #[test]
    fn sonys_not_found_names_the_copy_it_doesnt_know() {
        // Sony's real answer, 2026-11-02.
        let body = br#"{"error":{"referenceId":"550c5073-d6de-11f1-b7d0-e73ad4379485","code":2240525,"message":"Resource not found (npTitleId='CUSA14351_00')"}}"#;
        assert_eq!(unknown_copy(body).as_deref(), Some("CUSA14351_00"));
        for body in [
            &b"{}"[..],
            b"not json",
            br#"{"error":{"code":2240525,"message":"Resource not found"}}"#,
            br#"{"error":{"message":"Resource not found (npTitleId='../x')"}}"#,
            br#"{"error":{"message":"Resource not found (npTitleId='CUSA14351_00"}}"#,
        ] {
            assert_eq!(
                unknown_copy(body),
                None,
                "{}",
                String::from_utf8_lossy(body)
            );
        }
    }

    #[tokio::test]
    async fn reads_names_cups_dates_hidden_trophies_and_the_share_of_players() {
        let mut hidden = trophy(PS5_LIST, 1, "gold", "Elden Lord");
        hidden["trophyHidden"] = json!(true);
        let trophies = ps5_game(
            vec![
                trophy(PS5_LIST, 0, "platinum", "Elden Ring"),
                hidden,
                trophy(PS5_LIST, 2, "bronze", "Shardbearer Godrick"),
                trophy(PS5_LIST, 3, "silver", "Odd Date"),
                trophy(PS5_LIST, 4, "diamond", "Not a Cup"),
            ],
            vec![
                mine(0, None, "7.4"),
                mine(1, None, "0.9"),
                mine(2, Some("2026-10-30T21:22:08Z"), "58.1"),
                // Earned on a day Sony wrote in a form PlayCounter can't read.
                mine(3, Some("yesterday"), "50"),
                // Not a share of players.
                mine(4, None, "150.0"),
            ],
        )
        .await;
        assert_eq!(
            find(&trophies, "NPWR22810_00:2"),
            &Trophy {
                id: "NPWR22810_00:2".into(),
                name: "Shardbearer Godrick".into(),
                description: "About Shardbearer Godrick".into(),
                hidden: false,
                unlocked: true,
                // 2026-10-30 21:22:08 UTC
                unlocked_at: Some(1_793_395_328_000),
                icon_url: Some(
                    "https://image.api.playstation.com/trophy/np/NPWR22810_00_00/2.PNG".into()
                ),
                global_percent: Some(58.1),
                progress: None,
                trophy_type: Some("bronze"),
                platform: None,
            }
        );
        let platinum = find(&trophies, "NPWR22810_00:0");
        assert_eq!(platinum.trophy_type, Some("platinum"));
        assert!(!platinum.unlocked);
        assert_eq!(platinum.unlocked_at, None);
        assert_eq!(platinum.global_percent, Some(7.4));
        let secret = find(&trophies, "NPWR22810_00:1");
        assert!(secret.hidden);
        assert_eq!(secret.trophy_type, Some("gold"));
        let odd = find(&trophies, "NPWR22810_00:3");
        assert!(odd.unlocked);
        assert_eq!(odd.unlocked_at, None);
        assert_eq!(odd.trophy_type, Some("silver"));
        let not_a_cup = find(&trophies, "NPWR22810_00:4");
        assert_eq!(not_a_cup.trophy_type, None);
        assert_eq!(not_a_cup.global_percent, None);
        assert_eq!(trophies.len(), 5);
    }

    #[tokio::test]
    async fn the_share_of_players_reads_as_text_or_number() {
        let mut as_number = mine(0, None, "");
        as_number["trophyEarnedRate"] = json!(12.5);
        let mut missing = mine(1, None, "");
        missing.as_object_mut().unwrap().remove("trophyEarnedRate");
        let trophies = ps5_game(
            vec![
                trophy(PS5_LIST, 0, "bronze", "A"),
                trophy(PS5_LIST, 1, "bronze", "B"),
                trophy(PS5_LIST, 2, "bronze", "C"),
                trophy(PS5_LIST, 3, "bronze", "D"),
            ],
            vec![
                as_number,
                missing,
                mine(2, None, " 0.0 "),
                mine(3, None, "lots"),
            ],
        )
        .await;
        assert_eq!(find(&trophies, "NPWR22810_00:0").global_percent, Some(12.5));
        assert_eq!(find(&trophies, "NPWR22810_00:1").global_percent, None);
        assert_eq!(find(&trophies, "NPWR22810_00:2").global_percent, Some(0.0));
        assert_eq!(find(&trophies, "NPWR22810_00:3").global_percent, None);
    }

    #[tokio::test]
    async fn ps5_progress_trophies_carry_their_progress() {
        let target = |id: u64, value: Value| {
            let mut row = trophy(PS5_LIST, id, "silver", "Collector");
            row["trophyProgressTargetValue"] = value;
            row
        };
        let progress = |id: u64, value: Value| {
            let mut row = mine(id, None, "20.3");
            row["progress"] = value;
            row["progressRate"] = json!(74);
            row["progressedDateTime"] = json!("2026-10-30T20:00:00Z");
            row
        };
        let trophies = ps5_game(
            vec![
                // Sony's text form (psn-api), and numbers (PSNAWP).
                target(0, json!("50")),
                target(1, json!(100)),
                // Nothing to count towards.
                target(2, json!("0")),
                trophy(PS5_LIST, 3, "bronze", "No target"),
                // Not started yet.
                target(4, json!("10")),
            ],
            vec![
                progress(0, json!("37")),
                progress(1, json!(45)),
                progress(2, json!("3")),
                progress(3, json!("3")),
                mine(4, None, "20.3"),
            ],
        )
        .await;
        let of = |id: &str| find(&trophies, id).progress;
        assert_eq!(
            of("NPWR22810_00:0"),
            Some(Progress {
                current: 37.0,
                target: 50.0
            })
        );
        assert_eq!(
            of("NPWR22810_00:1"),
            Some(Progress {
                current: 45.0,
                target: 100.0
            })
        );
        assert_eq!(of("NPWR22810_00:2"), None);
        assert_eq!(of("NPWR22810_00:3"), None);
        assert_eq!(of("NPWR22810_00:4"), None);
    }

    #[tokio::test]
    async fn icons_come_only_from_sonys_image_hosts() {
        let icon = |id: u64, url: &str| {
            let mut row = trophy(PS5_LIST, id, "bronze", "Icon");
            row["trophyIconUrl"] = json!(url);
            row
        };
        let urls = [
            "https://image.api.playstation.com/trophy/np/NPWR22810_00_00/1.PNG",
            "https://psnobj.prod.dl.playstation.net/psnobj/NPWR22810_00/2.png",
            "http://image.api.playstation.com/trophy/3.PNG",
            "https://evil.test/4.png",
            "https://image.api.playstation.com.evil.test/5.png",
            "https://user@image.api.playstation.com/6.png",
            "https://image.api.playstation.com:8443/7.png",
        ];
        let trophies = ps5_game(
            urls.iter()
                .enumerate()
                .map(|(id, url)| icon(id as u64, url))
                .collect(),
            (0..urls.len() as u64)
                .map(|id| mine(id, None, "1"))
                .collect(),
        )
        .await;
        assert_eq!(
            trophies
                .iter()
                .map(|t| t.icon_url.as_deref())
                .collect::<Vec<_>>(),
            [Some(urls[0]), Some(urls[1]), None, None, None, None, None]
        );
    }

    #[tokio::test]
    async fn a_game_without_lists_has_no_trophies_and_nothing_more_is_asked() {
        for answer in [
            lists(vec![copy(PS5_COPY, &[])]),
            lists(vec![]),
            // No list Sony names for a copy.
            lists(vec![json!({ "npTitleId": PS5_COPY })]),
        ] {
            let (read, asked) = run(&[PS5_COPY], vec![answer]).await;
            assert_eq!(read, Ok(vec![]));
            assert_eq!(asked.len(), 1);
        }
        // No copy to ask for.
        let (read, asked) = run(&[], vec![]).await;
        assert_eq!(read, Ok(vec![]));
        assert!(asked.is_empty());
    }

    #[tokio::test]
    async fn sonys_refusals_and_outages_reach_the_caller_and_never_read_as_no_trophies() {
        let found = || lists(vec![copy(PS5_COPY, &[(PS5_LIST, "trophy2")])]);
        let rows = || defined(vec![trophy(PS5_LIST, 0, "platinum", "Elden Ring")]);
        for status in [0, 401, 403, 429, 500, 503] {
            for answers in [
                vec![refused(status)],
                vec![found(), refused(status)],
                vec![found(), rows(), refused(status)],
            ] {
                let steps = answers.len();
                let (read, asked) = run(&[PS5_COPY], answers).await;
                assert_eq!(read, Err(status), "{status} after {steps} steps");
                assert_eq!(asked.len(), steps);
            }
        }
        // A list Sony itself named can't be "not found".
        for answers in [
            vec![found(), not_found(PS5_COPY)],
            vec![found(), rows(), not_found(PS5_COPY)],
        ] {
            let steps = answers.len();
            let (read, asked) = run(&[PS5_COPY], answers).await;
            assert_eq!(read, Err(404), "after {steps} steps");
            assert_eq!(asked.len(), steps);
        }
        // Answers that aren't Sony's.
        for answers in [
            vec![Ok(json!({}))],
            vec![Ok(json!({ "titles": "none" }))],
            vec![Ok(json!([]))],
            vec![found(), Ok(json!({}))],
            vec![found(), Ok(json!({ "trophies": null }))],
            vec![found(), rows(), Ok(json!({ "trophies": "none" }))],
            // A list without any of the player's rows is not "all locked".
            vec![found(), rows(), earned(vec![])],
        ] {
            let steps = answers.len();
            let (read, asked) = run(&[PS5_COPY], answers).await;
            assert_eq!(read, Err(0), "after {steps} steps");
            assert_eq!(asked.len(), steps);
        }
    }

    #[tokio::test]
    async fn reads_every_page_sony_sends() {
        let page = |rows: Value, next: Option<u64>| {
            let mut page =
                json!({ "trophySetVersion": "01.00", "totalItemCount": 3, "trophies": rows });
            if let Some(next) = next {
                page["nextOffset"] = json!(next);
            }
            Ok(page)
        };
        let (read, asked) = run(
            &[PS5_COPY],
            vec![
                lists(vec![copy(PS5_COPY, &[(PS5_LIST, "trophy2")])]),
                page(
                    json!([
                        trophy(PS5_LIST, 0, "platinum", "A"),
                        trophy(PS5_LIST, 1, "gold", "B")
                    ]),
                    Some(2),
                ),
                page(json!([trophy(PS5_LIST, 2, "bronze", "C")]), None),
                page(json!([mine(0, None, "1"), mine(1, None, "2")]), Some(2)),
                page(json!([mine(2, Some("2026-10-30T21:22:08Z"), "3")]), None),
            ],
        )
        .await;
        assert_eq!(
            asked[1..],
            [
                trophies_of(PS5_LIST, "trophy2"),
                Request::Trophies {
                    list: PS5_LIST.into(),
                    service: "trophy2",
                    offset: 2
                },
                earned_of(PS5_LIST, "trophy2"),
                Request::Earned {
                    list: PS5_LIST.into(),
                    service: "trophy2",
                    offset: 2
                },
            ]
        );
        let trophies = read.unwrap();
        assert_eq!(trophies.len(), 3);
        assert!(find(&trophies, "NPWR22810_00:2").unlocked);
    }

    #[tokio::test]
    async fn only_real_title_ids_are_asked_for_and_at_most_32() {
        let (_, asked) = run(
            &[
                PS5_COPY,
                PS5_COPY,
                "../x",
                "ppsa04609_00",
                "PPSA04609_0",
                "PPSA04609_00?x",
                "",
            ],
            vec![lists(vec![copy(PS5_COPY, &[])])],
        )
        .await;
        assert_eq!(asked, vec![lists_of(&[PS5_COPY])]);

        let many: Vec<String> = (1..=40).map(|n| format!("PPSA{n:05}_00")).collect();
        let many: Vec<&str> = many.iter().map(String::as_str).collect();
        let (_, asked) = run(&many, (0..7).map(|_| lists(vec![])).collect()).await;
        assert_eq!(asked.len(), 7);
        assert_eq!(asked[6], lists_of(&many[30..32]));
    }

    #[test]
    fn every_request_carries_the_sign_in_and_the_players_language() {
        let client = crate::library::playstation_account::http_client().unwrap();
        let built = |asked: Request| {
            request(&client, "ps-access", "de-DE", &asked)
                .build()
                .unwrap()
        };
        let lists = built(lists_of(&[PS5_COPY, PS4_COPY]));
        assert_eq!(
            lists.url().as_str(),
            "https://m.np.playstation.com/api/trophy/v1/users/me/titles/trophyTitles?npTitleIds=PPSA04609_00%2CCUSA18638_00"
        );
        let trophies = built(trophies_of(PS5_LIST, "trophy2"));
        assert_eq!(
            trophies.url().as_str(),
            "https://m.np.playstation.com/api/trophy/v1/npCommunicationIds/NPWR22810_00/trophyGroups/all/trophies?npServiceName=trophy2"
        );
        let earned = built(Request::Earned {
            list: PS4_LIST.into(),
            service: "trophy",
            offset: 2,
        });
        assert_eq!(
            earned.url().as_str(),
            "https://m.np.playstation.com/api/trophy/v1/users/me/npCommunicationIds/NPWR22809_00/trophyGroups/all/trophies?npServiceName=trophy&offset=2"
        );
        for sent in [&lists, &trophies, &earned] {
            assert_eq!(sent.headers()["authorization"], "Bearer ps-access");
            assert_eq!(sent.headers()["accept-language"], "de-DE");
            // "me": the account id never goes into an address.
            assert!(!sent.url().as_str().contains(ACCOUNT_ID));
        }
    }

    #[test]
    fn the_app_languages_map_to_sonys_and_others_to_english() {
        assert_eq!(sony_language("de-DE"), "de-DE");
        assert_eq!(sony_language("zh-CN"), "zh-CN");
        assert_eq!(sony_language("pt-BR"), "pt-BR");
        assert_eq!(sony_language("klingon"), "en-US");
        assert_eq!(sony_language(""), "en-US");
    }

    #[tokio::test]
    async fn the_web_ui_gets_only_the_trophy_fields_never_the_account() {
        // Fields nobody asked for: only known fields are copied.
        let mut planted = trophy(PS5_LIST, 0, "silver", "Collector");
        planted["accountId"] = json!(ACCOUNT_ID);
        planted["access_token"] = json!("ps-access");
        planted["trophyProgressTargetValue"] = json!("50");
        let mut progress = mine(0, Some("2026-10-30T21:22:08Z"), "58.1");
        progress["onlineId"] = json!("zesarex_ps");
        progress["progress"] = json!("50");
        let trophies = ps5_game(vec![planted], vec![progress]).await;
        let sent = serde_json::to_value(&trophies).unwrap();
        assert_eq!(
            sent,
            json!([{
                "id": "NPWR22810_00:0",
                "name": "Collector",
                "description": "About Collector",
                "hidden": false,
                "unlocked": true,
                "unlockedAt": 1_793_395_328_000u64,
                "iconUrl": "https://image.api.playstation.com/trophy/np/NPWR22810_00_00/0.PNG",
                "globalPercent": 58.1,
                "progress": { "current": 50.0, "target": 50.0 },
                "trophyType": "silver"
            }])
        );
    }
}
