import { Crown, Timer } from "lucide-react";
import type { TopGame } from "../../historyStats";
import { formatDuration } from "../components";
import { GameCover as LibraryCover } from "../GameCover";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";

const podiumStyles = [
  {
    card: "border-amber-300/70 bg-gradient-to-b from-amber-300/25 via-amber-400/10 to-amber-500/5 shadow-[0_0_28px_rgb(251_191_36/0.16)]",
    cover: "h-32 w-[90px] ring-2 ring-amber-300/80",
    badge: "bg-amber-300 text-amber-950",
    stat: "top-game-stat-1 text-amber-200",
    pill: "bg-amber-300/20 text-amber-200",
    pedestal:
      "top-game-pedestal-1 h-10 border-amber-300/60 bg-gradient-to-b from-amber-300/30 to-amber-500/10 text-amber-200 shadow-[inset_0_2px_0_rgb(253_230_138/0.35)]",
  },
  {
    card: "border-slate-300/55 bg-gradient-to-b from-slate-200/20 via-slate-300/[0.07] to-slate-400/5",
    cover: "h-28 w-20 ring-2 ring-slate-300/65",
    badge: "bg-slate-300 text-slate-950",
    stat: "top-game-stat-2 text-slate-100",
    pill: "bg-slate-300/20 text-slate-200",
    pedestal:
      "top-game-pedestal-2 h-7 border-slate-300/50 bg-gradient-to-b from-slate-200/20 to-slate-400/10 text-slate-200",
  },
  {
    card: "border-orange-400/55 bg-gradient-to-b from-orange-400/20 via-orange-500/[0.07] to-orange-600/5",
    cover: "h-28 w-20 ring-2 ring-orange-400/65",
    badge: "bg-orange-400 text-orange-950",
    stat: "top-game-stat-3 text-orange-200",
    pill: "bg-orange-400/20 text-orange-200",
    pedestal:
      "top-game-pedestal-3 h-5 border-orange-400/50 bg-gradient-to-b from-orange-400/20 to-orange-600/10 text-orange-300",
  },
] as const;

type RankedGame = { game: TopGame; rank: number };

