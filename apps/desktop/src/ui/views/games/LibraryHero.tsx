import clsx from "clsx";
import {
  History,
  Info,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  Sparkles,
  Star,
  EyeOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLibrarySources } from "../../librarySources";
import { useGameDetails } from "../../../gameDetails";
import { useAppStore } from "../../../store";
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
  // Key art when there is some, the cover otherwise: the title bar tint
  // should always follow the banner.
  const titleBarArt = artwork ?? (game.coverUrl || null);
  useEffect(() => {
    useLibrarySources.setState({ heroArt: titleBarArt });
    return () => useLibrarySources.setState({ heroArt: null });
  }, [titleBarArt]);
  const played = game.hasLastPlayedEvidence || game.sessionCount > 0;
  const eyebrow = pinned ? "Featured" : played ? "Last played" : "Newest";
  const playLabel =
    launcher.launchLabel === "Play" && played
      ? "Continue Playing"
      : launcher.launchLabel;

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
      className="library-hero relative isolate mb-6 h-[min(360px,40vh)] min-h-[300px] overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-raised"
    >
      <div aria-hidden className="absolute inset-0">
        {artwork ? (
          <img
            src={artwork}
            srcSet={heroArtSrcSet(artwork)}
            sizes="100vw"
            alt=""
            decoding="async"
            fetchPriority="high"
            className="library-hero-art h-full w-full object-cover object-[72%_35%]"
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
          "relative grid h-full gap-6 px-9 py-8",
          !artwork && game.coverUrl && "sm:grid-cols-[minmax(0,1fr)_170px]",
        )}
      >
        <div className="flex min-h-0 max-w-[560px] flex-col justify-center">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">
            {pinned ? <Pin size={13} /> : <Sparkles size={13} />}
            <span>{pinned ? "Featured game" : eyebrow}</span>
            {journal.favorite ? (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Star size={11} fill="currentColor" />
                Favorite
              </span>
            ) : null}
          </div>
          <h2 className="library-hero-title text-balance font-serif text-[44px] font-bold leading-[1.05] tracking-tight text-text drop-shadow-md">
            {game.name}
          </h2>
          {facts.length > 0 ? (
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
              {facts.join("   •   ")}
            </p>
          ) : null}
          {ready?.summary ? (
            <p className="mt-4 line-clamp-3 max-w-[500px] text-[15px] leading-[1.5] text-text/85">
              {ready.summary}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
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
                      : playLabel
                }
                aria-label={`${playLabel}: ${game.name}`}
                onClick={() => void launcher.launch()}
                className="library-hero-play h-12 rounded-lg px-6 text-[15px] font-bold shadow-[0_8px_24px_rgb(var(--color-accent)/0.35)]"
              >
                {launcher.hasActiveSession
                  ? "Running"
                  : launcher.launching
                    ? "Starting…"
                    : playLabel}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon={Info}
              onClick={() => setShowDetails(true)}
              className="h-12 rounded-lg border-2 border-text/25 bg-bg/40 px-5 text-[15px] font-semibold backdrop-blur hover:border-text/50 hover:bg-bg/60"
            >
              More Info
            </Button>
            <IconButton
              ref={menu.anchorRef}
              aria-label="More banner options"
              aria-haspopup="menu"
              aria-expanded={menu.open}
              title="More"
              icon={MoreHorizontal}
              onClick={menu.toggle}
              className="h-12 w-12 rounded-lg border-2 border-text/25 bg-bg/40 backdrop-blur hover:border-text/50 hover:bg-bg/60"
            />
          </div>
        </div>
        {!artwork && game.coverUrl ? (
          <div className="hidden items-center justify-end sm:flex">
            <GameCover
              src={game.coverUrl}
              alt=""
              highRes
              loading="eager"
              className="aspect-[3/4] w-[170px] rounded-xl object-cover shadow-card-hover ring-1 ring-white/10"
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

/* The API serves t_1080p (1920 wide). On a HiDPI screen, or with the content
   zoomed, the banner needs more than that, and IGDB has a 2x rendition of
   every size. Let the browser pick by device pixel ratio. */
function heroArtSrcSet(url: string) {
  const marker = "/t_1080p/";
  if (!url.includes(marker)) return undefined;
  return `${url} 1x, ${url.replace(marker, "/t_1080p_2x/")} 2x`;
}
