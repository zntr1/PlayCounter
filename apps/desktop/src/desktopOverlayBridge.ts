import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  buildOverlayMessage,
  DesktopOverlayQueue,
  DiscoveryAggregator,
  overlayGate,
  OVERLAY_ACTION_EVENT,
  OVERLAY_FINISHED_EVENT,
  SAFETY_MARGIN_MS,
  type DesktopOverlayKind,
  type DesktopOverlayMessage,
  type OverlayEvent,
  type TrackerOverlayEvent,
} from "./desktopOverlays";
import { currentPlatform } from "./platform";
import { useAppStore } from "./store";

type BridgeState = {
  generation: number;
  armed: boolean;
  disposed: boolean;
  queue: DesktopOverlayQueue;
  discovery: DiscoveryAggregator;
  teardown: Array<() => void>;
};

let bridge: BridgeState | null = null;
/** While a preview is on screen, focus changes must not clear it. */
let previewUntilMs = 0;

function overlaysSupported() {
  try {
    return currentPlatform() !== "macos";
  } catch {
    return false;
  }
}

async function safeInvoke<T>(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.warn(`desktop overlay command ${command} failed`, error);
    return undefined;
  }
}

function track(state: BridgeState, registration: Promise<UnlistenFn>) {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  void registration.then(
    (handler) => {
      if (cancelled) handler();
      else unlisten = handler;
    },
    (error) => console.warn("desktop overlay listener failed", error),
  );
  state.teardown.push(() => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  });
}

function renderContext() {
  const settings = useAppStore.getState().settings;
  const media = (
    globalThis as typeof globalThis & {
      matchMedia?: (query: string) => { matches: boolean };
    }
  ).matchMedia;
  return {
    nowMs: Date.now(),
    theme: settings.theme,
    accentColor: settings.accentColor,
    reducedMotion:
      typeof media === "function" &&
      media("(prefers-reduced-motion: reduce)").matches,
  } as const;
}

async function mainWindowIsActive() {
  try {
    const window = getCurrentWindow();
    return (await window.isVisible()) && (await window.isFocused());
  } catch {
    return false;
  }
}

function currentBridge(expected: BridgeState, generation: number) {
  return (
    bridge === expected &&
    !expected.disposed &&
    expected.armed &&
    expected.generation === generation
  );
}

export function initializeDesktopOverlays() {
  if (bridge || !overlaysSupported()) return;

  const queue = new DesktopOverlayQueue({
    now: () => Date.now(),
    setTimer: (delay, callback) =>
      globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimer: (handle) => globalThis.clearTimeout(handle),
    show: (message) => {
      void safeInvoke("notification_overlay_show", { payload: message });
    },
    hide: (id) => {
      void safeInvoke("notification_overlay_hide", { id });
    },
  });
  let state!: BridgeState;
  const discovery = new DiscoveryAggregator({
    now: () => Date.now(),
    setTimer: (delay, callback) =>
      globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimer: (handle) => globalThis.clearTimeout(handle),
    onBurst: async (exeCount) => {
      if (!state || state.disposed || !state.armed || bridge !== state) {
        return false;
      }
      const generation = state.generation;
      const store = useAppStore.getState();
      const event = { type: "discovery-burst", exeCount } as const;
      const kind = overlayGate(event, store.settings);
      if (!kind) return false;
      const message = buildOverlayMessage(kind, event, renderContext());
      if (await mainWindowIsActive()) return false;
      if (!currentBridge(state, generation)) return false;
      const settings = useAppStore.getState().settings;
      if (
        settings.desktopOverlaysEnabled !== true ||
        settings.overlayDiscoveries !== true
      ) {
        return false;
      }
      return state.queue.push(message);
    },
  });
  state = {
    generation: 0,
    armed: false,
    disposed: false,
    queue,
    discovery,
    teardown: [],
  };
  bridge = state;

  const unsubscribe = useAppStore.subscribe((store, previous) => {
    if (bridge !== state || state.disposed) return;
    const masterNow = store.settings.desktopOverlaysEnabled === true;
    const masterBefore = previous.settings.desktopOverlaysEnabled === true;
    if (masterNow !== masterBefore) {
      if (masterNow) void safeInvoke("notification_overlay_prepare");
      else clearDesktopOverlays();
      return;
    }
    const discoveryNow =
      masterNow && store.settings.overlayDiscoveries === true;
    const discoveryBefore =
      masterBefore && previous.settings.overlayDiscoveries === true;
    if (discoveryBefore && !discoveryNow) {
      state.discovery.cancelOpenBurst();
    }
  });
  state.teardown.push(unsubscribe);

  track(
    state,
    listen<string>(OVERLAY_FINISHED_EVENT, ({ payload }) => {
      if (bridge === state && !state.disposed) {
        state.queue.handleFinished(String(payload));
      }
    }),
  );
  track(
    state,
    listen<string>(OVERLAY_ACTION_EVENT, ({ payload }) => {
      if (bridge !== state || state.disposed) return;
      if (payload === "open-now-playing") {
        useAppStore.getState().setActiveView("now");
      } else if (payload === "open-discovered") {
        useAppStore.getState().setActiveView("discovered");
      }
    }),
  );
  try {
    track(
      state,
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        // A preview was asked for from this window, so refocusing it must not
        // immediately dismiss the card the user just clicked for.
        if (focused && Date.now() >= previewUntilMs) clearDesktopOverlays();
      }),
    );
  } catch (error) {
    console.warn("desktop overlay focus listener failed", error);
  }

  if (useAppStore.getState().settings.desktopOverlaysEnabled === true) {
    void safeInvoke("notification_overlay_prepare");
  }

  // Devtools escape hatch for checking popup layouts without playing a game:
  // __playcounterOverlayPreview("session-summary")
  previewHost().__playcounterOverlayPreview = previewDesktopOverlay;
  state.teardown.push(() => {
    delete previewHost().__playcounterOverlayPreview;
  });
}

