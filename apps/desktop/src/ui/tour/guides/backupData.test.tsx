// @vitest-environment happy-dom
/* "Back up or move your data" on the real Backup & transfer page: every ring
   sits on one row or on a small section, the texts name what the page shows,
   the Reset section has its step, and what the guide says a backup leaves
   out is what a backup really leaves out. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../platform", () => ({
  currentPlatform: () => "windows",
  detectPlatformFrom: () => "windows",
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

import { createTransferData } from "../../../backup";
import { applyLanguage } from "../../../i18n";
import { useAppStore } from "../../../store";
import { SettingsView } from "../../views/SettingsView";
import { findTour } from "../tourDefinitions";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
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

const guide = () => findTour("backup-data")!;

async function showStep(id: string) {
  await act(async () => {
    if (!useAppStore.getState().activeTour)
      useAppStore.getState().startTour("backup-data");
    useAppStore
      .getState()
      .goToTourStep(guide().steps.findIndex((step) => step.id === id));
  });
  await act(async () => root.render(createElement(SettingsView)));
  await act(async () => {});
  return guide().steps.find((step) => step.id === id)!;
}

const bold = (text: string) =>
  [...text.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);

describe("every step of Back up or move your data", () => {
  it("opens Backup & transfer and finds its rings there", async () => {
    const missing: string[] = [];
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      expect(useAppStore.getState().settingsGroup, id).toBe("backup");
      for (const selector of [step.anchor!, ...(step.additionalAnchors ?? [])])
        if (!container.querySelector(selector))
          missing.push(`${id} → ${selector}`);
    }
    expect(missing).toEqual([]);
  });

  it("never rings the whole page, and at most two rows at once", async () => {
    const wide: string[] = [];
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      const ring = container.querySelector(step.anchor!)!;
      if (
        ring.matches("[data-settings-page]") ||
        ring.querySelectorAll("[data-row]").length > 2
      )
        wide.push(id);
    }
    expect(wide).toEqual([]);
  });

  it("names only what the page shows, inside or next to its ring", async () => {
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
      const rings = [step.anchor!, ...(step.additionalAnchors ?? [])].map(
        (selector) => container.querySelector(selector)!,
      );
      // The name stands in the ring, or the ring is the control in its row.
      expect(
        rings.some((ring) =>
          (
            ring.closest("[data-row], section, header") ?? ring
          ).textContent!.includes(first),
        ),
        `${id}: ${first}`,
      ).toBe(true);
    }
  });
});

describe("the Reset section", () => {
  it("is rung as one section with its two rows, and stays locked", async () => {
    const step = await showStep("reset");
    const ring = container.querySelector(step.anchor!)!;
    expect(ring.hasAttribute("data-danger")).toBe(true);
    expect(
      [...ring.querySelectorAll("[data-row]")].map((row) =>
        row.getAttribute("data-row"),
      ),
    ).toEqual(["resetSettings", "resetAll"]);
    expect(step.interactive).toBeUndefined();
  });
});

describe("what the guide says stays on this PC", () => {
  it("is really left out of a backup", () => {
    const backup = createTransferData({
      sessions: [{ id: 1 }],
      // Ignored apps.
      blacklist: ["discord.exe"],
      // Saved launch paths.
      launchTargets: [{ exeName: "game.exe", exePath: "D:\\Games\\game.exe" }],
      manualLaunchTargets: [{ exeName: "other.exe" }],
    });
    expect(backup).toEqual({ sessions: [{ id: 1 }] });
  });

  it("covers watched folders, which live outside the saved data", async () => {
    const { addWatchFolder } =
      await import("../../../library/watchFolderState");
    const { readPersistedRecord } = await import("../../../persistence");
    addWatchFolder("D:\\Games");
    // A backup is built from PlayCounter's saved record. Watched folders
    // have their own place in this PC's storage and are not part of it.
    expect(localStorage.getItem("playcounter.watchFolders")).toContain("Games");
    expect(
      JSON.stringify(createTransferData(readPersistedRecord())),
    ).not.toContain("Games");
  });
});
