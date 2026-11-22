import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPersistedRecord, STORAGE_KEY } from "./persistence";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
vi.mock("./desktopOverlayBridge", async (importOriginal) => ({
  initializeDesktopOverlays: vi.fn(),
  disposeDesktopOverlays: vi.fn(),
  armDesktopOverlays: vi.fn(),
  emitOverlayEvent: vi.fn(),
  noteDiscoveredExecutable: vi.fn(),
  showCurrentSessionOverlay: vi.fn(),
  showPauseToggledOverlay: vi.fn(),
  newestSession: (
    await importOriginal<typeof import("./desktopOverlayBridge")>()
  ).newestSession,
}));
vi.mock("./controllerBridge", () => ({
  initializeControllerBridge: vi.fn(),
  disposeControllerBridge: vi.fn(),
  armControllerBridge: vi.fn(),
}));
vi.mock("./automaticBackups", () => ({
  initializeAutomaticBackups: vi.fn(),
  disposeAutomaticBackups: vi.fn(),
}));
vi.mock("./achievements/backgroundRefresh", () => ({
  schedulePostGameAchievementRefresh: vi.fn(),
  disposePostGameAchievementRefresh: vi.fn(),
}));

import { useAppStore, type ActiveSession, type ProcessSnapshot } from "./store";
import {
  emitOverlayEvent,
  showCurrentSessionOverlay,
  showPauseToggledOverlay,
} from "./desktopOverlayBridge";
import { schedulePostGameAchievementRefresh } from "./achievements/backgroundRefresh";
import {
  closeRunningGame,
  ignoreTrackedProcessLocally,
  initializeTracker,
  markTrackedExecutableAsSoftware,
  pauseSession,
  resumeSession,
  scanProcessesNow,
  selectAmbiguousMatch,
  startGameTimer,
  stopGameTimer,
  togglePauseFromHotkey,
} from "./tracker";
import { playedSeconds } from "./sessionTime";
import { resetSleepWatch } from "./sleepGap";

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
  vi.mocked(schedulePostGameAchievementRefresh).mockClear();
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
      // Generic names: their old name links stay on a start only while this
      // game still runs from before it (moveGenericNameLinksToFolders).
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

/** Most tests jump the clock to stand for time PlayCounter ran awake; the
 *  sleep watch (sleepGap.ts) must not take such a jump for a sleep. */
function awakeAt(at: string) {
  vi.setSystemTime(new Date(at));
  resetSleepWatch();
}

async function stopAt(at: string) {
  awakeAt(at);
  processes = [];
  await scanProcessesNow();
  expect(useAppStore.getState().activeSessions).toEqual([]);
}

