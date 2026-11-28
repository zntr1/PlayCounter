import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18next from "i18next";
import {
  disposeHotkeys,
  formatHotkey,
  initializeHotkeys,
  saveHotkey,
  setMouseHotkeyGames,
  shortcutFromKey,
  shortcutFromMouse,
  useHotkeyStatus,
} from "./hotkeys";
import { showCurrentSessionOverlay } from "./desktopOverlayBridge";
import { cycleLiveTimer } from "./liveTimer";
import { openQuickNoteForCurrentSession } from "./quickNote";
import { openScreenshotBox, openToMarkUp } from "./screenshotBox";
import { openQuickAdd } from "./quickAdd";
import { takeScreenshot } from "./screenshots";
import { togglePauseFromHotkey } from "./tracker";
import { useAppStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./desktopOverlayBridge", () => ({
  showCurrentSessionOverlay: vi.fn(),
}));
vi.mock("./quickNote", () => ({
  openQuickNoteForCurrentSession: vi.fn(),
}));
vi.mock("./quickAdd", () => ({ openQuickAdd: vi.fn() }));
vi.mock("./liveTimer", () => ({ cycleLiveTimer: vi.fn() }));
vi.mock("./screenshots", () => ({ takeScreenshot: vi.fn() }));
vi.mock("./screenshotBox", () => ({
  openScreenshotBox: vi.fn(),
  openToMarkUp: vi.fn(),
}));
vi.mock("./tracker", () => ({ togglePauseFromHotkey: vi.fn() }));
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
      liveTimerHotkey: null,
      pauseTimerHotkey: null,
      screenshotHotkey: null,
      screenshotViewerHotkey: null,
      screenshotMarkUpHotkey: null,
      quickAddHotkey: null,
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
        liveTimerHotkey: "Alt+F10",
        pauseTimerHotkey: "Alt+F6",
        screenshotHotkey: "Alt+F11",
        screenshotViewerHotkey: "Alt+F5",
        screenshotMarkUpHotkey: "Alt+F4",
        quickAddHotkey: "Alt+F7",
      },
    }));
    initializeHotkeys();
    initializeHotkeys();
    await flush();
    expect(listenMock.mock.calls.map(([event]) => event)).toEqual([
      "playcounter:current-session-hotkey",
      "playcounter:quick-note-hotkey",
      "playcounter:live-timer-hotkey",
      "playcounter:pause-timer-hotkey",
      "playcounter:screenshot-hotkey",
      "playcounter:screenshot-viewer-hotkey",
      "playcounter:screenshot-markup-hotkey",
      "playcounter:quick-add-hotkey",
      "playcounter:counter-undo-hotkey",
      "playcounter:counter-box-hotkey",
    ]);
    expect(invokeMock.mock.calls).toEqual([
      [
        "set_global_hotkey",
        { action: "show-window", shortcut: "Control+KeyP" },
      ],
      ["set_global_hotkey", { action: "current-session", shortcut: "Alt+F8" }],
      ["set_global_hotkey", { action: "quick-note", shortcut: "Alt+F9" }],
      ["set_global_hotkey", { action: "live-timer", shortcut: "Alt+F10" }],
      ["set_global_hotkey", { action: "pause-timer", shortcut: "Alt+F6" }],
      ["set_global_hotkey", { action: "screenshot", shortcut: "Alt+F11" }],
      [
        "set_global_hotkey",
        { action: "screenshot-viewer", shortcut: "Alt+F5" },
      ],
      [
        "set_global_hotkey",
        { action: "screenshot-markup", shortcut: "Alt+F4" },
      ],
      ["set_global_hotkey", { action: "quick-add", shortcut: "Alt+F7" }],
      ["set_global_hotkey", { action: "counter-undo", shortcut: null }],
      ["set_global_hotkey", { action: "counter-box", shortcut: null }],
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
    listenMock.mock.calls[2][1]({ payload: null } as never);
    expect(cycleLiveTimer).toHaveBeenCalledOnce();
    // docs/pause-timer-plan.md: the pause hotkey.
    listenMock.mock.calls[3][1]({ payload: null } as never);
    expect(togglePauseFromHotkey).toHaveBeenCalledOnce();
    listenMock.mock.calls[4][1]({ payload: null } as never);
    expect(takeScreenshot).toHaveBeenCalledOnce();
    expect(takeScreenshot).toHaveBeenLastCalledWith();
    // docs/session-screenshots-plan.md: the game's pictures, over the game.
    listenMock.mock.calls[5][1]({ payload: null } as never);
    expect(openScreenshotBox).toHaveBeenCalledOnce();
    expect(takeScreenshot).toHaveBeenCalledTimes(1);
    // The same picture, then straight into mark up over the game.
    listenMock.mock.calls[6][1]({ payload: null } as never);
    expect(takeScreenshot).toHaveBeenCalledTimes(2);
    expect(takeScreenshot).toHaveBeenLastCalledWith({ markUp: openToMarkUp });
  });

  it("opens the quick add box from its hotkey, with no game running", async () => {
    await saveHotkey("quickAddHotkey", "Control+Alt+KeyA");
    expect(invokeMock).toHaveBeenCalledWith("set_global_hotkey", {
      action: "quick-add",
      shortcut: "Control+Alt+KeyA",
    });
    expect(useAppStore.getState().settings.quickAddHotkey).toBe(
      "Control+Alt+KeyA",
    );
    const quickAdd = listenMock.mock.calls.find(
      ([event]) => event === "playcounter:quick-add-hotkey",
    );
    expect(useAppStore.getState().activeSessions).toEqual([]);
    quickAdd![1]({ payload: null } as never);
    expect(openQuickAdd).toHaveBeenCalledOnce();
    expect(openQuickNoteForCurrentSession).not.toHaveBeenCalled();
    expect(showCurrentSessionOverlay).not.toHaveBeenCalled();
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
      ["set_global_hotkey", { action: "live-timer", shortcut: null }],
      ["set_global_hotkey", { action: "pause-timer", shortcut: null }],
      ["set_global_hotkey", { action: "screenshot", shortcut: null }],
      ["set_global_hotkey", { action: "screenshot-viewer", shortcut: null }],
      ["set_global_hotkey", { action: "screenshot-markup", shortcut: null }],
      ["set_global_hotkey", { action: "quick-add", shortcut: null }],
      ["set_global_hotkey", { action: "counter-undo", shortcut: null }],
      ["set_global_hotkey", { action: "counter-box", shortcut: null }],
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

  // Keys nobody types may stand alone: Numpad, Pause, Scroll Lock, Print
  // Screen and the media keys.
  it("takes a key nobody types alone", () => {
    for (const code of [
      "Numpad1",
      "NumpadAdd",
      "Pause",
      "ScrollLock",
      "PrintScreen",
      "MediaPlayPause",
      "MediaStop",
      "MediaTrackNext",
      "MediaTrackPrevious",
      "AudioVolumeUp",
      "AudioVolumeDown",
      "AudioVolumeMute",
    ])
      expect(shortcutFromKey({ ...key, key: "", code }), code).toBe(code);
    expect(
      shortcutFromKey({ ...key, key: "", code: "Pause", altKey: true }),
    ).toBe("Alt+Pause");
  });

  it("keeps letters, numbers and the space bar for typing unless Ctrl, Alt or Win is held", () => {
    for (const [code, typed] of [
      ["KeyN", "n"],
      ["Digit1", "1"],
      ["Space", " "],
    ]) {
      expect(shortcutFromKey({ ...key, code, key: typed }), code).toBeNull();
      expect(
        shortcutFromKey({ ...key, code, key: typed, shiftKey: true }),
        code,
      ).toBeNull();
    }
    // Numpad Enter is Enter to Windows.
    expect(
      shortcutFromKey({ ...key, code: "NumpadEnter", key: "Enter" }),
    ).toBeNull();
  });

  it("takes + - , . with Ctrl, Alt or Win, on a German keyboard too", () => {
    // German layout: - sits where US has /, + where US has ]. Windows gives
    // them the same code as on a US keyboard.
    expect(
      shortcutFromKey({
        ...key,
        code: "Slash",
        key: "-",
        keyCode: 189,
        ctrlKey: true,
      }),
    ).toBe("Control+Minus");
    expect(
      shortcutFromKey({
        ...key,
        code: "BracketRight",
        key: "+",
        keyCode: 187,
        altKey: true,
      }),
    ).toBe("Alt+Equal");
    expect(
      shortcutFromKey({
        ...key,
        code: "Comma",
        key: ";",
        keyCode: 188,
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("Control+Shift+Comma");
    expect(
      shortcutFromKey({
        ...key,
        code: "Period",
        key: ".",
        keyCode: 190,
        metaKey: true,
      }),
    ).toBe("Super+Period");
    // US layout.
    expect(
      shortcutFromKey({
        ...key,
        code: "Minus",
        key: "-",
        keyCode: 189,
        ctrlKey: true,
      }),
    ).toBe("Control+Minus");
    // Alone they stay free for typing.
    expect(
      shortcutFromKey({ ...key, code: "Slash", key: "-", keyCode: 189 }),
    ).toBeNull();
  });

  it("leaves out keys whose Windows code changes with the layout, so ß never binds the - key", () => {
    // German ß sits where US has -, but Windows calls it VK_OEM_4, not VK_OEM_MINUS.
    expect(
      shortcutFromKey({
        ...key,
        code: "Minus",
        key: "ß",
        keyCode: 219,
        ctrlKey: true,
      }),
    ).toBeNull();
    expect(
      shortcutFromKey({
        ...key,
        code: "BracketLeft",
        key: "ü",
        keyCode: 186,
        ctrlKey: true,
      }),
    ).toBeNull();
    expect(
      shortcutFromKey({
        ...key,
        code: "IntlBackslash",
        key: "<",
        keyCode: 226,
        ctrlKey: true,
      }),
    ).toBeNull();
  });

  it("does not take Ctrl+Pause, which Windows turns into Break", () => {
    expect(
      shortcutFromKey({
        ...key,
        code: "Pause",
        key: "Cancel",
        keyCode: 3,
        ctrlKey: true,
      }),
    ).toBeNull();
  });

  it("names the new keys in the app's language", async () => {
    expect(formatHotkey("Control+Minus")).toBe("Ctrl+-");
    expect(formatHotkey("Alt+Equal")).toBe("Alt++");
    expect(formatHotkey("Control+Comma")).toBe("Ctrl+,");
    expect(formatHotkey("Control+Period")).toBe("Ctrl+.");
    expect(formatHotkey("ScrollLock")).toBe("Scroll Lock");
    expect(formatHotkey("PrintScreen")).toBe("Print Screen");
    expect(formatHotkey("MediaPlayPause")).toBe("Play/Pause");
    expect(formatHotkey("AudioVolumeUp")).toBe("Volume up");
    await i18next.changeLanguage("de");
    try {
      expect(formatHotkey("Pause")).toBe("Pause");
      expect(formatHotkey("ScrollLock")).toBe("Rollen");
      expect(formatHotkey("PrintScreen")).toBe("Druck");
      expect(formatHotkey("AudioVolumeUp")).toBe("Lauter");
    } finally {
      await i18next.changeLanguage("en");
    }
  });
});

// docs/mouse-hotkeys-plan.md, "Which buttons" and "How it fits the app".
describe("mouse buttons", () => {
  const press = (button: number, mods: Partial<MouseEvent> = {}) => ({
    button,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });

  it("takes the middle button, Mouse 4 and Mouse 5, alone or with Ctrl/Alt/Shift/Win", () => {
    expect(shortcutFromMouse(press(1), "windows")).toBe("MouseMiddle");
    expect(shortcutFromMouse(press(3), "windows")).toBe("Mouse4");
    expect(shortcutFromMouse(press(4), "windows")).toBe("Mouse5");
    expect(
      shortcutFromMouse(press(3, { ctrlKey: true, shiftKey: true }), "windows"),
    ).toBe("Control+Shift+Mouse4");
    expect(
      shortcutFromMouse(press(4, { altKey: true, metaKey: true }), "windows"),
    ).toBe("Alt+Super+Mouse5");
  });

  it("never takes left or right, which shoot and aim", () => {
    expect(shortcutFromMouse(press(0), "windows")).toBeNull();
    expect(shortcutFromMouse(press(2, { ctrlKey: true }), "windows")).toBeNull();
  });

  it("takes no mouse button on macOS", () => {
    expect(shortcutFromMouse(press(3), "macos")).toBeNull();
  });

  it("names mouse buttons in the app's language", async () => {
    expect(formatHotkey("Mouse4")).toBe("Mouse 4");
    expect(formatHotkey("Control+MouseMiddle")).toBe("Ctrl+Middle mouse button");
    await i18next.changeLanguage("de");
    try {
      expect(formatHotkey("Mouse5")).toBe("Maus 5");
      expect(formatHotkey("Shift+MouseMiddle")).toBe(
        "Umschalt+Mittlere Maustaste",
      );
    } finally {
      await i18next.changeLanguage("en");
    }
  });

  it("tells Rust which processes are running games, only when that changes", async () => {
    const sent = () =>
      invokeMock.mock.calls.filter(
        ([command]) => command === "set_mouse_hotkey_games",
      );
    setMouseHotkeyGames([42, 7]);
    setMouseHotkeyGames([7, 42]);
    await flush();
    expect(sent()).toEqual([["set_mouse_hotkey_games", { pids: [7, 42] }]]);
    setMouseHotkeyGames([]);
    await flush();
    expect(sent()).toEqual([
      ["set_mouse_hotkey_games", { pids: [7, 42] }],
      ["set_mouse_hotkey_games", { pids: [] }],
    ]);
  });
});
