import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useAppStore, type ViewId } from "../store";
import {
  INITIAL_LIBRARY_RENDER_COUNT,
  nextLibraryRenderLimit,
} from "./libraryRenderWindow";

/** Mount more cards only as the user approaches them, including on revisits.
 *  `batch` is both the first count and each step; `view` is the page the
 *  list lives on, so a hidden page stops loading. */
export function useLibraryRenderWindow(
  key: string,
  total: number,
  {
    view = "games",
    batch = INITIAL_LIBRARY_RENDER_COUNT,
  }: { view?: ViewId; batch?: number } = {},
) {
  const active = useAppStore((state) => state.activeView === view);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [renderWindow, setRenderWindow] = useState({
    key,
    limit: batch,
  });
  const limit = renderWindow.key === key ? renderWindow.limit : batch;
  const hasMore = limit < total;

  useEffect(() => {
    if (renderWindow.key !== key) setRenderWindow({ key, limit: batch });
  }, [batch, key, renderWindow.key]);

  const loadMore = useCallback(() => {
    if (useAppStore.getState().activeView !== view) return;
    startTransition(() => {
      setRenderWindow((current) => ({
        key,
        limit: nextLibraryRenderLimit(
          current.key === key ? current.limit : batch,
          total,
          batch,
        ),
      }));
    });
  }, [batch, key, total, view]);

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
