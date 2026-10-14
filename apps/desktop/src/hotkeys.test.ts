import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18next from "i18next";
import {
  disposeHotkeys,
  formatHotkey,
  initializeHotkeys,
  saveHotkey,
  shortcutFromKey,
  useHotkeyStatus,
} from "./hotkeys";
import { showCurrentSessionOverlay } from "./desktopOverlayBridge";
import { openQuickNoteForCurrentSession } from "./quickNote";
import { useAppStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./desktopOverlayBridge", () => ({
  showCurrentSessionOverlay: vi.fn(),
}));
vi.mock("./quickNote", () => ({
  openQuickNoteForCurrentSession: vi.fn(),
}));
const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  invokeMock.mockReset().mockResolvedValue(undefined);
  listenMock.mockReset().mockResolvedValue(vi.fn());
  useHotkeyStatus.setState({ errors: {} });
  useAppStore.setState((state) => ({
    settings: {
      ...state.settings,
      showWindowHotkey: null,
      currentSessionHotkey: null,
      quickNoteHotkey: null,
    },
  }));
});
afterEach(async () => {
  disposeHotkeys();
  await flush();
  vi.useRealTimers();
});

describe("global hotkeys", () => {
  it("restores saved bindings and routes session requests after listening", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        showWindowHotkey: "Control+KeyP",
        currentSessionHotkey: "Alt+F8",
        quickNoteHotkey: "Alt+F9",
      },
    }));
    initializeHotkeys();
    initializeHotkeys();
    await flush();
    expect(listenMock.mock.calls.map(([event]) => event)).toEqual([
      "playcounter:current-session-hotkey",
      "playcounter:quick-note-hotkey",
    ]);
    expect(invokeMock.mock.calls).toEqual([
      [
        "set_global_hotkey",
        { action: "show-window", shortcut: "Control+KeyP" },
      ],
      ["set_global_hotkey", { action: "current-session", shortcut: "Alt+F8" }],
      ["set_global_hotkey", { action: "quick-note", shortcut: "Alt+F9" }],
    ]);
    listenMock.mock.calls[0][1]({ payload: null } as never);
    expect(showCurrentSessionOverlay).toHaveBeenCalledOnce();
    expect(openQuickNoteForCurrentSession).not.toHaveBeenCalled();
    vi.mocked(openQuickNoteForCurrentSession).mockReturnValueOnce(true);
    listenMock.mock.calls[1][1]({ payload: null } as never);
    expect(openQuickNoteForCurrentSession).toHaveBeenCalledOnce();
    expect(showCurrentSessionOverlay).toHaveBeenCalledOnce();
    // Nothing running: the session popup says so instead.
    vi.mocked(openQuickNoteForCurrentSession).mockReturnValueOnce(false);
    listenMock.mock.calls[1][1]({ payload: null } as never);
    expect(showCurrentSessionOverlay).toHaveBeenCalledTimes(2);
  });

  it("keeps saved settings when registration fails and can clear the binding", async () => {
    await saveHotkey("showWindowHotkey", "Control+KeyP");
    invokeMock.mockRejectedValueOnce("Already registered by another app");
    await expect(
      saveHotkey("showWindowHotkey", "Control+KeyQ"),
    ).rejects.toBeDefined();
    expect(useAppStore.getState().settings.showWindowHotkey).toBe(
      "Control+KeyP",
    );
    expect(useHotkeyStatus.getState().errors.showWindowHotkey).toContain(
      "Already registered",
    );
    await saveHotkey("showWindowHotkey", null);
    expect(useAppStore.getState().settings.showWindowHotkey).toBeNull();
    expect(useHotkeyStatus.getState().errors.showWindowHotkey).toBeUndefined();
  });

  it("restores the second action even if the first shortcut is unavailable", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        showWindowHotkey: "Control+KeyP",
        currentSessionHotkey: "Alt+F8",
      },
    }));
    invokeMock.mockRejectedValueOnce("In use");
    initializeHotkeys();
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("set_global_hotkey", {
      action: "current-session",
      shortcut: "Alt+F8",
    });
    expect(useHotkeyStatus.getState().errors.showWindowHotkey).toBe("In use");
  });

  it("removes a late listener and unregisters shortcuts when disposed during startup", async () => {
    let resolve!: (stop: () => void) => void;
    listenMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    initializeHotkeys();
    await flush();
    disposeHotkeys();
    const unlisten = vi.fn();
    resolve(unlisten);
    await flush();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls).toEqual([
      ["set_global_hotkey", { action: "show-window", shortcut: null }],
      ["set_global_hotkey", { action: "current-session", shortcut: null }],
      ["set_global_hotkey", { action: "quick-note", shortcut: null }],
    ]);
  });
});

describe("shortcut recorder", () => {
  const key = {
    key: "p",
    code: "KeyP",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
  };
  it("does not reserve ordinary typing, modifiers alone, or key repeats", () => {
    expect(shortcutFromKey(key)).toBeNull();
    expect(shortcutFromKey({ ...key, shiftKey: true })).toBeNull();
    expect(
      shortcutFromKey({ ...key, code: "ControlLeft", ctrlKey: true }),
    ).toBeNull();
    expect(shortcutFromKey({ ...key, ctrlKey: true, repeat: true })).toBeNull();
  });
  it("records canonical letter keys and function keys", () => {
    expect(shortcutFromKey({ ...key, ctrlKey: true, shiftKey: true })).toBe(
      "Control+Shift+KeyP",
    );
    expect(
      shortcutFromKey({
        ...key,
        code: "Digit1",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("Control+Shift+Digit1");
    expect(shortcutFromKey({ ...key, code: "F8" })).toBe("F8");
  });
  it("honors letters on a German keyboard rather than swapping Y and Z", () => {
    expect(
      shortcutFromKey({ ...key, code: "KeyY", key: "z", ctrlKey: true }),
    ).toBe("Control+KeyZ");
  });
  it("records the same shortcut in every language and only translates the label", async () => {
    await i18next.changeLanguage("de");
    try {
      expect(shortcutFromKey({ ...key, ctrlKey: true, shiftKey: true })).toBe(
        "Control+Shift+KeyP",
      );
      expect(formatHotkey("Control+Shift+KeyP")).toBe("Strg+Umschalt+P");
    } finally {
      await i18next.changeLanguage("en");
    }
  });
});
