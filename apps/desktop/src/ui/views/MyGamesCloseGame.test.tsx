// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore, type ActiveSession } from "../../store";
import { closeRunningGame, launchGame } from "../../tracker";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const DATE = "2026-10-24T12:00:00.000Z";
let root: Root;
let container: HTMLDivElement;

const game = (gameId: number, gameName: string) => ({
  exeName: `${gameName}.exe`,
  state: "matched" as const,
  gameId,
  gameName,
  coverUrl: "",
  source: "custom" as const,
  identifierSource: "custom" as const,
  lastCheckedAt: DATE,
});
const HADES = game(-1, "Hades");
const CELESTE = game(-2, "Celeste");
const running = (overrides: Partial<ActiveSession> = {}): ActiveSession => ({
  id: 7,
  gameId: HADES.gameId,
  gameName: HADES.gameName,
  exeName: HADES.exeName,
  coverUrl: "",
  source: "custom",
  startedAt: DATE,
  checkpointedAt: DATE,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
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
    manualLaunchTargets: new Map(
      [HADES, CELESTE].map((entry) => [
        `${entry.gameId}:custom`,
        {
          exeName: entry.exeName,
          path: `C:/Games/${entry.exeName}`,
          owner: { gameId: entry.gameId, source: "custom" as const },
        },
      ]),
    ),
  });
  useAppStore.getState().setExeCacheEntry(HADES);
  useAppStore.getState().setExeCacheEntry(CELESTE);
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

function card(name: string) {
  return [...container.querySelectorAll(".game-library-card")].find((item) =>
    item.textContent?.includes(name),
  )!;
}

function stopButton(name: string) {
  return card(name).querySelector<HTMLButtonElement>(
    `[aria-label="Stop ${name}"]`,
  );
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
}

it("offers a red Stop on a running game's card, behind a confirmation", async () => {
  vi.mocked(closeRunningGame).mockResolvedValue("closed");
  useAppStore.setState({ activeSessions: [running()] });
  await act(() => root.render(<LibraryTestShell />));

  expect(card("Hades").textContent).toContain("Running");
  const stop = stopButton("Hades")!;
  expect(stop.textContent).toContain("Stop");
  expect(stop.title).toBe("Stop game");
  expect(stop.hasAttribute("data-controller-stop")).toBe(true);
  // Red as it is on hover, also before any hover.
  expect(stop.classList.contains("bg-danger-solid")).toBe(true);
  expect(stop.classList.contains("text-white")).toBe(true);
  expect(stopButton("Celeste")).toBeNull();

  await act(async () => stop.click());
  expect(document.body.textContent).toContain("Stop Hades?");
  expect(closeRunningGame).not.toHaveBeenCalled();
  await act(async () => button("Stop game")!.click());
  expect(closeRunningGame).toHaveBeenCalledWith(7, false);
});

it("says Stop in the list view too", async () => {
  useAppStore.setState({ activeSessions: [running()] });
  await act(() => root.render(<LibraryTestShell />));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="List view"]')!
      .click(),
  );
  const stop = container.querySelector<HTMLButtonElement>(
    '[aria-label="Stop Hades"]',
  );
  expect(stop?.title).toBe("Stop game");
});

it("offers no Stop for a timer: nothing runs on this PC", async () => {
  useAppStore.setState({ activeSessions: [running({ timer: true })] });
  await act(() => root.render(<LibraryTestShell />));
  expect(stopButton("Hades")).toBeNull();
});

it("asks to stop the running game before Play starts another one", async () => {
  vi.mocked(launchGame).mockResolvedValue("launched");
  useAppStore.setState({ activeSessions: [running()] });
  await act(() => root.render(<LibraryTestShell />));

  const play = card("Celeste").querySelector<HTMLButtonElement>(
    '[aria-label="Play Celeste"]',
  )!;
  await act(async () => play.click());
  expect(document.body.textContent).toContain("Hades is running");
  expect(launchGame).not.toHaveBeenCalled();

  await act(async () => button("Start Celeste anyway")!.click());
  expect(closeRunningGame).not.toHaveBeenCalled();
  expect(launchGame).toHaveBeenCalledOnce();
});

it("starts right away when no other game runs", async () => {
  vi.mocked(launchGame).mockResolvedValue("launched");
  useAppStore.setState({ activeSessions: [running({ timer: true })] });
  await act(() => root.render(<LibraryTestShell />));

  await act(async () =>
    card("Celeste")
      .querySelector<HTMLButtonElement>('[aria-label="Play Celeste"]')!
      .click(),
  );
  expect(document.body.textContent).not.toContain("is running");
  expect(launchGame).toHaveBeenCalledOnce();
});
