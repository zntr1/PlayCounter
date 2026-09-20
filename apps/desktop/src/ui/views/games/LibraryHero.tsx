import clsx from "clsx";
import {
  History,
  Info,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  Star,
  EyeOff,
} from "lucide-react";
import { useState } from "react";
import { useGameDetails } from "../../../gameDetails";
import { useAppStore } from "../../../store";
import { formatDuration } from "../../components";
import { GameCover } from "../../GameCover";
import {
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  useAnchoredMenu,
} from "../../primitives";
import { useGameJournal } from "../../useGameJournal";
import { GameDetailsDialog } from "./GameDetailsDialog";
import { useHeroLauncher } from "./useHeroLauncher";
import type { GameSummary } from "../MyGamesView";

/* The banner above the library: one game, big. Wide IGDB artwork when the
   API has it, the game's own cover blown up and blurred when it does not, so
   a community game without IGDB art still gets a banner instead of a gap. */

type LibraryHeroProps = {
  game: GameSummary;
  pinned: boolean;
  showDurationDays: boolean;
  launchKey: string;
  launchBlocked: boolean;
  onAcquireLaunch: (key: string) => boolean;
  onReleaseLaunch: (key: string) => void;
  onPin: () => void;
  onUnpin: () => void;
  onHide: () => void;
};

