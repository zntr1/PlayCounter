import { create } from "zustand";
import type { LibraryTabDescriptor, LibraryTabId } from "./libraryTabs";

/* The library's import-source tabs (All games, PlayCounter, Steam, …) are
   drawn in the sidebar, but their counts come out of the same game list that
   My Games builds for its grid. Rebuilding that list a second time for the
   sidebar would double the heaviest computation in the app on every store
   change, so My Games publishes the finished descriptors here and the sidebar
   only reads. Empty until the library has rendered once. */

export type LibrarySourcesState = {
  tabs: LibraryTabDescriptor[];
  activeTab: LibraryTabId;
  /** False while the library is empty, when tabs would all read zero. */
  visible: boolean;
  /** True while the featured-game banner is on screen. */
  heroVisible: boolean;
  /** The banner's key art, so the title bar can carry its colour upward. */
  heroArt: string | null;
  /** Key art of the game running on Now Playing; the whole view sits on it. */
  nowArt: string | null;
};

export const useLibrarySources = create<LibrarySourcesState>(() => ({
  tabs: [],
  activeTab: "all",
  visible: false,
  heroVisible: false,
  heroArt: null,
  nowArt: null,
}));

export function publishLibrarySources(next: LibrarySourcesState) {
  const current = useLibrarySources.getState();
  if (
    current.visible === next.visible &&
    current.heroVisible === next.heroVisible &&
    current.heroArt === next.heroArt &&
    current.nowArt === next.nowArt &&
    current.activeTab === next.activeTab &&
    sameTabs(current.tabs, next.tabs)
  ) {
    return;
  }
  useLibrarySources.setState(next);
}

function sameTabs(
  left: readonly LibraryTabDescriptor[],
  right: readonly LibraryTabDescriptor[],
) {
  return (
    left.length === right.length &&
    left.every(
      (tab, index) =>
        tab.id === right[index].id &&
        tab.kind === right[index].kind &&
        tab.label === right[index].label &&
        tab.count === right[index].count,
    )
  );
}
