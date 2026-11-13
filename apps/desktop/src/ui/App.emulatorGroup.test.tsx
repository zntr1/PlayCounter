// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EmulatorMapping, KnownEmulator } from "../emulators/types";
import { useAppStore } from "../store";
import { App } from "./App";
import { useLibrarySources } from "./librarySources";

vi.mock("../tracker");
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
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

const SEEN = "2026-11-01T12:00:00Z";

function known(emulatorId: string, label: string): [string, KnownEmulator] {
  return [
    emulatorId,
    {
      emulatorId,
      label,
      firstSeenAt: SEEN,
      lastSeenAt: SEEN,
      hostExeNames: [`${emulatorId}.exe`],
    },
  ];
}

// A game match the player still has to confirm: one badge on its emulator.
function unconfirmed(emulatorId: string, title: string): EmulatorMapping {
  return {
    contentKey: `${emulatorId}:title_id:${title}`,
    emulatorId,
    label: title,
    contentKind: "title_id",
    contentValue: title,
    display: title,
    trust: "recognized",
    decision: "game",
    gameName: title,
    confidence: "probable",
    needsConfirmation: true,
    decidedAt: SEEN,
    lastSeenAt: SEEN,
  };
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    lastSeenReleaseNotesVersion: "1.1.18",
    knownEmulators: new Map([
      known("dolphin", "Dolphin"),
      known("pcsx2", "PCSX2"),
      known("ppsspp", "PPSSPP"),
    ]),
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

function groupRow() {
  return container.querySelector<HTMLButtonElement>(
    '[data-tour="nav-emulator-group"]',
  );
}

function navRow(view: string) {
  return container.querySelector<HTMLButtonElement>(
    `[data-tour="nav-${view}"]`,
  );
}

async function render() {
  await act(() => root.render(<App />));
}

it("puts two or more emulators under one Emulators row that opens and closes", async () => {
  await render();
  expect(groupRow()?.textContent).toContain("Emulators");
  expect(groupRow()?.getAttribute("aria-expanded")).toBe("true");
  expect(navRow("dolphin")).not.toBeNull();
  expect(navRow("pcsx2")).not.toBeNull();
  expect(navRow("ppsspp")).not.toBeNull();

  await act(() => groupRow()!.click());
  expect(groupRow()?.getAttribute("aria-expanded")).toBe("false");
  expect(navRow("dolphin")).toBeNull();
  expect(navRow("pcsx2")).toBeNull();
  expect(navRow("ppsspp")).toBeNull();

  await act(() => groupRow()!.click());
  expect(groupRow()?.getAttribute("aria-expanded")).toBe("true");
  expect(navRow("pcsx2")).not.toBeNull();
});

it("clicking the Emulators row only opens or closes it and opens no page", async () => {
  await render();
  await act(() => groupRow()!.click());
  expect(useAppStore.getState().activeView).toBe("games");
  await act(() => groupRow()!.click());
  expect(useAppStore.getState().activeView).toBe("games");
});

it("remembers a closed Emulators group", async () => {
  await render();
  await act(() => groupRow()!.click());
  expect(useAppStore.getState().settings.sidebarEmulatorsCollapsed).toBe(true);

  await act(() => root.unmount());
  root = createRoot(container);
  await render();
  expect(groupRow()?.getAttribute("aria-expanded")).toBe("false");
  expect(navRow("dolphin")).toBeNull();
});

it("shows the review badges of all emulators on the closed Emulators row", async () => {
  useAppStore.setState({
    emulatorMappings: new Map(
      [
        unconfirmed("dolphin", "GM8E01"),
        unconfirmed("dolphin", "GZLE01"),
        unconfirmed("pcsx2", "SLUS-20946"),
      ].map((mapping) => [mapping.contentKey, mapping]),
    ),
  });
  useAppStore.getState().setSidebarEmulatorsCollapsed(true);
  await render();
  expect(groupRow()?.textContent).toContain("3");

  await act(() => groupRow()!.click());
  expect(groupRow()?.textContent).not.toContain("3");
  expect(navRow("dolphin")?.textContent).toContain("2");
  expect(navRow("pcsx2")?.textContent).toContain("1");
});

it("keeps a single emulator as its own row, without a group", async () => {
  useAppStore.setState({
    knownEmulators: new Map([known("dolphin", "Dolphin")]),
  });
  await render();
  expect(groupRow()).toBeNull();
  expect(navRow("dolphin")?.textContent).toContain("Dolphin");
});

it("counts only emulators the sidebar shows: an ignored one does not make a group", async () => {
  useAppStore.setState({
    knownEmulators: new Map([
      known("dolphin", "Dolphin"),
      known("pcsx2", "PCSX2"),
    ]),
  });
  useAppStore.setState((state) => ({
    settings: { ...state.settings, ignoredEmulatorIds: ["pcsx2"] },
  }));
  await render();
  expect(groupRow()).toBeNull();
  expect(navRow("dolphin")).not.toBeNull();
  expect(navRow("pcsx2")).toBeNull();
});

it("keeps Now Emulating outside the group, visible while the group is closed", async () => {
  useAppStore.getState().setSidebarEmulatorsCollapsed(true);
  useAppStore.setState({ activeView: "emulating" });
  await render();
  expect(groupRow()?.getAttribute("aria-expanded")).toBe("false");
  expect(navRow("emulating")?.textContent).toContain("Now Emulating");
});

it("opens the group during the emulator guide so its Dolphin step can point at Dolphin", async () => {
  useAppStore.getState().setSidebarEmulatorsCollapsed(true);
  useAppStore.setState({
    activeTour: {
      tourId: "emulators",
      stepIndex: 2,
      returnView: "games",
      enteredStepAt: Date.now(),
    },
  });
  await render();
  expect(groupRow()?.getAttribute("aria-expanded")).toBe("true");
  expect(navRow("dolphin")).not.toBeNull();
  // The guide does not change the player's saved choice.
  expect(useAppStore.getState().settings.sidebarEmulatorsCollapsed).toBe(true);
});