export function LibraryHero({
  game,
  pinned,
  showDurationDays,
  launchKey,
  launchBlocked,
  onAcquireLaunch,
  onReleaseLaunch,
  onPin,
  onUnpin,
  onHide,
}: LibraryHeroProps) {
  const [showDetails, setShowDetails] = useState(false);
  const menu = useAnchoredMenu();
  const details = useGameDetails(game.igdbId);
  const journal = useGameJournal({ ...game, gameName: game.name });
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setHistoryGameKey = useAppStore((state) => state.setHistoryGameKey);
  const launcher = useHeroLauncher(game, {
    launchKey,
    launchBlocked,
    onAcquireLaunch,
    onReleaseLaunch,
  });

  const ready = details.status === "ready" ? details.details : null;
  const artwork = ready?.artworkUrls?.[0] ?? ready?.screenshotUrls?.[0];
  const facts = ready
    ? [
        ready.releaseYear?.toString() ??
          (ready.releaseDate ? ready.releaseDate.slice(0, 4) : null),
        ready.genres.length > 0 ? ready.genres.slice(0, 3).join(" · ") : null,
      ].filter((part): part is string => Boolean(part))
    : [];
  const played = game.hasLastPlayedEvidence || game.sessionCount > 0;
  const eyebrow = pinned ? "Featured" : played ? "Last played" : "Newest";

  function showHistory() {
    menu.close();
    setHistoryQuery(game.name);
    setHistoryGameKey(game.historyGameKey);
    setActiveView("history");
  }

  return (
    <section
      aria-label={`${eyebrow}: ${game.name}`}
      data-tour="library-hero"
      className="library-hero relative isolate min-h-[300px] overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-raised"
    >
      <div aria-hidden className="absolute inset-0">
        {artwork ? (
          <img
            src={artwork}
            alt=""
            decoding="async"
            className="library-hero-art h-full w-full object-cover object-[65%_center]"
          />
        ) : game.coverUrl ? (
          <GameCover
            src={game.coverUrl}
            alt=""
            loading="eager"
            className="hero-backdrop h-full w-full scale-125 object-cover blur-3xl saturate-150"
          />
        ) : null}
        <div className="library-hero-shade absolute inset-0" />
      </div>

      <div
        className={clsx(
          "relative grid gap-6 p-7",
          !artwork && game.coverUrl && "sm:grid-cols-[minmax(0,1fr)_180px]",
        )}
      >
        <div className="flex min-h-[244px] max-w-2xl flex-col justify-center">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
            {pinned ? (
              <Pin size={12} className="text-accent" />
            ) : (
              <History size={12} />
            )}
            <span>{eyebrow}</span>
            {journal.favorite ? (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Star size={11} fill="currentColor" />
                Favorite
              </span>
            ) : null}
          </div>
          <h2 className="library-hero-title text-balance text-4xl font-black leading-[1.05] tracking-tight text-text drop-shadow-sm sm:text-5xl">
            {game.name}
          </h2>
          {facts.length > 0 ? (
            <p className="mt-3 text-sm font-medium text-text-muted">
              {facts.join("  ·  ")}
            </p>
          ) : null}
          {ready?.summary ? (
            <p className="mt-3 line-clamp-2 max-w-xl text-[15px] leading-6 text-text/85">
              {ready.summary}
            </p>
          ) : null}
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <HeroFigure
              label="Playtime"
              value={formatDuration(game.totalSeconds, showDurationDays)}
            />
            <HeroFigure label="Sessions" value={String(game.sessionCount)} />
            {played ? (
              <HeroFigure
                label="Last played"
                value={new Date(game.lastPlayedAt).toLocaleDateString()}
              />
            ) : null}
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {launcher.canLaunch ? (
              <Button
                variant="primary"
                icon={launcher.launching ? Loader2 : Play}
                disabled={launcher.launching || launcher.hasActiveSession}
                title={
                  launcher.hasActiveSession
                    ? "Already running"
                    : launcher.launching
                      ? "Starting…"
                      : launcher.launchLabel
                }
                aria-label={`${launcher.launchLabel}: ${game.name}`}
                onClick={() => void launcher.launch()}
                className="library-hero-play h-11 px-6 text-[15px] font-bold shadow-[0_8px_24px_rgb(var(--color-accent)/0.35)]"
              >
                {launcher.hasActiveSession
                  ? "Running"
                  : launcher.launching
                    ? "Starting…"
                    : launcher.launchLabel}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon={Info}
              onClick={() => setShowDetails(true)}
              className="h-11 border-border/70 bg-bg/50 px-5 backdrop-blur"
            >
              More info
            </Button>
            <IconButton
              ref={menu.anchorRef}
              aria-label="More banner options"
              aria-haspopup="menu"
              aria-expanded={menu.open}
              title="More"
              icon={MoreHorizontal}
              onClick={menu.toggle}
              className="h-11 w-11 rounded-md border-border/70 bg-bg/50 backdrop-blur"
            />
          </div>
        </div>
        {!artwork && game.coverUrl ? (
          <div className="hidden items-end justify-end sm:flex">
            <GameCover
              src={game.coverUrl}
              alt=""
              highRes
              loading="eager"
              className="aspect-[3/4] w-[180px] rounded-xl object-cover shadow-card-hover ring-1 ring-white/10"
            />
          </div>
        ) : null}
      </div>

      <ContextMenu
        open={menu.open}
        position={menu.position}
        onClose={menu.close}
        anchorRef={menu.anchorRef}
      >
        {pinned ? (
          <ContextMenuItem
            icon={PinOff}
            onClick={() => {
              menu.close();
              onUnpin();
            }}
          >
            Show last played game instead
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            icon={Pin}
            onClick={() => {
              menu.close();
              onPin();
            }}
          >
            Keep this game in the banner
          </ContextMenuItem>
        )}
        <ContextMenuItem
          icon={History}
          disabled={game.sessionCount === 0}
          onClick={showHistory}
        >
          Show history
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={EyeOff}
          onClick={() => {
            menu.close();
            onHide();
          }}
        >
          Hide banner
        </ContextMenuItem>
      </ContextMenu>

      {showDetails ? (
        <GameDetailsDialog
          game={game}
          launchTargets={launcher.launchTargets}
          onClose={() => setShowDetails(false)}
        />
      ) : null}
    </section>
  );
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        {label}
      </dt>
      <dd className="font-mono text-sm font-bold tabular-nums text-text">
        {value}
      </dd>
    </div>
  );
}