describe("session recovery through startup and process scans", () => {
  it("skips unchanged scans but saves minute checkpoints and session endings", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T12:00:00.000Z");
    await scanProcessesNow();
    const setItem = vi.spyOn(localStorage, "setItem");
    for (let seconds = 5; seconds < 60; seconds += 5) {
      vi.setSystemTime(Date.parse("2026-09-06T12:00:00.000Z") + seconds * 1000);
      await scanProcessesNow();
    }
    expect(setItem).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-09-06T12:01:00.000Z"));
    await scanProcessesNow();
    expect(setItem).toHaveBeenCalledTimes(1);
    // What a restart loads: the checkpoint sits in the small save.
    expect(readPersistedRecord()).toMatchObject({
      activeSessions: [{ checkpointedAt: "2026-09-06T12:01:00.000Z" }],
    });

    await stopAt("2026-09-06T12:01:05.000Z");
    const saved = JSON.parse(storage.get(STORAGE_KEY)!);
    expect(saved.activeSessions).toEqual([]);
    expect(saved.sessions[0].endedAt).toBe("2026-09-06T12:01:05.000Z");
    setItem.mockClear();
    await scanProcessesNow();
    await scanProcessesNow();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

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

  it("refreshes the game's Xbox achievements after a game that ended while PlayCounter was closed", async () => {
    // The PC crashed during play: the first scan after the start ends it.
    await restart("2026-09-06T20:10:00.000Z");
    await scanProcessesNow();
    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      id: original.id,
      endedAt: checkpointedAt,
    });
    expect(schedulePostGameAchievementRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: original.id }),
    );
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

  it.each([false, true])(
    "checks every same-name instance for continuity (reversed: %s)",
    async (reversed) => {
      processes = [
        runningProcess,
        {
          ...runningProcess,
          pid: 456,
          startedAtUnix: Date.parse("2026-09-06T12:00:00Z") / 1000,
        },
      ];
      if (reversed) processes.reverse();
      await restart("2026-09-06T12:00:00.000Z");
      await scanProcessesNow();
      expect(useAppStore.getState().processes).toHaveLength(2);
      expect(useAppStore.getState().activeSessions).toMatchObject([
        { id: original.id },
      ]);
      expect(useAppStore.getState().recentSessions).toEqual([]);
    },
  );

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

describe("game timer", () => {
  const timer: ActiveSession = { ...original, timer: true };
  const game = {
    gameId: original.gameId,
    gameName: original.gameName,
    coverUrl: original.coverUrl,
    source: original.source ?? null,
    exeName: original.exeName,
  };

  it("keeps counting through scans and a restart, and Stop saves a manual session", async () => {
    await restart("2026-09-06T20:10:00.000Z", { activeSessions: [timer] });
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions).toMatchObject([
      { id: original.id, startedAt, timer: true },
    ]);
    expect(useAppStore.getState().recentSessions).toEqual([]);

    vi.setSystemTime(new Date("2026-09-06T20:15:00.000Z"));
    await stopGameTimer(original.id);
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      id: original.id,
      origin: "manual",
      startedAt,
      endedAt: "2026-09-06T20:15:00.000Z",
      durationSeconds: 615 * 60,
    });
    expect(JSON.parse(storage.get(STORAGE_KEY)!).sessions[0].origin).toBe(
      "manual",
    );
  });

  it("Stop refreshes the game's Xbox achievements: it may have been played on a console", async () => {
    await restart("2026-09-06T20:10:00.000Z", { activeSessions: [timer] });
    await scanProcessesNow();
    await stopGameTimer(original.id);
    expect(schedulePostGameAchievementRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: original.id }),
    );
  });

  it("lets the game's file join a running timer, and its exit or ignore leaves the timer", async () => {
    await restart("2026-09-06T12:00:00.000Z", { activeSessions: [timer] });
    processes = [runningProcess];
    await scanProcessesNow();
    vi.setSystemTime(new Date("2026-09-06T12:05:00.000Z"));
    processes = [];
    await scanProcessesNow();
    await ignoreTrackedProcessLocally(original.exeName, null);
    expect(useAppStore.getState().activeSessions).toMatchObject([
      { id: original.id, startedAt, timer: true },
    ]);
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });

  it("starts one session per game, never next to a detected one", async () => {
    await restart("2026-09-06T12:00:00.000Z", {
      activeSessions: [],
      // Nothing runs on this start: Game.exe's name link moves to the folder
      // it last ran from.
      launchTargets: [
        {
          exeName: original.exeName,
          path: runningProcess.exePath,
          owner: { gameId: original.gameId, source: original.source },
        },
      ],
    });
    startGameTimer(game);
    startGameTimer(game);
    expect(useAppStore.getState().activeSessions).toMatchObject([
      { gameId: original.gameId, startedAt: "2026-09-06T12:00:00.000Z" },
    ]);
    expect(useAppStore.getState().activeSessions[0].timer).toBe(true);

    await stopGameTimer(useAppStore.getState().activeSessions[0].id);
    processes = [runningProcess];
    await scanProcessesNow();
    startGameTimer(game);
    expect(useAppStore.getState().activeSessions).toHaveLength(1);
    expect(useAppStore.getState().activeSessions[0].timer).toBeUndefined();
  });
});

