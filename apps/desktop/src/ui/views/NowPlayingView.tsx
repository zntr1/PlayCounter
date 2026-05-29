import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  CommunityMetadataSearchResponse,
  Game,
  Session,
} from "@playcounter/shared";
import { useAppStore, useIsOffline, type ActiveSession } from "../../store";
import {
  dismissAmbiguousMatch,
  selectAmbiguousCommunitySuggestion,
  selectAmbiguousMatch,
} from "../../tracker";
import {
  CommunityApprovalBadge,
  Panel,
  SourceBadge,
  formatDuration,
} from "../components";
import { Button } from "../primitives";
import { CommunitySuggestionForm } from "./DiscoveredView";

export function NowPlayingView() {
  const activeSessions = useAppStore((state) => state.activeSessions);
  const ambiguousMatches = useAppStore((state) => state.ambiguousMatches);
  const recentSessions = useAppStore((state) => state.recentSessions);
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
          />
        );
      })}
      {activeSessions.map((activeSession) => (
        <HeroSession
          key={`${activeSession.gameId}:${activeSession.exeName.toLowerCase()}`}
          session={activeSession}
          elapsedSeconds={Math.max(
            0,
            Math.floor((now - Date.parse(activeSession.startedAt)) / 1000),
          )}
          recentSessions={recentSessions}
        />
      ))}
    </div>
  );
}

function HeroSession({
  session,
  elapsedSeconds,
  recentSessions,
}: {
  session: ActiveSession;
  elapsedSeconds: number;
  recentSessions: Session[];
}) {
  const priorSessions = recentSessions.filter(
    (entry) =>
      entry.gameId === session.gameId && entry.source === session.source,
  );
  const lifetimeSeconds =
    priorSessions.reduce(
      (sum, entry) => sum + (entry.durationSeconds ?? 0),
      0,
    ) + elapsedSeconds;
  const lifetimeSessionCount = priorSessions.length + 1;

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-raised">
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
            <SourceBadge source={session.source} />
            {session.source === "custom" ? (
              <CommunityApprovalBadge
                suggestionId={session.communitySuggestionId}
                verified={session.communitySuggestionVerified}
              />
            ) : null}
            <span className="truncate rounded-md border border-border/60 bg-surface-hover/50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-text-muted drop-shadow-sm">
              {session.exeName}
            </span>
          </div>

          <div className="mt-auto grid grid-cols-3 gap-3 pt-6">
            <HeroStat
              label="Current session"
              value={formatClock(elapsedSeconds)}
              accent
            />
            <HeroStat
              label="Total playtime"
              value={formatDuration(lifetimeSeconds)}
            />
            <HeroStat label="Sessions" value={String(lifetimeSessionCount)} />
          </div>
        </div>
      </div>
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

function AmbiguousMatchCard({
  exeName,
  candidates,
  elapsedSeconds,
  ended,
}: {
  exeName: string;
  candidates: Game[];
  elapsedSeconds: number;
  ended: boolean;
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
  const [selection, setSelection] = useState<CommunityMetadataCandidate | null>(
    null,
  );
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("idle");
  const [searchMessage, setSearchMessage] = useState("");

  async function searchIgdb() {
    const query = searchQuery.trim();
    if (query.length < 2 || isOffline) return;

    setSearchState("loading");
    setSearchMessage("");
    setSearchResults([]);
    try {
      const response = await fetch(
        `${apiEndpoint}/api/community/metadata?query=${encodeURIComponent(query)}`,
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      const body = (await response.json()) as CommunityMetadataSearchResponse;
      setSearchResults(body.candidates);
      setSearchMessage(
        body.candidates.length > 0
          ? "Select the game you launched. PlayCounter will track it locally while the community match is reviewed."
          : "No matching games found.",
      );
      setSearchState("idle");
    } catch (error) {
      setSearchState("error");
      setSearchMessage(error instanceof Error ? error.message : String(error));
    }
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
          installUuid: installUuid ?? undefined,
        }),
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const result = (await response.json()) as CommunityGameSuggestionResponse;
      selectAmbiguousCommunitySuggestion(
        exeName,
        selection.name,
        selection.coverUrl,
        result.id,
        result.verified,
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
        detail: `${exeName} is now tracked locally while approval is pending.`,
      });
    } catch (error) {
      setSearchState("error");
      setSearchMessage(formatError(error));
    }
  }

  function closeSuggestion() {
    setSuggestionOpen(false);
    setSelection(null);
    setSearchState("idle");
    setSearchMessage("");
  }

  return (
    <section className="relative overflow-hidden rounded-xl border border-warning-border bg-surface shadow-raised">
      <div className="p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-warning-border bg-warning-tint px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-warning">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
              Choose a match
            </div>
            <h2 className="truncate text-3xl font-bold text-text">
              Which game did you launch?
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <span className="truncate rounded-md border border-border/60 bg-surface-hover/50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-text-muted drop-shadow-sm">
                {exeName}
              </span>
              <span className="text-sm text-text-muted">
                has multiple possible matches. Choose the game you opened to{" "}
                {ended ? "save this time" : "start tracking"}.
              </span>
            </div>
            {ended ? (
              <p className="mt-3 text-sm text-warning">
                The app has closed, but this time can still be saved once you
                choose the right game.
              </p>
            ) : null}

            <div className="mt-6 inline-block">
              <HeroStat
                label={ended ? "Time to save" : "Waiting to assign"}
                value={formatClock(elapsedSeconds)}
                accent
              />
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              void dismissAmbiguousMatch(exeName)
                .then(() =>
                  addToast({
                    tone: "success",
                    title: "Process ignored",
                    detail: `${exeName} was added to your ignored process list.`,
                  }),
                )
                .catch((error) =>
                  addToast({
                    tone: "error",
                    title: "Could not ignore process",
                    detail: formatError(error),
                  }),
                )
            }
          >
            Ignore app
          </Button>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-text-faint">
            Possible matches
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((game) => (
              <GameCandidateButton
                key={game.id}
                exeName={exeName}
                game={game}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col justify-between gap-4 rounded-lg border border-border bg-surface-hover/30 p-4 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-medium text-text">
              Game not listed?
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Search for another game, add it locally, and send the executable
              match for community review.
            </p>
          </div>
          <Button
            variant="primary"
            disabled={isOffline}
            title={
              isOffline ? "Database search unavailable offline" : undefined
            }
            onClick={() => {
              setSuggestionOpen(true);
              setSearchMessage("");
            }}
          >
            Find another game
          </Button>
        </div>
      </div>
      {suggestionOpen ? (
        <div className="border-t border-border p-6">
          <CommunitySuggestionForm
            candidates={searchResults}
            exeName={exeName}
            message={searchMessage}
            search={searchQuery}
            selection={selection}
            state={searchState}
            isOffline={isOffline}
            onApplyCandidate={applyMetadataCandidate}
            onCancel={closeSuggestion}
            onSearch={searchIgdb}
            onSearchChange={(value) => {
              setSearchQuery(value);
              setSelection(null);
            }}
            onSubmit={() => void submitCommunitySuggestion()}
          />
        </div>
      ) : null}
    </section>
  );
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
      </div>
    </button>
  );
}
