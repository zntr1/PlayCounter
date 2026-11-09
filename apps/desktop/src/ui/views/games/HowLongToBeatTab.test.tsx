// @vitest-environment happy-dom
import type { GameDetails, Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
const detailsState = vi.hoisted(() => ({
  value: { status: "empty" } as unknown,
}));
vi.mock("../../../gameDetails", () => ({
  useGameDetails: () => detailsState.value,
}));

import { commitLibraryImports } from "../../../library/commit";
import { appLocale } from "../../../i18n";
import { getGameJournal, useAppStore } from "../../../store";
import { MyGamesView } from "../MyGamesView";

/* docs/howlongtobeat-plan.md, route A, with Phil's picks of 2026-11-06: its
   own "How long to beat" tab in the game details, HowLongToBeat's names for
   IGDB's three numbers, a bar with three marks, no prompt after finishing,
   and a playthrough picker that drives both the numbers and the values. */

const H = 3_600;
const NAME = "Elden Ring";
const IGDB_ID = 119133;
const GAME = {
  gameId: 1,
  source: "igdb" as const,
  igdbId: IGDB_ID,
  gameName: NAME,
};
const IMPORTED_AT = "2026-08-01T12:00:00.000Z";
// Sample numbers, not IGDB's.
const TIME_TO_BEAT = {
  hastilySeconds: 52 * H,
  normallySeconds: 85 * H,
  completelySeconds: 133 * H,
  count: 1204,
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
      gameLaunchingEnabled: false,
      libraryShowShelves: false,
    },
  });
  invokeMock.mockResolvedValue(undefined);
  detailsState.value = { status: "empty" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  invokeMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function details(fields: Partial<GameDetails> = {}) {
  detailsState.value = {
    status: "ready",
    details: {
      igdbId: IGDB_ID,
      developers: [],
      publishers: [],
      genres: [],
      gameModes: [],
      platforms: [],
      ...fields,
    } satisfies GameDetails,
  };
}

function importFromSteam() {
  commitLibraryImports([
    {
      entry: {
        provider: "steam",
        externalId: "1245620",
        gameId: 1,
        igdbId: IGDB_ID,
        source: "igdb",
        name: NAME,
        coverUrl: "",
        importedAt: IMPORTED_AT,
        lastReadAt: IMPORTED_AT,
        providerSeconds: 0,
        linkedExeNames: [],
        linkedExeSources: [],
      },
      metadata: {
        id: 1,
        igdbId: IGDB_ID,
        name: NAME,
        coverUrl: "",
        source: "igdb",
      },
      exeCacheEntries: [],
      scopedLinks: [],
    },
  ]);
}

let nextSessionId = 1;
function played(
  startedAt: string,
  seconds: number,
  playthroughId?: string,
): Session {
  return {
    id: nextSessionId++,
    gameId: 1,
    igdbId: IGDB_ID,
    source: "igdb",
    gameName: NAME,
    coverUrl: "",
    exeName: "eldenring.exe", // i18n-exempt: sample game file
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + seconds * 1000).toISOString(),
    durationSeconds: seconds,
    ...(playthroughId ? { playthroughId } : {}),
  };
}

const day = (iso: string) => new Date(iso).toLocaleDateString(appLocale());

async function openTab() {
  await act(() => root.render(<MyGamesView />));
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open details for ${NAME}"]`,
      )!
      .click(),
  );
  const tab = document.querySelector<HTMLButtonElement>(
    "#game-details-tab-howLongToBeat",
  );
  expect(tab?.textContent).toBe("How long to beat");
  await act(() => tab!.click());
}

const panel = () =>
  document.querySelector("#game-details-panel-howLongToBeat")!;
const panelText = () => panel().textContent ?? "";
const picker = () => panel().querySelector('[role="radiogroup"]');
const runButton = (name: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (button) => button.textContent?.includes(name),
  );
const value = (label: string) =>
  panel().querySelector(`[data-hltb-value="${label}"]`)?.textContent ?? "";
const button = (text: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === text,
  );

