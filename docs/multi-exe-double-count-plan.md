# Fix double-counted playtime when one game has several executables

> Revision 4 — precision pass. The fragment bound is stated correctly (windows +
> covered sessions, not 200) and fragments are added in one store write, the
> emergency compaction budget is pinned at 0, global eviction is by globally
> oldest window, and `trackedSeconds` is consistently described as the
> approximate bucket that only compaction still writes.
>
> Revision 3 — after the second review. Changes: the 20-fragment cap is gone
> (bridging gaps would re-credit covered time), the overlap merge on the
> re-attribution paths is dropped, and the quota fallback is adopted by both
> persist paths.
>
> Revision 2 — after the first review. Changes: no gap tolerance when merging
> windows (was ≤60s), legacy `trackedSeconds` is no longer converted into a
> fabricated interval, `shareTrackedCustomGame` gets an explicit session-id
> reassignment, and runtime windows get a global storage budget with a
> compaction path.

## Context

Mortal Shell 2 runs as two processes at once: `MortalShell2.exe` and
`MortalShell2-Win64-Shipping.exe`. Neither is in IGDB, our IGDB table, or the
community table, so both show up as unknown. After an hour of play, both appear
in Discover with ~1h "Tracked so far". Adding and sharing both to the community
credits **two 1h sessions** for the same game — 2h of playtime for 1h of play.

We *did* fix this — but only for the live path. Commit `58f22f1` moved active
sessions from per-exe to per-game keys (`activeSessionKey = source:gameId`), so
several running executables of one game share one session
(`tracker.ts:334`, `startSession:1424`, `collapseDuplicateActiveSessions:2512`).
That fix never reached the **discovery backfill path**, which is what runs when a
game is only linked *after* it was played.

### Root cause

`accumulateUnmatchedRuntime` (`apps/desktop/src/tracker.ts:1274`) accumulates
runtime **per executable** as a plain number (`ExeCacheEntry.trackedSeconds`,
`store.ts:77`). Two executables of one game running at the same wall-clock hour
each accumulate 3600s. `backfillTrackedRuntime` (`tracker.ts:1338`) then credits
that number **per executable**, as one synthetic session stamped
`[now - total, now]`, with no knowledge of what the game already has:

```ts
useAppStore.getState().addSession({
  gameId: game.id, ... exeName,
  startedAt: new Date(now - total * 1000).toISOString(),
  endedAt: new Date(now).toISOString(),
  durationSeconds: total,
});
```

Called from `cacheMatchResult:1400`, `addCustomGame:1740`,
`addSharedCustomGame:1782`. None of them consult existing sessions. Because both
exes share one community suggestion id, `sharedCustomGameId` (`tracker.ts:2611`)
gives them the *same* local game id — so the two sessions sit on the same game
and history simply sums them.

A second, worse variant: once exe A is linked, exe B stays `unmatched` and keeps
accumulating for **every later play session**. Linking B weeks later credits all
of that a second time.

Two structural problems, both from the scalar counter:

1. No de-duplication of wall-clock time across executables of one game.
2. The accumulated time has no timestamps, so credited play always lands on
   "today" in history, and overlap with real sessions cannot be detected.

Server side needs no change: `/api/match-processes` and the community tables
already collapse multi-exe games onto one game row (migration 010,
`community_game_aliases`). This is purely a desktop-client accounting bug.

## Approach

Record **real runtime windows** for discovered executables, and credit only the
wall-clock time the target game does not already have recorded.

```
ExeCacheEntry:
   trackedSeconds?: number          // approximate bucket: legacy data + compaction
+  runtimeWindows?: { startedAt: string; endedAt: string }[]
   runningSince?: string            // unchanged: the open window

credit(exe, game):
  windows  = exe.runtimeWindows + open remainder from runningSince
  covered  = intervals of sessions already recorded for source:gameId
  emit one session per (windows \ covered) fragment >= 60s
```

For Mortal Shell 2: exe A is credited `[t0, t0+1h]`; exe B's identical window is
fully covered and credits nothing. Playtime is correct, and it lands on the day
it was actually played.

Per your decision, **existing history is left untouched** — no hydrate-time
repair. Delete the duplicate Mortal Shell 2 session by hand in History.

### Two crediting paths, deliberately separate

