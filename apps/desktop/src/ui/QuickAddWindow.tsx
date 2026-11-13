import clsx from "clsx";
import { Check, Search } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { isSearchableGameQuery } from "../communityMetadataSearch";
import type {
  QuickAddGame,
  QuickAddLabel,
  QuickAddPayload,
  QuickAddReply,
} from "../quickAdd";

/** How long the added game shows before the box closes. */
const ADDED_MS = 1000;

type Notice =
  | { kind: "none" }
  | { kind: "already"; name: string }
  | { kind: "error"; text: string };

type BoxState = {
  text: string;
  /** The search the main window is working on. */
  pending: string | null;
  /** The search the list belongs to. */
  shown: string | null;
  results: QuickAddGame[];
  mark: number;
  notice: Notice | null;
  /** The game the main window is adding. */
  picking: number | null;
  added: QuickAddGame | null;
};

type Action =
  | { type: "type"; text: string }
  | { type: "search"; query: string }
  | { type: "mark"; index: number }
  | { type: "move"; by: 1 | -1 }
  | { type: "already"; name: string }
  | { type: "pick"; igdbId: number }
  | { type: "reply"; reply: QuickAddReply };

const initial: BoxState = {
  text: "",
  pending: null,
  shown: null,
  results: [],
  mark: 0,
  notice: null,
  picking: null,
  added: null,
};

function reduce(state: BoxState, action: Action): BoxState {
  switch (action.type) {
    case "type":
      return { ...state, text: action.text, notice: null };
    case "search":
      return { ...state, pending: action.query, notice: null };
    case "mark":
      return { ...state, mark: action.index, notice: null };
    case "move": {
      const count = state.results.length;
      if (count === 0) return state;
      return {
        ...state,
        mark: (state.mark + action.by + count) % count,
        notice: null,
      };
    }
    case "already":
      return { ...state, notice: { kind: "already", name: action.name } };
    case "pick":
      return { ...state, picking: action.igdbId, notice: null };
    case "reply":
      return replied(state, action.reply);
  }
}

/** Only the answer to the latest search, or to the pick, counts. */
function replied(state: BoxState, reply: QuickAddReply): BoxState {
  switch (reply.kind) {
    case "results":
      if (reply.query !== state.pending) return state;
      return {
        ...state,
        pending: null,
        shown: reply.query,
        results: reply.games,
        mark: 0,
        notice: reply.games.length === 0 ? { kind: "none" } : null,
      };
    case "error":
      if (reply.query !== state.pending) return state;
      return {
        ...state,
        pending: null,
        shown: null,
        results: [],
        notice: { kind: "error", text: reply.message },
      };
    case "added":
      if (reply.igdbId !== state.picking) return state;
      return {
        ...state,
        picking: null,
        added:
          state.results.find((game) => game.igdbId === reply.igdbId) ?? null,
      };
    case "already": {
      if (reply.igdbId !== state.picking) return state;
      const game = state.results.find((item) => item.igdbId === reply.igdbId);
      return {
        ...state,
        picking: null,
        results: state.results.map((item) =>
          item.igdbId === reply.igdbId ? { ...item, inLibrary: true } : item,
        ),
        notice: game ? { kind: "already", name: game.name } : null,
      };
    }
  }
}

/* The box the quick add hotkey opens over the game. Enter searches; once the
   list shows what's in the field, Enter or Add game adds the marked game. A
   click only marks a game. The main window searches and adds: the box shows
   the answers and sends the picks. After an add it shows the game for a
   second, then hands focus back. Esc closes without adding; so does a click
   elsewhere, which leaves the focus where the click put it. The window
   follows the card's height. */
