// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import {
  armControllerBridge,
  disposeControllerBridge,
  initializeControllerBridge,
} from "../../controllerBridge";
import { useAppStore } from "../../store";
import { LibraryTestShell } from "./libraryTestShell";

/* Y opens a game's Details from its card, B closes it: the ring is back on
   the same card, so the player goes on from where they were. The pad's
   input reaches the app outside React, so the steps here run on React's
   own schedule (no act()), like in the app. */

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const DATE = "2026-10-24T12:00:00.000Z";
const games = ["Hades", "Celeste", "Inside"].map((name, index) => ({
  exeName: `${name}.exe`,
  state: "matched" as const,
  gameId: -(index + 1),
  gameName: name,
  coverUrl: "",
  source: "custom" as const,
  identifierSource: "custom" as const,
  lastCheckedAt: DATE,
}));

let root: Root;
let container: HTMLDivElement;
let controllerHandler: (event: {
  payload: { action: string; at: number };
}) => void;

beforeEach(() => {
  localStorage.clear();
  // happy-dom lays nothing out: every element counts as rendered.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  // Nor does it compute opacity or visibility (""), which the controller
  // reads to skip hidden items.
  const style = window.getComputedStyle.bind(window);
  vi.stubGlobal("getComputedStyle", (element: Element) =>
    new Proxy(style(element), {
      get: (target, key) =>
        key === "opacity"
          ? target.opacity || "1"
          : key === "visibility"
            ? target.visibility || "visible"
            : Reflect.get(target, key),
    }),
  );
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    controllerHandler = handler as typeof controllerHandler;
    return () => {};
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: true,
      controllerNavigationEnabled: true,
      libraryShowShelves: false,
    },
    manualLaunchTargets: new Map(
      games.map((game) => [
        `${game.gameId}:custom`,
        {
          exeName: game.exeName,
          path: `C:/Games/${game.exeName}`,
          owner: { gameId: game.gameId, source: "custom" as const },
        },
      ]),
    ),
  });
  for (const game of games) useAppStore.getState().setExeCacheEntry(game);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  initializeControllerBridge();
  armControllerBridge();
});

afterEach(async () => {
  disposeControllerBridge();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(() => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function input(action: string) {
  controllerHandler({ payload: { action, at: Date.now() } });
}

/** Lets React's scheduler and a few animation frames run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

const card = (name: string) =>
  [...container.querySelectorAll<HTMLElement>(".game-library-card")].find(
    (element) => element.getAttribute("aria-label")?.startsWith(name),
  )!;
const detailsOpen = () =>
  document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

it("brings the ring back to the same card when B closes the Details Y opened", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // StrictMode like main.tsx: in development it runs effects twice.
  await act(() =>
    root.render(
      <StrictMode>
        <LibraryTestShell />
      </StrictMode>,
    ),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  for (const element of document.querySelectorAll<HTMLElement>("*"))
    element.scrollIntoView = vi.fn();
  // The ring on Celeste's card, like after walking to it.
  card("Celeste").focus();
  card("Celeste").setAttribute("data-controller-selected", "true");

  input("openDetails");
  await settle();
  expect(detailsOpen()).toBe(true);

  input("back");
  await settle();
  expect(detailsOpen()).toBe(false);
  expect(document.activeElement).toBe(card("Celeste"));
  expect(card("Celeste").getAttribute("data-controller-selected")).toBe(
    "true",
  );
});
