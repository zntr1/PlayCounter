import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  showCurrentSessionOverlay,
  showScreenshotOverlay,
} from "./desktopOverlayBridge";
import { appLocale } from "./i18n";
import {
  disposeScreenshotBox,
  initializeScreenshotBox,
  openScreenshotBox,
  SCREENSHOT_BOX_ACTION_EVENT,
  type ScreenshotBoxAction,
  type ScreenshotBoxPayload,
} from "./screenshotBox";
import {
  SCREENSHOT_CAPTION_CLOSE_EVENT,
  toScreenshot,
  useScreenshots,
  type ScreenshotFile,
} from "./screenshots";
import { useAppStore, type ActiveSession } from "./store";

/* docs/session-screenshots-plan.md: the "Show screenshots" key opens a box
   over the game with all of that game's pictures, oldest first, at the
   newest. The box only shows and sends; the main window does the work. */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./desktopOverlayBridge", () => ({
  showCurrentSessionOverlay: vi.fn(),
  showScreenshotOverlay: vi.fn(),
}));
vi.mock("./platform", () => ({ currentPlatform: () => "windows" }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

const ELDEN_PID = 100;
const HADES_PID = 200;
/** Saturday's session: 23 Nov 2026, 19:00 to 23:00, local time. */
const SATURDAY = new Date(2026, 10, 23, 19, 0, 0).getTime();
/** Tonight's session started at 20:00; it's 21:00 now. */
const TONIGHT = new Date(2026, 10, 27, 20, 0, 0).getTime();
const NOW = new Date(2026, 10, 27, 21, 0, 0).getTime();

function nameAt(game: string, ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${game} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.jpg`;
}

function file(
  game: string,
  ms: number,
  extra: Partial<ScreenshotFile> = {},
): ScreenshotFile {
  const name = nameAt(game, ms);
  return {
    path: `C:\\Pictures\\PlayCounter\\${game}\\${name}`,
    folder: game,
    name,
    bytes: 1000,
    modifiedMs: ms,
    previewPath: `C:\\previews\\${name}`,
    caption: null,
    ...extra,
  };
}

const minutes = (count: number) => count * 60_000;
// Thursday, in the game's folder, from a session no longer kept.
const thursday = file("Elden Ring", new Date(2026, 10, 21, 20, 12).getTime());
const fork = file("Elden Ring", SATURDAY + minutes(40), {
  caption: "Fork past the bridge",
});
const bossDoor = file("Elden Ring", SATURDAY + minutes(182));
const cliff = file("Elden Ring", TONIGHT + minutes(30));
const sunrise = file("Elden Ring", TONIGHT + minutes(50));

function active(
  id: number,
  gameId: number,
  gameName: string,
  startedAt: number,
): ActiveSession {
  return {
    id,
    gameId,
    source: "custom",
    gameName,
    exeName: `${gameName.toLowerCase().replace(/\W/g, "")}.exe`,
    coverUrl: "",
    startedAt: new Date(startedAt).toISOString(),
    checkpointedAt: new Date(startedAt).toISOString(),
  };
}

const elden = active(2, 1, "Elden Ring", TONIGHT);
const hades = active(3, 2, "Hades", TONIGHT + minutes(20));

let foregroundPid: number | null;
let actionHandler: ((action: ScreenshotBoxAction) => void) | null;
type CaptionClosed = { path: string; caption: string | null; markUp: boolean };
/** The caption box closing, as Rust tells the main window. */
let captionClosed: ((closed: CaptionClosed) => void) | null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  foregroundPid = ELDEN_PID;
  actionHandler = null;
  captionClosed = null;
  invokeMock.mockReset().mockImplementation(async (command, args) => {
    if (command === "quick_note_foreground_pid") return foregroundPid;
    if (command === "quick_note_open") return true;
    if (command === "screenshot_box_update") return true;
    if (command === "screenshot_caption") {
      const { path, caption } = args as { path: string; caption: string };
      const before = useScreenshots
        .getState()
        .files.find((entry) => entry.path === path)!;
      return { ...before, caption };
    }
    if (command === "screenshot_markup") {
      const { path } = args as { path: string };
      const before = useScreenshots
        .getState()
        .files.find((entry) => entry.path === path)!;
      return { ...before, modifiedMs: NOW + 5 };
    }
    return undefined;
  });
  listenMock.mockReset().mockImplementation(async (event, handler) => {
    if (event === SCREENSHOT_BOX_ACTION_EVENT)
      actionHandler = (action) =>
        (handler as (event: { payload: ScreenshotBoxAction }) => void)({
          payload: action,
        });
    if (event === SCREENSHOT_CAPTION_CLOSE_EVENT)
      captionClosed = (closed) =>
        (handler as (event: { payload: CaptionClosed }) => void)({
          payload: closed,
        });
    return () => {};
  });
  vi.mocked(showCurrentSessionOverlay).mockReset();
  vi.mocked(showScreenshotOverlay).mockReset();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeSessions: [elden, hades],
    recentSessions: [
      {
        id: 1,
        gameId: 1,
        source: "custom",
        gameName: "Elden Ring",
        exeName: "eldenring.exe",
        startedAt: new Date(SATURDAY).toISOString(),
        endedAt: new Date(SATURDAY + minutes(240)).toISOString(),
        durationSeconds: 4 * 3600,
      },
    ],
  });
  useScreenshots.setState({
    files: [sunrise, fork, thursday, cliff, bossDoor].map(toScreenshot),
  });
  initializeScreenshotBox((session) =>
    session.id === elden.id ? [ELDEN_PID] : [HADES_PID],
  );
});

afterEach(() => {
  disposeScreenshotBox();
  vi.useRealTimers();
});

function openedPayload() {
  const call = invokeMock.mock.calls.find(
    ([command]) => command === "quick_note_open",
  );
  return (call?.[1] as { payload: ScreenshotBoxPayload } | undefined)?.payload;
}

function lastUpdate() {
  const calls = invokeMock.mock.calls.filter(
    ([command]) => command === "screenshot_box_update",
  );
  return (calls.at(-1)?.[1] as { update: unknown } | undefined)?.update as
    | ScreenshotBoxPayload["screenshots"]
    | undefined;
}

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(appLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

it("opens the box for the game in front with all its pictures, oldest first, at the newest", async () => {
  await openScreenshotBox();
  const payload = openedPayload()!;
  expect(payload.gameName).toBe("Elden Ring");
  const { pictures, index } = payload.screenshots;
  expect(pictures.map((picture) => picture.path)).toEqual(
    [thursday, fork, bossDoor, cliff, sunrise].map((entry) => entry.path),
  );
  expect(index).toBe(4);
  // Each session under its date, tonight's under "This session"; a picture
  // no kept session claims goes under its own day.
  expect(pictures.map((picture) => picture.group)).toEqual([
    {
      key: expect.any(String),
      label: day(thursday.modifiedMs),
      current: false,
    },
    { key: "session:1", label: day(SATURDAY), current: false },
    { key: "session:1", label: day(SATURDAY), current: false },
    { key: "session:2", label: "This session", current: true },
    { key: "session:2", label: "This session", current: true },
  ]);
  expect(pictures[1]).toMatchObject({
    caption: "Fork past the bridge",
    markable: true,
    takenAt: new Date(fork.modifiedMs).toLocaleString(appLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  });
  // The picture changed in place gets a new address.
  expect(pictures[4].url).toBe(
    `asset://${sunrise.path}?v=${sunrise.modifiedMs}`,
  );
  expect(pictures[4].thumbUrl).toContain(`asset://${sunrise.previewPath}`);
  expect(payload.labels["Mark up"]).toBe("Mark up");
  expect(payload.labels["Save into picture"]).toBe("Save into picture");
});