export function QuickAddWindow({
  payload,
  onSearch,
  onPick,
  onFit,
  onClose,
  subscribe,
}: {
  payload: QuickAddPayload;
  onSearch: (query: string) => void;
  onPick: (igdbId: number) => void;
  /** The height the window needs, in CSS pixels. */
  onFit: (height: number) => void;
  onClose: (restoreFocus: boolean) => void;
  /** The main window's answers. Returns the unsubscribe. */
  subscribe: (listener: (reply: QuickAddReply) => void) => () => void;
}) {
  const label = (key: QuickAddLabel, name?: string) => {
    const text = payload.labels[key] ?? key;
    return name === undefined ? text : text.replaceAll("{{name}}", name);
  };
  const [state, dispatch] = useReducer(reduce, initial);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  const latest = useRef({ onClose, onFit });
  latest.current = { onClose, onFit };

  function close(restoreFocus: boolean) {
    if (closed.current) return;
    closed.current = true;
    latest.current.onClose(restoreFocus);
  }

  useEffect(() => {
    inputRef.current?.focus();
    const unsubscribe = subscribe((reply) =>
      dispatch({ type: "reply", reply }),
    );
    const onBlur = () => close(false);
    window.addEventListener("blur", onBlur);
    return () => {
      unsubscribe();
      window.removeEventListener("blur", onBlur);
    };
    // Runs once: the box lives as long as this window.
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      latest.current.onFit(Math.ceil(root.getBoundingClientRect().height)),
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!state.added) return;
    const timer = window.setTimeout(() => close(true), ADDED_MS);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [state.added]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [state.mark, state.results]);

  const query = state.text.trim();
  const fresh =
    state.pending === null && state.shown === query && state.results.length > 0;
  const busy = state.picking !== null;

  function add() {
    if (!fresh || busy) return;
    const game = state.results[state.mark];
    if (!game) return;
    if (game.inLibrary) {
      dispatch({ type: "already", name: game.name });
      return;
    }
    dispatch({ type: "pick", igdbId: game.igdbId });
    onPick(game.igdbId);
  }

  function enter() {
    if (busy) return;
    if (fresh) {
      add();
      return;
    }
    if (!isSearchableGameQuery(query) || state.pending === query) return;
    dispatch({ type: "search", query });
    onSearch(query);
  }

  const notice = state.notice ? (
    <p
      role="status"
      className={clsx(
        "shrink-0 text-xs",
        state.notice.kind === "error" ? "text-danger" : "text-text-muted",
      )}
    >
      {state.notice.kind === "none"
        ? label(
            "No matching games found. Try the English title or another spelling.",
          )
        : state.notice.kind === "already"
          ? label("{{name}} is already in your library.", state.notice.name)
          : state.notice.text}
    </p>
  ) : null;

  return (
    <div ref={rootRef} className="w-full p-1">
      <div className="quick-note-card quick-add-card">
        <div className="desktop-overlay-kicker shrink-0">
          {label("Quick add game")}
        </div>
        {state.added ? (
          <div className="flex flex-col items-center gap-2.5 py-6 text-center">
            <Cover game={state.added} large />
            <span className="grid h-11 w-11 place-items-center rounded-full bg-success/15 text-success">
              <Check size={22} strokeWidth={2.5} aria-hidden />
            </span>
            <strong className="text-[15px] font-semibold text-text">
              {label("{{name}} added", state.added.name)}
            </strong>
            <span className="text-xs text-text-muted">
              {label("It's in My Games now.")}
            </span>
          </div>
        ) : (
          <>
            <div className="relative shrink-0">
              <Search
                size={16}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
              />
              <input
                ref={inputRef}
                value={state.text}
                maxLength={200}
                aria-label={label("Search by game title or IGDB ID")}
                placeholder={label("Search by game title or IGDB ID")}
                onChange={(event) =>
                  dispatch({ type: "type", text: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close(true);
                  } else if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    enter();
                  } else if (
                    event.key === "ArrowDown" ||
                    event.key === "ArrowUp"
                  ) {
                    event.preventDefault();
                    dispatch({
                      type: "move",
                      by: event.key === "ArrowDown" ? 1 : -1,
                    });
                  }
                }}
                className="h-10 w-full rounded-xl border border-border bg-bg pl-9 pr-10 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              {state.pending !== null ? (
                <span
                  role="status"
                  aria-label={label("Searching…")}
                  className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-accent/25 border-t-accent"
                />
              ) : null}
            </div>
            {state.results.length === 0 ? notice : null}
            {state.results.length > 0 ? (
              <div
                ref={listRef}
                role="listbox"
                aria-label={label("Search results")}
                className="grid min-h-0 flex-initial content-start gap-1.5 overflow-y-auto pr-0.5"
              >
                {state.results.map((game, index) => (
                  <button
                    key={game.igdbId}
                    type="button"
                    role="option"
                    aria-selected={index === state.mark}
                    // The field keeps the focus, so Enter still adds.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => dispatch({ type: "mark", index })}
                    className={clsx(
                      "flex items-center gap-3 rounded-[10px] border px-2.5 py-1.5 text-left transition",
                      index === state.mark
                        ? "border-accent/70 bg-accent-tint"
                        : "border-border bg-surface hover:bg-surface-hover",
                    )}
                  >
                    <Cover game={game} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text">
                        {game.name}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {game.releaseYear ? `${game.releaseYear} · ` : ""}IGDB{" "}
                        {game.igdbId}
                        {game.inLibrary ? (
                          <>
                            {" · "}
                            <span className="text-accent">
                              {label("In your library")}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {state.results.length > 0 ? notice : null}
            <footer className="flex shrink-0 items-center gap-3 text-[11px] text-text-faint">
              <span className="min-w-0 flex-1 truncate">
                {label(
                  "Enter searches · Enter again adds · ↑↓ picks · Esc closes",
                )}
              </span>
              <button
                type="button"
                onClick={() => close(true)}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-surface-hover hover:text-text"
              >
                {label("Cancel")}
              </button>
              <button
                type="button"
                disabled={!fresh || busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={add}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
              >
                {label("Add game")}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/** A result's cover, grey when it has none or it fails to load. */
function Cover({ game, large }: { game: QuickAddGame; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = large ? "h-20 w-[60px] rounded-lg" : "h-10 w-[30px] rounded";
  return game.coverUrl && !failed ? (
    <img
      src={game.coverUrl}
      alt=""
      onError={() => setFailed(true)}
      className={clsx("shrink-0 object-cover", size)}
    />
  ) : (
    <span className={clsx("shrink-0 bg-surface-hover", size)} />
  );
}
