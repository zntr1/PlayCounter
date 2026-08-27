import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  LibraryBig,
  RefreshCw,
  Share2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryProviderId } from "@playcounter/shared";
import { runLibraryImport } from "../../library/importRun";
import { importExeCandidates } from "../../library/exeCandidates";
import { buildSteamImportCommit } from "../../library/importPlan";
import { loadLibraryProvider } from "../../library/providers";
import { resolveLibraryGames } from "../../library/resolve";
import type {
  LibraryScanResult,
  LocalLibraryAccount,
  ProviderStatus,
  ResolvedLibraryGame,
  ScannedExecutable,
  ScannedLibraryGame,
} from "../../library/types";
import { libraryEntryKey } from "../../library/types";
import { useAppStore } from "../../store";
import { matchesProcessPatternSet } from "../../ignoredProcessPatterns";
import { STORAGE_KEY } from "../../persistence";
import { Panel, ProviderBadge, formatDuration } from "../components";
import { Button } from "../primitives";

type Phase = "detecting" | "ready" | "scanning" | "importing" | "done";
type ImportGroupKey = "ready" | "attention" | "unavailable" | "imported";

let importerSessionBackedUp = false;

type ImporterSession = {
  phase: Phase;
  status: ProviderStatus | null;
  accounts: LocalLibraryAccount[];
  accountId: number | null;
  scan: LibraryScanResult | null;
  resolved: Map<string, ResolvedLibraryGame>;
  selected: Set<string>;
  manualExecutables: Record<string, string>;
  browsedExecutables: Record<string, ScannedExecutable>;
  capability: "unknown" | "supported" | "unsupported";
  error: string | null;
};

let importerSession: ImporterSession = {
  phase: "detecting",
  status: null,
  accounts: [],
  accountId: null,
  scan: null,
  resolved: new Map(),
  selected: new Set(),
  manualExecutables: {},
  browsedExecutables: {},
  capability: "unknown",
  error: null,
};

