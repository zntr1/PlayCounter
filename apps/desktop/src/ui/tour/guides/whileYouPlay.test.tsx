// @vitest-environment happy-dom
/* "While you play": the sample session of Now Playing can be paused and
   resumed (the step then finishes by itself), a sample timer can be stopped
   and answers with a sample result, and no real session is touched. The
   steps about the live timer, the reminder and the keys ring single rows of
   Settings, and are skipped where a computer doesn't have them. */
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { value: "windows" as "windows" | "macos" | "linux" },
}));

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({
  currentPlatform: () => mocks.platform.value,
  detectPlatformFrom: () => mocks.platform.value,
}));
vi.mock("../../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "1.6.0"),
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => true),
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: (value: string) => value,
}));

import { applyLanguage } from "../../../i18n";
import { useAppStore, type ActiveSession } from "../../../store";
import * as tracker from "../../../tracker";
import { NowPlayingView } from "../../views/NowPlayingView";
import { SettingsView } from "../../views/SettingsView";
import { findTour } from "../tourDefinitions";
import { TOUR_DEMO_GAME } from "../tourDemoGame";
import { TOUR_EVENT } from "../tourEvents";
import { nextStepIndex } from "../tourNavigation";
import { TourOverlay } from "../TourUI";

let container: HTMLDivElement;
let root: Root;

// A real game the player has running while they take the guide.
const realGame: ActiveSession = {
  id: 41,
  gameId: 7,
  gameName: "Elden Ring",
  exeName: "eldenring.exe",
  coverUrl: "",
  source: "igdb",
  startedAt: "2026-11-12T18:00:00.000Z",
  checkpointedAt: "2026-11-12T18:30:00.000Z",
};
const finished: Session = {
  id: 40,
  gameId: 7,
  gameName: "Elden Ring",
  exeName: "eldenring.exe",
  coverUrl: "",
  source: "igdb",
  startedAt: "2026-11-11T18:00:00.000Z",
  endedAt: "2026-11-11T19:00:00.000Z",
  durationSeconds: 3600,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  localStorage.clear();
  mocks.platform.value = "windows";
  for (const mock of Object.values(tracker))
    if (vi.isMockFunction(mock)) mock.mockClear();
  applyLanguage("en");
  useAppStore.setState(useAppStore.getInitialState(), true);
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

const guide = () => findTour("while-you-play")!;
const stepIndex = (id: string) =>
  guide().steps.findIndex((step) => step.id === id);
const currentStep = () =>
  guide().steps[useAppStore.getState().activeTour!.stepIndex].id;

function Screen() {
  const view = useAppStore((state) => state.activeView);
  return (
    <>
      {view === "settings" ? <SettingsView /> : <NowPlayingView />}
      <TourOverlay />
    </>
  );
}

async function start() {
  await act(async () => {
    root.render(<Screen />);
    useAppStore.getState().startTour("while-you-play");
  });
  await act(async () => {});
}
const goTo = async (id: string) => {
  await act(async () =>
    useAppStore.getState().goToTourStep(stepIndex(id), true),
  );
  await act(async () => {});
};

const sample = () =>
  container.querySelector<HTMLElement>('[data-tour="now-playing-demo"]');
const pauseButton = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-tour="demo-session-pause"]',
  );
const stopButton = () =>
  container.querySelector<HTMLButtonElement>('[data-tour="demo-session-stop"]');
const click = (element: HTMLElement) => act(async () => element.click());
const bold = (text: string) =>
  [...text.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);

function tourEvents() {
  const seen: Array<{ name: string; message?: string }> = [];
  const listener = (event: Event) => seen.push((event as CustomEvent).detail);
  window.addEventListener(TOUR_EVENT, listener);
  return {
    seen,
    stop: () => window.removeEventListener(TOUR_EVENT, listener),
  };
}

describe("the sample game in Now Playing", () => {
  it("is running when the guide starts, with nothing really running", async () => {
    await start();
    expect(currentStep()).toBe("intro");
    expect(useAppStore.getState().activeView).toBe("now");
    expect(sample()?.textContent).toContain(TOUR_DEMO_GAME.name);
    expect(sample()?.textContent).toContain("Now playing");
    // The first ring sits on the sample game's whole card.
    expect(container.querySelector(guide().steps[0].anchor!)).toBe(sample());
  });

  it("has Pause like every detected game, and no Stop", async () => {
    await start();
    await goTo("pause");
    expect(pauseButton()?.title).toBe("Pause");
    expect(stopButton()).toBeNull();
    expect(sample()?.textContent).toContain(TOUR_DEMO_GAME.exeName);
  });

  it("pauses and resumes, and the step finishes by itself", async () => {
    await start();
    await goTo("pause");
    await click(pauseButton()!);
    expect(sample()?.textContent).toContain("Paused");
    expect(sample()?.textContent).not.toContain("Now playing");
    expect(pauseButton()?.title).toBe("Resume");
    // Pausing alone is half the task.
    expect(currentStep()).toBe("pause");
    await click(pauseButton()!);
    expect(currentStep()).toBe("stop");
  });

  it("starts fresh when the player goes back, and Back does not bounce forward", async () => {
    await start();
    await goTo("pause");
    await click(pauseButton()!);
    await click(pauseButton()!);
    expect(currentStep()).toBe("stop");
    await goTo("pause");
    expect(currentStep()).toBe("pause");
    expect(sample()?.textContent).toContain("Now playing");
    expect(pauseButton()?.title).toBe("Pause");
    // Left paused and stepped on: the next visit starts running again.
    await click(pauseButton()!);
    await goTo("intro");
    await goTo("pause");
    expect(pauseButton()?.title).toBe("Pause");
  });

  it("becomes a timer started by hand for the Stop step: Stop next to Pause, no game file", async () => {
    await start();
    await goTo("stop");
    expect(stopButton()?.title).toBe("Stop");
    expect(pauseButton()).not.toBeNull();
    expect(sample()?.textContent).not.toContain(TOUR_DEMO_GAME.exeName);
  });

  it("answers Stop with a sample result and moves on", async () => {
    await start();
    await goTo("stop");
    const events = tourEvents();
    await click(stopButton()!);
    events.stop();
    expect(events.seen).toHaveLength(1);
    expect(events.seen[0].name).toBe("demo.step-completed");
    expect(events.seen[0].message).toMatch(/sample/i);
    expect(currentStep()).toBe("timer");
    expect(useAppStore.getState().activeView).toBe("settings");
    expect(useAppStore.getState().settingsGroup).toBe("play");
  });

  it("lets only the step's own button through", async () => {
    await start();
    await goTo("stop");
    await click(pauseButton()!);
    expect(sample()?.textContent).not.toContain("Paused");
    expect(currentStep()).toBe("stop");
  });
});

