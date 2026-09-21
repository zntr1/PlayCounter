import { create } from "zustand";

// Banners and library cards share a lock, including across view changes while
// Windows or a launcher is still starting the game.
export const useLibraryLaunchLock = create<{
  launchingGameKey: string | null;
  acquireLaunchLock: (key: string) => boolean;
  releaseLaunchLock: (key: string) => void;
}>((set, get) => ({
  launchingGameKey: null,
  acquireLaunchLock: (key) => {
    if (get().launchingGameKey !== null) return false;
    set({ launchingGameKey: key });
    return true;
  },
  releaseLaunchLock: (key) => {
    if (get().launchingGameKey === key) set({ launchingGameKey: null });
  },
}));
