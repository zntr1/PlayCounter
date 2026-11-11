import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import { create } from "zustand";
import { saveAchievementLists } from "../achievements/achievementLists";
import { getT } from "../i18n";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import { nativeText } from "../nativeText";
import { readPersistedText } from "../persistence";
import { useAppStore, type GameMetadata } from "../store";
import { importExeCandidates } from "./exeCandidates";
import { readAgain } from "./accountReadings";
import {
  librarySearchQuery,
  reverseResolveLibraryGame,
  searchLibraryGames,
} from "./gameLookup";
import {
  canImportScannedGame,
  importGroupForGame,
  initialImportGroup,
  needsGameChoice,
  startsUnchecked,
  type ImportGroupKey,
} from "./importGroups";
import { buildLibraryImportCommit } from "./importPlan";
import { importProfile, type ImportScope } from "./importProfiles";
import type { BuiltinImportProviderId } from "./importProviders";
import { importNowShareLater, runLibraryImport } from "./importRun";
import {
  refreshKeptLogins,
  signOutKeptLogin,
  useKeptLogins,
} from "./keptLogins";
import { rememberSteamImportAccount } from "./libraryAutoAddState";
import { getLoginHealth } from "./loginHealth";
import { nameMatch } from "./nameMatch";
import { loadLibraryProvider } from "./providers";
import { resolveLibraryGames } from "./resolve";
import type {
  LibraryImportCommit,
  LibraryScanResult,
  LocalLibraryAccount,
  ProviderStatus,
  ResolvedLibraryGame,
  ScannedExecutable,
  ScannedLibraryGame,
} from "./types";
import { libraryEntryKey } from "./types";

/* One import at a time: the launcher being imported, its scan and the
   player's choices. It lives outside the view, so a finished review is still
   there after a visit to another page. Every action here works the same for
   every launcher; the profile says what differs. */

const t = getT("import");

export type ImportPhase =
  | "detecting"
  | "ready"
  | "scanning"
  | "importing"
  | "done";

/** The step the loader names while a scan runs. */
export type ImportStage =
  | "connecting"
  | "signin"
  | "account"
  | "installs"
  | "local"
  | "matching";

export type ImportSession = {
  /** Changes whenever a new session replaces the old one. */
  id: number;
  providerId: BuiltinImportProviderId;
  phase: ImportPhase;
  stage: ImportStage | null;
  status: ProviderStatus | null;
  accounts: LocalLibraryAccount[];
  accountId: number | null;
  scope: ImportScope;
  /** What the shown scan read. */
  scannedScope: ImportScope | null;
  scan: LibraryScanResult | null;
  /** The server's answers for the scanned games. */
  resolved: Map<string, ResolvedLibraryGame>;
  /** The game saved in My Games, for scanned games that are there. */
  saved: Map<string, ResolvedLibraryGame>;
  selected: Set<string>;
  /** Imported one by one during this review. */
  completed: Set<string>;
  skipped: Set<string>;
  manualExecutables: Record<string, string>;
  browsedExecutables: Record<string, ScannedExecutable>;
  /** The game picked for a title the server could not match. */
  picks: Record<string, GameMetadata>;
  /** "Wrong game?": the game picked instead of the server's match. */
  replacements: Record<string, GameMetadata>;
  /** The latest suggestions or search results for such a title. */
  choices: Record<string, GameMetadata[]>;
  capability: "unknown" | "supported" | "unsupported";
  error: string | null;
  authorizeUrl: string | null;
  waitingForServer: boolean;
  group: ImportGroupKey;
  current: string | null;
  /** The game an Import moved on to, and when. */
  movedOn: { externalId: string; at: number } | null;
  /** Games an Import is saving. The player has already moved on. */
  importing: ReadonlySet<string>;
  browsing: string | null;
  /** `notImported`: picked games the server could not be asked about. */
  lastImport: {
    added: string[];
    updated: number;
    notImported: string[];
  } | null;
};

let sessionCount = 0;

export function createImportSession(
  providerId: BuiltinImportProviderId,
): ImportSession {
  sessionCount += 1;
  return {
    id: sessionCount,
    providerId,
    phase: "detecting",
    stage: null,
    status: null,
    accounts: [],
    accountId: null,
    scope: "account",
    scannedScope: null,
    scan: null,
    resolved: new Map(),
    saved: new Map(),
    selected: new Set(),
    completed: new Set(),
    skipped: new Set(),
    manualExecutables: {},
    browsedExecutables: {},
    picks: {},
    replacements: {},
    choices: {},
    capability: "unknown",
    error: null,
    authorizeUrl: null,
    waitingForServer: false,
    group: "ready",
    current: null,
    movedOn: null,
    importing: new Set<string>(),
    browsing: null,
    lastImport: null,
  };
}

