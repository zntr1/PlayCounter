import {
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FolderOpen,
  HardDrive,
  LibraryBig,
  RefreshCw,
  Search,
  Share2,
} from "lucide-react";
import {
  LIBRARY_PROVIDER_LABELS,
  type XboxImportProgressStage,
} from "@playcounter/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { runLibraryImport } from "../../library/importRun";
import { importExeCandidates } from "../../library/exeCandidates";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { loadLibraryProvider } from "../../library/providers";
import {
  reverseResolveLibraryGame,
  searchLibraryGames,
} from "../../library/gameLookup";
import { resolveLibraryGames } from "../../library/resolve";
import { RATE_LIMIT_MESSAGE } from "../../rateLimitedFetch";
import type { BuiltinImportProviderId } from "../../library/importProviders";
import type {
  LibraryScanResult,
  LocalLibraryAccount,
  ProviderStatus,
  ResolvedLibraryGame,
  ScannedExecutable,
  ScannedLibraryGame,
} from "../../library/types";
import { libraryEntryKey } from "../../library/types";
import { useAppStore, type GameMetadata } from "../../store";
import { matchesProcessPatternSet } from "../../ignoredProcessPatterns";
import { STORAGE_KEY } from "../../persistence";
import { Panel, ProviderBadge, formatDuration } from "../components";
import { Button, Input, Modal } from "../primitives";

type Phase = "detecting" | "ready" | "scanning" | "importing" | "done";
export type ImportGroupKey = "ready" | "attention" | "unavailable" | "imported";

let importerSessionBackedUp = false;

type ImporterSession = {
  providerId: BuiltinImportProviderId;
  phase: Phase;
  status: ProviderStatus | null;
  accounts: LocalLibraryAccount[];
  accountId: number | null;
  scan: LibraryScanResult | null;
  resolved: Map<string, ResolvedLibraryGame>;
  selected: Set<string>;
  completed: Set<string>;
  manualExecutables: Record<string, string>;
  browsedExecutables: Record<string, ScannedExecutable>;
  capability: "unknown" | "supported" | "unsupported";
  error: string | null;
  authorizeUrl: string | null;
};

function createImporterSession(
  providerId: BuiltinImportProviderId,
): ImporterSession {
  return {
    providerId,
    phase: "detecting",
    status: null,
    accounts: [],
    accountId: null,
    scan: null,
    resolved: new Map(),
    selected: new Set(),
    completed: new Set(),
    manualExecutables: {},
    browsedExecutables: {},
    capability: "unknown",
    authorizeUrl: null,
    error: null,
  };
}

let importerSession = createImporterSession("steam");

