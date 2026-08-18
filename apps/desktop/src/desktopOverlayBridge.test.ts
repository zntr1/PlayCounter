import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  armDesktopOverlays,
  clearDesktopOverlays,
  disposeDesktopOverlays,
  emitOverlayEvent,
  initializeDesktopOverlays,
  noteDiscoveredExecutable,
} from "./desktopOverlayBridge";
import { useAppStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const windowMock = vi.mocked(getCurrentWindow);

let visible = false;
let focused = false;
let onFocusChanged = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Windows", platform: "Win32" },
  });
  invokeMock.mockReset().mockResolvedValue(undefined);
  listenMock.mockReset().mockResolvedValue(vi.fn());
  onFocusChanged = vi.fn().mockResolvedValue(vi.fn());
  visible = false;
  focused = false;
  windowMock.mockReset().mockReturnValue({
    isVisible: vi.fn(async () => visible),
    isFocused: vi.fn(async () => focused),
    onFocusChanged,
  } as never);
  useAppStore.setState((state) => ({
    settings: {
      ...state.settings,
      desktopOverlaysEnabled: false,
      overlayDiscoveries: false,
      overlayFirstDetections: true,
    },
  }));
});

afterEach(() => {
  disposeDesktopOverlays();
  vi.useRealTimers();
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function showCalls() {
  return invokeMock.mock.calls.filter(
    ([command]) => command === "notification_overlay_show",
  );
}

describe("desktop overlay bridge", () => {
  it("is inert on macOS even when imported settings enable overlays", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Macintosh", platform: "MacIntel" },
    });
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        desktopOverlaysEnabled: true,
        overlayDiscoveries: true,
      },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    noteDiscoveredExecutable("game.exe");
    expect(listenMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("initializes idempotently and tears down listeners", async () => {
    const eventUnlisten = vi.fn();
    const focusUnlisten = vi.fn();
    listenMock.mockResolvedValue(eventUnlisten);
    onFocusChanged.mockResolvedValue(focusUnlisten);

    initializeDesktopOverlays();
    initializeDesktopOverlays();
    await flush();
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(onFocusChanged).toHaveBeenCalledTimes(1);

    disposeDesktopOverlays();
    expect(eventUnlisten).toHaveBeenCalledTimes(1);
    expect(focusUnlisten).toHaveBeenCalledTimes(1);
  });

  it("does not replay discoveries captured while opted out", async () => {
    initializeDesktopOverlays();
    armDesktopOverlays();
    noteDiscoveredExecutable("ignored.exe");
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        desktopOverlaysEnabled: true,
        overlayDiscoveries: true,
      },
    }));
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(showCalls()).toHaveLength(0);
  });

  it("drops an open discovery burst when the child toggle is disabled", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        desktopOverlaysEnabled: true,
        overlayDiscoveries: true,
      },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    noteDiscoveredExecutable("one.exe");
    useAppStore.setState((state) => ({
      settings: { ...state.settings, overlayDiscoveries: false },
    }));
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(showCalls()).toHaveLength(0);
  });

  it("does not arm discovery cooldown when focus suppresses the push", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        desktopOverlaysEnabled: true,
        overlayDiscoveries: true,
      },
    }));
    visible = true;
    focused = true;
    initializeDesktopOverlays();
    armDesktopOverlays();
    noteDiscoveredExecutable("one.exe");
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(showCalls()).toHaveLength(0);

    visible = false;
    focused = false;
    noteDiscoveredExecutable("two.exe");
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(showCalls()).toHaveLength(1);
  });

  it("invalidates a session event whose focus check was in flight", async () => {
    let resolveVisible!: (value: boolean) => void;
    windowMock.mockReturnValue({
      isVisible: vi.fn(
        () => new Promise<boolean>((resolve) => (resolveVisible = resolve)),
      ),
      isFocused: vi.fn(async () => false),
      onFocusChanged,
    } as never);
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    emitOverlayEvent({
      type: "session-started",
      gameName: "Game",
      firstAutoDetection: true,
    });
    clearDesktopOverlays();
    resolveVisible(false);
    await flush();
    expect(showCalls()).toHaveLength(0);
  });
});
