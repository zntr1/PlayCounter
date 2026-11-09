import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@playcounter/shared";

const { invokeMock, listeners } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));
vi.mock("./desktopOverlayBridge", async (importOriginal) => ({
  newestSession: (
    await importOriginal<typeof import("./desktopOverlayBridge")>()
  ).newestSession,
  showCounterOverlay: vi.fn(),
  showCurrentSessionOverlay: vi.fn(),
  showLiveTimerToggledOverlay: vi.fn(),
}));

import {
  counterKeyConflict,
  countFromController,
  countWithKey,
  disposeCounterKeys,
  initializeCounterKeys,
  takeOneBack,
} from "./counterInput";
import { formatHotkey } from "./hotkeyFormat";
import { shortcutFromKey } from "./shortcutKeys";
import {
  showCounterOverlay,
  showCurrentSessionOverlay,
} from "./desktopOverlayBridge";
import {
  disposeLiveTimer,
  initializeLiveTimer,
  liveTimerPayload,
  pillCounts,
  type LiveTimerPayload,
} from "./liveTimer";
import { useAppStore, type ActiveSession } from "./store";

/* docs/counters-plan.md, "Tests" 1-5, 14, 15 and the own keys Phil asked
   for: Elden Ring running, Deaths and a boss counter. */

const eldenRing = {
  gameId: 119133,
  source: "igdb" as const,
  igdbId: 119133,
  gameName: "Elden Ring",
  coverUrl: "",
};
const hades = {
  gameId: 113112,
  source: "igdb" as const,
  igdbId: 113112,
  gameName: "Hades",
  coverUrl: "",
};
const session = (
  id: number,
  game: typeof eldenRing,
  startedAt: string,
  extra: Partial<ActiveSession> = {},
): ActiveSession => ({
  ...game,
  id,
  exeName: `${game.gameName}.exe`,
  startedAt,
  checkpointedAt: startedAt,
  ...extra,
});
const counts = (id: number) =>
  useAppStore.getState().activeSessions.find((s) => s.id === id)?.counts;

const initial = useAppStore.getInitialState();
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
  useAppStore.setState(initial, true);
  invokeMock.mockClear();
  listeners.clear();
  vi.mocked(showCounterOverlay).mockClear();
  vi.mocked(showCurrentSessionOverlay).mockClear();
});
afterEach(() => {
  disposeCounterKeys();
  disposeLiveTimer();
  vi.unstubAllGlobals();
});

