import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pickedCover } from "./pickedCovers";
import { currentPlatform } from "./platform";
import { useAppStore } from "./store";
import { formatDuration } from "./ui/components";
import { appLocale, getT } from "./i18n";

const t = getT("overlays");

export const QUICK_NOTE_SAVE_EVENT = "playcounter:quick-note-save";

/** What the note window gets. It has no i18n of its own: its texts come
 *  along, keyed by their English. */
export type QuickNotePayload = {
  sessionId: number;
  gameName: string;
  coverUrl: string | null;
  note: string;
  /** Running sessions count up from here. */
  startedAt: string | null;
  /** Finished sessions show their length instead. */
  duration: string | null;
  labels: Record<string, string>;
  monitor?: string | null;
  locale?: string | null;
  theme: "dark" | "light";
  accentColor: string | null;
  reducedMotion: boolean;
};

export type QuickNoteLabel =
  | "Session note"
  | "Playing now"
  | "Session saved"
  | "What happened? Where did you stop?"
  | "Enter saves · Shift+Enter starts a new line · Esc cancels"
  | "Save"
  | "Cancel";

function quickNoteLabels(): Record<QuickNoteLabel, string> {
  return {
    "Session note": t("Session note"),
    "Playing now": t("Playing now"),
    "Session saved": t("Session saved"),
    "What happened? Where did you stop?": t(
      "What happened? Where did you stop?",
    ),
    "Enter saves · Shift+Enter starts a new line · Esc cancels": t(
      "Enter saves · Shift+Enter starts a new line · Esc cancels",
    ),
    Save: t("Save"),
    Cancel: t("Cancel"),
  };
}

/** Opens the note box over the game for one session, running or finished. */
export function openQuickNote(sessionId: number) {
  if (currentPlatform() === "macos") return;
  const state = useAppStore.getState();
  const active = state.activeSessions.find((s) => s.id === sessionId);
  const session =
    active ?? state.recentSessions.find((s) => s.id === sessionId);
  if (!session) return;
  const media = (
    globalThis as typeof globalThis & {
      matchMedia?: (query: string) => { matches: boolean };
    }
  ).matchMedia;
  const payload: QuickNotePayload = {
    sessionId,
    gameName: session.gameName ?? session.exeName.replace(/\.exe$/i, ""),
    coverUrl: pickedCover(state, session) ?? session.coverUrl ?? null,
    note: session.note ?? "",
    startedAt: active ? active.startedAt : null,
    duration: active
      ? null
      : formatDuration(
          "durationSeconds" in session ? (session.durationSeconds ?? 0) : 0,
        ),
    labels: quickNoteLabels(),
    monitor: state.settings.overlayMonitor ?? "primary",
    locale: appLocale(),
    theme: state.settings.theme,
    accentColor: state.settings.accentColor,
    reducedMotion:
      typeof media === "function" &&
      media("(prefers-reduced-motion: reduce)").matches,
  };
  void invoke("quick_note_open", { payload }).catch((error) =>
    console.error("quick note failed to open", error),
  );
}

/** The quick note hotkey: the game started last. False when nothing runs. */
export function openQuickNoteForCurrentSession() {
  const session = useAppStore
    .getState()
    .activeSessions.filter((s) => !s.recoveredFromCheckpoint)
    .reduce<{ id: number; startedAt: string } | undefined>(
      (latest, s) => (!latest || s.startedAt > latest.startedAt ? s : latest),
      undefined,
    );
  if (session) openQuickNote(session.id);
  return session !== undefined;
}

let lifecycle: { disposed: boolean; unlisten?: UnlistenFn } | null = null;

/** Saves what the note window sends back. */
export function initializeQuickNotes() {
  if (lifecycle) return;
  const state: { disposed: boolean; unlisten?: UnlistenFn } = {
    disposed: false,
  };
  lifecycle = state;
  void listen<{ sessionId: number; note: string }>(
    QUICK_NOTE_SAVE_EVENT,
    ({ payload }) => {
      if (state.disposed) return;
      useAppStore.getState().setSessionNote(payload.sessionId, payload.note);
    },
  )
    .then((unlisten) => {
      if (state.disposed) unlisten();
      else state.unlisten = unlisten;
    })
    .catch((error) => console.error("quick note listener failed", error));
}

export function disposeQuickNotes() {
  if (!lifecycle) return;
  lifecycle.disposed = true;
  lifecycle.unlisten?.();
  lifecycle = null;
}
