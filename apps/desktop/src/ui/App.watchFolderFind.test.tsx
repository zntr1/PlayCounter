// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeWatchFolders } from "../library/watchFolderState";
import { useAppStore } from "../store";
import { App } from "./App";
import { useLibrarySources } from "./librarySources";

vi.mock("../tracker");
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.1.18" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
  disable: async () => {},
}));
vi.mock("./tour/TourUI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tour/TourUI")>()),
  WelcomePrompt: () => null,
  TourOverlay: () => null,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useAppStore.setState({
    activeView: "discovered",
    lastSeenReleaseNotesVersion: "1.1.18",
    exeCache: new Map([
      [
        "tool.exe",
        {
          exeName: "Tool.exe",
          state: "unmatched",
          lastCheckedAt: "2026-09-25T12:00:00.000Z",
        },
      ],
    ]),
  });
  writeWatchFolders({
    folders: ["D:\\Games"],
    seen: ["d:\\games\\unknown"],
    pending: {
      "tool.exe": {
        exePath: "D:\\Games\\Unknown\\Tool.exe",
        folderPath: "D:\\Games\\Unknown",
        folderName: "Unknown",
      },
    },
    dismissed: [],
  });
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

it("shows where a watched folder found a file in Discovered", async () => {
  await act(() => root.render(<App />));
  expect(container.textContent).toContain("Found in D:\\Games\\Unknown");
});