export const useImportSession = create<{ session: ImportSession }>(() => ({
  session: createImportSession("steam"),
}));

let controller = new AbortController();
let detectingSession: number | null = null;
let backedUp = false;

function session() {
  return useImportSession.getState().session;
}

function update(
  change:
    | Partial<ImportSession>
    | ((current: ImportSession) => Partial<ImportSession>),
) {
  useImportSession.setState(({ session: current }) => ({
    session: {
      ...current,
      ...(typeof change === "function" ? change(current) : change),
    },
  }));
}

/** Work started under this signal still belongs to the shown import. */
function isCurrent(signal: AbortSignal, providerId: BuiltinImportProviderId) {
  return (
    !signal.aborted &&
    controller.signal === signal &&
    session().providerId === providerId &&
    useAppStore.getState().libraryImportProvider === providerId
  );
}

/**
 * The match a game's rules use: the game saved in My Games while the game is
 * there, otherwise the server's answer. A game removed during the review goes
 * back to the server's answer and the question it asks.
 */
export function rowMatch(
  current: Pick<ImportSession, "providerId" | "resolved" | "saved">,
  externalId: string,
  inLibrary: boolean,
) {
  const key = libraryEntryKey(current.providerId, externalId);
  return (
    (inLibrary ? current.saved.get(key) : undefined) ??
    current.resolved.get(key)
  );
}

type PickedGame = Awaited<ReturnType<typeof reverseResolveLibraryGame>>;

// What the server knows about a game the player picked, asked for as soon as
// the game is shown, so Import does not wait for it. Kept for the scan, also
// across a visit to another page.
const pickedGames = new Map<
  number,
  { endpoint: string; answer: Promise<PickedGame> }
>();

function freshController() {
  controller.abort();
  controller = new AbortController();
  pickedGames.clear();
  return controller.signal;
}

/** Asks the server about a picked game once per scan, and remembers the answer. */
export function lookUpPickedGame(gameId: number) {
  const endpoint = useAppStore.getState().settings.apiEndpoint;
  const known = pickedGames.get(gameId);
  if (known?.endpoint === endpoint) return known.answer;
  const answer = reverseResolveLibraryGame(endpoint, gameId, controller.signal);
  // Nobody waits for it before Import, and Import asks again after a failure.
  answer.catch(() => undefined);
  pickedGames.set(gameId, { endpoint, answer });
  return answer;
}

/** The files the server knows for a game saved in My Games. Without an answer
 *  the review goes on without them: one game must not stop the whole list. */
async function savedGameFiles(
  apiEndpoint: string,
  gameId: number,
  signal: AbortSignal,
) {
  try {
    return (await reverseResolveLibraryGame(apiEndpoint, gameId, signal))
      .executables;
  } catch {
    return [];
  }
}

async function pickedGameForImport(gameId: number, signal: AbortSignal) {
  const earlier = pickedGames.get(gameId)?.answer;
  const answer = lookUpPickedGame(gameId);
  try {
    return await answer;
  } catch (cause) {
    // A lookup made when the game was shown failed or was cut off by leaving
    // the page: ask once more.
    if (answer !== earlier || signal.aborted) throw cause;
    pickedGames.delete(gameId);
    return lookUpPickedGame(gameId);
  }
}

const clearedReview = {
  scan: null,
  resolved: new Map<string, ResolvedLibraryGame>(),
  saved: new Map<string, ResolvedLibraryGame>(),
  selected: new Set<string>(),
  completed: new Set<string>(),
  skipped: new Set<string>(),
  manualExecutables: {},
  browsedExecutables: {},
  picks: {},
  replacements: {},
  choices: {},
  capability: "unknown" as const,
  error: null,
  authorizeUrl: null,
  waitingForServer: false,
  current: null,
  movedOn: null,
  importing: new Set<string>(),
  browsing: null,
  lastImport: null,
};

/** Starts over when another launcher is opened, cancelling the old one's work. */
export function openImportSession(providerId: BuiltinImportProviderId) {
  if (session().providerId === providerId) return;
  freshController();
  useImportSession.setState({ session: createImportSession(providerId) });
}

