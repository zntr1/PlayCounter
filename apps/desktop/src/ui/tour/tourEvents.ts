import type { TourEventName } from "./tourTypes";

export const TOUR_EVENT = "playcounter:tour-event";

/** Tells a running guide what the player just did in a practice surface. */
export function emitTourEvent(name: TourEventName, message?: string) {
  window.dispatchEvent(
    new CustomEvent(TOUR_EVENT, { detail: { name, message } }),
  );
}
