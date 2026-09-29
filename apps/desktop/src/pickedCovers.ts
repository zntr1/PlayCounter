import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { EmulatorMapping } from "./emulators/types";
import {
  personalGameIdentity,
  useAppStore,
  type AppState,
  type GameIdentityRef,
} from "./store";

/* Covers picked by hand from SteamGridDB for games whose cover comes from
   IGDB or the community. They stay on this PC and only change what is drawn:
   a game's own coverUrl is identity evidence and goes into sessions and
   reports, so it is never rewritten.

   Picks are keyed by the game's personal identity, the same key History and
   Achievements group by, so one pick reaches every view. */

type CoverState = Pick<
  AppState,
  "customCoverArt" | "gameMetadata" | "exeCache" | "libraryImports"
>;

let cachedIdentity: {
  gameMetadata: CoverState["gameMetadata"];
  exeCache: CoverState["exeCache"];
  libraryImports: CoverState["libraryImports"];
  identity: (game: GameIdentityRef) => string;
} | null = null;

// The resolver walks every known game, so it is built once per change to
// the game data and shared by every cover on screen.
function sharedIdentity(state: CoverState) {
  if (
    cachedIdentity?.gameMetadata !== state.gameMetadata ||
    cachedIdentity.exeCache !== state.exeCache ||
    cachedIdentity.libraryImports !== state.libraryImports
  ) {
    cachedIdentity = {
      gameMetadata: state.gameMetadata,
      exeCache: state.exeCache,
      libraryImports: state.libraryImports,
      identity: personalGameIdentity(state),
    };
  }
  return cachedIdentity.identity;
}

export function pickedCoverKey(state: CoverState, game: GameIdentityRef) {
  return sharedIdentity(state)(game);
}

/* Covers that failed to load in this run: an uploaded file missing after a
   backup was restored on another PC, a deleted file, or art taken down
   upstream. They are skipped, so a game falls back to its own cover and then
   to none. Never saved, and forgotten when the network comes back, so a cover
   that failed while offline is tried again. */
const useUnavailableCovers = create<{ urls: ReadonlySet<string> }>(() => ({
  urls: new Set(),
}));

globalThis.addEventListener?.("online", () =>
  useUnavailableCovers.setState({ urls: new Set() }),
);

export function markCoverUnavailable(url: string) {
  const { urls } = useUnavailableCovers.getState();
  if (!url || urls.has(url)) return;
  useUnavailableCovers.setState({ urls: new Set(urls).add(url) });
}

function usable(
  url: string | null | undefined,
  unavailable: ReadonlySet<string>,
) {
  return url && !unavailable.has(url) ? url : undefined;
}

function hasPicks(picks: Record<string, string>) {
  for (const _ in picks) return true;
  return false;
}

/** The hand-picked cover for a game, if there is one. */
export function pickedCover(
  state: CoverState,
  game: GameIdentityRef | null | undefined,
): string | undefined {
  // Most libraries have no picks; they skip the identity work entirely.
  if (!game || !hasPicks(state.customCoverArt)) return undefined;
  return usable(
    state.customCoverArt[pickedCoverKey(state, game)],
    useUnavailableCovers.getState().urls,
  );
}

/** An emulator mapping names its game only once it is decided. */
export function mappingGameRef(
  mapping: Pick<EmulatorMapping, "gameId" | "source" | "igdbId" | "gameName">,
): GameIdentityRef | null {
  return mapping.gameId === undefined
    ? null
    : {
        gameId: mapping.gameId,
        source: mapping.source,
        igdbId: mapping.igdbId,
        gameName: mapping.gameName,
      };
}

/** The cover to draw for a game: the picked one, else its own. */
export function useCoverUrl(
  game: GameIdentityRef | null | undefined,
  coverUrl: string | null | undefined,
): string {
  const unavailable = useUnavailableCovers((state) => state.urls);
  const picked = useAppStore((state) => pickedCover(state, game));
  return picked ?? usable(coverUrl, unavailable) ?? "";
}

/** useCoverUrl for lists: one subscription, then a lookup per game. */
export function useCoverLookup() {
  const customCoverArt = useAppStore((state) => state.customCoverArt);
  const gameMetadata = useAppStore((state) => state.gameMetadata);
  const exeCache = useAppStore((state) => state.exeCache);
  const libraryImports = useAppStore((state) => state.libraryImports);
  const unavailable = useUnavailableCovers((state) => state.urls);
  return useCallback(
    (game: GameIdentityRef | null, coverUrl: string | null | undefined) =>
      pickedCover(
        { customCoverArt, gameMetadata, exeCache, libraryImports },
        game,
      ) ??
      usable(coverUrl, unavailable) ??
      "",
    [customCoverArt, exeCache, gameMetadata, libraryImports, unavailable],
  );
}

/** For callers that already hold the identity key (History, Achievements). */
export function usePickedCovers() {
  const picks = useAppStore((state) => state.customCoverArt);
  const unavailable = useUnavailableCovers((state) => state.urls);
  return useMemo(
    () =>
      unavailable.size === 0
        ? picks
        : Object.fromEntries(
            Object.entries(picks).filter(([, url]) => !unavailable.has(url)),
          ),
    [picks, unavailable],
  );
}
