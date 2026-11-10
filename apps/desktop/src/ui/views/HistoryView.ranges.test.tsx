// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getSessionGameKey } from "../../historyStats";
import { STORAGE_KEY } from "../../persistence";
import { useAppStore } from "../../store";
import { resetGameColors } from "../charts/gameColors";
import { HistoryView } from "./HistoryView";

/* Plan: docs/history-ranges-plan.md (numbers are its sentences). Today is
   Friday, 6 Nov 2026, 21:40 in Berlin. The history starts on 10 Sep 2026. */
const NOW = Date.parse("2026-11-06T21:40:00+01:00");

beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});

let root: Root;
let container: HTMLDivElement;

function played(
  id: number,
  game: "Witcher" | "Hades",
  startedAt: string,
  minutes: number,
): Session {
  return {
    id,
    gameId: game === "Witcher" ? -1 : -2,
    source: "custom",
    gameName: game,
    coverUrl: `${game.toLowerCase()}.jpg`,
    exeName: `${game}.exe`,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
  };
}

// September: 3h. October: 7h 30m (+150%), a two-day streak on 3–4 Oct and
// the busiest day on 17 Oct (3h 30m, two games). November so far: 2h.
const sessions = [
  played(1, "Hades", "2026-09-10T20:00:00+02:00", 120),
  played(2, "Hades", "2026-09-12T20:00:00+02:00", 60),
  played(3, "Witcher", "2026-10-03T20:00:00+02:00", 180),
  played(4, "Witcher", "2026-10-04T20:00:00+02:00", 60),
  played(5, "Witcher", "2026-10-17T18:00:00+02:00", 120),
  played(6, "Hades", "2026-10-17T21:00:00+02:00", 90),
  played(7, "Witcher", "2026-11-02T20:00:00+01:00", 60),
  played(8, "Witcher", "2026-11-06T19:00:00+01:00", 60),
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ recentSessions: sessions });
  resetGameColors();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const plain = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim();

async function render() {
  await act(() => root.render(<HistoryView />));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => {
    (element as HTMLElement).click();
  });
}

const rangeLabel = () =>
  plain(container.querySelector("[data-history-range]")?.textContent);

const chips = () => [
  ...container.querySelectorAll<HTMLButtonElement>(
    '[role="group"][aria-label="Range"] button',
  ),
];

const chip = (text: string) =>
  chips().find((button) => plain(button.textContent) === text);

const byLabel = (label: string, root: ParentNode = container) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const picker = () =>
  document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Pick dates"]',
  );

const inPicker = (text: string) =>
  [...(picker()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => plain(button.textContent) === text,
  );

const inContainer = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => plain(button.textContent) === text,
  );

