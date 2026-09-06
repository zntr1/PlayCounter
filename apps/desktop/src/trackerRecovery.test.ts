import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "./persistence";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
vi.mock("./desktopOverlayBridge", () => ({
  initializeDesktopOverlays: vi.fn(),
  disposeDesktopOverlays: vi.fn(),
  armDesktopOverlays: vi.fn(),
  emitOverlayEvent: vi.fn(),
  noteDiscoveredExecutable: vi.fn(),
}));
vi.mock("./controllerBridge", () => ({
  initializeControllerBridge: vi.fn(),
  disposeControllerBridge: vi.fn(),
  armControllerBridge: vi.fn(),
}));

import { useAppStore, type ActiveSession, type ProcessSnapshot } from "./store";
import { initializeTracker, scanProcessesNow } from "./tracker";

const startedAt = "2026-09-06T10:00:00.000Z";
const checkpointedAt = "2026-09-06T10:10:00.000Z";
const original: ActiveSession = {
  id: 1,
  gameId: -1,
  gameName: "Game",
  exeName: "Game.exe",
  coverUrl: "cover",
  source: "custom",
  startedAt,
  checkpointedAt,
};
const runningProcess: ProcessSnapshot = {
  exeName: "Game.exe",
  exePath: String.raw`C:\Games\Game.exe`,
  pid: 123,
  startedAtUnix: Date.parse(startedAt) / 1000,
};
let processes: ProcessSnapshot[];
let storage: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    backendHealth: { status: "offline", checkedAt: null, detail: "Offline" },
  });
  processes = [];
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "scan_processes") return processes;
    if (command === "privacy_context") return {};
    if (command === "install_uuid") return "recovery-test-install";
    if (command === "ignored_processes") {
      return { processes: [], userProcesses: [], userFilePath: null };
    }
    return undefined;
  });
});