/** Looks for the launcher on this PC and its accounts, once per session. */
export async function detectImportLauncher() {
  const start = session();
  if (start.status || start.phase !== "detecting") return;
  if (detectingSession === start.id) return;
  detectingSession = start.id;
  try {
    const provider = await loadLibraryProvider(start.providerId);
    const detected = await provider.detect();
    if (session().id !== start.id) return;
    if (!detected.available) {
      update({ status: detected, phase: "ready" });
      return;
    }
    const accounts = await provider.listAccounts();
    if (session().id !== start.id) return;
    update({
      status: detected,
      accounts,
      accountId:
        provider.accountMode === "none"
          ? 0
          : (accounts.find((account) => account.mostRecent)?.accountId ??
            accounts[0]?.accountId ??
            null),
      phase: "ready",
    });
  } catch (cause) {
    if (session().id === start.id)
      update({ error: formatError(cause), phase: "ready" });
  } finally {
    if (detectingSession === start.id) detectingSession = null;
  }
}

export function chooseImportScope(scope: ImportScope) {
  update({ scope });
}

/** Another local account: its games are another library, so start over. */
export function chooseImportAccount(accountId: number) {
  freshController();
  update({ ...clearedReview, accountId, phase: "ready", stage: null });
}

/** Reads the launcher, then matches its games. */
export async function startImportScan(
  options: { copySignInLink?: boolean } = {},
) {
  const start = session();
  const { providerId, accountId } = start;
  if (accountId === null) return;
  const profile = importProfile(providerId);
  const includeAccount =
    profile.choice !== "accountOrInstalled" || start.scope === "account";
  const app = useAppStore.getState();
  const apiEndpoint = app.settings.apiEndpoint;
  const ignoredProcesses = app.ignoredProcesses;
  const existingImports = app.libraryImports;
  // An expired sign-in opens the sign-in window again.
  const keptLogin =
    profile.login !== null &&
    useKeptLogins
      .getState()
      .logins.some((login) => login.service === profile.login) &&
    getLoginHealth(profile.login)?.status !== "needsSignIn";
  const signal = freshController();
  update({
    ...clearedReview,
    phase: "scanning",
    stage:
      profile.choice === "localAccounts"
        ? "local"
        : profile.copySignInLink
          ? "connecting"
          : includeAccount
            ? keptLogin
              ? "account"
              : "signin"
            : "installs",
    scannedScope: includeAccount ? "account" : "installed",
    group: "ready",
  });
  const onWait = (waiting: boolean) => {
    if (isCurrent(signal, providerId)) update({ waitingForServer: waiting });
  };
  try {
    const provider = await loadLibraryProvider(providerId);
    if (!isCurrent(signal, providerId)) return;
    const result = await provider.scan(accountId, {
      apiEndpoint,
      signal,
      onRateLimitWait: onWait,
      onAuthorizeUrl: profile.copySignInLink
        ? (url) => {
            if (!isCurrent(signal, providerId)) return;
            update((current) => ({
              authorizeUrl: url,
              stage: current.stage === "account" ? "account" : "signin",
            }));
            if (options.copySignInLink) void copyImportSignInLink(url);
          }
        : undefined,
      onXboxProgress: profile.copySignInLink
        ? (stage) => {
            if (!isCurrent(signal, providerId)) return;
            update((current) => ({
              stage:
                stage === "history"
                  ? "account"
                  : current.authorizeUrl
                    ? "signin"
                    : "connecting",
            }));
          }
        : undefined,
      onStage: (stage) => {
        if (!isCurrent(signal, providerId)) return;
        update({
          stage:
            stage === "installs"
              ? "installs"
              : keptLogin
                ? "account"
                : "signin",
        });
      },
      openAuthorizeUrl: !profile.copySignInLink || !options.copySignInLink,
      // Each of these launchers reads only its own flag.
      ...(profile.accountAndInstalls
        ? {
            epicAccount: includeAccount,
            gogAccount: includeAccount,
            battleNetAccount: includeAccount,
            battleNetProductIds: [...existingImports.values()]
              .filter((entry) => entry.provider === providerId)
              .map((entry) => entry.externalId),
          }
        : {}),
    });
    if (!isCurrent(signal, providerId)) return;
    update({ stage: "matching" });
    if (profile.accountAndInstalls && !result.partial) {
      // A complete scan is proof: an install it did not find is gone.
      const installedIds = new Set(
        result.games
          .filter((game) => game.installed)
          .map((game) => game.externalId),
      );
      const state = useAppStore.getState();
      for (const install of state.libraryInstalls.values()) {
        if (
          install.provider === providerId &&
          !installedIds.has(install.externalId)
        ) {
          state.removeLibraryInstall(providerId, install.externalId);
        }
      }
    }
    // Saved now, whatever gets imported: Details shows a title's list once
    // the game is in the library.
    if (result.achievementLists)
      void saveAchievementLists(result.achievementLists).catch(() => {});
    const manualExecutables = Object.fromEntries(
      result.games.flatMap((game) => {
        const preselected = preselectedExecutable(
          game,
          profile.accountAndInstalls
            ? existingImports.get(libraryEntryKey(providerId, game.externalId))
                ?.linkedExeNames
            : undefined,
          ignoredProcesses,
        );
        return preselected ? [[game.externalId, preselected]] : [];
      }),
    );
    const lookup = result.resolvedGames
      ? { capability: "supported" as const, games: result.resolvedGames }
      : await resolveLibraryGames(
          apiEndpoint,
          providerId,
          result.games,
          signal,
          onWait,
        );
    if (!isCurrent(signal, providerId)) return;
    if (lookup.capability !== "supported") {
      update({
        scan: result,
        manualExecutables,
        capability: lookup.capability,
        phase: "ready",
        stage: null,
        waitingForServer: false,
      });
      return;
    }
    const byKey = new Map(lookup.games.map((game) => [game.key, game]));
    // A game already in My Games keeps the game saved there, on every
    // launcher: the player may have picked it instead of the server's match.
    // The server's answer stays apart, for when the game is removed.
    const saved = new Map<string, ResolvedLibraryGame>();
    for (const game of result.games) {
      const key = libraryEntryKey(providerId, game.externalId);
      const existing = existingImports.get(key);
      if (!existing) continue;
      const serverMatch = byKey.get(key);
      const existingExecutables =
        serverMatch?.game?.id === existing.gameId
          ? serverMatch.executables
          : serverMatch?.game || profile.accountAndInstalls
            ? await savedGameFiles(apiEndpoint, existing.gameId, signal)
            : [];
      if (!isCurrent(signal, providerId)) return;
      saved.set(key, {
        key,
        status: "resolved",
        game: {
          id: existing.gameId,
          igdbId: existing.igdbId,
          name: existing.name,
          coverUrl: existing.coverUrl,
          source: existing.source,
        },
        executables: existingExecutables,
        candidates: serverMatch?.candidates,
      });
    }
    if (profile.searchesTitles) {
      // Titles the server didn't match are searched one after another for
      // suggestions; the name match below may take one of them.
      for (const game of result.games) {
        const key = libraryEntryKey(providerId, game.externalId);
        const match = byKey.get(key);
        const query = librarySearchQuery(game.name ?? "");
        // Never-played account games can number in the hundreds: they are
        // searched when the player opens one. Games in My Games need none.
        if (
          saved.has(key) ||
          match?.status === "resolved" ||
          match?.candidates?.length ||
          query.length < 2 ||
          startsUnchecked(game)
        )
          continue;
        try {
          const candidates = await searchLibraryGames(apiEndpoint, query, {
            signal,
            mainGamesAndRemastersOnly: profile.mainGamesOnlySearch,
            onRateLimitWait: onWait,
          });
          if (!isCurrent(signal, providerId)) return;
          byKey.set(key, {
            key,
            status: "unknown",
            executables: match?.executables ?? [],
            candidates,
          });
        } catch {
          if (!isCurrent(signal, providerId)) return;
          // A failed suggestion leaves the search to the player.
        }
      }
    }
    if (profile.matchedBy === "name") {
      // docs/name-auto-match-plan.md: the one suggestion named like the
      // title is the match. An installed game needs its known files now, for
      // the file check; any other game gets them on Import, like a pick.
      for (const game of result.games) {
        const key = libraryEntryKey(providerId, game.externalId);
        const match = byKey.get(key);
        if (saved.has(key) || match?.status === "resolved") continue;
        const named = nameMatch(game.name, match?.candidates);
        if (!named) continue;
        if (
          game.installed &&
          game.installPath !== undefined &&
          !game.runsInEmulator
        ) {
          try {
            const known = await lookUpPickedGame(named.id);
            if (!isCurrent(signal, providerId)) return;
            byKey.set(key, {
              key,
              status: "resolved",
              game: known.game,
              executables: known.executables,
              candidates: match?.candidates,
            });
          } catch {
            if (!isCurrent(signal, providerId)) return;
            // Without its files the game stays a suggestion.
          }
          continue;
        }
        byKey.set(key, {
          key,
          status: "resolved",
          game: named,
          executables: [],
          candidates: match?.candidates,
          filesOnImport: true,
        });
      }
    }
    const group = initialImportGroup(
      providerId,
      result.games,
      byKey,
      existingImports,
      ignoredProcesses,
    );
    const selected = new Set(
      result.games
        .filter((game) => {
          const key = libraryEntryKey(providerId, game.externalId);
          const existing = existingImports.get(key);
          // D3 (docs/import-accounts-plan.md), widened 2026-11-02: a game in
          // My Games starts checked when the read brings new playtime.
          if (existing)
            return (
              canImportScannedGame({
                game,
                resolved: saved.get(key),
                alreadyImported: true,
                ignoredProcesses,
              }) && readAgain(existing, game, result).newPlaytime
            );
          return (
            importGroupForGame({
              game,
              provider: providerId,
              resolved: byKey.get(key),
              alreadyImported: false,
              ignoredProcesses,
            }) === "ready" && !startsUnchecked(game)
          );
        })
        .map((game) => game.externalId),
    );
    const picks: Record<string, GameMetadata> = {};
    for (const game of result.games) {
      const first = byKey.get(libraryEntryKey(providerId, game.externalId))
        ?.candidates?.[0];
      if (first) picks[game.externalId] = first;
    }
    update({
      scan: result,
      manualExecutables,
      capability: "supported",
      resolved: byKey,
      saved,
      selected,
      picks,
      group,
      phase: "ready",
      stage: null,
      waitingForServer: false,
    });
  } catch (cause) {
    if (!isCurrent(signal, providerId)) return;
    update({
      error: formatError(cause),
      phase: "ready",
      stage: null,
      waitingForServer: false,
    });
  } finally {
    // A sign-in may have been kept, renewed or refused.
    if (profile.login && includeAccount) void refreshKeptLogins();
  }
}

