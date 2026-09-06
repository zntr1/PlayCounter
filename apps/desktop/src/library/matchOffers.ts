import { create } from "zustand";
import { createGameIdentityResolver, useAppStore } from "../store";
import { checkLibraryImportForMatches } from "./recheck";
import { libraryEntryKey, type LibraryImportEntry } from "./types";

type LibraryMatchOffer = {
  entry: LibraryImportEntry;
  executableNames: string[];
};

// Offers are session-only. Reviewing one performs a fresh lookup before the
// user applies it, so a startup result cannot install a stale mapping.
export const useLibraryMatchOffers = create(() => ({
  offers: new Map<string, LibraryMatchOffer>(),
}));

export function dismissLibraryMatchOffer(key: string) {
  useLibraryMatchOffers.setState((state) => {
    const offers = new Map(state.offers);
    offers.delete(key);
    return { offers };
  });
}

export function untrackableLibraryImports() {
  const state = useAppStore.getState();
  const resolve = createGameIdentityResolver(
    state.gameMetadata,
    state.exeCache,
    state.libraryImports,
  );
  const tracked = new Set<number>();
  const add = (game: {
    gameId?: number;
    igdbId?: number;
    source?: "igdb" | "community" | "custom";
    gameName?: string;
  }) => {
    const id =
      game.igdbId ??
      (game.gameId !== undefined
        ? resolve(game.gameId, game.source, game.gameName)
        : undefined);
    if (id != null) tracked.add(id);
  };
  for (const entry of state.exeCache.values()) {
    if (entry.state === "matched") add(entry);
  }
  for (const link of state.scopedExeLinks.values()) add(link);
  for (const mapping of state.emulatorMappings.values()) {
    if (mapping.decision === "game") add(mapping);
  }
  return [...state.libraryImports.values()].filter(
    (entry) =>
      (entry.provider === "steam" || entry.provider === "xbox") &&
      !tracked.has(entry.igdbId),
  );
}

export function startLibraryImportMatchChecks(): () => void {
  // Snapshot the startup library; later imports already perform this lookup.
  const pending = new Map(
    untrackableLibraryImports().map((entry) => [
      libraryEntryKey(entry.provider, entry.externalId),
      entry,
    ]),
  );
  const controllers = new Set<AbortController>();
  let disposed = false;
  let running = false;
  let retryRequested = false;
  useLibraryMatchOffers.setState({ offers: new Map() });

  async function check() {
    if (disposed || useAppStore.getState().backendHealth.status === "offline")
      return;
    if (running) {
      retryRequested = true;
      return;
    }
    running = true;
    const queue = [...pending];
    try {
      // Keep large libraries from flooding the API or blocking app startup.
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (!disposed && queue.length > 0) {
            if (useAppStore.getState().backendHealth.status === "offline")
              return;
            const [key, entry] = queue.shift()!;
            const state = useAppStore.getState();
            if (
              state.libraryImports.get(key) !== entry ||
              !untrackableLibraryImports().includes(entry)
            ) {
              pending.delete(key);
              continue;
            }
            const controller = new AbortController();
            controllers.add(controller);
            const timeout = globalThis.setTimeout(
              () => controller.abort(),
              15_000,
            );
            const install = state.libraryInstalls.get(key);
            try {
              const result = await checkLibraryImportForMatches({
                apiEndpoint: state.settings.apiEndpoint,
                entry,
                install,
                ignoredProcesses: state.ignoredProcesses,
                signal: controller.signal,
              });
              if (disposed) return;
              pending.delete(key);
              const current = useAppStore.getState();
              if (
                result.kind === "found" &&
                result.commit.entry.igdbId === entry.igdbId &&
                current.settings.apiEndpoint === state.settings.apiEndpoint &&
                current.libraryImports.get(key) === entry &&
                current.libraryInstalls.get(key) === install &&
                untrackableLibraryImports().includes(entry)
              ) {
                useLibraryMatchOffers.setState((state) => ({
                  offers: new Map(state.offers).set(key, {
                    entry,
                    executableNames: result.executableNames,
                  }),
                }));
              }
            } catch {
              // A failed lookup must not interrupt startup. Keep it pending for
              // the next offline-to-online transition; manual checks still work.
            } finally {
              globalThis.clearTimeout(timeout);
              controllers.delete(controller);
            }
          }
        }),
      );
    } finally {
      running = false;
      if (retryRequested) {
        retryRequested = false;
        void check();
      }
    }
  }

  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (
      state.backendHealth.status === "online" &&
      previous.backendHealth.status !== "online"
    ) {
      void check();
    }
  });
  void check();
  return () => {
    disposed = true;
    unsubscribe();
    for (const controller of controllers) controller.abort();
    useLibraryMatchOffers.setState({ offers: new Map() });
  };
}
