import type { GameSource, Session } from "@playcounter/shared";
import clsx from "clsx";
import {
  ArrowLeft,
  Filter,
  RotateCcw,
  Sparkles,
  Timer,
  StickyNote,
  BookOpen,
  Trash2,
  Trophy,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { getSessionGameKey, type SessionMarker } from "../../../historyStats";
import { emulatorSessionProvenance } from "../../../emulators/provenance";
import { GameCover } from "../../GameCover";
import { SessionPlaythroughPicker } from "../../GameJournalDialog";
import {
  useLibraryPractice,
  usePersonalLibraryApi,
} from "../../PersonalLibraryContext";
import { useAppStore, type GameIdentityResolver } from "../../../store";
import {
  CommunityApprovalBadge,
  EmulatorBadge,
  SourceBadge,
  formatDuration,
} from "../../components";
import {
  ContextMenu,
  ContextMenuItem,
  IconButton,
  useContextMenu,
} from "../../primitives";

const holdDurationMs = 750;
const holdRadius = 20;

export type HistoryRowMetadata = {
  gameName: string;
  coverUrl: string;
  source: GameSource | null;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
};

function formatSessionDate(startedAt: string) {
  return new Date(startedAt).toLocaleDateString();
}

function formatTimeRange(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt);
  const startTime = start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (!endedAt) return startTime;
  const end = new Date(endedAt);
  const endTime = end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return start.toDateString() === end.toDateString()
    ? `${startTime} – ${endTime}`
    : `${startTime} – ${endTime} next day`;
}

/* One session in the journal. The day column next to it carries the date, so
   the row only says when it ran and how long, with a bar against the longest
   session in view so a marathon reads at a glance. Markers call out the
   sessions worth noticing: firsts, records and comebacks. */
