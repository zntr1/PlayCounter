// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../../../tracker");

import { journalCounters } from "../../../counters";
import { getGameJournal, useAppStore } from "../../../store";
import type { GameSummary } from "../MyGamesView";
import { GameCountersTab } from "./GameCountersTab";

/* docs/counters-details-mockups.html, layout B (Phil's pick, 2026-11-09):
   the counters on the left, the picked one on the right with its figures, a
   chart of the last 12 sessions and the play settings as labelled rows. */

const eldenRing = {
  gameId: 119133,
  source: "igdb" as const,
  igdbId: 119133,
  gameName: "Elden Ring",
  coverUrl: "",
};
const game = { ...eldenRing, name: "Elden Ring" } as unknown as GameSummary;

/** 14 one-hour sessions, a day apart; `deaths[i]` in each (0 = none). */
const DEATHS = [9, 9, 31, 18, 22, 0, 44, 27, 12, 35, 23, 40, 29, 23];
function sessions(malenia: string): Session[] {
  return DEATHS.map((deaths, index) => ({
    ...eldenRing,
    id: index + 10,
    exeName: "eldenring.exe",
    startedAt: new Date(Date.UTC(2026, 9, 1 + index, 18)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 9, 1 + index, 19)).toISOString(),
    durationSeconds: 3600,
    ...(deaths || index === 13
      ? {
          counts: {
            ...(deaths ? { deaths } : {}),
            ...(index === 13 ? { [malenia]: 12 } : {}),
          },
        }
      : {}),
  })) as Session[];
}

let root: Root;
let container: HTMLDivElement;
let malenia: string;
let runes: string;

const store = () => useAppStore.getState();
const counter = (id: string) =>
  journalCounters(getGameJournal(store(), eldenRing)).find((c) => c.id === id);
const options = () =>
  [...container.querySelectorAll('[role="option"]')] as HTMLElement[];
const option = (name: string) =>
  options().find((el) => el.textContent?.includes(name)) as HTMLElement;
const detail = () =>
  container.querySelector('[data-counter-detail]') as HTMLElement;
const button = (name: string, within: ParentNode = container) =>
  [...within.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === name,
  ) as HTMLButtonElement;
