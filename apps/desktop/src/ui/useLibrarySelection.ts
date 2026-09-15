import { usePersonalLibraryApi } from "./PersonalLibraryContext";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { GAME_STATUSES, type GameStatus } from "../personalLibrary";
import { type GameIdentityRef } from "../store";

type SelectableGame = GameIdentityRef & { name: string };

export function librarySelectionKey(game: GameIdentityRef) {
  return game.igdbId !== undefined
    ? `igdb#${game.igdbId}`
    : `${game.source ?? "unknown"}:${game.gameId}`;
}

export function useLibrarySelection(
  games: readonly SelectableGame[],
  scope: string,
  enabled: boolean,
) {
  const libraryApi = usePersonalLibraryApi();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRestore = useRef<{ element: HTMLElement; top: number } | null>(
    null,
  );
  const restoreFocus = useRef(false);
  const [active, setActive] = useState(false);
  const [selection, setSelection] = useState(() => ({
    scope,
    keys: new Set<string>(),
    anchor: null as string | null,
  }));
  const keys = useMemo(() => games.map(librarySelectionKey), [games]);
  const available = useMemo(() => new Set(keys), [keys]);
  const selected = useMemo(
    () =>
      new Set(
        active && enabled && selection.scope === scope
          ? [...selection.keys].filter((key) => available.has(key))
          : [],
      ),
    [active, enabled, selection, scope, available],
  );

  // A changed search/source/shelf starts a fresh selection. Removed or filtered
  // games must not stay selected invisibly, or reappear selected later.
  useEffect(() => {
    setSelection((current) => {
      if (current.scope !== scope || !enabled)
        return { scope, keys: new Set(), anchor: null };
      if ([...current.keys].every((key) => available.has(key))) return current;
      return {
        ...current,
        keys: new Set([...current.keys].filter((key) => available.has(key))),
        anchor:
          current.anchor && available.has(current.anchor)
            ? current.anchor
            : null,
      };
    });
    if (!enabled) setActive(false);
  }, [scope, available, enabled]);

  useLayoutEffect(() => {
    if (scrollRestore.current) {
      const { element, top } = scrollRestore.current;
      element.scrollTop = top;
      scrollRestore.current = null;
    }
    if (restoreFocus.current) {
      restoreFocus.current = false;
      // Applying a status can remove every matching game and disable Select.
      const target =
        rootRef.current?.querySelector<HTMLElement>(
          "[data-library-select]:not(:disabled)",
        ) ??
        rootRef.current?.querySelector<HTMLElement>(
          '[placeholder="Search games..."]',
        );
      target?.focus({ preventScroll: true });
    }
  });

  const clear = useCallback(() => {
    setSelection({ scope, keys: new Set(), anchor: null });
  }, [scope]);
  const finish = useCallback(() => {
    restoreFocus.current = true;
    setActive(false);
    clear();
  }, [clear]);

  useEffect(() => {
    if (!active || !enabled) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.isComposing ||
        event.defaultPrevented ||
        libraryApi.getState().activeView !== "games" ||
        document.querySelector('[role="dialog"], [role="menu"]')
      )
        return;
      event.preventDefault();
      finish();
    };
    // Clicking empty space can leave focus outside the library's React root.
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [active, enabled, finish, libraryApi]);
  const toggleMode = () => {
    if (active) finish();
    else if (enabled) {
      clear();
      setActive(true);
    }
  };
  const toggleGame = useCallback(
    (key: string, range: boolean) => {
      if (!available.has(key)) return;
      setSelection((current) => {
        const next = new Set(
          current.scope === scope
            ? [...current.keys].filter((entry) => available.has(entry))
            : [],
        );
        const anchor = current.scope === scope ? current.anchor : null;
        const start = anchor ? keys.indexOf(anchor) : -1;
        if (range && start !== -1) {
          const end = keys.indexOf(key);
          for (const entry of keys.slice(
            Math.min(start, end),
            Math.max(start, end) + 1,
          ))
            next.add(entry);
        } else if (next.has(key)) next.delete(key);
        else next.add(key);
        return {
          scope,
          keys: next,
          anchor: range && start !== -1 ? anchor : key,
        };
      });
    },
    [available, keys, scope],
  );
  const selectAll = useCallback(() => {
    setSelection({ scope, keys: new Set(keys), anchor: null });
  }, [keys, scope]);

  function rememberScroll() {
    const element = rootRef.current?.closest<HTMLElement>(
      "[data-controller-content]",
    );
    if (element) scrollRestore.current = { element, top: element.scrollTop };
  }
  function applyStatus(status: GameStatus | null) {
    if (!selected.size) return;
    rememberScroll();
    const changes = libraryApi.getState().setGameStatuses(
      games
        .filter((game) => selected.has(librarySelectionKey(game)))
        .map((game) => ({ ...game, gameName: game.name })),
      status,
    );
    const count = changes.length;
    const label = `${count} ${count === 1 ? "game" : "games"}`;
    libraryApi.getState().addToast({
      tone: count ? "success" : "info",
      title: count
        ? status
          ? `${label} marked ${GAME_STATUSES[status]}`
          : `Status cleared for ${label}`
        : status
          ? `Selected games are already marked ${GAME_STATUSES[status]}`
          : "Selected games already have no status",
    });
    finish();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!active || !enabled || event.defaultPrevented) return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !event.currentTarget.contains(target) ||
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
      )
    )
      return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      selectAll();
    }
  }

  return {
    rootRef,
    active: active && enabled,
    selected,
    toggleMode,
    toggleGame,
    selectAll,
    clear,
    finish,
    applyStatus,
    onKeyDown,
  };
}
