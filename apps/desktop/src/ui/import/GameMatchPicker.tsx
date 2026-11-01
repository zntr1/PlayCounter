import clsx from "clsx";
import { Gamepad2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isSearchableGameQuery } from "../../communityMetadataSearch";
import { getT } from "../../i18n";
import { librarySearchQuery } from "../../library/gameLookup";
import { formatError } from "../../library/importSession";
import type { GameMetadata } from "../../store";
import { GameCover } from "../GameCover";
import { Button, Input } from "../primitives";

const t = getT("import");

/**
 * "Which game is it?": the suggestions as covers to click, and a search for
 * when the right one is missing. Used by the importer and the import tour.
 */
export function GameMatchPicker({
  title,
  candidates,
  selectedId,
  matchedId,
  onSelect,
  onResults,
  search,
  searchOnOpen = false,
  practice = false,
}: {
  /** The launcher's name for the game. */
  title: string;
  candidates: readonly GameMetadata[];
  selectedId: number | null;
  /** The server's match, marked on its cover. */
  matchedId?: number;
  onSelect: (game: GameMetadata) => void;
  onResults: (games: GameMetadata[]) => void;
  search: (query: string, signal: AbortSignal) => Promise<GameMetadata[]>;
  /** Search the title as soon as the game is opened. */
  searchOnOpen?: boolean;
  practice?: boolean;
}) {
  const [query, setQuery] = useState(() => librarySearchQuery(title));
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(
    candidates.length > 0 ? null : noSuggestionMessage(),
  );
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function runSearch(text: string) {
    if (!isSearchableGameQuery(text)) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setSearching(true);
    setMessage(null);
    try {
      const games = await search(text, current.signal);
      if (current.signal.aborted) return;
      onResults(games);
      setMessage(
        games.length > 0
          ? null
          : t(
              "No matching games found. Try the English title or another spelling.",
            ),
      );
    } catch (cause) {
      if (current.signal.aborted) return;
      onResults([]);
      setMessage(formatError(cause));
    } finally {
      if (!current.signal.aborted) setSearching(false);
    }
  }

  useEffect(() => {
    const autoQuery = librarySearchQuery(title);
    if (searchOnOpen && autoQuery.length >= 2) void runSearch(autoQuery);
    // Once per opened game: the parent keys this picker by game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-3">
      {candidates.length > 0 ? (
        <div
          role="group"
          aria-label={t("Game match for {{title}}", { title })}
          className="flex flex-wrap gap-2"
        >
          {candidates.map((candidate) => {
            const selected = candidate.igdbId === selectedId;
            return (
              <button
                key={candidate.igdbId ?? candidate.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(candidate)}
                className={clsx(
                  "w-[108px] rounded-xl border p-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  selected
                    ? "border-accent/80 bg-accent-tint"
                    : "border-transparent hover:bg-surface-hover",
                )}
              >
                <span
                  className={clsx(
                    "block aspect-[3/4] w-full overflow-hidden rounded-lg bg-surface-hover",
                    selected && "ring-2 ring-accent",
                  )}
                >
                  {candidate.coverUrl ? (
                    <GameCover
                      src={candidate.coverUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-text-faint">
                      <Gamepad2 size={20} aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block text-xs font-semibold leading-snug text-text">
                  {candidate.name}
                </span>
                <span className="block text-[11px] text-text-muted">
                  {practice ? t("Sample") : (candidate.releaseYear ?? null)}
                </span>
                {matchedId !== undefined && candidate.igdbId === matchedId ? (
                  <span className="mt-1 inline-block rounded-full bg-accent-tint px-1.5 text-[10px] font-bold text-accent-ink">
                    {t("Matched")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(query);
        }}
      >
        <span className="text-sm text-text-muted">{t("Not listed?")}</span>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search by game title or IGDB ID")}
          aria-label={t("Search by game title or IGDB ID")}
          className="min-w-0 flex-1 basis-56 !bg-bg"
        />
        <Button
          type="submit"
          variant="secondary"
          icon={Search}
          loading={searching}
          disabled={!isSearchableGameQuery(query)}
        >
          {practice ? t("Search samples") : t("Search IGDB")}
        </Button>
      </form>
      {message ? (
        <p role="status" aria-live="polite" className="text-sm text-text-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function noSuggestionMessage() {
  return t("No safe suggestion found. Search for the game by name.");
}
