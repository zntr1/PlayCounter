import clsx from "clsx";
import {
  Check,
  CheckCircle,
  EyeOff,
  Gamepad2,
  RotateCcw,
  Search,
  Send,
  SkipForward,
  Trash2,
  Undo2,
  X,
  Copy,
} from "lucide-react";
import type {
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  CommunityMetadataSearchResponse,
} from "@playcounter/shared";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  addCustomGame,
  addSharedCustomGame,
  PENDING_COMMUNITY_RETRY_MS,
  recheckExecutable,
  scanProcessesNow,
  setUserIgnoredProcess,
  untrackCustomGame,
} from "../../tracker";
import {
  useAppStore,
  useIsOffline,
  type ExeCacheEntry,
  type ProcessSnapshot,
} from "../../store";
import { Panel } from "../components";
import { AnimatedCount, Button, IconButton, Input } from "../primitives";

import {
  useContextMenu,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../primitives";

type DiscoveryStatus =
  | "matched"
  | "custom"
  | "unmatched"
  | "ignored"
  | "userIgnored"
  | "checking";

type DiscoveredExecutable = ProcessSnapshot & {
  key: string;
  isRunning: boolean;
  status: DiscoveryStatus;
  cacheEntry: ExeCacheEntry | null;
};

type DiscoverySection = {
  id: "running" | "saved";
  title: string;
  description: string;
  executables: DiscoveredExecutable[];
};

type DiscoveryGroup = {
  id: string;
  title: string;
  description: string;
  statuses: DiscoveryStatus[];
  defaultOpen: boolean;
  tone: "review" | "local" | "userIgnored" | "systemIgnored";
};

const statusLabels: Record<DiscoveryStatus, string> = {
  matched: "Tracked game",
  custom: "Added manually",
  unmatched: "Not recognized",
  ignored: "Ignored by PlayCounter",
  userIgnored: "Ignored by you",
  checking: "Checking…",
};

const statusClasses: Record<DiscoveryStatus, string> = {
  matched: "bg-success-tint text-success",
  custom: "bg-info-tint text-info",
  unmatched: "bg-surface-hover text-text-muted",
  ignored: "bg-surface-hover text-text-faint",
  userIgnored: "bg-warning-tint text-warning",
  checking: "bg-community-tint text-community",
};

type FilterId = "review" | "tracked" | "ignored";

const discoveryFilters: Array<{
  id: FilterId;
  label: string;
  statuses: DiscoveryStatus[];
}> = [
  { id: "review", label: "Needs review", statuses: ["unmatched", "checking"] },
  { id: "tracked", label: "Tracked", statuses: ["matched", "custom"] },
  { id: "ignored", label: "Ignored", statuses: ["userIgnored", "ignored"] },
];

const statusToTone: Record<DiscoveryStatus, DiscoveryGroup["tone"]> = {
  matched: "local",
  unmatched: "review",
  checking: "review",
  custom: "local",
  userIgnored: "userIgnored",
  ignored: "systemIgnored",
};

export function useNeedsReviewCount() {
  const processes = useAppStore((state) => state.processes);
  const exeCache = useAppStore((state) => state.exeCache);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const userIgnoredProcesses = useAppStore(
    (state) => state.userIgnoredProcesses,
  );
  const blacklist = useAppStore((state) => state.blacklist);

  return useMemo(() => {
    const byKey = new Map<string, ExeCacheEntry | null>();
    for (const process of processes) {
      const key = process.exeName.toLowerCase();
      byKey.set(key, exeCache.get(key) ?? null);
    }
    for (const entry of exeCache.values()) {
      const key = entry.exeName.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, entry);
    }

    let count = 0;
    for (const [key, entry] of byKey) {
      const status = getDiscoveryStatus(
        entry?.exeName ?? key,
        entry ?? undefined,
        ignoredProcesses,
        userIgnoredProcesses,
        blacklist,
      );
      if (status === "unmatched" || status === "checking") count += 1;
    }
    return count;
  }, [processes, exeCache, ignoredProcesses, userIgnoredProcesses, blacklist]);
}

function getDiscoveryStatus(
  exeName: string,
  cacheEntry: ExeCacheEntry | undefined,
  ignoredProcesses: Set<string>,
  userIgnoredProcesses: Set<string>,
  blacklist: Set<string>,
): DiscoveryStatus {
  const key = exeName.toLowerCase();

  if (
    userIgnoredProcesses.has(key) ||
    blacklist.has(key) ||
    cacheEntry?.state === "blacklisted"
  ) {
    return "userIgnored";
  }
  if (ignoredProcesses.has(key)) return "ignored";
  if (cacheEntry?.state === "matched" && cacheEntry.source === "custom")
    return "custom";
  if (cacheEntry?.state === "matched") return "matched";
  if (cacheEntry?.state === "unmatched") return "unmatched";

  return "checking";
}

function sortDiscovered(
  left: DiscoveredExecutable,
  right: DiscoveredExecutable,
) {
  const order: Record<DiscoveryStatus, number> = {
    matched: 0,
    custom: 1,
    checking: 2,
    unmatched: 3,
    userIgnored: 4,
    ignored: 5,
  };

  return (
    order[left.status] - order[right.status] ||
    left.exeName.localeCompare(right.exeName)
  );
}