// docs/pause-timer-plan.md, "Rules".
describe("pause and resume", () => {
  const at = (time: string) => `2026-09-06T${time}:00.000Z`;
  const active = () => useAppStore.getState().activeSessions;
  const saved = () => useAppStore.getState().recentSessions;

  async function playingSince10(now: string) {
    processes = [runningProcess];
    await restart(at(now));
    await scanProcessesNow();
    expect(active()).toMatchObject([{ id: original.id, startedAt }]);
  }

  it("counts on from where it stopped: one session without the pause", async () => {
    await playingSince10("12:00");
    pauseSession(original.id);

    // The game keeps running for half an hour.
    awakeAt(at("12:30"));
    await scanProcessesNow();
    expect(active()).toMatchObject([
      { id: original.id, pausedAt: at("12:00") },
    ]);

    resumeSession(original.id);
    expect(active()[0].pausedAt).toBeUndefined();
    await stopAt(at("12:40"));
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({
      id: original.id,
      startedAt,
      endedAt: at("12:40"),
      durationSeconds: (2 * 60 + 10) * 60,
    });
  });

  it("game closes while paused: the session saves without the paused part", async () => {
    await playingSince10("12:00");
    pauseSession(original.id);
    await stopAt(at("12:20"));
    expect(saved()[0]).toMatchObject({
      endedAt: at("12:20"),
      durationSeconds: 2 * 3600,
    });
  });

  it("stays paused through an app restart", async () => {
    processes = [runningProcess];
    await restart(at("12:30"), {
      activeSessions: [
        { ...original, checkpointedAt: at("12:29"), pausedAt: at("12:00") },
      ],
    });
    await scanProcessesNow();
    expect(active()).toMatchObject([
      { id: original.id, pausedAt: at("12:00") },
    ]);

    resumeSession(original.id);
    await stopAt(at("12:45"));
    expect(saved()[0].durationSeconds).toBe((2 * 60 + 15) * 60);
  });

  it("a game gone after a restart ends at its last checkpoint, without the paused part", async () => {
    await restart(at("12:30"), {
      activeSessions: [
        { ...original, checkpointedAt: at("10:10"), pausedAt: at("10:05") },
      ],
    });
    await scanProcessesNow();
    expect(active()).toEqual([]);
    expect(saved()[0]).toMatchObject({
      endedAt: at("10:10"),
      durationSeconds: 5 * 60,
    });
  });

  it("a pause during a scan is not lost when the scan saves its checkpoint", async () => {
    await playingSince10("12:00");
    vi.setSystemTime(new Date(at("12:01")));
    const scan = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (command: string, ...rest) => {
      if (command === "scan_processes") pauseSession(original.id);
      return scan(command, ...rest);
    });
    await scanProcessesNow();
    expect(active()).toMatchObject([
      { checkpointedAt: at("12:01"), pausedAt: at("12:01") },
    ]);
  });

  it("manual timer: pause, then Stop saves only the played time", async () => {
    await restart(at("12:00"), { activeSessions: [] });
    startGameTimer({
      gameId: original.gameId,
      gameName: original.gameName,
      coverUrl: original.coverUrl,
      source: original.source ?? null,
      exeName: original.exeName,
    });
    const id = active()[0].id;
    vi.setSystemTime(new Date(at("12:10")));
    pauseSession(id);
    vi.setSystemTime(new Date(at("12:40")));
    resumeSession(id);
    vi.setSystemTime(new Date(at("12:50")));
    await stopGameTimer(id);
    expect(saved()[0]).toMatchObject({
      origin: "manual",
      endedAt: at("12:50"),
      durationSeconds: 20 * 60,
    });
  });

  it("the tray says Paused and stops counting", async () => {
    await playingSince10("12:00");
    const trayLine = () =>
      invokeMock.mock.calls
        .filter(([command]) => command === "update_tray_now_playing")
        .map(([, args]) => (args as { status: string }).status)
        .at(-1);
    pauseSession(original.id);
    expect(trayLine()).toBe("Paused Game - 2h 0m");
    vi.setSystemTime(new Date(at("12:30")));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(trayLine()).toBe("Paused Game - 2h 0m");
  });

  it("hotkey with no game: the session popup says so, nothing changes", async () => {
    await restart(at("12:00"), { activeSessions: [] });
    togglePauseFromHotkey();
    expect(showCurrentSessionOverlay).toHaveBeenCalledOnce();
    expect(showPauseToggledOverlay).not.toHaveBeenCalled();
    expect(active()).toEqual([]);
  });

  it("hotkey pauses and resumes the game; a popup answers only while the live timer is off", async () => {
    await playingSince10("12:00");
    vi.mocked(showPauseToggledOverlay).mockClear();
    togglePauseFromHotkey();
    expect(active()[0].pausedAt).toBe(at("12:00"));
    expect(showPauseToggledOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: original.id }),
      true,
      2 * 3600,
    );

    useAppStore.getState().setDesktopOverlaySetting("liveTimerEnabled", true);
    vi.setSystemTime(new Date(at("12:05")));
    togglePauseFromHotkey();
    expect(active()[0].pausedAt).toBeUndefined();
    // The pill shows the change itself.
    expect(showPauseToggledOverlay).toHaveBeenCalledTimes(1);
  });
});