export const HistorySessionRow = memo(function HistorySessionRow({
  session,
  metadata,
  marker,
  maxSeconds = 0,
  showDate = false,
  resolveIgdbId,
  selectedGameKey,
  onFilterGame,
  onClearGameFilter,
  onRequestDelete,
}: {
  session: Session;
  metadata?: HistoryRowMetadata;
  marker?: SessionMarker;
  /** Longest session in view; the row's bar is relative to it. */
  maxSeconds?: number;
  showDate?: boolean;
  resolveIgdbId: GameIdentityResolver;
  selectedGameKey: string | null;
  onFilterGame: (key: string, name: string) => void;
  onClearGameFilter: () => void;
  onRequestDelete: (session: Session) => void;
}) {
  const contextMenu = useContextMenu();
  const libraryApi = usePersonalLibraryApi();
  const practice = useLibraryPractice();
  const rowRef = useRef<HTMLElement>(null);
  const holdRef = useRef<{
    pointerId: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [holdPosition, setHoldPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
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
  const source = session.emulator
    ? provenance.source
    : (session.source ?? metadata?.source);
  const gameName =
    session.gameName ??
    metadata?.gameName ??
    session.exeName.replace(/\.exe$/i, "");
  const coverUrl = session.coverUrl ?? metadata?.coverUrl;
  const gameKey = getSessionGameKey(session, resolveIgdbId);
  const isActiveGameFilter = selectedGameKey === gameKey;
  const seconds = session.durationSeconds ?? 0;
  const barWidth = `${Math.max(1.5, Math.min(100, (seconds / Math.max(1, maxSeconds, seconds)) * 100))}%`;

  function requestDelete() {
    contextMenu.close();
    onRequestDelete(session);
  }

  function handleFilterForGame() {
    onFilterGame(gameKey, gameName);
    contextMenu.close();
  }

  function cancelFilterHold() {
    const hold = holdRef.current;
    if (!hold) return;
    clearTimeout(hold.timer);
    holdRef.current = null;
    setHoldPosition(null);
    const row = rowRef.current;
    if (row?.hasPointerCapture(hold.pointerId)) {
      row.releasePointerCapture(hold.pointerId);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    if (
      (event.target as Element).closest(
        "button, a, input, select, textarea, [role='button']",
      )
    ) {
      return;
    }
    rowRef.current?.focus({ preventScroll: true });
    cancelFilterHold();
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setHoldPosition({
      x: Math.min(
        Math.max(event.clientX - bounds.left, holdRadius),
        bounds.width - holdRadius,
      ),
      y: Math.min(
        Math.max(event.clientY - bounds.top, holdRadius),
        bounds.height - holdRadius,
      ),
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    holdRef.current = {
      pointerId,
      timer: setTimeout(() => {
        if (holdRef.current?.pointerId !== pointerId) return;
        holdRef.current = null;
        setHoldPosition(null);
        if (isActiveGameFilter) onClearGameFilter();
        else onFilterGame(gameKey, gameName);
      }, holdDurationMs),
    };
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Delete" || event.key === "Del") {
      event.preventDefault();
      requestDelete();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    event.preventDefault();
    const timeline = event.currentTarget.closest("#session-timeline-body");
    const rows = timeline?.querySelectorAll<HTMLElement>(
      "[data-history-session-row]",
    );
    if (!rows) return;
    const currentIndex = [...rows].indexOf(event.currentTarget);
    if (currentIndex < 0) return;
    const nextIndex = Math.min(
      Math.max(currentIndex + (event.key === "ArrowDown" ? 1 : -1), 0),
      rows.length - 1,
    );
    const nextRow = rows[nextIndex];
    nextRow?.focus({ preventScroll: true });
    nextRow?.scrollIntoView({ block: "nearest" });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const hold = holdRef.current;
    if (!hold || hold.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      cancelFilterHold();
    }
  }

  useEffect(
    () => () => {
      if (holdRef.current) clearTimeout(holdRef.current.timer);
    },
    [],
  );

  return (
    <article
      ref={rowRef}
      tabIndex={0}
      data-history-session-row
      data-history-session-id={session.id}
      aria-label={`${gameName}, session on ${formatSessionDate(session.startedAt)}`}
      onContextMenu={(event) => {
        cancelFilterHold();
        contextMenu.props.onContextMenu(event);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelFilterHold}
      onPointerCancel={cancelFilterHold}
      onLostPointerCapture={cancelFilterHold}
      onKeyDown={handleKeyDown}
      className="group relative grid animate-fade-in grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-border bg-surface px-3 py-2.5 outline-none transition hover:border-accent/40 hover:shadow-raised focus:border-accent/60 focus:ring-2 focus:ring-accent/40 sm:grid-cols-[auto_minmax(0,1fr)_minmax(150px,190px)_auto] sm:gap-4"
    >
      {holdPosition ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute z-10 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface/95 shadow-raised"
          style={{ left: holdPosition.x, top: holdPosition.y }}
        >
          <svg
            className="h-8 w-8 -rotate-90 [grid-area:1/1]"
            viewBox="0 0 24 24"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="rgb(var(--color-border))"
              strokeWidth="2.5"
            />
            <circle
              className="history-filter-hold-progress"
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="rgb(var(--color-accent))"
              strokeLinecap="round"
              strokeWidth="2.5"
            />
          </svg>
          {isActiveGameFilter ? (
            <ArrowLeft
              size={15}
              strokeWidth={2.75}
              className="text-accent-ink [grid-area:1/1]"
            />
          ) : (
            <Filter
              size={14}
              strokeWidth={2.75}
              className="text-accent-ink [grid-area:1/1]"
            />
          )}
        </span>
      ) : null}

      {coverUrl ? (
        <GameCover
          src={coverUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-[58px] w-11 shrink-0 rounded-md object-cover shadow-sm"
        />
      ) : (
        <div className="grid h-[58px] w-11 shrink-0 place-items-center rounded-md bg-surface-hover text-text-faint shadow-sm">
          <Timer size={16} />
        </div>
      )}
      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-[15px] font-bold leading-tight text-text">
            {gameName}
          </h3>
          <span className="flex h-[21px] w-[21px] shrink-0 items-center justify-center [&>*]:scale-[0.8]">
            <SourceBadge
              source={source}
              variant="mark"
              approval={session.emulator ? provenance.approval : undefined}
              emulator={Boolean(session.emulator)}
            />
          </span>
          {session.emulator ? (
            <EmulatorBadge
              emulatorId={session.emulator.emulatorId}
              label={session.emulator.label}
            />
          ) : null}
          {!session.emulator && source === "custom" ? (
            <CommunityApprovalBadge
              suggestionId={
                session.communitySuggestionId ?? metadata?.communitySuggestionId
              }
              verified={
                session.communitySuggestionVerified ??
                metadata?.communitySuggestionVerified
              }
            />
          ) : null}
          <SessionPlaythroughPicker session={session} compact />
          {marker?.longest ? (
            <MarkerTag tone="record" icon={Trophy}>
              Longest session
            </MarkerTag>
          ) : marker?.gameRecord ? (
            <MarkerTag tone="record" icon={Trophy}>
              Personal best
            </MarkerTag>
          ) : null}
          {marker?.first ? (
            <MarkerTag tone="first" icon={Sparkles}>
              First session
            </MarkerTag>
          ) : null}
          {marker?.comebackDays ? (
            <MarkerTag tone="first" icon={RotateCcw}>
              Back after {marker.comebackDays} days
            </MarkerTag>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-text-muted">
          {showDate ? (
            <>
              <span className="whitespace-nowrap">
                {formatSessionDate(session.startedAt)}
              </span>
              <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-border" />
            </>
          ) : null}
          <span className="whitespace-nowrap tabular-nums">
            {formatTimeRange(session.startedAt, session.endedAt)}
          </span>
          <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-border" />
          <span className="truncate text-text-faint">
            {session.emulator
              ? `${session.emulator.label} · ${session.emulator.display}`
              : session.exeName}
          </span>
          {session.origin === "manual" ? (
            <span
              title="Entered manually"
              className="rounded-full border border-border bg-surface-hover px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-text-muted"
            >
              Manual
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 text-right">
        <div className="font-mono text-[15px] font-bold leading-none tabular-nums text-accent-ink">
          {formatDuration(seconds, showDurationDays)}
        </div>
        <div
          aria-hidden="true"
          className="mt-1.5 hidden h-1 overflow-hidden rounded-full bg-surface-hover sm:block"
        >
          <span
            className="block h-full rounded-full bg-gradient-to-r from-accent/50 to-accent"
            style={{ width: barWidth }}
          />
        </div>
      </div>
      <IconButton
        icon={Trash2}
        intent="danger"
        aria-label={`Remove history entry for ${gameName}`}
        onClick={requestDelete}
        className="hidden opacity-0 transition-opacity group-hover:grid group-hover:opacity-100 group-focus-within:grid group-focus-within:opacity-100"
      />
      <ContextMenu
        dataTour={practice ? "demo-library-menu" : undefined}
        open={contextMenu.open}
        position={contextMenu.position}
        onClose={contextMenu.close}
      >
        <ContextMenuItem
          icon={StickyNote}
          onClick={() => {
            contextMenu.close();
            libraryApi.getState().openGameJournal({
              game: { ...session, gameName },
              tab: "note",
              playthroughId: session.playthroughId ?? null,
            });
          }}
        >
          Update note
        </ContextMenuItem>
        <ContextMenuItem
          icon={BookOpen}
          onClick={() => {
            contextMenu.close();
            libraryApi.getState().openGameJournal({
              game: { ...session, gameName },
              tab: "playthroughs",
              playthroughId: session.playthroughId ?? null,
            });
          }}
        >
          Playthroughs
        </ContextMenuItem>
        <ContextMenuItem icon={Filter} onClick={handleFilterForGame}>
          Filter for this game
        </ContextMenuItem>
        <ContextMenuItem icon={Trash2} danger onClick={requestDelete}>
          Delete Session
        </ContextMenuItem>
      </ContextMenu>
    </article>
  );
});

function MarkerTag({
  tone,
  icon: Icon,
  children,
}: {
  tone: "record" | "first";
  icon: typeof Trophy;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em]",
        tone === "record"
          ? "bg-accent/15 text-accent-ink"
          : "bg-info/15 text-info",
      )}
    >
      <Icon aria-hidden="true" size={9} />
      {children}
    </span>
  );
}