export function ImportLibraryView() {
  const providerId = useAppStore((state) => state.libraryImportProvider);
  if (importerSession.providerId !== providerId) {
    importerSession = createImporterSession(providerId);
  }
  const session = importerSession;
  const isXbox = providerId === "xbox";
  const isBattleNet = providerId === "battlenet";
  const providerName = LIBRARY_PROVIDER_LABELS[providerId];
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const existingImports = useAppStore((state) => state.libraryImports);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const addToast = useAppStore((state) => state.addToast);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setLibraryTab = useAppStore((state) => state.setLibraryTab);
  const [phase, setPhase] = useState<Phase>(() =>
    session.phase === "scanning" || session.phase === "importing"
      ? "ready"
      : session.phase,
  );
  const [status, setStatus] = useState<ProviderStatus | null>(session.status);
  const [accounts, setAccounts] = useState<LocalLibraryAccount[]>(
    session.accounts,
  );
  const [accountId, setAccountId] = useState<number | null>(session.accountId);
  const [scan, setScan] = useState<LibraryScanResult | null>(session.scan);
  const [resolved, setResolved] = useState<Map<string, ResolvedLibraryGame>>(
    session.resolved,
  );
  const [selected, setSelected] = useState<Set<string>>(session.selected);
  const [completed, setCompleted] = useState<Set<string>>(session.completed);
  const [manualExecutables, setManualExecutables] = useState<
    Record<string, string>
  >(session.manualExecutables);
  const [browsedExecutables, setBrowsedExecutables] = useState<
    Record<string, ScannedExecutable>
  >(session.browsedExecutables);
  const [capability, setCapability] = useState<
    "unknown" | "supported" | "unsupported"
  >(session.capability);
  const [error, setError] = useState<string | null>(session.error);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(
    session.authorizeUrl,
  );
  const [waitingForServer, setWaitingForServer] = useState(false);
  const [battleNetAccountScan, setBattleNetAccountScan] = useState(false);
  const [pendingBattleNetScan, setPendingBattleNetScan] = useState<
    "installed" | "account" | null
  >(null);
  const [xboxProgress, setXboxProgress] =
    useState<XboxImportProgressStage>("authorization");
  const [activeImportGroup, setActiveImportGroup] =
    useState<ImportGroupKey>("ready");
  const [addingExternalId, setAddingExternalId] = useState<string | null>(null);
  const [browsingExternalId, setBrowsingExternalId] = useState<string | null>(
    null,
  );
  const importAbortController = useRef(new AbortController());
  const copyAuthorizeUrlOnStart = useRef(false);
  const activeProviderId = useRef(providerId);

  useEffect(() => {
    if (importAbortController.current.signal.aborted) {
      importAbortController.current = new AbortController();
    }
    return () => importAbortController.current.abort();
  }, []);

  useEffect(() => {
    if (activeProviderId.current === providerId) return;
    activeProviderId.current = providerId;
    importAbortController.current.abort();
    importAbortController.current = new AbortController();
    const next = createImporterSession(providerId);
    importerSession = next;
    setPhase(next.phase);
    setStatus(next.status);
    setAccounts(next.accounts);
    setAccountId(next.accountId);
    setScan(next.scan);
    setResolved(next.resolved);
    setSelected(next.selected);
    setCompleted(next.completed);
    setManualExecutables(next.manualExecutables);
    setBrowsedExecutables(next.browsedExecutables);
    setCapability(next.capability);
    setError(next.error);
    setAuthorizeUrl(next.authorizeUrl);
    setWaitingForServer(false);
    setXboxProgress("authorization");
    setPendingBattleNetScan(null);
    setActiveImportGroup("ready");
    setAddingExternalId(null);
    setBrowsingExternalId(null);
  }, [providerId]);

  useEffect(() => {
    importerSession = {
      providerId,
      phase,
      status,
      accounts,
      accountId,
      scan,
      resolved,
      selected,
      completed,
      manualExecutables,
      browsedExecutables,
      capability,
      error,
      authorizeUrl,
    };
  }, [
    authorizeUrl,
    accountId,
    accounts,
    completed,
    browsedExecutables,
    capability,
    error,
    manualExecutables,
    providerId,
    phase,
    resolved,
    scan,
    selected,
    status,
  ]);

  useEffect(() => {
    if (status) return;
    let cancelled = false;
    void (async () => {
      try {
        const provider = await loadLibraryProvider(providerId);
        const detected = await provider.detect();
        if (cancelled) return;
        if (!detected.available) {
          setStatus(detected);
          setPhase("ready");
          return;
        }
        const localAccounts = await provider.listAccounts();
        if (cancelled) return;
        // Commit detection and account state together. `status` is this
        // effect's guard; setting it before the awaited account lookup would
        // run cleanup and discard the successful lookup as cancelled.
        setStatus(detected);
        setAccounts(localAccounts);
        setAccountId(
          provider.accountMode === "none"
            ? 0
            : (localAccounts.find((account) => account.mostRecent)?.accountId ??
                localAccounts[0]?.accountId ??
                null),
        );
        setPhase("ready");
      } catch (cause) {
        if (!cancelled) {
          setError(formatError(cause));
          setPhase("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, providerId]);

  function isCurrentImport(signal: AbortSignal) {
    return (
      !signal.aborted &&
      importAbortController.current.signal === signal &&
      useAppStore.getState().libraryImportProvider === providerId
    );
  }

  function cancelImport() {
    importAbortController.current.abort();
    setPhase("ready");
    setScan(null);
    setResolved(new Map());
    setSelected(new Set());
    setAuthorizeUrl(null);
    setWaitingForServer(false);
    setError(null);
    setAddingExternalId(null);
    setBrowsingExternalId(null);
  }

  function requestScan(includeBattleNetAccount = false) {
    if (isBattleNet) {
      setPendingBattleNetScan(
        includeBattleNetAccount ? "account" : "installed",
      );
    } else {
      void scanAccount();
    }
  }

  async function scanAccount(includeBattleNetAccount = false) {
    if (accountId === null) return;
    const copyOnStart = copyAuthorizeUrlOnStart.current;
    copyAuthorizeUrlOnStart.current = false;
    const controller = new AbortController();
    importAbortController.current.abort();
    importAbortController.current = controller;
    const { signal } = controller;
    setActiveImportGroup("ready");
    setPhase("scanning");
    setBattleNetAccountScan(isBattleNet && includeBattleNetAccount);
    setError(null);
    setAuthorizeUrl(null);
    setXboxProgress("authorization");
    setWaitingForServer(false);
    setScan(null);
    setResolved(new Map());
    setSelected(new Set());
    setCompleted(new Set());
    setManualExecutables({});
    setBrowsedExecutables({});
    setCapability("unknown");
    try {
      const provider = await loadLibraryProvider(providerId);
      if (!isCurrentImport(signal)) return;
      const result = await provider.scan(accountId, {
        apiEndpoint,
        signal: controller.signal,
        onRateLimitWait: (waiting) => {
          if (isCurrentImport(signal)) setWaitingForServer(waiting);
        },
        onAuthorizeUrl: isXbox
          ? (url) => {
              if (!isCurrentImport(signal)) return;
              setAuthorizeUrl(url);
              if (copyOnStart) void copyAuthorizeUrl(url, signal);
            }
          : undefined,
        onXboxProgress: isXbox
          ? (stage) => {
              if (isCurrentImport(signal)) setXboxProgress(stage);
            }
          : undefined,
        openAuthorizeUrl: !isXbox || !copyOnStart,
        ...(isBattleNet
          ? {
              battleNetAccount: includeBattleNetAccount,
              battleNetProductIds: [...existingImports.values()]
                .filter((entry) => entry.provider === "battlenet")
                .map((entry) => entry.externalId),
            }
          : {}),
      });
      if (!isCurrentImport(signal)) return;
      if (isBattleNet && !result.partial) {
        const installedIds = new Set(
          result.games
            .filter((game) => game.installed)
            .map((game) => game.externalId),
        );
        const state = useAppStore.getState();
        for (const install of state.libraryInstalls.values()) {
          if (
            install.provider === "battlenet" &&
            !installedIds.has(install.externalId)
          ) {
            state.removeLibraryInstall("battlenet", install.externalId);
          }
        }
      }
      setScan(result);
      setManualExecutables(
        Object.fromEntries(
          result.games.flatMap((game) => {
            const candidates = importExeCandidates(
              game.executables,
              [],
              game.name,
              ignoredProcesses,
            );
            const existing = existingImports.get(
              libraryEntryKey(providerId, game.externalId),
            );
            const previousCandidates =
              isBattleNet && existing
                ? candidates.filter((candidate) =>
                    existing.linkedExeNames.some(
                      (name) =>
                        name.toLowerCase() === candidate.fileName.toLowerCase(),
                    ),
                  )
                : [];
            const preselected =
              (previousCandidates.length === 1
                ? previousCandidates[0]
                : undefined) ??
              candidates.find((item) => item.declared) ??
              (candidates.length === 1 ? candidates[0] : undefined);
            return preselected
              ? [[game.externalId, preselected.relativePath]]
              : [];
          }),
        ),
      );
      const lookup = result.resolvedGames
        ? { capability: "supported" as const, games: result.resolvedGames }
        : await resolveLibraryGames(
            apiEndpoint,
            providerId,
            result.games,
            signal,
            (waiting) => {
              if (isCurrentImport(signal)) setWaitingForServer(waiting);
            },
          );
      if (!isCurrentImport(signal)) return;
      setCapability(lookup.capability);
      if (lookup.capability === "supported") {
        const byKey = new Map(lookup.games.map((game) => [game.key, game]));
        if (providerId !== "steam") {
          for (const game of result.games) {
            const key = libraryEntryKey(providerId, game.externalId);
            const existing = existingImports.get(key);
            if (!existing) continue;
            const previousMatch = byKey.get(key);
            const existingExecutables = isBattleNet
              ? previousMatch?.game?.id === existing.gameId
                ? previousMatch.executables
                : (
                    await reverseResolveLibraryGame(
                      apiEndpoint,
                      existing.gameId,
                      signal,
                    )
                  ).executables
              : [];
            if (!isCurrentImport(signal)) return;
            byKey.set(key, {
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
              candidates: byKey.get(key)?.candidates,
            });
          }
        }
        setResolved(byKey);
        setActiveImportGroup(
          initialImportGroup(
            providerId,
            result.games,
            byKey,
            existingImports,
            ignoredProcesses,
          ),
        );
        setSelected(
          new Set(
            result.games
              .filter((game) => {
                const key = libraryEntryKey(providerId, game.externalId);
                return (
                  importGroupForGame({
                    game,
                    provider: providerId,
                    resolved: byKey.get(key),
                    alreadyImported: existingImports.has(key),
                    ignoredProcesses,
                  }) === "ready"
                );
              })
              .map((game) => game.externalId),
          ),
        );
      }
      setPhase("ready");
    } catch (cause) {
      if (!isCurrentImport(signal)) return;
      setError(formatError(cause));
      setPhase("ready");
    }
  }

  async function importSelected() {
    if (!scan) return;
    const { signal } = importAbortController.current;
    if (!isCurrentImport(signal)) return;
    setPhase("importing");
    setError(null);
    try {
      const commits = scan.games.flatMap((game) => {
        if (!selected.has(game.externalId)) return [];
        const match = resolved.get(
          libraryEntryKey(providerId, game.externalId),
        );
        if (
          !match ||
          !canImportScannedGame({
            game,
            resolved: match,
            alreadyImported: existingImports.has(
              libraryEntryKey(providerId, game.externalId),
            ),
            ignoredProcesses,
          })
        ) {
          return [];
        }
        const executable = game.executables.find(
          (item) => item.relativePath === manualExecutables[game.externalId],
        );
        const commit = buildLibraryImportCommit({
          provider: providerId,
          scanned: game,
          resolved: match,
          selectedExecutable: executable,
          ignoredProcesses,
        });
        return commit ? [commit] : [];
      });
      if (commits.length === 0)
        throw new Error("Pick at least one game to import.");
      await backupImporterDataOnce(signal);
      if (!isCurrentImport(signal)) return;
      const result = await runLibraryImport(commits, signal);
      if (!isCurrentImport(signal)) return;
      const failedShares = result.shareOutcomes.filter(
        ({ outcome }) => outcome.kind === "failed",
      ).length;
      const importedIds = new Set(
        commits.map((commit) => commit.entry.externalId),
      );
      setSelected(
        (current) => new Set([...current].filter((id) => !importedIds.has(id))),
      );
      setActiveImportGroup(isXbox ? "ready" : "imported");
      setPhase("done");
      addToast({
        tone: "success",
        title: `${commits.length} ${providerName} ${commits.length === 1 ? "game" : "games"} imported`,
        detail:
          failedShares > 0
            ? `Your library is available in My Games. ${failedShares} game ${failedShares === 1 ? "file needs" : "files need"} another try when you are back online.`
            : isBattleNet
              ? "Your games are now in My Games, ready for future tracking."
              : "Your library and playtime are now available in My Games.",
      });
    } catch (cause) {
      if (!isCurrentImport(signal)) return;
      setError(formatError(cause));
      setPhase("ready");
    }
  }

  function selectedExecutableFor(game: ScannedLibraryGame) {
    const chosen = manualExecutables[game.externalId];
    return (
      game.executables.find((item) => item.relativePath === chosen) ??
      (browsedExecutables[game.externalId]?.relativePath === chosen
        ? browsedExecutables[game.externalId]
        : undefined)
    );
  }

  async function addAndShareGame(game: ScannedLibraryGame) {
    const match = resolved.get(libraryEntryKey(providerId, game.externalId));
    const selectedExecutable = selectedExecutableFor(game);
    if (!match || !selectedExecutable) return;

    const commit = buildLibraryImportCommit({
      provider: providerId,
      scanned: game,
      resolved: match,
      selectedExecutable,
      ignoredProcesses,
    });
    if (!commit) return;

    const { signal } = importAbortController.current;
    if (!isCurrentImport(signal)) return;
    setAddingExternalId(game.externalId);
    setError(null);
    try {
      await backupImporterDataOnce(signal);
      if (!isCurrentImport(signal)) return;
      const result = await runLibraryImport([commit], signal);
      if (!isCurrentImport(signal)) return;
      setSelected((current) => {
        const next = new Set(current);
        next.delete(game.externalId);
        return next;
      });
      addToast({
        tone: "success",
        title: `${match.game?.name ?? game.name ?? "Game"} added to My Games`,
        detail: importShareDetail(
          result.shareOutcomes.map(({ outcome }) => outcome.kind),
        ),
      });
    } catch (cause) {
      if (!isCurrentImport(signal)) return;
      setError(formatError(cause));
    } finally {
      if (isCurrentImport(signal)) setAddingExternalId(null);
    }
  }
  async function confirmAndImportGame(
    scanned: ScannedLibraryGame,
    selectedGame: GameMetadata,
  ) {
    const key = libraryEntryKey(providerId, scanned.externalId);
    const { signal } = importAbortController.current;
    if (!isCurrentImport(signal)) return;
    setAddingExternalId(scanned.externalId);
    setError(null);
    try {
      const reverseMatch = await reverseResolveLibraryGame(
        apiEndpoint,
        selectedGame.id,
        signal,
      );
      if (!isCurrentImport(signal)) return;
      const resolvedGame: ResolvedLibraryGame = {
        key,
        status: "resolved",
        game: reverseMatch.game,
        executables: reverseMatch.executables,
        candidates: resolved.get(key)?.candidates,
      };
      const commit = buildLibraryImportCommit({
        provider: providerId,
        scanned,
        resolved: resolvedGame,
        ignoredProcesses,
        selectedExecutable: selectedExecutableFor(scanned),
      });
      if (!commit)
        throw new Error(
          `The selected ${providerName} game cannot be imported.`,
        );
      if (isBattleNet && scanned.installed && commit.scopedLinks.length === 0)
        throw new Error(
          "Pick the game file to track before importing this game.",
        );

      await backupImporterDataOnce(signal);
      if (!isCurrentImport(signal)) return;
      const result = await runLibraryImport([commit], signal);
      if (!isCurrentImport(signal)) return;
      setResolved((current) => new Map(current).set(key, resolvedGame));
      setCompleted((current) => new Set(current).add(scanned.externalId));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(scanned.externalId);
        return next;
      });
      const linkedCount =
        commit.exeCacheEntries.length + commit.scopedLinks.length;
      addToast({
        tone: "success",
        title: `${reverseMatch.game.name} imported`,
        detail: isBattleNet
          ? result.shareOutcomes.length > 0
            ? importShareDetail(
                result.shareOutcomes.map(({ outcome }) => outcome.kind),
              )
            : scanned.installed
              ? "The game file is linked to this installation for future tracking."
              : "Added to My Games. After installing it, scan again to link its game file."
          : linkedCount > 0
            ? `${linkedCount} known game ${linkedCount === 1 ? "file was" : "files were"} linked, so PlayCounter tracks this game once it is installed.`
            : "No game file is known for this title yet. PlayCounter picks it up the first time you run the game.",
      });
    } catch (cause) {
      if (!isCurrentImport(signal)) return;
      setError(formatError(cause));
    } finally {
      if (isCurrentImport(signal)) setAddingExternalId(null);
    }
  }

  async function browseExecutable(game: ScannedLibraryGame) {
    const { signal } = importAbortController.current;
    if (!isCurrentImport(signal)) return;
    if (!game.installPath) {
      setError(
        `${providerName} did not report an install folder for this game.`,
      );
      return;
    }
    setBrowsingExternalId(game.externalId);
    setError(null);
    try {
      const selectedPath = await open({
        multiple: false,
        directory: false,
        defaultPath: game.installPath,
        filters: [{ name: "Game file", extensions: ["exe"] }],
      });
      if (!isCurrentImport(signal)) return;
      if (typeof selectedPath !== "string") return;
      const executable = await invoke<ScannedExecutable>(
        "library_inspect_executable",
        {
          provider: providerId,
          installPath: game.installPath,
          executablePath: selectedPath,
        },
      );
      if (!isCurrentImport(signal)) return;
      if (matchesProcessPatternSet(executable.fileName, ignoredProcesses)) {
        throw new Error(
          `${executable.fileName} is on PlayCounter's ignore list, so it cannot be used as the game file.`,
        );
      }
      setBrowsedExecutables((current) => ({
        ...current,
        [game.externalId]: executable,
      }));
      setManualExecutables((current) => ({
        ...current,
        [game.externalId]: executable.relativePath,
      }));
    } catch (cause) {
      if (!isCurrentImport(signal)) return;
      setError(formatError(cause));
    } finally {
      if (isCurrentImport(signal)) setBrowsingExternalId(null);
    }
  }

  async function backupImporterDataOnce(signal: AbortSignal) {
    signal.throwIfAborted();
    if (importerSessionBackedUp) return;
    await invoke("backup_local_data", {
      contents: localStorage.getItem(STORAGE_KEY) ?? "{}",
    });
    signal.throwIfAborted();
    importerSessionBackedUp = true;
  }

  async function copyAuthorizeUrl(
    url = authorizeUrl,
    signal = importAbortController.current.signal,
  ) {
    if (!isCurrentImport(signal)) return;
    if (!url) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("PlayCounter cannot reach the clipboard right now.");
      }
      await navigator.clipboard.writeText(url);
      if (!isCurrentImport(signal)) return;
      addToast({
        tone: "success",
        title: "Sign-in link copied",
        detail: "Open it in the browser you want to sign in with.",
      });
    } catch (cause) {
      if (!isCurrentImport(signal)) return;
      addToast({
        tone: "error",
        title: "Could not copy sign-in link",
        detail: formatError(cause),
      });
    }
  }
  const selectableExternalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const game of scan?.games ?? []) {
      const key = libraryEntryKey(providerId, game.externalId);
      const match = resolved.get(key);
      if (
        completed.has(game.externalId) ||
        !canImportScannedGame({
          game,
          resolved: match,
          alreadyImported: existingImports.has(key),
          ignoredProcesses,
        })
      ) {
        continue;
      }
      ids.add(game.externalId);
    }
    return ids;
  }, [
    completed,
    existingImports,
    ignoredProcesses,
    providerId,
    resolved,
    scan,
  ]);
  const selectedCount = [...selected].filter((externalId) =>
    selectableExternalIds.has(externalId),
  ).length;
  const importGroups = useMemo(() => {
    const groups: Array<{
      key: ImportGroupKey;
      label: string;
      description: string;
      games: ScannedLibraryGame[];
    }> = [
      {
        key: "ready",
        label: "Ready to import",
        description: "Nothing left to decide. Pick the games and import them.",
        games: [] as ScannedLibraryGame[],
      },
      {
        key: "attention",
        label: "Needs attention",
        description: isXbox
          ? "Confirm which game this is before importing it."
          : isBattleNet
            ? "Confirm the game and its executable before importing it."
            : "Pick the game file. Known matches are linked; unknown files can be shared with the community.",
        games: [] as ScannedLibraryGame[],
      },
      {
        key: "unavailable",
        label: "Unavailable right now",
        description: isXbox
          ? "PlayCounter could not match this Xbox title to a game it knows."
          : isBattleNet
            ? "Game details or installation data are unavailable. Try scanning again."
            : "No game details, or no Steam playtime to import. These are usually demos and apps like Wallpaper Engine or Soundpad.",
        games: [] as ScannedLibraryGame[],
      },
      {
        key: "imported",
        label: "Imported",
        description: isBattleNet
          ? "Games already in My Games. Import again to refresh installation and last-played data."
          : `Games already in My Games. Import one again to update its ${providerName} playtime.`,
        games: [] as ScannedLibraryGame[],
      },
    ];
    const groupIndex: Record<ImportGroupKey, number> = {
      ready: 0,
      attention: 1,
      unavailable: 2,
      imported: 3,
    };

    for (const game of scan?.games ?? []) {
      const key = libraryEntryKey(providerId, game.externalId);
      const group = importGroupForGame({
        game,
        provider: providerId,
        resolved: resolved.get(key),
        alreadyImported: existingImports.has(key),
        completed: completed.has(game.externalId),
        ignoredProcesses,
      });
      groups[groupIndex[group]].games.push(game);
    }

    return groups;
  }, [
    completed,
    existingImports,
    ignoredProcesses,
    isXbox,
    isBattleNet,
    providerId,
    providerName,
    resolved,
    scan,
  ]);
  const activeImportGroupDetails =
    importGroups.find((group) => group.key === activeImportGroup) ??
    importGroups[0];
  const activeSelectableGames = activeImportGroupDetails.games.filter((game) =>
    selectableExternalIds.has(game.externalId),
  );

  if (phase === "detecting") {
    return (
      <LoadingPanel
        label={
          isXbox
            ? "Preparing the Xbox import…"
            : `Looking for ${providerName} on this PC…`
        }
      />
    );
  }
  if (!status?.available) {
    return (
      <Panel className="grid min-h-[360px] place-items-center p-8 text-center">
        <div className="max-w-lg">
          <LibraryBig size={36} className="mx-auto text-text-faint" />
          <h2 className="mt-4 text-2xl font-semibold text-text">
            {providerName} was not found
          </h2>
          <p className="mt-2 text-text-muted">
            {isXbox
              ? "The Xbox import is unavailable right now. Check your connection and try again."
              : isBattleNet
                ? "Battle.net import is available on Windows."
                : "PlayCounter looks for Steam in the Windows registry and in the usual install folders. You never have to sign in to Steam."}
          </p>
          {error ? <ErrorNotice message={error} /> : null}
        </div>
      </Panel>
    );
  }
  if (phase === "scanning") {
    return (
      <LoadingPanel
        label={
          waitingForServer
            ? "The server is busy. Your import will continue automatically…"
            : isXbox
              ? authorizeUrl
                ? xboxScanLabel(xboxProgress)
                : "Connecting to Xbox…"
              : isBattleNet && battleNetAccountScan && !scan
                ? "Complete Battle.net sign-in in the window that opened. Reading your account games…"
                : `Scanning your ${providerName} library…`
        }
        onCancel={cancelImport}
        onCopySignInLink={
          isXbox && xboxProgress === "authorization" && authorizeUrl
            ? () => void copyAuthorizeUrl()
            : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      {isBattleNet && pendingBattleNetScan !== null ? (
        <Modal
          labelId="battlenet-playtime-title"
          title="Battle.net playtime"
          icon={Clock3}
          onClose={() => setPendingBattleNetScan(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setPendingBattleNetScan(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const includeAccount = pendingBattleNetScan === "account";
                  setPendingBattleNetScan(null);
                  void scanAccount(includeAccount);
                }}
              >
                OK
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-sm leading-6 text-text-muted">
            <p>
              Battle.net does not provide historical playtime. To include your
              previous hours, you need to set each game&apos;s total yourself.
            </p>
            <p>
              After importing, right-click a game in{" "}
              <strong className="text-text">My Games</strong> and choose{" "}
              <strong className="text-text">Adjust total playtime</strong>.
            </p>
            <div className="rounded-lg border border-border bg-bg/60 p-3">
              <p className="font-semibold text-text">
                World of Warcraft example
              </p>
              <p className="mt-1">
                Type <code className="text-text">/played</code> on each of your
                characters and add up their total time for the WoW version
                you&apos;re importing.
              </p>
            </div>
            <p>PlayCounter tracks new sessions automatically.</p>
          </div>
        </Modal>
      ) : null}
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ProviderBadge provider={providerId} />
              <span className="text-sm text-text-muted">
                {isXbox
                  ? "Playtime from your Xbox account"
                  : isBattleNet
                    ? "Account and installed games"
                    : "Library from this PC"}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold text-text">
              {isXbox
                ? "Connect your Xbox account"
                : isBattleNet
                  ? "Import your Battle.net games"
                  : "Pick a Steam account on this PC"}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {isXbox
                ? "Microsoft sign-in opens in your browser. PlayCounter never sees your password, and your sign-in is thrown away as soon as the import is done."
                : isBattleNet
                  ? "Sign in to include games from your account, even when they are not installed. You can also scan installed games without signing in."
                  : "Your game list stays on this PC. PlayCounter only looks up the Steam AppIDs it found, to get game names and covers."}
            </p>
            {isXbox ? (
              <p className="mt-2 text-sm text-text-faint">
                Use the Microsoft account that belongs to your Xbox gamertag. If
                you are not sure, copy the sign-in link and open it in a private
                browser window.
              </p>
            ) : null}
            {isBattleNet ? (
              <p className="mt-2 text-sm text-text-faint">
                Sign-in opens in a temporary Battle.net window and is discarded
                when the scan finishes. Each sign-in lets you choose an account.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isBattleNet ? (
              <select
                aria-label={`${providerName} account`}
                value={accountId ?? ""}
                onChange={(event) => {
                  importAbortController.current.abort();
                  importAbortController.current = new AbortController();
                  setAddingExternalId(null);
                  setBrowsingExternalId(null);
                  setAccountId(Number(event.target.value));
                  setScan(null);
                  setResolved(new Map());
                  setSelected(new Set());
                  setManualExecutables({});
                  setBrowsedExecutables({});
                  setCapability("unknown");
                  setError(null);
                }}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
              >
                {accounts.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.personaName ?? `Account ${account.accountId}`}
                    {isXbox ? "" : ` · ${account.gamesWithPlaytime} games`}
                  </option>
                ))}
              </select>
            ) : null}
            {isXbox ? (
              <Button
                variant="secondary"
                icon={Copy}
                disabled={accountId === null}
                onClick={() => {
                  copyAuthorizeUrlOnStart.current = true;
                  void scanAccount();
                }}
              >
                Copy sign-in link
              </Button>
            ) : null}
            {isBattleNet ? (
              <Button
                variant="secondary"
                icon={HardDrive}
                disabled={accountId === null}
                onClick={() => requestScan()}
              >
                Find installed games
              </Button>
            ) : null}
            <Button
              variant="primary"
              icon={scan ? RefreshCw : Download}
              disabled={accountId === null}
              onClick={() => requestScan(isBattleNet)}
            >
              {isBattleNet
                ? "Sign in and find games"
                : scan
                  ? "Scan again"
                  : isXbox
                    ? "Sign in and find games"
                    : "Find games"}
            </Button>
          </div>
        </div>
      </Panel>

      {error ? <ErrorNotice message={error} /> : null}
      {!isBattleNet && accounts.length === 0 ? (
        <Panel className="p-4 text-sm text-text-muted">
          {isXbox
            ? "The Xbox import could not be prepared. Please try again later."
            : "Steam is installed, but PlayCounter could not read any account data. Start Steam, sign in once, then come back here."}
        </Panel>
      ) : null}
      {capability === "unsupported" ? (
        <Panel className="border-warning-border bg-warning-tint p-4 text-sm text-warning">
          PlayCounter cannot look up {providerName} games right now. Your
          library was scanned, but importing is switched off so you do not end
          up with wrongly named games.
        </Panel>
      ) : null}
      {scan?.warnings.length ? (
        <Panel className="p-4 text-sm text-warning">
          {scan.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </Panel>
      ) : null}
      {scan ? (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-semibold text-text">{providerName} games</h2>
              <p className="text-sm text-text-muted">
                {importGroups[0].games.length} of {scan.games.length} games
                ready to import
              </p>
            </div>
            {activeSelectableGames.length > 0 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setSelected(
                      new Set(
                        activeSelectableGames.map((game) => game.externalId),
                      ),
                    )
                  }
                >
                  Select all
                </Button>
                <Button
                  variant="secondary"
                  disabled={selectedCount === 0}
                  onClick={() => setSelected(new Set())}
                >
                  Select none
                </Button>
                <Button
                  variant="primary"
                  icon={Download}
                  loading={phase === "importing"}
                  disabled={selectedCount === 0 || capability !== "supported"}
                  onClick={() => void importSelected()}
                >
                  Import {selectedCount || "selected"}
                </Button>
              </div>
            ) : null}
          </div>
          <div>
            <div
              role="tablist"
              aria-label="Import readiness"
              className="flex flex-wrap gap-1 border-b border-border bg-surface-hover/40 px-5 pt-3"
            >
              {importGroups.map((group) => {
                const isActive = group.key === activeImportGroup;
                return (
                  <button
                    key={group.key}
                    id={`import-tab-${group.key}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`import-panel-${group.key}`}
                    disabled={group.games.length === 0}
                    onClick={() => setActiveImportGroup(group.key)}
                    className={`-mb-px flex items-center gap-2 rounded-t-md border px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "border-border border-b-surface bg-surface text-text"
                        : "border-transparent text-text-muted hover:bg-surface-hover hover:text-text"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span>{group.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        isActive
                          ? "bg-accent/15 text-accent"
                          : "bg-surface-hover text-text-muted"
                      }`}
                    >
                      {group.games.length}
                    </span>
                  </button>
                );
              })}
            </div>
            <section
              id={`import-panel-${activeImportGroupDetails.key}`}
              role="tabpanel"
              aria-labelledby={`import-tab-${activeImportGroupDetails.key}`}
            >
              <p className="border-b border-border px-5 py-3 text-xs text-text-muted">
                {activeImportGroupDetails.description}
              </p>
              <div className="divide-y divide-border">
                {activeImportGroupDetails.games.length > 0 ? (
                  activeImportGroupDetails.games.map((game) => (
                    <ImportRow
                      key={game.externalId}
                      game={game}
                      provider={providerId}
                      apiEndpoint={apiEndpoint}
                      resolved={resolved.get(
                        libraryEntryKey(providerId, game.externalId),
                      )}
                      selected={selected.has(game.externalId)}
                      alreadyImported={existingImports.has(
                        libraryEntryKey(providerId, game.externalId),
                      )}
                      showSelection={selectableExternalIds.has(game.externalId)}
                      showExecutableChoice={
                        activeImportGroupDetails.key === "attention" ||
                        activeImportGroupDetails.key === "imported"
                      }
                      showAddAndShare={
                        activeImportGroupDetails.key === "attention"
                      }
                      addingAndSharing={addingExternalId === game.externalId}
                      browsing={browsingExternalId === game.externalId}
                      manualExecutable={manualExecutables[game.externalId]}
                      browsedExecutable={browsedExecutables[game.externalId]}
                      ignoredProcesses={ignoredProcesses}
                      onAddAndShare={() => void addAndShareGame(game)}
                      onGameMatch={(match) => confirmAndImportGame(game, match)}
                      onBrowseExecutable={() => void browseExecutable(game)}
                      onManualExecutable={(relativePath) =>
                        setManualExecutables((current) => ({
                          ...current,
                          [game.externalId]: relativePath,
                        }))
                      }
                      onSelected={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(game.externalId);
                          else next.delete(game.externalId);
                          return next;
                        })
                      }
                    />
                  ))
                ) : (
                  <p className="px-5 py-8 text-center text-sm text-text-muted">
                    Nothing here right now.
                  </p>
                )}
              </div>
            </section>
          </div>
        </Panel>
      ) : null}

      {phase === "done" ? (
        <Panel className="flex items-center justify-between gap-4 border-success-border bg-success-tint p-4">
          <div className="flex items-center gap-3 text-success">
            <CheckCircle2 size={20} />
            <span className="font-semibold">Import finished.</span>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setLibraryTab(providerId);
              setActiveView("games");
            }}
          >
            Open My Games
          </Button>
        </Panel>
      ) : null}
    </div>
  );
}

export default ImportLibraryView;

export function ImportRow({
  game,
  provider,
  apiEndpoint,
  resolved,
  selected,
  alreadyImported,
  showSelection,
  showExecutableChoice,
  showAddAndShare,
  addingAndSharing,
  browsing,
  manualExecutable,
  browsedExecutable,
  ignoredProcesses,
  onGameMatch,
  onAddAndShare,
  onBrowseExecutable,
  onManualExecutable,
  onSelected,
}: {
  provider: BuiltinImportProviderId;
  apiEndpoint: string;
  game: ScannedLibraryGame;
  resolved?: ResolvedLibraryGame;
  selected: boolean;
  alreadyImported: boolean;
  showSelection: boolean;
  showExecutableChoice: boolean;
  showAddAndShare: boolean;
  addingAndSharing: boolean;
  browsing: boolean;
  manualExecutable?: string;
  browsedExecutable?: ScannedExecutable;
  ignoredProcesses: ReadonlySet<string>;
  onAddAndShare: () => void;
  onGameMatch: (game: GameMetadata) => Promise<void>;
  onBrowseExecutable: () => void;
  onManualExecutable: (value: string) => void;
  onSelected: (checked: boolean) => void;
}) {
  const importable = isImportable(game, resolved);
  const noImportablePlaytime =
    game.playtimeSeconds !== null &&
    game.playtimeSeconds <= 0 &&
    game.lastPlayedUnix === undefined;
  const candidates = importExeCandidates(
    game.executables,
    resolved?.executables ?? [],
    resolved?.game?.name ?? game.name,
    ignoredProcesses,
  );
  const executableOptions =
    browsedExecutable &&
    !candidates.some(
      (candidate) =>
        candidate.relativePath.toLowerCase() ===
        browsedExecutable.relativePath.toLowerCase(),
    )
      ? [browsedExecutable, ...candidates]
      : candidates;
  const showExeChoice = requiresExecutableChoice(
    game,
    resolved,
    ignoredProcesses,
  );
  const needsIdentityConfirmation =
    provider !== "steam" &&
    hasImportableContent(game) &&
    resolved?.status !== "resolved";
  const showExeBlock =
    showExecutableChoice &&
    (showExeChoice ||
      (needsIdentityConfirmation &&
        game.installed &&
        game.installPath !== undefined));
  const Row = showSelection ? "label" : "article";
  return (
    <Row
      className={`flex items-start gap-4 px-5 py-4 ${
        showSelection && importable
          ? "cursor-pointer transition-colors hover:bg-surface-hover/50"
          : ""
      }`}
    >
      {showSelection ? (
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-[rgb(var(--color-accent))]"
          checked={selected}
          disabled={!importable}
          onChange={(event) => onSelected(event.target.checked)}
          aria-label={`Import ${resolved?.game?.name ?? game.name ?? game.externalId}`}
        />
      ) : null}
      {resolved?.game?.coverUrl ? (
        <img
          src={resolved.game.coverUrl}
          alt=""
          className="h-16 w-12 rounded object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-text">
            {resolved?.game?.name ??
              game.name ??
              `${LIBRARY_PROVIDER_LABELS[provider]} game ${game.externalId}`}
          </h3>
          {alreadyImported ? (
            <span className="text-xs font-medium text-success">
              {provider === "battlenet"
                ? "Already in My Games · import again to refresh"
                : "Already in My Games · import again to update playtime"}
            </span>
          ) : null}
          {!importable ? (
            <span className="text-xs font-medium text-warning">
              {provider !== "steam" && hasImportableContent(game)
                ? "Confirm which game this is"
                : noImportablePlaytime
                  ? "No playtime to import"
                  : "Game details unavailable"}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>
            {provider === "battlenet"
              ? "Product"
              : provider === "xbox"
                ? "Xbox title ID"
                : "AppID"}{" "}
            {game.externalId}
          </span>
          {provider !== "battlenet" ? (
            <span>
              {game.playtimeSeconds === null
                ? "Playtime unknown"
                : formatDuration(game.playtimeSeconds, false)}
            </span>
          ) : null}
          <span>
            {game.installed
              ? "Installed"
              : game.installationStatusUnknown
                ? "Installation not checked"
                : "Not installed"}
          </span>
          {provider === "battlenet" && game.lastPlayedUnix ? (
            <span>
              Last played{" "}
              {new Date(game.lastPlayedUnix * 1000).toLocaleDateString()}
            </span>
          ) : null}
          {provider === "steam" ? (
            resolved?.executables.length ? (
              <span>
                {resolved.executables.length} known game file
                {resolved.executables.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span>No known game file</span>
            )
          ) : null}
        </div>
        {showExeBlock ? (
          <div className="mt-3 max-w-2xl text-xs text-text-muted">
            <p>
              {needsIdentityConfirmation
                ? "Pick the game file PlayCounter should watch. Known matches are linked; unknown files go to the community for review with the game you confirm below."
                : showAddAndShare
                  ? "Pick the game file PlayCounter should watch. Add and Share links known matches automatically. Unknown files are sent to the community for review."
                  : "Pick the game file PlayCounter should watch, then import this game again to save it. Only unknown files are sent to the community for review."}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                aria-label={`Game file for ${resolved?.game?.name ?? game.name ?? game.externalId}`}
                value={manualExecutable ?? ""}
                onChange={(event) => onManualExecutable(event.target.value)}
                className="min-w-64 flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
              >
                <option value="">Pick a game file…</option>
                {executableOptions.map((candidate) => (
                  <option
                    key={candidate.relativePath}
                    value={candidate.relativePath}
                  >
                    {candidate.relativePath}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                icon={FolderOpen}
                loading={browsing}
                onClick={onBrowseExecutable}
              >
                Browse…
              </Button>
              {showAddAndShare && !needsIdentityConfirmation ? (
                <Button
                  variant="primary"
                  icon={Share2}
                  loading={addingAndSharing}
                  disabled={!manualExecutable}
                  onClick={onAddAndShare}
                >
                  Add and Share
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {needsIdentityConfirmation ? (
          <LibraryMatchControls
            apiEndpoint={apiEndpoint}
            provider={provider}
            candidates={resolved?.candidates ?? []}
            title={
              game.name ??
              `${LIBRARY_PROVIDER_LABELS[provider]} game ${game.externalId}`
            }
            importing={addingAndSharing}
            onConfirm={onGameMatch}
          />
        ) : null}
      </div>
    </Row>
  );
}
export function LibraryMatchControls({
  apiEndpoint,
  provider,
  candidates,
  title,
  onConfirm,
  importing,
}: {
  apiEndpoint: string;
  candidates: GameMetadata[];
  title: string;
  onConfirm: (game: GameMetadata) => Promise<void>;
  importing: boolean;
  provider: BuiltinImportProviderId;
}) {
  const [query, setQuery] = useState(title);
  const [choices, setChoices] = useState(candidates);
  const [selectedIgdbId, setSelectedIgdbId] = useState<number | null>(
    candidates[0]?.igdbId ?? null,
  );
  const [searching, setSearching] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  useEffect(() => {
    setSearching(false);
    return () => searchController.current?.abort();
  }, [apiEndpoint, provider]);
  const [message, setMessage] = useState(
    candidates.length > 0
      ? "Choose the exact game, then confirm the match."
      : "No safe suggestion found. Search for the game by name.",
  );
  const selectedGame = choices.find(
    (candidate) => candidate.igdbId === selectedIgdbId,
  );

  async function runSearch() {
    if (query.trim().length < 2) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setMessage("");
    try {
      const games = await searchLibraryGames(apiEndpoint, query, {
        signal: controller.signal,
        mainGamesAndRemastersOnly: provider === "xbox",
      });
      if (controller.signal.aborted) return;
      setChoices(games);
      setSelectedIgdbId(games[0]?.igdbId ?? null);
      setMessage(
        games.length > 0
          ? "Choose the exact game, then confirm the match."
          : "No matching games found. Try the English title or another spelling.",
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setChoices([]);
      setSelectedIgdbId(null);
      setMessage(formatError(cause));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  return (
    <div className="mt-3 max-w-2xl rounded-md border border-border bg-bg/50 p-3 text-xs text-text-muted">
      <p>
        Game names are not always unique. Confirm the right game before
        {provider === "battlenet"
          ? " adding it to your library."
          : " its playtime is added to your library."}
      </p>
      <div className="mt-3 flex items-start gap-3">
        {selectedGame?.coverUrl ? (
          <img
            src={selectedGame.coverUrl}
            alt={`${selectedGame.name} cover`}
            className="h-24 w-16 shrink-0 rounded-md bg-surface-hover object-cover"
          />
        ) : (
          <div
            aria-label="No cover available"
            className="grid h-24 w-16 shrink-0 place-items-center rounded-md bg-surface-hover text-text-faint"
          >
            <HardDrive size={20} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
          <select
            aria-label={`Game match for ${title}`}
            value={selectedIgdbId ?? ""}
            onChange={(event) => setSelectedIgdbId(Number(event.target.value))}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            {choices.length === 0 ? (
              <option value="">No game selected</option>
            ) : null}
            {choices.map((candidate) => (
              <option key={candidate.igdbId} value={candidate.igdbId}>
                {candidate.name}
                {candidate.releaseYear ? ` · ${candidate.releaseYear}` : ""} ·
                IGDB {candidate.igdbId}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            loading={importing}
            disabled={!selectedGame}
            onClick={() => selectedGame && void onConfirm(selectedGame)}
          >
            Confirm and Import
          </Button>
        </div>
      </div>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for the game by name"
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          icon={Search}
          loading={searching}
          disabled={query.trim().length < 2}
        >
          Search IGDB
        </Button>
      </form>
      {message ? (
        <p className="mt-2" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function importShareDetail(outcomes: readonly string[]) {
  if (outcomes.includes("failed"))
    return "The game was added on this PC, but its game file could not be verified or shared. Please try again later.";
  if (outcomes.includes("rejected"))
    return "The game was added on this PC. This game file suggestion was previously rejected; its review status has been preserved.";
  if (outcomes.includes("submitted"))
    return "The game file was sent to the community for review.";
  return "An existing game file match was linked. No community review was needed.";
}

function requiresExecutableChoice(
  game: ScannedLibraryGame,
  resolved?: ResolvedLibraryGame,
  ignoredProcesses: ReadonlySet<string> = new Set(),
) {
  if (
    resolved?.status !== "resolved" ||
    !resolved.game?.igdbId ||
    !game.installed
  ) {
    return false;
  }
  const knownNames = new Set(
    resolved.executables
      .filter(
        (item) =>
          item.platform === "windows" &&
          item.kind === "exe" &&
          !matchesProcessPatternSet(item.value, ignoredProcesses),
      )
      .map((item) => item.value.toLowerCase()),
  );
  const hasKnownLocalExe = game.executables.some((item) =>
    knownNames.has(item.fileName.toLowerCase()),
  );
  return !hasKnownLocalExe && game.installPath !== undefined;
}

export function hasImportableActivity(game: ScannedLibraryGame) {
  return (
    (game.playtimeSeconds === null && game.hasPlayedEvidence !== false) ||
    (game.playtimeSeconds ?? 0) > 0 ||
    game.lastPlayedUnix !== undefined
  );
}

function hasImportableContent(game: ScannedLibraryGame) {
  return (
    hasImportableActivity(game) ||
    game.inAccountLibrary === true ||
    (game.hasPlayedEvidence !== undefined && game.installed)
  );
}

function isImportable(
  game: ScannedLibraryGame,
  resolved?: ResolvedLibraryGame,
) {
  return (
    resolved?.status === "resolved" &&
    resolved.game?.igdbId !== undefined &&
    hasImportableContent(game)
  );
}

export function canImportScannedGame(params: {
  game: ScannedLibraryGame;
  resolved?: ResolvedLibraryGame;
  alreadyImported: boolean;
  ignoredProcesses?: ReadonlySet<string>;
}) {
  const { game, resolved, alreadyImported, ignoredProcesses } = params;
  if (!isImportable(game, resolved)) return false;
  // Importing a game that is already in My Games only refreshes its playtime,
  // so a missing executable link must not block it. Picking a file stays
  // available in the Imported tab and is applied when it is chosen.
  return (
    alreadyImported ||
    !requiresExecutableChoice(game, resolved, ignoredProcesses)
  );
}

/**
 * A game already in My Games belongs to the Imported tab, even when the
 * provider still allows importing it again to refresh its playtime.
 */
export function importGroupForGame(params: {
  game: ScannedLibraryGame;
  provider: BuiltinImportProviderId;
  resolved?: ResolvedLibraryGame;
  alreadyImported: boolean;
  completed?: boolean;
  ignoredProcesses?: ReadonlySet<string>;
}): ImportGroupKey {
  const { game, provider, resolved, ignoredProcesses } = params;
  if (params.completed || params.alreadyImported) return "imported";
  if (!hasImportableContent(game)) return "unavailable";
  if (provider !== "steam" && resolved?.status !== "resolved")
    return "attention";
  if (!isImportable(game, resolved)) return "unavailable";
  if (requiresExecutableChoice(game, resolved, ignoredProcesses)) {
    return "attention";
  }
  return "ready";
}

function initialImportGroup(
  provider: BuiltinImportProviderId,
  games: readonly ScannedLibraryGame[],
  resolved: ReadonlyMap<string, ResolvedLibraryGame>,
  existingImports: ReadonlyMap<string, unknown>,
  ignoredProcesses: ReadonlySet<string>,
): ImportGroupKey {
  let hasAttention = false;
  let hasUnavailable = false;
  let hasImported = false;

  for (const game of games) {
    const key = libraryEntryKey(provider, game.externalId);
    switch (
      importGroupForGame({
        game,
        provider,
        resolved: resolved.get(key),
        alreadyImported: existingImports.has(key),
        ignoredProcesses,
      })
    ) {
      case "ready":
        return "ready";
      case "attention":
        hasAttention = true;
        break;
      case "unavailable":
        hasUnavailable = true;
        break;
      case "imported":
        hasImported = true;
        break;
    }
  }

  if (hasAttention) return "attention";
  if (hasUnavailable) return "unavailable";
  if (hasImported) return "imported";
  return "ready";
}

export function xboxScanLabel(stage: XboxImportProgressStage) {
  return stage === "history"
    ? "Reading your Xbox history…"
    : "Waiting for Microsoft sign-in…";
}

function LoadingPanel({
  label,
  onCancel,
  onCopySignInLink,
}: {
  label: string;
  onCancel?: () => void;
  onCopySignInLink?: () => void;
}) {
  return (
    <Panel className="grid min-h-[320px] place-items-center p-8 text-center text-text-muted">
      <div>
        <div role="status" aria-live="polite">
          <RefreshCw size={28} className="mx-auto animate-spin text-accent" />
          <p className="mt-3">{label}</p>
          {onCopySignInLink ? (
            <p className="mt-2 max-w-md text-sm text-text-faint">
              Browser did not open, or opened the wrong account? Copy the
              sign-in link and open it yourself.
            </p>
          ) : null}
        </div>
        {onCancel || onCopySignInLink ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {onCopySignInLink ? (
              <Button
                variant="secondary"
                icon={Copy}
                onClick={onCopySignInLink}
              >
                Copy sign-in link
              </Button>
            ) : null}
            {onCancel ? (
              <Button variant="secondary" onClick={onCancel}>
                Cancel import
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function ErrorNotice({ message }: { message: string }) {
  const throttled = message === RATE_LIMIT_MESSAGE;
  return (
    <div
      role={throttled ? "status" : "alert"}
      className={`mt-4 rounded-lg border px-4 py-3 text-sm ${throttled ? "border-warning-border bg-warning-tint text-warning" : "border-danger-border bg-danger-tint text-danger"}`}
    >
      {message}
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
