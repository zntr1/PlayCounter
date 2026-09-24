import type { GameDetails, Session } from "@playcounter/shared";
import {
  BarChart3,
  BookOpen,
  Clock3,
  Flag,
  Gamepad2,
  Play,
  StickyNote,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useGameDetails } from "../../gameDetails";
import { emulatorSessionProvenance } from "../../emulators/provenance";
import { gameSecondsKeys } from "../../gameSeconds";
import { GameCover } from "../GameCover";
import {
  adjustmentSecondsFor,
  effectiveTotalSeconds,
} from "../../playtimeAdjustments";
import {
  resolvedCanonicalGameKey,
  useAppStore,
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
import { SessionPlaythroughPicker } from "../GameJournalDialog";
import { notePreview } from "../journalStyles";
import { useGameJournal } from "../useGameJournal";
import {
  defaultPlaythroughTime,
  journalNote,
  playthroughSeconds,
} from "../../personalLibrary";

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
  const journal = useGameJournal(session);
  const provenance = useAppStore(
    useShallow((state) =>
      emulatorSessionProvenance(
        session,
        session.emulator
          ? state.emulatorMappings.get(session.emulator.contentKey)
          : undefined,
      ),
    ),
  );
  const openJournal = useAppStore((s) => s.openGameJournal);
  const archivedPlaythroughSeconds = useAppStore(
    (s) => s.archivedPlaythroughSeconds,
  );
  const playthrough = journal.playthroughs.find(
    (p) => p.id === session.playthroughId,
  );
  const activeNote = journalNote(journal, session.playthroughId ?? null);
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
      (session.emulator
        ? [provenance.source]
        : [session.source, ...matchingEntries.map((entry) => entry.source)]
      ).filter((source): source is NonNullable<typeof source> =>
        Boolean(source),
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
  const facts = details.status === "ready" ? igdbFacts(details.details) : [];

  const summary =
    details.status === "ready" ? details.details.summary : undefined;
  const playthroughTime = formatDuration(
    (playthrough
      ? playthroughSeconds(
          playthrough.id,
          recentSessions,
          archivedPlaythroughSeconds,
        )
      : defaultPlaythroughTime(
          journal,
          priorSessions,
          archivedSeconds,
          archivedPlaythroughSeconds,
        ).seconds) + elapsedSeconds,
    showDurationDays,
  );

  return (
    <section
      className="active-hero relative overflow-hidden rounded-2xl border border-border/60 shadow-raised"
      data-tour={tourAnchor}
    >
      <div className="relative grid gap-8 p-7 sm:grid-cols-[250px_minmax(0,1fr)]">
        {session.coverUrl ? (
          <GameCover
            src={session.coverUrl}
            alt=""
            loading="eager"
            highRes
            className="aspect-[3/4] w-full rounded-xl bg-surface-hover object-cover shadow-card-hover ring-1 ring-white/10"
          />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center rounded-xl bg-surface-hover text-text-faint ring-1 ring-white/10">
            <Gamepad2 size={36} />
          </div>
        )}

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-lg border border-success-border/70 bg-success-tint/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-success">
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
                className="rounded-lg border border-border/60 bg-bg/40 text-text-muted backdrop-blur hover:border-warning-border hover:bg-warning-tint hover:text-warning"
              >
                Something wrong?
              </Button>
            ) : null}
          </div>

          <h2
            className="mt-4 line-clamp-2 break-words font-serif text-[40px] font-bold leading-[1.08] tracking-tight text-text drop-shadow-md"
            title={session.gameName}
          >
            {session.gameName}
          </h2>
          {facts.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center text-[15px] text-text-muted">
              {facts.map((part, index) => (
                <span key={part} className="flex items-center">
                  {index > 0 ? (
                    <span
                      aria-hidden="true"
                      className="mx-3 h-4 w-px bg-border"
                    />
                  ) : null}
                  {part}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SessionPlaythroughPicker session={session} />
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-bg/40 px-3 text-sm text-text-muted backdrop-blur">
              <Clock3 size={15} className="text-text-faint" />
              <span className="font-mono font-semibold tabular-nums text-text">
                {playthroughTime}
              </span>
              this playthrough
            </span>
            <Button
              variant="secondary"
              icon={BookOpen}
              onClick={() =>
                openJournal({
                  game: session,
                  tab: "playthroughs",
                  playthroughId: session.playthroughId ?? null,
                })
              }
              className="h-9 rounded-lg border-border/70 bg-bg/40 backdrop-blur"
            >
              Journal
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {sources.map((source) => (
              <SourceBadge
                key={source}
                source={source}
                approval={session.emulator ? provenance.approval : undefined}
                emulator={Boolean(session.emulator)}
              />
            ))}
            {!session.emulator && sources.includes("custom") ? (
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
              <span className="rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-ink">
                {session.emulator.label} · {session.emulator.display}
              </span>
            ) : (
              <span className="truncate rounded-lg border border-border/60 bg-bg/40 px-2.5 py-1 font-mono text-[12px] font-medium tracking-wide text-text-muted backdrop-blur">
                {exeNames.join(", ")}
              </span>
            )}
          </div>

          {/* The note answers "where did I leave off?", so the hero answers it
              without asking for a click first. */}
          {activeNote ? (
            <button
              type="button"
              title="Open this note"
              onClick={() =>
                openJournal({
                  game: session,
                  tab: "note",
                  playthroughId: session.playthroughId ?? null,
                })
              }
              className="mt-4 inline-flex max-w-xl items-start gap-2 self-start rounded-lg border border-border/70 bg-bg/40 px-3 py-2 text-left text-sm text-text-muted backdrop-blur transition hover:border-accent/50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <StickyNote size={14} className="mt-0.5 shrink-0 text-accent-ink" />
              <span className="truncate">{notePreview(activeNote)}</span>
            </button>
          ) : summary ? (
            <p className="mt-4 line-clamp-2 max-w-xl text-[15px] leading-6 text-text/80">
              {summary}
            </p>
          ) : null}
        </div>
      </div>

      <div className="active-hero-figures relative mx-7 mb-7 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border/60 rounded-xl border border-border/60">
        <div className="px-6 py-4">
          <FigureLabel icon={Play}>This session</FigureLabel>
          <div className="mt-1.5 font-mono text-[44px] font-bold leading-none tabular-nums tracking-tight text-accent-ink drop-shadow-[0_0_18px_rgb(var(--color-accent)/0.35)]">
            {formatClock(elapsedSeconds)}
          </div>
        </div>
        <div className="px-6 py-4">
          <FigureLabel icon={Clock3}>Total playtime</FigureLabel>
          <div className="mt-2.5 font-mono text-[34px] font-bold leading-none tabular-nums text-text">
            {formatDuration(lifetimeSeconds, showDurationDays)}
          </div>
        </div>
        <div className="px-6 py-4">
          <FigureLabel icon={BarChart3}>Sessions</FigureLabel>
          <div className="mt-2.5 font-mono text-[34px] font-bold leading-none tabular-nums text-text">
            {lifetimeSessionCount}
          </div>
        </div>
      </div>
    </section>
  );
}

function FigureLabel({
  icon: Icon,
  children,
}: {
  icon: typeof Play;
  children: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
      <Icon size={14} className="text-accent-ink" />
      {children}
    </div>
  );
}

// ["2020", "Action", "Role-playing"] - year and up to two genres, all optional.
function igdbFacts(details: GameDetails) {
  return [
    details.releaseYear?.toString() ??
      (details.releaseDate ? details.releaseDate.slice(0, 4) : null),
    ...details.genres.slice(0, 2),
  ].filter((part): part is string => Boolean(part));
}

export function formatClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