/** The file to preselect: the one linked before, the one the game declares,
 *  or the only one there is. */
function preselectedExecutable(
  game: ScannedLibraryGame,
  linkedBefore: readonly string[] | undefined,
  ignoredProcesses: ReadonlySet<string>,
) {
  const candidates = importExeCandidates(
    game.executables,
    [],
    game.name,
    ignoredProcesses,
  );
  const previous = linkedBefore
    ? candidates.filter((candidate) =>
        linkedBefore.some(
          (name) => name.toLowerCase() === candidate.fileName.toLowerCase(),
        ),
      )
    : [];
  return (
    (previous.length === 1 ? previous[0] : undefined) ??
    candidates.find((item) => item.declared) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  )?.relativePath;
}

export function cancelImport() {
  freshController();
  update({ ...clearedReview, phase: "ready", stage: null });
}

/** Leaving the page stops a running scan or import. A finished review stays. */
export function leaveImportView() {
  const { phase } = session();
  if (phase === "scanning" || phase === "importing") cancelImport();
  else {
    controller.abort();
    update({ importing: new Set<string>(), browsing: null });
  }
}

export function resumeImportView() {
  if (controller.signal.aborted) controller = new AbortController();
}

export function selectedExecutableFor(
  current: ImportSession,
  game: ScannedLibraryGame,
) {
  const chosen = current.manualExecutables[game.externalId];
  return (
    game.executables.find((item) => item.relativePath === chosen) ??
    (current.browsedExecutables[game.externalId]?.relativePath === chosen
      ? current.browsedExecutables[game.externalId]
      : undefined)
  );
}

