import { Crown, Timer } from "lucide-react";
import type { TopGame } from "../../historyStats";
import { formatDuration } from "../components";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";

const podiumStyles = [
  {
    card: "border-amber-300/70 bg-gradient-to-b from-amber-300/20 via-amber-400/[0.07] to-transparent shadow-[0_0_24px_rgb(251_191_36/0.12)]",
    cover: "h-24 w-16 ring-2 ring-amber-300/80",
    badge: "bg-amber-300 text-amber-950",
    bar: "bg-amber-300",
    pedestal:
      "top-game-pedestal-1 h-14 border-amber-300/60 bg-gradient-to-b from-amber-300/30 to-amber-500/10 text-amber-200 shadow-[inset_0_2px_0_rgb(253_230_138/0.35)]",
  },
  {
    card: "border-slate-300/55 bg-gradient-to-b from-slate-200/15 via-slate-300/[0.05] to-transparent",
    cover: "h-20 w-14 ring-2 ring-slate-300/65",
    badge: "bg-slate-300 text-slate-950",
    bar: "bg-slate-300",
    pedestal:
      "top-game-pedestal-2 h-10 border-slate-300/50 bg-gradient-to-b from-slate-200/20 to-slate-400/10 text-slate-200",
  },
  {
    card: "border-orange-400/55 bg-gradient-to-b from-orange-400/15 via-orange-500/[0.05] to-transparent",
    cover: "h-20 w-14 ring-2 ring-orange-400/65",
    badge: "bg-orange-400 text-orange-950",
    bar: "bg-orange-400",
    pedestal:
      "top-game-pedestal-3 h-8 border-orange-400/50 bg-gradient-to-b from-orange-400/20 to-orange-600/10 text-orange-300",
  },
] as const;

type RankedGame = { game: TopGame; rank: number };

export function TopGamesBars({
  games,
  showDurationDays,
  onSelectGame,
}: {
  games: TopGame[];
  showDurationDays: boolean;
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
              maxSeconds={maxSeconds}
              showDurationDays={showDurationDays}
              onSelectGame={onSelectGame}
            />
          ))}
        </div>
      ) : null}

      {listGames.length > 0 ? (
        <div className="mt-3 grid gap-1 border-t border-border/60 pt-2">
          {listGames.map(({ game, rank }) => (
            <ListGame
              key={game.key ?? "other"}
              game={game}
              rank={rank}
              maxSeconds={maxSeconds}
              showDurationDays={showDurationDays}
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
  maxSeconds,
  showDurationDays,
  onSelectGame,
}: {
  game: TopGame & { key: string };
  rank: number;
  maxSeconds: number;
  showDurationDays: boolean;
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
        className={`group flex min-w-0 flex-col items-center rounded-t-xl border p-3 text-center transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${style.card}`}
        onClick={() => onSelectGame(game.key, game.name)}
      >
        {rank === 0 ? (
          <Crown
            aria-hidden="true"
            size={25}
            className="mb-2 fill-amber-300/30 text-amber-300 drop-shadow-[0_0_8px_rgb(252_211_77/0.55)]"
          />
        ) : (
          <div className="h-[25px]" aria-hidden="true" />
        )}
        <span className="relative">
          <GameCover game={game} className={style.cover} />
          <span
            aria-hidden="true"
            className={`absolute -bottom-2 -right-2 grid h-6 min-w-6 place-items-center rounded-full px-1.5 font-mono text-xs font-black shadow-raised ${style.badge}`}
          >
            {rank + 1}
          </span>
        </span>
        <span className="mt-3 w-full truncate text-sm font-bold text-text">
          {game.name}
        </span>
        <span className="mt-1 font-mono text-xs font-semibold text-text-muted">
          {formatDuration(game.seconds, showDurationDays)} ·{" "}
          {Math.round(game.share * 100)}%
        </span>
        <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
          <span
            className={`block h-full rounded-full ${style.bar}`}
            style={{ width: `${(game.seconds / maxSeconds) * 100}%` }}
          />
        </span>
      </button>
      <div
        aria-hidden="true"
        className={`grid place-items-center rounded-b-lg border-x border-b font-mono text-xl font-black ${style.pedestal}`}
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
  onSelectGame,
  onOtherEnter,
  onOtherLeave,
}: {
  game: TopGame;
  rank: number;
  maxSeconds: number;
  showDurationDays: boolean;
  onSelectGame: (key: string, name: string) => void;
  onOtherEnter: (element: HTMLElement) => void;
  onOtherLeave: () => void;
}) {
  const content = (
    <>
      <span className="text-center font-mono text-[11px] font-bold text-text-faint">
        {game.key ? rank + 1 : "-"}
      </span>
      <GameCover game={game} className="h-6 w-5" />
      <span className="min-w-0">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-semibold text-text">
            {game.name}
          </span>
          <span className="shrink-0 font-mono text-xs font-semibold text-text-muted">
            {formatDuration(game.seconds, showDurationDays)} ·{" "}
            {Math.round(game.share * 100)}%
          </span>
        </span>
        <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-surface-hover">
          <span
            className="block h-full rounded-full bg-accent/60"
            style={{ width: `${(game.seconds / maxSeconds) * 100}%` }}
          />
        </span>
      </span>
    </>
  );
  const className =
    "grid w-full grid-cols-[18px_20px_minmax(0,1fr)] items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
    <img
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