it("takes the game started last when no running game is in front", async () => {
  foregroundPid = null;
  await openScreenshotBox();
  // Hades has no pictures yet.
  expect(invokeMock).not.toHaveBeenCalledWith(
    "quick_note_open",
    expect.anything(),
  );
  expect(showScreenshotOverlay).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ outcome: "none", gameName: "Hades" }),
  );
});

it("lets the session popup say so when no game is running", async () => {
  useAppStore.setState({ activeSessions: [] });
  await openScreenshotBox();
  expect(showCurrentSessionOverlay).toHaveBeenCalledOnce();
  expect(invokeMock).not.toHaveBeenCalledWith(
    "quick_note_open",
    expect.anything(),
  );
});

it("writes a caption the box asks for, then sends the box the new list", async () => {
  await openScreenshotBox();
  actionHandler!({ kind: "caption", path: cliff.path, caption: "Cliff jump" });
  await vi.waitFor(() =>
    expect(lastUpdate()?.done).toEqual({
      kind: "caption",
      path: cliff.path,
      ok: true,
    }),
  );
  expect(invokeMock).toHaveBeenCalledWith("screenshot_caption", {
    path: cliff.path,
    caption: "Cliff jump",
  });
  expect(
    lastUpdate()!.pictures.find((picture) => picture.path === cliff.path)
      ?.caption,
  ).toBe("Cliff jump");
});