function previewHost() {
  return globalThis as typeof globalThis & {
    __playcounterOverlayPreview?: (kind?: DesktopOverlayKind) => void;
  };
}

export function armDesktopOverlays() {
  if (bridge && !bridge.disposed) bridge.armed = true;
}

export function emitOverlayEvent(event: TrackerOverlayEvent) {
  const state = bridge;
  if (!state || state.disposed || !state.armed) return;
  const store = useAppStore.getState();
  if (store.settings.desktopOverlaysEnabled !== true) return;
  if (!overlayGate(event, store.settings)) return;
  const generation = state.generation;

  void (async () => {
    if (
      event.type === "session-started" &&
      event.targetPids &&
      event.targetPids.length > 0
    ) {
      const ready = await safeInvoke<boolean>(
        "notification_overlay_wait_for_game_window",
        { targetPids: event.targetPids },
      );
      if (ready !== true) return;
    }
    if (await mainWindowIsActive()) return;
    if (!currentBridge(state, generation)) return;
    const settings = useAppStore.getState().settings;
    const kind = overlayGate(event, settings);
    if (!kind) return;
    const message = buildOverlayMessage(kind, event, renderContext());
    state.queue.push(message);
  })().catch((error) => console.warn("desktop overlay routing failed", error));
}

export function noteDiscoveredExecutable(exeName: string) {
  const state = bridge;
  if (!state || state.disposed || !state.armed) return;
  const settings = useAppStore.getState().settings;
  if (
    settings.desktopOverlaysEnabled !== true ||
    settings.overlayDiscoveries !== true
  ) {
    return;
  }
  state.discovery.note(exeName);
}

export function clearDesktopOverlays() {
  const state = bridge;
  if (!state || state.disposed) return;
  state.generation += 1;
  state.queue.clear();
  state.discovery.cancelOpenBurst();
  void safeInvoke("notification_overlay_close");
}

function previewEvent(
  kind: DesktopOverlayKind,
  gameName: string,
  coverUrl: string | undefined,
): OverlayEvent {
  if (kind === "discovery") {
    return { type: "discovery-burst", exeCount: 3 };
  }
  if (kind === "action-required") {
    return {
      type: "choice-required",
      exeName: "game.exe",
      candidateCount: 3,
    };
  }
  if (kind === "first-detection" || kind === "session-start") {
    return {
      type: "session-started",
      gameName,
      coverUrl,
      firstAutoDetection: kind === "first-detection",
    };
  }
  return {
    type: "session-ended",
    gameName,
    coverUrl,
    durationSeconds: 13_320,
    totalSeconds: 180_000,
    ...(kind === "milestone"
      ? {
          milestoneTitle: "50 hours played",
          milestoneMetric: "50 HRS",
          milestoneGameScoped: false,
        }
      : {}),
  };
}

/**
 * Fires a sample popup so the layout can be checked without playing a game.
 * Only the master toggle is honored; the per-kind toggles are bypassed so any
 * kind can be inspected on demand.
 */
export function previewDesktopOverlay(
  kind: DesktopOverlayKind = "first-detection",
) {
  const state = bridge;
  if (!state || state.disposed || !state.armed) return;
  const store = useAppStore.getState();
  if (store.settings.desktopOverlaysEnabled !== true) return;
  const sample = store.recentSessions[0];
  const event = previewEvent(
    kind,
    sample?.gameName ?? "Sample Game",
    sample?.coverUrl,
  );
  const message = buildOverlayMessage(kind, event, renderContext());
  // Previews deliberately skip the queue. Its gating exists to protect real
  // popups -- one at a time, priority order, a pending cap, and an eight second
  // throttle on passive kinds -- and every one of those can drop or postpone
  // the card the button was just clicked for.
  state.queue.clear();
  previewUntilMs = Date.now() + message.durationMs + SAFETY_MARGIN_MS;
  void safeInvoke("notification_overlay_show", { payload: message });
}

export function disposeDesktopOverlays() {
  const state = bridge;
  if (!state || state.disposed) return;
  state.disposed = true;
  state.generation += 1;
  state.armed = false;
  state.queue.dispose();
  state.discovery.dispose();
  void safeInvoke("notification_overlay_close");
  for (const stop of state.teardown.splice(0)) {
    try {
      stop();
    } catch {
      // Teardown is best effort during application shutdown.
    }
  }
  bridge = null;
}

export function desktopOverlayBridgeStateForTests(): {
  armed: boolean;
  generation: number;
} | null {
  return bridge ? { armed: bridge.armed, generation: bridge.generation } : null;
}
