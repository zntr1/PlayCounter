import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppStore } from "../../store";

/* One search field for the whole window, sitting in the title bar. On My
   Games it filters the library directly, within whatever shelf and source are
   open. On My History it filters the session journal by game or file name.
   Anywhere else, typing jumps to My Games on Enter with the text already
   applied and the library widened to every game, since a search started from
   another view has no shelf in mind. Ctrl+F focuses it from any view. */

export const LIBRARY_SEARCH_PLACEHOLDER = "Search games...";
export const HISTORY_SEARCH_PLACEHOLDER = "Search history...";

export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeView = useAppStore((state) => state.activeView);
  const onLibrary = activeView === "games";
  const onHistory = activeView === "history";
  const query = useAppStore((state) =>
    onHistory ? state.historyQuery : state.libraryQuery,
  );
  const setLibraryQuery = useAppStore((state) => state.setLibraryQuery);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setQuery = onHistory ? setHistoryQuery : setLibraryQuery;
  const setActiveView = useAppStore((state) => state.setActiveView);
  const searchWholeLibrary = useAppStore((state) => state.searchWholeLibrary);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      role="search"
      className="global-search relative flex h-11 w-full max-w-[640px] items-center"
    >
      <Search
        size={18}
        className="pointer-events-none absolute left-4 z-10 text-text-faint"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !onLibrary && !onHistory) {
            event.preventDefault();
            searchWholeLibrary();
            setActiveView("games");
          } else if (event.key === "Escape" && query) {
            event.preventDefault();
            setQuery("");
          }
        }}
        placeholder={
          onHistory ? HISTORY_SEARCH_PLACEHOLDER : LIBRARY_SEARCH_PLACEHOLDER
        }
        aria-label={
          onHistory
            ? "Search your history"
            : onLibrary
              ? "Search your games"
              : "Search your games (opens My Games)"
        }
        className="global-search-input h-full w-full rounded-xl border border-border/70 bg-bg/60 pl-11 pr-[5rem] text-[15px] text-text outline-none transition placeholder:text-text-faint focus:border-accent/70 focus:bg-bg focus:ring-2 focus:ring-accent/25"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-[3.6rem] z-10 grid h-7 w-7 place-items-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text"
        >
          <X size={15} />
        </button>
      ) : null}
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-3 z-10 hidden select-none items-center gap-0.5 rounded-md border border-border/70 bg-surface px-2 py-1 font-sans text-[11px] font-semibold tracking-wide text-text-faint sm:flex"
      >
        Ctrl F
      </kbd>
    </div>
  );
}
