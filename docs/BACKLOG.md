# Backlog

Deferred issues and ideas, mostly from the 2026-07-10 matching/community rework.
Ordered roughly by relevance.

## 1. "Report bad match" for non-games (moderation endpoint)

An exe like `AI.exe` wrongly IGDB-mapped to a real game (Alien: Isolation)
pollutes matching and anonymous live stats for **all** users. Users can fix
it locally (Ignore / Convert to Custom), but nothing corrects the shared
mapping when there is no correct game to suggest. Idea from Phil's flow
diagram: a "report bad match" endpoint + moderation action that deletes or
blocks the `igdb_game_identifiers` row for that exe.

## 2. Renaming a custom game with a pending suggestion

Rename only changes the local display name; the pending suggestion keeps the
originally selected DB name. On approval the local entry keeps the renamed
title while the server-side community game carries the suggested name —
cosmetic inconsistency, deliberately not blocked. Option: lock renaming while
"awaiting approval", or reset the name on conversion.

## 3. "Check for Matches" with multi-exe games

The dialog checks and rewrites only `exeNames[0]`. Fine for the standard
1-exe-per-game case; games aggregated from multiple exes would need per-exe
handling.



