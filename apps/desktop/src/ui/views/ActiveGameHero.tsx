import type { Session } from "@playcounter/shared";
import { Flag, Gamepad2 } from "lucide-react";
import { gameSecondsKeys } from "../../gameSeconds";
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
import { IconButton } from "../primitives";

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

  return (
    <section
      className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-raised"
      data-tour={tourAnchor}
    >
      {canReport ? (
        <IconButton
          icon={Flag}
          aria-label={`Report wrong match for ${session.gameName}`}
          title="Report wrong match"
          onClick={onReport}
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
            {statusLabel}
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
