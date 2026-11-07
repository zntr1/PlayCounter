import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@playcounter/shared";
import {
  disposeScreenshots,
  initializeScreenshots,
  screenshotTimeFromName,
  screenshotsBySession,
  takeScreenshot,
  toScreenshot,
  useScreenshots,
  type Screenshot,
  type ScreenshotFile,
} from "./screenshots";
import {
  showCurrentSessionOverlay,
  showScreenshotOverlay,
} from "./desktopOverlayBridge";
import { useAppStore, type ActiveSession } from "./store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("./desktopOverlayBridge", () => ({
  showCurrentSessionOverlay: vi.fn(),
  showScreenshotOverlay: vi.fn(),
}));
const invokeMock = vi.mocked(invoke);

const local = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) => new Date(year, month - 1, day, hour, minute, second).getTime();

function file(
  name: string,
  folder = "Elden Ring",
  modifiedMs = 0,
): ScreenshotFile {
  return {
    path: `C:\\Users\\me\\Pictures\\PlayCounter\\${folder}\\${name}`,
    folder,
    name,
    bytes: 1000,
    modifiedMs,
    previewPath: null,
  };
}

function finished(
  id: number,
  gameName: string,
  startMs: number,
  minutes: number,
): Session {
  return {
    id,
    gameId: id,
    gameName,
    exeName: "game.exe",
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(startMs + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
  };
}

describe("screenshot times", () => {
  it("reads the local time from PlayCounter's file names", () => {
    expect(screenshotTimeFromName("Elden Ring 2026-11-07 19-14-03.jpg")).toBe(
      local(2026, 11, 7, 19, 14, 3),
    );
    expect(
      screenshotTimeFromName("Halo Reach 2026-01-02 03-04-05 (2).jpg"),
    ).toBe(local(2026, 1, 2, 3, 4, 5));
  });

  it("gives up on names without a time", () => {
    expect(screenshotTimeFromName("cover.png")).toBeNull();
    expect(screenshotTimeFromName("20260821000812_1.jpg")).toBeNull();
    expect(screenshotTimeFromName("Game 2026-13-40 25-61-61.jpg")).toBeNull();
  });

  it("uses the file's time when the name has none", () => {
    expect(
      toScreenshot(file("my edit.png", "Elden Ring", 1234)).takenAtMs,
    ).toBe(1234);
    expect(
      toScreenshot(
        file("Elden Ring 2026-11-07 19-14-03.jpg", "Elden Ring", 1234),
      ).takenAtMs,
    ).toBe(local(2026, 11, 7, 19, 14, 3));
  });
});

describe("which session a screenshot belongs to", () => {
  const start = local(2026, 11, 7, 18, 0, 0);
  const at = (minutes: number) => start + minutes * 60_000;
  const shot = (minutes: number, folder = "Elden Ring"): Screenshot => ({
    ...file(`x ${minutes}.jpg`, folder),
    takenAtMs: at(minutes),
  });
  const times = (shots: Screenshot[] | undefined) =>
    shots?.map((entry) => entry.takenAtMs);

  it("puts a picture on the session that ran when it was taken", () => {
    const sessions = [
      finished(1, "Elden Ring", at(0), 60),
      finished(2, "Elden Ring", at(120), 60),
    ];
    const map = screenshotsBySession([shot(30), shot(150)], sessions, at(500));
    expect(times(map.get(1))).toEqual([at(30)]);
    expect(times(map.get(2))).toEqual([at(150)]);
  });

  it("still counts a picture written up to 2 minutes after the game closed", () => {
    const map = screenshotsBySession(
      [shot(61), shot(63)],
      [finished(1, "Elden Ring", at(0), 60)],
      at(500),
    );
    expect(times(map.get(1))).toEqual([at(61)]);
  });

  it("follows a session that was split at a break", () => {
    // 18:00–19:00 became 18:00–18:20 and 18:40–19:00.
    const sessions = [
      finished(7, "Elden Ring", at(0), 20),
      finished(1, "Elden Ring", at(40), 20),
    ];
    const map = screenshotsBySession([shot(10), shot(50)], sessions, at(500));
    expect(times(map.get(7))).toEqual([at(10)]);
    expect(times(map.get(1))).toEqual([at(50)]);
  });

  it("keeps all pictures together on a combined session", () => {
    const map = screenshotsBySession(
      [shot(10), shot(50)],
      [finished(1, "Elden Ring", at(0), 60)],
      at(500),
    );
    expect(times(map.get(1))).toEqual([at(10), at(50)]);
  });

  it("counts a running session up to now", () => {
    const running = {
      id: 3,
      gameName: "Elden Ring",
      startedAt: new Date(at(0)).toISOString(),
    };
    const map = screenshotsBySession([shot(30), shot(90)], [running], at(60));
    expect(times(map.get(3))).toEqual([at(30)]);
  });

  it("lets the game folder decide when two games ran at once", () => {
    const sessions = [
      finished(1, "Elden Ring", at(0), 60),
      finished(2, "Halo: Reach", at(10), 60),
    ];
    const map = screenshotsBySession(
      [shot(30, "Elden Ring"), shot(31, "Halo Reach")],
      sessions,
      at(500),
    );
    expect(map.get(1)?.map((entry) => entry.folder)).toEqual(["Elden Ring"]);
    expect(map.get(2)?.map((entry) => entry.folder)).toEqual(["Halo Reach"]);
  });

  it("picks the game started last when the folder names neither game", () => {
    const sessions = [
      finished(1, "Elden Ring", at(0), 60),
      finished(2, "Halo: Reach", at(10), 60),
    ];
    const map = screenshotsBySession([shot(30, "Other")], sessions, at(500));
    expect(times(map.get(2))).toEqual([at(30)]);
    expect(map.get(1)).toBeUndefined();
  });

  it("leaves pictures outside every session alone", () => {
    const map = screenshotsBySession(
      [shot(-30), shot(200)],
      [finished(1, "Elden Ring", at(0), 60)],
      at(500),
    );
    expect(map.size).toBe(0);
  });

  it("sorts each session's pictures by time", () => {
    const map = screenshotsBySession(
      [shot(40), shot(10), shot(25)],
      [finished(1, "Elden Ring", at(0), 60)],
      at(500),
    );
    expect(times(map.get(1))).toEqual([at(10), at(25), at(40)]);
  });
});

describe("the screenshot key", () => {
  function active(
    id: number,
    startedAt: string,
    extra: Partial<ActiveSession> = {},
  ): ActiveSession {
    return {
      id,
      gameId: id,
      source: "custom",
      gameName: `Game ${id}`,
      exeName: `game${id}.exe`,
      coverUrl: "",
      startedAt,
      checkpointedAt: startedAt,
      ...extra,
    };
  }
  const pidsOf = (session: ActiveSession) => [session.id * 100];

  beforeEach(async () => {
    vi.clearAllMocks();
    invokeMock.mockReset().mockResolvedValue([]);
    useAppStore.setState((state) => ({
      activeSessions: [],
      notifications: [],
      settings: { ...state.settings, screenshotHotkey: null },
    }));
    initializeScreenshots(pidsOf);
    // The folder read at start finishes before the key is pressed.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    useScreenshots.setState({ files: [] });
  });
  afterEach(() => disposeScreenshots());

  it("says nothing is being tracked when no game runs", async () => {
    // Rust still answers, so the "didn't work" sound plays.
    invokeMock.mockResolvedValueOnce({ status: "no-window" });
    await takeScreenshot();
    expect(invokeMock).toHaveBeenCalledWith("screenshot_take", {
      candidates: [],
    });
    expect(showCurrentSessionOverlay).toHaveBeenCalledTimes(1);
    expect(showScreenshotOverlay).not.toHaveBeenCalled();
  });

  it("asks for the games on this PC, started last first", async () => {
    useAppStore.setState({
      activeSessions: [
        active(1, "2026-11-07T18:00:00.000Z"),
        active(2, "2026-11-07T19:00:00.000Z"),
        active(3, "2026-11-07T19:30:00.000Z", {
          recoveredFromCheckpoint: true,
        }),
        active(4, "2026-11-07T19:40:00.000Z", { timer: true }),
        active(5, "2026-11-07T19:50:00.000Z", { console: "PS5" }),
      ],
    });
    invokeMock.mockResolvedValueOnce({ status: "no-window" });
    await takeScreenshot();
    expect(invokeMock).toHaveBeenCalledWith("screenshot_take", {
      candidates: [
        { sessionId: 2, pids: [200], gameName: "Game 2" },
        { sessionId: 1, pids: [100], gameName: "Game 1" },
      ],
    });
    expect(showScreenshotOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "no-window", gameName: "Game 2" }),
    );
  });

  it("adds a saved picture to the list at once", async () => {
    useAppStore.setState({
      activeSessions: [active(1, "2026-11-07T18:00:00.000Z")],
    });
    const saved = file("Game 1 2026-11-07 19-14-03.jpg", "Game 1", 5);
    invokeMock.mockResolvedValueOnce({
      status: "saved",
      sessionId: 1,
      file: saved,
    });
    await takeScreenshot();
    expect(useScreenshots.getState().files).toEqual([toScreenshot(saved)]);
    expect(showScreenshotOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "saved", gameName: "Game 1" }),
    );
  });

  it("tells the player about a black picture in the bell", async () => {
    useAppStore.setState({
      activeSessions: [active(1, "2026-11-07T18:00:00.000Z")],
    });
    invokeMock.mockResolvedValueOnce({ status: "black", sessionId: 1 });
    await takeScreenshot();
    expect(useScreenshots.getState().files).toEqual([]);
    expect(showScreenshotOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "black", gameName: "Game 1" }),
    );
    const [notification] = useAppStore.getState().notifications;
    expect(notification).toMatchObject({
      kind: "screenshot-black",
      params: { game: "Game 1" },
    });
  });

  it("says so when the picture could not be taken", async () => {
    useAppStore.setState({
      activeSessions: [active(1, "2026-11-07T18:00:00.000Z")],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce("no graphics device");
    await takeScreenshot();
    expect(showScreenshotOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", gameName: "Game 1" }),
    );
    error.mockRestore();
  });
});
