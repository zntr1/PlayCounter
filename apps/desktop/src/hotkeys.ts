import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { showCurrentSessionOverlay } from "./desktopOverlayBridge";
import { openQuickNoteForCurrentSession } from "./quickNote";
import { useAppStore } from "./store";
import { getT } from "./i18n";
import { nativeText } from "./nativeText";

const t = getT("settings");

export type HotkeySetting =
  | "showWindowHotkey"
  | "currentSessionHotkey"
  | "quickNoteHotkey";
const actions: Record<HotkeySetting, string> = {
  showWindowHotkey: "show-window",
  currentSessionHotkey: "current-session",
  quickNoteHotkey: "quick-note",
};
/** Hotkeys the main window handles itself; they need its event listeners. */
const listened: Partial<Record<HotkeySetting, () => void>> = {
  currentSessionHotkey: () => showCurrentSessionOverlay(),
  // With nothing running, the session popup says so.
  quickNoteHotkey: () => {
    if (!openQuickNoteForCurrentSession()) showCurrentSessionOverlay();
  },
};
const hotkeyEvents: Partial<Record<HotkeySetting, string>> = {
  currentSessionHotkey: "playcounter:current-session-hotkey",
  quickNoteHotkey: "playcounter:quick-note-hotkey",
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
      [key]: error === undefined ? undefined : errorText(error),
    },
  }));
}

function errorText(error: unknown) {
  return nativeText(error instanceof Error ? error.message : String(error));
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
      const handlers = await Promise.all(
        (Object.keys(hotkeyEvents) as HotkeySetting[]).map((key) =>
          listen(hotkeyEvents[key]!, () => {
            if (!state.disposed) listened[key]?.();
          }),
        ),
      );
      const unlisten = () => handlers.forEach((handler) => handler());
      if (state.disposed) unlisten();
      else state.unlisten = unlisten;
    } catch (error) {
      listenerError = error;
    }
    for (const key of Object.keys(actions) as HotkeySetting[]) {
      if (state.disposed) return;
      const saved = useAppStore.getState().settings[key];
      try {
        if (listened[key] && listenerError) throw listenerError;
        await register(key, typeof saved === "string" && saved ? saved : null);
        setError(key);
      } catch (error) {
        setError(key, error);
        if (saved)
          useAppStore.getState().addToast({
            tone: "error",
            title: t("Hotkey could not be enabled"),
            detail: t(
              "{{saved}}: {{error}}. Check Keyboard shortcuts in Settings.",
              { saved, error: errorText(error) },
            ),
          });
      }
    }
  });
}

export function saveHotkey(key: HotkeySetting, shortcut: string | null) {
  initializeHotkeys();
  return enqueue(async () => {
    try {
      if (shortcut && listened[key] && !lifecycle?.unlisten) {
        throw new Error(
          t(
            "The session hotkey listener is unavailable. Restart PlayCounter and try again.",
          ),
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

/**
 * Native Windows hotkeys use virtual letter keys, so honor the active keyboard layout.
 * The result is the format Rust parses, so it stays English in every language.
 */
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
    event.ctrlKey && "Control", // i18n-exempt: shortcut format, translated in formatHotkey
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
    code,
  ]
    .filter(Boolean)
    .join("+");
}

export function formatHotkey(shortcut: string | null | undefined) {
  if (!shortcut) return t("Not set");
  const modifiers: Record<string, string> = {
    Control: t("Ctrl"),
    Alt: t("Alt"),
    Shift: t("Shift"),
    Super: t("Win / Cmd"),
  };
  return shortcut
    .split("+")
    .map(
      (part) =>
        modifiers[part] ??
        part.replace(/^Key([A-Z])$/, "$1").replace(/^Digit([0-9])$/, "$1"),
    )
    .join("+");
}
