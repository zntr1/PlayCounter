import type { Game, GameSource } from "@playcounter/shared";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Search,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useIsOffline } from "../../../store";
import { searchEmulatorGames } from "../../../tracker";
import { Button, IconButton, Input } from "../../primitives";

type SearchState = "idle" | "loading" | "done" | "error";

function useEmulatorGameSearch(emulatorId: string) {
  const [state, setState] = useState<SearchState>("idle");
  const [results, setResults] = useState<Game[]>([]);
  const [lastQuery, setLastQuery] = useState("");
  const [message, setMessage] = useState("");
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (rawQuery: string) => {
      const value = rawQuery.trim();
      if (!value) return;
      const id = ++requestId.current;
      setState("loading");
      setLastQuery(value);
      setMessage("");
      try {
        const games = await searchEmulatorGames(emulatorId, value);
        if (!mounted.current || id !== requestId.current) return;
        setResults(games);
        setState("done");
      } catch (error) {
        if (!mounted.current || id !== requestId.current) return;
        setResults([]);
        setMessage(error instanceof Error ? error.message : String(error));
        setState("error");
      }
    },
    [emulatorId],
  );

  const reset = useCallback(() => {
    requestId.current += 1;
    setState("idle");
    setResults([]);
    setLastQuery("");
    setMessage("");
  }, []);

  return { state, results, lastQuery, message, run, reset };
}

