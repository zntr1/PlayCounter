import { create } from "zustand";
import { rateLimitDelay } from "../rateLimitedFetch";
import {
  createGameIdentityResolver,
  useAppStore,
  type AppState,
} from "../store";
import { checkPlayCounterGameForMatches } from "./knownGameFiles";
import {
  checkLibraryImportForMatches,
  type LibraryExecutableMatch,
} from "./recheck";
import {
  libraryEntryKey,
  type LibraryImportEntry,
  type PlayCounterLibraryEntry,
} from "./types";

type LibraryMatchOffer = {
  entry: LibraryImportEntry;
  executableMatches: LibraryExecutableMatch[];
};

export type PlayCounterMatchOffer = {
  entry: PlayCounterLibraryEntry;
  executableMatches: LibraryExecutableMatch[];
};

// Offers are session-only. Reviewing one performs a fresh lookup before the
// user applies it, so a startup result cannot install a stale mapping.
// PlayCounter games (added by hand or moved away from their launcher) are
// keyed by IGDB id.
export const useLibraryMatchOffers = create(() => ({
  offers: new Map<string, LibraryMatchOffer>(),
  playcounterOffers: new Map<number, PlayCounterMatchOffer>(),
}));

export function dismissLibraryMatchOffer(key: string) {
  useLibraryMatchOffers.setState((state) => {
    const offers = new Map(state.offers);
    offers.delete(key);
    return { offers };
  });
}

export function dismissPlayCounterMatchOffer(igdbId: number) {
  useLibraryMatchOffers.setState((state) => {
    const playcounterOffers = new Map(state.playcounterOffers);
    playcounterOffers.delete(igdbId);
    return { playcounterOffers };
  });
}

export function untrackableLibraryImports() {
  const state = useAppStore.getState();
  const tracked = trackedIgdbIds(state);
  return [...state.libraryImports.values()].filter(
    (entry) =>
      (entry.provider === "steam" ||
        entry.provider === "xbox" ||
        entry.provider === "battlenet" ||
        entry.provider === "epic") &&
      !tracked.has(entry.igdbId),
  );
}

/** PlayCounter games without a file. A launcher import of the same game has
 *  its own check. */
export function untrackablePlayCounterGames() {
  const state = useAppStore.getState();
  const skip = trackedIgdbIds(state);
  for (const entry of state.libraryImports.values()) skip.add(entry.igdbId);
  return [...state.playcounterLibrary.values()].filter(
    (entry) => !skip.has(entry.igdbId),
  );
}

function trackedIgdbIds(state: AppState) {
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
  return tracked;
}

type PendingCheck =
  | { kind: "import"; entry: LibraryImportEntry }
  | { kind: "playcounter"; entry: PlayCounterLibraryEntry };