/** Games whose checkbox counts: importable and not imported just now. */
export function selectableGameIds(
  current: Pick<
    ImportSession,
    "providerId" | "scan" | "resolved" | "saved" | "completed"
  >,
) {
  const { providerId } = current;
  const app = useAppStore.getState();
  const ids = new Set<string>();
  for (const game of current.scan?.games ?? []) {
    const inLibrary = app.libraryImports.has(
      libraryEntryKey(providerId, game.externalId),
    );
    if (
      (inLibrary && current.completed.has(game.externalId)) ||
      !canImportScannedGame({
        game,
        resolved: rowMatch(current, game.externalId, inLibrary),
        alreadyImported: inLibrary,
        ignoredProcesses: app.ignoredProcesses,
      })
    )
      continue;
    ids.add(game.externalId);
  }
  return ids;
}

/** A picked game the server could not be asked about on Import. */
export function notImportedText(name: string) {
  return t("{{name}} could not be imported. Please try again.", { name });
}

/** Imports the checked games the bar counts: the open tab's. */
export async function importSelectedGames(externalIds: readonly string[]) {
  const start = session();
  const { providerId, scan } = start;
  if (!scan) return;
  const chosen = new Set(externalIds);
  const profile = importProfile(providerId);
  const providerName = LIBRARY_PROVIDER_LABELS[providerId];
  const app = useAppStore.getState();
  const signal = controller.signal;
  if (!isCurrent(signal, providerId)) return;
  update({ phase: "importing", error: null });
  try {
    const selectable = selectableGameIds(start);
    const added: string[] = [];
    let updated = 0;
    const commits: LibraryImportCommit[] = [];
    const imported = new Map<string, ResolvedLibraryGame>();
    const notImported: string[] = [];
    for (const game of scan.games) {
      if (!chosen.has(game.externalId) || !selectable.has(game.externalId))
        continue;
      const key = libraryEntryKey(providerId, game.externalId);
      const inLibrary = app.libraryImports.has(key);
      let match = rowMatch(start, game.externalId, inLibrary);
      const replacement = inLibrary
        ? undefined
        : start.replacements[game.externalId];
      // A pick, or a game matched by name: its files are asked for now.
      const lookUp =
        replacement ?? (match?.filesOnImport ? match.game : undefined);
      if (lookUp) {
        let picked: PickedGame;
        try {
          picked = await pickedGameForImport(lookUp.id, signal);
        } catch {
          if (!isCurrent(signal, providerId)) return;
          // The other games still go in. This one stays checked.
          notImported.push(lookUp.name);
          continue;
        }
        if (!isCurrent(signal, providerId)) return;
        match = {
          key,
          status: "resolved",
          game: picked.game,
          executables: picked.executables,
        };
      }
      if (!match) continue;
      const commit = buildLibraryImportCommit({
        provider: providerId,
        scanned: game,
        resolved: match,
        // A picked game gets only the files the server knows for it, so
        // nothing goes to the community.
        selectedExecutable: replacement
          ? undefined
          : selectedExecutableFor(start, game),
        ignoredProcesses: app.ignoredProcesses,
        account: scan.account,
        partialRead: scan.totalsCutShort,
      });
      if (!commit) continue;
      if (inLibrary) updated += 1;
      else added.push(game.externalId);
      commits.push(commit);
      imported.set(key, match);
    }
    if (commits.length === 0)
      throw new Error(
        notImported.length > 0
          ? notImported.map(notImportedText).join(" ")
          : t("Pick at least one game to import."),
      );
    await backupOnce(signal);
    if (!isCurrent(signal, providerId)) return;
    const result = await runLibraryImport(commits, signal);
    rememberImportAccount(start);
    if (!isCurrent(signal, providerId)) return;
    const failedShares = result.shareOutcomes.filter(
      ({ outcome }) => outcome.kind === "failed",
    ).length;
    const importedIds = new Set(
      commits.map((commit) => commit.entry.externalId),
    );
    update((current) => ({
      saved: new Map([...current.saved, ...imported]),
      selected: new Set(
        [...current.selected].filter((id) => !importedIds.has(id)),
      ),
      phase: "done",
      lastImport: { added, updated, notImported },
    }));
    useAppStore.getState().addToast({
      tone: "success",
      title: t("{{count}} {{provider}} games imported", {
        count: commits.length,
        provider: providerName,
      }),
      detail:
        failedShares > 0
          ? t(
              "Your library is available in My Games. {{count}} game files need another try when you are back online.",
              { count: failedShares },
            )
          : profile.hasPlaytime
            ? t("Your library and playtime are now available in My Games.")
            : t("Your games are now in My Games, ready for future tracking."),
    });
  } catch (cause) {
    if (!isCurrent(signal, providerId)) return;
    update({ error: formatError(cause), phase: "ready" });
  }
}

