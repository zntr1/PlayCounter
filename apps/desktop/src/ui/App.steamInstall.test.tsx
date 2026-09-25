// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import type { LibraryImportEntry } from "../library/types";
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

const imported: LibraryImportEntry = {
  provider: "steam",
  externalId: "698780",
  gameId: 1,
  igdbId: 100,
  source: "igdb",
  name: "Doki Doki Literature Club!",
  coverUrl: "",
  importedAt: "2026-09-25T12:00:00Z",
  lastReadAt: "2026-09-25T12:00:00Z",
  providerSeconds: 60,
  linkedExeNames: [],
  linkedExeSources: [],
};
const installLabel = `Install ${imported.name} in Steam`;
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
    activeView: "games",
    lastSeenReleaseNotesVersion: "1.1.18",
    libraryImports: new Map([["steam:698780", imported]]),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.mocked(invoke).mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installButtons() {
  return container.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${installLabel}"]`,
  );
}

it("offers Steam's installer for an uninstalled import when turned on", async () => {
  useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
  useAppStore.getState().setShowInstallInSteam(true);
  await act(() => root.render(<App />));

  expect(installButtons().length).toBeGreaterThan(0);
  await act(async () => installButtons()[0].click());
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("library_launch_app", {
      provider: "steam",
      externalId: "698780",
      mode: "install",
    }),
  );

  await act(() =>
    useAppStore.getState().setLibraryInstall({
      provider: "steam",
      externalId: "698780",
      installPath: String.raw`C:\Steam\steamapps\common\Doki Doki Literature Club`,
      scannedAt: "2026-09-25T12:05:00Z",
    }),
  );
  expect(installButtons()).toHaveLength(0);
});

it("keeps the installer hidden by default", async () => {
  useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
  await act(() => root.render(<App />));
  expect(installButtons()).toHaveLength(0);
});

it("keeps the installer hidden while PlayCounter may not launch games", async () => {
  useAppStore.getState().setShowInstallInSteam(true);
  useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);
  await act(() => root.render(<App />));
  expect(installButtons()).toHaveLength(0);
});