Precise (windows) and approximate (legacy scalar) never mix. Everything
accumulated from this version on is precise; the legacy scalar is a one-time
leftover that disappears the first time its exe is linked or ignored.

## Steps

### 1. New pure module `apps/desktop/src/runtimeWindows.ts`

Interval math kept out of the store so it is unit-testable (`tracker.ts` has no
tests today; `store.ts` is zustand-bound).

- `type Interval = { start: number; end: number }` (epoch ms)
- `normalizeIntervals(intervals)` — sort by start, merge **only** intervals that
  overlap or touch exactly (`next.start <= current.end`). **No gap tolerance.**
  The checkpoint fold closes `[runningSince, now]` and immediately reopens at the
  same `now`, so consecutive folds of one run touch exactly and collapse into one
  window; a process that stops for 45s and restarts keeps two windows and does
  not gain the gap.
- `subtractIntervals(from, covered)` — returns the uncovered fragments
- `intervalsToWindows` / `windowsToIntervals` — ISO ↔ epoch, dropping unparsable
  and zero/negative-length entries
- `totalSeconds(intervals)`
- `capExeWindows(windows, max)` — per-exe cap, see step 6
- `compactRuntimeWindows(exeCache, budget)` — global cap, see step 6

### 2. Data model — `apps/desktop/src/store.ts`

Add `runtimeWindows?: RuntimeWindow[]` to `ExeCacheEntry` (line 57). Keep
`runningSince` as is. Re-comment `trackedSeconds` as the **approximate bucket**:
runtime whose position in time is unknown — data written by versions before this
change, plus whatever step 6's compaction folds into it. Only compaction may
still write it; the accumulator never does. Credited through the approximate path
in step 4b. Export `RuntimeWindow`.

### 3. Accumulation — `tracker.ts:1274` `accumulateUnmatchedRuntime`

Same call site and same fold cadence (`SESSION_CHECKPOINT_INTERVAL_MS`, so
persistence churn is unchanged), windows instead of a counter:

- exe appears → `runningSince = now`
- exe still running, ≥60s since `runningSince` → close `[runningSince, now]` into
  `runtimeWindows` (through `normalizeIntervals`, which merges it with the
  previous fold), set `runningSince = now`
- exe disappears → close the final window, drop `runningSince`
- exe becomes ignored/blacklisted → delete `runtimeWindows`, `runningSince` and
  any legacy `trackedSeconds` (unchanged behaviour)
- `trackedSeconds` is otherwise never touched here

Carry `runtimeWindows` **and** the legacy `trackedSeconds` through the two places
that preserve accumulated runtime across a re-check: `cachePendingCommunityMatch`
(`tracker.ts:1204`) and `cacheMatchResult` (`tracker.ts:1389`).

**No hydrate conversion.** `hydrate` (`tracker.ts:192-199`) keeps dropping
`runningSince` and otherwise leaves both fields alone. Turning a scalar that may
cover several days into a single dated interval would let timestamp subtraction
either discard real playtime or miss a real duplicate; the scalar stays honest
about being unpositioned.

### 4. Crediting — replace `tracker.ts:1338` `backfillTrackedRuntime`

`creditDiscoveredRuntime(exeName, game)` at the same three call sites
(`cacheMatchResult:1400`, `addCustomGame:1740`, `addSharedCustomGame:1782`), same
precondition (called while the cache entry still holds the discovered runtime).
It reads only `runtimeWindows` / `runningSince` / `trackedSeconds`, which exist
only on unmatched entries, so calling it on a matched entry stays a no-op.

**4a — precise part.**
1. Intervals from `runtimeWindows` plus the open remainder from `runningSince`.
2. `covered` = intervals of every session already on this game key — reuse
   `activeSessionKey` / `sessionIdentityKey` (`tracker.ts:2559/2563`) over
   `recentSessions` **and** `activeSessions` (active covers `[startedAt, now]`).
3. `subtractIntervals`, drop fragments < `MIN_BACKFILL_SECONDS` (60, line 35).
4. One session per remaining fragment with its **real** timestamps.
   **Never bridge two fragments.** The gap between them is usually exactly the
   time a sibling executable already had credited — closing it would re-credit
   what step 4a just subtracted.
   There is no cap on the fragment count and no useful small bound either: a
   single window cut by many covered sessions yields up to
   `covered + 1` fragments, so the real bound is windows + covered sessions of
   that game, not the 200 from step 6. Add them in **one** store update (a
   batched `addSessions` next to the existing `addSession`) so a large credit is
   one write and one persist, not hundreds.

