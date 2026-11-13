// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  toScreenshot,
  useScreenshots,
  type ScreenshotFile,
} from "../screenshots";
import { useAppStore } from "../store";
import { SessionScreenshots } from "./SessionScreenshots";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function file(name: string, caption: string | null): ScreenshotFile {
  return {
    path: `C:\\Pictures\\PlayCounter\\Elden Ring\\${name}`,
    folder: "Elden Ring",
    name,
    bytes: 1000,
    modifiedMs: 0,
    previewPath: `C:\\previews\\${name}`,
    caption,
  };
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const start = new Date(2026, 10, 8, 20, 0, 0).getTime();
  useAppStore.setState({
    activeSessions: [],
    recentSessions: [
      {
        id: 1,
        gameId: 1,
        gameName: "Elden Ring",
        exeName: "eldenring.exe",
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(start + 2 * 3_600_000).toISOString(),
        durationSeconds: 2 * 3600,
      },
    ],
  });
  useScreenshots.setState({
    files: [
      toScreenshot(file("Elden Ring 2026-11-08 20-31-00.jpg", "Boss arena")),
      toScreenshot(file("Elden Ring 2026-11-08 20-58-00.jpg", null)),
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(<SessionScreenshots sessionId={1} gameName="Elden Ring" />),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useScreenshots.setState({ files: [] });
  vi.unstubAllGlobals();
});

it("marks pictures with a caption and shows the caption on hover", () => {
  const [captioned, plain] = [...container.querySelectorAll("li button")];
  expect(captioned.getAttribute("title")).toBe("Boss arena");
  expect(captioned.querySelector("[data-caption-mark]")).not.toBeNull();
  expect(plain.hasAttribute("title")).toBe(false);
  expect(plain.querySelector("[data-caption-mark]")).toBeNull();
});
