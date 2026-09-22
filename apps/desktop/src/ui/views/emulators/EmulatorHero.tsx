import type { GameSource } from "@playcounter/shared";
import clsx from "clsx";
import { Gamepad2, Play, Radio } from "lucide-react";
import { useGameDetails } from "../../../gameDetails";
import { emulatorAssetUrls } from "../../../emulators/assets";
import { customHeroArtKey, useAppStore } from "../../../store";
import { formatDuration } from "../../components";
import { heroArtwork } from "../../GameBanner";
import { GameCover } from "../../GameCover";
import { Button } from "../../primitives";

/* The emulator hero: what this emulator is, how much has been played in it,
   and the games that carried that time. The most played game's key art sits
   behind it, the way the History hero does it. */

export type EmulatorTopGame = {
  key: string;
  gameId: number;
  igdbId?: number;
  source?: GameSource | null;
  name: string;
  coverUrl?: string;
  seconds: number;
  sessions: number;
};

export type EmulatorStartControl = {
  visible: boolean;
  disabled: boolean;
  loading: boolean;
  reason?: string;
  onClick?: () => void;
};

export function EmulatorHero({
  emulatorId,
  label,
  hostNames,
  playtimeSeconds,
  sessionCount,
  gameCount,
  ignoredCount,
  runningCount,
  lastPlayedMs,
  showDurationDays,
  topGames,
  start,
}: {
  emulatorId: string;
  label: string;
  hostNames: string[];
  playtimeSeconds: number;
  sessionCount: number;
  gameCount: number;
  ignoredCount: number;
  runningCount: number;
  lastPlayedMs: number | null;
  showDurationDays: boolean;
  topGames: EmulatorTopGame[];
  start: EmulatorStartControl;
}) {
  const lead = topGames[0] ?? null;
  const details = useGameDetails(lead?.igdbId);
  const pickedArt = useAppStore((state) =>
    lead ? state.customHeroArt[customHeroArtKey(lead)] : undefined,
  );
  const wideArt = heroArtwork(
    pickedArt,
    details.status === "ready" ? details.details : null,
  );
  // Without wide art the portrait cover stands in, blurred into a colour
  // wash, never stretched as a photo.
  const artwork = wideArt ?? lead?.coverUrl ?? null;
  const coverOnly = !wideArt && artwork !== null;
  const logo = emulatorAssetUrls[emulatorId];
  const hasSessions = sessionCount > 0;
  const running = runningCount > 0;

  return (
    <section
      aria-label={`${label} summary`}
      className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-raised"
    >
      {artwork ? (
        <img
          src={artwork}
          alt=""
          aria-hidden="true"
          className={clsx(
            // The History hero's art treatment: fade in, wash on the left.
            "history-hero-art pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_30%]",
            coverOnly && "scale-125 blur-3xl saturate-150",
          )}
        />
      ) : null}
      <div
        aria-hidden="true"
        className={clsx(
          "pointer-events-none absolute inset-0",
          artwork ? "history-hero-shade" : "history-hero-glow",
        )}
      />
      <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-8 lg:p-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
              {logo ? (
                <img
                  src={logo}
                  alt=""
                  aria-hidden="true"
                  className="h-5 w-5 rounded object-cover ring-1 ring-white/10"
                />
              ) : (
                <Gamepad2 aria-hidden="true" size={12} />
              )}
              {label}
            </p>
            <p
              className="truncate font-mono text-[11px] text-text-faint"
              title={hostNames.join(", ")}
            >
              {hostNames.join(", ")}
            </p>
          </div>

          {hasSessions ? (
            <>
              <h1 className="mt-2 font-serif text-[34px] font-normal leading-[1.1] tracking-tight text-text drop-shadow-md [text-wrap:balance] sm:text-[42px]">
                <span className="font-mono font-bold tracking-tighter">
                  {formatDuration(playtimeSeconds, showDurationDays)}
                </span>{" "}
                played
                <br />
                in {sessionCount} session{sessionCount === 1 ? "" : "s"}
              </h1>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                <Fact
                  value={String(gameCount)}
                  unit={gameCount === 1 ? "game" : "games"}
                />
                {lastPlayedMs !== null ? (
                  <Fact
                    label="last played"
                    value={new Date(lastPlayedMs).toLocaleDateString([], {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  />
                ) : null}
                {ignoredCount > 0 ? (
                  <Fact label="ignored" value={String(ignoredCount)} />
                ) : null}
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-2 font-serif text-[34px] font-normal leading-[1.1] tracking-tight text-text sm:text-[42px]">
                Nothing played yet
              </h1>
              <p className="mt-3 text-sm text-text-muted">
                Start a game in {label}. PlayCounter recognizes it and the
                playtime lands here.
              </p>
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {start.visible ? (
              <Button
                variant="primary"
                icon={Play}
                disabled={start.disabled || start.loading}
                loading={start.loading}
                title={start.reason}
                onClick={start.onClick}
                className="h-10 rounded-lg px-5 font-semibold shadow-sm"
              >
                Start game
              </Button>
            ) : null}
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                running
                  ? "border-success-border bg-success-tint text-success"
                  : "border-border bg-bg/50 text-text-faint",
              )}
            >
              <Radio
                aria-hidden="true"
                size={12}
                className={running ? "animate-pulse" : undefined}
              />
              {running
                ? `${runningCount} game${runningCount === 1 ? "" : "s"} running`
                : "Nothing running"}
            </span>
          </div>
        </div>

        {topGames.length > 0 ? (
          <div className="min-w-0 border-t border-border/70 pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-text-faint">
              Most played
            </h2>
            <ol className="mt-3 grid gap-2.5">
              {topGames.map((game, index) => (
                <li key={game.key} className="flex min-w-0 items-center gap-3">
                  <span className="w-4 shrink-0 text-center font-mono text-xs font-semibold tabular-nums text-text-faint">
                    {index + 1}
                  </span>
                  {game.coverUrl ? (
                    <GameCover
                      src={game.coverUrl}
                      alt=""
                      className="h-12 w-9 shrink-0 rounded object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <span className="grid h-12 w-9 shrink-0 place-items-center rounded bg-surface-hover text-text-faint">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">
                      {game.name}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      <span className="font-mono font-semibold text-text">
                        {formatDuration(game.seconds, showDurationDays)}
                      </span>{" "}
                      in {game.sessions} session{game.sessions === 1 ? "" : "s"}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  unit,
}: {
  label?: string;
  value: string;
  unit?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {label ? <span>{label}</span> : null}
      <span className="font-mono font-semibold text-text">{value}</span>
      {unit ? <span>{unit}</span> : null}
    </span>
  );
}