export function EmulatorGamePicker({
  emulatorId,
  platformLabel,
  contentDisplay,
  initialQuery,
  suggested,
  currentGame,
  variant,
  busy,
  onSelect,
  onSelectAndShare,
  shareDisabled,
  shareDisabledReason,
  onSelectCustom,
}: {
  emulatorId: string;
  platformLabel: string;
  contentDisplay: string;
  initialQuery: string;
  suggested?: Game[];
  currentGame?: { id: number; source?: GameSource; name: string };
  variant: "card" | "dialog";
  busy: boolean;
  onSelect: (game: Game) => void;
  onSelectAndShare?: (game: Game) => void;
  shareDisabled?: boolean;
  shareDisabledReason?: string;
  onSelectCustom: (name: string) => void;
}) {
  const isOffline = useIsOffline();
  const [query, setQuery] = useState(initialQuery);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const customId = useId();
  const search = useEmulatorGameSearch(emulatorId);

  const select = (game: Game) => {
    if (
      busy ||
      (currentGame &&
        currentGame.id === game.id &&
        currentGame.source === game.source)
    ) {
      return;
    }
    onSelect(game);
  };

  const selectAndShare = onSelectAndShare
    ? (game: Game) => {
        if (
          busy ||
          shareDisabled ||
          (currentGame &&
            currentGame.id === game.id &&
            currentGame.source === game.source)
        ) {
          return;
        }
        onSelectAndShare(game);
      }
    : undefined;

  const openCustomWith = (value = "") => {
    setCustomName(value);
    setCustomOpen(true);
  };

  return (
    <div className={clsx("relative grid gap-5", busy && "opacity-70")}>
      {suggested?.length ? (
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-faint">
            Best guesses from the database
          </div>
          <GameGrid
            games={suggested}
            contentDisplay={contentDisplay}
            platformLabel={platformLabel}
            currentGame={currentGame}
            busy={busy}
            onSelect={select}
            onSelectAndShare={selectAndShare}
            shareDisabled={shareDisabled}
            shareDisabledReason={shareDisabledReason}
          />
        </section>
      ) : null}

      <section>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isOffline && !busy) void search.run(query);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
            />
            <Input
              data-autofocus={variant === "dialog" ? "true" : undefined}
              value={query}
              disabled={isOffline || busy}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${platformLabel} games`}
              className="w-full px-9"
            />
            {query && !isOffline && !busy ? (
              <IconButton
                icon={X}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 border-transparent"
                onClick={() => {
                  setQuery("");
                  search.reset();
                }}
              />
            ) : null}
          </div>
          <Button
            type="submit"
            icon={Search}
            loading={search.state === "loading"}
            disabled={!query.trim() || isOffline || busy}
          >
            Search
          </Button>
        </form>
        <p className="mt-2 text-xs text-text-faint">
          Searches the IGDB game database for {platformLabel} games. Up to 50
          results.
        </p>
      </section>

      <div role="status" aria-live="polite">
        {isOffline ? (
          <StatePanel tone="warning">
            Search needs an internet connection. You can still add the game by
            name.
          </StatePanel>
        ) : search.state === "loading" ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-xl border border-border bg-surface-hover"
              />
            ))}
            <span className="sr-only">Searching…</span>
          </div>
        ) : search.state === "error" ? (
          <StatePanel tone="danger">
            <div>Game search failed: {search.message}</div>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => void search.run(search.lastQuery)}
            >
              Try again
            </Button>
          </StatePanel>
        ) : search.state === "done" && search.results.length === 0 ? (
          <StatePanel>
            <div className="font-medium text-text">
              No {platformLabel} game found for “{search.lastQuery}”.
            </div>
            <div className="mt-1">
              Check the spelling, try the English name, or add it as a custom
              game.
            </div>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => openCustomWith(search.lastQuery)}
            >
              Add “{search.lastQuery}” as custom game
            </Button>
          </StatePanel>
        ) : search.state === "done" ? (
          <section>
            <div className="mb-2 text-xs text-text-muted">
              {search.results.length} result
              {search.results.length === 1 ? "" : "s"} for “{search.lastQuery}”
            </div>
            <GameGrid
              games={search.results}
              contentDisplay={contentDisplay}
              platformLabel={platformLabel}
              currentGame={currentGame}
              busy={busy}
              onSelect={select}
              onSelectAndShare={selectAndShare}
              shareDisabled={shareDisabled}
              shareDisabledReason={shareDisabledReason}
            />
          </section>
        ) : (
          <StatePanel>
            Search for the game inside <strong>{contentDisplay}</strong>.
          </StatePanel>
        )}
      </div>

      <section className="border-t border-border pt-4">
        <button
          type="button"
          aria-expanded={customOpen}
          aria-controls={customId}
          className="flex items-center gap-2 text-sm font-medium text-text-muted transition hover:text-text"
          onClick={() => setCustomOpen((open) => !open)}
        >
          {customOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Not in the database? Add it by name
        </button>
        {customOpen ? (
          <form
            id={customId}
            className="mt-3 rounded-xl border border-border bg-bg/60 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const value = customName.trim();
              if (value && !busy) onSelectCustom(value);
            }}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={customName}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="Custom game name"
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={!customName.trim() || busy}
              >
                Add custom game
              </Button>
            </div>
            <p className="mt-2 text-xs text-text-faint">
              Stays on this PC only.
            </p>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function GameGrid({
  games,
  contentDisplay,
  platformLabel,
  currentGame,
  busy,
  onSelect,
  onSelectAndShare,
  shareDisabled,
  shareDisabledReason,
}: {
  games: Game[];
  contentDisplay: string;
  platformLabel: string;
  currentGame?: { id: number; source?: GameSource };
  busy: boolean;
  onSelect: (game: Game) => void;
  onSelectAndShare?: (game: Game) => void;
  shareDisabled?: boolean;
  shareDisabledReason?: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {games.map((game) => {
        const current =
          currentGame?.id === game.id && currentGame.source === game.source;
        const content = (
          <div className="flex min-w-0 items-center gap-3 p-3">
            {game.coverUrl ? (
              <img
                src={game.coverUrl}
                alt=""
                className="h-16 w-12 shrink-0 rounded-md bg-surface-hover object-cover"
              />
            ) : (
              <span className="grid h-16 w-12 shrink-0 place-items-center rounded-md bg-surface-hover text-text-faint">
                <Gamepad2 size={20} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span
                className="block truncate font-medium text-text"
                title={game.name}
              >
                {game.name}
              </span>
              <span className="mt-1 block text-xs text-text-faint">
                {game.releaseYear ? `${game.releaseYear} · ` : ""}
                {platformLabel}
              </span>
              <span className="mt-2 block text-xs font-medium text-accent">
                {current
                  ? "Currently linked"
                  : onSelectAndShare
                    ? "From the database"
                    : "Select this game"}
              </span>
            </span>
          </div>
        );
        const className = clsx(
          "min-w-0 overflow-hidden rounded-xl border text-left transition",
          current
            ? "border-border bg-surface-hover/60 opacity-75"
            : "border-border bg-bg",
        );
        return current ? (
          <div key={`${game.source}:${game.id}`} className={className}>
            {content}
          </div>
        ) : onSelectAndShare ? (
          <div key={`${game.source}:${game.id}`} className={className}>
            {content}
            <div className="border-t border-border bg-surface/40 p-2">
              <Button
                variant="primary"
                icon={Send}
                disabled={busy || shareDisabled}
                title={shareDisabled ? shareDisabledReason : undefined}
                aria-label={`Add ${contentDisplay} as ${game.name} and share the match`}
                className="w-full min-w-0 px-2 text-xs font-semibold"
                onClick={() => onSelectAndShare(game)}
              >
                Add &amp; Share
              </Button>
            </div>
          </div>
        ) : (
          <button
            key={`${game.source}:${game.id}`}
            type="button"
            disabled={busy}
            aria-label={`Track ${contentDisplay} as ${game.name}`}
            className={clsx(
              className,
              "hover:border-accent/50 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            )}
            onClick={() => onSelect(game)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function StatePanel({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-dashed p-5 text-sm",
        tone === "warning"
          ? "border-warning-border bg-warning-tint text-warning"
          : tone === "danger"
            ? "border-danger-border bg-danger-tint text-danger"
            : "border-border bg-bg/60 text-text-muted",
      )}
    >
      {children}
    </div>
  );
}
