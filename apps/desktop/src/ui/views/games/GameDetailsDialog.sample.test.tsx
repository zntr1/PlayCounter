// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

import { clearGameDetailsCache } from "../../../gameDetails";
import { useAppStore } from "../../../store";
import { TOUR_DEMO_GAME, TOUR_GTA_GAME_ID } from "../../tour/tourDemoGame";
import type { GameSummary } from "../MyGamesView";
import { GameDetailsDialog, type DetailsTab } from "./GameDetailsDialog";

/* While a guide runs, the sample game's Details shows all five tabs like a
   real, well-known game, from bundled sample data. No request leaves the app
   for it (docs/tours-plan.md, WP5). */

function summary(fields: Partial<GameSummary>): GameSummary {
  return {
    kind: "tracked",
    gameId: 1,
    name: "Game",
    coverUrl: "",
    source: "igdb",
    sources: ["igdb"],
    aliases: [],
    totalSeconds: 7_200,
    sessionSeconds: 7_200,
    archivedSeconds: 0,
    adjustmentSeconds: 0,
    recordedSeconds: 7_200,
    sessionCount: 3,
    historyGameKey: null,
    lastPlayedAt: new Date().toISOString(),
    exeNames: [],
    emulatorLabels: [],
    emulatorIds: [],
    emulatorContentKeys: [],
    libraryImports: [],
    providerFloorSeconds: 0,
    ...fields,
  };
}

// The sample card of the guides (MyGamesView's makeTourDemoGame).
const sampleGame = summary({
  kind: "tour-demo",
  gameId: TOUR_DEMO_GAME.gameId,
  name: TOUR_DEMO_GAME.name,
  coverUrl: TOUR_DEMO_GAME.coverUrl,
  source: null,
  sources: [],
  exeNames: [TOUR_DEMO_GAME.exeName],
});

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn(async (..._args: unknown[]) => {
  throw new Error("offline");
});

const store = () => useAppStore.getState();
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const tabs = () =>
  [...dialog().querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) =>
    tab.textContent?.replace(/\d+$/, "").trim(),
  );
const tab = (name: string) =>
  [...dialog().querySelectorAll<HTMLElement>('[role="tab"]')].find((entry) =>
    entry.textContent?.startsWith(name),
  ) as HTMLElement;
const panel = () => dialog().querySelector('[role="tabpanel"]') as HTMLElement;
const button = (name: string, within: ParentNode = dialog()) =>
  [...within.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === name,
  ) as HTMLButtonElement;
