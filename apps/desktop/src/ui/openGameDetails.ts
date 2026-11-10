import type { GameSource } from "@playcounter/shared";
import { create } from "zustand";
import { useAppStore } from "../store";
import type { DetailsTab } from "./views/games/GameDetailsDialog";

export type GameDetailsRequest = {
  gameId: number;
  source: GameSource | null;
  tab: DetailsTab;
};

/** A game whose Details should open. My Games opens it with the card's own
 *  dialogs, not on the card: the grid builds only its first cards, and a
 *  search, filter, tab or shelf may hide the game's card. */
export const useGameDetailsRequest = create<{
  request: GameDetailsRequest | null;
}>(() => ({ request: null }));

/** The game's Details, over the page that asks (the banner's "More Info"). */
export function openGameDetails(
  game: { gameId: number; source?: GameSource | null },
  tab: DetailsTab = "general",
) {
  useGameDetailsRequest.setState({
    request: { gameId: game.gameId, source: game.source ?? null, tab },
  });
}

/** "Counters" on Now Playing: My Games, with the game's Details on Counters. */
export function openGameCounters(game: {
  gameId: number;
  source?: GameSource | null;
}) {
  openGameDetails(game, "counters");
  useAppStore.getState().setActiveView("games");
}
