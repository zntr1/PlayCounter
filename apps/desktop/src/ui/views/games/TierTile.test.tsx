// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { GAME_TIERS } from "../../../personalLibrary";
import { TIER_TONES } from "../../journalStyles";
import { TierTile } from "./GameDetailsDialog";

const game = { gameId: -1, source: "custom" as const, gameName: "Campaign" }; // i18n-exempt: sample game name
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function textColours(element: Element) {
  return [...element.classList].filter(
    (name) =>
      name.startsWith("text-") &&
      !/^text-(xs|sm|base|lg|\d?xl|left|center|right|\[\d+(\.\d+)?(px|rem|em)\])$/.test(
        name,
      ),
  );
}

it("shows your tier in Game details in its tier colour, like on the cover", async () => {
  await act(() => root.render(<TierTile game={game} />));
  for (const tier of GAME_TIERS) {
    await act(() => useAppStore.getState().setGameTier(game, tier));
    const letter = [...container.querySelectorAll("span")].find(
      (span) => span.textContent === tier,
    );
    expect(letter, tier).toBeDefined();
    expect(textColours(letter!), tier).toEqual([TIER_TONES[tier]]);
  }
});
