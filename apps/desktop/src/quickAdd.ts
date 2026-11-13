import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getT } from "./i18n";
import { searchLibraryGames } from "./library/gameLookup";
import { addGameWithoutFile } from "./library/manualAdd";
import { inMyGames, myGamesKeys } from "./library/myGamesKeys";
import { nativeText } from "./nativeText";
import { currentPlatform } from "./platform";
import { boxLook } from "./quickNote";
import { useAppStore, type GameMetadata } from "./store";
import { linkServerKnownFiles } from "./tracker";

const t = getT("overlays");
const tDialogs = getT("dialogs");
const tSettings = getT("settings");

/* Quick add (docs/quick-add-plan.md) ─────────────────────────────────────────
   The hotkey opens the note box window as a search box. The box only shows
   and sends: the main window searches, tells it which results are already in
   My Games, and adds the picked game the way Add game does without a file. */

export const QUICK_ADD_SEARCH_EVENT = "playcounter:quick-add-search";
export const QUICK_ADD_PICK_EVENT = "playcounter:quick-add-pick";

/** A search result as the box shows it. */
export type QuickAddGame = {
  igdbId: number;
  name: string;
  coverUrl: string | null;
  releaseYear: number | null;
  /** Already in My Games: the box says so instead of adding it. */
  inLibrary: boolean;
};

/** The main window's answer to a search, or to a pick. */
export type QuickAddReply =
  | { kind: "results"; query: string; games: QuickAddGame[] }
  | { kind: "error"; query: string; message: string }
  | { kind: "added"; igdbId: number }
  | { kind: "already"; igdbId: number };

export type QuickAddLabel =
  | "Quick add game"
  | "Search by game title or IGDB ID"
  | "Search results"
  | "Searching…"
  | "In your library"
  | "{{name}} is already in your library."
  | "No matching games found. Try the English title or another spelling."
  | "Enter searches · Enter again adds · ↑↓ picks · Esc closes"
  | "Cancel"
  | "Add game"
  | "{{name}} added"
  | "It's in My Games now.";

/** What the box gets. It has no i18n of its own: its texts come along, keyed
 *  by their English. */
export type QuickAddPayload = {
  quickAdd: true;
  labels: Partial<Record<QuickAddLabel, string>>;
  monitor?: string | null;
  locale?: string | null;
  theme: "dark" | "light";
  accentColor: string | null;
  reducedMotion: boolean;
};

function quickAddLabels(): Record<QuickAddLabel, string> {
  return {
    "Quick add game": tSettings("Quick add game"),
    "Search by game title or IGDB ID": tDialogs(
      "Search by game title or IGDB ID",
    ),
    "Search results": tDialogs("Search results"),
    "Searching…": tDialogs("Searching…"),
    "In your library": tDialogs("In your library"),
    // The box fills in the name itself.
    "{{name}} is already in your library.": tDialogs(
      "{{name}} is already in your library.",
      { name: "{{name}}" },
    ),
    "No matching games found. Try the English title or another spelling.":
      tDialogs(
        "No matching games found. Try the English title or another spelling.",
      ),
    "Enter searches · Enter again adds · ↑↓ picks · Esc closes": t(
      "Enter searches · Enter again adds · ↑↓ picks · Esc closes",
    ),
    Cancel: t("Cancel"),
    "Add game": tDialogs("Add game"),
    "{{name}} added": tDialogs("{{name}} added", { name: "{{name}}" }),
    "It's in My Games now.": t("It's in My Games now."),
  };
}

/** The quick add hotkey: the box over whatever is in front, game or not. */
export function openQuickAdd() {
  if (currentPlatform() === "macos") return;
  const payload: QuickAddPayload = {
    quickAdd: true,
    labels: quickAddLabels(),
    ...boxLook(),
  };
  void invoke("quick_note_open", { payload }).catch((error) =>
    console.error("quick add failed to open", error),
  );
}

function reply(next: QuickAddReply) {
  return invoke("quick_add_reply", { reply: next }).catch((error) =>
    console.error("quick add reply failed", error),
  );
}

let searchController: AbortController | null = null;
/** The last search's games, for the pick that follows it. */
let lastResults: GameMetadata[] = [];

/** The same search as Add game. A newer search cancels this one. */
export async function searchQuickAdd(query: string) {
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  try {
    const games = await searchLibraryGames(
      useAppStore.getState().settings.apiEndpoint,
      query,
      { signal: controller.signal, mainGamesAndRemastersOnly: false },
    );
    if (controller.signal.aborted) return;
    lastResults = games;
    const keys = myGamesKeys(useAppStore.getState());
    await reply({
      kind: "results",
      query,
      games: games.map((game) => ({
        // Every search result has one: parseLibraryGameMetadata refuses
        // a game without it.
        igdbId: game.igdbId!,
        name: game.name,
        coverUrl: game.coverUrl || null,
        releaseYear: game.releaseYear ?? null,
        inLibrary: inMyGames(keys, game),
      })),
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    await reply({
      kind: "error",
      query,
      message: nativeText(
        error instanceof Error ? error.message : String(error),
      ),
    });
  }
}

/** Adds the picked game like Add game without a file: no status, and the
 *  files the server knows for it are linked. A game already in My Games stays
 *  as it is. */
export async function pickQuickAdd(igdbId: number) {
  const game = lastResults.find((found) => found.igdbId === igdbId);
  if (!game) return;
  if (
    inMyGames(myGamesKeys(useAppStore.getState()), game) ||
    !addGameWithoutFile(game)
  ) {
    await reply({ kind: "already", igdbId });
    return;
  }
  await reply({ kind: "added", igdbId });
  await linkServerKnownFiles(game);
}

let lifecycle: { disposed: boolean; unlisten?: UnlistenFn } | null = null;

/** Answers what the box sends. */
export function initializeQuickAdd() {
  if (lifecycle) return;
  const state: { disposed: boolean; unlisten?: UnlistenFn } = {
    disposed: false,
  };
  lifecycle = state;
  void Promise.all([
    listen<{ query: string }>(QUICK_ADD_SEARCH_EVENT, ({ payload }) => {
      if (!state.disposed) void searchQuickAdd(payload.query);
    }),
    listen<{ igdbId: number }>(QUICK_ADD_PICK_EVENT, ({ payload }) => {
      if (!state.disposed) void pickQuickAdd(payload.igdbId);
    }),
  ])
    .then((handlers) => {
      const unlisten = () => handlers.forEach((handler) => handler());
      if (state.disposed) unlisten();
      else state.unlisten = unlisten;
    })
    .catch((error) => console.error("quick add listener failed", error));
}

export function disposeQuickAdd() {
  if (!lifecycle) return;
  lifecycle.disposed = true;
  lifecycle.unlisten?.();
  lifecycle = null;
  searchController?.abort();
  searchController = null;
}
