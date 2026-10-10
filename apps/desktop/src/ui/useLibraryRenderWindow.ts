import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useAppStore } from "../store";
import {
  INITIAL_LIBRARY_RENDER_COUNT,
  nextLibraryRenderLimit,
} from "./libraryRenderWindow";

/** Mount more cards only as the user approaches them, including on revisits. */
export function useLibraryRenderWindow(key: string, total: number) {
  const active = useAppStore((state) => state.activeView === "games");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [renderWindow, setRenderWindow] = useState({
    key,
    limit: INITIAL_LIBRARY_RENDER_COUNT,
  });
  const limit =
    renderWindow.key === key
      ? renderWindow.limit
      : INITIAL_LIBRARY_RENDER_COUNT;
  const hasMore = limit < total;

  useEffect(() => {
    if (renderWindow.key !== key)
      setRenderWindow({ key, limit: INITIAL_LIBRARY_RENDER_COUNT });
  }, [key, renderWindow.key]);

  const loadMore = useCallback(() => {
    if (useAppStore.getState().activeView !== "games") return;
    startTransition(() => {
      setRenderWindow((current) => ({
        key,
        limit: nextLibraryRenderLimit(
          current.key === key ? current.limit : INITIAL_LIBRARY_RENDER_COUNT,
          total,
        ),
      }));
    });
  }, [key, total]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !active ||
      !hasMore ||
      !sentinel ||
      typeof IntersectionObserver === "undefined"
    )
      return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled || !entries.some((entry) => entry.isIntersecting)) return;
        cancelled = true;
        observer.disconnect();
        loadMore();
      },
      {
        root: sentinel.closest("[data-controller-content]"),
        rootMargin: "600px 0px",
      },
    );
    observer.observe(sentinel);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [active, hasMore, key, limit, loadMore]);

  return { limit, sentinelRef, hasMore, loadMore, pending };
}
