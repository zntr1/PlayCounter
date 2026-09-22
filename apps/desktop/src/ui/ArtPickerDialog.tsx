import type { ArtAsset, ArtSearchGame } from "@playcounter/shared";
import clsx from "clsx";
import { Check, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { artForGame, downloadArtImage, searchArt } from "../gameArt";
import { RATE_LIMIT_MESSAGE, RateLimitError } from "../rateLimitedFetch";
import { customHeroArtKey, useAppStore } from "../store";
import { setCustomGameCover } from "../tracker";
import { Button, Input, Modal } from "./primitives";

/* Pick a cover or a banner from SteamGridDB. Search runs against the API,
   which holds the key; results show as thumbnails, one click applies.
   Covers are only for games PlayCounter owns (custom games and tools), since
   IGDB games carry IGDB's cover; banners can be chosen for any game. */

type ArtPickerGame = {
  gameId: number;
  source: "igdb" | "community" | "custom" | null;
  name: string;
  /** True when the game is a custom entry whose cover the user may replace. */
  canEditCover: boolean;
};

type Tab = "banner" | "cover";

export function ArtPickerDialog({
  game,
  initialTab = "banner",
  onClose,
}: {
  game: ArtPickerGame;
  initialTab?: Tab;
  onClose: () => void;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const setCustomHeroArt = useAppStore((state) => state.setCustomHeroArt);
  const heroKey = customHeroArtKey(game);
  const currentHero = useAppStore((state) => state.customHeroArt[heroKey]);
  const [query, setQuery] = useState(game.name);
  const [results, setResults] = useState<ArtSearchGame[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedGame, setSelectedGame] = useState<ArtSearchGame | null>(null);
  const [assets, setAssets] = useState<{
    covers: ArtAsset[];
    heroes: ArtAsset[];
  } | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [applying, setApplying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRun = useRef(0);

  async function runSearch(term: string) {
    const run = ++searchRun.current;
    setSearching(true);
    setError(null);
    try {
      const games = await searchArt(term);
      if (run !== searchRun.current) return;
      setResults(games);
      setSelectedGame(games[0] ?? null);
      if (games.length === 0) setAssets({ covers: [], heroes: [] });
    } catch (searchError) {
      if (run !== searchRun.current) return;
      setError(describe(searchError));
      setResults([]);
      setSelectedGame(null);
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  }

  useEffect(() => {
    void runSearch(game.name);
    // The initial search belongs to the game the dialog opened for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedGame) return;
    let cancelled = false;
    setLoadingAssets(true);
    setError(null);
    artForGame(selectedGame.id)
      .then((next) => {
        if (!cancelled) setAssets(next);
      })
      .catch((assetError) => {
        if (!cancelled) setError(describe(assetError));
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGame]);

  async function apply(asset: ArtAsset) {
    if (applying !== null) return;
    setApplying(asset.id);
    setError(null);
    try {
      if (tab === "banner") {
        setCustomHeroArt(heroKey, asset.url);
        addToast({
          tone: "success",
          title: "Banner set",
          detail: `${game.name} now uses the picked banner.`,
        });
      } else {
        const blob = await downloadArtImage(asset.url);
        await setCustomGameCover(game.gameId, blob);
        addToast({
          tone: "success",
          title: "Cover set",
          detail: `${game.name} now uses the picked cover.`,
        });
      }
      onClose();
    } catch (applyError) {
      setError(describe(applyError));
    } finally {
      setApplying(null);
    }
  }

  const list = tab === "banner" ? assets?.heroes : assets?.covers;
  const coverLocked = tab === "cover" && !game.canEditCover;

  return (
    <Modal
      size="wide"
      labelId="art-picker-title"
      icon={ImageIcon}
      eyebrow="SteamGridDB"
      title="Choose artwork"
      subtitle={`Banner and cover art for ${game.name}. Search any name, including tools like Discord or Spotify.`}
      onClose={onClose}
      bodyClassName="grid gap-4"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-text-faint">
            Art by the SteamGridDB community.
          </span>
          <div className="flex items-center gap-2">
            {tab === "banner" && currentHero ? (
              <Button
                variant="ghost"
                icon={X}
                onClick={() => {
                  setCustomHeroArt(heroKey, null);
                  addToast({
                    tone: "info",
                    title: "Banner reset",
                    detail: `${game.name} is back to its automatic banner.`,
                  });
                  onClose();
                }}
              >
                Use automatic banner
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim().length >= 2) void runSearch(query.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search SteamGridDB…"
            aria-label="Search SteamGridDB"
            className="w-full pl-9"
            data-autofocus
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          loading={searching}
          disabled={query.trim().length < 2}
        >
          Search
        </Button>
      </form>

      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-h-0">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
            Matches
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
            {results.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-text-muted">
                {searching ? "Searching…" : "No matches yet."}
              </div>
            ) : (
              results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => setSelectedGame(result)}
                  className={clsx(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
                    selectedGame?.id === result.id
                      ? "bg-accent-tint text-text"
                      : "text-text-muted hover:bg-surface-hover hover:text-text",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{result.name}</span>
                  {result.releaseYear ? (
                    <span className="shrink-0 font-mono text-[11px] text-text-faint">
                      {result.releaseYear}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1">
            {(["banner", "cover"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                onClick={() => setTab(option)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tab === option
                    ? "bg-accent text-accent-fg"
                    : "text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                {option === "banner" ? "Banner" : "Cover"}
              </button>
            ))}
            <span className="ml-auto text-xs text-text-faint">
              {list ? `${list.length} available` : ""}
            </span>
          </div>
          {coverLocked ? (
            <div className="rounded-lg border border-border bg-bg/50 px-4 py-3 text-sm text-text-muted">
              This game's cover comes from IGDB and cannot be replaced. Covers
              can be chosen for custom games and tools.
            </div>
          ) : null}
          <div
            className={clsx(
              "max-h-[360px] overflow-y-auto rounded-lg border border-border p-2",
              coverLocked && "pointer-events-none opacity-40",
            )}
          >
            {loadingAssets ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                <Loader2 size={16} className="animate-spin" />
                Loading art…
              </div>
            ) : !list || list.length === 0 ? (
              <div className="py-10 text-center text-sm text-text-muted">
                {selectedGame
                  ? `No ${tab === "banner" ? "banners" : "covers"} for this entry.`
                  : "Pick a match on the left."}
              </div>
            ) : (
              <div
                className={clsx(
                  "grid gap-2",
                  tab === "banner"
                    ? "grid-cols-2"
                    : "grid-cols-4 sm:grid-cols-5",
                )}
              >
                {list.map((asset) => {
                  const active = tab === "banner" && currentHero === asset.url;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      disabled={applying !== null}
                      aria-label={`Use this ${tab}`}
                      onClick={() => void apply(asset)}
                      className={clsx(
                        "group relative overflow-hidden rounded-lg border bg-surface-hover transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        active
                          ? "border-accent ring-2 ring-accent/50"
                          : "border-border/60 hover:border-accent/70",
                        tab === "banner" ? "aspect-[3.1/1]" : "aspect-[2/3]",
                      )}
                    >
                      <img
                        src={asset.thumbUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                      />
                      {applying === asset.id ? (
                        <span className="absolute inset-0 grid place-items-center bg-bg/60">
                          <Loader2
                            size={18}
                            className="animate-spin text-text"
                          />
                        </span>
                      ) : active ? (
                        <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-fg">
                          <Check size={14} />
                        </span>
                      ) : null}
                      <span className="pointer-events-none absolute bottom-1 right-1.5 rounded bg-bg/70 px-1 font-mono text-[10px] text-text-muted">
                        {asset.width}×{asset.height}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-danger-border bg-danger-tint px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}

function describe(error: unknown) {
  if (error instanceof RateLimitError) return RATE_LIMIT_MESSAGE;
  return error instanceof Error ? error.message : String(error);
}
