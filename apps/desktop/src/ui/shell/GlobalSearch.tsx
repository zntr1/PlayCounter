import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppStore } from "../../store";

/* One search field for the whole window, sitting in the title bar. On My
   Games it filters the library directly. Anywhere else, typing jumps to My
   Games on Enter with the text already applied, so the field never feels
   dead. Ctrl+K focuses it from any view. */

export const LIBRARY_SEARCH_PLACEHOLDER = "Search games...";

export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeView = useAppStore((state) => state.activeView);
  const query = useAppStore((state) => state.libraryQuery);
  const setQuery = useAppStore((state) => state.setLibraryQuery);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const onLibrary = activeView === "games";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "k"
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
      className="global-search relative flex h-9 w-full max-w-[560px] items-center"
    >
      <Search
        size={15}
        className="pointer-events-none absolute left-3.5 text-text-faint"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !onLibrary) {
            event.preventDefault();
            setActiveView("games");
          } else if (event.key === "Escape" && query) {
            event.preventDefault();
            setQuery("");
          }
        }}
        placeholder={LIBRARY_SEARCH_PLACEHOLDER}
        aria-label={
          onLibrary ? "Search your games" : "Search your games (opens My Games)"
        }
        className="global-search-input h-full w-full rounded-xl border border-border/70 bg-bg/60 pl-10 pr-[4.75rem] text-sm text-text outline-none transition placeholder:text-text-faint focus:border-accent/70 focus:bg-bg focus:ring-2 focus:ring-accent/25"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-12 grid h-6 w-6 place-items-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text"
        >
          <X size={13} />
        </button>
      ) : null}
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 hidden select-none items-center gap-0.5 rounded-md border border-border/70 bg-surface px-1.5 py-0.5 font-sans text-[10px] font-semibold tracking-wide text-text-faint sm:flex"
      >
        Ctrl K
      </kbd>
    </div>
  );
}