// docs/auto-pause-plan.md, "Rules".
describe("auto pause when you're away", () => {
  const at = (time: string) => `2026-09-06T${time}:00.000Z`;
  const active = () => useAppStore.getState().activeSessions;
  const saved = () => useAppStore.getState().recentSessions;
  let lastInputAt: number;
  let gameInFront: boolean;
  const activityAsked = () =>
    invokeMock.mock.calls.filter(([command]) => command === "play_activity");

  beforeEach(() => {
    lastInputAt = Date.parse(at("12:00"));
    gameInFront = true;
    const answer = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command !== "play_activity") return answer(command, args);
      const { pidGroups } = args as { pidGroups: number[][] };
      return {
        inputIdleMs: Date.now() - lastInputAt,
        padIdleMs: null,
        inFront: pidGroups.map((pids) => gameInFront && pids.length > 0),
        hasWindow: pidGroups.map((pids) => pids.length > 0),
      };
    });
  });

  function setAutoPause(enabled: boolean) {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, autoPauseEnabled: enabled },
    }));
  }

  /** Moves the clock and lets the next check run (every 5 seconds). */
  async function checkAt(time: string) {
    awakeAt(at(time));
    await vi.advanceTimersByTimeAsync(5_000);
  }

  async function playingSince10(now: string) {
    setAutoPause(true);
    processes = [runningProcess];
    await restart(at(now));
    await scanProcessesNow();
    expect(active()).toMatchObject([{ id: original.id, startedAt }]);
  }

  it("no input for 5 minutes: paused from the last input; the game closing then saves only the played time", async () => {
    await playingSince10("12:00");
    await checkAt("12:04");
    expect(active()[0].pausedAt).toBeUndefined();

    await checkAt("12:05");
    expect(active()).toMatchObject([
      { id: original.id, pausedAt: at("12:00"), pauseKind: "away" },
    ]);

    await stopAt(at("12:30"));
    expect(saved()[0]).toMatchObject({
      endedAt: at("12:30"),
      durationSeconds: 2 * 3600,
    });
  });

  it("another app in front or the game minimized for a minute: paused from when the game left the front", async () => {
    await playingSince10("12:00");
    gameInFront = false;
    await checkAt("12:01");
    expect(active()[0].pausedAt).toBeUndefined();
    // Typing in the other app all along.
    lastInputAt = Date.parse(at("12:02"));
    await checkAt("12:02");
    expect(active()[0].pauseKind).toBe("away");
    // The check that first saw the game behind, a few seconds after 12:01.
    const pausedAt = Date.parse(active()[0].pausedAt!);
    expect(pausedAt).toBeGreaterThanOrEqual(Date.parse(at("12:01")));
    expect(pausedAt).toBeLessThanOrEqual(Date.parse(at("12:01")) + 5_000);
  });

  it("back at the game: counts on from your input, the time away not counted", async () => {
    await playingSince10("12:00");
    await checkAt("12:10");
    expect(active()[0].pauseKind).toBe("away");

    lastInputAt = Date.parse(at("12:30"));
    await checkAt("12:30");
    expect(active()[0].pausedAt).toBeUndefined();
    expect(active()[0].pauseKind).toBeUndefined();

    await stopAt(at("12:40"));
    expect(saved()[0].durationSeconds).toBe((2 * 60 + 10) * 60);
  });

  it("input while another app is in front: stays paused", async () => {
    await playingSince10("12:00");
    await checkAt("12:10");
    gameInFront = false;
    lastInputAt = Date.parse(at("12:30"));
    await checkAt("12:30");
    expect(active()[0]).toMatchObject({
      pausedAt: at("12:00"),
      pauseKind: "away",
    });
  });

  it("a pause you made yourself stays when input comes", async () => {
    await playingSince10("12:00");
    pauseSession(original.id);
    lastInputAt = Date.parse(at("12:20"));
    await checkAt("12:20");
    expect(active()[0].pausedAt).toBe(at("12:00"));
    expect(active()[0].pauseKind).toBeUndefined();
  });

  it("the hotkey resumes an auto pause", async () => {
    await playingSince10("12:00");
    await checkAt("12:10");
    togglePauseFromHotkey();
    expect(active()[0].pausedAt).toBeUndefined();
    expect(active()[0].pauseKind).toBeUndefined();
  });

  it("stays paused through an app restart and resumes on input", async () => {
    setAutoPause(true);
    processes = [runningProcess];
    await restart(at("12:30"), {
      activeSessions: [
        {
          ...original,
          checkpointedAt: at("12:29"),
          pausedAt: at("12:00"),
          pauseKind: "away",
        },
      ],
    });
    await scanProcessesNow();
    await checkAt("12:30");
    expect(active()[0]).toMatchObject({
      pausedAt: at("12:00"),
      pauseKind: "away",
    });

    lastInputAt = Date.parse(at("12:31"));
    await checkAt("12:31");
    expect(active()[0].pausedAt).toBeUndefined();
    await stopAt(at("12:41"));
    expect(saved()[0].durationSeconds).toBe((2 * 60 + 10) * 60);
  });

  it("the manual timer is never paused", async () => {
    setAutoPause(true);
    await restart(at("12:00"), { activeSessions: [] });
    startGameTimer({
      gameId: original.gameId,
      gameName: original.gameName,
      coverUrl: original.coverUrl,
      source: original.source ?? null,
      exeName: original.exeName,
    });
    await checkAt("13:00");
    expect(active()[0].pausedAt).toBeUndefined();
  });

  it("setting off: never paused, and nothing is asked", async () => {
    processes = [runningProcess];
    await restart(at("12:00"));
    await scanProcessesNow();
    await checkAt("12:30");
    expect(active()[0].pausedAt).toBeUndefined();
    expect(activityAsked()).toEqual([]);
  });

  it("turning the setting off resumes an auto pause at once", async () => {
    await playingSince10("12:00");
    await checkAt("12:10");
    vi.setSystemTime(new Date(at("12:20")));
    useAppStore.getState().setDesktopOverlaySetting("autoPauseEnabled", false);
    expect(active()[0].pausedAt).toBeUndefined();
    await stopAt(at("12:30"));
    expect(saved()[0].durationSeconds).toBe((2 * 60 + 10) * 60);
  });
});

