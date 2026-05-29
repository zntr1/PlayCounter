import { useEffect, useState } from "react";
import clsx from "clsx";
import { Activity, Trophy, LayoutGrid, List, WifiOff } from "lucide-react";
import { useAppStore, useIsOffline } from "../../store";
import { startLiveFeed, stopLiveFeed } from "../../tracker";
import { SourceBadge } from "../components";
import { AnimatedCount, IconButton } from "../primitives";
import type { LiveEntry } from "@playcounter/shared";

export function LiveFeedView() {
  const liveEntries = useAppStore((state) => state.liveEntries);
  const isOffline = useIsOffline();
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  useEffect(() => {
    if (isOffline) return;
    startLiveFeed();
    return () => stopLiveFeed();
  }, [isOffline]);

  const top3 = [liveEntries[1], liveEntries[0], liveEntries[2]].filter(Boolean);
  const remaining = liveEntries.slice(3);

  return (
    <div className="grid gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-3 text-2xl font-bold text-text">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
            </span>
            Global Live Activity
          </h2>
          <p className="mt-1 text-text-muted">
            See what the community is playing right now.
          </p>
        </div>
      </div>

      {isOffline ? (
        <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
          <div className="max-w-sm">
            <WifiOff
              className="mx-auto mb-4 text-text-muted opacity-80"
              size={48}
            />
            <h3 className="mb-2 text-lg font-medium text-text">
              Live feed paused
            </h3>
            <p className="text-text-muted">
              PlayCounter is offline. Local tracking continues. The feed will resume when you reconnect.
            </p>
          </div>
        </div>
      ) : liveEntries.length >= 3 ? (
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3 sm:gap-6">
          {top3.map((entry, idx) => {
            if (!entry) return null;
            // idx 0 -> Rank 2, idx 1 -> Rank 1, idx 2 -> Rank 3
            const rank = idx === 0 ? 2 : idx === 1 ? 1 : 3;
            const isFirst = rank === 1;

            return (
              <div
                key={`${entry.source ?? "unknown"}:${entry.gameId}`}
                className={clsx(
                  "animate-fade-in relative flex flex-col rounded-2xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-raised",
                  isFirst
                    ? "z-10 border-accent bg-accent/5 shadow-[0_0_20px_rgba(139,140,255,0.15)] sm:-mt-8 sm:scale-105"
                    : "border-border bg-surface",
                )}
              >
                {/* Background Blur Effect */}
                {entry.coverUrl && (
                  <div
                    className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
                    aria-hidden="true"
                  >
                    <img
                      src={entry.coverUrl}
                      className="h-full w-full object-cover opacity-20 blur-xl saturate-150"
                      alt=""
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/90 to-transparent" />
                  </div>
                )}

                <div className="relative p-5 text-center">
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
                    <div
                      className={clsx(
                        "grid h-8 w-8 place-items-center rounded-full border-2 border-surface font-bold shadow-md",
                        isFirst
                          ? "bg-accent text-accent-fg"
                          : "bg-surface-hover text-text",
                      )}
                    >
                      {rank}
                    </div>
                  </div>

                  <div className="mx-auto mt-4 aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-lg shadow-raised">
                    {entry.coverUrl ? (
                      <img
                        src={entry.coverUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-110"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-surface-hover">
                        <Trophy
                          className="text-text-faint opacity-50"
                          size={32}
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-col items-center">
                    <h3 className="line-clamp-2 min-h-[40px] font-bold leading-tight text-text">
                      {entry.name}
                    </h3>
                    <div className="mt-2">
                      <SourceBadge source={entry.source} />
                    </div>
                    <div className="mt-4 flex items-center justify-center gap-2 rounded-full bg-surface-hover/80 px-4 py-1.5 backdrop-blur">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                      </span>
                      <span className="font-mono text-lg font-bold tabular-nums text-text">
                        <AnimatedCount value={entry.playerCount} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Remaining Leaderboard */}
      {!isOffline && (remaining.length > 0 || liveEntries.length > 0) ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-semibold text-text">More Activity</h3>
            <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={clsx(
                  "grid h-7 w-7 place-items-center rounded transition",
                  viewMode === "list"
                    ? "bg-surface-hover text-text"
                    : "text-text-faint hover:text-text-muted",
                )}
                title="List view"
              >
                <List size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={clsx(
                  "grid h-7 w-7 place-items-center rounded transition",
                  viewMode === "grid"
                    ? "bg-surface-hover text-text"
                    : "text-text-faint hover:text-text-muted",
                )}
                title="Grid view"
              >
                <LayoutGrid size={14} />
              </button>
            </div>
          </div>

          <div
            className={clsx(
              viewMode === "grid"
                ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                : "flex flex-col divide-y divide-border rounded-xl border border-border bg-surface",
            )}
          >
            {(liveEntries.length < 3 ? liveEntries : remaining).map(
              (entry, idx) => {
                const rank = liveEntries.length < 3 ? idx + 1 : idx + 4;

                if (viewMode === "list") {
                  return (
                    <div
                      key={`${entry.source ?? "unknown"}:${entry.gameId}`}
                      className="group flex animate-fade-in items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-hover"
                    >
                      <div className="flex w-6 shrink-0 justify-center font-mono text-sm font-bold text-text-faint group-hover:text-text-muted">
                        #{rank}
                      </div>

                      {entry.coverUrl ? (
                        <img
                          src={entry.coverUrl}
                          alt=""
                          className="h-12 w-9 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-12 w-9 shrink-0 rounded bg-surface-hover" />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-text">
                          {entry.name}
                        </div>
                        <div className="mt-0.5">
                          <SourceBadge source={entry.source} />
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-xs uppercase tracking-wider text-text-faint">
                          Players
                        </div>
                        <div className="font-mono text-lg font-bold tabular-nums text-text">
                          <AnimatedCount value={entry.playerCount} />
                        </div>
                      </div>
                    </div>
                  );
                }

                // Grid view
                return (
                  <div
                    key={`${entry.source ?? "unknown"}:${entry.gameId}`}
                    className="group flex animate-fade-in items-center gap-4 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <div className="flex w-6 shrink-0 justify-center font-mono text-sm font-bold text-text-faint group-hover:text-text-muted">
                      #{rank}
                    </div>

                    {entry.coverUrl ? (
                      <img
                        src={entry.coverUrl}
                        alt=""
                        className="h-16 w-12 shrink-0 rounded-md object-cover shadow-sm"
                      />
                    ) : (
                      <div className="h-16 w-12 shrink-0 rounded-md bg-surface-hover" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-text">
                        {entry.name}
                      </div>
                      <div className="mt-1">
                        <SourceBadge source={entry.source} />
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end pr-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                        Players
                      </div>
                      <div className="font-mono text-lg font-bold tabular-nums text-text">
                        <AnimatedCount value={entry.playerCount} />
                      </div>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </div>
      ) : !isOffline ? (
        <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
          <div className="max-w-sm">
            <Activity
              className="mx-auto mb-4 text-text-faint opacity-50"
              size={48}
            />
            <h3 className="mb-2 text-lg font-medium text-text">
              Quiet right now
            </h3>
            <p className="text-text-muted">
              No live sessions are currently reported across the network. Start
              playing a game to appear here!
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
