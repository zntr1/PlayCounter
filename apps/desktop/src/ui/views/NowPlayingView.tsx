import { AlertTriangle, ChevronDown, ChevronUp, Gamepad2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  CommunityMetadataSearchResponse,
  Game,
  IdentifierFlagReason,
} from "@playcounter/shared";
import {
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
  useIsOffline,
  type ActiveSession,
  type ExeCacheEntry,
  type Toast,
} from "../../store";
import {
  applyKnownGameMatch,
  dismissAmbiguousMatch,
  markCommunitySuggestionRejected,
  reportNegativeMatch,
  selectAmbiguousCommunitySuggestion,
  selectAmbiguousCustomGame,
  selectAmbiguousMatch,
  suggestTrackedGameToCommunity,
  type LocalProcessIgnoreOutcome,
  type NegativeReportOutcome,
} from "../../tracker";
import {
  communityMetadataSearchUrl,
  mergeCommunityMetadataCandidates,
  type CommunityMetadataSearchOptions,
} from "../../communityMetadataSearch";
import { Panel, SourceBadge } from "../components";
import { Button, Input } from "../primitives";
import { ReportWrongMatchDialog } from "../ReportWrongMatchDialog";
import { TOUR_DEMO_GAME } from "../tour/tourDemoGame";
import { findTour } from "../tour/tourDefinitions";
import { CommunitySuggestionForm } from "./DiscoveredView";
import { ActiveGameHero } from "./ActiveGameHero";
import { matchCandidatePriority } from "./matchCheckModel";
import {
  providerFloorRecord,
  providerFloors as collectProviderFloors,
} from "../../library/playtimeFloor";

const TOUR_NOW_PLAYING_SESSION_ID = -1;
const EMPTY_EXE_CACHE: ReadonlyMap<string, ExeCacheEntry> = new Map();
const EMPTY_SECONDS: Record<string, number> = {};

