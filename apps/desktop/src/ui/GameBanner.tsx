import clsx from "clsx";
import type { GameDetails } from "@playcounter/shared";
import {
  Expand,
  History,
  Info,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  Shrink,
  Sparkles,
  Star,
  EyeOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { artSrcSet } from "./artSrcSet";
import { useGameDetails } from "../gameDetails";
import { customHeroArtKey, useAppStore } from "../store";
import { GameCover } from "./GameCover";
import {
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  useAnchoredMenu,
} from "./primitives";
import { useGameJournal } from "./useGameJournal";
import { GameDetailsDialog } from "./views/games/GameDetailsDialog";
import { useHeroLauncher } from "./views/games/useHeroLauncher";
import type { GameSummary } from "./views/MyGamesView";

/* One banner for the library, shelves, and other views. The compact variant
   keeps the same artwork, actions, and fallback behavior in less space. */

/** Wide art for a game, best source first: hand-picked, SteamGridDB hero,
 *  IGDB artwork, IGDB screenshot. The banner and the details dialog share
 *  this so a game looks the same in both. `undefined` means "use the cover". */
export function heroArtwork(
  pickedArt: string | undefined,
  details: GameDetails | null,
) {
  return (
    pickedArt ??
    details?.heroUrls?.[0] ??
    details?.artworkUrls?.[0] ??
    details?.screenshotUrls?.[0]
  );
}

type GameBannerProps = {
  game: GameSummary;
  pinned: boolean;
  variant?: "full" | "compact";
  shelfName?: string;
  onArtworkChange: (artwork: string | null) => void;
  launchKey: string;
  launchBlocked: boolean;
  onAcquireLaunch: (key: string) => boolean;
  onReleaseLaunch: (key: string) => void;
  onPin: () => void;
  onUnpin: () => void;
  onHide: () => void;
  /** Switch between the compact card and the full details. Only banners
   *  outside My Games offer this; the library banner is always full. */
  onToggleDetails?: () => void;
};

export function GameBanner({
  game,
  pinned,
  variant = "full",
  shelfName,
  onArtworkChange,
  launchKey,
  launchBlocked,
  onAcquireLaunch,
  onReleaseLaunch,
  onPin,
  onUnpin,
  onHide,
  onToggleDetails,
}: GameBannerProps) {
  const compact = variant === "compact";
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
  const pickedArt = useAppStore(
    (state) => state.customHeroArt[customHeroArtKey(game)],
  );
  const artwork = heroArtwork(pickedArt, ready);
  const facts = ready
    ? [
        ready.releaseYear?.toString() ??
          (ready.releaseDate ? ready.releaseDate.slice(0, 4) : null),
        ready.genres.length > 0 ? ready.genres.slice(0, 3).join(" · ") : null,
      ].filter((part): part is string => Boolean(part))
    : [];
  // One image continues through the title bar, card, and surrounding backdrop.
  const backdropArt = artwork ?? (game.coverUrl || null);
  useEffect(() => {
    onArtworkChange(backdropArt);
    return () => onArtworkChange(null);
  }, [onArtworkChange, backdropArt]);
  const played = game.hasLastPlayedEvidence || game.sessionCount > 0;
  const eyebrow = shelfName
    ? `${shelfName} · ${pinned ? "Shelf banner" : "Library banner"}`
    : pinned
      ? "Featured"
      : played
        ? "Last played"
        : "Newest";
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

  const bannerCard = (
    <section
      aria-label={`${eyebrow}: ${game.name}`}
      data-tour={compact ? undefined : "library-hero"}
      data-banner-variant={variant}
      className="library-hero relative isolate h-[var(--banner-height)] overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-raised"
    >
      <div aria-hidden className="absolute inset-0">
        {artwork ? (
          <img
            src={artwork}
            srcSet={artSrcSet(artwork)}
            sizes="100vw"
            alt=""
            decoding="async"
            fetchPriority="high"
            style={{
              top: "calc(var(--hero-lead, 0px) * -1)",
              height:
                "calc(var(--banner-height) + var(--hero-lead, 0px) + var(--banner-tail))",
            }}
            className="library-banner-art library-hero-art absolute object-cover object-[72%_0%]"
          />
        ) : game.coverUrl ? (
          <GameCover
            src={game.coverUrl}
            alt=""
            loading="eager"
            style={{
              top: "calc(var(--hero-lead, 0px) * -1)",
              height:
                "calc(var(--banner-height) + var(--hero-lead, 0px) + var(--banner-tail))",
            }}
            className="library-banner-art hero-backdrop absolute scale-125 object-cover blur-3xl saturate-150"
          />
        ) : null}
        <div className="library-hero-shade absolute inset-0" />
      </div>

      <div
        className={clsx(
          "relative grid h-full gap-6",
          compact ? "px-6 py-5" : "px-9 py-8",
          !compact &&
            !artwork &&
            game.coverUrl &&
            "sm:grid-cols-[minmax(0,1fr)_170px]",
        )}
      >
        <div
          className={clsx(
            "flex min-h-0 min-w-0 flex-col justify-center",
            compact ? "max-w-[760px]" : "max-w-[560px]",
          )}
        >
          <div
            className={clsx(
              "flex shrink-0 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent",
              compact ? "mb-2" : "mb-3",
            )}
          >
            {pinned ? <Pin size={13} /> : <Sparkles size={13} />}
            <span className="min-w-0 truncate">
              {!shelfName && pinned ? "Pinned game" : eyebrow}
            </span>
            {!compact && journal.favorite ? (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Star size={11} fill="currentColor" />
                Favorite
              </span>
            ) : null}
          </div>
          <h2
            className={clsx(
              "library-hero-title shrink-0 break-words font-serif font-bold tracking-tight text-text drop-shadow-md",
              compact
                ? "line-clamp-2 text-[28px] leading-tight"
                : "text-balance text-[44px] leading-[1.05]",
            )}
            title={compact ? game.name : undefined}
          >
            {game.name}
          </h2>
          {!compact && facts.length > 0 ? (
            <p className="mt-3 shrink-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
              {facts.join("   •   ")}
            </p>
          ) : null}
          {/* The banner is a fixed height, so a long summary has to give way
              rather than clip mid-line: it is the only part of the column that
              shrinks, and it scrolls once it runs out of room. */}
          {!compact && ready?.summary ? (
            <p className="scrollbar-hidden mt-4 max-h-[7.5rem] min-h-0 max-w-[500px] overflow-y-auto text-[15px] leading-[1.5] text-text/85">
              {ready.summary}
            </p>
          ) : null}
          <div
            className={clsx(
              "flex shrink-0 flex-wrap items-center gap-3",
              compact ? "mt-4" : "mt-6",
            )}
          >
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
                className={clsx(
                  "library-hero-play rounded-lg font-bold shadow-[0_8px_24px_rgb(var(--color-accent)/0.35)]",
                  compact ? "h-9 px-4 text-sm" : "h-12 px-6 text-[15px]",
                )}
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
              className={clsx(
                "rounded-lg border-2 border-text/25 bg-bg/40 font-semibold backdrop-blur hover:border-text/50 hover:bg-bg/60",
                compact ? "h-9 px-4 text-sm" : "h-12 px-5 text-[15px]",
              )}
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
              className={clsx(
                "rounded-lg border-2 border-text/25 bg-bg/40 backdrop-blur hover:border-text/50 hover:bg-bg/60",
                compact ? "h-9 w-9" : "h-12 w-12",
              )}
            />
          </div>
        </div>
        {!compact && !artwork && game.coverUrl ? (
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
            {shelfName ? "Use library banner" : "Show last played game instead"}
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            icon={Pin}
            onClick={() => {
              menu.close();
              onPin();
            }}
          >
            {shelfName
              ? "Keep this game for this shelf"
              : "Keep this game in the banner"}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          icon={History}
          disabled={game.sessionCount === 0}
          onClick={showHistory}
        >
          Show history
        </ContextMenuItem>
        {onToggleDetails ? (
          <ContextMenuItem
            icon={compact ? Expand : Shrink}
            onClick={() => {
              menu.close();
              onToggleDetails();
            }}
          >
            {compact ? "Show more banner details" : "Hide banner details"}
          </ContextMenuItem>
        ) : null}
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
          launchKey={`${launchKey}:details`}
          launchBlocked={launchBlocked}
          onAcquireLaunch={onAcquireLaunch}
          onReleaseLaunch={onReleaseLaunch}
          onClose={() => setShowDetails(false)}
        />
      ) : null}
    </section>
  );

  return (
    <div className="library-banner relative mb-6" data-banner-layout={variant}>
      {backdropArt ? (
        <div
          aria-hidden="true"
          className="library-banner-continuation pointer-events-none absolute -z-10"
        >
          <img
            src={backdropArt}
            srcSet={artSrcSet(backdropArt)}
            sizes="100vw"
            alt=""
            decoding="async"
            style={{
              top: "calc(var(--hero-lead, 0px) * -1)",
              height:
                "calc(var(--banner-height) + var(--hero-lead, 0px) + var(--banner-tail))",
            }}
            className="absolute inset-x-0 w-full object-cover object-[72%_0%]"
          />
        </div>
      ) : null}
      {bannerCard}
    </div>
  );
}
