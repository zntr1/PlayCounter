// @vitest-environment happy-dom
/* "Personalize PlayCounter" on the real Settings page: every step rings a
   single row (never a whole group), names only what its page shows, opens
   its own page from anywhere, and skips what this computer doesn't have.
   Settings → While you play and Keyboard shortcuts offer "Show me how". */
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
import { useAppStore } from "../../../store";
import { SettingsView } from "../../views/SettingsView";
import { findTour } from "../tourDefinitions";
import { nextStepIndex } from "../tourNavigation";
import type { TourStep } from "../tourTypes";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.platform.value = "windows";
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

const guide = () => findTour("settings")!;

/** The guide at this step, with Settings on screen. */
async function showStep(id: string) {
  await act(async () => {
    if (!useAppStore.getState().activeTour)
      useAppStore.getState().startTour("settings");
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

/** Everything a player can read on the page: texts, tooltips, field hints. */
function shownTexts() {
  return [
    container.textContent ?? "",
    ...[...container.querySelectorAll("*")].flatMap((element) =>
      ["aria-label", "title", "placeholder"].map(
        (name) => element.getAttribute(name) ?? "",
      ),
    ),
  ];
}

const selectors = (step: TourStep) => [
  ...(step.anchor ? [step.anchor] : []),
  ...(step.additionalAnchors ?? []),
  ...(step.allow ?? []),
];

/** The ids of the steps a player walks through on this computer. */
function walk() {
  const ids: string[] = [];
  for (
    let index = 0;
    index < guide().steps.length;
    index = nextStepIndex(guide().steps, index, 1, () => false)
  )
    ids.push(guide().steps[index].id);
  return ids;
}

describe("every step of Personalize PlayCounter", () => {
  it("finds its ring and every control it unlocks on the page it opens", async () => {
    const missing: string[] = [];
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      for (const selector of selectors(step))
        if (!container.querySelector(selector))
          missing.push(`${id} → ${selector}`);
    }
    expect(missing).toEqual([]);
  });

  it("rings a single row, a field or a button, never a whole group", async () => {
    const wide: string[] = [];
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      for (const selector of [
        ...(step.anchor ? [step.anchor] : []),
        ...(step.additionalAnchors ?? []),
      ]) {
        const ring = container.querySelector(selector);
        if (
          !ring ||
          ring.matches("[data-settings-page]") ||
          ring.querySelectorAll("[data-row]").length > 0
        )
          wide.push(`${id} → ${selector}`);
      }
    }
    expect(wide).toEqual([]);
  });

  it("names only controls its page shows", async () => {
    const unseen: string[] = [];
    for (const { id } of guide().steps) {
      const step = await showStep(id);
      const shown = shownTexts();
      for (const label of bold(`${step.body} ${step.task ?? ""}`))
        if (!shown.some((text) => text.includes(label)))
          unseen.push(`${id}: ${label}`);
    }
    expect(unseen).toEqual([]);
  });

  it("opens its own page when the player jumps to it from anywhere", () => {
    useAppStore.getState().startTour("settings");
    guide().steps.forEach((step, index) => {
      useAppStore.getState().setSettingsGroup("about");
      useAppStore.getState().setActiveView("games");
      useAppStore.getState().goToTourStep(index, true);
      expect(useAppStore.getState().activeView, step.id).toBe("settings");
      expect(useAppStore.getState().settingsGroup, step.id).toBe(
        step.settingsGroup,
      );
    });
  });

  it("keeps the search closed during the guide, so a ring never points at results", async () => {
    await showStep("intro");
    const search = container.querySelector<HTMLInputElement>(
      '[data-tour="settings-search"] input',
    )!;
    expect(search.placeholder).toBe("Search settings");
    expect(search.disabled).toBe(true);
  });
});

describe("pages this computer doesn't have", () => {
  it("shows all nine steps on Windows", () => {
    expect(walk()).toEqual([
      "intro",
      "general",
      "appearance",
      "shortcuts",
      "play",
      "launcher",
      "library",
      "sharing",
      "updates",
    ]);
  });

  it("leaves out While you play, Game launching and auto-add on a Mac", () => {
    mocks.platform.value = "macos";
    expect(walk()).toEqual([
      "intro",
      "general",
      "appearance",
      "shortcuts",
      "sharing",
      "updates",
    ]);
  });

  it("leaves out Game launching and auto-add on Linux", () => {
    mocks.platform.value = "linux";
    expect(walk()).not.toContain("launcher");
    expect(walk()).toContain("play");
  });
});

describe("Show me how", () => {
  const link = () =>
    container.querySelector<HTMLButtonElement>("[data-guide-link]");

  async function openPage(group: Parameters<typeof setGroup>[0]) {
    setGroup(group);
    await act(async () => root.render(createElement(SettingsView)));
    await act(async () => {});
  }
  function setGroup(
    group: Parameters<
      ReturnType<typeof useAppStore.getState>["setSettingsGroup"]
    >[0],
  ) {
    useAppStore.getState().setSettingsGroup(group);
  }

  it("starts While you play from the head of Settings → While you play", async () => {
    await openPage("play");
    expect(link()?.dataset.guideLink).toBe("while-you-play");
    expect(link()?.closest("header")).not.toBeNull();
    await act(async () => link()!.click());
    expect(useAppStore.getState().activeTour?.tourId).toBe("while-you-play");
  });

  it("starts While you play from the head of Keyboard shortcuts too", async () => {
    await openPage("shortcuts");
    expect(link()?.dataset.guideLink).toBe("while-you-play");
    expect(link()?.closest("header")).not.toBeNull();
  });

  it("is on no other page", async () => {
    for (const group of [
      "general",
      "appearance",
      "popups",
      "launching",
      "library",
      "emulators",
      "discovery",
      "backup",
      "about",
    ] as const) {
      await openPage(group);
      expect(link(), group).toBeNull();
    }
  });

  it("hides while a guide runs", async () => {
    await showStep("shortcuts");
    expect(link()).toBeNull();
  });
});