export function startLibraryImportMatchChecks(): () => void {
  // Snapshot the startup library; later imports, Add game and Move to
  // PlayCounter already perform this lookup.
  const pending = new Map<string, PendingCheck>([
    ...untrackableLibraryImports().map((entry): [string, PendingCheck] => [
      libraryEntryKey(entry.provider, entry.externalId),
      { kind: "import", entry },
    ]),
    ...untrackablePlayCounterGames().map((entry): [string, PendingCheck] => [
      `playcounter:${entry.igdbId}`,
      { kind: "playcounter", entry },
    ]),
  ]);
  const controllers = new Set<AbortController>();
  let disposed = false;
  let running = false;
  let retryRequested = false;
  const lifetime = new AbortController();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  useLibraryMatchOffers.setState({
    offers: new Map(),
    playcounterOffers: new Map(),
  });

  async function check() {
    if (disposed || useAppStore.getState().backendHealth.status === "offline")
      return;
    if (running) {
      retryRequested = true;
      return;
    }
    if (retryTimer) globalThis.clearTimeout(retryTimer);
    retryTimer = undefined;
    running = true;
    const queue = [...pending];
    try {
      // Keep large libraries from flooding the API or blocking app startup.
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (!disposed && queue.length > 0) {
            if (useAppStore.getState().backendHealth.status === "offline")
              return;
            if (rateLimitDelay(useAppStore.getState().settings.apiEndpoint) > 0)
              return;
            const [key, item] = queue.shift()!;
            const state = useAppStore.getState();
            if (!stillUntrackable(key, item)) {
              pending.delete(key);
              continue;
            }
            const controller = new AbortController();
            controllers.add(controller);
            const timeout = globalThis.setTimeout(
              () => controller.abort(),
              15_000,
            );
            try {
              const publish = await checkPending(key, item, controller.signal);
              if (disposed) return;
              pending.delete(key);
              publish?.();
            } catch {
              // A failed lookup must not interrupt startup. Keep it pending for
              // cooldown expiry or the next offline-to-online transition.
              if (rateLimitDelay(state.settings.apiEndpoint) > 0)
                retryRequested = true;
            } finally {
              globalThis.clearTimeout(timeout);
              controllers.delete(controller);
            }
            // Three workers, at most one request each every three seconds.
            // Leave room in the API allowance for tracking and user actions.
            if (queue.length > 0 && !disposed)
              await pauseLibraryCheck(lifetime.signal);
          }
        }),
      );
    } finally {
      running = false;
      const delay = rateLimitDelay(useAppStore.getState().settings.apiEndpoint);
      if (!disposed && pending.size > 0 && delay > 0) {
        retryRequested = false;
        retryTimer = globalThis.setTimeout(() => void check(), delay);
        return;
      }
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
    lifetime.abort();
    if (retryTimer) globalThis.clearTimeout(retryTimer);
    unsubscribe();
    for (const controller of controllers) controller.abort();
    useLibraryMatchOffers.setState({
      offers: new Map(),
      playcounterOffers: new Map(),
    });
  };
}

function stillUntrackable(key: string, item: PendingCheck) {
  if (item.kind === "playcounter") {
    return untrackablePlayCounterGames().includes(item.entry);
  }
  return (
    useAppStore.getState().libraryImports.get(key) === item.entry &&
    untrackableLibraryImports().includes(item.entry)
  );
}

/** Looks one game up. Returns what publishes its offer, which checks first
 *  that nothing changed while the lookup ran. */
async function checkPending(
  key: string,
  item: PendingCheck,
  signal: AbortSignal,
): Promise<(() => void) | undefined> {
  const state = useAppStore.getState();
  const apiEndpoint = state.settings.apiEndpoint;
  if (item.kind === "playcounter") {
    const { entry } = item;
    const result = await checkPlayCounterGameForMatches({
      apiEndpoint,
      game: entry,
      signal,
    });
    if (result.kind !== "found") return undefined;
    return () => {
      if (
        useAppStore.getState().settings.apiEndpoint !== apiEndpoint ||
        !stillUntrackable(key, item)
      ) {
        return;
      }
      useLibraryMatchOffers.setState((offers) => ({
        playcounterOffers: new Map(offers.playcounterOffers).set(entry.igdbId, {
          entry,
          executableMatches: result.executableMatches,
        }),
      }));
    };
  }
  const { entry } = item;
  const install = state.libraryInstalls.get(key);
  const result = await checkLibraryImportForMatches({
    apiEndpoint,
    entry,
    install,
    ignoredProcesses: state.ignoredProcesses,
    signal,
  });
  if (result.kind !== "found" || result.commit.entry.igdbId !== entry.igdbId) {
    return undefined;
  }
  return () => {
    const current = useAppStore.getState();
    if (
      current.settings.apiEndpoint !== apiEndpoint ||
      current.libraryInstalls.get(key) !== install ||
      !stillUntrackable(key, item)
    ) {
      return;
    }
    useLibraryMatchOffers.setState((offers) => ({
      offers: new Map(offers.offers).set(key, {
        entry,
        executableMatches: result.executableMatches,
      }),
    }));
  };
}

function pauseLibraryCheck(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = globalThis.setTimeout(finish, 3_000);
    signal.addEventListener("abort", finish, { once: true });
  });
}
