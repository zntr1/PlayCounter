import type { StoreApi } from "zustand";
import { getT } from "../i18n";
import { journalHiddenIn, shelfHides } from "../personalLibrary";
import type { PersonalLibraryState } from "../personalLibraryStore";
import { getGameJournal, type GameIdentityRef } from "../store";

const t = getT("dialogs");

/** Puts a game on a shelf it is not on yet, from its card menu. When that
 *  takes the game out of All games, a toast says so and offers Undo. */
export function putGameOnShelf(
  libraryApi: StoreApi<PersonalLibraryState>,
  game: GameIdentityRef,
  shelfId: string,
) {
  const state = libraryApi.getState();
  const shelf = state.personalShelves.find((entry) => entry.id === shelfId);
  if (!shelf) return;
  const journal = getGameJournal(state, game);
  const leavesAllGames =
    shelfHides(shelf, "all") &&
    !journalHiddenIn(journal, state.personalShelves, "all");
  state.updateGameJournal(game, { shelfIds: [...journal.shelfIds, shelf.id] });
  if (!leavesAllGames) return;
  state.addToast({
    tone: "success",
    title: t("Added to {{shelf}}. It's hidden from All games now.", {
      shelf: shelf.name,
    }),
    detail: game.gameName,
    action: {
      label: t("Undo"),
      run: () => {
        const current = libraryApi.getState();
        current.updateGameJournal(game, {
          shelfIds: getGameJournal(current, game).shelfIds.filter(
            (id) => id !== shelf.id,
          ),
        });
      },
    },
  });
}
