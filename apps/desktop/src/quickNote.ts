import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pickedCover } from "./pickedCovers";
import { countFromMs } from "./sessionTime";
import { currentPlatform } from "./platform";
import type { Screenshot } from "./screenshots";
import { useAppStore } from "./store";
import { formatDuration } from "./ui/components";
import { appLocale, getT } from "./i18n";

const t = getT("overlays");

export const QUICK_NOTE_SAVE_EVENT = "playcounter:quick-note-save";

/** The screenshot the box writes a caption for, instead of a session note. */
export type CaptionTarget = {
  path: string;
  /** The picture as the box can load it. */
  pictureUrl: string;
  /** When it was taken, ready to show. */
  takenAt: string;
};

/** What the note window gets. It has no i18n of its own: its texts come
 *  along, keyed by their English. */
export type QuickNotePayload = {
  sessionId: number;
  gameName: string;
  coverUrl: string | null;
  note: string;
  /** Running sessions count up from here: the start, moved later by the
   *  session's finished pauses. */
  startedAt: string | null;
  /** Set while the session is paused: its clock stands at this moment. */
  pausedAt?: string | null;
  /** Finished sessions show their length instead. */
  duration: string | null;
  labels: Record<string, string>;
  monitor?: string | null;
  locale?: string | null;
  theme: "dark" | "light";
  accentColor: string | null;
  reducedMotion: boolean;
  /** Set when the box is for a screenshot's caption. */
  caption?: CaptionTarget | null;
};

export type CaptionPayload = QuickNotePayload & { caption: CaptionTarget };

export type QuickNoteLabel =
  | "Session note"
  | "Playing now"
  | "Paused"
  | "Session saved"
  | "What happened? Where did you stop?"
  | "Enter saves · Shift+Enter starts a new line · Esc cancels"
  | "Save"
  | "Cancel";

function quickNoteLabels(): Record<QuickNoteLabel, string> {
  return {
    "Session note": t("Session note"),
    "Playing now": t("Playing now"),
    Paused: t("Paused"),
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

/** Where and how the box shows: the popups' screen, the app's look. */
export function boxLook() {
  const state = useAppStore.getState();
  const media = (
    globalThis as typeof globalThis & {
      matchMedia?: (query: string) => { matches: boolean };
    }
  ).matchMedia;
  return {
    monitor: state.settings.overlayMonitor ?? "primary",
    locale: appLocale(),
    theme: state.settings.theme,
    accentColor: state.settings.accentColor,
    reducedMotion:
      typeof media === "function" &&
      media("(prefers-reduced-motion: reduce)").matches,
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
  const payload: QuickNotePayload = {
    sessionId,
    gameName: session.gameName ?? session.exeName.replace(/\.exe$/i, ""),
    coverUrl: pickedCover(state, session) ?? session.coverUrl ?? null,
    note: session.note ?? "",
    startedAt: active ? new Date(countFromMs(active)).toISOString() : null,
    pausedAt: active?.pausedAt ?? null,
    duration: active
      ? null
      : formatDuration(
          "durationSeconds" in session ? (session.durationSeconds ?? 0) : 0,
        ),
    labels: quickNoteLabels(),
    ...boxLook(),
  };
  void invoke("quick_note_open", { payload }).catch((error) =>
    console.error("quick note failed to open", error),
  );
}

export type CaptionLabel =
  | "SCREENSHOT"
  | "Picture saved · {{time}}"
  | "Caption"
  | "What's happening in this picture?"
  | "Enter saves · Esc keeps the picture without a caption"
  | "Skip"
  | "Save";

function captionLabels(): Record<CaptionLabel, string> {
  return {
    SCREENSHOT: t("SCREENSHOT"),
    // The box fills in the time itself.
    "Picture saved · {{time}}": t("Picture saved · {{time}}", {
      time: "{{time}}",
    }),
    Caption: t("Caption"),
    "What's happening in this picture?": t("What's happening in this picture?"),
    "Enter saves · Esc keeps the picture without a caption": t(
      "Enter saves · Esc keeps the picture without a caption",
    ),
    Skip: t("Skip"),
    Save: t("Save"),
  };
}

/** Opens the caption box over the game for a picture just taken. False when
 *  a box was already open: it comes back instead, and this picture keeps no
 *  caption. */
export async function openScreenshotCaptionBox(
  shot: Screenshot,
  game: { sessionId: number; gameName?: string; coverUrl?: string },
) {
  if (currentPlatform() === "macos") return false;
  const payload: CaptionPayload = {
    sessionId: game.sessionId,
    gameName: game.gameName ?? shot.folder,
    coverUrl: game.coverUrl ?? null,
    note: "",
    startedAt: null,
    duration: null,
    labels: captionLabels(),
    ...boxLook(),
    caption: {
      path: shot.path,
      pictureUrl: convertFileSrc(shot.path),
      takenAt: new Date(shot.takenAtMs).toLocaleTimeString(appLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  };
  return invoke<boolean>("quick_note_open", { payload });
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