describe("close game", () => {
  const client: ProcessSnapshot = {
    exeName: "Client.exe",
    exePath: "C:/Games/Client.exe",
    pid: 456,
    startedAtUnix: runningProcess.startedAtUnix,
  };
  const sessionEndedPopups = () =>
    vi
      .mocked(emitOverlayEvent)
      .mock.calls.filter(([event]) => event.type === "session-ended");

  function answerClose(answer: () => Promise<string> | string) {
    const scan = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (command: string, args?: unknown) =>
      command === "close_game_processes" ? answer() : scan(command, args),
    );
  }

  beforeEach(() => vi.mocked(emitOverlayEvent).mockClear());

  it("refreshes the game's Xbox achievements afterwards, as when it exits by itself", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T12:00:00.000Z");
    await scanProcessesNow();
    answerClose(() => {
      processes = [];
      return "closed";
    });

    expect(await closeRunningGame(original.id, false)).toBe("closed");
    expect(schedulePostGameAchievementRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: original.id }),
    );
  });

  it("closes every process of the game and ends the session without the popup", async () => {
    processes = [runningProcess, client];
    await restart("2026-09-06T12:00:00.000Z");
    await scanProcessesNow();
    answerClose(() => {
      processes = [];
      return "closed";
    });
    vi.setSystemTime(new Date("2026-09-06T12:05:00.000Z"));

    expect(await closeRunningGame(original.id, false)).toBe("closed");
    const closeCall = invokeMock.mock.calls.find(
      ([command]) => command === "close_game_processes",
    );
    expect(closeCall?.[1]).toEqual({
      targets: [
        {
          pid: 456,
          startedAtUnix: client.startedAtUnix,
          exePath: client.exePath,
        },
        {
          pid: 123,
          startedAtUnix: runningProcess.startedAtUnix,
          exePath: runningProcess.exePath,
        },
      ],
      force: false,
    });
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      id: original.id,
      endedAt: "2026-09-06T12:05:00.000Z",
    });
    expect(sessionEndedPopups()).toEqual([]);
  });

  it("ends the session without the popup when a scan sees the game go while closing", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T12:00:00.000Z");
    await scanProcessesNow();
    answerClose(async () => {
      processes = [];
      await scanProcessesNow();
      return "closed";
    });

    expect(await closeRunningGame(original.id, true)).toBe("closed");
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(useAppStore.getState().recentSessions).toHaveLength(1);
    expect(sessionEndedPopups()).toEqual([]);
  });

  it("keeps the session while the game still runs, and its later exit shows the popup", async () => {
    processes = [runningProcess];
    await restart("2026-09-06T12:00:00.000Z");
    await scanProcessesNow();
    answerClose(() => "stillRunning");

    expect(await closeRunningGame(original.id, false)).toBe("stillRunning");
    expect(useAppStore.getState().activeSessions).toMatchObject([
      { id: original.id },
    ]);

    processes = [];
    await scanProcessesNow();
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(sessionEndedPopups()).toHaveLength(1);
  });

  it("leaves a timer alone: nothing runs on this PC", async () => {
    await restart("2026-09-06T12:00:00.000Z", {
      activeSessions: [{ ...original, timer: true }],
    });
    expect(await closeRunningGame(original.id, true)).toBe("closed");
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "close_game_processes",
      ),
    ).toBe(false);
    expect(useAppStore.getState().activeSessions).toHaveLength(1);
  });
});

