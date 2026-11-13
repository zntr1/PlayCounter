// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore, type ActiveSession } from "../../store";
import { ActiveGameHero } from "./ActiveGameHero";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const H = 3600;
let root: Root;
let container: HTMLDivElement;

const running: ActiveSession = {
  id: 1,
  gameId: 7,
  gameName: "Elden Ring",
  exeName: "eldenring.exe",
  coverUrl: "",
  source: "igdb",
  startedAt: "2026-11-08T10:00:00.000Z",
  checkpointedAt: "2026-11-08T11:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderHero(
  session: ActiveSession,
  props: {
    onTogglePause?: () => void;
    onStopTimer?: () => void;
    pausedForSeconds?: number;
  },
) {
  const state = useAppStore.getState();
  await act(() =>
    root.render(
      <ActiveGameHero
        session={session}
        elapsedSeconds={H + 12 * 60 + 40}
        recentSessions={[]}
        showDurationDays={false}
        exeCache={state.exeCache}
        resolveIgdbId={() => undefined}
        archivedGameSeconds={{}}
        playtimeAdjustments={{}}
        statusLabel="Now playing"
        {...props}
      />,
    ),
  );
}

const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

// docs/pause-timer-plan.md, "What the player sees".
it("a running game has a pause button next to its clock", async () => {
  const onTogglePause = vi.fn();
  await renderHero(running, { onTogglePause });
  expect(container.textContent).toContain("Now playing");
  expect(container.textContent).toContain("1:12:40");
  expect(button("Resume the timer for Elden Ring")).toBeNull();
  act(() => button("Pause the timer for Elden Ring")!.click());
  expect(onTogglePause).toHaveBeenCalledOnce();
});

it("paused: the badge says Paused, shows how long, and the button resumes", async () => {
  const onTogglePause = vi.fn();
  await renderHero(
    { ...running, pausedAt: "2026-11-08T11:12:40.000Z" },
    { onTogglePause, pausedForSeconds: 4 * 60 + 12 },
  );
  expect(container.textContent).toContain("Paused");
  expect(container.textContent).not.toContain("Now playing");
  expect(container.textContent).toContain("04:12");
  expect(button("Pause the timer for Elden Ring")).toBeNull();
  act(() => button("Resume the timer for Elden Ring")!.click());
  expect(onTogglePause).toHaveBeenCalledOnce();
});

it("a manual timer keeps its Stop next to pause", async () => {
  const onStopTimer = vi.fn();
  await renderHero(
    { ...running, timer: true },
    { onTogglePause: vi.fn(), onStopTimer },
  );
  expect(button("Pause the timer for Elden Ring")).not.toBeNull();
  act(() => button("Stop the timer for Elden Ring")!.click());
  expect(onStopTimer).toHaveBeenCalledOnce();
});