function unmatchedRetryAt(cacheEntry: ExeCacheEntry | null, retryDays: number) {
  if (cacheEntry?.state !== "unmatched") return null;
  const checkedAt = Date.parse(cacheEntry.lastCheckedAt);
  if (!Number.isFinite(checkedAt)) return null;
  return new Date(checkedAt + retryDays * 24 * 60 * 60 * 1000).toLocaleString(
    [],
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

function pendingCommunityRetryAt(cacheEntry: ExeCacheEntry | null) {
  if (cacheEntry?.state !== "unmatched" || !cacheEntry.pendingCommunityGame) {
    return null;
  }
  const checkedAt = Date.parse(cacheEntry.lastCheckedAt);
  if (!Number.isFinite(checkedAt)) return null;
  return new Date(checkedAt + PENDING_COMMUNITY_RETRY_MS).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function DiscoveredView() {
  const [pendingExe, setPendingExe] = useState<string | null>(null);
  const [customGameExe, setCustomGameExe] = useState<string | null>(null);
  const [customGameName, setCustomGameName] = useState("");
  const [suggestionExe, setSuggestionExe] = useState<string | null>(null);
  const [suggestionSelection, setSuggestionSelection] =
    useState<CommunityMetadataCandidate | null>(null);
  const [suggestionSearch, setSuggestionSearch] = useState("");
  const [suggestionCandidates, setSuggestionCandidates] = useState<
    CommunityMetadataCandidate[]
  >([]);
  const [suggestionState, setSuggestionState] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("idle");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [filter, setFilter] = useState<FilterId>("review");
  const [runningOnly, setRunningOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [retryingExe, setRetryingExe] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [activeReviewKey, setActiveReviewKey] = useState<string | null>(null);
  const isOffline = useIsOffline();
  const processes = useAppStore((state) => state.processes);
  const exeCache = useAppStore((state) => state.exeCache);
  const installUuid = useAppStore((state) => state.installUuid);
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const unmatchedRetryDays = useAppStore(
    (state) => state.settings.unmatchedRetryDays,
  );
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const userIgnoredProcesses = useAppStore(
    (state) => state.userIgnoredProcesses,
  );
  const blacklist = useAppStore((state) => state.blacklist);
  const toggleBlacklist = useAppStore((state) => state.toggleBlacklist);
  const lastProcessScanAt = useAppStore((state) => state.lastProcessScanAt);
  const addToast = useAppStore((state) => state.addToast);

  useEffect(() => {
    function handleReset() {
      setFilter("review");
      setSearch("");
      setRunningOnly(false);
      setActiveReviewKey(null);
    }

    window.addEventListener("playcounter:discovered-reset", handleReset);
    return () =>
      window.removeEventListener("playcounter:discovered-reset", handleReset);
  }, []);

  // Clear the retry spinner once the recheck has resolved (a real cache entry
  // reappears for that exe) or after a safety timeout if it never resolves.
  useEffect(() => {
    if (!retryingExe) return;
    const entry = exeCache.get(retryingExe);
    if (entry && entry.state !== "blacklisted" && entry.state !== "unmatched") {
      setRetryingExe(null);
      return;
    }
    const timer = setTimeout(() => setRetryingExe(null), 6000);
    return () => clearTimeout(timer);
  }, [exeCache, retryingExe]);

  async function updateUserIgnored(exeName: string, ignored: boolean) {
    const key = exeName.toLowerCase();
    setPendingExe(key);
    try {
      await setUserIgnoredProcess(exeName, ignored);
      if (!ignored && blacklist.has(key)) toggleBlacklist(exeName, false);
      addToast({
        tone: "success",
        title: ignored ? "Process ignored" : "Process restored",
        detail: ignored
          ? `${exeName} will no longer be matched or tracked.`
          : `${exeName} can be matched again on the next scan.`,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: ignored ? "Ignore failed" : "Restore failed",
        detail: formatError(error),
      });
    } finally {
      setPendingExe(null);
    }
  }

  function startCustomGameEntry(exeName: string) {
    setCustomGameExe(exeName.toLowerCase());
    setCustomGameName("");
  }

  function saveCustomGame(exeName: string) {
    const name = customGameName.trim();
    if (!name) return;
    addCustomGame(exeName, name);
    setCustomGameExe(null);
    setCustomGameName("");
    addToast({
      tone: "success",
      title: "Added to My Games",
      detail: `${name} is now tracked locally.`,
    });
  }

  function startCommunitySuggestion(exeName: string) {
    if (isOffline) {
      addToast({
        tone: "info",
        title: "Offline",
        detail: "Community sharing unavailable offline.",
      });
      return;
    }
    const key = exeName.toLowerCase();
    setSuggestionExe(key);
    setSuggestionSelection(null);
    setSuggestionSearch("");
    setSuggestionCandidates([]);
    setSuggestionMessage("");
    setSuggestionState("idle");
  }

  async function searchSuggestionMetadata() {
    const query = suggestionSearch.trim();
    if (query.length < 2 || isOffline) return;

    setSuggestionCandidates([]);
    setSuggestionMessage("");
    setSuggestionState("loading");

    try {
      const response = await fetch(
        `${apiEndpoint}/api/community/metadata?query=${encodeURIComponent(query)}`,
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const body = (await response.json()) as CommunityMetadataSearchResponse;
      setSuggestionCandidates(body.candidates);
      setSuggestionMessage(
        body.candidates.length > 0
          ? "Pick the exact game to unlock sharing."
          : "No matching game found.",
      );
      setSuggestionState("idle");
    } catch (error) {
      setSuggestionState("error");
      setSuggestionMessage(formatError(error));
    }
  }

  function applyMetadataCandidate(candidate: CommunityMetadataCandidate) {
    if (!candidate.coverUrl) {
      setSuggestionSelection(null);
      setSuggestionMessage(
        `${candidate.name} has no cover art. Pick a result with cover art.`,
      );
      return;
    }

    setSuggestionSelection(candidate);
    setSuggestionMessage(`Selected ${candidate.name} from the database.`);
  }

  async function submitCommunitySuggestion(exeName: string) {
    if (!suggestionSelection?.coverUrl) return;

    setSuggestionState("saving");
    setSuggestionMessage("");
    try {
      const response = await fetch(`${apiEndpoint}/api/community/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exeName,
          name: suggestionSelection.name,
          coverUrl: suggestionSelection.coverUrl,
          installUuid: installUuid ?? undefined,
        }),
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const result = (await response.json()) as CommunityGameSuggestionResponse;
      addSharedCustomGame(
        exeName,
        suggestionSelection.name,
        suggestionSelection.coverUrl,
        result.id,
        result.verified,
      );
      setSuggestionState("saved");
      setSuggestionMessage(
        `Added to your library and shared as community game #${result.id}.`,
      );
      setSuggestionExe(null);
      setSuggestionSelection(null);
      setSuggestionCandidates([]);
      addToast({
        tone: "success",
        title: "Game added and shared",
        detail: `Your community suggestion was submitted for ${exeName}.`,
      });
    } catch (error) {
      setSuggestionState("error");
      setSuggestionMessage(formatError(error));
    }
  }

  function removeCustomGame(exeName: string) {
    untrackCustomGame(exeName);
    addToast({
      tone: "success",
      title: "Manual game removed",
      detail: `${exeName} is no longer tracked as a custom game.`,
    });
  }

  const discoverySections = useMemo((): DiscoverySection[] => {
    const runningKeys = new Set(
      processes.map((process) => process.exeName.toLowerCase()),
    );
    const running = processes.map((process): DiscoveredExecutable => {
      const key = process.exeName.toLowerCase();
      const cacheEntry = exeCache.get(key) ?? null;

      return {
        ...process,
        key,
        isRunning: true,
        cacheEntry,
        status: getDiscoveryStatus(
          process.exeName,
          cacheEntry ?? undefined,
          ignoredProcesses,
          userIgnoredProcesses,
          blacklist,
        ),
      };
    });
    const savedByKey = new Map<string, ExeCacheEntry | null>();
    for (const entry of exeCache.values()) {
      const key = entry.exeName.toLowerCase();
      if (!runningKeys.has(key)) savedByKey.set(key, entry);
    }
    for (const exeName of [...userIgnoredProcesses, ...blacklist]) {
      const key = exeName.toLowerCase();
      if (!runningKeys.has(key) && !savedByKey.has(key)) {
        savedByKey.set(key, null);
      }
    }

    const saved = [...savedByKey].map(([key, entry]): DiscoveredExecutable => {
      const exeName = entry?.exeName ?? key;

      return {
        exeName,
        exePath: null,
        key,
        isRunning: false,
        cacheEntry: entry,
        status: getDiscoveryStatus(
          exeName,
          entry ?? undefined,
          ignoredProcesses,
          userIgnoredProcesses,
          blacklist,
        ),
      };
    });

    return [
      {
        id: "running",
        title: "Running now",
        description: "Apps from the latest process scan.",
        executables: running.sort(sortDiscovered),
      },
      {
        id: "saved",
        title: "Not running",
        description: "Previously discovered apps kept for cleanup and review.",
        executables: saved.sort(sortDiscovered),
      },
    ];
  }, [blacklist, exeCache, ignoredProcesses, processes, userIgnoredProcesses]);

  const allExecutables = useMemo(
    () =>
      discoverySections
        .flatMap((section) => section.executables)
        .sort(sortDiscovered),
    [discoverySections],
  );
  const activeFilter =
    discoveryFilters.find((entry) => entry.id === filter) ??
    discoveryFilters[0];
  const needle = search.trim().toLowerCase();
  const matchesSearch = (executable: DiscoveredExecutable) => {
    if (!needle) return true;
    const matchedName =
      executable.cacheEntry?.state === "matched"
        ? (executable.cacheEntry.gameName ?? "")
        : "";
    return (
      executable.exeName.toLowerCase().includes(needle) ||
      matchedName.toLowerCase().includes(needle)
    );
  };
  const searchable = allExecutables.filter(matchesSearch);
  const filteredExecutables = searchable
    .filter((executable) => activeFilter.statuses.includes(executable.status))
    .filter((executable) => (runningOnly ? executable.isRunning : true));
  const runningCount = searchable.filter(
    (executable) => executable.isRunning,
  ).length;

  const isWizardMode = filter === "review" && !search;
  let activeReviewItem = null;
  let wizardCurrentIndex = 0;

  if (isWizardMode && filteredExecutables.length > 0) {
    const index = filteredExecutables.findIndex(
      (e) => e.key === activeReviewKey,
    );
    wizardCurrentIndex = index >= 0 ? index : 0;
    activeReviewItem = filteredExecutables[wizardCurrentIndex];
  }

  function handleSkip() {
    if (filteredExecutables.length > 1) {
      const nextIndex = (wizardCurrentIndex + 1) % filteredExecutables.length;
      setActiveReviewKey(filteredExecutables[nextIndex].key);
    }
  }

  return (
    <div className="grid gap-5">
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <h2 className="font-semibold text-text">Discovered apps</h2>
            <p className="text-sm text-text-muted">
              {lastProcessScanAt
                ? `Last scan ${new Date(lastProcessScanAt).toLocaleTimeString()}`
                : "No scan yet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search apps..."
                className="w-56 pl-9"
              />
            </div>
            <Button
              icon={RotateCcw}
              loading={scanning}
              onClick={async () => {
                setScanning(true);
                try {
                  await scanProcessesNow();
                } finally {
                  setScanning(false);
                }
              }}
            >
              {scanning ? "Scanning…" : "Scan"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {discoveryFilters.map((entry) => {
            const count = searchable
              .filter((executable) =>
                runningOnly ? executable.isRunning : true,
              )
              .filter((executable) =>
                entry.statuses.includes(executable.status),
              ).length;
            const active = filter === entry.id;
            const needsAttention = entry.id === "review" && count > 0;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition",
                  active
                    ? "bg-accent text-accent-fg"
                    : needsAttention
                      ? "border border-warning-border bg-warning-tint font-medium text-warning hover:brightness-125"
                      : "border border-border text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                {needsAttention && !active ? (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                ) : null}
                {entry.label}
                <AnimatedCount
                  value={count}
                  className={clsx(
                    "rounded-full px-1.5 text-xs",
                    active
                      ? "bg-black/20"
                      : needsAttention
                        ? "bg-warning/20 text-warning"
                        : "bg-surface-hover text-text-faint",
                  )}
                />
              </button>
            );
          })}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={runningOnly}
              onChange={(event) => setRunningOnly(event.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Running only{runningCount ? ` (${runningCount})` : ""}
          </label>
        </div>

        {isOffline ? (
          <div className="border-b border-border bg-surface px-4 py-2 text-sm text-text-muted">
            Community features are paused while offline. Local tracking,
            scanning, and triage still work.
          </div>
        ) : null}

        <div className="grid gap-2 bg-bg p-3">
          {isWizardMode ? (
            activeReviewItem ? (
              <div className="py-6 px-4 sm:px-10 flex justify-center">
                <div className="w-full max-w-2xl">
                  <TriageWizardCard
                    executable={activeReviewItem}
                    queueLength={filteredExecutables.length}
                    currentIndex={wizardCurrentIndex + 1}
                    customGameName={customGameName}
                    isCustomGameEntryOpen={
                      customGameExe === activeReviewItem.key
                    }
                    isPending={pendingExe === activeReviewItem.key}
                    isRetrying={retryingExe === activeReviewItem.key}
                    onCancelCustomGame={() => {
                      setCustomGameExe(null);
                      setCustomGameName("");
                    }}
                    onCustomGameNameChange={setCustomGameName}
                    onIgnore={() =>
                      void updateUserIgnored(activeReviewItem.exeName, true)
                    }
                    isOffline={isOffline}
                    onRecheck={() => {
                      if (isOffline) return;
                      setRetryingExe(activeReviewItem.key);
                      void recheckExecutable(activeReviewItem.exeName);
                    }}
                    onSaveCustomGame={() =>
                      saveCustomGame(activeReviewItem.exeName)
                    }
                    onStartCustomGame={() =>
                      startCustomGameEntry(activeReviewItem.exeName)
                    }
                    onSuggest={() =>
                      startCommunitySuggestion(activeReviewItem.exeName)
                    }
                    onSkip={handleSkip}
                  />
                  {suggestionExe === activeReviewItem.key ? (
                    <CommunitySuggestionForm
                      candidates={suggestionCandidates}
                      exeName={activeReviewItem.exeName}
                      message={suggestionMessage}
                      search={suggestionSearch}
                      selection={suggestionSelection}
                      state={suggestionState}
                      isOffline={isOffline}
                      onApplyCandidate={applyMetadataCandidate}
                      onCancel={() => {
                        setSuggestionExe(null);
                        setSuggestionSelection(null);
                        setSuggestionState("idle");
                        setSuggestionMessage("");
                      }}
                      onSearch={searchSuggestionMetadata}
                      onSearchChange={(value) => {
                        setSuggestionSearch(value);
                        setSuggestionSelection(null);
                      }}
                      onSubmit={() =>
                        void submitCommunitySuggestion(activeReviewItem.exeName)
                      }
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-4 py-16 text-center">
                <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success">
                  <CheckCircle size={32} />
                </div>
                <h3 className="mb-1 text-lg font-semibold text-text">
                  You're all caught up!
                </h3>
                <p className="text-sm text-text-muted">
                  There are no new executables to review right now.
                </p>
              </div>
            )
          ) : filteredExecutables.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
              Nothing here right now.
            </div>
          ) : (
            filteredExecutables.map((executable) => (
              <Fragment key={executable.key}>
                <DiscoveredExecutableRow
                  executable={executable}
                  customGameName={customGameName}
                  groupTone={statusToTone[executable.status]}
                  hideStatusLabel={filter === "tracked" || filter === "ignored"}
                  isCustomGameEntryOpen={customGameExe === executable.key}
                  isPending={pendingExe === executable.key}
                  isRetrying={retryingExe === executable.key}
                  onCancelCustomGame={() => {
                    setCustomGameExe(null);
                    setCustomGameName("");
                  }}
                  onCustomGameNameChange={setCustomGameName}
                  onIgnore={() =>
                    void updateUserIgnored(executable.exeName, true)
                  }
                  isOffline={isOffline}
                  onRecheck={() => {
                    if (isOffline) return;
                    setRetryingExe(executable.key);
                    void recheckExecutable(executable.exeName);
                  }}
                  onSaveCustomGame={() => saveCustomGame(executable.exeName)}
                  onStartCustomGame={() =>
                    startCustomGameEntry(executable.exeName)
                  }
                  onSuggest={() => startCommunitySuggestion(executable.exeName)}
                  onUnignore={() =>
                    void updateUserIgnored(executable.exeName, false)
                  }
                  onUntrack={() => removeCustomGame(executable.exeName)}
                  unmatchedRetryDays={unmatchedRetryDays}
                />
                {suggestionExe === executable.key ? (
                  <CommunitySuggestionForm
                    candidates={suggestionCandidates}
                    exeName={executable.exeName}
                    message={suggestionMessage}
                    search={suggestionSearch}
                    selection={suggestionSelection}
                    state={suggestionState}
                    isOffline={isOffline}
                    onApplyCandidate={applyMetadataCandidate}
                    onCancel={() => {
                      setSuggestionExe(null);
                      setSuggestionSelection(null);
                      setSuggestionState("idle");
                      setSuggestionMessage("");
                    }}
                    onSearch={searchSuggestionMetadata}
                    onSearchChange={(value) => {
                      setSuggestionSearch(value);
                      setSuggestionSelection(null);
                    }}
                    onSubmit={() =>
                      void submitCommunitySuggestion(executable.exeName)
                    }
                  />
                ) : null}
              </Fragment>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function TriageWizardCard({
  executable,
  queueLength,
  currentIndex,
  customGameName,
  isCustomGameEntryOpen,
  isOffline,
  isPending,
  isRetrying,
  onCancelCustomGame,
  onCustomGameNameChange,
  onIgnore,
  onRecheck,
  onSaveCustomGame,
  onStartCustomGame,
  onSuggest,
  onSkip,
}: {
  executable: DiscoveredExecutable;
  queueLength: number;
  currentIndex: number;
  customGameName: string;
  isCustomGameEntryOpen: boolean;
  isOffline: boolean;
  isPending: boolean;
  isRetrying: boolean;
  onCancelCustomGame: () => void;
  onCustomGameNameChange: (value: string) => void;
  onIgnore: () => void;
  onRecheck: () => void;
  onSaveCustomGame: () => void;
  onStartCustomGame: () => void;
  onSuggest: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="animate-fade-in overflow-hidden rounded-xl border border-border bg-surface shadow-md">
      <div className="flex items-center justify-between border-b border-border bg-surface-hover/30 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
            {currentIndex}
          </span>
          <span className="text-sm font-medium text-text-muted">
            of {queueLength} remaining
          </span>
        </div>
        {executable.status === "checking" && (
          <span className="inline-flex items-center rounded-full bg-community-tint px-2.5 py-1 text-xs font-medium text-community">
            Checking database...
          </span>
        )}
      </div>

      <div className="p-6 sm:p-8">
        <div className="mb-8 flex min-w-0 flex-col items-center gap-2 text-center">
          <div className="mb-2 grid h-16 w-16 place-items-center rounded-2xl bg-surface-hover text-text-faint">
            <Gamepad2 size={32} />
          </div>
          <div className="flex h-10 w-full max-w-full items-center justify-center">
            <h3
              className="max-w-full truncate text-2xl font-bold text-text sm:text-3xl"
              title={executable.exeName}
            >
              {executable.exeName}
            </h3>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
            <span
              className={clsx(
                "h-2.5 w-2.5 rounded-full",
                executable.isRunning
                  ? "bg-success shadow-[0_0_8px_rgba(var(--color-success),0.5)]"
                  : "bg-danger",
              )}
            />
            {executable.isRunning ? "Running right now" : "Not running"}
          </div>
          {isRetrying && (
            <span className="mt-2 animate-pulse text-sm font-medium text-accent">
              Checking database...
            </span>
          )}
        </div>

        {isCustomGameEntryOpen ? (
          <form
            className="mb-8 flex items-center gap-2 rounded-md border border-border bg-surface-hover p-3"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveCustomGame();
            }}
          >
            <Input
              value={customGameName}
              onChange={(event) => onCustomGameNameChange(event.target.value)}
              maxLength={120}
              autoFocus
              placeholder="Enter custom game name..."
              className="h-10 flex-1 text-base"
            />
            <Button
              type="submit"
              variant="primary"
              icon={Check}
              disabled={!customGameName.trim()}
              className="h-10 px-6"
            >
              Save
            </Button>
            <Button
              variant="ghost"
              icon={X}
              onClick={onCancelCustomGame}
              className="h-10 px-3"
            />
          </form>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Button
            variant="primary"
            icon={Send}
            disabled={
              isOffline || isPending || isRetrying || isCustomGameEntryOpen
            }
            title={
              isOffline ? "Community sharing unavailable offline" : undefined
            }
            onClick={onSuggest}
            className="h-12 w-full text-sm font-semibold shadow-sm"
          >
            Add & Share
          </Button>
          <Button
            variant="secondary"
            icon={Gamepad2}
            disabled={isPending || isRetrying || isCustomGameEntryOpen}
            onClick={onStartCustomGame}
            className="h-12 w-full text-sm"
          >
            Add Locally
          </Button>
          <Button
            variant="secondary"
            icon={EyeOff}
            disabled={isPending || isRetrying || isCustomGameEntryOpen}
            onClick={onIgnore}
            className="h-12 w-full text-sm"
          >
            Ignore
          </Button>
          <Button
            variant="ghost"
            icon={SkipForward}
            disabled={isPending || isRetrying || isCustomGameEntryOpen}
            onClick={onSkip}
            className="h-12 w-full text-sm hover:bg-surface-hover"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}

function DiscoveredExecutableRow({
  executable,
  customGameName,
  groupTone,
  hideStatusLabel,
  isCustomGameEntryOpen,
  isOffline,
  isPending,
  isRetrying,
  onCancelCustomGame,
  onCustomGameNameChange,
  onIgnore,
  onRecheck,
  onSaveCustomGame,
  onStartCustomGame,
  onSuggest,
  onUnignore,
  onUntrack,
  unmatchedRetryDays,
}: {
  executable: DiscoveredExecutable;
  customGameName: string;
  groupTone: DiscoveryGroup["tone"];
  hideStatusLabel: boolean;
  isCustomGameEntryOpen: boolean;
  isOffline: boolean;
  isPending: boolean;
  isRetrying: boolean;
  onCancelCustomGame: () => void;
  onCustomGameNameChange: (value: string) => void;
  onIgnore: () => void;
  onRecheck: () => void;
  onSaveCustomGame: () => void;
  onStartCustomGame: () => void;
  onSuggest: () => void;
  onUnignore: () => void;
  onUntrack: () => void;
  unmatchedRetryDays: number;
}) {
  const matchedName =
    executable.cacheEntry?.state === "matched"
      ? executable.cacheEntry.gameName
      : null;
  const isReview = groupTone === "review";
  const isSystemIgnored = groupTone === "systemIgnored";
  const retryAt = unmatchedRetryAt(executable.cacheEntry, unmatchedRetryDays);
  const pendingRetryAt = pendingCommunityRetryAt(executable.cacheEntry);
  const contextMenu = useContextMenu();
  const addToast = useAppStore((state) => state.addToast);

  const handleCopyExe = () => {
    navigator.clipboard.writeText(executable.exeName);
    addToast({
      tone: "success",
      title: "Copied",
      detail: "Executable name copied to clipboard.",
    });
    contextMenu.close();
  };

  const handleCopyMatchedName = () => {
    if (matchedName) {
      navigator.clipboard.writeText(matchedName);
      addToast({
        tone: "success",
        title: "Copied",
        detail: "Game name copied to clipboard.",
      });
      contextMenu.close();
    }
  };

  return (
    <article
      {...contextMenu.props}
      className="animate-fade-in rounded-md border border-border bg-surface p-3 transition-colors hover:border-text-muted/30 sm:p-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 lg:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isSystemIgnored ? null : (
              <span
                title={executable.isRunning ? "Running" : "Not running"}
                className={clsx(
                  "h-2 w-2 shrink-0 rounded-full",
                  executable.isRunning ? "bg-success" : "bg-danger",
                )}
                aria-label={executable.isRunning ? "Running" : "Not running"}
              />
            )}
            <h4
              title={executable.exeName}
              className={clsx(
                "min-w-0 max-w-full flex-1 truncate font-medium",
                isSystemIgnored ? "text-text-faint" : "text-text",
              )}
            >
              {executable.exeName}
            </h4>
            {executable.cacheEntry?.pendingCommunityGame ? (
              <span className="inline-flex max-w-full rounded bg-community-tint px-2 py-0.5 text-xs font-medium text-community">
                <span className="truncate">Awaiting approval</span>
              </span>
            ) : hideStatusLabel ? null : (
              <span
                className={clsx(
                  "inline-flex max-w-full rounded px-2 py-0.5 text-xs font-medium",
                  statusClasses[executable.status],
                )}
              >
                <span className="truncate">
                  {statusLabels[executable.status]}
                </span>
              </span>
            )}
          </div>
          {matchedName ? (
            <div className="mt-1 truncate text-sm font-medium text-text-muted">
              {matchedName}
            </div>
          ) : null}
          {executable.cacheEntry?.pendingCommunityGame ? (
            <div className="mt-1 flex items-center gap-2 text-sm text-community">
              {executable.cacheEntry.pendingCommunityGame.coverUrl ? (
                <img
                  src={executable.cacheEntry.pendingCommunityGame.coverUrl}
                  alt=""
                  className="h-9 w-7 rounded bg-surface-hover object-contain"
                />
              ) : null}
              <span className="truncate">
                {executable.cacheEntry.pendingCommunityGame.name}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {executable.status === "ignored" ? (
            <span className="px-2 text-xs font-medium text-text-faint">
              System ignored
            </span>
          ) : executable.status === "userIgnored" ? (
            <Button
              variant="secondary"
              icon={Undo2}
              loading={isPending}
              onClick={onUnignore}
              className="py-1.5 text-xs"
            >
              Restore
            </Button>
          ) : executable.status === "custom" ? (
            <IconButton
              icon={Trash2}
              intent="danger"
              title="Remove custom tracking"
              onClick={onUntrack}
            />
          ) : executable.status === "unmatched" && !isCustomGameEntryOpen ? (
            <>
              <Button
                variant="primary"
                icon={Send}
                disabled={isOffline || isPending || isRetrying}
                title={
                  isOffline
                    ? "Community sharing requires a connection"
                    : undefined
                }
                onClick={onSuggest}
                className="py-1.5 text-xs font-semibold"
              >
                Add & Share
              </Button>
              <div className="ml-1 flex items-center gap-1 border-l border-border pl-2">
                <IconButton
                  icon={Gamepad2}
                  title="Add locally (do not share)"
                  disabled={isPending || isRetrying}
                  onClick={onStartCustomGame}
                />
                <IconButton
                  icon={RotateCcw}
                  title={
                    isOffline
                      ? "Database matching unavailable offline"
                      : isRetrying
                        ? "Retrying..."
                        : "Retry database match"
                  }
                  disabled={isOffline || isPending || isRetrying}
                  onClick={onRecheck}
                />
                <IconButton
                  icon={EyeOff}
                  title="Ignore this executable"
                  disabled={isRetrying || isPending}
                  onClick={onIgnore}
                />
              </div>
            </>
          ) : executable.status === "checking" ? (
            <IconButton
              icon={EyeOff}
              title="Ignore this executable"
              disabled={isPending}
              onClick={onIgnore}
            />
          ) : null}
        </div>
      </div>

      {isCustomGameEntryOpen ? (
        <form
          className="mt-3 flex items-center gap-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveCustomGame();
          }}
        >
          <Input
            value={customGameName}
            onChange={(event) => onCustomGameNameChange(event.target.value)}
            maxLength={120}
            autoFocus
            placeholder="Enter custom game name..."
            className="h-9 flex-1 text-sm"
          />
          <Button
            type="submit"
            variant="primary"
            icon={Check}
            disabled={!customGameName.trim()}
            className="h-9"
          >
            Save
          </Button>
          <Button
            variant="ghost"
            icon={X}
            onClick={onCancelCustomGame}
            className="h-9 px-2"
          />
        </form>
      ) : null}

      <ContextMenu
        open={contextMenu.open}
        position={contextMenu.position}
        onClose={contextMenu.close}
      >
        {matchedName && (
          <ContextMenuItem icon={Copy} onClick={handleCopyMatchedName}>
            Copy Game Name
          </ContextMenuItem>
        )}
        <ContextMenuItem icon={Copy} onClick={handleCopyExe}>
          Copy Executable Name
        </ContextMenuItem>
        <ContextMenuSeparator />

        {executable.status === "ignored" ||
        executable.status === "userIgnored" ? (
          <ContextMenuItem
            icon={Undo2}
            onClick={() => {
              onUnignore();
              contextMenu.close();
            }}
          >
            Restore Executable
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            icon={EyeOff}
            onClick={() => {
              onIgnore();
              contextMenu.close();
            }}
          >
            Ignore Executable
          </ContextMenuItem>
        )}

        {!isOffline &&
        (executable.status === "unmatched" ||
          executable.status === "checking") ? (
          <ContextMenuItem
            icon={RotateCcw}
            onClick={() => {
              onRecheck();
              contextMenu.close();
            }}
          >
            Retry Database Match
          </ContextMenuItem>
        ) : null}

        {executable.status === "custom" && (
          <ContextMenuItem
            icon={Trash2}
            danger
            onClick={() => {
              onUntrack();
              contextMenu.close();
            }}
          >
            Remove Custom Tracking
          </ContextMenuItem>
        )}
      </ContextMenu>
    </article>
  );
}

export function CommunitySuggestionForm({
  candidates,
  exeName,
  isOffline,
  message,
  search,
  selection,
  state,
  onApplyCandidate,
  onCancel,
  onSearch,
  onSearchChange,
  onSubmit,
}: {
  candidates: CommunityMetadataCandidate[];
  exeName: string;
  isOffline?: boolean;
  message: string;
  search: string;
  selection: CommunityMetadataCandidate | null;
  state: "idle" | "loading" | "saving" | "saved" | "error";
  onApplyCandidate: (candidate: CommunityMetadataCandidate) => void;
  onCancel: () => void;
  onSearch: () => void;
  onSearchChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const busy = state === "loading" || state === "saving";
  const canSubmit =
    Boolean(selection?.coverUrl) && !busy && state !== "saved" && !isOffline;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-4xl animate-toast-in flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-raised">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-text">Suggest community game</h2>
            <p className="mt-1 truncate text-sm text-text-muted">
              Link the correct game to{" "}
              <span
                className="inline-block max-w-full truncate align-bottom font-medium text-text"
                title={exeName}
              >
                {exeName}
              </span>
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted transition hover:bg-surface-hover hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col bg-bg"
          onSubmit={(event) => {
            event.preventDefault();
            if (isOffline) return;
            onSubmit();
          }}
        >
          <div className="flex shrink-0 flex-col gap-3 border-b border-border p-5">
            <div className="flex items-center gap-2">
              <div className="relative h-10 min-w-0 flex-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 grid w-10 place-items-center text-text-faint">
                  <Search size={16} />
                </span>
                <Input
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (search.trim().length >= 2 && !isOffline) onSearch();
                    }
                  }}
                  disabled={isOffline}
                  maxLength={120}
                  autoFocus
                  placeholder="Search by the exact game title..."
                  className="h-10 w-full pl-10 text-base"
                />
              </div>
              <Button
                variant="primary"
                icon={Search}
                loading={state === "loading"}
                disabled={isOffline || search.trim().length < 2}
                title={
                  isOffline ? "Database search unavailable offline" : undefined
                }
                onClick={onSearch}
                className="h-10 shrink-0 px-5"
              >
                Search
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {state === "loading" ? (
              <div className="grid h-full place-items-center rounded-md border border-dashed border-border bg-surface p-10 text-center text-sm text-text-muted">
                <div className="flex flex-col items-center gap-3">
                  <span className="animate-spin text-text-faint">
                    <Search size={24} />
                  </span>
                  Searching database...
                </div>
              </div>
            ) : candidates.length > 0 ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {candidates.map((candidate) => {
                  const selected = selection?.igdbId === candidate.igdbId;
                  const missingCover = !candidate.coverUrl;

                  return (
                    <button
                      key={candidate.igdbId}
                      type="button"
                      onClick={() => onApplyCandidate(candidate)}
                      disabled={missingCover}
                      className={clsx(
                        "group relative flex flex-col overflow-hidden rounded-lg border text-left transition focus:outline-none focus:ring-2 focus:ring-accent",
                        selected
                          ? "border-accent bg-accent/5 ring-1 ring-accent"
                          : "border-border bg-surface hover:border-text-muted",
                        missingCover &&
                          "cursor-not-allowed opacity-60 hover:border-border",
                      )}
                    >
                      <div className="aspect-[3/4] w-full bg-surface-hover">
                        {candidate.coverUrl ? (
                          <img
                            src={candidate.coverUrl}
                            alt=""
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-text-faint">
                            <Gamepad2 size={32} className="opacity-50" />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col p-3">
                        <span
                          className="line-clamp-2 text-sm font-medium leading-tight text-text"
                          title={candidate.name}
                        >
                          {candidate.name}
                        </span>
                        <div className="mt-auto pt-2 flex items-center justify-between text-xs text-text-faint">
                          <span>
                            {missingCover
                              ? "No cover available"
                              : `ID: ${candidate.igdbId}`}
                          </span>
                          {candidate.releaseYear && (
                            <span className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5">
                              {candidate.releaseYear}
                            </span>
                          )}
                        </div>
                      </div>

                      {selected && (
                        <div className="absolute right-2 top-2 rounded-full bg-accent p-1 text-accent-fg shadow-sm">
                          <Check size={14} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid h-full place-items-center rounded-md border border-dashed border-border bg-surface p-10 text-center text-text-muted">
                <div className="max-w-sm">
                  <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-hover">
                    <Search size={20} className="text-text-faint" />
                  </div>
                  <h3 className="mb-2 font-medium text-text">
                    No game selected
                  </h3>
                  <p className="text-sm">
                    Search the database using the field above to find and select
                    the correct game metadata for this executable.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-border bg-surface px-5 py-4">
            <div
              className={clsx(
                "text-sm",
                state === "error"
                  ? "text-danger"
                  : state === "saved"
                    ? "text-success"
                    : "text-text-muted",
              )}
            >
              {isOffline
                ? "Database search is unavailable offline."
                : message || (!selection ? "Select a result to continue." : "")}
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon={Send}
                disabled={!canSubmit}
              >
                {state === "saving" ? "Adding…" : "Add and share"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