**4b — approximate part (legacy scalar only).** If `trackedSeconds` is present:
place it as one block ending immediately **before the earliest precise window**
of this exe (or ending now if there are none), subtract `covered`, credit the
remainder if ≥ 60s. Ordering it before the precise windows is true by
construction in both ways the bucket can fill: an older version wrote it before
any window existed, and compaction only ever folds in the *oldest* windows. So it
can never cancel out precise time. Within the block, subtraction is a bias
against inflation: the case it is meant to catch is a sibling exe's block that
was just credited for the same hour. Log the credited session as approximate.

**4c — logging.** `logRuntime` with credited seconds, fragment count, seconds
skipped as already covered, and whether any part was approximate. This is the
line to read when verifying.

### 5. Session ownership — fix `shareTrackedCustomGame`

`shareTrackedCustomGame` (`tracker.ts:1812`) currently rewrites
`gameName`, `coverUrl` and the suggestion fields but leaves `gameId` at
`oldGameId` (`:1835-1858`), while `addSharedCustomGame` has already moved the
cache entry onto the sibling's id via `sharedCustomGameId`. Exactly in the
multi-exe case the recorded sessions are orphaned on the old id. Set
`gameId: game.id` (plus `source: "custom"`) on both `activeSessions` and
`recentSessions` where `gameId === oldGameId`, and run the moved active sessions
through the existing `dedupeSessionsByGame` (`tracker.ts:2493`).

This is a pre-existing bug, independent of the crediting fix: without it the
exe's recorded sessions stay orphaned on the old id and the game shows up twice
in the library. It is the **only** rewrite of existing sessions in this plan, and
it only moves them to the id their executable already carries — no overlap merge,
no repair pass over existing history anywhere else.

### 6. Storage budget for runtime windows

Windows are unbounded per exe *and* across exes, and the quota fallback in
`persistAppState` (`persistence.ts:65-84`) only ever trims sessions — a
cache-driven quota failure would retry against the same oversized cache and end
in `status: "failed"`, which stops all persistence.

- **Per exe:** `MAX_RUNTIME_WINDOWS_PER_EXE = 200`, enforced in
  `accumulateUnmatchedRuntime`.
- **Global:** `MAX_RUNTIME_WINDOWS_TOTAL = 2000` across all entries. Evict the
  **globally oldest** windows by `startedAt` across all executables, not the
  oldest of whichever exe happened to trigger the check — otherwise one busy exe
  compacts while an idle one keeps year-old windows.
- **Compaction instead of deletion:** a window that has to go is folded into its
  exe's `trackedSeconds` scalar — the approximate bucket from step 4b. No seconds
  are lost and none are invented (unlike coalescing an old span, which would
  swallow the gaps). This is the only place that still writes `trackedSeconds`.
- **Quota fallback:** in the quota branch of `persistAppState`, run
  `compactRuntimeWindows` with an emergency budget of
  `RUNTIME_WINDOW_QUOTA_BUDGET = 0` — every window folds into `trackedSeconds`,
  which costs precision but no seconds — and retry before trimming sessions.
  Re-running with the normal 2000 would free nothing, since the cache is already
  within that budget by construction. History is worth more than discovery
  bookkeeping, so windows go first. Extend `PersistResult` with the compacted
  `exeCache`.
- **Both persist paths must adopt the result.** `persist()` (`tracker.ts:1642`)
  and `persistSoon()` (`store.ts:204`) each handle the quota result today, with
  duplicated `trimmed`/`failed` branches. If only one adopts the compacted cache,
  the oversized cache stays in memory and is re-serialized on the next write.
  Extract the shared handling into one `applyPersistResult(result)` used by both
  — it writes back `recentSessions` **and** `exeCache` and emits the log/toast —
  so a fourth outcome can never diverge again. `persistSoon` logs through
  `addRuntimeLogEntry`, `persist` through `logRuntime`; pass the logger in or
  have the helper live where both can reach it.

### 7. Display — `DiscoveredView.tsx:1760` `trackedSecondsFor`

`totalSeconds(runtimeWindows)` + open remainder + legacy `trackedSeconds`.
Unchanged display semantics; used at `:1094` and `:1312`.

## Files