afterEach(() => {
  useAppStore.getState().cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function restart(at: string, overrides: Record<string, unknown> = {}) {
  storage.set(
    STORAGE_KEY,
    JSON.stringify({
      settings: {
        ...useAppStore.getState().settings,
        pollingIntervalSeconds: 30,
      },
      activeSessions: [original],
      exeCache: ["Game.exe", "Client.exe"].map((exeName) => ({
        exeName,
        state: "matched",
        gameId: original.gameId,
        gameName: original.gameName,
        coverUrl: original.coverUrl,
        source: original.source,
        lastCheckedAt: checkpointedAt,
      })),
      ...overrides,
    }),
  );
  vi.setSystemTime(Date.parse(at) - 1000);
  await initializeTracker();
  await vi.advanceTimersByTimeAsync(1000);
  // Exercise deferred startup, including its former four-hour cutoff, before
  // invoking a scan explicitly so tests are independent of polling cadence.
  expect(useAppStore.getState().cleanup).toBeTypeOf("function");
  expect(
    invokeMock.mock.calls.some(([command]) => command === "scan_processes"),
  ).toBe(false);
}

async function stopAt(at: string) {
  vi.setSystemTime(new Date(at));
  processes = [];
  await scanProcessesNow();
  expect(useAppStore.getState().activeSessions).toEqual([]);
}

describe("session recovery through startup and process scans", () => {
  it("keeps ten hours of continuous play while PlayCounter was closed", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T20:10:00.000Z");
    expect(useAppStore.getState().activeSessions).toHaveLength(1);
    expect(useAppStore.getState().recentSessions).toEqual([]);

    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      id: original.id,
      startedAt,
      checkpointedAt: "2026-09-06T20:10:00.000Z",
      recoveredFromCheckpoint: false,
    });
    await stopAt("2026-09-06T20:15:00.000Z");
    expect(useAppStore.getState().recentSessions).toHaveLength(1);
    expect(useAppStore.getState().recentSessions[0].durationSeconds).toBe(
      615 * 60,
    );
  });

  it("does not count the break when the same game (even the same PID) was restarted", async () => {
    const restartedAt = "2026-09-06T12:00:00.000Z";
    processes = [
      { ...runningProcess, startedAtUnix: Date.parse(restartedAt) / 1000 },
    ];
    await restart(restartedAt);
    await scanProcessesNow();

    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      id: original.id,
      endedAt: checkpointedAt,
      durationSeconds: 600,
    });
    expect(useAppStore.getState().activeSessions[0].id).not.toBe(original.id);
    expect(useAppStore.getState().activeSessions[0].startedAt).toBe(
      restartedAt,
    );
    await stopAt("2026-09-06T12:05:00.000Z");
    const sessions = useAppStore.getState().recentSessions;
    expect(sessions).toHaveLength(2);
    expect(
      sessions.reduce(
        (sum, session) => sum + (session.durationSeconds ?? 0),
        0,
      ),
    ).toBe(15 * 60);
  });

  it("ends a missing game at its last checkpoint, not at app restart", async () => {
    await restart("2026-09-06T20:10:00.000Z");
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      id: original.id,
      endedAt: checkpointedAt,
      durationSeconds: 600,
    });
  });

  it("waits for a successful scan before deciding whether to resume", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T20:10:00.000Z");
    invokeMock.mockRejectedValueOnce(new Error("Process scan unavailable"));
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      id: original.id,
      checkpointedAt,
      recoveredFromCheckpoint: true,
    });
    expect(useAppStore.getState().recentSessions).toEqual([]);

    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      id: original.id,
      recoveredFromCheckpoint: false,
    });
  });

  it("does not restore outdated emulator metadata when checkpointing a native match", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T12:00:00.000Z", {
      activeSessions: [
        {
          ...original,
          emulator: {
            emulatorId: "dosbox",
            label: "DOSBox",
            contentKey: "dosbox:program:game.exe",
            display: "Game",
            trust: "recognized",
          },
        },
      ],
    });
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions[0].id).toBe(original.id);
    expect(useAppStore.getState().activeSessions[0].emulator).toBeUndefined();
  });

  it.each([
    undefined,
    0,
    -1,
    NaN,
    Infinity,
    Date.parse("2026-09-07T00:00:00Z") / 1000,
  ])(
    "does not infer continuity from an unavailable/invalid start time (%s)",
    async (startedAtUnix) => {
      processes = [{ ...runningProcess, startedAtUnix }];
      await restart("2026-09-06T12:00:00.000Z");
      await scanProcessesNow();
      expect(useAppStore.getState().recentSessions[0].durationSeconds).toBe(
        600,
      );
      expect(useAppStore.getState().activeSessions[0].startedAt).toBe(
        "2026-09-06T12:00:00.000Z",
      );
    },
  );

  it("checks all matched executables when the primary process is newer", async () => {
    processes = [
      {
        ...runningProcess,
        exeName: "Client.exe",
        exePath: null,
        pid: 456,
        startedAtUnix: Date.parse("2026-09-06T12:00:00Z") / 1000,
      },
      runningProcess,
    ];
    await restart("2026-09-06T12:00:00.000Z");
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions[0].id).toBe(original.id);
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });

  it("confirms recovery immediately, even inside the one-minute checkpoint interval", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T10:10:20.000Z");
    await scanProcessesNow();
    expect(
      useAppStore.getState().activeSessions[0].recoveredFromCheckpoint,
    ).toBe(false);
    await stopAt("2026-09-06T10:10:50.000Z");
    expect(useAppStore.getState().recentSessions[0].durationSeconds).toBe(650);
  });

  it("can still resume legacy single-session saves without a checkpoint", async () => {
    processes = [runningProcess];
    const { checkpointedAt: _checkpoint, ...legacy } = original;
    await restart("2026-09-06T12:00:00.000Z", {
      activeSessions: [],
      activeSession: legacy,
    });
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      id: original.id,
      startedAt,
    });
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });

  it("does not split normally observed tracking when a game's executable changes", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T12:00:00.000Z");
    await scanProcessesNow();
    vi.setSystemTime(new Date("2026-09-06T12:01:00Z"));
    processes = [
      {
        ...runningProcess,
        exeName: "Client.exe",
        exePath: null,
        pid: 456,
        startedAtUnix: Date.parse("2026-09-06T12:01:00Z") / 1000,
      },
    ];
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions[0].id).toBe(original.id);
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });
});
