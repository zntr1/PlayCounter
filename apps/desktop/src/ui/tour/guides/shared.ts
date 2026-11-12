import { TOUR_DEMO_GAME, TOUR_GTA_GAME_ID } from "../tourDemoGame";

/** The version the next release gets. Guides written or reworked for it carry
 *  it as their release, so What's new and the Help menu can show them as new. */
export const NEXT_RELEASE = "1.7.0";

/** Selector for an element marked `data-tour="name"`. */
export const a = (name: string) => `[data-tour="${name}"]`;

// Both practice games share the card marker. Keep WoW-specific instructions
// attached to WoW when dragging hides it or a shelf filters it out.
export const libraryTourCard = `${a("demo-game-card")}[data-tour-game-id="${TOUR_DEMO_GAME.gameId}"]`;
export const gtaTourCard = `${a("demo-game-card")}[data-tour-game-id="${TOUR_GTA_GAME_ID}"]`;

// The practice review reuses Discovered's buttons; scope them to the sample.
export const discoveredAction = (name: string) =>
  `${a("demo-discovery")} ${a(`discovered-${name}`)}`;

/** Dialogs the sample card's menu can open. A step that lets the player try
 *  the menu freely follows whichever is open, before its own menu item. */
export const sampleCardDialogs = [
  a("demo-game-details"),
  a("demo-game-name-dialog"),
  a("demo-report-dialog"),
  a("demo-match-check-dialog"),
  a("demo-remove-dialog"),
  a("demo-ignore-dialog"),
  a("demo-game-action-dialog"),
  a("demo-sample-search"),
  a("demo-adjust-dialog"),
  a("demo-log-session-dialog"),
  a("demo-action-result"),
];

/** Everything a free-practice step on the sample card may touch: the card,
 *  its menu with every flyout, and the dialogs behind them. */
export const sampleCardAllow = [
  a("demo-game-card"),
  a("demo-context-menu"),
  a("demo-playtime-menu"),
  a("demo-launch-menu"),
  a("demo-appearance-menu"),
  a("demo-matching-menu"),
  a("demo-status-menu"),
  a("demo-tier-menu"),
  a("demo-shelf-menu"),
  a("demo-library-menu"),
  a("demo-library-modal"),
  a("demo-log-session-backdrop"),
  a("demo-action-result"),
];