it("moves a picture to the Recycle Bin, then sends the list without it", async () => {
  await openScreenshotBox();
  actionHandler!({ kind: "recycle", path: bossDoor.path });
  await vi.waitFor(() =>
    expect(lastUpdate()?.done).toEqual({
      kind: "recycle",
      path: bossDoor.path,
      ok: true,
    }),
  );
  expect(invokeMock).toHaveBeenCalledWith("screenshot_delete", {
    path: bossDoor.path,
  });
  expect(lastUpdate()!.pictures.map((picture) => picture.path)).not.toContain(
    bossDoor.path,
  );
});

it("draws the box's marks into the picture, then sends its new address", async () => {
  await openScreenshotBox();
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  actionHandler!({
    kind: "markUp",
    path: sunrise.path,
    png: btoa(String.fromCharCode(...png)),
  });
  await vi.waitFor(() =>
    expect(lastUpdate()?.done).toEqual({
      kind: "markUp",
      path: sunrise.path,
      ok: true,
    }),
  );
  expect(invokeMock).toHaveBeenCalledWith("screenshot_markup", {
    path: sunrise.path,
    marks: Array.from(png),
  });
  expect(
    lastUpdate()!.pictures.find((picture) => picture.path === sunrise.path)
      ?.url,
  ).toBe(`asset://${sunrise.path}?v=${NOW + 5}`);
});

it("tells the box when what it asked for failed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await openScreenshotBox();
  invokeMock.mockImplementation(async (command) => {
    if (command === "screenshot_markup") throw new Error("Recycle Bin full");
    return true;
  });
  actionHandler!({ kind: "markUp", path: sunrise.path, png: "iVBORw==" });
  await vi.waitFor(() =>
    expect(lastUpdate()?.done).toEqual({
      kind: "markUp",
      path: sunrise.path,
      ok: false,
    }),
  );
});

it("sends a picture taken while the box is open", async () => {
  await openScreenshotBox();
  const later = file("Elden Ring", TONIGHT + minutes(55));
  useScreenshots.setState((state) => ({
    files: [...state.files, toScreenshot(later)],
  }));
  await vi.waitFor(() =>
    expect(lastUpdate()?.pictures.at(-1)?.path).toBe(later.path),
  );
  expect(lastUpdate()!.done).toBeUndefined();
});

/* A click on the picture in the caption box opens it to mark up, and the box
   takes you back to the game afterwards. */

it("opens the picture just taken to mark up, with its caption saved first", async () => {
  captionClosed!({ path: cliff.path, caption: "Cliff jump", markUp: true });
  await vi.waitFor(() => expect(openedPayload()).toBeDefined());
  const commands = invokeMock.mock.calls.map(([command]) => command);
  expect(commands.indexOf("screenshot_caption")).toBeGreaterThanOrEqual(0);
  expect(commands.indexOf("screenshot_caption")).toBeLessThan(
    commands.indexOf("quick_note_open"),
  );
  const { screenshots } = openedPayload()!;
  expect(screenshots.markUpFirst).toBe(true);
  expect(screenshots.pictures[screenshots.index]).toMatchObject({
    path: cliff.path,
    caption: "Cliff jump",
  });
});

it("finds the game the picture belongs to, whichever game is in front", async () => {
  foregroundPid = HADES_PID;
  captionClosed!({ path: sunrise.path, caption: null, markUp: true });
  await vi.waitFor(() => expect(openedPayload()).toBeDefined());
  expect(openedPayload()!.gameName).toBe("Elden Ring");
  expect(invokeMock).not.toHaveBeenCalledWith(
    "screenshot_caption",
    expect.anything(),
  );
});

it("opens nothing for a caption box closed without marking up", async () => {
  captionClosed!({ path: cliff.path, caption: "Cliff jump", markUp: false });
  await Promise.resolve();
  await Promise.resolve();
  expect(openedPayload()).toBeUndefined();
});

it("says the picture is saved once its marks are, when it was opened to mark up", async () => {
  captionClosed!({ path: cliff.path, caption: null, markUp: true });
  await vi.waitFor(() => expect(openedPayload()).toBeDefined());
  actionHandler!({ kind: "markUp", path: cliff.path, png: "iVBORw==" });
  await vi.waitFor(() =>
    expect(showScreenshotOverlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: "saved", gameName: "Elden Ring" }),
    ),
  );
});

it("shows no popup for marks saved in the box the key opened", async () => {
  await openScreenshotBox();
  actionHandler!({ kind: "markUp", path: sunrise.path, png: "iVBORw==" });
  await vi.waitFor(() => expect(lastUpdate()?.done?.ok).toBe(true));
  expect(showScreenshotOverlay).not.toHaveBeenCalled();
});
