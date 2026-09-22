import { useAppStore, type ViewId } from "../store";
import { GameBanner } from "./GameBanner";
import { useLibraryLaunchLock } from "./libraryLaunchLock";
import { useLibrarySources } from "./librarySources";

// App mounts this once for the current view. All views use the library's
// already-computed global selection, independent of its selected shelf.
export function ViewBanner({
  view,
  onArtworkChange,
}: {
  view: Exclude<ViewId, "games">;
  onArtworkChange: (artwork: string | null) => void;
}) {
  const featured = useLibrarySources((state) => state.featured);
  const ready = useLibrarySources((state) => state.ready);
  const setFeatured = useAppStore((state) => state.setLibraryFeaturedGame);
  const setVisible = useAppStore((state) => state.setViewShowHero);
  const showDetails = useAppStore(
    (state) => state.settings.viewBannerDetails === true,
  );
  const setShowDetails = useAppStore((state) => state.setViewBannerDetails);
  const { launchingGameKey, acquireLaunchLock, releaseLaunchLock } =
    useLibraryLaunchLock();

  if (!featured) {
    return (
      <p
        role="status"
        className="mb-5 rounded-xl border border-border bg-surface px-5 py-4 text-sm text-text-muted"
      >
        {ready
          ? "Your banner will appear here once you have games in your library."
          : "Loading your banner…"}
      </p>
    );
  }

  return (
    <GameBanner
      key={`${featured.game.source ?? "unknown"}:${featured.game.gameId}`}
      variant={showDetails ? "full" : "compact"}
      game={featured.game}
      pinned={featured.pinned}
      onArtworkChange={onArtworkChange}
      launchKey="view-banner"
      launchBlocked={launchingGameKey !== null}
      onAcquireLaunch={acquireLaunchLock}
      onReleaseLaunch={releaseLaunchLock}
      onPin={() =>
        setFeatured({
          gameId: featured.game.gameId,
          source: featured.game.source,
          igdbId: featured.game.igdbId,
        })
      }
      onUnpin={() => setFeatured(null)}
      onHide={() => setVisible(view, false)}
      onToggleDetails={() => setShowDetails(!showDetails)}
    />
  );
}