export function ImportLibraryView() {
  const providerId: LibraryProviderId = "steam";
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const existingImports = useAppStore((state) => state.libraryImports);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const addToast = useAppStore((state) => state.addToast);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setLibraryTab = useAppStore((state) => state.setLibraryTab);
  const [phase, setPhase] = useState<Phase>(() =>
    importerSession.phase === "scanning" ||
    importerSession.phase === "importing"
      ? "ready"
      : importerSession.phase,
  );
  const [status, setStatus] = useState<ProviderStatus | null>(
    importerSession.status,
  );
  const [accounts, setAccounts] = useState<LocalLibraryAccount[]>(
    importerSession.accounts,
  );
  const [accountId, setAccountId] = useState<number | null>(
    importerSession.accountId,
  );
  const [scan, setScan] = useState<LibraryScanResult | null>(
    importerSession.scan,
  );
  const [resolved, setResolved] = useState<Map<string, ResolvedLibraryGame>>(
    importerSession.resolved,
  );
  const [selected, setSelected] = useState<Set<string>>(
    importerSession.selected,
  );
  const [manualExecutables, setManualExecutables] = useState<
    Record<string, string>
  >(importerSession.manualExecutables);
  const [browsedExecutables, setBrowsedExecutables] = useState<
    Record<string, ScannedExecutable>
  >(importerSession.browsedExecutables);
  const [capability, setCapability] = useState<
    "unknown" | "supported" | "unsupported"
  >(importerSession.capability);
  const [error, setError] = useState<string | null>(importerSession.error);
  const [activeImportGroup, setActiveImportGroup] =
    useState<ImportGroupKey>("ready");
  const [addingExternalId, setAddingExternalId] = useState<string | null>(null);
  const [browsingExternalId, setBrowsingExternalId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    importerSession = {
      phase,
      status,
      accounts,
      accountId,
      scan,
      resolved,
      selected,
      manualExecutables,
      browsedExecutables,
      capability,
      error,
    };
  }, [
    accountId,
    accounts,
    browsedExecutables,
    capability,
    error,
    manualExecutables,
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
          localAccounts.find((account) => account.mostRecent)?.accountId ??
            localAccounts[0]?.accountId ??
            null,
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
  }, [status]);

  async function scanAccount() {
    if (accountId === null) return;
    setActiveImportGroup("ready");
    setPhase("scanning");
    setError(null);
    setScan(null);
    setResolved(new Map());
    setSelected(new Set());
    setManualExecutables({});
    setBrowsedExecutables({});
    setCapability("unknown");
    try {
      const provider = await loadLibraryProvider(providerId);
      const result = await provider.scan(accountId);
      setScan(result);
      const lookup = await resolveLibraryGames(
        apiEndpoint,
        providerId,
        result.games,
      );
      setCapability(lookup.capability);
      if (lookup.capability === "supported") {
        const byKey = new Map(lookup.games.map((game) => [game.key, game]));
        setResolved(byKey);
        setActiveImportGroup(
          initialImportGroup(
            result.games,
            byKey,
            existingImports,
            ignoredProcesses,
          ),
        );
        setSelected(
          new Set(
            result.games
              .filter(
                (game) =>
                  isImportable(
                    game,
                    byKey.get(libraryEntryKey(providerId, game.externalId)),
                  ) &&
                  !requiresExecutableChoice(
                    game,
                    byKey.get(libraryEntryKey(providerId, game.externalId)),
                    ignoredProcesses,
                  ) &&
                  !existingImports.has(
                    libraryEntryKey(providerId, game.externalId),
                  ),
              )
              .map((game) => game.externalId),
          ),
        );
      }
      setPhase("ready");
    } catch (cause) {
      setError(formatError(cause));
      setPhase("ready");
    }
  }

  async function importSelected() {
    if (!scan) return;
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
          existingImports.has(libraryEntryKey(providerId, game.externalId)) ||
          requiresExecutableChoice(game, match, ignoredProcesses)
        ) {
          return [];
        }
        const executable = game.executables.find(
          (item) => item.relativePath === manualExecutables[game.externalId],
        );
        const commit = buildSteamImportCommit({
          scanned: game,
          resolved: match,
          selectedExecutable: executable,
          ignoredProcesses,
        });
        return commit ? [commit] : [];
      });
      if (commits.length === 0)
        throw new Error("Select at least one importable game.");
      await backupImporterDataOnce();
      const result = await runLibraryImport(commits);
      const failedShares = result.shareOutcomes.filter(
        ({ outcome }) => outcome.kind === "failed",
      ).length;
      const importedIds = new Set(
        commits.map((commit) => commit.entry.externalId),
      );
      setSelected(
        (current) => new Set([...current].filter((id) => !importedIds.has(id))),
      );
      setActiveImportGroup("imported");
      setPhase("done");
      addToast({
        tone: "success",
        title: `${commits.length} Steam ${commits.length === 1 ? "game" : "games"} imported`,
        detail:
          failedShares > 0
            ? `Your library is available in My Games. ${failedShares} executable ${failedShares === 1 ? "suggestion needs" : "suggestions need"} an online retry.`
            : "Your library and playtime are now available in My Games.",
      });
    } catch (cause) {
      setError(formatError(cause));
      setPhase("ready");
    }
  }

  async function addAndShareGame(game: ScannedLibraryGame) {
    const match = resolved.get(libraryEntryKey(providerId, game.externalId));
    const selectedExecutable =
      game.executables.find(
        (item) => item.relativePath === manualExecutables[game.externalId],
      ) ??
      (browsedExecutables[game.externalId]?.relativePath ===
      manualExecutables[game.externalId]
        ? browsedExecutables[game.externalId]
        : undefined);
    if (!match || !selectedExecutable) return;

    const commit = buildSteamImportCommit({
      scanned: game,
      resolved: match,
      selectedExecutable,
      ignoredProcesses,
    });
    if (!commit) return;

    setAddingExternalId(game.externalId);
    setError(null);
    try {
      await backupImporterDataOnce();
      const result = await runLibraryImport([commit]);
      const shareFailed = result.shareOutcomes.some(
        ({ outcome }) => outcome.kind === "failed",
      );
      setSelected((current) => {
        const next = new Set(current);
        next.delete(game.externalId);
        return next;
      });
      addToast({
        tone: "success",
        title: `${match.game?.name ?? game.name ?? "Game"} added to My Games`,
        detail: shareFailed
          ? "The game was added locally, but sharing the executable needs an online retry."
          : "The executable was submitted as a community suggestion.",
      });
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setAddingExternalId(null);
    }
  }

  async function browseExecutable(game: ScannedLibraryGame) {
    if (!game.installPath) {
      setError("Steam did not provide an installation path for this game.");
      return;
    }
    setBrowsingExternalId(game.externalId);
    setError(null);
    try {
      const selectedPath = await open({
        multiple: false,
        directory: false,
        defaultPath: game.installPath,
        filters: [{ name: "Game executable", extensions: ["exe"] }],
      });
      if (typeof selectedPath !== "string") return;
      const executable = await invoke<ScannedExecutable>(
        "library_inspect_executable",
        {
          provider: providerId,
          installPath: game.installPath,
          executablePath: selectedPath,
        },
      );
      if (matchesProcessPatternSet(executable.fileName, ignoredProcesses)) {
        throw new Error(
          `${executable.fileName} is ignored by PlayCounter and cannot be used as the game executable.`,
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
      setError(formatError(cause));
    } finally {
      setBrowsingExternalId(null);
    }
  }

  async function backupImporterDataOnce() {
    if (importerSessionBackedUp) return;
    await invoke("backup_local_data", {
      contents: localStorage.getItem(STORAGE_KEY) ?? "{}",
    });
    importerSessionBackedUp = true;
  }

  const selectedCount =
    scan?.games.filter((game) => {
      const key = libraryEntryKey(providerId, game.externalId);
      const match = resolved.get(key);
      return (
        selected.has(game.externalId) &&
        !existingImports.has(key) &&
        isImportable(game, match) &&
        !requiresExecutableChoice(game, match, ignoredProcesses)
      );
    }).length ?? 0;
  const importableCount = useMemo(
    () =>
      scan?.games.filter((game) =>
        isImportable(
          game,
          resolved.get(libraryEntryKey(providerId, game.externalId)),
        ),
      ).length ?? 0,
    [resolved, scan],
  );
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
        description: "No additional choices required.",
        games: [] as ScannedLibraryGame[],
      },
      {
        key: "attention",
        label: "Needs attention",
        description:
          "Choose the executable, then add the game and share the mapping as a community suggestion.",
        games: [] as ScannedLibraryGame[],
      },
      {
        key: "unavailable",
        label: "Unavailable right now",
        description: "Missing metadata or importable Steam activity.",
        games: [] as ScannedLibraryGame[],
      },
      {
        key: "imported",
        label: "Imported",
        description: "Games already available in My Games.",
        games: [] as ScannedLibraryGame[],
      },
    ];

    for (const game of scan?.games ?? []) {
      const key = libraryEntryKey(providerId, game.externalId);
      const match = resolved.get(key);
      if (existingImports.has(key)) {
        groups[3].games.push(game);
      } else if (!isImportable(game, match)) {
        groups[2].games.push(game);
      } else if (requiresExecutableChoice(game, match, ignoredProcesses)) {
        groups[1].games.push(game);
      } else {
        groups[0].games.push(game);
      }
    }

    return groups;
  }, [existingImports, ignoredProcesses, providerId, resolved, scan]);
  const activeImportGroupDetails =
    importGroups.find((group) => group.key === activeImportGroup) ??
    importGroups[0];

  if (phase === "detecting") {
    return <LoadingPanel label="Looking for a local Steam installation…" />;
  }
  if (!status?.available) {
    return (
      <Panel className="grid min-h-[360px] place-items-center p-8 text-center">
        <div className="max-w-lg">
          <LibraryBig size={36} className="mx-auto text-text-faint" />
          <h2 className="mt-4 text-2xl font-semibold text-text">
            Steam was not found
          </h2>
          <p className="mt-2 text-text-muted">
            PlayCounter checks the Windows Steam registry entry and the usual
            installation folders. No Steam login or Web API is used.
          </p>
          {error ? <ErrorNotice message={error} /> : null}
        </div>
      </Panel>
    );
  }
  if (phase === "scanning") {
    return <LoadingPanel label="Scanning your Steam library…" />;
  }

  return (
    <div className="grid gap-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ProviderBadge provider="steam" />
              <span className="text-sm text-text-muted">
                Local library import
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold text-text">
              Select a local Steam account
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Game ownership is not uploaded. Only AppIDs from this local scan
              are resolved against PlayCounter metadata.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Steam account"
              value={accountId ?? ""}
              onChange={(event) => {
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
                  {account.personaName ?? `Account ${account.accountId}`} ·{" "}
                  {account.gamesWithPlaytime} games
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              icon={scan ? RefreshCw : Download}
              disabled={accountId === null}
              onClick={() => void scanAccount()}
            >
              {scan ? "Scan again" : "Find games"}
            </Button>
          </div>
        </div>
      </Panel>

      {error ? <ErrorNotice message={error} /> : null}
      {accounts.length === 0 ? (
        <Panel className="p-4 text-sm text-text-muted">
          Steam is installed, but no readable local account data was found.
          Start Steam and sign in locally once, then return here.
        </Panel>
      ) : null}
      {capability === "unsupported" ? (
        <Panel className="border-warning-border bg-warning-tint p-4 text-sm text-warning">
          This PlayCounter backend does not expose the Steam AppID resolver yet.
          The local scan succeeded, but importing is disabled to avoid creating
          games with uncertain metadata.
        </Panel>
      ) : null}
      {scan?.warnings.length ? (
        <Panel className="p-4">
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">
                The scan was partially successful
              </div>
              <div className="mt-1 text-text-muted">
                {scan.warnings.join(" ")}
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      {scan ? (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-semibold text-text">Steam games</h2>
              <p className="text-sm text-text-muted">
                {importableCount} of {scan.games.length} games currently
                importable
              </p>
            </div>
            {activeImportGroup === "ready" ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setSelected(
                      new Set(
                        importGroups[0].games.map((game) => game.externalId),
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
                      resolved={resolved.get(
                        libraryEntryKey(providerId, game.externalId),
                      )}
                      selected={selected.has(game.externalId)}
                      alreadyImported={existingImports.has(
                        libraryEntryKey(providerId, game.externalId),
                      )}
                      showSelection={activeImportGroupDetails.key === "ready"}
                      showAddAndShare={
                        activeImportGroupDetails.key === "attention"
                      }
                      addingAndSharing={addingExternalId === game.externalId}
                      browsing={browsingExternalId === game.externalId}
                      manualExecutable={manualExecutables[game.externalId]}
                      browsedExecutable={browsedExecutables[game.externalId]}
                      ignoredProcesses={ignoredProcesses}
                      onAddAndShare={() => void addAndShareGame(game)}
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
                    No games in this category.
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
            <span className="font-semibold">
              Import completed successfully.
            </span>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setLibraryTab("steam");
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

function ImportRow({
  game,
  resolved,
  selected,
  alreadyImported,
  showSelection,
  showAddAndShare,
  addingAndSharing,
  browsing,
  manualExecutable,
  browsedExecutable,
  ignoredProcesses,
  onAddAndShare,
  onBrowseExecutable,
  onManualExecutable,
  onSelected,
}: {
  game: ScannedLibraryGame;
  resolved?: ResolvedLibraryGame;
  selected: boolean;
  alreadyImported: boolean;
  showSelection: boolean;
  showAddAndShare: boolean;
  addingAndSharing: boolean;
  browsing: boolean;
  manualExecutable?: string;
  browsedExecutable?: ScannedExecutable;
  ignoredProcesses: ReadonlySet<string>;
  onAddAndShare: () => void;
  onBrowseExecutable: () => void;
  onManualExecutable: (value: string) => void;
  onSelected: (checked: boolean) => void;
}) {
  const importable = isImportable(game, resolved);
  const noImportablePlaytime =
    game.playtimeSeconds <= 0 && game.lastPlayedUnix === undefined;
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
  return (
    <article className="flex items-start gap-4 px-5 py-4">
      {showSelection ? (
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-[rgb(var(--color-accent))]"
          checked={selected}
          disabled={!importable}
          onChange={(event) => onSelected(event.target.checked)}
          aria-label={`Import ${resolved?.game?.name ?? game.name ?? game.externalId}`}
        />
      ) : (
        <span className="w-4 shrink-0" aria-hidden="true" />
      )}
      {resolved?.game?.coverUrl ? (
        <img
          src={resolved.game.coverUrl}
          alt=""
          className="h-16 w-12 rounded object-cover"
        />
      ) : (
        <div className="grid h-16 w-12 place-items-center rounded bg-surface-hover text-text-faint">
          <HardDrive size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-text">
            {resolved?.game?.name ??
              game.name ??
              `Steam App ${game.externalId}`}
          </h3>
          {alreadyImported ? (
            <span className="text-xs font-medium text-success">
              Already in My Games · updates playtime
            </span>
          ) : null}
          {!importable ? (
            <span className="text-xs font-medium text-warning">
              {noImportablePlaytime
                ? "No playtime to import"
                : "Metadata unavailable"}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>AppID {game.externalId}</span>
          <span>{formatDuration(game.playtimeSeconds, false)}</span>
          <span>{game.installed ? "Installed" : "Not installed"}</span>
          {resolved?.executables.length ? (
            <span>
              {resolved.executables.length} known executable
              {resolved.executables.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span>No known executable</span>
          )}
        </div>
        {showAddAndShare && showExeChoice ? (
          <div className="mt-3 max-w-2xl text-xs text-text-muted">
            <p>
              Choose the executable PlayCounter should track. Add and Share
              imports the game locally and submits this mapping for community
              review; it is not globally approved automatically.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                aria-label={`Executable for ${resolved?.game?.name ?? game.name ?? game.externalId}`}
                value={manualExecutable ?? ""}
                onChange={(event) => onManualExecutable(event.target.value)}
                className="min-w-64 flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
              >
                <option value="">Select an executable…</option>
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
              <Button
                variant="primary"
                icon={Share2}
                loading={addingAndSharing}
                disabled={!manualExecutable}
                onClick={onAddAndShare}
              >
                Add and Share
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
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
      .filter((item) => !matchesProcessPatternSet(item.value, ignoredProcesses))
      .map((item) => item.value.toLowerCase()),
  );
  const hasKnownLocalExe = game.executables.some((item) =>
    knownNames.has(item.fileName.toLowerCase()),
  );
  return !hasKnownLocalExe && game.installPath !== undefined;
}

function isImportable(
  game: ScannedLibraryGame,
  resolved?: ResolvedLibraryGame,
) {
  return (
    resolved?.status === "resolved" &&
    resolved.game?.igdbId !== undefined &&
    (game.playtimeSeconds > 0 || game.lastPlayedUnix !== undefined)
  );
}

function initialImportGroup(
  games: readonly ScannedLibraryGame[],
  resolved: ReadonlyMap<string, ResolvedLibraryGame>,
  existingImports: ReadonlyMap<string, unknown>,
  ignoredProcesses: ReadonlySet<string>,
): ImportGroupKey {
  let hasAttention = false;
  let hasUnavailable = false;
  let hasImported = false;

  for (const game of games) {
    const key = libraryEntryKey("steam", game.externalId);
    if (existingImports.has(key)) {
      hasImported = true;
      continue;
    }
    const match = resolved.get(key);
    if (!isImportable(game, match)) {
      hasUnavailable = true;
      continue;
    }
    if (requiresExecutableChoice(game, match, ignoredProcesses)) {
      hasAttention = true;
      continue;
    }
    return "ready";
  }

  if (hasAttention) return "attention";
  if (hasUnavailable) return "unavailable";
  if (hasImported) return "imported";
  return "ready";
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <Panel className="grid min-h-[320px] place-items-center p-8 text-center text-text-muted">
      <div role="status" aria-live="polite">
        <RefreshCw size={28} className="mx-auto animate-spin text-accent" />
        <p className="mt-3">{label}</p>
      </div>
    </Panel>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-lg border border-danger-border bg-danger-tint px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