/** Imports one game that needed the player: the game they picked, or the
 *  matched one, with the file they picked. `next` shows at once, as with
 *  Skip; the game is saved meanwhile and leaves the list once it is in My
 *  Games. One that can't be imported stays, and the error names it. */
export async function importOneGame(
  externalId: string,
  next: string | null = null,
) {
  const start = session();
  const { providerId } = start;
  const profile = importProfile(providerId);
  const providerName = LIBRARY_PROVIDER_LABELS[providerId];
  const scanned = start.scan?.games.find(
    (game) => game.externalId === externalId,
  );
  if (!scanned || start.importing.has(externalId)) return;
  const key = libraryEntryKey(providerId, externalId);
  const app = useAppStore.getState();
  const signal = controller.signal;
  if (!isCurrent(signal, providerId)) return;
  const inLibrary = app.libraryImports.has(key);
  let resolvedGame = rowMatch(start, externalId, inLibrary);
  // A title the server could not match needs the player's pick; a match
  // can be replaced by one ("Wrong game?").
  const needsGame = needsGameChoice(providerId, scanned, resolvedGame);
  const pick = needsGame
    ? start.picks[externalId]
    : inLibrary
      ? undefined
      : start.replacements[externalId];
  if (needsGame ? !pick : !resolvedGame) return;
  update((current) => ({
    importing: new Set(current.importing).add(externalId),
    error: null,
    ...showNext(current, externalId, next),
  }));
  try {
    if (pick) {
      const reverse = await pickedGameForImport(pick.id, signal);
      if (!isCurrent(signal, providerId)) return;
      resolvedGame = {
        key,
        status: "resolved",
        game: reverse.game,
        executables: reverse.executables,
        candidates: resolvedGame?.candidates,
      };
    }
    if (!resolvedGame) return;
    const commit = buildLibraryImportCommit({
      provider: providerId,
      scanned,
      resolved: resolvedGame,
      selectedExecutable: selectedExecutableFor(start, scanned),
      ignoredProcesses: app.ignoredProcesses,
      account: start.scan?.account,
      partialRead: start.scan?.totalsCutShort,
    });
    if (!commit)
      throw new Error(
        t("The selected {{providerName}} game cannot be imported.", {
          providerName,
        }),
      );
    if (
      profile.linksFilesPerInstall &&
      scanned.installed &&
      commit.scopedLinks.length === 0
    )
      throw new Error(
        t("Pick the game file to track before importing this game."),
      );
    await backupOnce(signal);
    if (!isCurrent(signal, providerId)) return;
    // No toast: it would sit on the next game's Import. The list shows it.
    importNowShareLater([commit]);
    rememberImportAccount(start);
    const done = resolvedGame;
    update((current) => {
      const selected = new Set(current.selected);
      selected.delete(externalId);
      return {
        saved: new Map(current.saved).set(key, done),
        completed: new Set(current.completed).add(externalId),
        selected,
        // Opened again meanwhile: it leaves the list now, so `next` shows.
        ...(current.current === externalId
          ? showNext(current, externalId, next)
          : {}),
      };
    });
  } catch (cause) {
    if (!isCurrent(signal, providerId)) return;
    // The player has moved on: say which game it was.
    update({
      error: `${notImportedText(scanned.name ?? pick?.name ?? externalId)} ${formatError(cause)}`,
    });
  } finally {
    if (isCurrent(signal, providerId))
      update((current) => {
        const importing = new Set(current.importing);
        importing.delete(externalId);
        return { importing };
      });
  }
}