export function NowPlayingView() {
  const allActiveSessions = useAppStore((state) => state.activeSessions);
  const activeSessions = useMemo(
    () => allActiveSessions.filter((session) => !session.emulator),
    [allActiveSessions],
  );
  const ambiguousMatches = useAppStore((state) => state.ambiguousMatches);
  const recentSessions = useAppStore((state) => state.recentSessions);
  const archivedGameSeconds = useAppStore((state) => state.archivedGameSeconds);
  const playtimeAdjustments = useAppStore((state) => state.playtimeAdjustments);
  const exeCache = useAppStore((state) => state.exeCache);
  const gameMetadata = useAppStore((state) => state.gameMetadata);
  const libraryImports = useAppStore((state) => state.libraryImports);
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(gameMetadata, exeCache, libraryImports),
    [exeCache, gameMetadata, libraryImports],
  );
  const providerFloorSeconds = useMemo(
    () => providerFloorRecord(collectProviderFloors(libraryImports.values())),
    [libraryImports],
  );
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const addToast = useAppStore((state) => state.addToast);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const activeTour = useAppStore((state) => state.activeTour);
  const [now, setNow] = useState(() => Date.now());
  const [tourSessionStartedAt, setTourSessionStartedAt] = useState(() =>
    new Date(Date.now() - 137_000).toISOString(),
  );
  const [reportTarget, setReportTarget] = useState<ActiveSession | null>(null);
  const [correctionExeName, setCorrectionExeName] = useState<string | null>(
    null,
  );
  const activeTourStep = activeTour
    ? findTour(activeTour.tourId)?.steps[activeTour.stepIndex]
    : undefined;
  const showTourSession =
    activeTour?.tourId === "core" && activeTourStep?.id === "now";
  const tourSession = useMemo<ActiveSession>(
    () => ({
      id: TOUR_NOW_PLAYING_SESSION_ID,
      gameId: TOUR_DEMO_GAME.gameId,
      gameName: TOUR_DEMO_GAME.name,
      exeName: TOUR_DEMO_GAME.exeName,
      coverUrl: TOUR_DEMO_GAME.coverUrl,
      startedAt: tourSessionStartedAt,
      checkpointedAt: tourSessionStartedAt,
    }),
    [tourSessionStartedAt],
  );
  const displayedActiveSessions = showTourSession
    ? [tourSession]
    : activeSessions;
  const displayedAmbiguousMatches = showTourSession ? [] : ambiguousMatches;
  const hasActivity =
    displayedActiveSessions.length > 0 || displayedAmbiguousMatches.length > 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (showTourSession) {
      setTourSessionStartedAt(new Date(Date.now() - 137_000).toISOString());
    }
  }, [showTourSession]);

  async function handleNegativeReport(session: ActiveSession) {
    setReportTarget(null);
    const outcome = await reportNegativeMatch(session.exeName);
    notifyNegativeReportOutcome(session.exeName, outcome, addToast);
  }

  return (
    <>
      {!hasActivity ? (
        <Panel className="grid min-h-[360px] place-items-center p-8 text-center">
          <div>
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full border border-border bg-surface-hover text-text-faint">
              <Gamepad2 size={28} />
            </div>
            <h2 className="text-2xl font-semibold text-text">
              No game detected
            </h2>
            <p className="mt-2 text-text-muted">
              Start a game and it will appear here automatically.
            </p>
            <p className="mt-4 max-w-md text-sm text-text-faint">
              Game not showing up? Review unmatched processes{" "}
              <button
                type="button"
                onClick={() => setActiveView("discovered")}
                className="font-medium text-accent transition hover:text-accent-hover"
              >
                here
              </button>
              .
            </p>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4">
          {displayedActiveSessions.map((activeSession) => {
            const isTourSession =
              activeSession.id === TOUR_NOW_PLAYING_SESSION_ID;

            return (
              <ActiveGameHero
                key={resolvedCanonicalGameKey(activeSession, resolveIgdbId)}
                session={activeSession}
                elapsedSeconds={Math.max(
                  0,
                  Math.floor(
                    (now - Date.parse(activeSession.startedAt)) / 1000,
                  ),
                )}
                recentSessions={isTourSession ? [] : recentSessions}
                showDurationDays={showDurationDays}
                exeCache={isTourSession ? EMPTY_EXE_CACHE : exeCache}
                resolveIgdbId={resolveIgdbId}
                archivedGameSeconds={
                  isTourSession ? EMPTY_SECONDS : archivedGameSeconds
                }
                playtimeAdjustments={
                  isTourSession ? EMPTY_SECONDS : playtimeAdjustments
                }
                providerFloorSeconds={
                  isTourSession
                    ? 0
                    : (providerFloorSeconds[
                        resolvedCanonicalGameKey(activeSession, resolveIgdbId)
                      ] ?? 0)
                }
                onReport={() => setReportTarget(activeSession)}
                statusLabel="Now playing"
                tourAnchor={isTourSession ? "now-playing-demo" : undefined}
              />
            );
          })}
          {displayedAmbiguousMatches.length > 0 ? (
            <section className="grid gap-3">
              <div className="flex items-center gap-2 px-1 pt-1">
                <AlertTriangle size={14} className="shrink-0 text-warning" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">
                  Game detection needs review
                </h3>
                <span className="rounded-full border border-warning-border bg-warning-tint px-1.5 text-[11px] font-semibold tabular-nums text-warning">
                  {displayedAmbiguousMatches.length}
                </span>
              </div>
              {displayedAmbiguousMatches.map((match) => {
                const elapsedSeconds = Math.max(
                  0,
                  Math.floor(
                    ((match.endedAt ? Date.parse(match.endedAt) : now) -
                      Date.parse(match.detectedAt)) /
                      1000,
                  ),
                );

                return (
                  <AmbiguousMatchCard
                    key={match.exeName.toLowerCase()}
                    exeName={match.exeName}
                    candidates={match.candidates}
                    elapsedSeconds={elapsedSeconds}
                    ended={Boolean(match.endedAt)}
                    flagReason={match.flagReason}
                  />
                );
              })}
            </section>
          ) : null}
        </div>
      )}
      {reportTarget ? (
        <ReportWrongMatchDialog
          exeName={reportTarget.exeName}
          gameName={reportTarget.gameName}
          onCancel={() => setReportTarget(null)}
          onDifferentGame={() => {
            setCorrectionExeName(reportTarget.exeName);
            setReportTarget(null);
          }}
          onNotAGame={() => void handleNegativeReport(reportTarget)}
        />
      ) : null}
      {correctionExeName ? (
        <TrackedGameCorrectionDialog
          exeName={correctionExeName}
          onClose={() => setCorrectionExeName(null)}
        />
      ) : null}
    </>
  );
}

