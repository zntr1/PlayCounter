import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cycleLiveTimer,
  disposeLiveTimer,
  initializeLiveTimer,
  liveTimerPayload,
  syncLiveTimer,
} from "./liveTimer";
import { useAppStore, type ActiveSession } from "./store";
import { formatLiveTimer } from "./ui/LiveTimerPill";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

function session(
  id: number,
  startedAt: string,
  extra: Partial<ActiveSession> = {},
): ActiveSession {
  return {
    id,
    gameId: -id,
    gameName: `Game ${id}`,
    exeName: `game${id}.exe`,
    coverUrl: "",
    startedAt,
    checkpointedAt: startedAt,
    ...extra,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Windows", platform: "Win32" },
  });
  invokeMock.mockReset().mockResolvedValue(undefined);
  useAppStore.setState(useAppStore.getInitialState(), true);
});
afterEach(() => disposeLiveTimer());

const pidsById = (session: ActiveSession) => [session.id * 100];

it("times the game started last, not one waiting after a crash", () => {
  const settings = {
    ...useAppStore.getState().settings,
    liveTimerEnabled: true,
    liveTimerCorner: "bottom-right" as const,
  };
  expect(
    liveTimerPayload(
      settings,
      [
        session(1, "2026-10-28T10:00:00Z"),
        session(2, "2026-10-28T11:00:00Z"),
        session(3, "2026-10-28T12:00:00Z", { recoveredFromCheckpoint: true }),
      ],
      pidsById,
    ),
  ).toEqual({
    countFromMs: Date.parse("2026-10-28T11:00:00Z"),
    pausedAtMs: null,
    corner: "bottom-right",
    monitor: "primary",
    accentColor: null,
    targetPids: [200],
    pauseLabel: "Pause the timer for Game 2",
    resumeLabel: "Resume the timer for Game 2",
  });
  expect(liveTimerPayload(settings, [], pidsById)).toBeNull();
  expect(
    liveTimerPayload(
      { ...settings, liveTimerEnabled: false },
      [session(1, "2026-10-28T10:00:00Z")],
      pidsById,
    ),
  ).toBeNull();
});

it("keeps a console timer in the screen corner", () => {
  const settings = {
    ...useAppStore.getState().settings,
    liveTimerEnabled: true,
  };
  expect(
    liveTimerPayload(
      settings,
      [session(1, "2026-10-28T10:00:00Z", { timer: true })],
      pidsById,
    )?.targetPids,
  ).toEqual([]);
});

it("opens the timer with a game and closes it when the game ends", async () => {
  initializeLiveTimer(pidsById);
  useAppStore.getState().setDesktopOverlaySetting("liveTimerEnabled", true);
  expect(invokeMock).not.toHaveBeenCalled();

  useAppStore.setState({
    activeSessions: [session(1, "2026-10-28T10:00:00Z")],
  });
  // A new list with the same game changes nothing on screen.
  useAppStore.setState({
    activeSessions: [session(1, "2026-10-28T10:00:00Z")],
  });
  useAppStore.setState({ activeSessions: [] });
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  expect(invokeMock.mock.calls).toEqual([
    [
      "live_timer_show",
      {
        payload: expect.objectContaining({
          countFromMs: Date.parse("2026-10-28T10:00:00Z"),
          targetPids: [100],
        }),
      },
    ],
    ["live_timer_hide"],
  ]);
});

it("follows the game to a process that started after it", async () => {
  let pids = [10];
  initializeLiveTimer(() => pids);
  useAppStore.getState().setDesktopOverlaySetting("liveTimerEnabled", true);
  useAppStore.setState({
    activeSessions: [session(1, "2026-10-28T10:00:00Z")],
  });
  // A scan with the same processes sends nothing new.
  syncLiveTimer();
  pids = [10, 11];
  syncLiveTimer();
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  expect(invokeMock.mock.calls.map(([, args]) => args)).toEqual([
    { payload: expect.objectContaining({ targetPids: [10] }) },
    { payload: expect.objectContaining({ targetPids: [10, 11] }) },
  ]);
});

