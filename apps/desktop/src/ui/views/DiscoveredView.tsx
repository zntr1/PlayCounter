import clsx from "clsx";
import {
  AppWindow,
  Check,
  CheckCircle,
  ChevronRight,
  EyeOff,
  Gamepad2,
  RotateCcw,
  Search,
  Send,
  SkipForward,
  Undo2,
  Copy,
  X,
} from "lucide-react";
import type { CommunityMetadataCandidate } from "@playcounter/shared";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  addCustomGame,
  addDatabaseGameLocally,
  addSharedCustomGame,
  applyKnownGameMatch,
  ignoreDiscoveredProcess,
  linkServerKnownFiles,
  markCommunitySuggestionRejected,
  recheckExecutable,
  restoreIgnoredExeFolder,
  scanProcessesNow,
  setUserIgnoredProcess,
  type IgnoredProcessSuggestionOutcome,
} from "../../tracker";
import {
  useAppStore,
  useIsOffline,
  type ExeCacheEntry,
  type ProcessSnapshot,
  type Toast,
} from "../../store";
import {
  countNeedsReview,
  getDiscoveryStatus,
  NEEDS_REVIEW_STATUSES,
  type DiscoveryStatus,
} from "../../discoveredReview";
import { ExeIcon } from "../ExeIcon";
import {
  exeProductName,
  exePublisher,
  peekExeDetails,
  useExeDetails,
} from "../exeDetails";
import { describeExeFolder } from "../../exeFolder";
import { SoftwareDialog } from "../SoftwareDialog";
import { useCommunityGameCorrection } from "../useCommunityGameCorrection";
import { useEscapeClearsSearch } from "../useEscapeClearsSearch";
import { Panel, SourceBadge } from "../components";
import {
  paginateExecutables,
  sortIgnoredExecutables,
  sortReviewExecutables,
  type IgnoredProcessSort,
} from "../discoveredSort";
import {
  AnimatedCount,
  Button,
  IconButton,
  Input,
  Modal,
  Select,
  Switch,
} from "../primitives";
import { TOUR_DEMO_GAME } from "../tour/tourDemoGame";
import {
  isSearchableGameQuery,
  type CommunityMetadataSearchOptions,
  type CommunityMetadataSort,
} from "../../communityMetadataSearch";

import {
  useContextMenu,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../primitives";
import {
  pendingFolderFind,
  readWatchFolders,
} from "../../library/watchFolderState";
import { isGenericExeName } from "../../library/exeCandidates";
import { isSortedGenericCopy } from "../../library/genericExeLinks";
import { notifyFolderIgnored } from "./folderIgnoredToast";

const GENERIC_SEARCH_TITLE =
  "Find the game in the database. Many games ship a file with this name, so it is linked to this folder and not shared.";

// Single floating heart shown briefly after a successful "Add & Share".
// Lives outside the heavy view so firing it never re-renders the list.
function HeartOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleShow() {
      setVisible(true);
    }
    window.addEventListener("playcounter:heart", handleShow);
    return () => window.removeEventListener("playcounter:heart", handleShow);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[100] grid place-items-center"
      aria-hidden="true"
    >
      <span className="animate-heart-float text-6xl">❤️</span>
    </div>,
    document.body,
  );
}

function showHeart() {
  window.dispatchEvent(new Event("playcounter:heart"));
}

type DiscoveredExecutable = ProcessSnapshot & {
  key: string;
  isRunning: boolean;
  status: DiscoveryStatus;
  cacheEntry: ExeCacheEntry | null;
  isTutorial?: boolean;
  /** The game folder a watched folder turned up this file in. */
  foundIn?: string;
  /** One folder's Game.exe ignored on this PC; Restore lifts only that. */
  ignoredFolderKey?: string;
};

export const TOUR_DISCOVERED_EXECUTABLE: DiscoveredExecutable = {
  key: `playcounter-tour:${TOUR_DEMO_GAME.exeName.toLowerCase()}`,
  exeName: TOUR_DEMO_GAME.exeName,
  exePath: TOUR_DEMO_GAME.exePath,
  isRunning: true,
  status: "unmatched",
  cacheEntry: null,
  isTutorial: true,
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
};

const statusClasses: Record<DiscoveryStatus, string> = {
  matched: "bg-success-tint text-success",
  custom: "bg-info-tint text-info",
  unmatched: "bg-surface-hover text-text-muted",
  ignored: "bg-surface-hover text-text-faint",
  userIgnored: "bg-warning-tint text-warning",
};

type FilterId = "review" | "tracked" | "ignored";

const discoveryFilters: Array<{
  id: FilterId;
  label: string;
  statuses: DiscoveryStatus[];
}> = [
  {
    id: "review",
    label: "Needs review",
    statuses: [...NEEDS_REVIEW_STATUSES],
  },
  { id: "tracked", label: "Tracked", statuses: ["matched", "custom"] },
  { id: "ignored", label: "Ignored", statuses: ["userIgnored", "ignored"] },
];

const IGNORED_PAGE_SIZE = 50;

const statusToTone: Record<DiscoveryStatus, DiscoveryGroup["tone"]> = {
  matched: "local",
  unmatched: "review",
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
  const ambiguousMatches = useAppStore((state) => state.ambiguousMatches);

  return useMemo(() => {
    return countNeedsReview({
      processes,
      exeCache,
      ignoredProcesses,
      userIgnoredProcesses,
      blacklist,
      ambiguousMatches,
    });
  }, [
    processes,
    exeCache,
    ignoredProcesses,
    userIgnoredProcesses,
    blacklist,
    ambiguousMatches,
  ]);
}