describe("its own tab", () => {
  it("sits after Achievements and before Files (Phil, 2026-11-07)", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    await openTab();

    const tabs = [...document.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.id,
    );
    expect(tabs).toEqual([
      "game-details-tab-general",
      "game-details-tab-achievements",
      "game-details-tab-howLongToBeat",
      "game-details-tab-files",
      // docs/counters-plan.md: Counters comes last.
      "game-details-tab-counters",
    ]);
  });

  it("shows IGDB's numbers in HowLongToBeat's words", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    useAppStore.setState({
      recentSessions: [played("2026-10-30T18:00:00.000Z", 42 * H + 13 * 60)],
    });
    await openTab();

    expect(panelText()).toContain("Main story52h");
    expect(panelText()).toContain("Main + extras85h");
    expect(panelText()).toContain("Completionist133h");
    expect(panelText()).toContain("From 1,204 players on IGDB");
  });

  it("counts down to the next of the three marks", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    useAppStore.setState({
      recentSessions: [played("2026-10-30T18:00:00.000Z", 42 * H + 13 * 60)],
    });
    await openTab();

    // 52h - 42h 13m = 9h 47m, said in whole hours.
    expect(panelText()).toContain("About 10h to Main story");
    // The bubble on the bar has the played time, so the line leaves it out.
    expect(panelText()).not.toContain("played ·");
    expect(panel().querySelectorAll("[data-hltb-mark]")).toHaveLength(3);
  });

  it("puts a bobble head at the end of the bar with the time on top (Phil's pick A, 2026-11-07)", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    useAppStore.setState({
      recentSessions: [played("2026-10-30T18:00:00.000Z", 42 * H + 13 * 60)],
    });
    await openTab();

    expect(panel().querySelector("[data-hltb-knob]")).not.toBeNull();
    expect(panel().querySelector("[data-hltb-played]")?.textContent).toBe(
      "42h 13m",
    );
  });

  it("says so without numbers and still opens HowLongToBeat, by name", async () => {
    importFromSteam();
    details();
    useAppStore.setState({
      recentSessions: [played("2026-10-30T18:00:00.000Z", 3 * H)],
    });
    await openTab();

    expect(panelText()).toContain("No time to beat known for this game yet.");
    // Without HowLongToBeat's id there is no form to open, only the search.
    expect(button("Add my time on HowLongToBeat")).toBeUndefined();
    await act(() =>
      [...panel().querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open on HowLongToBeat")!
        .click(),
    );
    expect(invokeMock).toHaveBeenCalledWith("open_external_url", {
      url: "https://howlongtobeat.com/?q=Elden%20Ring",
    });
  });
});

describe("adding your time", () => {
  it("lists the run's values and opens the game's HowLongToBeat page", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    useAppStore.setState({
      recentSessions: [
        played("2026-10-01T18:00:00.000Z", 40 * H),
        played("2026-10-30T18:00:00.000Z", 2 * H + 13 * 60),
      ],
    });
    await openTab();

    // One playthrough: nothing to pick.
    expect(picker()).toBeNull();
    expect(value("platform")).toContain("PC");
    expect(value("store")).toContain("Steam");
    expect(value("time")).toContain("42 h 13 min 0 s");
    expect(value("started")).toContain(day("2026-10-01T18:00:00.000Z"));
    expect(value("finished")).toContain("Not finished yet");

    await act(() => button("Open on HowLongToBeat")!.click());
    expect(invokeMock).toHaveBeenCalledWith("open_external_url", {
      url: "https://howlongtobeat.com/game/68151",
    });
  });

  it("opens HowLongToBeat's form for the game to add the time there", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    useAppStore.setState({
      recentSessions: [played("2026-10-30T18:00:00.000Z", 42 * H)],
    });
    await openTab();

    await act(() => button("Add my time on HowLongToBeat")!.click());
    expect(invokeMock).toHaveBeenCalledWith("open_external_url", {
      url: "https://howlongtobeat.com/submit/game/68151",
    });
  });

  it("dates a finished game without named playthroughs by its last session", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    const last = played("2026-09-20T18:00:00.000Z", 40 * H);
    useAppStore.setState({
      recentSessions: [played("2026-09-01T18:00:00.000Z", 50 * H), last],
    });
    useAppStore.getState().updateGameJournal(GAME, { status: "finished" });
    await openTab();

    expect(panelText()).toContain("Finished · average 85h");
    expect(value("finished")).toContain(day(last.endedAt!));
    expect(value("finished")).toContain("Your last session");
  });
});

/* Phil's pick 2026-11-07 (docs/howlongtobeat-finish-mockups.html, A): a
   "Mark finished" toggle in the "Finished on" row that does what the journal
   does. A second click undoes it. */