const figure = (label: string) =>
  [...detail().querySelectorAll("[data-figure]")]
    .find((el) => el.textContent?.startsWith(label))
    ?.textContent?.slice(label.length)
    .trim();
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}
async function render() {
  await act(async () => {
    root.render(<GameCountersTab game={game} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  malenia = store().addGameCounter(eldenRing, "Malenia") as string;
  runes = store().addGameCounter(eldenRing, "Rune arcs used") as string;
  store().updateGameCounter(eldenRing, runes, { shown: false });
  useAppStore.setState({ recentSessions: sessions(malenia) });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Game Details → Counters (list + detail)", () => {
  it("lists the shown counters with this playthrough's number, then the hidden ones under their own heading", async () => {
    await render();
    expect(options().map((el) => el.textContent)).toEqual([
      "Malenia12",
      "Deaths322",
      "Rune arcs used0",
    ]);
    const list = container.querySelector('[role="listbox"]') as HTMLElement;
    expect(list.textContent).toContain("Hidden · 1");
    // The heading sits between the shown and the hidden ones.
    expect(list.textContent?.indexOf("Hidden · 1")).toBeGreaterThan(
      list.textContent?.indexOf("Deaths") ?? -1,
    );
    expect(list.textContent?.indexOf("Hidden · 1")).toBeLessThan(
      list.textContent?.indexOf("Rune arcs used") ?? -1,
    );
  });

  it("has no hidden heading when every counter is shown", async () => {
    store().updateGameCounter(eldenRing, runes, { shown: true });
    await render();
    expect(container.textContent).not.toContain("Hidden ·");
  });

  it("opens on the first counter and shows the one you pick on the right", async () => {
    await render();
    expect(option("Malenia").getAttribute("aria-selected")).toBe("true");
    expect(detail().querySelector("h4")?.textContent).toBe("Malenia");
    await click(option("Deaths"));
    expect(option("Deaths").getAttribute("aria-selected")).toBe("true");
    expect(option("Malenia").getAttribute("aria-selected")).toBe("false");
    expect(detail().querySelector("h4")?.textContent).toBe("Deaths");
  });

  it("shows the picked counter's four figures", async () => {
    await render();
    await click(option("Deaths"));
    expect(figure("This playthrough")).toBe("322");
    expect(figure("All playthroughs")).toBe("322");
    // 322 deaths in the 13 one-hour sessions that counted it.
    expect(figure("Per hour played")).toBe("24.8");
    expect(figure("Most in one session")).toMatch(/^44/);
  });

  it("draws the last 12 sessions of the playthrough, oldest first, a session without a count as an empty bar", async () => {
    await render();
    await click(option("Deaths"));
    expect(detail().textContent).toContain("Last 12 sessions");
    const bars = [...detail().querySelectorAll("[data-session-bar]")];
    expect(bars.map((bar) => bar.getAttribute("data-session-bar"))).toEqual(
      DEATHS.slice(2).map(String),
    );
    // The most is marked.
    expect(
      bars.filter((bar) => bar.hasAttribute("data-most")).map((bar) =>
        bar.getAttribute("data-session-bar"),
      ),
    ).toEqual(["44"]);
  });

  it("says how many sessions the chart has when there are fewer than 12, and leaves it out without sessions", async () => {
    useAppStore.setState({ recentSessions: sessions(malenia).slice(0, 3) });
    await render();
    expect(detail().textContent).toContain("Last 3 sessions");
    expect(detail().querySelectorAll("[data-session-bar]")).toHaveLength(3);
    await act(async () => {
      useAppStore.setState({ recentSessions: [] });
    });
    expect(detail().querySelectorAll("[data-session-bar]")).toHaveLength(0);
    expect(detail().textContent).not.toContain("sessions");
  });

  it("hides and shows a counter with the switch “Show in the live timer and on Now Playing”", async () => {
    await render();
    const toggle = () =>
      detail().querySelector(
        'input[aria-label="Show in the live timer and on Now Playing"]',
      ) as HTMLInputElement;
    expect(toggle().checked).toBe(true);
    await click(toggle());
    expect(counter(malenia)?.shown).toBe(false);
    expect(toggle().checked).toBe(false);
    // Still picked, now under Hidden.
    expect(detail().querySelector("h4")?.textContent).toBe("Malenia");
    expect(container.textContent).toContain("Hidden · 2");
    await click(toggle());
    expect(counter(malenia)?.shown).toBe(true);
  });

  it("sets the own key: Set a key, press it, and it shows with Change and Remove", async () => {
    await render();
    expect(detail().textContent).toContain(
      "Counts Malenia while Elden Ring runs.",
    );
    await click(button("Set a key", detail()));
    await act(async () => {
      button("Press a key combination…", detail()).dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Numpad1",
          key: "1",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(counter(malenia)?.key).toBe("Numpad1");
    expect(detail().querySelector("kbd")?.textContent).toBe("Num 1");
    expect(button("Change", detail())).toBeTruthy();
    await click(button("Remove", detail()));
    expect(counter(malenia)?.key).toBeUndefined();
    expect(button("Set a key", detail())).toBeTruthy();
  });

  it("shows the controller row only with “Count with controller” on, one counter per game", async () => {
    await render();
    expect(detail().textContent).not.toContain("View + D-pad up");
    await act(async () => {
      useAppStore.setState({
        settings: { ...store().settings, controllerCountingEnabled: true },
      });
    });
    const toggle = () =>
      detail().querySelector(
        'input[aria-label="Count with View + D-pad up"]',
      ) as HTMLInputElement;
    expect(detail().textContent).toContain("One counter per game.");
    // Deaths has it until it is moved.
    expect(toggle().checked).toBe(false);
    await click(toggle());
    expect(getGameJournal(store(), eldenRing).controllerCounterId).toBe(
      malenia,
    );
    await click(option("Deaths"));
    expect(toggle().checked).toBe(false);
  });

  it("renames in place", async () => {
    await render();
    await click(button("Rename", detail()));
    const input = detail().querySelector(
      'input[aria-label="Counter name"]',
    ) as HTMLInputElement;
    expect(input.value).toBe("Malenia");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "Malenia, Blade of Miquella");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(counter(malenia)?.name).toBe("Malenia, Blade of Miquella");
    expect(detail().querySelector("h4")?.textContent).toBe(
      "Malenia, Blade of Miquella",
    );
  });

  it("asks before deleting, then shows the next counter", async () => {
    await render();
    await click(button("Delete", detail()));
    expect(counter(malenia)).toBeTruthy();
    expect(document.body.textContent).toContain("Delete Malenia?");
    await click(button("Delete counter", document.body));
    expect(counter(malenia)).toBeUndefined();
    expect(detail().querySelector("h4")?.textContent).toBe("Deaths");
  });

  it("picks a new counter right away", async () => {
    await render();
    await click(button("Add counter"));
    const input = container.querySelector(
      'input[aria-label="New counter, for example Malenia"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "Radagon");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Add"));
    expect(detail().querySelector("h4")?.textContent).toBe("Radagon");
    expect(option("Radagon").getAttribute("aria-selected")).toBe("true");
  });

  it("says which key takes a press back, as a key cap, with the way to Settings", async () => {
    await render();
    expect(container.textContent).toContain(
      "Pressed a key by mistake? Set a key for “Take one back” to undo it.",
    );
    await act(async () => {
      useAppStore.setState({
        settings: { ...store().settings, counterUndoHotkey: "Control+Alt+KeyZ" },
      });
    });
    const line = container.querySelector("[data-undo-line]") as HTMLElement;
    expect(line.textContent).toContain(
      "Pressed a key by mistake? Ctrl+Alt+Z takes the last one back.",
    );
    expect(line.querySelector("kbd")?.textContent).toBe("Ctrl+Alt+Z");
    expect(button("Keyboard shortcuts", line)).toBeTruthy();
  });

  it("needs no legend for icons any more", async () => {
    await render();
    expect(container.textContent).not.toContain("The eye shows a counter");
    expect(container.querySelector("table")).toBeNull();
  });
});