function sortDiscovered(
  left: DiscoveredExecutable,
  right: DiscoveredExecutable,
) {
  const order: Record<DiscoveryStatus, number> = {
    matched: 0,
    custom: 1,
    unmatched: 2,
    userIgnored: 3,
    ignored: 4,
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

export function DiscoveredView() {
  const isFixDetectionTour = useAppStore(
    (state) => state.activeTour?.tourId === "fix-detection",
  );
  const [pendingExe, setPendingExe] = useState<string | null>(null);
  const [customGameExe, setCustomGameExe] = useState<string | null>(null);
  const [customGameName, setCustomGameName] = useState("");
  const [softwareTarget, setSoftwareTarget] = useState<string | null>(null);
  const [suggestionTarget, setSuggestionTarget] = useState<{
    key: string;
    exeName: string;
    exePath: string | null;
    /** Game.exe and co.: the pick stays on this PC, nothing is shared. */
    localOnly: boolean;
  } | null>(null);
  const [filter, setFilter] = useState<FilterId>("review");
  const [ignoredSort, setIgnoredSort] =
    useState<IgnoredProcessSort>("lastAdded");
  const [ignoredPage, setIgnoredPage] = useState(1);
  const [search, setSearch] = useState("");
  const [retryingExe, setRetryingExe] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [activeReviewKey, setActiveReviewKey] = useState<string | null>(null);
  const isOffline = useIsOffline();
  const processes = useAppStore((state) => state.processes);
  const exeCache = useAppStore((state) => state.exeCache);
  const unmatchedRetryDays = useAppStore(
    (state) => state.settings.unmatchedRetryDays,
  );
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const userIgnoredProcesses = useAppStore(
    (state) => state.userIgnoredProcesses,
  );
  const blacklist = useAppStore((state) => state.blacklist);
  const ambiguousMatches = useAppStore((state) => state.ambiguousMatches);
  const scopedExeLinks = useAppStore((state) => state.scopedExeLinks);
  const ignoredExeFolders = useAppStore((state) => state.ignoredExeFolders);
  const toggleBlacklist = useAppStore((state) => state.toggleBlacklist);
  const lastProcessScanAt = useAppStore((state) => state.lastProcessScanAt);
  const addToast = useAppStore((state) => state.addToast);

  useEffect(() => {
    function handleReset() {
      setFilter("review");
      setIgnoredSort("lastAdded");
      setIgnoredPage(1);
      setSearch("");
      setActiveReviewKey(null);
    }

    window.addEventListener("playcounter:discovered-reset", handleReset);
    return () =>
      window.removeEventListener("playcounter:discovered-reset", handleReset);
  }, []);

  // Ctrl+F finds this page's own search field, not the title bar's.
  const searchBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f"
      )
        return;
      const input = searchBoxRef.current?.querySelector("input");
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const clearSearch = useCallback(() => {
    setSearch("");
    setIgnoredPage(1);
  }, []);
  // Escape clears this page's search first, then the title bar's.
  const titleBarHasQuery = useAppStore((state) => state.libraryQuery !== "");
  const clearNextSearch = useCallback(() => {
    if (search) clearSearch();
    else useAppStore.getState().setLibraryQuery("");
  }, [clearSearch, search]);
  useEscapeClearsSearch(Boolean(search) || titleBarHasQuery, clearNextSearch);

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

  function restoreFolder(executable: DiscoveredExecutable) {
    if (!executable.ignoredFolderKey) return;
    restoreIgnoredExeFolder(executable.ignoredFolderKey);
    addToast({
      tone: "success",
      title: `${executable.exeName} restored`,
      detail: `${executable.exeName} in ${executable.foundIn} can be matched again on the next scan.`,
    });
  }

  async function updateUserIgnored(exeName: string, ignored: boolean) {
    const key = exeName.toLowerCase();
    setPendingExe(key);
    try {
      await setUserIgnoredProcess(exeName, ignored);
      if (!ignored && blacklist.has(key)) toggleBlacklist(exeName, false);
      addToast({
        tone: "success",
        title: ignored ? `${exeName} ignored` : `${exeName} restored`,
        detail: ignored
          ? `${exeName} will no longer be matched or tracked.`
          : `${exeName} can be matched again on the next scan.`,
      });
      return true;
    } catch (error) {
      addToast({
        tone: "error",
        title: ignored ? "Ignore failed" : "Restore failed",
        detail: formatError(error),
      });
      return false;
    } finally {
      setPendingExe(null);
    }
  }

  async function ignoreExecutable(exeName: string) {
    if (pendingExe) return false;
    setPendingExe(exeName.toLowerCase());
    try {
      const outcome = await ignoreDiscoveredProcess(
        exeName,
        exePathFor(exeName),
      );
      notifyIgnoredProcessSuggestionOutcome(exeName, outcome, addToast);
      if (outcome.suggestion.kind === "suggested") {
        showHeart();
      }
      return outcome.localBlockApplied;
    } finally {
      setPendingExe(null);
    }
  }

  function startCustomGameEntry(exeName: string, suggestedName = "") {
    setCustomGameExe(exeName.toLowerCase());
    setCustomGameName(suggestedName);
  }

  // The row's file: a generic name (Game.exe) is linked to its folder.
  function exePathFor(exeName: string) {
    const key = exeName.toLowerCase();
    return (
      allExecutables.find((executable) => executable.key === key)?.exePath ??
      null
    );
  }

  function saveCustomGame(exeName: string) {
    const name = customGameName.trim();
    if (!name) return;
    addCustomGame(exeName, name, exePathFor(exeName));
    setCustomGameExe(null);
    setCustomGameName("");
    addToast({
      tone: "success",
      title: "Added to My Games",
      detail: `${name} is now tracked as a custom game.`,
    });
  }

  const correction = useCommunityGameCorrection({
    exeName: suggestionTarget?.exeName ?? "",
    resultInstruction: suggestionTarget?.localOnly
      ? "Pick the game in this folder."
      : "Pick the exact game to unlock sharing.",
    onKnownGame: (game) => {
      if (!suggestionTarget) return;
      const { exeName, exePath } = suggestionTarget;
      applyKnownGameMatch(exeName, game, exePath);
      closeCommunitySuggestion();
      addToast({
        tone: "success",
        title: "Already in IGDB",
        detail: `${game.name} is a known IGDB match for ${exeName} and was applied directly.`,
      });
      showHeart();
    },
    onRejected: (id, reviewNote, { selection }) => {
      if (!suggestionTarget) return;
      const { exeName } = suggestionTarget;
      addSharedCustomGame(
        exeName,
        selection.name,
        selection.coverUrl,
        id,
        false,
        selection.igdbId,
      );
      markCommunitySuggestionRejected(exeName, reviewNote);
      closeCommunitySuggestion();
      addToast({
        tone: "info",
        title: "Suggestion already reviewed",
        detail: reviewNote ?? "This suggestion was not accepted.",
      });
    },
    onSuggested: (id, verified, { selection }) => {
      if (!suggestionTarget) return;
      const { exeName } = suggestionTarget;
      addSharedCustomGame(
        exeName,
        selection.name,
        selection.coverUrl,
        id,
        verified,
        selection.igdbId,
      );
      closeCommunitySuggestion();
      addToast({
        tone: "success",
        title: "Game added and shared",
        detail: `Your community suggestion was submitted for ${exeName}.`,
      });
      showHeart();
    },
  });

  function startCommunitySuggestion(exeName: string) {
    if (isOffline) {
      addToast({
        tone: "info",
        title: "Offline",
        detail: "Community sharing unavailable offline.",
      });
      return;
    }
    correction.reset();
    const exePath = exePathFor(exeName);
    const localOnly = isGenericExeName(exeName);
    // A file found in a watched folder is best searched by its folder name;
    // so is Game.exe, whose own name says nothing.
    const folderName =
      pendingFolderFind(exeName)?.folderName ??
      (localOnly && exePath
        ? exePath.split(/[\\/]/).filter(Boolean).at(-2)
        : undefined);
    if (folderName) correction.setSearch(folderName);
    setSuggestionTarget({
      key: exeName.toLowerCase(),
      exeName,
      exePath,
      localOnly,
    });
  }

  function addSearchedGameLocally() {
    const selection = correction.selection;
    if (!suggestionTarget || !selection?.coverUrl) return;
    const { exeName, exePath } = suggestionTarget;
    const game = addDatabaseGameLocally(exeName, exePath, {
      ...selection,
      coverUrl: selection.coverUrl,
    });
    void linkServerKnownFiles(game);
    closeCommunitySuggestion();
    addToast({
      tone: "success",
      title: "Added to My Games",
      detail: `${game.name} is tracked from this folder. ${exeName} is not shared: many games use that name.`,
    });
  }

  function closeCommunitySuggestion() {
    setSuggestionTarget(null);
    correction.reset();
  }

  const discoverySections = useMemo((): DiscoverySection[] => {
    // Exes with a pending ambiguity picker are resolved in Now Playing; do
    // not offer them for review here at the same time.
    const ambiguousKeys = new Set(
      ambiguousMatches.map((match) => match.exeName.toLowerCase()),
    );
    // Review actions apply to an executable name. Keep one row per name here;
    // the tracker retains every process instance for path-scoped matching.
    // A Game.exe tracked through its folder link, or from an ignored folder,
    // is not the unknown Game.exe waiting here, and must not lend it its path.
    const nativeProcesses = [
      ...new Map(
        processes
          .filter(
            (process) =>
              !process.emulatorId &&
              !isSortedGenericCopy(process, scopedExeLinks, ignoredExeFolders),
          )
          .map((process) => [process.exeName.toLowerCase(), process]),
      ).values(),
    ];
    const runningKeys = new Set(
      nativeProcesses.map((process) => process.exeName.toLowerCase()),
    );
    const running = nativeProcesses
      .filter((process) => !ambiguousKeys.has(process.exeName.toLowerCase()))
      .flatMap((process): DiscoveredExecutable[] => {
        const key = process.exeName.toLowerCase();
        const cacheEntry = exeCache.get(key) ?? null;
        const status = getDiscoveryStatus(
          process.exeName,
          cacheEntry ?? undefined,
          ignoredProcesses,
          userIgnoredProcesses,
          blacklist,
        );
        if (!status) return [];

        return [
          {
            ...process,
            key,
            isRunning: true,
            cacheEntry,
            status,
          },
        ];
      });
    const savedByKey = new Map<string, ExeCacheEntry | null>();
    for (const entry of exeCache.values()) {
      const key = entry.exeName.toLowerCase();
      if (!runningKeys.has(key) && !ambiguousKeys.has(key)) {
        savedByKey.set(key, entry);
      }
    }
    for (const exeName of [...userIgnoredProcesses, ...blacklist]) {
      const key = exeName.toLowerCase();
      if (!runningKeys.has(key) && !savedByKey.has(key)) {
        savedByKey.set(key, null);
      }
    }

    const folderFinds = readWatchFolders().pending;
    const saved = [...savedByKey].flatMap(
      ([key, entry]): DiscoveredExecutable[] => {
        const exeName = entry?.exeName ?? key;
        const status = getDiscoveryStatus(
          exeName,
          entry ?? undefined,
          ignoredProcesses,
          userIgnoredProcesses,
          blacklist,
        );
        if (!status) return [];

        return [
          {
            exeName,
            exePath: folderFinds[key]?.exePath ?? entry?.exePath ?? null,
            foundIn: folderFinds[key]?.folderPath,
            key,
            isRunning: false,
            cacheEntry: entry,
            status,
          },
        ];
      },
    );
    for (const [key, folder] of ignoredExeFolders) {
      saved.push({
        exeName: folder.exeName,
        exePath: `${folder.pathPrefix}\\${folder.exeName}`,
        foundIn: folder.pathPrefix,
        key: `folder:${key}`,
        isRunning: false,
        cacheEntry: null,
        status: "userIgnored",
        ignoredFolderKey: key,
      });
    }

    return [
      {
        id: "running",
        title: "Running now",
        description: "Apps from the latest scan.",
        executables: running.sort(sortDiscovered),
      },
      {
        id: "saved",
        title: "Not running",
        description:
          "Apps PlayCounter saw earlier. They stay here until you decide.",
        executables: saved.sort(sortDiscovered),
      },
    ];
  }, [
    ambiguousMatches,
    blacklist,
    exeCache,
    ignoredExeFolders,
    ignoredProcesses,
    processes,
    scopedExeLinks,
    userIgnoredProcesses,
  ]);

  const allExecutables = useMemo(
    () =>
      discoverySections
        .flatMap((section) => section.executables)
        .sort(sortDiscovered),
    [discoverySections],
  );
  const availableExecutables = isFixDetectionTour
    ? [TOUR_DISCOVERED_EXECUTABLE, ...allExecutables]
    : allExecutables;
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
      matchedName.toLowerCase().includes(needle) ||
      (executable.exePath?.toLowerCase().includes(needle) ?? false)
    );
  };
  const searchable = availableExecutables.filter(matchesSearch);
  const matchingExecutables = searchable.filter((executable) =>
    activeFilter.statuses.includes(executable.status),
  );
  const filteredExecutablesBase =
    filter === "ignored"
      ? sortIgnoredExecutables(matchingExecutables, ignoredSort, [
          ...userIgnoredProcesses,
          ...blacklist,
        ])
      : filter === "review"
        ? sortReviewExecutables(matchingExecutables)
        : matchingExecutables;
  const filteredExecutables =
    isFixDetectionTour && filter === "review"
      ? [
          TOUR_DISCOVERED_EXECUTABLE,
          ...filteredExecutablesBase.filter(
            (executable) => executable.key !== TOUR_DISCOVERED_EXECUTABLE.key,
          ),
        ]
      : filteredExecutablesBase;
  // Ignored splits into the apps you ignored and the ones PlayCounter ignores
  // on its own. Only yours can be restored, so only they are paged.
  const userIgnoredExecutables = filteredExecutables.filter(
    (executable) => executable.status === "userIgnored",
  );
  const builtInIgnoredExecutables = filteredExecutables.filter(
    (executable) => executable.status === "ignored",
  );
  const ignoredPagination = paginateExecutables(
    userIgnoredExecutables,
    ignoredPage,
    IGNORED_PAGE_SIZE,
  );

  function renderExecutableRow(executable: DiscoveredExecutable) {
    return (
      <DiscoveredExecutableRow
        key={executable.key}
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
        onIgnore={() => void ignoreExecutable(executable.exeName)}
        isOffline={isOffline}
        onRecheck={() => {
          if (isOffline) return;
          setRetryingExe(executable.key);
          void recheckExecutable(executable.exeName);
        }}
        onSaveCustomGame={() => saveCustomGame(executable.exeName)}
        onStartCustomGame={() => startCustomGameEntry(executable.exeName)}
        onSuggest={() => startCommunitySuggestion(executable.exeName)}
        onMarkSoftware={() => setSoftwareTarget(executable.exeName)}
        onUnignore={() =>
          executable.ignoredFolderKey
            ? restoreFolder(executable)
            : void updateUserIgnored(executable.exeName, false)
        }
        allowTrackingChanges={filter !== "tracked"}
        unmatchedRetryDays={unmatchedRetryDays}
      />
    );
  }

  const isWizardMode = filter === "review";
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

  function nextReviewKeyAfter(currentKey: string) {
    const currentIndex = filteredExecutables.findIndex(
      (executable) => executable.key === currentKey,
    );
    const remaining = filteredExecutables.filter(
      (executable) => executable.key !== currentKey,
    );
    if (remaining.length === 0) return null;
    if (currentIndex < 0) return remaining[0].key;
    return remaining[Math.min(currentIndex, remaining.length - 1)].key;
  }

  function showTutorialProcessNotice() {
    addToast({
      tone: "info",
      title: "Tutorial app",
      detail: `${TOUR_DEMO_GAME.exeName} exists only inside this guide. Nothing was changed or saved.`,
    });
  }

  return (
    <div className="grid gap-4">
      <HeartOverlay />
      <div className="flex flex-wrap items-center gap-2">
        <div
          data-tour="discovered-filters"
          className="flex flex-wrap items-center gap-2"
        >
          {discoveryFilters.map((entry) => {
            const count = searchable.filter((executable) =>
              entry.statuses.includes(executable.status),
            ).length;
            const active = filter === entry.id;
            const needsAttention = entry.id === "review" && count > 0;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setFilter(entry.id);
                  setIgnoredPage(1);
                }}
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
                  <span className="h-1.5 w-1.5 animate-pulse-few rounded-full bg-warning" />
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
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-text-faint md:inline">
            {lastProcessScanAt
              ? `Last scan ${new Date(lastProcessScanAt).toLocaleTimeString()}`
              : "No scan yet"}
          </span>
          <div ref={searchBoxRef} className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setIgnoredPage(1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search) {
                  event.preventDefault();
                  clearSearch();
                }
              }}
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

      {isOffline ? (
        <div className="text-sm text-text-muted">
          Community features are paused while offline. Local tracking, scanning,
          and triage still work.
        </div>
      ) : null}

      {isWizardMode ? (
        activeReviewItem ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
            <ReviewQueue
              items={filteredExecutables}
              activeKey={activeReviewItem.key}
              onSelect={setActiveReviewKey}
            />
            <TriageWizardCard
              key={activeReviewItem.key}
              executable={activeReviewItem}
              customGameName={customGameName}
              isCustomGameEntryOpen={customGameExe === activeReviewItem.key}
              isPending={pendingExe === activeReviewItem.key}
              isRetrying={retryingExe === activeReviewItem.key}
              onCancelCustomGame={() => {
                setCustomGameExe(null);
                setCustomGameName("");
              }}
              onCustomGameNameChange={setCustomGameName}
              onIgnore={async () => {
                if (activeReviewItem.isTutorial) {
                  showTutorialProcessNotice();
                  return;
                }
                const nextKey = nextReviewKeyAfter(activeReviewItem.key);
                const ignored = await ignoreExecutable(
                  activeReviewItem.exeName,
                );
                if (ignored) setActiveReviewKey(nextKey);
              }}
              isOffline={isOffline}
              onRecheck={() => {
                if (activeReviewItem.isTutorial) {
                  showTutorialProcessNotice();
                  return;
                }
                if (isOffline) return;
                setRetryingExe(activeReviewItem.key);
                void recheckExecutable(activeReviewItem.exeName);
              }}
              onSaveCustomGame={() => {
                if (activeReviewItem.isTutorial) {
                  showTutorialProcessNotice();
                  return;
                }
                saveCustomGame(activeReviewItem.exeName);
              }}
              onStartCustomGame={() => {
                if (activeReviewItem.isTutorial) {
                  showTutorialProcessNotice();
                  return;
                }
                startCustomGameEntry(
                  activeReviewItem.exeName,
                  exeProductName(
                    peekExeDetails(activeReviewItem.exePath),
                    activeReviewItem.exeName,
                  ) ?? "",
                );
              }}
              onSuggest={() => {
                if (activeReviewItem.isTutorial) {
                  showTutorialProcessNotice();
                  return;
                }
                startCommunitySuggestion(activeReviewItem.exeName);
              }}
              onMarkSoftware={() => {
                if (activeReviewItem.isTutorial) {
                  showTutorialProcessNotice();
                  return;
                }
                setSoftwareTarget(activeReviewItem.exeName);
              }}
              onSkip={handleSkip}
            />
          </div>
        ) : search.trim() ? (
          <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
            No app in the queue matches “{search.trim()}”.
          </div>
        ) : (
          <div
            data-tour="discovered-wizard"
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-4 py-16 text-center"
          >
            <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle size={32} />
            </div>
            <h3 className="mb-1 text-lg font-semibold text-text">
              You're all caught up.
            </h3>
            <p className="text-sm text-text-muted">
              Nothing new to review right now.
            </p>
          </div>
        )
      ) : filteredExecutables.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
          No apps match your filters.
        </div>
      ) : filter === "ignored" ? (
        <div className="grid gap-5">
          <section className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-faint">
                Ignored by you · {userIgnoredExecutables.length}
              </h3>
              <Select
                aria-label="Sort ignored apps"
                value={ignoredSort}
                onChange={(event) => {
                  setIgnoredSort(event.target.value as IgnoredProcessSort);
                  setIgnoredPage(1);
                }}
                className="h-9 rounded-lg !py-0 text-[13px]"
              >
                <option value="lastAdded">Sort: Last ignored</option>
                <option value="az">Sort: A–Z</option>
                <option value="za">Sort: Z–A</option>
              </Select>
            </div>
            {userIgnoredExecutables.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
                Apps you ignore show up here. Restore one to have it checked
                again.
              </div>
            ) : (
              ignoredPagination.items.map(renderExecutableRow)
            )}
            {ignoredPagination.pageCount > 1 ? (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-border px-1 pt-3 text-sm text-text-muted">
                <span>
                  Showing {ignoredPagination.start}–{ignoredPagination.end} of{" "}
                  {ignoredPagination.total}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={ignoredPagination.page === 1}
                    onClick={() => setIgnoredPage(ignoredPagination.page - 1)}
                    className="rounded-md border border-border px-3 py-1.5 text-text transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>
                    Page {ignoredPagination.page} of{" "}
                    {ignoredPagination.pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={
                      ignoredPagination.page === ignoredPagination.pageCount
                    }
                    onClick={() => setIgnoredPage(ignoredPagination.page + 1)}
                    className="rounded-md border border-border px-3 py-1.5 text-text transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </section>
          {builtInIgnoredExecutables.length > 0 ? (
            <BuiltInIgnoredSection
              items={builtInIgnoredExecutables}
              forceOpen={Boolean(needle)}
            />
          ) : null}
        </div>
      ) : (
        <div className="grid gap-2">
          {filteredExecutables.map(renderExecutableRow)}
        </div>
      )}
      {softwareTarget ? (
        <SoftwareDialog
          exeName={softwareTarget}
          suggestedName={exeProductName(
            peekExeDetails(
              availableExecutables.find(
                (executable) => executable.key === softwareTarget.toLowerCase(),
              )?.exePath,
            ),
            softwareTarget,
          )}
          isOffline={isOffline}
          onClose={() => setSoftwareTarget(null)}
        />
      ) : null}
      {suggestionTarget ? (
        <CommunitySuggestionForm
          key={suggestionTarget.key}
          candidates={correction.candidates}
          exeName={suggestionTarget.exeName}
          hasMore={correction.hasMore}
          message={correction.message}
          search={correction.search}
          selection={correction.selection}
          state={correction.state}
          isOffline={isOffline}
          onApplyCandidate={correction.applyCandidate}
          onCancel={closeCommunitySuggestion}
          onLoadMore={correction.loadMore}
          onSearch={correction.searchFirstPage}
          onSearchChange={correction.setSearch}
          onSearchOptionsChange={correction.resetResults}
          localOnly={suggestionTarget.localOnly}
          onSubmit={() =>
            suggestionTarget.localOnly
              ? addSearchedGameLocally()
              : void correction.submit()
          }
        />
      ) : null}
    </div>
  );
}