describe("the controller and Take one back", () => {
  it("the controller adds one to the counter with the controller icon (Deaths at first) of the game started last; one recovered after a crash is skipped", () => {
    useAppStore.setState({
      activeSessions: [
        session(1, eldenRing, "2026-11-08T19:00:00.000Z"),
        session(2, hades, "2026-11-08T20:00:00.000Z", {
          recoveredFromCheckpoint: true,
        }),
      ],
    });
    countFromController("add");
    expect(counts(1)).toEqual({ deaths: 1 });
    expect(counts(2)).toBeUndefined();
  });

  it("with nothing running count nothing and show the nothing-running popup", () => {
    countFromController("add");
    takeOneBack();
    expect(showCurrentSessionOverlay).toHaveBeenCalledTimes(2);
    expect(showCounterOverlay).not.toHaveBeenCalled();
  });

  it("in a game without counters count nothing, and the popup says so", () => {
    useAppStore.setState({
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    useAppStore.getState().deleteGameCounter(eldenRing, "deaths");
    countFromController("add");
    expect(counts(1)).toBeUndefined();
    expect(showCounterOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "no-counters",
    );
  });

  it("the controller follows its icon: moved to Malenia it counts her; cleared, the popup says no counter has it", () => {
    useAppStore.setState({
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    countFromController("add");
    const malenia = useAppStore.getState().addGameCounter(eldenRing, "Malenia")!;
    // A new counter doesn't take the icon by itself.
    countFromController("add");
    useAppStore.getState().setControllerCounter(eldenRing, malenia);
    countFromController("add");
    countFromController("add");
    expect(counts(1)).toEqual({ deaths: 2, [malenia]: 2 });
    useAppStore.getState().setControllerCounter(eldenRing, null);
    countFromController("add");
    expect(counts(1)).toEqual({ deaths: 2, [malenia]: 2 });
    expect(showCounterOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1 }),
      "no-controller-counter",
    );
  });

  it("Take one back takes from the counter counted last (Phil's call), then the controller's counter", () => {
    useAppStore.setState({
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    const malenia = useAppStore.getState().addGameCounter(eldenRing, "Malenia")!;
    useAppStore.getState().updateGameCounter(eldenRing, malenia, { shown: false });
    countWithKey("deaths");
    countWithKey("deaths");
    // Malenia's key pressed by mistake.
    countWithKey(malenia);
    takeOneBack();
    expect(counts(1)).toEqual({ deaths: 2 });
    // Malenia is at 0 now: nothing more to take from her.
    takeOneBack();
    expect(counts(1)).toEqual({ deaths: 2 });
    countWithKey("deaths");
    takeOneBack();
    expect(counts(1)).toEqual({ deaths: 2 });
  });

  it("Take one back at 0 in this session changes nothing, but still answers", () => {
    useAppStore.setState({
      recentSessions: [
        {
          ...eldenRing,
          id: 9,
          exeName: "Elden Ring.exe",
          startedAt: "2026-11-07T19:00:00.000Z",
          endedAt: "2026-11-07T21:00:00.000Z",
          durationSeconds: 7200,
          counts: { deaths: 40 },
        } satisfies Session,
      ],
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    takeOneBack();
    expect(counts(1)).toBeUndefined();
    expect(showCounterOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      { name: "Deaths", count: 40 },
    );
  });
});

describe("recording a counter's key", () => {
  const press = (code: string, key: string, mods: Partial<KeyboardEvent> = {}) => ({
    code,
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    ...mods,
  });

  it("takes a Numpad key alone for a counter, but not for an app-wide hotkey", () => {
    expect(shortcutFromKey(press("NumpadAdd", "+"), { plain: true })).toBe(
      "NumpadAdd",
    );
    expect(shortcutFromKey(press("Numpad1", "1"), { plain: true })).toBe(
      "Numpad1",
    );
    expect(shortcutFromKey(press("NumpadAdd", "+"))).toBeNull();
    // A letter alone would steal it from the game's controls and chat.
    expect(shortcutFromKey(press("KeyK", "k"), { plain: true })).toBeNull();
    expect(
      shortcutFromKey(press("Numpad5", "5", { ctrlKey: true }), { plain: true }),
    ).toBe("Control+Numpad5");
  });

  it("shows Numpad keys as the player reads them", () => {
    expect(formatHotkey("NumpadAdd")).toBe("Num +");
    expect(formatHotkey("Control+Numpad1")).toBe("Ctrl+Num 1");
  });
});

describe("a counter's own key", () => {
  it("counts that counter while its game is the one counted for, and nothing in another game", () => {
    const malenia = useAppStore.getState().addGameCounter(eldenRing, "Malenia")!;
    useAppStore.setState({
      activeSessions: [session(1, hades, "2026-11-08T19:00:00.000Z")],
    });
    countWithKey(malenia);
    expect(counts(1)).toBeUndefined();
    useAppStore.setState({
      activeSessions: [session(2, eldenRing, "2026-11-08T20:00:00.000Z")],
    });
    countWithKey(malenia);
    expect(counts(2)).toEqual({ [malenia]: 1 });
  });

  it("is registered only for the game counted for, and goes when that game ends", async () => {
    const store = useAppStore.getState();
    const malenia = store.addGameCounter(eldenRing, "Malenia")!;
    store.updateGameCounter(eldenRing, malenia, { key: "Control+Digit1" });
    store.updateGameCounter(hades, "deaths", { key: "Control+Digit1" });
    initializeCounterKeys();
    const registrations = () =>
      invokeMock.mock.calls
        .filter(([command]) => command === "set_global_hotkey")
        .map(([, args]) => args);

    useAppStore.setState({
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    await vi.waitFor(() =>
      expect(registrations()).toEqual([
        { action: `counter-key:${malenia}`, shortcut: "Control+Digit1" },
      ]),
    );
    // Hades starts later: its Deaths gets the same key, Malenia's goes first.
    useAppStore.setState({
      activeSessions: [
        session(1, eldenRing, "2026-11-08T19:00:00.000Z"),
        session(2, hades, "2026-11-08T20:00:00.000Z"),
      ],
    });
    await vi.waitFor(() =>
      expect(registrations().slice(1)).toEqual([
        { action: `counter-key:${malenia}`, shortcut: null },
        { action: "counter-key:deaths", shortcut: "Control+Digit1" },
      ]),
    );
    // The key event counts Hades' Deaths now.
    listeners.get("playcounter:counter-key-hotkey")!({ payload: "deaths" });
    expect(counts(2)).toEqual({ deaths: 1 });
    useAppStore.setState({ activeSessions: [] });
    await vi.waitFor(() =>
      expect(registrations().at(-1)).toEqual({
        action: "counter-key:deaths",
        shortcut: null,
      }),
    );
  });

  it("may not take one of PlayCounter's hotkeys or another counter's key in the same game", () => {
    const store = useAppStore.getState();
    const malenia = store.addGameCounter(eldenRing, "Malenia")!;
    store.updateGameCounter(eldenRing, "deaths", { key: "Control+Digit1" });
    store.setHotkey("counterUndoHotkey", "Alt+KeyZ");
    const state = useAppStore.getState();
    expect(counterKeyConflict(state, eldenRing, malenia, "Alt+KeyZ")).toBe(
      "Alt+Z is already one of PlayCounter's hotkeys.",
    );
    expect(
      counterKeyConflict(state, eldenRing, malenia, "Control+Digit1"),
    ).toBe("Ctrl+1 already counts Deaths.");
    // Another game may use the same key.
    expect(counterKeyConflict(state, hades, "deaths", "Control+Digit1")).toBe(
      null,
    );
  });

  it("works next to the controller combo: View + D-pad up counts the controller's counter", () => {
    useAppStore.setState({
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    initializeCounterKeys();
    return vi.waitFor(() => {
      listeners.get("playcounter:controller-count")!({ payload: "add" });
      expect(counts(1)).toEqual({ deaths: 1 });
    });
  });
});

describe("the live timer", () => {
  const settings = () => ({
    ...useAppStore.getState().settings,
    liveTimerEnabled: true,
  });
  const payload = () =>
    liveTimerPayload(
      settings(),
      useAppStore.getState().activeSessions,
      () => [],
      pillCounts,
    ) as LiveTimerPayload;

  it("shows no counts for a game that was never counted", () => {
    useAppStore.setState({
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    expect(payload().counts).toEqual([]);
  });

  it("shows the shown counters with this playthrough's totals, Deaths as a skull", () => {
    const store = useAppStore.getState();
    const malenia = store.addGameCounter(eldenRing, "Malenia")!;
    const radahn = store.addGameCounter(eldenRing, "Radahn")!;
    store.updateGameCounter(eldenRing, radahn, { shown: false });
    useAppStore.setState({
      recentSessions: [
        {
          ...eldenRing,
          id: 9,
          exeName: "Elden Ring.exe",
          startedAt: "2026-11-07T19:00:00.000Z",
          endedAt: "2026-11-07T21:00:00.000Z",
          durationSeconds: 7200,
          counts: { deaths: 300, [malenia]: 3, [radahn]: 21 },
        } satisfies Session,
      ],
      activeSessions: [
        session(1, eldenRing, "2026-11-08T19:00:00.000Z", {
          counts: { deaths: 13, [malenia]: 9 },
        }),
      ],
    });
    // The order everywhere: the newest shown counter first.
    expect(payload().counts).toEqual([
      { id: malenia, label: "Malenia", value: 12 },
      { id: "deaths", label: null, value: 313 },
    ]);
  });

  it("answers a press it shows by pulsing, with no popup; a hidden counter's press gets the popup", () => {
    useAppStore.getState().setDesktopOverlaySetting("liveTimerEnabled", true);
    useAppStore.setState({
      activeSessions: [session(1, eldenRing, "2026-11-08T19:00:00.000Z")],
    });
    initializeLiveTimer(() => []);
    countWithKey("deaths");
    expect(showCounterOverlay).not.toHaveBeenCalled();
    const shown = () =>
      invokeMock.mock.calls
        .filter(([command]) => command === "live_timer_show")
        .map(([, args]) => (args as { payload: LiveTimerPayload }).payload)
        .at(-1)!;
    return vi.waitFor(() => {
      expect(shown().counts).toEqual([{ id: "deaths", label: null, value: 1 }]);
      expect(shown().pulse).toMatchObject({ id: "deaths" });
      useAppStore
        .getState()
        .updateGameCounter(eldenRing, "deaths", { shown: false });
      countWithKey("deaths");
      expect(showCounterOverlay).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        { name: "Deaths", count: 2 },
      );
    });
  });
});
