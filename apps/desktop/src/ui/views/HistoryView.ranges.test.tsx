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

const pickerDay = (label: string) =>
  picker()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

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

  // 25
  it("shows a month as a cover calendar, one day and All time as the activity calendar", async () => {
    await render();
    await openInsights();
    expect(headings()).toContain("Activity calendar");
    await click(chip("This month"));
    await click(byLabel("Previous period"));
    expect(headings()).toContain("Cover calendar");
    expect(headings()).not.toContain("Activity calendar");
    // October 2026 runs from Thursday the 1st: Monday 28 Sep to Sunday 1 Nov
    const cells = container.querySelectorAll("[data-cover-day]");
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
    expect(headings()).toContain("Activity calendar");
  });

  // 24
  it("opens a day clicked in the activity calendar", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(
          private readonly callback: (
            entries: Array<{ contentRect: { width: number } }>,
          ) => void,
        ) {}
        observe() {
          this.callback([{ contentRect: { width: 900 } }]);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    await render();
    await openInsights();
    await click(byLabel("Saturday, October 17, 2026: 3h 30m"));
    expect(rangeLabel()).toBe("Sat, Oct 17");
  });
});
