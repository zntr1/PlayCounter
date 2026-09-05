import { AlertTriangle, Gamepad2, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
  type ActiveSession,
  type ExeCacheEntry,
} from "../../store";
import {
  applyKnownGameMatch,
  markCommunitySuggestionRejected,
  reportNegativeMatch,
  suggestTrackedGameToCommunity,
} from "../../tracker";
import { Panel } from "../components";
import { Button } from "../primitives";
import { ReportWrongMatchDialog } from "../ReportWrongMatchDialog";
import { TOUR_DEMO_GAME } from "../tour/tourDemoGame";
import { findTour } from "../tour/tourDefinitions";
import { CommunitySuggestionForm } from "./DiscoveredView";
import { ActiveGameHero } from "./ActiveGameHero";
import {
  AmbiguousMatchCard,
  notifyNegativeReportOutcome,
} from "./nowPlaying/AmbiguousMatchCard";
import { useCommunityGameCorrection } from "./nowPlaying/useCommunityGameCorrection";
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
        <Panel className="grid min-h-[360px] place-items-center rounded-2xl p-8 text-center">
          <div className="max-w-md">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-border bg-surface-hover text-text-faint">
              <Gamepad2 size={28} />
            </div>
            <h2 className="text-2xl font-semibold text-text">
              No game detected
            </h2>
            <p className="mt-2 text-text-muted">
              Start a game and it will appear here automatically.
            </p>
            <Button
              variant="ghost"
              icon={ListChecks}
              onClick={() => setActiveView("discovered")}
              className="mt-5"
            >
              Game not showing up? Review unmatched processes
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-5">
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
                  Needs your call
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
                    exePath={match.exePath}
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

// "Wrong game?" on a tracked session: pick the right one from the database
// and apply it to the executable.
function TrackedGameCorrectionDialog({
  exeName,
  onClose,
}: {
  exeName: string;
  onClose: () => void;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const correction = useCommunityGameCorrection({
    exeName,
    onKnownGame: (game) => {
      applyKnownGameMatch(exeName, game);
      onClose();
      addToast({
        tone: "success",
        title: "Correct match applied",
        detail: `${exeName} is now tracked as ${game.name}.`,
      });
    },
    onRejected: (id, reviewNote, { selection }) => {
      suggestTrackedGameToCommunity(
        exeName,
        selection.name,
        selection.coverUrl,
        id,
        false,
        selection.igdbId,
      );
      markCommunitySuggestionRejected(exeName, reviewNote);
      onClose();
      addToast({
        tone: "info",
        title: "Suggestion already reviewed",
        detail: reviewNote ?? "This suggestion was not accepted.",
      });
    },
    onSuggested: (id, verified, { selection }) => {
      suggestTrackedGameToCommunity(
        exeName,
        selection.name,
        selection.coverUrl,
        id,
        verified,
        selection.igdbId,
      );
      onClose();
      addToast({
        tone: "success",
        title: "Correct game submitted",
        detail: `${exeName} now uses ${selection.name} while the community match is reviewed.`,
      });
    },
  });

  return (
    <CommunitySuggestionForm
      candidates={correction.candidates}
      exeName={exeName}
      hasMore={correction.hasMore}
      message={correction.message}
      search={correction.search}
      selection={correction.selection}
      state={correction.state}
      title="Choose the correct game"
      isOffline={correction.isOffline}
      onApplyCandidate={correction.applyCandidate}
      onCancel={onClose}
      onLoadMore={(options) => void correction.loadMore(options)}
      onSearch={(options) => void correction.searchFirstPage(options)}
      onSearchChange={correction.setSearch}
      onSearchOptionsChange={correction.resetResults}
      onSubmit={() => void correction.submit()}
    />
  );
}
