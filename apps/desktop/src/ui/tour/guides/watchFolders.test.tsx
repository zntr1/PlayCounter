// @vitest-environment happy-dom
/* "Watch folders for new games" on the real Library import page. The guide
   only points, so it shows a sample folder and a sample dismissed game
   folder: every control a step names is on screen, the player's own folders
   are neither shown nor changed, and they are back when the guide ends. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { value: "windows" as "windows" | "macos" | "linux" },
}));

vi.mock("../../../platform", () => ({
  currentPlatform: () => mocks.platform.value,
  detectPlatformFrom: () => mocks.platform.value,
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "1.6.0"),
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => true),
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: (value: string) => value,
}));
vi.mock("../../../tracker");

import { applyLanguage } from "../../../i18n";
import {
  readWatchFolders,
  writeWatchFolders,
} from "../../../library/watchFolderState";
import { useAppStore } from "../../../store";
import { restoreDismissedWatchFolder } from "../../../tracker";
import { SettingsView } from "../../views/SettingsView";
import { findTour } from "../tourDefinitions";
import { nextStepIndex } from "../tourNavigation";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.platform.value = "windows";
  vi.mocked(restoreDismissedWatchFolder).mockReset();
  applyLanguage("en");
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const guide = () => findTour("watch-folders")!;

async function render() {
  await act(async () => root.render(createElement(SettingsView)));
  await act(async () => {});
}

async function showStep(id: string) {
  await act(async () => {
    if (!useAppStore.getState().activeTour)
      useAppStore.getState().startTour("watch-folders");
    useAppStore
      .getState()
      .goToTourStep(guide().steps.findIndex((step) => step.id === id));
  });
  await render();
  return guide().steps.find((step) => step.id === id)!;
}

const bold = (text: string) =>
  [...text.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);

// Sidebar entries are part of the app's frame, not of the Settings page.
const inSidebar = (selector: string) => selector.includes('data-tour="nav-');

const ownFolders = {
  folders: ["E:\\MyOwnGames"],
  seen: {},
  pending: {},
  dismissed: [{ folderPath: "E:\\MyOwnGames\\Broken", exeName: "broken.exe" }],
};

describe("every step of Watch folders for new games", () => {
  it("opens Library import and finds its ring there, on a new installation too", async () => {
    const missing: string[] = [];
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      expect(useAppStore.getState().settingsGroup, id).toBe("library");
      for (const selector of [
        ...(step.anchorTargets ?? []),
        step.anchor!,
        ...(step.additionalAnchors ?? []),
      ])
        if (!inSidebar(selector) && !container.querySelector(selector))
          missing.push(`${id} → ${selector}`);
    }
    expect(missing).toEqual([]);
  });

  it("names only controls the page shows, on a new installation too", async () => {
    const unseen: string[] = [];
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      for (const label of bold(step.body))
        if (!container.textContent!.includes(label))
          unseen.push(`${id}: ${label}`);
    }
    expect(unseen).toEqual([]);
  });

  it("puts the ring on the control each text names first", async () => {
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      const [first] = bold(step.body);
      if (!first) continue;
      const rings = [
        [...(step.anchorTargets ?? []), step.anchor!][0],
        ...(step.additionalAnchors ?? []),
      ];
      // A place in the sidebar is rung there; anything else in its own ring.
      expect(
        rings.some(
          (selector) =>
            inSidebar(selector) ||
            container.querySelector(selector)!.textContent!.includes(first),
        ),
        `${id}: ${first}`,
      ).toBe(true);
    }
  });

  it("never rings the whole page", async () => {
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      const ring = container.querySelector(step.anchor!)!;
      expect(ring.matches("[data-settings-page]"), id).toBe(false);
      expect(ring.querySelectorAll("[data-row]").length, id).toBe(0);
    }
  });
});

describe("the sample folder", () => {
  it("stands in for the player's folders while the guide runs", async () => {
    writeWatchFolders(ownFolders);
    await showStep("folder");
    expect(container.textContent).toContain("D:\\Games");
    expect(container.textContent).toContain("Dismissed game folders");
    expect(container.textContent).not.toContain("MyOwnGames");
  });

  it("can't be removed or restored, even when the player watches a folder of the same name", async () => {
    // D:\Games is a likely real folder: the sample must not stand for it.
    const ownFolders = {
      folders: ["D:\\Games"],
      seen: {},
      pending: {},
      dismissed: [{ folderPath: "D:\\Games\\Old Demo", exeName: "demo.exe" }],
    };
    writeWatchFolders(ownFolders);
    await showStep("remove");
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === label,
      )!;
    await act(async () => button("Remove").click());
    await act(async () => button("Restore").click());
    expect(restoreDismissedWatchFolder).not.toHaveBeenCalled();
    expect(readWatchFolders()).toEqual(ownFolders);
    expect(container.textContent).toContain("D:\\Games");
  });

  it("gives way to the player's own folders when the guide ends", async () => {
    writeWatchFolders(ownFolders);
    await showStep("folder");
    await act(async () => useAppStore.getState().endTour("dismissed"));
    useAppStore.getState().setActiveView("settings");
    useAppStore.getState().setSettingsGroup("library");
    await render();
    expect(container.textContent).toContain("E:\\MyOwnGames");
    expect(container.textContent).not.toContain("D:\\Games");
    expect(readWatchFolders()).toEqual(ownFolders);
  });

  it("is not shown outside this guide", async () => {
    useAppStore.getState().setSettingsGroup("library");
    await render();
    expect(container.textContent).not.toContain("D:\\Games");
    useAppStore.getState().startTour("settings");
    useAppStore.getState().setSettingsGroup("library");
    await render();
    expect(container.textContent).not.toContain("D:\\Games");
  });
});

describe("computers without watched folders", () => {
  it("skip every step about them", () => {
    mocks.platform.value = "macos";
    const ids: string[] = [];
    for (
      let index = 0;
      index < guide().steps.length;
      index = nextStepIndex(guide().steps, index, 1, () => false)
    )
      ids.push(guide().steps[index].id);
    expect(ids).toEqual(["intro"]);
  });
});
