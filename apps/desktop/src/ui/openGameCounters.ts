import type { GameSource } from "@playcounter/shared";
import { create } from "zustand";
import { useAppStore } from "../store";

/** A game whose Details should open on Counters. My Games opens the dialog
 *  itself, so a search or filter that hides the game's card doesn't matter. */
export const useGameCountersRequest = create<{
  request: { gameId: number; source: GameSource | null } | null;
}>(() => ({ request: null }));

/** "Counters" on Now Playing: My Games, with the game's Details on Counters. */
export function openGameCounters(game: {
  gameId: number;
  source?: GameSource | null;
}) {
  useGameCountersRequest.setState({
    request: { gameId: game.gameId, source: game.source ?? null },
  });
  useAppStore.getState().setActiveView("games");
}
