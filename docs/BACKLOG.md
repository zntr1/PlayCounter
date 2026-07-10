# Backlog

Deferred issues and ideas, mostly from the 2026-07-10 matching/community rework.
Ordered roughly by relevance.

## 1. Rejection detection fails when the exe still matches something (known gap)

**Problem:** The client detects a rejected community suggestion (rejection =
moderator deletes the unverified `community_games` row) by the server
returning *nothing* for the exe — neither a match nor `pendingCommunityGame`.
But `matchProcesses` only checks pending suggestions for exes that are
otherwise **unresolved**. If the exe still resolves to any stored game
(e.g. the wrong IGDB mapping that prompted the correction in the first place)
or to an ambiguous set, the response contains a game/candidates, the client
cannot distinguish "still pending" from "rejected", and the
"Awaiting community approval" badge sticks forever (plus a possibly confusing
upgrade offer for the old wrong game).

**Repro chain:** exe wrongly matched by IGDB → "Convert to Custom Game" (or
"Report Wrong Match") → "Suggest to Community" → moderator rejects (deletes
row) → badge never clears, because the exe still matches the old IGDB game.

**Fix sketch (small):**
- Server: in `matchProcesses`, query pending community entries for **all**
  lookup keys (not just unresolved ones) and attach `pendingCommunityGame`
  to results even when `game`/`ambiguousGames` is set
  (`stripProcessMatchPriority` currently only sets it on absent keys).
- Client: `checkCommunityUpgrades` / `applyCommunitySuggestionOutcome` then
  becomes authoritative: entry has an unverified suggestion marker and the
  response carries no `pendingCommunityGame` → suggestion was rejected →
  clear the marker (existing `clearCommunitySuggestionMarker`).

**Severity:** low — no data loss, no wrong tracking, purely a stale badge +
offer noise. Becomes more relevant as correction flows get used.

## 2. "Report bad match" for non-games (moderation endpoint)

An exe like `AI.exe` wrongly IGDB-mapped to a real game (Alien: Isolation)
pollutes matching and anonymous live stats for **all** users. Users can fix
it locally (Ignore / Convert to Custom), but nothing corrects the shared
mapping when there is no correct game to suggest. Idea from Phil's flow
diagram: a "report bad match" endpoint + moderation action that deletes or
blocks the `igdb_game_identifiers` row for that exe.

## 3. Renaming a custom game with a pending suggestion

Rename only changes the local display name; the pending suggestion keeps the
originally selected DB name. On approval the local entry keeps the renamed
title while the server-side community game carries the suggested name —
cosmetic inconsistency, deliberately not blocked. Option: lock renaming while
"awaiting approval", or reset the name on conversion.

## 4. "Check for Matches" with multi-exe games

The dialog checks and rewrites only `exeNames[0]`. Fine for the standard
1-exe-per-game case; games aggregated from multiple exes would need per-exe
handling.

## 5. Exe icons missing for elevated processes / window-only icons

Discovered shows file icons via `get_exe_icon` (systemicons). Two gaps:
(a) elevated processes (anti-cheat games, admin launchers) expose no exe path
to a non-elevated scanner — snapshot has `exe_path: null`, no icon possible;
(b) some shipping builds embed no icon in the exe — the taskbar icon is the
**window** icon set at runtime. Real fix: extract the window icon via Win32
(find window by PID, `WM_GETICON`/`GCLP_HICON`, HICON -> PNG) and plumb the
PID through `ProcessSnapshot`. Unsafe WinAPI work, needs on-machine testing.

## 6. Ambiguity picker candidates are never pruned

`igdb_ambiguous_game_identifiers` rows (and multiple verified community
entries) accumulate per exe; every new user keeps seeing the picker even after
the community has effectively settled on one game. Possible future signal:
count picker selections (anonymous) and auto-prioritize/collapse.