describe("the player's real session", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessions: [realGame],
      recentSessions: [finished],
    });
  });

  it("is neither shown nor paused, stopped or saved by the sample", async () => {
    await start();
    expect(container.textContent).not.toContain("Elden Ring");
    await goTo("pause");
    await click(pauseButton()!);
    await click(pauseButton()!);
    await click(stopButton()!);

    const state = useAppStore.getState();
    expect(state.activeSessions).toEqual([realGame]);
    expect(state.recentSessions).toEqual([finished]);
    for (const [name, mock] of Object.entries(tracker))
      if (vi.isMockFunction(mock))
        expect(mock, `tracker.${name}`).not.toHaveBeenCalled();
  });

  it("is back in Now Playing, still running, when the guide ends", async () => {
    await start();
    await goTo("pause");
    await click(pauseButton()!);
    await act(async () => useAppStore.getState().endTour("dismissed"));
    useAppStore.getState().setActiveView("now");
    await act(async () => {});
    expect(sample()).toBeNull();
    expect(container.textContent).toContain("Elden Ring");
    expect(container.textContent).toContain("Now playing");
    expect(container.textContent).not.toContain("Paused");
    expect(useAppStore.getState().activeSessions).toEqual([realGame]);
  });
});

describe("the steps in Settings", () => {
  it("ring single rows of While you play and the keys' own section", async () => {
    await start();
    const rings: Record<string, string | null | undefined> = {};
    for (const id of ["timer", "corner", "reminder", "keys"]) {
      await goTo(id);
      const step = guide().steps[stepIndex(id)];
      const ring = container.querySelector(step.anchor!);
      expect(ring, id).not.toBeNull();
      // A row is named by its title, the keys' section by its heading.
      rings[id] = ring!.hasAttribute("data-row")
        ? ring!.querySelector(".settings-row-text span")?.textContent
        : ring!.querySelector("h3")?.textContent;
      for (const label of bold(step.body))
        expect(ring!.textContent, `${id}: ${label}`).toContain(label);
    }
    expect(rings).toEqual({
      timer: "Live timer",
      corner: "Timer position",
      reminder: "Playtime reminder",
      keys: "While you play",
    });
  });

  it("show the four keys for playing, none of them preset", async () => {
    await start();
    await goTo("keys");
    const section = container.querySelector(
      guide().steps[stepIndex("keys")].anchor!,
    )!;
    expect(
      [...section.querySelectorAll("[data-row]")].map((row) =>
        row.getAttribute("data-row"),
      ),
    ).toEqual([
      "currentSessionHotkey",
      "quickNoteHotkey",
      "liveTimerHotkey",
      "pauseTimerHotkey",
    ]);
    expect(section.textContent!.match(/Not set/g)).toHaveLength(4);
  });

  it("only point: the guide changes no setting", async () => {
    await start();
    const before = useAppStore.getState().settings;
    for (const id of ["timer", "corner", "reminder", "keys"]) {
      await goTo(id);
      for (const control of container.querySelectorAll<HTMLElement>(
        "[data-settings-page] input, [data-settings-page] button, [data-settings-page] select",
      ))
        await click(control);
    }
    expect(useAppStore.getState().settings).toEqual(before);
  });
});

describe("computers without overlays", () => {
  const walk = () => {
    const ids: string[] = [];
    for (
      let index = 0;
      index < guide().steps.length;
      index = nextStepIndex(guide().steps, index, 1, () => false)
    )
      ids.push(guide().steps[index].id);
    return ids;
  };

  it("get all eight steps on Windows", () => {
    expect(walk()).toHaveLength(8);
  });

  it("keep the sample, Pause and Stop on a Mac, and skip timer, reminder and keys", () => {
    mocks.platform.value = "macos";
    expect(walk()).toEqual(["intro", "pause", "stop", "finish"]);
  });

  it("end on Now Playing without sending a Mac to settings it doesn't have", () => {
    mocks.platform.value = "macos";
    const last = guide().steps.at(-1)!;
    expect(last.view).toBe("now");
    expect(last.body).not.toMatch(/Settings|timer|reminder|keys/i);
    mocks.platform.value = "windows";
    expect(guide().steps.at(-1)!.body).toContain("<b>Settings</b>");
  });
});

describe("the Quick tour's Now Playing step", () => {
  it("still shows the sample session", async () => {
    await act(async () => {
      root.render(<Screen />);
      useAppStore.getState().startTour("core");
    });
    const core = findTour("core")!;
    await act(async () =>
      useAppStore
        .getState()
        .goToTourStep(core.steps.findIndex((step) => step.id === "now")),
    );
    expect(sample()?.textContent).toContain(TOUR_DEMO_GAME.name);
  });
});
