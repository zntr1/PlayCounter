// @vitest-environment happy-dom
/* The Settings redesign (docs/settings-mockups.html, layout A), sentence by
   sentence: a side menu with one group per page and a search over every
   setting; hotkeys that save as soon as you press them; settings that need
   another one sit under it; one list for the launcher Forget buttons; a
   Preview for every popup kind; an About page; dots that point at what needs
   you; and Quick Tour steps that open the group they point into. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { value: "windows" as "windows" | "macos" | "linux" },
  saveHotkey: vi.fn(),
  preview: vi.fn(),
  forgetLibrary: vi.fn(),
  autostartEnabled: { value: true },
}));

vi.mock("../../platform", () => ({
  currentPlatform: () => mocks.platform.value,
  detectPlatformFrom: () => mocks.platform.value,
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "1.6.0"),
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => mocks.autostartEnabled.value),
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: (value: string) => value,
}));
vi.mock("../../hotkeys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hotkeys")>()),
  saveHotkey: mocks.saveHotkey,
}));
vi.mock("../../desktopOverlayBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../desktopOverlayBridge")>()),
  previewDesktopOverlay: mocks.preview,
}));
vi.mock("../../tracker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tracker")>()),
  forgetImportedLibraryData: mocks.forgetLibrary,
}));

import { SettingsView } from "./SettingsView";
import { useAppStore } from "../../store";
import { applyLanguage } from "../../i18n";
import { openKeyboardShortcuts } from "../openSettings";
import { tours } from "../tour/tourDefinitions";
import { nextStepIndex } from "../tour/tourNavigation";
import type { SettingsGroupId } from "./settings/settingsGroups";
import type { LibraryImportEntry } from "../../library/types";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.platform.value = "windows";
  mocks.autostartEnabled.value = true;
  mocks.saveHotkey.mockReset();
  mocks.saveHotkey.mockImplementation(
    async (key: string, shortcut: string | null) => {
      useAppStore.getState().setHotkey(key as never, shortcut);
    },
  );
  mocks.preview.mockReset();
  mocks.forgetLibrary.mockReset();
  applyLanguage("en");
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  applyLanguage("en");
  vi.unstubAllGlobals();
});

async function renderSettings(group?: SettingsGroupId) {
  if (group) useAppStore.getState().setSettingsGroup(group);
  await act(async () => root.render(createElement(SettingsView)));
  // Let the version and auto-start checks answer.
  await act(async () => {});
}

const menu = () => container.querySelector<HTMLElement>("nav")!;
const menuItems = () =>
  [...menu().querySelectorAll<HTMLButtonElement>("button[data-group]")].map(
    (item) => item.textContent?.replace(/\d+$/, "").trim(),
  );
const menuItem = (label: string) => {
  const found = [
    ...menu().querySelectorAll<HTMLButtonElement>("button[data-group]"),
  ].find((item) => item.textContent?.startsWith(label));
  expect(found, label).toBeDefined();
  return found!;
};
const pageTitle = () =>
  container.querySelector("[data-settings-page] h2")?.textContent;
const text = () => container.textContent ?? "";

function buttonByText(label: string, root: ParentNode = document) {
  const found = [...root.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}
function byLabel<T extends HTMLElement>(label: string) {
  const found = document.querySelector<T>(`[aria-label="${label}"]`);
  expect(found, label).not.toBeNull();
  return found!;
}
async function click(element: HTMLElement) {
  await act(() => element.click());
}
async function search(query: string) {
  // By role, not name: one test searches the German page.
  const box = menu().querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(box, query);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function press(
  element: HTMLElement,
  init: KeyboardEventInit & { key: string; code: string },
) {
  await act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, ...init }),
    );
  });
}

describe("one group per page, picked in a side menu", () => {
  it("lists the eleven groups in order and opens General first", async () => {
    await renderSettings();
    expect(menuItems()).toEqual([
      "General",
      "Appearance",
      "Keyboard shortcuts",
      "While you play",
      "Desktop popups",
      "Game launching",
      "Library import",
      "Emulators",
      "Discovery",
      "Backup & transfer",
      "About",
    ]);
    expect(pageTitle()).toBe("General");
    expect(menuItem("General").getAttribute("aria-current")).toBe("page");
  });

  it("shows only the picked group's settings", async () => {
    await renderSettings();
    expect(text()).toContain("Launch on startup");
    expect(text()).not.toContain("Bring PlayCounter to front");
    await click(menuItem("Keyboard shortcuts"));
    expect(pageTitle()).toBe("Keyboard shortcuts");
    expect(text()).toContain("Bring PlayCounter to front");
    expect(text()).not.toContain("Launch on startup");
    expect(useAppStore.getState().settingsGroup).toBe("shortcuts");
  });

  it("leaves out the groups this computer can't use, like today's panels", async () => {
    mocks.platform.value = "macos";
    await renderSettings();
    expect(menuItems()).not.toContain("While you play");
    expect(menuItems()).not.toContain("Desktop popups");
    expect(menuItems()).not.toContain("Game launching");
    mocks.platform.value = "linux";
    await act(async () => root.render(createElement(SettingsView)));
    expect(menuItems()).toContain("Desktop popups");
    expect(menuItems()).not.toContain("Game launching");
  });

  it("opens Keyboard shortcuts from the counters tab's Settings link", async () => {
    useAppStore.getState().setActiveView("games");
    openKeyboardShortcuts();
    expect(useAppStore.getState().activeView).toBe("settings");
    expect(useAppStore.getState().settingsGroup).toBe("shortcuts");
  });
});

describe("search over every setting", () => {
  it("finds settings across groups, under their group's name", async () => {
    await renderSettings();
    await search("popup");
    const groups = [
      ...container.querySelectorAll("[data-result-group] [data-group-name]"),
    ].map((item) => item.textContent);
    expect(groups).toEqual(
      expect.arrayContaining([
        "Keyboard shortcuts",
        "While you play",
        "Desktop popups",
      ]),
    );
    expect(text()).toContain("Every game start");
    expect(text()).toContain("Playtime reminder");
    // The menu counts the hits per group and dims the rest.
    expect(menuItem("Desktop popups").textContent).toMatch(/\d+$/);
    expect(menuItem("Appearance").textContent).toBe("Appearance");
  });

  it("lets you change a setting right in the results", async () => {
    await renderSettings();
    await search("game start");
    const before =
      useAppStore.getState().settings.overlaySessionStarts === true;
    await click(byLabel("Every game start"));
    expect(useAppStore.getState().settings.overlaySessionStarts === true).toBe(
      !before,
    );
  });

  it("opens a result's group and forgets the search", async () => {
    await renderSettings();
    await search("milestone");
    await click(buttonByText("Open Desktop popups"));
    expect(pageTitle()).toBe("Desktop popups");
    expect(byLabel<HTMLInputElement>("Search settings").value).toBe("");
  });

  it("says so when nothing matches", async () => {
    await renderSettings();
    await search("xylophone");
    expect(text()).toContain("No settings match “xylophone”.");
  });

  it("searches the texts in the app's language", async () => {
    applyLanguage("de");
    await renderSettings();
    await search("Sprache");
    expect(container.querySelector("[data-results]")).not.toBeNull();
    expect(byLabel("Sprache")).toBeDefined();
  });

  it("shows a setting that needs another one as switched off, with the reason", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: false },
    }));
    await renderSettings();
    await search("milestone");
    expect(byLabel<HTMLInputElement>("Milestones").disabled).toBe(true);
    expect(text()).toContain("Turn on “Show desktop popups” first.");
  });
});

describe("hotkeys save as soon as you press them", () => {
  it("records a combination and saves it at once, without a Save button", async () => {
    await renderSettings("shortcuts");
    expect(
      [...container.querySelectorAll("button")].some(
        (item) => item.textContent?.trim() === "Save",
      ),
    ).toBe(false);
    const key = byLabel<HTMLButtonElement>("Quick add game hotkey");
    await click(key);
    expect(key.textContent).toContain("Press a key combination…");
    await press(key, { key: "q", code: "KeyQ", ctrlKey: true, altKey: true });
    expect(mocks.saveHotkey).toHaveBeenCalledWith(
      "quickAddHotkey",
      "Control+Alt+KeyQ",
    );
    expect(key.textContent).toContain("Ctrl");
    expect(key.textContent).toContain("Q");
    expect(text()).toContain("Saved");
  });

  it("cancels with Esc and keeps the old combination", async () => {
    useAppStore.getState().setHotkey("showWindowHotkey", "Control+Alt+KeyP");
    await renderSettings("shortcuts");
    const key = byLabel<HTMLButtonElement>("Bring PlayCounter to front hotkey");
    await click(key);
    await press(key, { key: "Escape", code: "Escape" });
    expect(mocks.saveHotkey).not.toHaveBeenCalled();
    expect(key.textContent).toContain("P");
  });

  it("explains which keys work instead of saving a lone letter", async () => {
    await renderSettings("shortcuts");
    const key = byLabel<HTMLButtonElement>("Quick session note hotkey");
    await click(key);
    await press(key, { key: "n", code: "KeyN" });
    expect(mocks.saveHotkey).not.toHaveBeenCalled();
    expect(text()).toContain(
      "Use Ctrl, Alt or Win / Cmd with a letter, number or navigation key, or use F1–F24.",
    );
  });

  it("clears a hotkey with its × button", async () => {
    useAppStore.getState().setHotkey("screenshotHotkey", "F9");
    await renderSettings("shortcuts");
    await click(byLabel("Clear Take a screenshot hotkey"));
    expect(mocks.saveHotkey).toHaveBeenCalledWith("screenshotHotkey", null);
  });

  it("groups the hotkeys by what they do and says the fullscreen caveat once", async () => {
    await renderSettings("shortcuts");
    const sections = [
      ...container.querySelectorAll("[data-settings-page] h3"),
    ].map((item) => item.textContent);
    expect(sections).toEqual([
      "PlayCounter",
      "While you play",
      "Counters",
      "Screenshots",
    ]);
    expect(text().match(/the game may minimize while/g)?.length ?? 0).toBe(1);
  });

  it("moved the session popup's clock to Desktop popups", async () => {
    await renderSettings("shortcuts");
    expect(text()).not.toContain("Show clock in session popup");
    await click(menuItem("Desktop popups"));
    expect(byLabel("Show clock in session popup")).toBeDefined();
  });
});

describe("settings that need another one sit under it", () => {
  it("dims everything under Remember launch paths while it is off", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, rememberLaunchPaths: false },
    }));
    await renderSettings("launching");
    expect(byLabel<HTMLInputElement>("Launch games directly").disabled).toBe(
      true,
    );
    expect(
      byLabel<HTMLInputElement>("Hide to tray when a game starts").disabled,
    ).toBe(true);
    expect(text()).toContain("Turn on “Remember launch paths” first.");
    // Only the first switch that is off explains itself.
    expect(text()).not.toContain("Turn on “Launch games directly” first.");
  });

  it("names Launch games directly when only that one is off", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        rememberLaunchPaths: true,
        gameLaunchingEnabled: false,
      },
    }));
    await renderSettings("launching");
    expect(byLabel<HTMLInputElement>("Launch games directly").disabled).toBe(
      false,
    );
    expect(byLabel<HTMLInputElement>("Controller navigation").disabled).toBe(
      true,
    );
    expect(text()).toContain("Turn on “Launch games directly” first.");
  });

  it("asks before Remember launch paths forgets the saved paths", async () => {
    await renderSettings("launching");
    await click(byLabel("Remember launch paths"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Stop remembering launch paths?",
    );
    expect(useAppStore.getState().settings.rememberLaunchPaths).not.toBe(false);
  });

  it("puts the timer position under the live timer", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, liveTimerEnabled: false },
    }));
    await renderSettings("play");
    expect(byLabel<HTMLButtonElement>("Bottom right").disabled).toBe(true);
    expect(text()).toContain("Turn on “Live timer” first.");
  });

  it("dims the popup kinds while desktop popups are off", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: false },
    }));
    await renderSettings("popups");
    expect(byLabel<HTMLInputElement>("First-time detections").disabled).toBe(
      true,
    );
    expect(text()).toContain("Turn on “Show desktop popups” first.");
    // The session popup works without them.
    expect(
      byLabel<HTMLInputElement>("Show clock in session popup").disabled,
    ).toBe(false);
  });
});

describe("visible choices", () => {
  it("picks the theme from two cards", async () => {
    await renderSettings("appearance");
    await click(buttonByText("Light"));
    expect(useAppStore.getState().settings.theme).toBe("light");
    expect(buttonByText("Light").getAttribute("aria-pressed")).toBe("true");
  });

  it("offers eight ready accent colors; amber is the default", async () => {
    await renderSettings("appearance");
    await click(byLabel("Blue"));
    expect(useAppStore.getState().settings.accentColor).toBe("#60a5fa");
    await click(byLabel("Amber (default)"));
    expect(useAppStore.getState().settings.accentColor ?? null).toBeNull();
  });

  it("shows every size at once", async () => {
    await renderSettings("appearance");
    const content = container.querySelector('[aria-label="Content size"]')!;
    await click(buttonByText("120%", content));
    expect(useAppStore.getState().settings.contentScale).toBe(1.2);
  });

  it("picks the start page from two buttons", async () => {
    await renderSettings();
    await click(buttonByText("My Games"));
    expect(useAppStore.getState().settings.startView).toBe("games");
  });

  it("picks the timer's corner on a small screen", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, liveTimerEnabled: true },
    }));
    await renderSettings("play");
    await click(byLabel("Bottom right"));
    expect(useAppStore.getState().settings.liveTimerCorner).toBe(
      "bottom-right",
    );
  });

  it("shows the controller buttons that count", async () => {
    await renderSettings("play");
    const row = container.querySelector('[data-row="controllerCounting"]')!;
    expect(row.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
  });
});

describe("popups", () => {
  it("gives every popup kind its own Preview", async () => {
    await renderSettings("popups");
    const row = container.querySelector('[data-row="overlayFirstDetections"]')!;
    await click(buttonByText("Preview", row));
    expect(mocks.preview).toHaveBeenCalledWith("first-detection");
    const kinds = [
      "overlayActionRequired",
      "overlayFirstDetections",
      "overlaySessionStarts",
      "overlaySessionSummaries",
      "overlayMilestones",
      "overlayDiscoveries",
      "overlayShowClock",
    ];
    for (const kind of kinds)
      expect(
        container.querySelector(`[data-row="${kind}"]`)?.textContent,
        kind,
      ).toContain("Preview");
  });

  it("previews the playtime reminder next to its setting", async () => {
    await renderSettings("play");
    const row = container.querySelector('[data-row="playtimeReminder"]')!;
    await click(buttonByText("Preview", row));
    expect(mocks.preview).toHaveBeenCalledWith("playtime-reminder");
  });
});

describe("one list for imported launcher data", () => {
  function imported(provider: LibraryImportEntry["provider"], count: number) {
    return Array.from({ length: count }, (_, index) => [
      `${provider}:${index}`,
      { provider } as LibraryImportEntry,
    ]);
  }

  it("lists every launcher with its count and asks with the launcher's own text", async () => {
    useAppStore.setState({
      libraryImports: new Map([
        ...imported("steam", 2),
        ...imported("xbox", 1),
      ] as [string, LibraryImportEntry][]),
    });
    await renderSettings("library");
    const list = container.querySelector('[data-row="forgetImports"]')!;
    const rows = [...list.querySelectorAll("li")];
    expect(rows.map((row) => row.querySelector("b")?.textContent)).toEqual([
      "Steam",
      "Xbox",
      "Battle.net",
      "Epic Games",
      "GOG",
      "PlayStation",
    ]);
    expect(rows[0].textContent).toContain("2 games");
    expect(rows[1].textContent).toContain("1 game");
    expect(rows[2].textContent).toContain("Nothing imported");
    expect(buttonByText("Forget", rows[2]).disabled).toBe(true);
    await click(buttonByText("Forget", rows[0]));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Forget imported Steam data?");
    expect(dialog.textContent).toContain(
      "Removes the Steam mark, the imported Steam playtime, the game files Steam linked, and where they are installed.",
    );
    await click(buttonByText("Forget imported data", dialog));
    expect(mocks.forgetLibrary).toHaveBeenCalledWith("steam");
  });

  it("links to Game launching when watched folders need remembered paths", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, rememberLaunchPaths: false },
    }));
    await renderSettings("library");
    await click(buttonByText("Open Game launching"));
    expect(pageTitle()).toBe("Game launching");
  });
});

describe("About, Reset and the menu dots", () => {
  it("keeps version, updates, help and the UUID together on About", async () => {
    useAppStore.setState({ installUuid: "3f6d2c8e-uuid" });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await renderSettings("about");
    expect(text()).toContain("1.6.0");
    expect(buttonByText("Check")).toBeDefined();
    expect(buttonByText("Release notes")).toBeDefined();
    expect(buttonByText("Open Help menu")).toBeDefined();
    expect(text()).toContain("3f6d2c8e-uuid");
    await click(buttonByText("Copy"));
    expect(writeText).toHaveBeenCalledWith("3f6d2c8e-uuid");
  });

  it("puts Reset in a red box at the end of Backup & transfer", async () => {
    await renderSettings("backup");
    const sections = [
      ...container.querySelectorAll("[data-settings-page] section"),
    ];
    const reset = sections.at(-1)!;
    expect(reset.querySelector("h3")?.textContent).toBe("Reset");
    expect(reset.textContent).toContain("Restore default settings");
    expect(reset.textContent).toContain("Start over");
    expect(reset.hasAttribute("data-danger")).toBe(true);
  });

  it("puts a dot on General while auto-start is off", async () => {
    mocks.autostartEnabled.value = false;
    await renderSettings("about");
    expect(
      menuItem("General").querySelector(
        '[aria-label="Auto-start is disabled"]',
      ),
    ).not.toBeNull();
  });

  it("puts a dot on About and offers the install when an update is ready", async () => {
    useAppStore.setState({
      availableUpdate: { status: "available", version: "1.6.1" },
    });
    await renderSettings();
    expect(
      menuItem("About").querySelector('[aria-label="Update available"]'),
    ).not.toBeNull();
    await click(menuItem("About"));
    expect(text()).toContain("Version 1.6.1 is available.");
    expect(buttonByText("Install")).toBeDefined();
  });
});

describe("Quick Tour steps open the group they point into", () => {
  const settingsSteps = () =>
    tours().flatMap((tour) =>
      tour.steps
        .filter(
          (step) =>
            step.view === "settings" &&
            step.anchor?.includes('data-tour="settings-'),
        )
        .map((step) => ({ tour: tour.id, step })),
    );

  it("names a group for every step that points into Settings", () => {
    const missing = settingsSteps()
      .filter(({ step }) => !step.settingsGroup)
      .map(({ tour, step }) => `${tour}/${step.id}`);
    expect(missing).toEqual([]);
  });

  it("finds each step's control on the group it opens", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        rememberLaunchPaths: true,
        gameLaunchingEnabled: true,
      },
    }));
    const missing: string[] = [];
    for (const { tour, step } of settingsSteps()) {
      await renderSettings(step.settingsGroup);
      if (!document.querySelector(step.anchor!))
        missing.push(`${tour}/${step.id} → ${step.anchor}`);
    }
    expect(missing).toEqual([]);
  });

  it("opens the step's group when the tour moves on", () => {
    const guide = tours().find((tour) => tour.id === "settings")!;
    useAppStore.getState().startTour("settings");
    const index = guide.steps.findIndex((step) => step.id === "shortcuts");
    useAppStore.getState().goToTourStep(index);
    expect(useAppStore.getState().settingsGroup).toBe("shortcuts");
  });

  it("doesn't skip a group just because another one is on screen", () => {
    const guide = tours().find((tour) => tour.id === "settings")!;
    const from = guide.steps.findIndex((step) => step.id === "shortcuts");
    const nothingOnScreen = () => false;
    mocks.platform.value = "windows";
    expect(
      guide.steps[nextStepIndex(guide.steps, from, 1, nothingOnScreen)].id,
    ).toBe("notifications");
    mocks.platform.value = "macos";
    expect(
      guide.steps[nextStepIndex(guide.steps, from, 1, nothingOnScreen)].id,
    ).toBe("emulators");
  });
});