/** `next` instead of `externalId`, when that is the game on show. A click on
 *  Import right after is ignored: it was meant for the game before. */
function showNext(
  current: ImportSession,
  externalId: string,
  next: string | null,
): Partial<ImportSession> {
  if (current.current !== externalId && current.current !== null) return {};
  return {
    current: next,
    movedOn:
      next !== null ? { externalId: next, at: Date.now() } : current.movedOn,
  };
}

export async function browseGameFile(externalId: string) {
  const start = session();
  const { providerId } = start;
  const providerName = LIBRARY_PROVIDER_LABELS[providerId];
  const game = start.scan?.games.find((item) => item.externalId === externalId);
  if (!game) return;
  const signal = controller.signal;
  if (!isCurrent(signal, providerId)) return;
  if (!game.installPath) {
    update({
      error: t(
        "{{providerName}} did not report an install folder for this game.",
        { providerName },
      ),
    });
    return;
  }
  update({ browsing: externalId, error: null });
  try {
    const selectedPath = await open({
      multiple: false,
      directory: false,
      defaultPath: game.installPath,
      filters: [{ name: "Game file", extensions: ["exe"] }],
    });
    if (!isCurrent(signal, providerId)) return;
    if (typeof selectedPath !== "string") return;
    const executable = await invoke<ScannedExecutable>(
      "library_inspect_executable",
      {
        provider: providerId,
        installPath: game.installPath,
        executablePath: selectedPath,
      },
    );
    if (!isCurrent(signal, providerId)) return;
    if (
      matchesProcessPatternSet(
        executable.fileName,
        useAppStore.getState().ignoredProcesses,
      )
    ) {
      throw new Error(
        t(
          "{{fileName}} is on PlayCounter's ignore list, so it cannot be used as the game file.",
          { fileName: executable.fileName },
        ),
      );
    }
    update((current) => ({
      browsedExecutables: {
        ...current.browsedExecutables,
        [externalId]: executable,
      },
    }));
    pickGameFile(externalId, executable.relativePath);
  } catch (cause) {
    if (!isCurrent(signal, providerId)) return;
    update({ error: formatError(cause) });
  } finally {
    if (isCurrent(signal, providerId)) update({ browsing: null });
  }
}

/** A file picked for a game already in My Games checks it, so the import
 *  saves the file. */
export function pickGameFile(externalId: string, relativePath: string) {
  const current = session();
  const alreadyImported =
    useAppStore
      .getState()
      .libraryImports.has(libraryEntryKey(current.providerId, externalId)) &&
    !current.completed.has(externalId);
  update((state) => ({
    manualExecutables: {
      ...state.manualExecutables,
      [externalId]: relativePath,
    },
    ...(alreadyImported
      ? { selected: new Set(state.selected).add(externalId) }
      : {}),
  }));
}