/** Charts measure their width with a ResizeObserver; happy-dom has none. */
function stubWidth(width = 900) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        private readonly callback: (
          entries: Array<{ contentRect: { width: number } }>,
        ) => void,
      ) {}
      observe() {
        this.callback([{ contentRect: { width } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

const pickerDay = (label: string) =>
  picker()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("tabs", () => {
  const selectedTab = () =>
    container.querySelector('[role="tab"][aria-selected="true"]')?.id;
  const panel = (id: string) =>
    container.querySelector(
      `[role="tabpanel"][aria-labelledby="history-tab-${id}"]`,
    );

  // 31
  it("opens on Insights", async () => {
    await render();
    await settle();
    expect(selectedTab()).toBe("history-tab-insights");
    expect(panel("insights")).not.toBeNull();
    expect(panel("sessions")).toBeNull();
  });

  // Phil 2026-11-10: the tab viewed last is saved in the settings, so it
  // survives a restart.
  it("opens on the tab viewed last, also after a restart", async () => {
    await render();
    await click(container.querySelector("#history-tab-games"));
    await settle();
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.historyTab,
    ).toBe("games");
    await act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(selectedTab()).toBe("history-tab-games");
  });

  it("saves a tab picked with the arrow keys too", async () => {
    await render();
    const tablist = container.querySelector('[role="tablist"]')!;
    await act(async () => {
      tablist.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(selectedTab()).toBe("history-tab-sessions");
    expect(useAppStore.getState().settings.historyTab).toBe("sessions");
  });

  // Phil 2026-11-10: a game picked elsewhere still opens Sessions, and that
  // doesn't replace the tab the player picked.
  it("opens Sessions for a picked game even with another tab saved", async () => {
    useAppStore.getState().setHistoryTab("games");
    const witcher = sessions.find((session) => session.gameName === "Witcher")!;
    useAppStore
      .getState()
      .setHistoryGameKey(getSessionGameKey(witcher), "Witcher");
    await render();
    expect(selectedTab()).toBe("history-tab-sessions");
    expect(useAppStore.getState().settings.historyTab).toBe("games");
  });

  // Phil 2026-11-10: the stats guide still opens its own tab, without
  // replacing the saved one.
  it("lets the stats guide open its tab without saving it", async () => {
    useAppStore.getState().setHistoryTab("games");
    // step 2 of the stats guide is "charts"
    useAppStore.setState({
      activeTour: {
        tourId: "stats",
        stepIndex: 2,
        returnView: "history",
        enteredStepAt: NOW,
      },
    });
    await render();
    expect(selectedTab()).toBe("history-tab-insights");
    expect(useAppStore.getState().settings.historyTab).toBe("games");
  });

  // 31: the banner menu and a session's journal set the game
  it("opens Sessions for a game picked elsewhere", async () => {
    const witcher = sessions.find((session) => session.gameName === "Witcher")!;
    useAppStore
      .getState()
      .setHistoryGameKey(getSessionGameKey(witcher), "Witcher");
    await render();
    expect(selectedTab()).toBe("history-tab-sessions");
    expect(panel("insights")).toBeNull();
    expect(plain(panel("sessions")?.textContent)).not.toContain("Hades");
  });

  // 31 + 33–34: the filter goes to the search box, not next to Sort
  it("opens Sessions from a highlight about a game, with the game in the search box", async () => {
    await render();
    await click(container.querySelector('button[data-highlight="mostPlayed"]'));
    expect(selectedTab()).toBe("history-tab-sessions");
    const state = useAppStore.getState();
    expect(state.historyGameName).toBe("Witcher");
    expect(state.historyQuery).toBe("");
    expect(byLabel("Clear game filter")).toBeNull();
    // Escape still drops it
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      );
    });
    expect(useAppStore.getState().historyGameKey).toBeNull();
    expect(useAppStore.getState().historyGameName).toBeNull();
  });
});

describe("range chips with arrows", () => {
  // 1–4
  it("steps This month back month by month and returns by its name", async () => {
    await render();
    expect(chips().map((button) => plain(button.textContent))).toEqual([
      "All time",
      "This month",
      "30 days",
      "7 days",
      "Today",
      "Pick dates",
    ]);
    await click(chip("This month"));
    expect(rangeLabel()).toBe("This month");
    expect(byLabel("Next period")?.disabled).toBe(true);

    await click(byLabel("Previous period"));
    expect(rangeLabel()).toBe("October 2026");
    expect(byLabel("Next period")?.disabled).toBe(false);

    await click(byLabel("Previous period"));
    expect(rangeLabel()).toBe("September 2026");
    // the history starts in September
    expect(byLabel("Previous period")?.disabled).toBe(true);

    await click(chip("September 2026"));
    expect(rangeLabel()).toBe("This month");
  });

  // 2
  it("steps Today back to Yesterday and then by date", async () => {
    await render();
    await click(chip("Today"));
    await click(byLabel("Previous period"));
    expect(rangeLabel()).toBe("Yesterday");
    await click(byLabel("Previous period"));
    expect(rangeLabel()).toBe("Wed, Nov 4");
  });

  // 14
  it("names the days on show above the timeline strip", async () => {
    await render();
    const stripLabel = () =>
      plain(container.querySelector("[data-strip-label]")?.textContent);
    expect(stripLabel()).toBe("All time · 58 days");
    await click(chip("30 days"));
    expect(stripLabel()).toBe("Oct 8 – Nov 6 · 30 days");
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    expect(stripLabel()).toBe("October 2026 · 31 days");
  });

  // 12: Phil's young install, 8 days of history
  it("draws a young history as day bars over the last 30 days", async () => {
    stubWidth();
    useAppStore.setState({
      recentSessions: [
        played(1, "Witcher", "2026-10-30T20:00:00+01:00", 120),
        played(2, "Witcher", "2026-11-04T20:00:00+01:00", 60),
      ],
    });
    await render();
    const bars = [
      ...container.querySelectorAll<HTMLElement>("[data-strip-bar]"),
    ];
    expect(bars).toHaveLength(30);
    // 8 Oct to 6 Nov: the played days are 30 Oct and 4 Nov
    expect(
      bars.flatMap((bar, index) =>
        parseFloat(bar.style.height) > 0 ? [index] : [],
      ),
    ).toEqual([22, 27]);
    // 900px for 30 days: each bar fills its ~30px slot, 2px apart (25 Oct
    // has 25 hours, so its slot is a little wider)
    const box = (bar: HTMLElement) => ({
      left: parseFloat(bar.style.left),
      width: parseFloat(bar.style.width),
    });
    for (let index = 1; index < bars.length; index += 1) {
      const before = box(bars[index - 1]);
      expect(box(bars[index]).left - (before.left + before.width)).toBeCloseTo(
        2,
        5,
      );
      expect(before.width).toBeGreaterThan(27);
    }
  });

  // 12: All time's window never starts in the middle of a bar
  it("puts All time's window over whole bars", async () => {
    stubWidth();
    // since Wednesday, 3 June: week bars from Monday, 1 June
    useAppStore.setState({
      recentSessions: [
        played(1, "Witcher", "2026-06-03T20:00:00+02:00", 120),
        played(2, "Witcher", "2026-11-04T20:00:00+01:00", 60),
      ],
    });
    await render();
    const stripWindow = container.querySelector<HTMLElement>(
      "[data-strip-window]",
    );
    expect(parseFloat(stripWindow!.style.left)).toBe(0);

    // a young history: from its first day, not from the empty days before
    useAppStore.setState({
      recentSessions: [played(3, "Witcher", "2026-10-30T20:00:00+01:00", 120)],
    });
    await settle();
    const bars = [
      ...container.querySelectorAll<HTMLElement>("[data-strip-bar]"),
    ];
    expect(
      parseFloat(
        container.querySelector<HTMLElement>("[data-strip-window]")!.style.left,
      ),
    ).toBeCloseTo(parseFloat(bars[22].style.left) - 1, 5);
  });

  it("has no arrows on All time", async () => {
    await render();
    expect(byLabel("Previous period")).toBeNull();
    expect(rangeLabel()).toBe("All time");
  });
});

describe("Pick dates", () => {
  // 5, 8, 11
  it("picks two days, shows what they hold and steps the span by its length", async () => {
    await render();
    await click(chip("Pick dates"));
    expect(picker()).not.toBeNull();
    await click(pickerDay("Saturday, October 3, 2026"));
    await click(pickerDay("Monday, October 19, 2026"));
    expect(
      plain(picker()?.querySelector("[data-picker-summary]")?.textContent),
    ).toBe("Oct 3 – 19 · 17 days · 7h 30m played");
    await click(inPicker("Show"));
    expect(picker()).toBeNull();
    expect(rangeLabel()).toBe("Oct 3 – 19");
    expect(chip("Oct 3 – 19")).toBeDefined();

    await click(byLabel("Next period"));
    expect(rangeLabel()).toBe("Oct 20 – Nov 5");
  });

  // 6, 8
  it("takes a whole month by its name, as that month", async () => {
    await render();
    await click(chip("Pick dates"));
    await click(inPicker("October 2026"));
    await click(inPicker("Show"));
    expect(rangeLabel()).toBe("October 2026");
    // it is the This month chip's period now, with its arrows
    expect(chip("October 2026")?.dataset.chip).toBe("month");
  });

  // 7
  it("applies a quick pick at once", async () => {
    await render();
    await click(chip("Pick dates"));
    await click(inPicker("Last week"));
    expect(picker()).toBeNull();
    expect(rangeLabel()).toBe("Last week");
  });

  // 9
  it("picks everything between two months in the Months tab", async () => {
    await render();
    await click(chip("Pick dates"));
    await click(inPicker("Months"));
    await click(picker()?.querySelector('button[data-month="2026-09"]'));
    await click(picker()?.querySelector('button[data-month="2026-10"]'));
    await click(inPicker("Show"));
    expect(rangeLabel()).toBe("Sep – Oct 2026");
  });

  // 11
  it("closes without a change on Cancel and on Escape", async () => {
    await render();
    await click(chip("Pick dates"));
    await click(pickerDay("Saturday, October 3, 2026"));
    await click(inPicker("Cancel"));
    expect(picker()).toBeNull();
    expect(rangeLabel()).toBe("All time");

    await click(chip("Pick dates"));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(picker()).toBeNull();
    expect(rangeLabel()).toBe("All time");
  });
});

describe("hero", () => {
  // 17
  it("says how much more or less than the period before", async () => {
    await render();
    expect(container.textContent).not.toContain("more than");
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    expect(
      plain(container.querySelector("[data-history-compare]")?.textContent),
    ).toBe("150% more than September 2026");
    await click(byLabel("Previous period"));
    // nothing was played in August
    expect(container.querySelector("[data-history-compare]")).toBeNull();
  });

  // 19
  it("opens the busiest day and the best streak", async () => {
    await render();
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    await click(container.querySelector('button[data-highlight="busiestDay"]'));
    expect(rangeLabel()).toBe("Sat, Oct 17");

    await click(chip("Sat, Oct 17"));
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    await click(container.querySelector('button[data-highlight="bestStreak"]'));
    expect(rangeLabel()).toBe("Oct 3 – 4");
  });
});

describe("Insights", () => {
  async function openInsights() {
    const tab = container.querySelector<HTMLElement>("#history-tab-insights");
    await click(tab);
    await settle();
  }
  const headings = () =>
    [...container.querySelectorAll("h2")].map((heading) =>
      plain(heading.textContent),
    );

  // 20 + 23
  it("stacks the chart by game and shows the Pace next to the calendar", async () => {
    await render();
    await openInsights();
    expect(headings()).not.toContain("Pace");
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    expect(headings()).toContain("Pace");
    const legend = plain(
      container.querySelector("[data-chart-legend]")?.textContent,
    );
    expect(legend).toContain("Witcher 6h 0m");
    expect(legend).toContain("Hades 1h 30m");
  });

  const coverCells = () => container.querySelectorAll("[data-cover-day]");
  const coverDays = () =>
    container.querySelectorAll("[data-cover-day]:not([data-out])");
  const coverMonth = () =>
    plain(container.querySelector("[data-cover-month]")?.textContent);

  // 24 + 25: a long range, a month at a time
  it("pages a long range month by month, from its last month", async () => {
    await render();
    await openInsights();
    expect(headings()).toContain("Cover calendar");
    expect(headings()).not.toContain("Activity calendar");
    // All time is 10 Sep to 6 Nov: November first
    expect(coverMonth()).toBe("November 2026");
    expect(byLabel("Next month")?.disabled).toBe(true);
    // 1 Nov is a Sunday, 30 Nov a Monday: Monday 26 Oct to Sunday 6 Dec
    expect(coverCells()).toHaveLength(42);
    expect(coverCells()[0].getAttribute("data-cover-day")).toBe("2026-10-26");
    // 1–6 Nov count; 26–31 Oct belong to October's page, the rest is ahead
    expect(coverDays()).toHaveLength(6);
    await click(byLabel("Previous month"));
    expect(coverMonth()).toBe("October 2026");
    expect(coverDays()).toHaveLength(31);
    // October needs five weeks, but every page has six while paging
    expect(coverCells()).toHaveLength(42);
    expect(coverCells()[0].getAttribute("data-cover-day")).toBe("2026-09-28");
    await click(byLabel("Previous month"));
    expect(coverMonth()).toBe("September 2026");
    // the history starts on 10 Sep
    expect(coverDays()).toHaveLength(21);
    expect(byLabel("Previous month")?.disabled).toBe(true);
  });

  // 25: a range inside one month shows that whole month
  it("shows a month's own weeks and a clicked day in its whole month", async () => {
    await render();
    await openInsights();
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    expect(container.querySelector("[data-cover-month]")).toBeNull();
    // October 2026 runs from Thursday the 1st: Monday 28 Sep to Sunday 1 Nov
    const cells = coverCells();
    expect(cells).toHaveLength(35);
    expect(cells[0].getAttribute("data-cover-day")).toBe("2026-09-28");
    expect(
      container.querySelectorAll("[data-cover-day][data-out]"),
    ).toHaveLength(4);
    // 17 Oct: Witcher 2h, Hades 1h 30m
    const busiest = container.querySelector<HTMLButtonElement>(
      'button[data-cover-day="2026-10-17"]',
    );
    expect(busiest?.querySelector("img")?.getAttribute("src")).toBe(
      "witcher.jpg",
    );
    // the day, its playtime, one more game
    expect(
      [...(busiest?.querySelectorAll("span") ?? [])]
        .map((span) => plain(span.textContent))
        .filter(Boolean),
    ).toEqual(["17", "3h 30m", "+1"]);
    await click(busiest);
    expect(rangeLabel()).toBe("Sat, Oct 17");
    // still all of October, the 17th the only day that counts
    expect(coverCells()).toHaveLength(35);
    expect(coverDays()).toHaveLength(1);
    expect(coverCells()[0].getAttribute("data-cover-day")).toBe("2026-09-28");
    expect(container.querySelector("[data-cover-month]")).toBeNull();
  });

  // 25: Today and This month show the whole month; 7 and 30 days reach into
  // October, so they page from November
  it("shows short ranges in their whole month, paging into the month before", async () => {
    await render();
    await openInsights();
    await click(chip("Today"));
    // Monday 26 Oct to Sunday 6 Dec, only today counts
    expect(coverCells()).toHaveLength(42);
    expect(coverCells()[0].getAttribute("data-cover-day")).toBe("2026-10-26");
    expect(coverDays()).toHaveLength(1);
    expect(container.querySelector("[data-cover-month]")).toBeNull();
    await click(chip("This month"));
    expect(coverCells()).toHaveLength(42);
    expect(coverDays()).toHaveLength(6);
    expect(container.querySelector("[data-cover-month]")).toBeNull();
    // 31 Oct to 6 Nov
    await click(chip("7 days"));
    expect(coverMonth()).toBe("November 2026");
    expect(byLabel("Next month")?.disabled).toBe(true);
    expect(coverDays()).toHaveLength(6);
    await click(byLabel("Previous month"));
    expect(coverMonth()).toBe("October 2026");
    expect(coverCells()).toHaveLength(42);
    expect(coverDays()).toHaveLength(1);
    expect(byLabel("Previous month")?.disabled).toBe(true);
    // 8 Oct to 6 Nov
    await click(chip("30 days"));
    expect(coverMonth()).toBe("November 2026");
    await click(byLabel("Previous month"));
    expect(coverDays()).toHaveLength(24);
  });

  const sideHeadings = () =>
    [
      ...(container
        .querySelector("[data-history-side]")
        ?.querySelectorAll("h2") ?? []),
    ].map((heading) => plain(heading.textContent));

  // 26
  it("puts When you play under Play habits on All time, below the calendar otherwise", async () => {
    await render();
    await openInsights();
    expect(headings()).toContain("When you play");
    expect(sideHeadings()).toEqual(["Play habits", "When you play"]);
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    expect(headings()).toContain("When you play");
    expect(sideHeadings()).toEqual(["Pace", "Play habits"]);
    await click(chip("Today"));
    expect(sideHeadings()).toEqual(["Pace", "Play habits"]);
  });

  const seasonNames = () =>
    [
      ...container.querySelectorAll("[data-season-lane] [data-season-name]"),
    ].map((name) => plain(name.textContent));

  // 27 + 29
  it("shows game seasons from a week up and opens a game's sessions", async () => {
    await render();
    await openInsights();
    expect(headings()).toContain("Game seasons");
    // Witcher 8h, Hades 4h 30m
    expect(seasonNames()).toEqual(["Witcher", "Hades"]);
    await click(chip("Today"));
    expect(container.textContent).toContain(
      "Pick at least a week to see your seasons.",
    );
    await click(chip("All time"));
    await click(
      container.querySelector(
        '[data-season-lane] button[title="Show sessions of this game"]',
      ),
    );
    expect(
      container
        .querySelector("#history-tab-sessions")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    // 33–34: the filter shows in the search box, not next to Sort
    expect(useAppStore.getState().historyGameName).toBe("Witcher");
    expect(byLabel("Clear game filter")).toBeNull();
  });

  // 27 + 30
  it("draws a bar per day on one scale for all lanes, with Mondays on the axis", async () => {
    stubWidth();
    await render();
    await openInsights();
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    const bars = (lane: number) =>
      [
        ...container
          .querySelectorAll("[data-season-lane]")
          [lane].querySelectorAll("rect[data-season-day]"),
      ].map((bar) => ({
        day: bar.getAttribute("data-season-day"),
        height: Number(bar.getAttribute("height")),
      }));
    const witcher = bars(0);
    const hades = bars(1);
    expect(witcher.map((bar) => bar.day)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-17",
    ]);
    expect(hades.map((bar) => bar.day)).toEqual(["2026-10-17"]);
    // Witcher 3h, 1h and 2h; Hades 1h 30m
    expect(witcher[1].height / witcher[0].height).toBeCloseTo(1 / 3, 2);
    expect(hades[0].height / witcher[0].height).toBeCloseTo(1 / 2, 2);
    expect(
      [...container.querySelectorAll("[data-season-axis] span")].map((tick) =>
        plain(tick.textContent),
      ),
    ).toEqual(["Oct 1", "Oct 5", "Oct 12", "Oct 19", "Oct 26"]);
  });

  // 28
  it("shows the eight most played games and the rest on demand", async () => {
    // Game 1 played most: ten hours, down to one hour for Game 10
    useAppStore.setState({
      recentSessions: Array.from({ length: 10 }, (_, index) => {
        const startedAt = `2026-10-${20 + index}T18:00:00+02:00`;
        return {
          id: 100 + index,
          gameId: -(10 + index),
          source: "custom" as const,
          gameName: `Game ${index + 1}`,
          exeName: `game${index + 1}.exe`,
          startedAt,
          endedAt: new Date(
            Date.parse(startedAt) + (10 - index) * 3_600_000,
          ).toISOString(),
          durationSeconds: (10 - index) * 3600,
        };
      }),
    });
    await render();
    await openInsights();
    expect(seasonNames()).toHaveLength(8);
    expect(seasonNames()[0]).toBe("Game 1");
    await click(inContainer("Show all 10 games"));
    expect(seasonNames()).toHaveLength(10);
    expect(
      container.querySelectorAll("[data-season-lane][data-thin]"),
    ).toHaveLength(2);
    await click(inContainer("Show fewer"));
    expect(seasonNames()).toHaveLength(8);
  });
});
