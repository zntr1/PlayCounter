import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Flag,
  Gamepad2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  CommunityMetadataSearchResponse,
  Game,
  IdentifierFlagReason,
  Session,
} from "@playcounter/shared";
import {
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
  useIsOffline,
  type ActiveSession,
  type ExeCacheEntry,
  type GameIdentityResolver,
  type Toast,
} from "../../store";
import {
  dismissAmbiguousMatch,
  markCommunitySuggestionRejected,
  reportNegativeMatch,
  selectAmbiguousCommunitySuggestion,
  selectAmbiguousCustomGame,
  selectAmbiguousMatch,
  type LocalProcessIgnoreOutcome,
  type NegativeReportOutcome,
} from "../../tracker";
import { gameSecondsKeys } from "../../gameSeconds";
import {
  communityMetadataSearchUrl,
  mergeCommunityMetadataCandidates,
} from "../../communityMetadataSearch";
import {
  adjustmentSecondsFor,
  displayTotalSeconds,
} from "../../playtimeAdjustments";
import {
  CommunityApprovalBadge,
  Panel,
  SourceBadge,
  formatDuration,
} from "../components";
import { Button, IconButton, Input } from "../primitives";
import { ReportWrongMatchDialog } from "../ReportWrongMatchDialog";
import { CommunitySuggestionForm } from "./DiscoveredView";

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
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(gameMetadata, exeCache),
    [exeCache, gameMetadata],
  );
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [now, setNow] = useState(() => Date.now());
  const hasActivity = activeSessions.length > 0 || ambiguousMatches.length > 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!hasActivity) {
    return (
      <Panel className="grid min-h-[360px] place-items-center p-8 text-center">
        <div>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full border border-border bg-surface-hover text-text-faint">
            <Gamepad2 size={28} />
          </div>
          <h2 className="text-2xl font-semibold text-text">No game detected</h2>
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
    );
  }

  return (
    <div className="grid gap-4">
      {activeSessions.map((activeSession) => (
        <HeroSession
          key={resolvedCanonicalGameKey(activeSession, resolveIgdbId)}
          session={activeSession}
          elapsedSeconds={Math.max(
            0,
            Math.floor((now - Date.parse(activeSession.startedAt)) / 1000),
          )}
          recentSessions={recentSessions}
          showDurationDays={showDurationDays}
          exeCache={exeCache}
          resolveIgdbId={resolveIgdbId}
          archivedGameSeconds={archivedGameSeconds}
          playtimeAdjustments={playtimeAdjustments}
        />
      ))}
      {ambiguousMatches.length > 0 ? (
        <section className="grid gap-3">
          <div className="flex items-center gap-2 px-1 pt-1">
            <AlertTriangle size={14} className="shrink-0 text-warning" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">
              Needs your input
            </h3>
            <span className="rounded-full border border-warning-border bg-warning-tint px-1.5 text-[11px] font-semibold tabular-nums text-warning">
              {ambiguousMatches.length}
            </span>
          </div>
          {ambiguousMatches.map((match) => {
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
  );
}

function HeroSession({
  session,
  elapsedSeconds,
  recentSessions,
  showDurationDays,
  exeCache,
  resolveIgdbId,
  archivedGameSeconds,
  playtimeAdjustments,
}: {
  session: ActiveSession;
  elapsedSeconds: number;
  recentSessions: Session[];
  showDurationDays: boolean;
  exeCache: ReadonlyMap<string, ExeCacheEntry>;
  resolveIgdbId: GameIdentityResolver;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [reportOpen, setReportOpen] = useState(false);
  const sessionKey = resolvedCanonicalGameKey(session, resolveIgdbId);
  const priorSessions = recentSessions.filter(
    (entry) => resolvedCanonicalGameKey(entry, resolveIgdbId) === sessionKey,
  );
  const matchingEntries = [...exeCache.values()].filter(
    (entry) =>
      entry.state === "matched" &&
      entry.gameId !== undefined &&
      resolvedCanonicalGameKey(
        {
          gameId: entry.gameId,
          source: entry.source,
          igdbId: entry.igdbId,
          gameName: entry.gameName,
          coverUrl: entry.coverUrl,
        },
        resolveIgdbId,
      ) === sessionKey,
  );
  const sources = [
    ...new Set(
      [session.source, ...matchingEntries.map((entry) => entry.source)].filter(
        (source): source is NonNullable<typeof source> => Boolean(source),
      ),
    ),
  ].sort((left, right) => {
    const rank = (source: string) =>
      source === "igdb" ? 0 : source === "community" ? 1 : 2;
    return rank(left) - rank(right);
  });
  const suggestionEntry = matchingEntries.find(
    (entry) => entry.communitySuggestionId !== undefined,
  );
  const exeNames = [
    ...new Set([
      session.exeName,
      ...matchingEntries.map((entry) => entry.exeName),
    ]),
  ];
  const keys = gameSecondsKeys([
    { gameId: session.gameId, source: session.source },
    ...matchingEntries.map((entry) => ({
      gameId: entry.gameId!,
      source: entry.source,
    })),
    ...priorSessions.map((entry) => ({
      gameId: entry.gameId,
      source: entry.source,
    })),
  ]);
  const archivedSeconds = keys.reduce(
    (sum, key) => sum + Math.max(0, archivedGameSeconds[key] ?? 0),
    0,
  );
  const recordedSeconds =
    priorSessions.reduce(
      (sum, entry) => sum + (entry.durationSeconds ?? 0),
      0,
    ) +
    archivedSeconds +
    elapsedSeconds;
  const lifetimeSeconds = displayTotalSeconds(
    recordedSeconds,
    adjustmentSecondsFor(playtimeAdjustments, keys),
  );
  const lifetimeSessionCount = priorSessions.length + 1;
  const canReport = session.source === "igdb" || session.source === "community";

  async function handleNegativeReport() {
    setReportOpen(false);
    const outcome = await reportNegativeMatch(session.exeName);
    notifyNegativeReportOutcome(session.exeName, outcome, addToast);
  }

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-raised">
      {canReport ? (
        <IconButton
          icon={Flag}
          aria-label={`Report wrong match for ${session.gameName}`}
          title="Report wrong match"
          onClick={() => setReportOpen(true)}
          className="absolute right-4 top-4 z-30 bg-bg/90 text-text-muted shadow-raised hover:bg-warning hover:text-white"
        />
      ) : null}
      {session.coverUrl ? (
        <div aria-hidden className="absolute inset-0">
          <img
            src={session.coverUrl}
            alt=""
            className="h-full w-full scale-110 object-cover opacity-20 blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/85 to-surface/40" />
        </div>
      ) : null}

      <div className="relative grid gap-6 p-6 sm:grid-cols-[176px_minmax(0,1fr)]">
        {session.coverUrl ? (
          <img
            src={session.coverUrl}
            alt=""
            className="aspect-[3/4] w-full rounded-lg bg-surface-hover object-cover shadow-raised"
          />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center rounded-lg bg-surface-hover text-text-faint">
            <Gamepad2 size={32} />
          </div>
        )}

        <div className="flex min-w-0 flex-col">
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-success-border bg-success-tint px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Now playing
          </div>
          <h2 className="truncate text-3xl font-bold text-text">
            {session.gameName}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            {sources.map((source) => (
              <SourceBadge key={source} source={source} />
            ))}
            {sources.includes("custom") ? (
              <CommunityApprovalBadge
                suggestionId={
                  suggestionEntry?.communitySuggestionId ??
                  session.communitySuggestionId
                }
                verified={
                  suggestionEntry?.communitySuggestionVerified ??
                  session.communitySuggestionVerified
                }
                status={
                  suggestionEntry?.communitySuggestionStatus ??
                  session.communitySuggestionStatus
                }
              />
            ) : null}
            {session.emulator ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                {session.emulator.label} · {session.emulator.display}
              </span>
            ) : (
              <span className="truncate rounded-md border border-border/60 bg-surface-hover/50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-text-muted drop-shadow-sm">
                {exeNames.join(", ")}
              </span>
            )}
          </div>

          <div className="mt-auto grid grid-cols-3 gap-3 pt-6">
            <HeroStat
              label="Current session"
              value={formatClock(elapsedSeconds)}
              accent
            />
            <HeroStat
              label="Total playtime"
              value={formatDuration(lifetimeSeconds, showDurationDays)}
            />
            <HeroStat label="Sessions" value={String(lifetimeSessionCount)} />
          </div>
        </div>
      </div>
      {reportOpen ? (
        <ReportWrongMatchDialog
          exeName={session.exeName}
          onCancel={() => setReportOpen(false)}
          onDifferentGame={() => {
            setReportOpen(false);
            setActiveView("games");
            addToast({
              tone: "info",
              title: "Choose the correct match",
              detail:
                "Open this game's menu and choose Check for Matches, or suggest the correct game.",
            });
          }}
          onNotAGame={() => void handleNegativeReport()}
        />
      ) : null}
    </section>
  );
}

function HeroStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-text-faint">
        {label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-2xl font-semibold tabular-nums ${accent ? "text-accent" : "text-text"}`}
      >
        {value}
      </div>
    </div>
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
          ambiguousCandidatePriority(left) - ambiguousCandidatePriority(right),
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

  async function searchIgdbPage(offset: number, append: boolean) {
    const query = searchQuery.trim();
    if (query.length < 2 || isOffline) return;

    setSearchState(append ? "loading-more" : "loading");
    setSearchMessage("");
    if (!append) setSearchResults([]);
    try {
      const response = await fetch(
        communityMetadataSearchUrl(apiEndpoint, query, offset),
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

  function searchIgdb() {
    return searchIgdbPage(0, false);
  }

  function loadMoreIgdb() {
    if (!searchHasMore) return;
    return searchIgdbPage(searchNextOffset, true);
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
                ? ` — even though it still matches ${candidates[0].name}`
                : candidates.length > 1
                  ? ` — even though it still matches ${candidates.length} games`
                  : ""}
              .
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void handleNegativeReport()}
              >
                No, it&apos;s not a game
              </Button>
              {candidates.length > 0 ? (
                <Button
                  variant="secondary"
                  icon={candidatesExpanded ? ChevronUp : ChevronDown}
                  onClick={() => setCandidatesExpanded((open) => !open)}
                >
                  {candidatesExpanded
                    ? "Hide possible matches"
                    : "Yes, show me the matches"}
                </Button>
              ) : null}
            </div>
            <MatchMeta ended={ended} elapsedSeconds={elapsedSeconds} />
          </>
        ) : (
          <>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-warning-border bg-warning-tint px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-warning">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
              Choose a match
            </div>
            <h2 className="break-words text-2xl font-bold text-text">
              {candidates.length === 1
                ? `Did you launch ${candidates[0].name}?`
                : "Which game did you launch?"}
            </h2>
            <MatchMeta
              exeName={exeName}
              ended={ended}
              elapsedSeconds={elapsedSeconds}
              note={
                flagReason === "ambiguous"
                  ? "Shared executable name — PlayCounter will not pick for you"
                  : undefined
              }
            />
            {ended ? (
              <p className="mt-2 text-sm text-text-muted">
                {exeName} has closed. Pick the right game to save this time.
              </p>
            ) : null}
          </>
        )}

        {showCandidates ? (
          <div className="mt-5 border-t border-border pt-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-faint">
              {candidates.length === 1 ? "Possible match" : "Possible matches"}
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
          {!reportedNotAGame ? (
            <>
              <FooterAction
                emphasis
                title={`Report ${exeName} as a launcher, tool, system process or other non-game app. It stops being tracked here and the report is reviewed by the community.`}
                onClick={() => void handleNegativeReport()}
              >
                Not a game
              </FooterAction>
              <FooterSeparator />
            </>
          ) : null}
          {!isOffline ? (
            <>
              <FooterAction
                title="Search the database for the game this executable belongs to and send the match for community review."
                onClick={() => {
                  setSuggestionOpen(true);
                  setSearchMessage("");
                }}
              >
                Search another game
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
                isOffline ? "Offline — add the game by name..." : "Game name..."
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
      title: "Could not block process",
      detail: `${exeName} could not be blocked on this PC.`,
    });
    return;
  }
  if (!outcome.ignoreFileUpdated) {
    addToast({
      tone: "error",
      title: "Process blocked locally",
      detail: `${exeName} will not be tracked, but the ignored-processes file could not be updated.`,
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
      title: "Could not ignore process",
      detail: `${exeName} could not be ignored on this PC.`,
    });
    return;
  }
  addToast({
    tone: outcome.ignoreFileUpdated ? "success" : "info",
    title: "Process dismissed",
    detail: outcome.ignoreFileUpdated
      ? `${exeName} was ignored on this PC. No community report was sent.`
      : `${exeName} is hidden locally, but the ignored-processes file could not be updated. No report was sent.`,
  });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ambiguousCandidatePriority(game: Game) {
  if (game.source === "community") return 0;
  if (game.source === "igdb") return 1;
  return 2;
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
