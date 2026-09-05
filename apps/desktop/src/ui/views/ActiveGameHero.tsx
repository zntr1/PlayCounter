import type { GameDetails, Session } from "@playcounter/shared";
import { Flag, Gamepad2 } from "lucide-react";
import { useGameDetails } from "../../gameDetails";
import { gameSecondsKeys } from "../../gameSeconds";
import { GameCover } from "../GameCover";
import {
  adjustmentSecondsFor,
  effectiveTotalSeconds,
} from "../../playtimeAdjustments";
import {
  resolvedCanonicalGameKey,
  type ActiveSession,
  type ExeCacheEntry,
  type GameIdentityResolver,
} from "../../store";
import {
  CommunityApprovalBadge,
  SourceBadge,
  formatDuration,
} from "../components";
import { Button } from "../primitives";

type ActiveGameHeroProps = {
  session: ActiveSession;
  elapsedSeconds: number;
  recentSessions: Session[];
  showDurationDays: boolean;
  exeCache: ReadonlyMap<string, ExeCacheEntry>;
  resolveIgdbId: GameIdentityResolver;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  providerFloorSeconds?: number;
  statusLabel: "Now playing" | "Now emulating";
  onReport?: () => void;
  tourAnchor?: string;
};

/* The hero ───────────────────────────────────────────────────────────────────
   One game, one running clock. The cover sets the mood: it is painted large,
   and blurred again behind everything so the whole card takes on the game's
   palette. The session timer is the only big number; lifetime totals sit
   beside it in a smaller voice. */

export function ActiveGameHero({
  session,
  elapsedSeconds,
  recentSessions,
  showDurationDays,
  exeCache,
  resolveIgdbId,
  archivedGameSeconds,
  playtimeAdjustments,
  providerFloorSeconds = 0,
  statusLabel,
  onReport,
  tourAnchor,
}: ActiveGameHeroProps) {
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
  const lifetimeSeconds = effectiveTotalSeconds(
    recordedSeconds,
    adjustmentSecondsFor(playtimeAdjustments, keys),
    providerFloorSeconds,
  );
  const lifetimeSessionCount = priorSessions.length + 1;
  const canReport =
    Boolean(onReport) &&
    (session.source === "igdb" || session.source === "community");
  // Decoration from IGDB, fetched once per game and shown only when it lands.
  // Loading, offline and "no entry" all leave the line empty on purpose.
  const details = useGameDetails(session.igdbId);
  const facts =
    details.status === "ready" ? igdbFactsLine(details.details) : null;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-raised"
      data-tour={tourAnchor}
    >
      {session.coverUrl ? (
        <div aria-hidden className="absolute inset-0">
          <GameCover
            src={session.coverUrl}
            alt=""
            className="hero-backdrop h-full w-full scale-125 object-cover blur-3xl saturate-150"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/85 to-surface/40" />
        </div>
      ) : null}

      <div className="relative grid gap-7 p-6 sm:grid-cols-[200px_minmax(0,1fr)]">
        {session.coverUrl ? (
          <GameCover
            src={session.coverUrl}
            alt=""
            loading="eager"
            className="aspect-[3/4] w-full rounded-xl bg-surface-hover object-cover shadow-card-hover ring-1 ring-white/10"
          />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center rounded-xl bg-surface-hover text-text-faint ring-1 ring-white/10">
            <Gamepad2 size={36} />
          </div>
        )}

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-success-border bg-success-tint px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              {statusLabel}
            </div>
            {canReport ? (
              <Button
                variant="ghost"
                icon={Flag}
                aria-label={`Report wrong match for ${session.gameName}`}
                title="Report wrong match"
                onClick={onReport}
                className="-mr-2 -mt-1 text-text-faint hover:bg-warning-tint hover:text-warning"
              >
                Wrong game?
              </Button>
            ) : null}
          </div>

          <h2
            className="mt-3 line-clamp-2 break-words text-4xl font-bold leading-tight text-text"
            title={session.gameName}
          >
            {session.gameName}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
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
              <span className="truncate rounded-md border border-border/60 bg-surface-hover/50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-text-muted">
                {exeNames.join(", ")}
              </span>
            )}
          </div>

          <div className="mt-2 min-h-5 truncate text-sm text-text-muted">
            {facts}
          </div>

          <div className="mt-auto flex flex-wrap items-end gap-x-10 gap-y-4 pt-7">
            <div>
              <FigureLabel>This session</FigureLabel>
              <div className="mt-1 font-mono text-5xl font-semibold leading-none tabular-nums tracking-tight text-accent">
                {formatClock(elapsedSeconds)}
              </div>
            </div>
            <div aria-hidden className="hidden h-12 w-px bg-border sm:block" />
            <Figure
              label="Total playtime"
              value={formatDuration(lifetimeSeconds, showDurationDays)}
            />
            <Figure label="Sessions" value={String(lifetimeSessionCount)} />
          </div>
        </div>
      </div>
    </section>
  );
}

function FigureLabel({ children }: { children: string }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
      {children}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FigureLabel>{label}</FigureLabel>
      <div className="mt-1 font-mono text-2xl font-semibold leading-none tabular-nums text-text">
        {value}
      </div>
    </div>
  );
}

// "2020 · Action, Role-playing" - both parts optional.
function igdbFactsLine(details: GameDetails) {
  const parts = [
    details.releaseYear?.toString() ??
      (details.releaseDate ? details.releaseDate.slice(0, 4) : null),
    details.genres.length > 0 ? details.genres.slice(0, 3).join(", ") : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
