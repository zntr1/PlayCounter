// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTROLLER_BACK_EVENT } from "../../controllerBridge";
import { useAppStore } from "../../store";
import { HistoryView } from "./HistoryView";

/* My History with a controller: the pad walks the sessions, A filters the
   list by the session's game, B drops the filter (and only then leaves the
   view, see controllerBridge). */

let root: Root;
let container: HTMLDivElement;

function played(id: number, game: string, startedAt: string): Session {
  return {
    id,
    gameId: -id,
    source: "custom",
    gameName: game,
    exeName: `${game}.exe`, // i18n-exempt: sample game file
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
    durationSeconds: 3600,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "history",
    recentSessions: [
      played(1, "Hades", "2026-11-20T20:00:00Z"),
      played(2, "Celeste", "2026-11-21T20:00:00Z"),
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const rows = () => [
  ...container.querySelectorAll<HTMLElement>("[data-history-session-row]"),
];
const row = (game: string) =>
  rows().find((element) => element.getAttribute("aria-label")?.startsWith(game))!;

function pressB() {
  const back = new CustomEvent(CONTROLLER_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(back);
  });
  return back.defaultPrevented;
}

async function showSessions() {
  await act(() => root.render(<HistoryView />));
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (element) => element.textContent?.startsWith("Sessions"),
  )!;
  await act(() => tab.click());
}

it("lets the controller walk the sessions", async () => {
  await showSessions();
  expect(rows()).toHaveLength(2);
  for (const element of rows())
    expect(element.getAttribute("data-controller-item")).toBe(
      "history-session",
    );
});

it("filters by the session's game with A and drops the filter with B", async () => {
  await showSessions();
  await act(() =>
    row("Hades")
      .querySelector<HTMLElement>("[data-controller-launch]")!
      .click(),
  );
  expect(useAppStore.getState().historyGameKey).not.toBeNull();
  expect(rows().map((element) => element.getAttribute("aria-label"))).toEqual(
    [expect.stringMatching(/^Hades/)],
  );

  expect(pressB()).toBe(true);
  expect(useAppStore.getState().historyGameKey).toBeNull();
  expect(rows()).toHaveLength(2);

  // Nothing left to undo: B is the bridge's again (back to the sidebar).
  expect(pressB()).toBe(false);
});

const rangeButtons = () => [
  ...container.querySelectorAll<HTMLElement>(
    '[role="group"][aria-label="Range"] button',
  ),
];
const byText = (text: string) =>
  rangeButtons().find((button) => button.textContent?.trim() === text)!;

it("lets the controller pick a range, but leaves Pick dates and the stepper arrows to the mouse", async () => {
  await showSessions();
  for (const button of rangeButtons()) {
    const pickDates = button.textContent?.includes("Pick dates");
    expect(button.getAttribute("data-controller-item"), button.textContent).toBe(
      pickDates ? null : "history-filter",
    );
  }
  expect(byText("Pick dates")).toBeDefined();

  // A picked range turns its chip into a stepper; the ring follows the key.
  const monthKey = byText("This month").getAttribute("data-controller-key");
  expect(monthKey).toBeTruthy();
  await act(() => byText("This month").click());
  const label = container.querySelector<HTMLElement>(
    `[data-controller-key="${monthKey}"]`,
  )!;
  expect(label.getAttribute("data-controller-item")).toBe("history-filter");
  // The stepper's arrows stay the mouse's.
  for (const name of ["Previous period", "Next period"])
    expect(
      container
        .querySelector(`[aria-label="${name}"]`)!
        .hasAttribute("data-controller-item"),
    ).toBe(false);
});
