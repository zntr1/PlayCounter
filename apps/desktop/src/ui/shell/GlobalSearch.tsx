import { Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAppStore } from "../../store";
import { useEscapeClearsSearch } from "../useEscapeClearsSearch";
import { getT } from "../../i18n";

const t = getT("shell");

/* One search field for the whole window, sitting in the title bar. On My
   Games it filters the library directly, within whatever shelf and source are
   open. On My History it filters the session journal by game or file name,
   and a game filter (a session, a highlight, a game's banner or journal)
   shows as a chip in the field: typing replaces it, × or Backspace in the
   empty field removes it.
   Anywhere else, typing jumps to My Games on Enter with the text already
   applied and the library widened to every game, since a search started from
   another view has no shelf in mind. Ctrl+F focuses it from any view except
   Discovered, whose own search field takes Ctrl+F there. Escape clears it
   from anywhere; My Games, My History and Discovered do that themselves,
   since their own panels and fields take Escape first. */

function librarySearchPlaceholder() {
  return t("Search games...");
}

function historySearchPlaceholder() {
  return t("Search history...");
}

export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeView = useAppStore((state) => state.activeView);
  const onLibrary = activeView === "games";
  const onHistory = activeView === "history";
  const pageOwnsCtrlF = activeView === "discovered";
  const query = useAppStore((state) =>
    onHistory ? state.historyQuery : state.libraryQuery,
  );
  const setLibraryQuery = useAppStore((state) => state.setLibraryQuery);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setQuery = onHistory ? setHistoryQuery : setLibraryQuery;
  const setActiveView = useAppStore((state) => state.setActiveView);
  const searchWholeLibrary = useAppStore((state) => state.searchWholeLibrary);
  const pageOwnsEscape = onLibrary || onHistory || pageOwnsCtrlF;
  const clearQuery = useCallback(() => setQuery(""), [setQuery]);
  const gameKey = useAppStore((state) =>
    onHistory ? state.historyGameKey : null,
  );
  const gameName = useAppStore((state) => state.historyGameName);
  const setHistoryGameKey = useAppStore((state) => state.setHistoryGameKey);
  const clearGame = useCallback(
    () => setHistoryGameKey(null),
    [setHistoryGameKey],
  );
  const chip = gameKey ? (gameName ?? "") : null;
  const chipRef = useRef<HTMLSpanElement>(null);
  const [chipWidth, setChipWidth] = useState(0);
  // The text starts after the chip, whose width depends on the name.
  useLayoutEffect(() => {
    setChipWidth(chipRef.current?.offsetWidth ?? 0);
  }, [chip]);
  useEscapeClearsSearch(Boolean(query) && !pageOwnsEscape, clearQuery);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f" ||
        useAppStore.getState().activeView === "discovered"
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
      {chip !== null ? (
        <span
          ref={chipRef}
          data-history-game-filter
          // It sits in the field: a click on it puts the caret there.
          onClick={() => inputRef.current?.focus()}
          className="absolute left-10 z-10 inline-flex h-7 max-w-[55%] items-center gap-1 rounded-lg border border-accent/45 bg-accent/10 pl-2.5 pr-1 text-[13px] font-semibold text-text"
        >
          <span className="truncate">{chip}</span>
          <button
            type="button"
            aria-label={t("Clear game filter")}
            onClick={() => {
              clearGame();
              inputRef.current?.focus();
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-text-muted transition hover:bg-accent/20 hover:text-text"
          >
            <X size={13} />
          </button>
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => {
          // Typing replaces a game filter: one filter at a time.
          if (gameKey) clearGame();
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !onLibrary && !onHistory) {
            event.preventDefault();
            searchWholeLibrary();
            setActiveView("games");
          } else if (event.key === "Escape" && query) {
            event.preventDefault();
            setQuery("");
          } else if (event.key === "Backspace" && gameKey && !query) {
            event.preventDefault();
            clearGame();
          }
        }}
        placeholder={
          chip !== null
            ? ""
            : onHistory
              ? historySearchPlaceholder()
              : librarySearchPlaceholder()
        }
        style={chip !== null ? { paddingLeft: 48 + chipWidth } : undefined}
        aria-label={
          onHistory
            ? t("Search your history")
            : onLibrary
              ? t("Search your games")
              : t("Search your games (opens My Games)")
        }
        className="global-search-input h-full w-full rounded-xl border border-border/70 bg-bg/60 pl-11 pr-[5rem] text-[15px] text-text outline-none transition placeholder:text-text-faint focus:border-accent/70 focus:bg-bg focus:ring-2 focus:ring-accent/25"
      />
      {query ? (
        <button
          type="button"
          aria-label={t("Clear search")}
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-[3.6rem] z-10 grid h-7 w-7 place-items-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text"
        >
          <X size={15} />
        </button>
      ) : null}
      {pageOwnsCtrlF ? null : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-3 z-10 hidden select-none items-center gap-0.5 rounded-md border border-border/70 bg-surface px-2 py-1 font-sans text-[11px] font-semibold tracking-wide text-text-faint sm:flex"
        >
          {t("Ctrl F")}
        </kbd>
      )}
    </div>
  );
}