const rows = () => [
  ...panel().querySelectorAll<HTMLElement>("[data-achievement-row]"),
];
const options = () =>
  [...panel().querySelectorAll<HTMLElement>('[role="option"]')].map(
    (entry) => entry.textContent ?? "",
  );

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open(game: GameSummary, initialTab: DetailsTab = "general") {
  await act(async () => {
    root.render(
      <GameDetailsDialog
        game={game}
        initialTab={initialTab}
        launchKey="test"
        launchBlocked={false}
        onAcquireLaunch={() => true}
        onReleaseLaunch={() => {}}
        onClose={() => {}}
      />,
    );
  });
}
async function addCounter(name: string) {
  await click(button("Add counter"));
  const input = panel().querySelector(
    'input[aria-label="New counter, for example Wins"]',
  ) as HTMLInputElement;
  await type(input, name);
  await click(button("Add", panel()));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  clearGameDetailsCache();
  invokeMock.mockClear();
  fetchMock.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // The sample card only exists while a guide runs.
  await act(async () => store().startTour("game-actions"));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the sample game's Details", () => {
  it("has all five tabs, in the order a real game has them", async () => {
    await open(sampleGame);
    expect(tabs()).toEqual([
      "General",
      "Achievements",
      "How long to beat",
      "Files",
      "Counters",
    ]);
  });

  it("General shows a description and facts instead of “not linked to an IGDB entry”", async () => {
    await open(sampleGame);
    const text = dialog().textContent ?? "";
    expect(text).not.toContain("not linked to an IGDB entry");
    expect(text).toContain("Sanctuary");
    for (const fact of [
      "Genres",
      "Role-playing (RPG)",
      "Modes",
      "Platforms",
      "Developer",
      "Publisher",
      "Blizzard Entertainment",
      "Released",
    ])
      expect(text, fact).toContain(fact);
    // Your summary still comes from the sample card.
    expect(text).toContain("Total playtime");
  });

  it("How long to beat shows three sample times instead of “No time to beat known”", async () => {
    await open(sampleGame, "howLongToBeat");
    const text = panel().textContent ?? "";
    expect(text).not.toContain("No time to beat known");
    const figures = [...panel().querySelectorAll("[data-hltb-mark]")].map(
      (mark) => mark.getAttribute("data-hltb-mark"),
    );
    expect(figures).toEqual(["hastily", "normally", "completely"]);
    for (const pace of ["Main story", "Main + extras", "Completionist"])
      expect(text, pace).toMatch(
        new RegExp(`${pace.replace("+", "\\+")}\\d+h`),
      );
    expect(text).toMatch(/From [\d.,]+ players on IGDB/);
  });

  it("Files stays as it is: the sample's file name", async () => {
    await open(sampleGame, "files");
    expect(panel().textContent).toContain(TOUR_DEMO_GAME.exeName);
    expect(panel().textContent).toContain("Matches by name");
  });

  it("Achievements lists one launcher's achievements: unlocked ones with dates, and locked ones", async () => {
    await open(sampleGame, "achievements");
    // One source: no picker.
    expect(
      panel().querySelector('[role="group"][aria-label="Achievement source"]'),
    ).toBeNull();
    const all = rows();
    const unlocked = all.filter((row) => /Unlocked \d/.test(row.textContent!));
    expect(unlocked.length).toBeGreaterThanOrEqual(3);
    expect(all.length - unlocked.length).toBeGreaterThanOrEqual(3);
    await click(button(`Unlocked${unlocked.length}`, panel()));
    expect(rows()).toHaveLength(unlocked.length);
    await click(button(`Locked${all.length - unlocked.length}`, panel()));
    expect(rows()).toHaveLength(all.length - unlocked.length);
    expect(rows().some((row) => /Unlocked \d/.test(row.textContent!))).toBe(
      false,
    );
  });

  it("Achievements sorts the sample list like a real one", async () => {
    await open(sampleGame, "achievements");
    const names = () =>
      rows().map((row) => row.querySelector("h4")!.textContent);
    const newest = names();
    const select = panel().querySelector(
      'select[aria-label="Sort achievements"]',
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = "oldest";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(names()).not.toEqual(newest);
    expect([...names()].sort()).toEqual([...newest].sort());
  });

  it("Counters works on sample data and keeps it out of the real library", async () => {
    await open(sampleGame, "counters");
    expect(options().some((entry) => /^Deaths[1-9]/.test(entry))).toBe(true);
    const journals = store().gameJournals;
    await addCounter("Runs");
    expect(options().some((entry) => entry.startsWith("Runs"))).toBe(true);
    expect(store().gameJournals).toBe(journals);
    expect(store().recentSessions).toEqual([]);
    expect(store().activeSessions).toEqual([]);
  });

  it("registers no global hotkey when a sample counter gets its own key", async () => {
    await open(sampleGame, "counters");
    await click(button("Set a key", panel()));
    await act(async () => {
      button("Press a key combination…", panel()).dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Numpad1",
          key: "1",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // The sample shows the key…
    expect(panel().querySelector("kbd")?.textContent).toBe("Num 1");
    // …but nothing reached Windows or the real library.
    expect(invokeMock).not.toHaveBeenCalled();
    expect(store().gameJournals).toEqual({});
  });

  it("throws the sample counters away when the guide ends", async () => {
    await open(sampleGame, "counters");
    await addCounter("Runs");
    await act(async () => root.render(null));
    await act(async () => store().endTour("dismissed"));
    await act(async () => store().startTour("game-actions"));
    await open(sampleGame, "counters");
    expect(options().some((entry) => entry.startsWith("Runs"))).toBe(false);
    expect(options().some((entry) => entry.startsWith("Deaths"))).toBe(true);
  });

  it("sends no request, whatever the player opens or clicks", async () => {
    await open(sampleGame);
    await click(button("Open on IGDB"));
    for (const name of [
      "Achievements",
      "How long to beat",
      "Files",
      "Counters",
    ]) {
      await click(tab(name));
      for (const label of [
        "Refresh",
        "Open on HowLongToBeat",
        "Add my time on HowLongToBeat",
        "Source: IGDB",
      ]) {
        const control = button(label, panel());
        if (control) await click(control);
      }
    }
    await addCounter("Runs");
    // Requests would start in effects and timers: let them run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("other games' Details are unchanged", () => {
  it("a real game still asks the PlayCounter database for its details", async () => {
    await open(summary({ gameId: 119133, igdbId: 119133, name: "Elden Ring" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/games/details?igdbIds=119133",
    );
  });

  it("a real game without launcher achievements has no Achievements tab", async () => {
    await open(summary({ gameId: 119133, igdbId: 119133, name: "Elden Ring" }));
    expect(tabs()).toEqual([
      "General",
      "How long to beat",
      "Files",
      "Counters",
    ]);
  });

  it("an own game with the sample's id is not the sample", async () => {
    await open(
      summary({
        gameId: TOUR_DEMO_GAME.gameId,
        source: "custom",
        sources: ["custom"],
        name: "My own game",
      }),
    );
    expect(tabs()).toEqual([
      "General",
      "How long to beat",
      "Files",
      "Counters",
    ]);
    expect(dialog().textContent).toContain("This is your own entry");
  });

  it("the second sample card has no bundled details", async () => {
    await open(
      summary({
        kind: "tour-demo",
        gameId: TOUR_GTA_GAME_ID,
        name: "Grand Theft Auto V",
        source: "igdb",
      }),
    );
    expect(tabs()).toEqual(["General", "How long to beat", "Files"]);
    expect(dialog().textContent).toContain("not linked to an IGDB entry");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