export function pickImportGame(externalId: string, game: GameMetadata) {
  update((current) => ({ picks: { ...current.picks, [externalId]: game } }));
}

/** "Wrong game?": import `game` instead of the server's match. Picking the
 *  matched game takes the pick back. */
export function replaceImportMatch(externalId: string, game: GameMetadata) {
  update((current) => {
    const matched = current.resolved.get(
      libraryEntryKey(current.providerId, externalId),
    )?.game;
    const replacements = { ...current.replacements };
    if (game.igdbId === matched?.igdbId) delete replacements[externalId];
    else replacements[externalId] = game;
    return { replacements };
  });
}

/** Search results for "Wrong game?": they leave the pick as it is. */
export function setReplacementChoices(
  externalId: string,
  games: GameMetadata[],
) {
  update((current) => ({
    choices: { ...current.choices, [externalId]: games },
  }));
}

export function setImportChoices(externalId: string, games: GameMetadata[]) {
  update((current) => ({
    choices: { ...current.choices, [externalId]: games },
    picks: games[0]
      ? { ...current.picks, [externalId]: games[0] }
      : Object.fromEntries(
          Object.entries(current.picks).filter(([id]) => id !== externalId),
        ),
  }));
}

export function setGameSelected(externalId: string, checked: boolean) {
  update((current) => {
    const selected = new Set(current.selected);
    if (checked) selected.add(externalId);
    else selected.delete(externalId);
    return { selected };
  });
}

export function setGamesSelected(
  externalIds: readonly string[],
  checked: boolean,
) {
  update((current) => {
    const selected = new Set(current.selected);
    for (const id of externalIds) {
      if (checked) selected.add(id);
      else selected.delete(id);
    }
    return { selected };
  });
}

export function showImportGroup(group: ImportGroupKey) {
  update({ group, current: null });
}

export function showImportGame(externalId: string) {
  update({ current: externalId });
}

export function skipImportGame(externalId: string, next: string | null) {
  update((current) => ({
    skipped: new Set(current.skipped).add(externalId),
    current: next,
  }));
}

export function unskipImportGame(externalId: string) {
  update((current) => {
    const skipped = new Set(current.skipped);
    skipped.delete(externalId);
    return { skipped, current: externalId };
  });
}

/** From the done screen back to the list, as it was left. */
export function showImportList() {
  update({ phase: "ready" });
}

/** From the done screen to the games in My Games with new playtime. */
export function showImportUpdates() {
  update({ phase: "ready", group: "imported", current: null });
}

/** From the done screen back to the games that still need the player. */
export function reviewRemainingGames() {
  update({
    phase: "ready",
    group: "attention",
    current: null,
    skipped: new Set(),
  });
}

export async function signOutImportLogin() {
  const login = importProfile(session().providerId).login;
  if (!login) return;
  try {
    await signOutKeptLogin(login);
  } catch (cause) {
    useAppStore.getState().addToast({
      tone: "error",
      title: t("Could not sign out. Please try again."),
      detail: formatError(cause),
    });
  }
}

export async function copyImportSignInLink(
  url: string | null = session().authorizeUrl,
) {
  const { providerId } = session();
  const signal = controller.signal;
  if (!url || !isCurrent(signal, providerId)) return;
  const { addToast } = useAppStore.getState();
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error(t("PlayCounter cannot reach the clipboard right now."));
    }
    await navigator.clipboard.writeText(url);
    if (!isCurrent(signal, providerId)) return;
    addToast({
      tone: "success",
      title: t("Sign-in link copied"),
      detail: t("Open it in the browser you want to sign in with."),
    });
  } catch (cause) {
    if (!isCurrent(signal, providerId)) return;
    addToast({
      tone: "error",
      title: t("Could not copy sign-in link"),
      detail: formatError(cause),
    });
  }
}

/** A successful Steam import opts this PC into adding new Steam games. */
function rememberImportAccount(current: ImportSession) {
  if (
    importProfile(current.providerId).choice === "localAccounts" &&
    current.accountId !== null
  ) {
    rememberSteamImportAccount(current.accountId);
  }
}

/** Imports clicked one after another share the one backup. */
let backingUp: Promise<void> | null = null;

async function backupOnce(signal: AbortSignal) {
  signal.throwIfAborted();
  if (backedUp) return;
  backingUp ??= (async () => {
    await invoke("backup_local_data", {
      contents: readPersistedText() ?? "{}",
    });
    backedUp = true;
  })().finally(() => {
    backingUp = null;
  });
  await backingUp;
  signal.throwIfAborted();
}

export function formatError(error: unknown) {
  return nativeText(error instanceof Error ? error.message : String(error));
}