// docs/counters-plan.md, tests 7 and 8 (the tracker part).
describe("counts on a running session", () => {
  const at = (time: string) => `2026-09-06T${time}:00.000Z`;
  const active = () => useAppStore.getState().activeSessions;
  const saved = () => useAppStore.getState().recentSessions;

  it("survive the scans that update the session, and go into History when the game ends", async () => {
    processes = [runningProcess];
    await restart(at("12:00"));
    await scanProcessesNow();
    const store = useAppStore.getState();
    store.changeSessionCount(original.id, "deaths", 1);
    store.changeSessionCount(original.id, "deaths", 1);

    // A minute later the scan writes its own copy of the session back.
    vi.setSystemTime(new Date(at("12:01")));
    await scanProcessesNow();
    expect(active()[0].counts).toEqual({ deaths: 2 });

    await stopAt(at("12:30"));
    expect(saved()[0]).toMatchObject({ id: original.id, counts: { deaths: 2 } });
  });

  it("survive a scan that read the session before the press (its copy is older)", async () => {
    processes = [runningProcess];
    await restart(at("12:00"));
    await scanProcessesNow();
    // The player presses while the next scan waits for the process list.
    const scan = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (command: string, ...rest: unknown[]) => {
      if (command === "scan_processes")
        useAppStore.getState().changeSessionCount(original.id, "deaths", 1);
      return scan(command, ...rest);
    });
    vi.setSystemTime(new Date(at("12:05")));
    await scanProcessesNow();
    expect(active()[0].counts).toEqual({ deaths: 1 });
  });

  it("stay with the session through an app restart", async () => {
    await restart(at("12:30"), {
      activeSessions: [
        { ...original, checkpointedAt: at("12:20"), counts: { deaths: 7 } },
      ],
    });
    await scanProcessesNow();
    expect(active()).toEqual([]);
    expect(saved()[0]).toMatchObject({ id: original.id, counts: { deaths: 7 } });
  });

  it("drop what isn't a count when the saved data loads", async () => {
    await restart(at("12:30"), {
      activeSessions: [
        {
          ...original,
          checkpointedAt: at("12:20"),
          counts: { deaths: 3, broken: -2, text: "7", "": 4 },
        },
      ],
    });
    await scanProcessesNow();
    expect(saved()[0].counts).toEqual({ deaths: 3 });
  });
});