function TrackedGameCorrectionDialog({
  exeName,
  onClose,
}: {
  exeName: string;
  onClose: () => void;
}) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const installUuid = useAppStore((state) => state.installUuid);
  const addToast = useAppStore((state) => state.addToast);
  const isOffline = useIsOffline();
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<CommunityMetadataCandidate[]>(
    [],
  );
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [selection, setSelection] = useState<CommunityMetadataCandidate | null>(
    null,
  );
  const [state, setState] = useState<
    "idle" | "loading" | "loading-more" | "saving" | "saved" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  function resetResults() {
    setSelection(null);
    setCandidates([]);
    setHasMore(false);
    setNextOffset(0);
    setMessage("");
  }

  async function searchCandidatePage(
    offset: number,
    append: boolean,
    options: CommunityMetadataSearchOptions,
  ) {
    const query = search.trim();
    if (query.length < 2 || isOffline) return;

    setState(append ? "loading-more" : "loading");
    setMessage("");
    if (!append) setCandidates([]);
    try {
      const response = await fetch(
        communityMetadataSearchUrl(apiEndpoint, query, offset, options),
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      const body = (await response.json()) as CommunityMetadataSearchResponse;
      const nextCandidates = append
        ? mergeCommunityMetadataCandidates(candidates, body.candidates)
        : body.candidates;
      setCandidates(nextCandidates);
      setHasMore(Boolean(body.hasMore));
      setNextOffset(body.nextOffset ?? 0);
      setMessage(
        nextCandidates.length > 0
          ? body.hasMore
            ? `${nextCandidates.length} matches shown. Load more to keep looking.`
            : `All ${nextCandidates.length} matches shown. Pick the game you started.`
          : "No matching games found.",
      );
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  function applyCandidate(candidate: CommunityMetadataCandidate) {
    if (!candidate.coverUrl) {
      setSelection(null);
      setMessage(
        `${candidate.name} has no cover art. Pick a result with cover art.`,
      );
      return;
    }

    setSelection(candidate);
    setMessage(`Selected ${candidate.name} from the database.`);
  }

  async function submitSuggestion() {
    if (!selection?.coverUrl) return;

    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`${apiEndpoint}/api/community/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exeName,
          name: selection.name,
          coverUrl: selection.coverUrl,
          igdbId: selection.igdbId,
          installUuid: installUuid ?? undefined,
        }),
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const result = (await response.json()) as CommunityGameSuggestionResponse;
      if (result.igdbGame) {
        applyKnownGameMatch(exeName, result.igdbGame);
        onClose();
        addToast({
          tone: "success",
          title: "Correct match applied",
          detail: `${exeName} is now tracked as ${result.igdbGame.name}.`,
        });
        return;
      }
      if (result.rejected) {
        if (result.id === undefined) throw new Error("Unexpected response");
        suggestTrackedGameToCommunity(
          exeName,
          selection.name,
          selection.coverUrl,
          result.id,
          false,
          selection.igdbId,
        );
        markCommunitySuggestionRejected(exeName, result.reviewNote);
        onClose();
        addToast({
          tone: "info",
          title: "Suggestion already reviewed",
          detail: result.reviewNote ?? "This suggestion was not accepted.",
        });
        return;
      }
      if (result.id === undefined) throw new Error("Unexpected response");
      suggestTrackedGameToCommunity(
        exeName,
        selection.name,
        selection.coverUrl,
        result.id,
        result.verified ?? false,
        selection.igdbId,
      );
      onClose();
      addToast({
        tone: "success",
        title: "Correct game submitted",
        detail: `${exeName} now uses ${selection.name} while the community match is reviewed.`,
      });
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  return (
    <CommunitySuggestionForm
      candidates={candidates}
      exeName={exeName}
      hasMore={hasMore}
      message={message}
      search={search}
      selection={selection}
      state={state}
      title="Choose the correct game"
      isOffline={isOffline}
      onApplyCandidate={applyCandidate}
      onCancel={onClose}
      onLoadMore={(options) => {
        if (hasMore) void searchCandidatePage(nextOffset, true, options);
      }}
      onSearch={(options) => void searchCandidatePage(0, false, options)}
      onSearchChange={(value) => {
        setSearch(value);
        resetResults();
      }}
      onSearchOptionsChange={resetResults}
      onSubmit={() => void submitSuggestion()}
    />
  );
}

function formatClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatAgo(seconds: number) {
  if (seconds < 60) return "just now";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m ago` : `${minutes}m ago`;
}

// Single line under the headline of a clarification card: which executable it
// is about, how long it has been waiting, and why it needs a manual decision.
function MatchMeta({
  exeName,
  ended,
  elapsedSeconds,
  note,
}: {
  exeName?: string;
  ended: boolean;
  elapsedSeconds: number;
  note?: string;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      {exeName ? (
        <span className="truncate rounded-md border border-border/60 bg-surface-hover/50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-text-muted">
          {exeName}
        </span>
      ) : null}
      {ended ? (
        <span
          title="This time is not saved yet. Choosing a game assigns it."
          className="rounded-md border border-warning-border bg-warning-tint px-2 py-0.5 font-medium tabular-nums text-warning"
        >
          Closed · {formatClock(elapsedSeconds)} unsaved
        </span>
      ) : (
        <span className="text-text-faint">
          Detected {formatAgo(elapsedSeconds)}
        </span>
      )}
      {note ? (
        <>
          <span aria-hidden className="text-text-faint">
            ·
          </span>
          <span className="text-warning">{note}</span>
        </>
      ) : null}
    </div>
  );
}

function FooterAction({
  children,
  onClick,
  title,
  emphasis = false,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded px-2 py-1 font-medium transition ${
        emphasis
          ? "text-warning hover:bg-warning-tint"
          : "text-text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function FooterSeparator() {
  return (
    <span aria-hidden className="text-text-faint">
      ·
    </span>
  );
}

function AmbiguousMatchCard({
  exeName,
  candidates,
  elapsedSeconds,
  ended,
  flagReason,
}: {
  exeName: string;
  candidates: Game[];
  elapsedSeconds: number;
  ended: boolean;
  flagReason?: IdentifierFlagReason;
}) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const installUuid = useAppStore((state) => state.installUuid);
  const addToast = useAppStore((state) => state.addToast);
  const isOffline = useIsOffline();
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    CommunityMetadataCandidate[]
  >([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchNextOffset, setSearchNextOffset] = useState(0);
  const [selection, setSelection] = useState<CommunityMetadataCandidate | null>(
    null,
  );
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "loading-more" | "saving" | "saved" | "error"
  >("idle");
  const [searchMessage, setSearchMessage] = useState("");
  const [customEntryOpen, setCustomEntryOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [candidatesExpanded, setCandidatesExpanded] = useState(false);
  const orderedCandidates = useMemo(
    () =>
      [...candidates].sort(
        (left, right) =>
          matchCandidatePriority(left) - matchCandidatePriority(right),
      ),
    [candidates],
  );
  // The community verified this executable name as non-game software, so the
  // card leads with "not a game" and keeps the database matches folded away.
  const reportedNotAGame = flagReason === "not_a_game";
  const showCandidates =
    candidates.length > 0 && (!reportedNotAGame || candidatesExpanded);

  function submitCustomGame() {
    const name = customName.trim();
    if (!name) return;
    selectAmbiguousCustomGame(exeName, name);
    addToast({
      tone: "success",
      title: "Custom game added",
      detail: `${exeName} will be tracked as ${name}.`,
    });
  }

  async function searchIgdbPage(
    offset: number,
    append: boolean,
    options: CommunityMetadataSearchOptions,
  ) {
    const query = searchQuery.trim();
    if (query.length < 2 || isOffline) return;

    setSearchState(append ? "loading-more" : "loading");
    setSearchMessage("");
    if (!append) setSearchResults([]);
    try {
      const response = await fetch(
        communityMetadataSearchUrl(apiEndpoint, query, offset, options),
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      const body = (await response.json()) as CommunityMetadataSearchResponse;
      const results = append
        ? mergeCommunityMetadataCandidates(searchResults, body.candidates)
        : body.candidates;
      setSearchResults(results);
      setSearchHasMore(Boolean(body.hasMore));
      setSearchNextOffset(body.nextOffset ?? 0);
      setSearchMessage(
        results.length > 0
          ? body.hasMore
            ? `${results.length} matches shown. Load more to keep looking.`
            : `All ${results.length} matches shown. Select the game you launched. PlayCounter will track it as a custom game while the community match is reviewed.`
          : "No matching games found.",
      );
      setSearchState("idle");
    } catch (error) {
      setSearchState("error");
      setSearchMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function searchIgdb(options: CommunityMetadataSearchOptions) {
    return searchIgdbPage(0, false, options);
  }

  function loadMoreIgdb(options: CommunityMetadataSearchOptions) {
    if (!searchHasMore) return;
    return searchIgdbPage(searchNextOffset, true, options);
  }

  function applyMetadataCandidate(candidate: CommunityMetadataCandidate) {
    if (!candidate.coverUrl) {
      setSelection(null);
      setSearchMessage(
        `${candidate.name} has no cover art. Pick a result with cover art.`,
      );
      return;
    }

    setSelection(candidate);
    setSearchMessage(`Selected ${candidate.name} from the database.`);
  }

  async function submitCommunitySuggestion() {
    if (!selection?.coverUrl) return;

    setSearchState("saving");
    setSearchMessage("");
    try {
      const response = await fetch(`${apiEndpoint}/api/community/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exeName,
          name: selection.name,
          coverUrl: selection.coverUrl,
          igdbId: selection.igdbId,
          installUuid: installUuid ?? undefined,
        }),
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const result = (await response.json()) as CommunityGameSuggestionResponse;
      if (result.igdbGame) {
        selectAmbiguousMatch(exeName, result.igdbGame);
        setSearchState("saved");
        setSuggestionOpen(false);
        setSelection(null);
        setSearchResults([]);
        addToast({
          tone: "success",
          title: "Already in IGDB",
          detail: `${result.igdbGame.name} is a known IGDB match for ${exeName} and was applied directly.`,
        });
        return;
      }
      if (result.rejected) {
        if (result.id === undefined) throw new Error("Unexpected response");
        selectAmbiguousCommunitySuggestion(
          exeName,
          selection.name,
          selection.coverUrl,
          result.id,
          false,
          selection.igdbId,
        );
        markCommunitySuggestionRejected(exeName, result.reviewNote);
        setSearchState("saved");
        setSuggestionOpen(false);
        setSelection(null);
        setSearchResults([]);
        addToast({
          tone: "info",
          title: "Suggestion already reviewed",
          detail: result.reviewNote ?? "This suggestion was not accepted.",
        });
        return;
      }
      if (result.id === undefined) throw new Error("Unexpected response");
      selectAmbiguousCommunitySuggestion(
        exeName,
        selection.name,
        selection.coverUrl,
        result.id,
        result.verified ?? false,
        selection.igdbId,
      );
      setSearchState("saved");
      setSearchMessage(
        `Added to your library and sent for community review as #${result.id}.`,
      );
      setSuggestionOpen(false);
      setSelection(null);
      setSearchResults([]);
      addToast({
        tone: "success",
        title: "Game added and shared",
        detail: `${exeName} is now tracked as a custom game while approval is pending.`,
      });
    } catch (error) {
      setSearchState("error");
      setSearchMessage(formatError(error));
    }
  }

  function closeSuggestion() {
    setSuggestionOpen(false);
    setSelection(null);
    setSearchResults([]);
    setSearchHasMore(false);
    setSearchNextOffset(0);
    setSearchState("idle");
    setSearchMessage("");
  }

  async function handleNegativeReport() {
    const outcome = await reportNegativeMatch(exeName);
    notifyNegativeReportOutcome(exeName, outcome, addToast);
  }

  async function handleDismiss() {
    const outcome = await dismissAmbiguousMatch(exeName);
    notifyDismissOutcome(exeName, outcome, addToast);
  }

  return (
    <section className="relative overflow-hidden rounded-xl border border-warning-border bg-surface shadow-raised">
      <div className="p-5">
        {reportedNotAGame ? (
          <>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-warning-border bg-warning-tint px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-warning">
              <AlertTriangle size={12} />
              Probably not a game
            </div>
            <h2 className="break-words text-2xl font-bold text-text">
              Is <span className="font-mono">{exeName}</span> a game?
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-text-muted">
              Other players reported that {exeName} is not a game, so
              PlayCounter no longer matches it automatically
              {candidates.length === 1
                ? ` - even though it still matches ${candidates[0].name}`
                : candidates.length > 1
                  ? ` - even though it still matches ${candidates.length} games`
                  : ""}
              .
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void handleNegativeReport()}
              >
                No, this isn&apos;t a game
              </Button>
              {candidates.length > 0 ? (
                <Button
                  variant="secondary"
                  icon={candidatesExpanded ? ChevronUp : ChevronDown}
                  onClick={() => setCandidatesExpanded((open) => !open)}
                >
                  {candidatesExpanded
                    ? "Hide possible matches"
                    : "Show possible matches"}
                </Button>
              ) : null}
            </div>
            <MatchMeta ended={ended} elapsedSeconds={elapsedSeconds} />
          </>
        ) : (
          <>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-warning-border bg-warning-tint px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-warning">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
              Unidentified process
            </div>
            <h2 className="break-words text-2xl font-bold text-text">
              Is <span className="font-mono">{exeName}</span> a game?
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-text-muted">
              PlayCounter found this app running.{" "}
              {candidates.length === 1
                ? "A game in the database uses"
                : `${candidates.length} games in the database use`}{" "}
              the same file name, and other apps might use it too - so
              PlayCounter won&apos;t guess. Tell it once and it will remember.
            </p>
            <MatchMeta
              exeName={exeName}
              ended={ended}
              elapsedSeconds={elapsedSeconds}
              note={
                flagReason === "ambiguous"
                  ? "Several games use this file name, so PlayCounter won't guess."
                  : undefined
              }
            />
          </>
        )}

        {showCandidates ? (
          <div className="mt-5 border-t border-border pt-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-faint">
                  {candidates.length === 1
                    ? "Did you launch this game?"
                    : "Did you launch one of these games?"}
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Select it to{" "}
                  {ended ? "save this activity" : "start tracking it"}.
                </p>
              </div>
              {!reportedNotAGame ? (
                <Button
                  variant="secondary"
                  title={`Stop tracking ${exeName} and report it as a launcher, tool, or other app that is not a game.`}
                  onClick={() => void handleNegativeReport()}
                >
                  No, this isn&apos;t a game
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {orderedCandidates.map((game) => (
                <GameCandidateButton
                  key={`${game.source}:${game.id}`}
                  exeName={exeName}
                  game={game}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-x-0.5 gap-y-1 border-t border-border pt-3 text-xs">
          {!isOffline ? (
            <>
              <FooterAction
                title="Search the database and send the match in for review."
                onClick={() => {
                  setSuggestionOpen(true);
                  setSearchMessage("");
                }}
              >
                Search for the right game
              </FooterAction>
              <FooterSeparator />
            </>
          ) : null}
          <FooterAction
            title="Track it under a name you type yourself. Stays on this PC only."
            onClick={() => setCustomEntryOpen((open) => !open)}
          >
            Add as custom game
          </FooterAction>
          <FooterSeparator />
          <FooterAction
            title="Hide it on this PC without sending a report. You can restore it under Discovered."
            onClick={() => void handleDismiss()}
          >
            Ignore on this PC
          </FooterAction>
        </div>

        {customEntryOpen || isOffline ? (
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitCustomGame();
            }}
          >
            <Input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              maxLength={120}
              autoFocus={customEntryOpen}
              placeholder={
                isOffline ? "Offline - add the game by name..." : "Game name..."
              }
              className="h-9 min-w-0 flex-1"
            />
            <Button
              variant="secondary"
              type="submit"
              disabled={!customName.trim()}
              className="h-9 shrink-0"
            >
              Add as Custom
            </Button>
          </form>
        ) : null}
      </div>
      {suggestionOpen ? (
        <div className="border-t border-border p-6">
          <CommunitySuggestionForm
            candidates={searchResults}
            exeName={exeName}
            hasMore={searchHasMore}
            message={searchMessage}
            search={searchQuery}
            selection={selection}
            state={searchState}
            isOffline={isOffline}
            onApplyCandidate={applyMetadataCandidate}
            onCancel={closeSuggestion}
            onLoadMore={loadMoreIgdb}
            onSearch={searchIgdb}
            onSearchChange={(value) => {
              setSearchQuery(value);
              setSelection(null);
              setSearchResults([]);
              setSearchHasMore(false);
              setSearchNextOffset(0);
              setSearchMessage("");
            }}
            onSearchOptionsChange={() => {
              setSelection(null);
              setSearchResults([]);
              setSearchHasMore(false);
              setSearchNextOffset(0);
              setSearchMessage("");
            }}
            onSubmit={() => void submitCommunitySuggestion()}
          />
        </div>
      ) : null}
    </section>
  );
}

function notifyNegativeReportOutcome(
  exeName: string,
  outcome: NegativeReportOutcome,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
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
  if (outcome.report === "failed" || outcome.report === "skipped") {
    addToast({
      tone: "info",
      title: "Fixed on this PC",
      detail: "The community report could not be sent.",
    });
    return;
  }
  addToast({
    tone: "success",
    title: "Wrong match reported",
    detail:
      outcome.report === "already_reviewed"
        ? `${exeName} is no longer tracked here. Your earlier report was already reviewed.`
        : `${exeName} is no longer tracked here. Your report is queued for review.`,
  });
}

function notifyDismissOutcome(
  exeName: string,
  outcome: LocalProcessIgnoreOutcome,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
  if (!outcome.localBlockApplied) {
    addToast({
      tone: "error",
      title: `Could not ignore ${exeName}`,
      detail: "PlayCounter could not ignore it on this PC. Try again.",
    });
    return;
  }
  addToast({
    tone: outcome.ignoreFileUpdated ? "success" : "info",
    title: `${exeName} ignored`,
    detail: outcome.ignoreFileUpdated
      ? "Only on this PC. Nothing was reported."
      : "It comes back when you restart PlayCounter - the ignore file could not be saved.",
  });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function GameCandidateButton({
  exeName,
  game,
}: {
  exeName: string;
  game: Game;
}) {
  const addToast = useAppStore((state) => state.addToast);

  return (
    <button
      type="button"
      aria-label={`Track ${exeName} as ${game.name}`}
      onClick={() => {
        selectAmbiguousMatch(exeName, game);
        addToast({
          tone: "success",
          title: "Match selected",
          detail: `${exeName} will be tracked as ${game.name}.`,
        });
      }}
      className="flex min-w-0 gap-3 rounded-lg border border-border bg-surface p-3 text-left transition hover:border-accent hover:bg-surface-hover"
    >
      {game.coverUrl ? (
        <img
          src={game.coverUrl}
          alt=""
          className="h-20 w-14 shrink-0 rounded bg-surface-hover object-contain"
        />
      ) : (
        <div className="h-20 w-14 shrink-0 rounded bg-surface-hover" />
      )}
      <div className="min-w-0">
        <div className="truncate font-semibold text-text">{game.name}</div>
        <div className="mt-2">
          <SourceBadge source={game.source} />
        </div>
        <div className="mt-3 text-xs font-semibold text-accent">
          Select this game
        </div>
      </div>
    </button>
  );
}
