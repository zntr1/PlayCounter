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
  previewDesktopOverlay,
  showCurrentSessionOverlay,
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
    activeSessions: [],
    settings: {
      ...state.settings,
      desktopOverlaysEnabled: false,
      overlayDiscoveries: false,
      overlayFirstDetections: true,
      overlayMonitor: "primary",
    },
  }));
});

afterEach(() => {
  disposeDesktopOverlays();
  vi.useRealTimers();
});

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function showCalls() {
  return invokeMock.mock.calls.filter(
    ([command]) => command === "notification_overlay_show",
  );
}

describe("desktop overlay bridge", () => {
  it("shows current elapsed time on request with automatic popups disabled", async () => {
    vi.setSystemTime(90_000);
    useAppStore.setState({
      activeSessions: [
        {
          id: 1,
          gameId: 1,
          gameName: "Playing",
          exeName: "game.exe",
          coverUrl: "cover.jpg",
          startedAt: new Date(0).toISOString(),
          checkpointedAt: new Date(60_000).toISOString(),
        },
      ],
    });
    initializeDesktopOverlays();
    showCurrentSessionOverlay();
    await flush();
    expect(showCalls()[0]?.[1]).toMatchObject({
      payload: {
        kind: "current-session",
        title: "Playing",
        kicker: "CURRENT SESSION",
        metric: "1m",
        monitor: "primary",
        coverUrl: "cover.jpg",
      },
    });
    expect(useAppStore.getState().activeSessions).toHaveLength(1);
  });

  it("cycles active games, skips unconfirmed recovery, and handles no active session", async () => {
    const session = {
      id: 1,
      gameId: 1,
      gameName: "One",
      exeName: "game.exe",
      coverUrl: "",
      startedAt: new Date(0).toISOString(),
      checkpointedAt: new Date(0).toISOString(),
    };
    useAppStore.setState({
      activeSessions: [
        session,
        { ...session, id: 2, gameName: "Two" },
        {
          ...session,
          id: 3,
          gameName: "Unconfirmed",
          recoveredFromCheckpoint: true,
        },
      ],
    });
    initializeDesktopOverlays();
    showCurrentSessionOverlay();
    showCurrentSessionOverlay();
    showCurrentSessionOverlay();
    useAppStore.setState({ activeSessions: [] });
    showCurrentSessionOverlay();
    await flush();
    expect(
      showCalls().map(
        ([, args]) => (args as { payload: { title: string } }).payload.title,
      ),
    ).toEqual(["One", "Two", "One", "No game active"]);
  });

  it("shows requested time immediately and resumes queued notifications afterward", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    emitOverlayEvent({
      type: "session-started",
      gameName: "Visible",
      firstAutoDetection: true,
    });
    emitOverlayEvent({
      type: "session-started",
      gameName: "Queued",
      firstAutoDetection: true,
    });
    await flush();
    showCurrentSessionOverlay();
    await flush();
    const finished = listenMock.mock.calls.find(
      ([event]) => event === "playcounter:overlay-finished",
    )?.[1];
    const { payload } = showCalls()[1][1] as { payload: { id: string } };
    finished?.({ payload: payload.id } as never);
    await flush();
    expect(
      showCalls().map(
        ([, args]) => (args as { payload: { title: string } }).payload.title,
      ),
    ).toEqual(["Visible", "No game active", "Queued"]);
  });

  it.each([true, false])(
    "shows real popups with foreground focus=%s",
    async (hasFocus) => {
      visible = true;
      focused = hasFocus;
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
      await flush();
      expect(showCalls()).toHaveLength(1);
      expect(showCalls()[0]?.[1]).toMatchObject({
        payload: { monitor: "primary" },
      });
      for (const [handler] of onFocusChanged.mock.calls)
        handler({ payload: true });
      expect(
        invokeMock.mock.calls.some(
          ([command]) => command === "notification_overlay_close",
        ),
      ).toBe(false);
    },
  );

  it("uses the current monitor for previews and queued notifications", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    emitOverlayEvent({
      type: "session-started",
      gameName: "One",
      firstAutoDetection: true,
    });
    emitOverlayEvent({
      type: "session-started",
      gameName: "Two",
      firstAutoDetection: true,
    });
    await flush();
    expect(showCalls()).toHaveLength(1);
    useAppStore.getState().setOverlayMonitor("display-two");
    const finished = listenMock.mock.calls.find(
      ([event]) => event === "playcounter:overlay-finished",
    )?.[1];
    const { payload: firstPayload } = showCalls()[0]?.[1] as {
      payload: { id: string };
    };
    finished?.({ payload: firstPayload.id } as never);
    await flush();
    expect(showCalls()).toHaveLength(2);
    expect(showCalls()[1]?.[1]).toMatchObject({
      payload: { monitor: "display-two" },
    });
    previewDesktopOverlay();
    expect(showCalls()[2]?.[1]).toMatchObject({
      payload: { monitor: "display-two" },
    });
  });

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
    listenMock.mockResolvedValue(eventUnlisten);

    initializeDesktopOverlays();
    initializeDesktopOverlays();
    await flush();
    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(onFocusChanged).not.toHaveBeenCalled();

    disposeDesktopOverlays();
    expect(eventUnlisten).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["open-now-playing", "now"],
    ["open-discovered", "discovered"],
  ] as const)("routes %s popup actions to %s", async (action, view) => {
    useAppStore.setState((state) => ({
      activeView: "settings",
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    await flush();
    const registration = listenMock.mock.calls.find(
      ([event]) => event === "playcounter:overlay-action",
    );
    const handler = registration?.[1] as
      | ((event: { payload: string }) => void)
      | undefined;

    handler?.({ payload: action });

    expect(useAppStore.getState().activeView).toBe(view);
  });

  it("shows an actionable ambiguity card while the app is in the tray", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        desktopOverlaysEnabled: true,
        overlayActionRequired: true,
      },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();

    emitOverlayEvent({
      type: "choice-required",
      exeName: "Mixtape.exe",
      candidateCount: 3,
      targetPids: [4242],
    });
    await flush();

    expect(showCalls()).toHaveLength(1);
    expect(showCalls()[0]?.[1]).toMatchObject({
      payload: {
        kind: "action-required",
        action: "open-now-playing",
        targetPids: [4242],
      },
    });
  });

  it("shows every preview immediately instead of queueing them", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    await flush();

    previewDesktopOverlay("first-detection");
    previewDesktopOverlay("session-start");
    previewDesktopOverlay("milestone");
    await flush();

    // A queued preview would sit behind the ten second hold of the one before
    // it, and the lowest priority kind would be dropped by the pending cap.
    expect(
      showCalls().map(
        ([, args]) =>
          (
            args as never as {
              payload: { kind: string };
            }
          ).payload.kind,
      ),
    ).toEqual(["first-detection", "session-start", "milestone"]);
  });

  it("repeats a passive preview without waiting out the throttle", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    await flush();

    previewDesktopOverlay("session-start");
    await vi.advanceTimersByTimeAsync(200);
    previewDesktopOverlay("session-start");
    await flush();

    expect(showCalls()).toHaveLength(2);
  });

  it("keeps a preview on screen when the main window regains focus", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    await flush();

    previewDesktopOverlay("first-detection");
    await flush();
    for (const [handler] of onFocusChanged.mock.calls) {
      handler({ payload: true });
    }
    await flush();

    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "notification_overlay_close",
      ),
    ).toHaveLength(0);
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

  it("shows discoveries while focused and preserves their cooldown", async () => {
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
    expect(showCalls()).toHaveLength(1);

    visible = false;
    focused = false;
    noteDiscoveredExecutable("two.exe");
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(showCalls()).toHaveLength(1);
  });

  it("invalidates a session event whose game window check was in flight", async () => {
    let markWindowReady!: (ready: boolean) => void;
    invokeMock.mockImplementation((command) =>
      command === "notification_overlay_wait_for_game_window"
        ? new Promise<boolean>((resolve) => (markWindowReady = resolve))
        : Promise.resolve(undefined),
    );
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: true },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    emitOverlayEvent({
      type: "session-started",
      gameName: "Game",
      firstAutoDetection: true,
      targetPids: [4242],
    });
    clearDesktopOverlays();
    markWindowReady(true);
    await flush();
    expect(showCalls()).toHaveLength(0);
  });

  it("waits for the launched game window before announcing the session", async () => {
    let markWindowReady!: (ready: boolean) => void;
    invokeMock.mockImplementation((command) =>
      command === "notification_overlay_wait_for_game_window"
        ? new Promise<boolean>((resolve) => (markWindowReady = resolve))
        : Promise.resolve(undefined),
    );
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        desktopOverlaysEnabled: true,
        overlaySessionStarts: true,
      },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    emitOverlayEvent({
      type: "session-started",
      gameName: "Game",
      firstAutoDetection: false,
      targetPids: [4242, 4343],
    });
    await flush();

    expect(invokeMock).toHaveBeenCalledWith(
      "notification_overlay_wait_for_game_window",
      { targetPids: [4242, 4343] },
    );
    expect(showCalls()).toHaveLength(0);

    markWindowReady(true);
    await flush();
    expect(showCalls()).toHaveLength(1);
    expect(showCalls()[0]?.[1]).toMatchObject({
      payload: { targetPids: [4242, 4343] },
    });
  });

  it("does not show a launch card when no game window becomes ready", async () => {
    invokeMock.mockImplementation((command) =>
      Promise.resolve(
        command === "notification_overlay_wait_for_game_window"
          ? false
          : undefined,
      ),
    );
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        desktopOverlaysEnabled: true,
        overlaySessionStarts: true,
      },
    }));
    initializeDesktopOverlays();
    armDesktopOverlays();
    emitOverlayEvent({
      type: "session-started",
      gameName: "Game",
      firstAutoDetection: false,
      targetPids: [4242],
    });
    await flush();

    expect(showCalls()).toHaveLength(0);
  });
});
