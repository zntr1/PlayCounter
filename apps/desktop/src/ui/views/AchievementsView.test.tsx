// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AwardedMilestone } from "../../milestones";
import { useAppStore } from "../../store";
import { AchievementsView } from "./AchievementsView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ activeView: "achievements" });
  container = document.createElement("div");
  container.setAttribute("data-controller-content", "true");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** One earned 10h trophy per game, so every game gets its own ladder. */
function seedLadders(count: number) {
  const awards: AwardedMilestone[] = Array.from(
    { length: count },
    (_, index) => {
      const name = `Ladder game ${String(index + 1).padStart(3, "0")}`;
      return {
        id: `milestone:game:igdb#${index + 1}:10`,
        kind: "milestone-game",
        title: `10 hours played in ${name}`, // i18n-exempt: test fixture
        gameName: name,
        awardedAt: "2026-08-10T12:00:00.000Z",
      };
    },
  );
  useAppStore.setState({ awardedMilestones: awards });
}

async function openGameLadders() {
  await act(() => root.render(<AchievementsView />));
  const tab = container.querySelector<HTMLButtonElement>(
    "#achievements-tab-games",
  )!;
  await act(() => tab.click());
}

const ladderRows = () =>
  container.querySelectorAll("#achievements-panel-games article");
const ladder = (name: string) =>
  [...ladderRows()].find((row) => row.querySelector("h3")?.textContent === name);
const showMore = () =>
  [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Show more games",
  );

function stubObservers() {
  const observers: Array<{
    callback: IntersectionObserverCallback;
    options?: IntersectionObserverInit;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(
        public callback: IntersectionObserverCallback,
        public options?: IntersectionObserverInit,
      ) {
        observers.push(this);
      }
    },
  );
  const intersect = (isIntersecting = true) => {
    const observer = observers.at(-1)!;
    return act(() =>
      observer.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      ),
    );
  };
  return { observers, intersect };
}

it("shows the first 20 game ladders and the next 20 when scrolled near the end", async () => {
  const { observers, intersect } = stubObservers();
  seedLadders(45);
  await openGameLadders();

  expect(ladderRows()).toHaveLength(20);
  expect(ladder("Ladder game 020")).toBeDefined();
  expect(ladder("Ladder game 021")).toBeUndefined();
  expect(observers.at(-1)?.options?.root).toBe(container);

  // Not near the end yet: nothing more is drawn.
  await intersect(false);
  expect(ladderRows()).toHaveLength(20);

  await intersect();
  expect(ladderRows()).toHaveLength(40);
  await intersect();
  expect(ladderRows()).toHaveLength(45);
  expect(ladder("Ladder game 045")).toBeDefined();
  expect(showMore()).toBeUndefined();
});

it("loads the next 20 game ladders with Show more games", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  seedLadders(45);
  await openGameLadders();

  expect(ladderRows()).toHaveLength(20);
  await act(() => showMore()!.click());
  expect(ladderRows()).toHaveLength(40);
  await act(() => showMore()!.click());
  expect(ladderRows()).toHaveLength(45);
  expect(showMore()).toBeUndefined();
});

it("shows every ladder and no button when there are 20 or fewer", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  seedLadders(20);
  await openGameLadders();

  expect(ladderRows()).toHaveLength(20);
  expect(showMore()).toBeUndefined();
});
