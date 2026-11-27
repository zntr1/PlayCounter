// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appLocale } from "../i18n";
import {
  closeScreenshotViewer,
  toScreenshot,
  useScreenshots,
  useScreenshotViewer,
  type ScreenshotFile,
} from "../screenshots";
import { useAppStore, type ActiveSession } from "../store";
import { NowPlayingScreenshots } from "./SessionScreenshots";

/* docs/session-screenshots-plan.md, "Now Playing": this session's pictures
   in the game's box, newest first, six and then "+N". A click opens the
   viewer with all of the game's pictures, each under its session. */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
// happy-dom can't load asset:// files: every picture would fail.
vi.mock("./ArtImage", () => ({
  ArtImage: ({ onError: _failed, ...props }: ComponentProps<"img">) => (
    <img {...props} />
  ),
}));

const SATURDAY = new Date(2026, 10, 23, 19, 0, 0).getTime();
const TONIGHT = new Date(2026, 10, 27, 20, 0, 0).getTime();
const minutes = (count: number) => count * 60_000;

function file(ms: number, caption: string | null = null): ScreenshotFile {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  const name = `Elden Ring ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-00.jpg`;
  return {
    path: `C:\\Pictures\\PlayCounter\\Elden Ring\\${name}`,
    folder: "Elden Ring",
    name,
    bytes: 1000,
    modifiedMs: ms,
    previewPath: `C:\\previews\\${name}`,
    caption,
  };
}

const session: ActiveSession = {
  id: 2,
  gameId: 1,
  source: "custom",
  gameName: "Elden Ring",
  exeName: "eldenring.exe",
  coverUrl: "",
  startedAt: new Date(TONIGHT).toISOString(),
  checkpointedAt: new Date(TONIGHT).toISOString(),
};
const saturdayShot = file(SATURDAY + minutes(40), "Fork past the bridge");
/** Tonight's eight pictures, 5 minutes apart, oldest first. */
const tonight = Array.from({ length: 8 }, (_, index) =>
  file(TONIGHT + minutes(5 * (index + 1)), index === 7 ? "Sunrise" : null),
);

let root: Root;
let container: HTMLDivElement;

async function show(files: ScreenshotFile[]) {
  useScreenshots.setState({ files: files.map(toScreenshot) });
  await act(() => root.render(<NowPlayingScreenshots session={session} />));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TONIGHT + minutes(60));
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeSessions: [session],
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => closeScreenshotViewer());
  await act(() => root.unmount());
  container.remove();
  useScreenshots.setState({ files: [] });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tiles = () => [...container.querySelectorAll("li button")];

it("shows nothing before the first picture of this session", async () => {
  await show([saturdayShot]);
  expect(container.innerHTML).toBe("");
});

it("shows this session's pictures newest first, six, then how many more", async () => {
  await show([saturdayShot, ...tonight]);
  expect(container.textContent).toContain("8 screenshots this session");
  const shown = tiles().slice(0, 6);
  expect(
    shown.map((tile) => tile.querySelector("img")?.getAttribute("src")),
  ).toEqual(
    [...tonight]
      .reverse()
      .slice(0, 6)
      .map((entry) => `asset://${entry.previewPath}`),
  );
  expect(tiles()[0].getAttribute("title")).toBe("Sunrise");
  expect(tiles()[6].textContent).toBe("+2");
  expect(tiles()).toHaveLength(7);
});

it("says one screenshot when there is one", async () => {
  await show([tonight[0]]);
  expect(container.textContent).toContain("1 screenshot this session");
});

it("opens the viewer with all of the game's pictures at the one clicked, each under its session", async () => {
  await show([saturdayShot, ...tonight]);
  // The second newest.
  await act(() => (tiles()[1] as HTMLButtonElement).click());
  const viewer = useScreenshotViewer.getState();
  const paths = viewer.shots.map((shot) => ("path" in shot ? shot.path : ""));
  expect(paths).toEqual([saturdayShot, ...tonight].map((entry) => entry.path));
  expect(viewer.index).toBe(7);
  expect(viewer.title).toBe("Elden Ring");
  expect(viewer.groups?.get(saturdayShot.path)).toEqual({
    key: "session:1",
    label: new Date(SATURDAY).toLocaleDateString(appLocale(), {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    current: false,
  });
  expect(viewer.groups?.get(tonight[6].path)).toEqual({
    key: "session:2",
    label: "This session",
    current: true,
  });
});

it("opens the viewer at the first hidden picture from “+N”", async () => {
  await show([saturdayShot, ...tonight]);
  await act(() => (tiles()[6] as HTMLButtonElement).click());
  const viewer = useScreenshotViewer.getState();
  // The seventh newest is the second oldest of tonight's: index 2 overall.
  expect(viewer.index).toBe(2);
});
