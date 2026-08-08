import type { GameSource, Session } from "@playcounter/shared";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Filter,
  Timer,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { getSessionGameKey } from "../../../historyStats";
import { useAppStore, type Toast } from "../../../store";
import { removeHistorySession } from "../../../tracker";
import {
  CommunityApprovalBadge,
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
    : `${startTime} – next day`;
}

export const HistorySessionRow = memo(function HistorySessionRow({
  session,
  metadata,
  selectedGameKey,
  onFilterGame,
  onClearGameFilter,
  addToast,
}: {
  session: Session;
  metadata?: HistoryRowMetadata;
  selectedGameKey: string | null;
  onFilterGame: (key: string, name: string) => void;
  onClearGameFilter: () => void;
  addToast: (toast: Omit<Toast, "id">) => void;
}) {
  const contextMenu = useContextMenu();
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
  const source = session.source ?? metadata?.source;
  const gameName =
    session.gameName ??
    metadata?.gameName ??
    session.exeName.replace(/\.exe$/i, "");
  const coverUrl = session.coverUrl ?? metadata?.coverUrl;
  const gameKey = getSessionGameKey(session);
  const isActiveGameFilter = selectedGameKey === gameKey;

  function handleRemove() {
    removeHistorySession(session.id);
    addToast({
      tone: "success",
      title: "Session removed",
      detail: `${gameName} was removed from history.`,
    });
    contextMenu.close();
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
      onContextMenu={(event) => {
        cancelFilterHold();
        contextMenu.props.onContextMenu(event);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelFilterHold}
      onPointerCancel={cancelFilterHold}
      onLostPointerCapture={cancelFilterHold}
      className="group relative grid animate-fade-in grid-cols-[auto_minmax(0,1fr)_auto] gap-4 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-accent/40 hover:shadow-raised"
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
              className="text-accent [grid-area:1/1]"
            />
          ) : (
            <Filter
              size={14}
              strokeWidth={2.75}
              className="text-accent [grid-area:1/1]"
            />
          )}
        </span>
      ) : null}

      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-[52px] w-10 shrink-0 rounded object-cover shadow-sm"
        />
      ) : (
        <div className="grid h-[52px] w-10 shrink-0 place-items-center rounded bg-surface-hover text-text-faint shadow-sm">
          <Timer size={16} />
        </div>
      )}
      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-base font-bold text-text">{gameName}</h3>
          <SourceBadge source={source} />
          <CommunityApprovalBadge
            suggestionId={
              session.communitySuggestionId ?? metadata?.communitySuggestionId
            }
            verified={
              session.communitySuggestionVerified ??
              metadata?.communitySuggestionVerified
            }
          />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-muted">
          <span className="truncate">{session.exeName}</span>
          <span className="h-1 w-1 shrink-0 rounded-full bg-border" />
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <CalendarDays size={13} className="text-text-faint" />
            {formatSessionDate(session.startedAt)}
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Clock3 size={13} className="text-text-faint" />
            {formatTimeRange(session.startedAt, session.endedAt)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
            Playtime
          </div>
          <div className="font-mono text-[15px] font-bold text-accent">
            {formatDuration(session.durationSeconds ?? 0, showDurationDays)}
          </div>
        </div>
        <IconButton
          icon={Trash2}
          intent="danger"
          aria-label={`Remove history entry for ${gameName}`}
          onClick={handleRemove}
          className="hidden opacity-0 transition-opacity group-hover:grid group-hover:opacity-100"
        />
      </div>
      <ContextMenu
        open={contextMenu.open}
        position={contextMenu.position}
        onClose={contextMenu.close}
      >
        <ContextMenuItem icon={Filter} onClick={handleFilterForGame}>
          Filter for this game
        </ContextMenuItem>
        <ContextMenuItem icon={Trash2} danger onClick={handleRemove}>
          Delete Session
        </ContextMenuItem>
      </ContextMenu>
    </article>
  );
});