// GitHub issue: "play for a minute, put your pc to sleep, wake it 10 hours
// later and keep playing, your play session is now 10hr 1min long". Time the
// PC slept is never counted (sleepGap.ts): a gap of more than five minutes
// between two ticks of the scan clock is a sleep.
describe("the PC sleeps", () => {
  const at = (time: string) => `2026-09-06T${time}.000Z`;
  const active = () => useAppStore.getState().activeSessions;
  const saved = () => useAppStore.getState().recentSessions;
  // restart() sets polling to 30 s; the scan clock starts at the restart.
  const TICK_MS = 30_000;
  const minutes = (count: number) => count * 60;
  const twin = {
    exeName: "Twin.exe",
    exePath: String.raw`C:\Games\Twin\Twin.exe`,
    pid: 456,
  };
  const twinGames = [
    { id: 11, name: "Twin One", coverUrl: "", source: "igdb" as const },
    { id: 12, name: "Twin Two", coverUrl: "", source: "igdb" as const },
  ];

  async function playingSince10(
    now: string,
    overrides: Record<string, unknown> = {},
  ) {
    processes = [runningProcess];
    await restart(at(now), overrides);
    await scanProcessesNow();
    expect(active()).toMatchObject([{ id: original.id, startedAt }]);
  }

  /** Nothing runs while the PC sleeps; at `wake` the scan clock ticks again. */
  async function sleepUntil(wake: string) {
    vi.setSystemTime(Date.parse(at(wake)) - TICK_MS);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(new Date().toISOString()).toBe(at(wake));
  }

  async function playFor(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("play, sleep 10 hours, wake and play on: the night is not played", async () => {
    await playingSince10("12:00:00");
    await playFor(60_000);
    await sleepUntil("22:01:00");

    // Right after the wake, Now Playing shows the time before the sleep.
    expect(playedSeconds(active()[0], Date.now())).toBe(minutes(2 * 60 + 1));

    await playFor(60_000);
    await stopAt(at("22:02:00"));
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({
      id: original.id,
      startedAt,
      endedAt: at("22:02:00"),
      durationSeconds: minutes(2 * 60 + 2),
    });
  });

  it("a game that closed while the PC slept is saved with the time before the sleep", async () => {
    await playingSince10("12:00:00");
    await playFor(60_000);
    processes = [];
    await sleepUntil("22:01:00");

    expect(active()).toEqual([]);
    expect(saved()[0]).toMatchObject({
      endedAt: at("22:01:00"),
      durationSeconds: minutes(2 * 60 + 1),
    });
  });

  it("a short silence of the clock, under five minutes, is still played", async () => {
    await playingSince10("12:00:00");
    await playFor(60_000);
    await sleepUntil("12:05:00");
    await stopAt(at("12:05:00"));
    expect(saved()[0].durationSeconds).toBe(minutes(2 * 60 + 5));
  });

  it("a game paused before the sleep stays one pause", async () => {
    await playingSince10("12:00:00");
    await playFor(60_000);
    pauseSession(original.id);
    await sleepUntil("22:01:00");
    expect(active()).toMatchObject([{ pausedAt: at("12:01:00") }]);

    vi.setSystemTime(new Date(at("22:02:00")));
    resumeSession(original.id);
    await stopAt(at("22:03:00"));
    expect(saved()[0].durationSeconds).toBe(minutes(2 * 60 + 2));
  });

  it("auto pause after the wake never reaches back into the sleep", async () => {
    await playingSince10("12:00:00");
    await playFor(60_000);
    await sleepUntil("22:01:00");

    // The last input was before the sleep; auto pause dates its pause there.
    pauseSession(original.id, { at: Date.parse(at("12:00:50")), kind: "away" });
    expect(active()).toMatchObject([{ pausedAt: at("22:01:00") }]);

    vi.setSystemTime(new Date(at("22:01:20")));
    resumeSession(original.id, { at: Date.now() });
    await stopAt(at("22:02:00"));
    expect(saved()[0].durationSeconds).toBe(minutes(2 * 60 + 1) + 40);
  });

  it("auto pause before the wake's tick: its pause covers the sleep, once", async () => {
    await playingSince10("12:00:00", {
      settings: {
        ...useAppStore.getState().settings,
        pollingIntervalSeconds: 30,
        autoPauseEnabled: true,
      },
    });
    // Its own checks read nothing here; the test pauses for it.
    const scan = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (command: string, ...rest) => {
      if (command === "play_activity") throw new Error("not in this test");
      return scan(command, ...rest);
    });
    await playFor(60_000);
    // Woken; auto pause checks before the scan clock ticks.
    vi.setSystemTime(Date.parse(at("22:01:00")) - TICK_MS);
    pauseSession(original.id, { at: Date.parse(at("12:00:50")), kind: "away" });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(active()).toMatchObject([{ pausedAt: at("12:00:50") }]);
    expect(active()[0].pausedMs).toBeUndefined();

    vi.setSystemTime(new Date(at("22:01:20")));
    resumeSession(original.id, { at: Date.now() });
    await stopAt(at("22:02:00"));
    expect(saved()[0].durationSeconds).toBe(minutes(2 * 60) + 50 + 40);
  });

  it("a manual timer counts on: the console keeps playing while the PC sleeps", async () => {
    await restart(at("12:00:00"), { activeSessions: [] });
    startGameTimer({
      gameId: original.gameId,
      gameName: original.gameName,
      coverUrl: original.coverUrl,
      source: original.source ?? null,
      exeName: original.exeName,
    });
    const id = active()[0].id;
    await playFor(60_000);
    await sleepUntil("22:01:00");
    vi.setSystemTime(new Date(at("22:02:00")));
    await stopGameTimer(id);
    expect(saved()[0]).toMatchObject({
      origin: "manual",
      durationSeconds: minutes(10 * 60 + 2),
    });
  });

  it("a Discovered app keeps only its time awake", async () => {
    const mystery = {
      exeName: "Mystery.exe",
      exePath: String.raw`C:\Games\Mystery\Mystery.exe`,
      pid: 789,
    };
    processes = [mystery];
    await restart(at("12:00:00"), {
      activeSessions: [],
      exeCache: [
        {
          exeName: "Mystery.exe",
          state: "unmatched",
          lastCheckedAt: at("12:00:00"),
        },
      ],
    });
    await scanProcessesNow();
    expect(
      useAppStore.getState().exeCache.get("mystery.exe")?.runningSince,
    ).toBe(at("12:00:00"));

    await playFor(60_000);
    await sleepUntil("22:01:00");
    await playFor(60_000);
    processes = [];
    await scanProcessesNow();

    const entry = useAppStore.getState().exeCache.get("mystery.exe");
    expect(entry?.runningSince).toBeUndefined();
    expect(entry?.trackedSeconds).toBeCloseTo(minutes(2));
  });

  it("an emulator game not known yet keeps only its time awake", async () => {
    await restart(at("12:00:00"), { activeSessions: [] });
    // Seen running since 11:59 (a start never carries this over).
    useAppStore.setState({
      emulatorObservations: [
        {
          kind: "content",
          key: "mgba:rom:mystery",
          emulatorId: "mgba",
          label: "mGBA",
          hostExeName: "mGBA.exe",
          contentKind: "rom",
          contentValue: "mystery",
          display: "Mystery",
          trust: "weak",
          shareable: false,
          state: "unknown",
          detectedAt: at("11:59:00"),
          runningSince: at("11:59:00"),
        },
      ],
    });
    // The emulator was closed while the PC slept. The first scan after the
    // wake runs before the scan clock ticks.
    vi.setSystemTime(new Date(at("22:01:00")));
    await scanProcessesNow();

    const observation = useAppStore
      .getState()
      .emulatorObservations.find((entry) => entry.key === "mgba:rom:mystery");
    expect(observation).toMatchObject({
      trackedSeconds: 60,
      endedAt: at("22:01:00"),
    });
  });

  async function twinInPicker(detectedAt: string) {
    processes = [twin];
    await restart(at("12:00:00"), {
      activeSessions: [],
      exeCache: [],
      ambiguousMatches: [
        {
          exeName: twin.exeName,
          exePath: twin.exePath,
          candidates: twinGames,
          detectedAt: at(detectedAt),
          lastCheckedAt: at(detectedAt),
        },
      ],
    });
    await scanProcessesNow();
    expect(useAppStore.getState().ambiguousMatches).toMatchObject([
      { exeName: twin.exeName },
    ]);
    expect(useAppStore.getState().ambiguousMatches[0].endedAt).toBeUndefined();
  }

  it("the picker: a sleep while the exe waits comes off the game picked later", async () => {
    await twinInPicker("11:59:00");
    await playFor(60_000);
    await sleepUntil("22:01:00");
    await playFor(60_000);

    selectAmbiguousMatch(twin.exeName, twinGames[0]);
    expect(active()).toMatchObject([
      { gameId: twinGames[0].id, startedAt: at("11:59:00") },
    ]);
    await stopAt(at("22:03:00"));
    // 11:59 to 12:01, then 22:01 to 22:03.
    expect(saved()[0].durationSeconds).toBe(minutes(4));
  });

  it("the picker: an exe that closed while the PC slept saves the time before", async () => {
    await twinInPicker("11:59:00");
    await playFor(60_000);
    processes = [];
    await sleepUntil("22:01:00");
    expect(useAppStore.getState().ambiguousMatches[0].endedAt).toBe(
      at("22:01:00"),
    );

    selectAmbiguousMatch(twin.exeName, twinGames[0]);
    expect(saved()[0]).toMatchObject({
      gameId: twinGames[0].id,
      durationSeconds: minutes(2),
    });
  });

  it("a game moved to software takes only its time awake", async () => {
    await playingSince10("12:00:00");
    await playFor(60_000);
    await sleepUntil("22:01:00");
    await playFor(60_000);

    await markTrackedExecutableAsSoftware(original.exeName, {
      name: "Game Tool",
      share: false,
    });
    const usage = useAppStore.getState().toolUsage["game.exe"];
    const total = Object.values(usage?.days ?? {}).reduce(
      (sum, seconds) => sum + seconds,
      0,
    );
    expect(total).toBeCloseTo(minutes(2 * 60 + 2));
  });
});