function notifyIgnoredProcessSuggestionOutcome(
  exeName: string,
  outcome: IgnoredProcessSuggestionOutcome,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
  if (outcome.folder) {
    notifyFolderIgnored(exeName, outcome.folder, addToast);
    return;
  }
  if (!outcome.localBlockApplied) {
    addToast({
      tone: "error",
      title: `Could not ignore ${exeName}`,
      detail: "PlayCounter could not ignore it on this PC. Try again.",
    });
    return;
  }
  if (!outcome.ignoreFileUpdated) {
    addToast({
      tone: "error",
      title: `${exeName} ignored`,
      detail:
        "It comes back when you restart PlayCounter - the ignore file could not be saved.",
    });
    return;
  }
  if (outcome.suggestion.kind !== "suggested") {
    addToast({ tone: "success", title: `${exeName} ignored` });
    return;
  }
  addToast({
    tone: "success",
    title: `${exeName} ignored`,
    detail:
      outcome.suggestion.status === "already_reviewed"
        ? "Someone already suggested this one for review."
        : "Also sent for review, so other players do not see it either.",
  });
}

export function TriageWizardCard({
  executable,
  customGameName,
  isCustomGameEntryOpen,
  isOffline,
  isPending,
  isRetrying,
  onCancelCustomGame,
  onCustomGameNameChange,
  onIgnore,
  onMarkSoftware,
  onSaveCustomGame,
  onStartCustomGame,
  onSuggest,
  onSkip,
}: {
  executable: DiscoveredExecutable;
  customGameName: string;
  isCustomGameEntryOpen: boolean;
  isOffline: boolean;
  isPending: boolean;
  isRetrying: boolean;
  onCancelCustomGame: () => void;
  onCustomGameNameChange: (value: string) => void;
  onIgnore: () => void;
  onRecheck?: () => void;
  onSaveCustomGame: () => void;
  onStartCustomGame: () => void;
  onSuggest: () => void;
  onMarkSoftware: () => void;
  onSkip: () => void;
}) {
  const details = useExeDetails(executable.exePath);
  const productName = exeProductName(details, executable.exeName);
  const publisher = exePublisher(details);
  const trackedSeconds = trackedSecondsFor(executable.cacheEntry);
  return (
    <div
      data-tour="discovered-wizard"
      className="animate-fade-in overflow-hidden rounded-xl border border-border bg-surface shadow-md"
    >
      <div className="p-6 sm:p-7">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-border/60 bg-surface-hover">
            <ExeIcon
              exePath={executable.exePath}
              className="h-9 w-9"
              fallback={<AppWindow size={28} className="text-text-faint" />}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="truncate text-2xl font-bold text-text"
              title={productName ?? executable.exeName}
            >
              {productName ?? executable.exeName}
            </h3>
            {productName || publisher ? (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-text-muted">
                {productName ? (
                  <span className="font-mono text-[13px] text-text">
                    {executable.exeName}
                  </span>
                ) : null}
                {publisher ? (
                  <span className="truncate">{publisher}</span>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
              <span className="inline-flex items-center gap-2">
                <span
                  className={clsx(
                    "h-2 w-2 rounded-full",
                    executable.isRunning
                      ? "bg-success shadow-[0_0_8px_rgb(var(--color-success)/0.6)]"
                      : "bg-text-faint/50",
                  )}
                />
                {executable.isRunning ? "Running now" : "Not running"}
              </span>
              {trackedSeconds >= 60 ? (
                <span>{formatTrackedTime(trackedSeconds)} tracked so far</span>
              ) : null}
              {isRetrying ? (
                <span className="animate-pulse font-medium text-accent-ink">
                  Checking database…
                </span>
              ) : null}
            </div>
            {executable.isTutorial ? (
              <span className="mt-2 inline-flex rounded-full border border-accent/30 bg-accent-tint px-2.5 py-1 text-xs font-semibold text-accent-ink">
                Tutorial sample · not saved
              </span>
            ) : null}
          </div>
        </div>

        <ExeFolderEvidence
          exePath={executable.exePath}
          foundIn={executable.foundIn}
        />

        <div className="my-6 h-px bg-border/60" />

        {isCustomGameEntryOpen ? (
          <form
            data-tour="discovered-custom-entry"
            className="mb-6 flex items-center gap-2 rounded-md border border-border bg-surface-hover p-3"
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
              placeholder="e.g. Stardew Valley (modded)"
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Button
            data-tour="discovered-add-share"
            variant="primary"
            icon={isGenericExeName(executable.exeName) ? Search : Send}
            disabled={
              isOffline || isPending || isRetrying || isCustomGameEntryOpen
            }
            title={
              isOffline
                ? "Database search unavailable offline"
                : isGenericExeName(executable.exeName)
                  ? GENERIC_SEARCH_TITLE
                  : undefined
            }
            onClick={onSuggest}
            className="h-12 w-full text-sm font-semibold shadow-sm"
          >
            {isGenericExeName(executable.exeName)
              ? "Search & Add"
              : "Add & Share"}
          </Button>
          <Button
            data-tour="discovered-add-custom"
            variant="secondary"
            icon={Gamepad2}
            disabled={isPending || isRetrying || isCustomGameEntryOpen}
            onClick={onStartCustomGame}
            className="h-12 w-full text-sm"
          >
            Add as Custom
          </Button>
          <Button
            data-tour="discovered-ignore"
            variant="secondary"
            icon={EyeOff}
            disabled={isPending || isRetrying || isCustomGameEntryOpen}
            onClick={onIgnore}
            className="h-12 w-full text-sm"
          >
            Ignore
          </Button>
        </div>
        {/* Offered, not pushed: most apps that are not games should simply be
            ignored. Only apps worth tracking become software. */}
        <div className="mt-4 flex flex-col items-center gap-2 text-sm">
          {/* Software is counted per file name; Game.exe would turn every
              RPG Maker game into software. */}
          {isGenericExeName(executable.exeName) ? null : (
            <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-text-muted">
              <span>Not a game, but you want its time?</span>
              <button
                type="button"
                disabled={isPending || isRetrying || isCustomGameEntryOpen}
                title="Discord, Spotify, a launcher: counted on the Software page, never as a game"
                onClick={onMarkSoftware}
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-accent-ink transition hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppWindow size={14} />
                Track as software
              </button>
            </div>
          )}
          <Button
            data-tour="discovered-skip"
            variant="ghost"
            icon={SkipForward}
            disabled={isPending || isRetrying || isCustomGameEntryOpen}
            onClick={onSkip}
            className="text-sm hover:bg-surface-hover"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Apps PlayCounter ignores on its own: system apps, helpers, background
   services. There is nothing to decide about them, so they stay folded away
   unless a search points into them. */
function BuiltInIgnoredSection({
  items,
  forceOpen,
}: {
  items: DiscoveredExecutable[];
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;
  const preview =
    items
      .slice(0, 3)
      .map((item) => item.exeName)
      .join(", ") + (items.length > 3 ? " …" : "");
  return (
    <section className="grid gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!open)}
        className="flex min-w-0 items-center gap-2 rounded-md py-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={clsx(
            "shrink-0 text-text-faint transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-text-faint">
          Ignored by PlayCounter · {items.length}
        </span>
        {expanded ? null : (
          <span className="min-w-0 truncate text-xs text-text-faint">
            {preview}
          </span>
        )}
      </button>
      {expanded ? (
        <Panel className="divide-y divide-border/60 overflow-hidden">
          <p className="px-4 py-2.5 text-xs text-text-faint">
            System apps, helpers and background services on PlayCounter's
            built-in list. They are never treated as games.
          </p>
          {items.map((item) => (
            <div
              key={item.key}
              className="flex min-w-0 items-center gap-3 px-4 py-2 text-sm"
            >
              <ExeIcon
                exePath={item.exePath}
                className="h-4 w-4 shrink-0 opacity-70"
                fallback={
                  <AppWindow size={14} className="shrink-0 text-text-faint" />
                }
              />
              <span
                className="min-w-0 flex-1 truncate text-text-muted"
                title={item.exePath ?? item.exeName}
              >
                {item.exeName}
              </span>
              {item.isRunning ? (
                <span className="shrink-0 text-xs text-text-faint">
                  Running
                </span>
              ) : null}
            </div>
          ))}
        </Panel>
      ) : null}
    </section>
  );
}

/* The folder is the best evidence of what an app is. It is shown as a trail,
   and the part that gives a game away is marked. */
function ExeFolderEvidence({
  exePath,
  foundIn,
}: {
  exePath: string | null | undefined;
  foundIn?: string;
}) {
  if (!exePath) {
    return (
      <p className="mt-5 text-sm text-text-faint">
        PlayCounter learns the folder the next time this app runs.
      </p>
    );
  }
  const folder = describeExeFolder(exePath);
  // A watched folder was set up for games, so it outweighs the folder name.
  const hint = foundIn
    ? "it's in a folder you watch"
    : folder.gameLocation
      ? `it's in ${folder.gameLocation}`
      : null;
  return (
    <div className="mt-5 rounded-xl border border-border/70 bg-bg/40 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-faint">
        Folder
      </div>
      <div
        className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 font-mono text-[13px] text-text-muted"
        title={exePath}
      >
        {folder.segments.map((segment, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <ChevronRight
                size={12}
                aria-hidden="true"
                className="shrink-0 text-text-faint/70"
              />
            ) : null}
            <span
              className={clsx(
                "break-all",
                segment.marker && "text-accent-ink",
                segment.gameFolder && "font-semibold text-text",
              )}
            >
              {segment.text}
            </span>
          </Fragment>
        ))}
      </div>
      {foundIn ? (
        <div
          className="mt-1.5 truncate text-xs text-text-faint"
          title={foundIn}
        >
          Found in {foundIn}
        </div>
      ) : null}
      {hint ? (
        <div className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-accent-ink">
          <Gamepad2 size={14} aria-hidden="true" />
          Probably a game: {hint}.
        </div>
      ) : null}
    </div>
  );
}

/* Everything left to review, so the queue is visible and any app is one click
   away. Running apps come first, as in the sort. */
function ReviewQueue({
  items,
  activeKey,
  onSelect,
}: {
  items: DiscoveredExecutable[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  const groups = [
    {
      id: "running",
      label: "Running now",
      items: items.filter((item) => item.isRunning),
    },
    {
      id: "earlier",
      label: "Seen earlier",
      items: items.filter((item) => !item.isRunning),
    },
  ].filter((group) => group.items.length > 0);
  return (
    <Panel className="overflow-hidden">
      <div
        role="listbox"
        aria-label="Apps to review"
        className="max-h-[calc(100vh-15rem)] overflow-y-auto p-2"
      >
        {groups.map((group) => (
          <div key={group.id} role="group" aria-label={group.label}>
            <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-text-faint">
              <span>{group.label}</span>
              <span className="font-mono tracking-normal">
                {group.items.length}
              </span>
            </div>
            <div className="grid gap-0.5 pb-1">
              {group.items.map((item) => (
                <ReviewQueueRow
                  key={item.key}
                  executable={item}
                  active={item.key === activeKey}
                  onSelect={() => onSelect(item.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ReviewQueueRow({
  executable,
  active,
  onSelect,
}: {
  executable: DiscoveredExecutable;
  active: boolean;
  onSelect: () => void;
}) {
  const productName = exeProductName(
    useExeDetails(executable.exePath),
    executable.exeName,
  );
  const folderName = executable.exePath
    ? describeExeFolder(executable.exePath).segments.at(-1)?.text
    : undefined;
  const trackedSeconds = trackedSecondsFor(executable.cacheEntry);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={clsx(
        // Same active look as the sidebar, so "selected" reads the same.
        "relative flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active ? "sidebar-button-active" : "hover:bg-surface-hover",
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-hover">
        <ExeIcon
          exePath={executable.exePath}
          className="h-5 w-5"
          fallback={<AppWindow size={15} className="text-text-faint" />}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text">
          {executable.exeName}
        </span>
        <span className="block truncate text-xs text-text-faint">
          {productName ?? folderName ?? "No details yet"}
        </span>
      </span>
      {trackedSeconds >= 60 ? (
        <span className="shrink-0 font-mono text-xs text-text-muted">
          {formatTrackedTime(trackedSeconds)}
        </span>
      ) : null}
    </button>
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
  onMarkSoftware,
  onRecheck,
  onSaveCustomGame,
  onStartCustomGame,
  onSuggest,
  onUnignore,
  allowTrackingChanges,
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
  onMarkSoftware: () => void;
  onUnignore: () => void;
  allowTrackingChanges: boolean;
  unmatchedRetryDays: number;
}) {
  const matchedName =
    executable.cacheEntry?.state === "matched"
      ? executable.cacheEntry.gameName
      : null;
  const isReview = groupTone === "review";
  const isSystemIgnored = groupTone === "systemIgnored";
  // What an app you ignored was, so the list still means something later.
  const ignoredExePath =
    executable.status === "userIgnored" ? executable.exePath : null;
  const ignoredProductName = exeProductName(
    useExeDetails(ignoredExePath),
    executable.exeName,
  );
  const ignoredDetails = ignoredExePath
    ? [ignoredProductName, ignoredExePath.replace(/[\\/][^\\/]*$/, "")]
        .filter(Boolean)
        .join(" · ")
    : null;
  const retryAt = unmatchedRetryAt(executable.cacheEntry, unmatchedRetryDays);
  const contextMenu = useContextMenu();
  const addToast = useAppStore((state) => state.addToast);

  const handleCopyExe = () => {
    navigator.clipboard.writeText(executable.exeName);
    addToast({
      tone: "success",
      title: "Copied",
      detail: "File name copied to clipboard.",
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
                  executable.isRunning ? "bg-success" : "bg-text-faint/50",
                )}
                aria-label={executable.isRunning ? "Running" : "Not running"}
              />
            )}
            <ExeIcon
              exePath={executable.exePath}
              className="h-4 w-4 shrink-0 rounded-sm"
            />
            <h4
              title={matchedName ?? executable.exeName}
              className={clsx(
                "min-w-0 max-w-full flex-1 truncate font-medium",
                isSystemIgnored ? "text-text-faint" : "text-text",
              )}
            >
              {matchedName ?? executable.exeName}
            </h4>
            {hideStatusLabel ? null : (
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
            <div className="mt-0.5 truncate font-mono text-xs text-text-faint">
              {executable.exeName}
            </div>
          ) : null}
          {ignoredDetails ? (
            <div
              className="mt-0.5 truncate text-xs text-text-faint"
              title={executable.exePath ?? undefined}
            >
              {ignoredDetails}
            </div>
          ) : null}
          {executable.foundIn ? (
            <div
              className="mt-1 truncate text-xs text-text-faint"
              title={executable.foundIn}
            >
              Found in {executable.foundIn}
            </div>
          ) : null}
          {trackedSecondsFor(executable.cacheEntry) >= 60 ? (
            <div className="mt-1 text-xs text-text-faint">
              Tracked so far:{" "}
              <span className="font-medium text-text-muted">
                {formatTrackedTime(trackedSecondsFor(executable.cacheEntry))}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {executable.cacheEntry?.state === "matched" ? (
            <SourceBadge source={executable.cacheEntry.source} variant="text" />
          ) : null}
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
          ) : executable.status === "unmatched" && !isCustomGameEntryOpen ? (
            <>
              <Button
                variant="primary"
                icon={isGenericExeName(executable.exeName) ? Search : Send}
                disabled={isOffline || isPending || isRetrying}
                title={
                  isOffline
                    ? "Database search requires a connection"
                    : isGenericExeName(executable.exeName)
                      ? GENERIC_SEARCH_TITLE
                      : undefined
                }
                onClick={onSuggest}
                className="py-1.5 text-xs font-semibold"
              >
                {isGenericExeName(executable.exeName)
                  ? "Search & Add"
                  : "Add & Share"}
              </Button>
              <div className="ml-1 flex items-center gap-1 border-l border-border pl-2">
                <IconButton
                  icon={Gamepad2}
                  title="Add as custom game (do not share)"
                  disabled={isPending || isRetrying}
                  onClick={onStartCustomGame}
                />
                {isGenericExeName(executable.exeName) ? null : (
                  <IconButton
                    icon={AppWindow}
                    title="Track as software (Discord, Spotify, a launcher)"
                    disabled={isPending || isRetrying}
                    onClick={onMarkSoftware}
                  />
                )}
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
                  title="Ignore this app"
                  disabled={isRetrying || isPending}
                  onClick={onIgnore}
                />
              </div>
            </>
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
            placeholder="e.g. Stardew Valley (modded)"
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
          Copy File Name
        </ContextMenuItem>
        {allowTrackingChanges &&
        (executable.status === "userIgnored" ||
          executable.status === "unmatched") ? (
          <>
            <ContextMenuSeparator />
            {executable.status === "userIgnored" ? (
              <ContextMenuItem
                icon={Undo2}
                onClick={() => {
                  onUnignore();
                  contextMenu.close();
                }}
              >
                Restore Executable
              </ContextMenuItem>
            ) : executable.status === "unmatched" ? (
              <ContextMenuItem
                icon={EyeOff}
                onClick={() => {
                  onIgnore();
                  contextMenu.close();
                }}
              >
                Ignore Executable
              </ContextMenuItem>
            ) : null}
          </>
        ) : null}

        {!isOffline && executable.status === "unmatched" ? (
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
      </ContextMenu>
    </article>
  );
}

export function CommunitySuggestionForm({
  candidates,
  exeName,
  hasMore,
  isOffline,
  message,
  search,
  selection,
  state,
  title = "Suggest community game",
  practice = false,
  localOnly = false,
  localAction,
  onApplyCandidate,
  onCancel,
  onLoadMore,
  onSearch,
  onSearchChange,
  onSearchOptionsChange,
  onSubmit,
}: {
  candidates: CommunityMetadataCandidate[];
  exeName: string;
  hasMore?: boolean;
  isOffline?: boolean;
  message: string;
  search: string;
  selection: CommunityMetadataCandidate | null;
  state: "idle" | "loading" | "loading-more" | "saving" | "saved" | "error";
  title?: string;
  practice?: boolean;
  /** Generic exe names: the pick is added on this PC and never shared. */
  localOnly?: boolean;
  /** Title and button of a local search, e.g. "Change game". */
  localAction?: string;
  onApplyCandidate: (candidate: CommunityMetadataCandidate) => void;
  onCancel: () => void;
  onLoadMore?: (options: CommunityMetadataSearchOptions) => void;
  onSearch: (options: CommunityMetadataSearchOptions) => void;
  onSearchChange: (value: string) => void;
  onSearchOptionsChange?: () => void;
  onSubmit: () => void;
}) {
  const busy =
    state === "loading" || state === "loading-more" || state === "saving";
  const [releaseYearInput, setReleaseYearInput] = useState("");
  const [sort, setSort] = useState<CommunityMetadataSort>("relevance");
  const parsedReleaseYear = Number(releaseYearInput);
  const releaseYearValid =
    !releaseYearInput ||
    (/^\d{4}$/.test(releaseYearInput) &&
      parsedReleaseYear >= 1950 &&
      parsedReleaseYear <= 2100);
  const searchOptions: CommunityMetadataSearchOptions = {
    sort,
    ...(releaseYearInput && releaseYearValid
      ? { releaseYear: parsedReleaseYear }
      : {}),
  };
  const canSubmit =
    Boolean(selection?.coverUrl) && !busy && state !== "saved" && !isOffline;

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
      <div className="flex shrink-0 justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="community-suggestion-form"
          variant="primary"
          icon={localOnly ? Check : Send}
          disabled={!canSubmit}
        >
          {state === "saving"
            ? "Adding…"
            : practice
              ? "Confirm sample match"
              : localOnly
                ? (localAction ?? "Add")
                : "Add and share"}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      dataTour={practice ? "demo-sample-search" : undefined}
      backdropDataTour={practice ? "demo-library-modal" : undefined}
      size="wide"
      labelId="community-suggestion-dialog-title"
      eyebrow={
        practice
          ? "Practice · nothing is submitted"
          : localOnly
            ? "This PC only"
            : "Community"
      }
      title={localOnly ? (localAction ?? "Find the game") : title}
      subtitle={`Link the correct game to ${exeName}`}
      icon={Send}
      onClose={onCancel}
      bodyClassName="flex overflow-hidden !p-0"
      footer={footer}
    >
      <form
        id="community-suggestion-form"
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
                    if (
                      isSearchableGameQuery(search) &&
                      releaseYearValid &&
                      !isOffline
                    )
                      onSearch(searchOptions);
                  }
                }}
                disabled={isOffline}
                maxLength={120}
                data-autofocus
                placeholder="Search by game title or IGDB ID..."
                className="h-10 w-full pl-10 text-base"
              />
            </div>
            <Button
              variant="primary"
              icon={Search}
              loading={state === "loading"}
              disabled={
                busy ||
                isOffline ||
                !isSearchableGameQuery(search) ||
                !releaseYearValid
              }
              title={
                isOffline ? "Database search unavailable offline" : undefined
              }
              onClick={() => onSearch(searchOptions)}
              className="h-10 shrink-0 px-5"
            >
              Search
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
              Release year
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={releaseYearInput}
                onChange={(event) => {
                  setReleaseYearInput(
                    event.target.value.replace(/\D/g, "").slice(0, 4),
                  );
                  onSearchOptionsChange?.();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (
                    isSearchableGameQuery(search) &&
                    releaseYearValid &&
                    !isOffline
                  )
                    onSearch(searchOptions);
                }}
                disabled={busy || isOffline}
                placeholder="Any year"
                aria-invalid={!releaseYearValid}
                className={clsx(
                  "h-9 w-28",
                  !releaseYearValid && "border-danger focus:border-danger",
                )}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
              Sort by
              <Select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as CommunityMetadataSort);
                  onSearchOptionsChange?.();
                }}
                disabled={busy || isOffline}
                className="h-9 !py-0"
              >
                <option value="relevance">IGDB relevance</option>
                <option value="release-desc">Newest release</option>
                <option value="release-asc">Oldest release</option>
              </Select>
            </label>
            {!releaseYearValid ? (
              <span className="pb-2 text-xs text-danger">
                Enter a year from 1950 to 2100.
              </span>
            ) : null}
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
            <div className="flex flex-col gap-5">
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
                              : practice
                                ? "Sample"
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
              {hasMore && onLoadMore ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={state === "loading-more"}
                  disabled={busy || isOffline}
                  onClick={() => onLoadMore(searchOptions)}
                  className="mx-auto min-w-40"
                >
                  Load more matches
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid h-full place-items-center rounded-md border border-dashed border-border bg-surface p-10 text-center text-text-muted">
              <div className="max-w-sm">
                <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-hover">
                  <Search size={20} className="text-text-faint" />
                </div>
                <h3 className="mb-2 font-medium text-text">No game selected</h3>
                <p className="text-sm">
                  Search the database using the field above to find and select
                  the correct game metadata for this executable.
                </p>
              </div>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}

function formatTrackedTime(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

function trackedSecondsFor(cacheEntry: ExeCacheEntry | null) {
  if (!cacheEntry || cacheEntry.state !== "unmatched") return 0;
  const base = cacheEntry.trackedSeconds ?? 0;
  // Folded runtime updates ~once a minute; add the open running window so the
  // displayed total stays current between checkpoints.
  if (!cacheEntry.runningSince) return base;
  const since = Date.parse(cacheEntry.runningSince);
  if (!Number.isFinite(since)) return base;
  return base + Math.max(0, (Date.now() - since) / 1000);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
