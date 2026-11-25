// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTROLLER_DETAILS_EVENT } from "../../controllerBridge";
import { useAppStore } from "../../store";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const DATE = "2026-10-24T12:00:00.000Z";
const HADES = {
  exeName: "Hades.exe",
  state: "matched" as const,
  gameId: -1,
  gameName: "Hades",
  coverUrl: "",
  source: "custom" as const,
  identifierSource: "custom" as const,
  lastCheckedAt: DATE,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: true,
      libraryShowShelves: false,
    },
    manualLaunchTargets: new Map([
      [
        `${HADES.gameId}:custom`,
        {
          exeName: HADES.exeName,
          path: `C:/Games/${HADES.exeName}`,
          owner: { gameId: HADES.gameId, source: "custom" as const },
        },
      ],
    ]),
  });
  useAppStore.getState().setExeCacheEntry(HADES);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = () => container.querySelector<HTMLElement>(".game-library-card")!;
const detailsOpen = () =>
  [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(
    (dialog) => dialog.textContent?.includes("Hades"),
  );

async function showView(label: string) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
      .click(),
  );
}

it.each([["Grid view"], ["Large card view"], ["Covers view"], ["List view"]])(
  "puts a Details button with the Y glyph beside Play in the %s",
  async (view) => {
    await act(() => root.render(<LibraryTestShell />));
    await showView(view);

    const details = card().querySelector<HTMLButtonElement>(
      '.details-key-hint[aria-label="Open details for Hades"]',
    );
    expect(details).not.toBeNull();
    expect(details!.querySelector("img")).not.toBeNull();
    expect(detailsOpen()).toBe(false);
    await act(async () => details!.click());
    expect(detailsOpen()).toBe(true);
  },
);

it.each([["Grid view"], ["Covers view"]])(
  "names the Details button beside Set launch file too in the %s",
  async (view) => {
    useAppStore.setState({ manualLaunchTargets: new Map() });
    await act(() => root.render(<LibraryTestShell />));
    await showView(view);

    expect(card().textContent).toContain("Set launch file");
    const details = card().querySelector<HTMLButtonElement>(
      '.details-key-hint[aria-label="Open details for Hades"]',
    );
    expect(details!.textContent).toBe("Details");
  },
);

it.each([["Grid view"], ["Large card view"], ["Covers view"], ["List view"]])(
  "names the Details button beside Play in the %s",
  async (view) => {
    await act(() => root.render(<LibraryTestShell />));
    await showView(view);

    const details = card().querySelector<HTMLButtonElement>(
      '.details-key-hint[aria-label="Open details for Hades"]',
    );
    expect(details!.textContent).toBe("Details");
  },
);

it.each([["Grid view"], ["Covers view"], ["List view"]])(
  "opens Details when the controller's Y reaches the card in the %s",
  async (view) => {
    await act(() => root.render(<LibraryTestShell />));
    await showView(view);
    await act(async () => {
      card().dispatchEvent(new CustomEvent(CONTROLLER_DETAILS_EVENT));
    });
    expect(detailsOpen()).toBe(true);
  },
);