function formatLastPlayed(lastPlayedMs: number, nowMs: number) {
  if (!lastPlayedMs) return "";
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const day = new Date(lastPlayedMs);
  day.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return day.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(day.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function TopGamesBars({
  games,
  showDurationDays,
  nowMs,
  onSelectGame,
}: {
  games: TopGame[];
  showDurationDays: boolean;
  nowMs: number;
  onSelectGame: (key: string, name: string) => void;
}) {
  const tooltip = useChartTooltip();
  const maxSeconds = Math.max(1, ...games.map((game) => game.seconds));
  const podiumGames = games
    .slice(0, 3)
    .map((game, rank) => ({ game, rank }))
    .filter(
      (entry): entry is RankedGame & { game: TopGame & { key: string } } =>
        Boolean(entry.game.key),
    );
  const podiumKeys = new Set(podiumGames.map(({ game }) => game.key));
  const listGames = games
    .map((game, rank) => ({ game, rank }))
    .filter(({ game }) => !game.key || !podiumKeys.has(game.key));

  return (
    <figure aria-labelledby="top-games-title">
      <figcaption id="top-games-title" className="sr-only">
        Games ranked by playtime
      </figcaption>

      {podiumGames.length > 0 ? (
        <div className="grid grid-cols-3 items-end gap-3 pt-3">
          {podiumGames.map(({ game, rank }) => (
            <PodiumGame
              key={game.key}
              game={game}
              rank={rank}
              showDurationDays={showDurationDays}
              lastPlayed={formatLastPlayed(game.lastPlayedMs, nowMs)}
              onSelectGame={onSelectGame}
            />
          ))}
        </div>
      ) : null}

      {listGames.length > 0 ? (
        <div className="mt-4 grid gap-0.5">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[36px_40px_minmax(0,1fr)_120px_110px] gap-3 px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-text-faint sm:grid"
          >
            <span />
            <span />
            <span>Game</span>
            <span className="text-right">Sessions</span>
            <span className="text-right">Last played</span>
          </div>
          {listGames.map(({ game, rank }) => (
            <ListGame
              key={game.key ?? "other"}
              game={game}
              rank={rank}
              maxSeconds={maxSeconds}
              showDurationDays={showDurationDays}
              lastPlayed={formatLastPlayed(game.lastPlayedMs, nowMs)}
              recent={
                game.lastPlayedMs > 0 &&
                nowMs - game.lastPlayedMs < 7 * 86_400_000
              }
              onSelectGame={onSelectGame}
              onOtherEnter={(element) =>
                tooltip.show(
                  element,
                  <div>
                    <div className="mb-1 font-semibold">Other games</div>
                    <div className="text-text-muted">
                      {game.otherGameNames?.join(", ")}
                    </div>
                  </div>,
                )
              }
              onOtherLeave={tooltip.hide}
            />
          ))}
        </div>
      ) : null}

      <ChartTooltip state={tooltip.state} onClose={tooltip.hide} />
    </figure>
  );
}

function PodiumGame({
  game,
  rank,
  showDurationDays,
  lastPlayed,
  onSelectGame,
}: {
  game: TopGame & { key: string };
  rank: number;
  showDurationDays: boolean;
  lastPlayed: string;
  onSelectGame: (key: string, name: string) => void;
}) {
  const style = podiumStyles[rank];
  const gridColumn = rank === 0 ? 2 : rank === 1 ? 1 : 3;
  return (
    <div
      className="flex min-w-0 flex-col justify-end"
      style={{ gridColumn, gridRow: 1 }}
    >
      <button
        type="button"
        aria-label={`Rank ${rank + 1}: ${game.name}`}
        className={`group relative flex min-w-0 flex-col items-center overflow-hidden rounded-t-xl border px-3 pb-4 pt-3 text-center transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${style.card}`}
        onClick={() => onSelectGame(game.key, game.name)}
      >
        {game.coverUrl ? (
          <img
            aria-hidden="true"
            alt=""
            src={game.coverUrl}
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover opacity-40 blur-2xl saturate-150 transition-opacity group-hover:opacity-55"
          />
        ) : null}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-surface/10 via-surface/55 to-surface/90"
        />
        <span className="relative flex min-w-0 w-full flex-col items-center">
          {rank === 0 ? (
            <Crown
              aria-hidden="true"
              size={25}
              className="mb-2 fill-amber-300/30 text-amber-300 drop-shadow-[0_0_8px_rgb(252_211_77/0.55)]"
            />
          ) : null}
          <span className="relative">
            <GameCover
              game={game}
              className={`shadow-[0_12px_28px_rgb(0_0_0/0.45)] ${style.cover}`}
            />
            <span
              aria-hidden="true"
              className={`absolute -bottom-2 -right-2 grid h-6 min-w-6 place-items-center rounded-full px-1.5 font-mono text-xs font-black shadow-raised ${style.badge}`}
            >
              {rank + 1}
            </span>
          </span>
          <span className="mt-4 w-full truncate text-sm font-bold text-text">
            {game.name}
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <span
              className={`font-mono text-xl font-black tabular-nums ${style.stat}`}
            >
              {formatDuration(game.seconds, showDurationDays)}
            </span>
            <span
              className={`rounded-full px-1.5 py-px font-mono text-[10px] font-bold tabular-nums ${style.pill}`}
            >
              {Math.round(game.share * 100)}%
            </span>
          </span>
          <span className="mt-1.5 text-[11px] text-text-muted">
            {game.sessionCount}{" "}
            {game.sessionCount === 1 ? "session" : "sessions"}
            {lastPlayed ? ` · ${lastPlayed}` : ""}
          </span>
        </span>
      </button>
      <div
        aria-hidden="true"
        className={`grid place-items-center rounded-b-lg border-x border-b font-mono text-base font-black ${style.pedestal}`}
      >
        {rank + 1}
      </div>
    </div>
  );
}

function ListGame({
  game,
  rank,
  maxSeconds,
  showDurationDays,
  lastPlayed,
  recent,
  onSelectGame,
  onOtherEnter,
  onOtherLeave,
}: {
  game: TopGame;
  rank: number;
  maxSeconds: number;
  showDurationDays: boolean;
  lastPlayed: string;
  recent: boolean;
  onSelectGame: (key: string, name: string) => void;
  onOtherEnter: (element: HTMLElement) => void;
  onOtherLeave: () => void;
}) {
  const average =
    game.sessionCount > 0 ? Math.round(game.seconds / game.sessionCount) : 0;
  const content = (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-accent/[0.16] via-accent/[0.08] to-accent/[0.02]"
        style={{ width: `${(game.seconds / maxSeconds) * 100}%` }}
      />
      <span className="relative text-center font-mono text-lg font-black tabular-nums text-text-faint/70">
        {game.key ? rank + 1 : "–"}
      </span>
      <GameCover game={game} className="relative h-14 w-10" />
      <span className="relative min-w-0">
        <span className="block truncate text-sm font-bold text-text">
          {game.name}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold tabular-nums text-text">
            {formatDuration(game.seconds, showDurationDays)}
          </span>
          <span className="rounded-full bg-accent/15 px-1.5 py-px font-mono text-[10px] font-bold tabular-nums text-accent">
            {Math.round(game.share * 100)}%
          </span>
        </span>
      </span>
      <span className="relative hidden text-right sm:block">
        <span className="block font-mono text-[13px] font-semibold tabular-nums text-text">
          {game.sessionCount}{" "}
          <span className="font-sans text-[11px] font-medium text-text-muted">
            {game.sessionCount === 1 ? "session" : "sessions"}
          </span>
        </span>
        <span className="block text-[11px] text-text-faint">
          avg {formatDuration(average, showDurationDays)}
        </span>
      </span>
      <span className="relative hidden items-center justify-end gap-2 text-right text-xs text-text-muted sm:flex">
        {lastPlayed}
        {lastPlayed ? (
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              recent
                ? "bg-success shadow-[0_0_6px_rgb(var(--color-success)/0.7)]"
                : "bg-text-faint/40"
            }`}
          />
        ) : null}
      </span>
    </>
  );
  const className =
    "relative grid w-full grid-cols-[36px_40px_minmax(0,1fr)] items-center gap-3 overflow-hidden rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:grid-cols-[36px_40px_minmax(0,1fr)_120px_110px]";

  return game.key ? (
    <button
      type="button"
      className={className}
      onClick={() => onSelectGame(game.key!, game.name)}
    >
      {content}
    </button>
  ) : (
    <div
      className={className}
      onPointerEnter={(event) => onOtherEnter(event.currentTarget)}
      onPointerLeave={onOtherLeave}
    >
      {content}
    </div>
  );
}

function GameCover({ game, className }: { game: TopGame; className: string }) {
  return game.coverUrl ? (
    <LibraryCover
      src={game.coverUrl}
      alt=""
      loading="lazy"
      className={`rounded object-cover shadow-raised ${className}`}
    />
  ) : (
    <span
      className={`grid place-items-center rounded bg-surface-hover text-text-faint shadow-sm ${className}`}
    >
      <Timer size={13} />
    </span>
  );
}