describe("marking it finished", () => {
  const journal = () => getGameJournal(useAppStore.getState(), GAME);

  it("finishes the default playthrough by setting the game's status, dated by its last session", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    const last = played("2026-10-30T18:00:00.000Z", 2 * H);
    useAppStore.setState({
      recentSessions: [played("2026-10-01T18:00:00.000Z", 40 * H), last],
    });
    await openTab();
    expect(value("finished")).toContain("Not finished yet");

    await act(() => button("Mark finished")!.click());

    expect(journal().status).toBe("finished");
    expect(value("finished")).toContain(day(last.endedAt!));
    expect(panelText()).toContain("Finished · average 85h");
    expect(button("Finished")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("a second click puts back the status the game had before", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    useAppStore.setState({
      recentSessions: [played("2026-10-30T18:00:00.000Z", 42 * H)],
    });
    useAppStore.getState().updateGameJournal(GAME, { status: "on-hold" });
    await openTab();

    await act(() => button("Mark finished")!.click());
    await act(() => button("Finished")!.click());

    expect(journal().status).toBe("on-hold");
    expect(value("finished")).toContain("Not finished yet");
  });

  it("undoing a finish from before the tab opened sets In progress", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    useAppStore.setState({
      recentSessions: [played("2026-10-30T18:00:00.000Z", 42 * H)],
    });
    useAppStore.getState().updateGameJournal(GAME, { status: "finished" });
    await openTab();

    await act(() => button("Finished")!.click());

    expect(journal().status).toBe("playing");
  });

  it("finishes a named playthrough today, as the journal does, and a second click reopens it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T15:00:00.000Z"));
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    const ngPlus = useAppStore.getState().createPlaythrough(GAME, "NG+")!;
    useAppStore.setState({
      recentSessions: [played("2026-11-04T18:00:00.000Z", 5 * H, ngPlus)],
    });
    await openTab();
    // NG+ is the only playthrough with hours, so the tab is about it.
    expect(value("time")).toContain("5 h 0 min 0 s");

    await act(() => button("Mark finished")!.click());

    const finished = journal().playthroughs.find(({ id }) => id === ngPlus);
    expect(finished?.completedAt).toBe("2026-11-07T15:00:00.000Z");
    // The journal's rule: finishing a playthrough makes the default one active.
    expect(journal().activePlaythroughId).toBeNull();
    expect(journal().status).toBeNull();
    expect(value("finished")).toContain(day("2026-11-07T15:00:00.000Z"));

    await act(() => button("Finished")!.click());

    expect(
      journal().playthroughs.find(({ id }) => id === ngPlus)?.completedAt,
    ).toBeNull();
  });
});

describe("picking the playthrough", () => {
  it("starts on the one you played last, and a pick changes the numbers and the values", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    // First run in the default playthrough, finished in September; then a
    // new playthrough, NG+, played this week.
    useAppStore.getState().updateGameJournal(GAME, { status: "finished" });
    const ngPlus = useAppStore.getState().createPlaythrough(GAME, "NG+")!;
    useAppStore.setState({
      recentSessions: [
        played("2026-09-01T18:00:00.000Z", 50 * H),
        played("2026-09-20T18:00:00.000Z", 40 * H),
        played("2026-11-04T18:00:00.000Z", 5 * H, ngPlus),
      ],
    });
    await openTab();

    expect(picker()).not.toBeNull();
    expect(runButton("NG+")?.getAttribute("aria-checked")).toBe("true");
    expect(panelText()).toContain("About 47h to Main story");
    expect(value("time")).toContain("5 h 0 min 0 s");

    await act(() => runButton("Default playthrough")!.click());

    expect(runButton("Default playthrough")?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(panelText()).toContain("Finished · average 85h");
    expect(value("time")).toContain("90 h 0 min 0 s");
    expect(value("started")).toContain(day("2026-09-01T18:00:00.000Z"));
  });

  it("starts on a playthrough you just finished, though finishing made the default one active", async () => {
    importFromSteam();
    details({ timeToBeat: TIME_TO_BEAT, hltbId: 68151 });
    const first = useAppStore.getState().createPlaythrough(GAME, "First run")!;
    useAppStore.setState({
      recentSessions: [
        played("2026-08-02T18:00:00.000Z", 1 * H),
        played("2026-10-20T18:00:00.000Z", 60 * H, first),
      ],
    });
    useAppStore.getState().updatePlaythrough(GAME, first, {
      completedAt: "2026-10-23T12:00:00.000Z",
    });
    await openTab();

    expect(runButton("First run")?.getAttribute("aria-checked")).toBe("true");
    expect(panelText()).toContain("Finished · average 85h");
    expect(value("finished")).toContain(day("2026-10-23T12:00:00.000Z"));
  });
});
