import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  disposeLiveTimer,
  initializeLiveTimer,
  liveTimerPayload,
  syncLiveTimer,
} from "./liveTimer";
import { useAppStore, type ActiveSession } from "./store";
import { formatLiveTimer } from "./ui/LiveTimerPill";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const invokeMock = vi.mocked(invoke);

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
    startedAtMs: Date.parse("2026-10-28T11:00:00Z"),
    corner: "bottom-right",
    monitor: "primary",
    accentColor: null,
    targetPids: [200],
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
          startedAtMs: Date.parse("2026-10-28T10:00:00Z"),
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

it("counts in hours, minutes and seconds", () => {
  expect(formatLiveTimer(0)).toBe("0:00:00");
  expect(formatLiveTimer(6_127.9)).toBe("1:42:07");
  expect(formatLiveTimer(36_000)).toBe("10:00:00");
  expect(formatLiveTimer(-5)).toBe("0:00:00");
});
