import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { showCurrentSessionOverlay } from "./desktopOverlayBridge";
import { useAppStore } from "./store";

export type HotkeySetting = "showWindowHotkey" | "currentSessionHotkey";
const actions: Record<HotkeySetting, string> = {
  showWindowHotkey: "show-window",
  currentSessionHotkey: "current-session",
};
export const useHotkeyStatus = create<{
  errors: Partial<Record<HotkeySetting, string>>;
}>(() => ({ errors: {} }));

let lifecycle: { disposed: boolean; unlisten?: UnlistenFn } | null = null;
let pending: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation);
  pending = next.catch(() => undefined);
  return next;
}

function setError(key: HotkeySetting, error?: unknown) {
  useHotkeyStatus.setState((state) => ({
    errors: {
      ...state.errors,
      [key]: error === undefined ? undefined : String(error),
    },
  }));
}

function register(key: HotkeySetting, shortcut: string | null) {
  return invoke("set_global_hotkey", { action: actions[key], shortcut });
}

export function initializeHotkeys() {
  if (lifecycle) return;
  const state = {
    disposed: false,
    unlisten: undefined as UnlistenFn | undefined,
  };
  lifecycle = state;
  void enqueue(async () => {
    if (state.disposed) return;
    let listenerError: unknown;
    try {
      const unlisten = await listen(
        "playcounter:current-session-hotkey",
        () => {
          if (!state.disposed) showCurrentSessionOverlay();
        },
      );
      if (state.disposed) unlisten();
      else state.unlisten = unlisten;
    } catch (error) {
      listenerError = error;
    }
    for (const key of Object.keys(actions) as HotkeySetting[]) {
      if (state.disposed) return;
      const saved = useAppStore.getState().settings[key];
      try {
        if (key === "currentSessionHotkey" && listenerError)
          throw listenerError;
        await register(key, typeof saved === "string" && saved ? saved : null);
        setError(key);
      } catch (error) {
        setError(key, error);
        if (saved)
          useAppStore.getState().addToast({
            tone: "error",
            title: "Hotkey could not be enabled",
            detail: `${saved}: ${String(error)}. Check Keyboard shortcuts in Settings.`,
          });
      }
    }
  });
}

export function saveHotkey(key: HotkeySetting, shortcut: string | null) {
  initializeHotkeys();
  return enqueue(async () => {
    try {
      if (shortcut && key === "currentSessionHotkey" && !lifecycle?.unlisten) {
        throw new Error(
          "The session hotkey listener is unavailable. Restart PlayCounter and try again.",
        );
      }
      await register(key, shortcut);
      useAppStore.getState().setHotkey(key, shortcut);
      setError(key);
    } catch (error) {
      setError(key, error);
      throw error;
    }
  });
}

export function disposeHotkeys() {
  if (!lifecycle) return;
  lifecycle.disposed = true;
  lifecycle.unlisten?.();
  lifecycle = null;
  void enqueue(async () => {
    for (const key of Object.keys(actions) as HotkeySetting[]) {
      try {
        await register(key, null);
      } catch (error) {
        console.warn("Hotkey cleanup failed", error);
      }
    }
  });
}

/** Native Windows hotkeys use virtual letter keys, so honor the active keyboard layout. */
export function shortcutFromKey(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat"
  >,
): string | null {
  if (event.repeat) return null;
  const code = /^Key[A-Z]$/.test(event.code)
    ? /^[a-z]$/i.test(event.key)
      ? `Key${event.key.toUpperCase()}`
      : ""
    : event.code;
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(code);
  const supported =
    /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Tab)$/.test(
      code,
    );
  if (
    !functionKey &&
    (!supported || !(event.ctrlKey || event.altKey || event.metaKey))
  )
    return null;
  return [
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
    code,
  ]
    .filter(Boolean)
    .join("+");
}

export function formatHotkey(shortcut: string | null | undefined) {
  return (
    shortcut
      ?.replace(/Control/g, "Ctrl")
      .replace(/Key([A-Z])/g, "$1")
      .replace(/Digit([0-9])/g, "$1")
      .replace(/Super/g, "Win / Cmd") ?? "Not set"
  );
}