it("steps the hotkey through the corners clockwise, then off", () => {
  const seen: Array<string | null> = [];
  for (let press = 0; press < 6; press += 1) {
    cycleLiveTimer();
    const { liveTimerEnabled, liveTimerCorner } =
      useAppStore.getState().settings;
    seen.push(liveTimerEnabled ? (liveTimerCorner ?? null) : null);
  }
  expect(seen).toEqual([
    "top-left",
    "top-right",
    "bottom-right",
    "bottom-left",
    null,
    "top-left",
  ]);
});

it("switches on in its corner, without a stop in the old one", async () => {
  initializeLiveTimer(pidsById);
  useAppStore.setState({
    activeSessions: [session(1, "2026-10-28T10:00:00Z")],
  });
  useAppStore.getState().setLiveTimerCorner("bottom-left");
  cycleLiveTimer();
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
  expect(invokeMock).toHaveBeenCalledWith("live_timer_show", {
    payload: expect.objectContaining({ corner: "top-left" }),
  });
});

it("counts in hours, minutes and seconds", () => {
  expect(formatLiveTimer(0)).toBe("0:00:00");
  expect(formatLiveTimer(6_127.9)).toBe("1:42:07");
  expect(formatLiveTimer(36_000)).toBe("10:00:00");
  expect(formatLiveTimer(-5)).toBe("0:00:00");
});

// docs/pause-timer-plan.md: the pill freezes while paused and counts on from
// there; paused time never counts.
it("stands still while paused and counts on without the pause", () => {
  const settings = {
    ...useAppStore.getState().settings,
    liveTimerEnabled: true,
  };
  const start = Date.parse("2026-10-28T10:00:00Z");
  // Paused 10 minutes earlier, paused again since 11:00.
  expect(
    liveTimerPayload(
      settings,
      [
        session(1, "2026-10-28T10:00:00Z", {
          pausedMs: 600_000,
          pausedAt: "2026-10-28T11:00:00Z",
        }),
      ],
      pidsById,
    ),
  ).toMatchObject({
    countFromMs: start + 600_000,
    pausedAtMs: Date.parse("2026-10-28T11:00:00Z"),
  });
  expect(
    liveTimerPayload(
      settings,
      [session(1, "2026-10-28T10:00:00Z", { pausedMs: 600_000 })],
      pidsById,
    ),
  ).toMatchObject({ countFromMs: start + 600_000, pausedAtMs: null });
});

it("sends the pill again when the game is paused and resumed", async () => {
  initializeLiveTimer(pidsById);
  useAppStore.getState().setDesktopOverlaySetting("liveTimerEnabled", true);
  const running = session(1, "2026-10-28T10:00:00Z");
  useAppStore.setState({ activeSessions: [running] });
  useAppStore.setState({
    activeSessions: [{ ...running, pausedAt: "2026-10-28T11:00:00Z" }],
  });
  useAppStore.setState({
    activeSessions: [{ ...running, pausedMs: 300_000 }],
  });
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
  expect(invokeMock.mock.calls.map(([, args]) => args)).toEqual([
    { payload: expect.objectContaining({ pausedAtMs: null }) },
    {
      payload: expect.objectContaining({
        pausedAtMs: Date.parse("2026-10-28T11:00:00Z"),
      }),
    },
    {
      payload: expect.objectContaining({
        countFromMs: Date.parse("2026-10-28T10:05:00Z"),
        pausedAtMs: null,
      }),
    },
  ]);
});

// docs/pause-timer-plan.md, option C: the pill's own button pauses and
// resumes the game it shows.
it("a click on the pill's button pauses the game the pill shows", async () => {
  const onTogglePause = vi.fn();
  initializeLiveTimer(pidsById, onTogglePause);
  useAppStore.getState().setDesktopOverlaySetting("liveTimerEnabled", true);
  useAppStore.setState({
    activeSessions: [
      session(1, "2026-10-28T10:00:00Z"),
      session(2, "2026-10-28T11:00:00Z"),
      session(3, "2026-10-28T12:00:00Z", { console: "PS5" }),
    ],
  });
  // This test's listener: earlier tests registered their own.
  const click = listenMock.mock.calls
    .filter(([event]) => event === "playcounter:live-timer-toggle-pause")
    .at(-1);
  click![1]({ payload: null } as never);
  expect(onTogglePause).toHaveBeenCalledExactlyOnceWith(2);
});