- `apps/desktop/src/runtimeWindows.ts` (new) + `runtimeWindows.test.ts` (new)
- `apps/desktop/src/store.ts` — `ExeCacheEntry`, batched `addSessions`,
  `persistSoon()`
- `apps/desktop/src/tracker.ts` — `accumulateUnmatchedRuntime`,
  `backfillTrackedRuntime` → `creditDiscoveredRuntime`, `cacheMatchResult`,
  `cachePendingCommunityMatch`, `shareTrackedCustomGame`, `persist()`
- `apps/desktop/src/persistence.ts` — quota fallback, `PersistResult`
- `apps/desktop/src/ui/views/DiscoveredView.tsx` — `trackedSecondsFor`

No API, shared-contract, or Rust changes.

## Known limitations (accepted, not fixed here)

- A window closes at the scan that first sees the exe gone, so it can include up
  to one poll interval (~5s) of non-running time. Same as today's counter.
- "Recheck unmatched" (`recheckUnmatched`, `tracker.ts:1670`) drops all unmatched
  cache entries and with them their accumulated runtime. Pre-existing behaviour,
  unchanged.
- The legacy scalar's placement before the precise windows is an assumption about
  ordering, not observed data. It is correct by construction for data written by
  older versions and by step 6's compaction, and the field is gone after the
  first credit.
- **Compaction discards temporal position.** Windows folded into `trackedSeconds`
  by step 6 lose their timestamps, so that portion can no longer be deduplicated
  precisely against a sibling executable — it falls back to the approximate path
  in 4b. Only reachable past 200 windows on one exe or 2000 overall, i.e. an
  executable that ran hundreds of separate times without ever being linked.
- **Two custom games merged later still double-count.** If both executables are
  added as *separate* custom games (each gets its own id from `customGameId`),
  each is credited its own hour, and a later "check for matches" moving both onto
  one game leaves two overlapping sessions. Step 4a cannot see this because the
  game keys differed at crediting time. Deliberately not fixed here: repairing it
  means rewriting already recorded sessions, which is out of scope. The
  everyday path — "Add & Share" both exes, which is what happened with Mortal
  Shell 2 — is covered, because `sharedCustomGameId` gives them one id up front.
  Worth a `docs/BACKLOG.md` entry.

## Verification

**Unit** — `pnpm --filter @playcounter/desktop test`, new `runtimeWindows.test.ts`:

- identical windows subtract to nothing; partial overlap leaves the right
  fragments; disjoint windows survive intact; fragments < 60s are dropped
- consecutive checkpoint folds (touching exactly) collapse into one window
- **a 45s stop/restart gap stays two windows** and adds no seconds
- legacy scalar with overlapping recorded history: credited amount is the
  uncovered remainder, placed before the precise windows, never cancelling them
- `capExeWindows` / `compactRuntimeWindows`: folded windows land in
  `trackedSeconds` with the total preserved; the global pass evicts the oldest
  windows **across executables**, not per exe; budget `0` empties every window
  list
- two fragments separated by a covered gap stay **two** sessions and their
  durations sum to the uncovered time only

**Store-level** — a test around `shareTrackedCustomGame` asserting that sessions
on `oldGameId` move to the new shared id in both `activeSessions` and
`recentSessions`. If wiring zustand into a test proves noisy, extract the
session-rewrite into a pure helper and test that instead.

**End to end** — `pnpm tauri dev`, Dev view open so the runtime log is visible:

1. Copy any small exe twice as `dummygame.exe` and
   `dummygame-Win64-Shipping.exe`, start both, leave them running ~3 minutes.
2. Discover shows both under "Running now" with ~3 min tracked each.
3. Stop both. "Add & Share" the first one, then the second one.
4. History must show **one** ~3 min session, dated to when the dummies actually
   ran — not two, and not stamped "just now".
5. Runtime log: `credited …` for the first exe, a covered/skipped line for the
   second.
6. Restart both dummies now that the game is matched: one active session, both
   exes on the library card (`MyGamesView` `exeNames`).
7. Stop one dummy for ~45s and restart it while unmatched: tracked time must not
   grow by the pause.
8. Regression: a single unknown exe played 3 minutes and then added is credited
   exactly once.

**Migration check** — before updating, note the "Tracked so far" value of a real
unmatched exe; after updating it must be unchanged, and linking it must credit
the same amount as before (minus anything the game already has recorded).
