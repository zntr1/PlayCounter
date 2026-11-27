import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  showCurrentSessionOverlay,
  showScreenshotOverlay,
} from "./desktopOverlayBridge";
import { appLocale, getT } from "./i18n";
import { coverOverride } from "./pickedCovers";
import { currentPlatform } from "./platform";
import { boxLook } from "./quickNote";
import {
  canMarkUp,
  deleteScreenshot,
  gamePictures,
  markUpScreenshot,
  onThisPc,
  screenshotSource,
  setScreenshotCaption,
  useScreenshots,
  type PictureGroup,
} from "./screenshots";
import {
  resolvedCanonicalGameKey,
  useAppStore,
  type ActiveSession,
} from "./store";
import type { MarkupText } from "./ui/MarkupTools";
import { markupTexts } from "./ui/ScreenshotMarkup";

const t = getT("history");

/* The screenshot box (docs/session-screenshots-plan.md) ──────────────────────
   The "Show screenshots" key opens the note box window over the game, as big
   as the game's screen, with all of the game's own pictures at the newest.
   Like the counter box, the box only shows and sends: the main window writes
   captions, marks up and recycles, then sends the box its new list. */

/** quick_note.rs SCREENSHOT_BOX_ACTION_EVENT: what the box asks for. */
export const SCREENSHOT_BOX_ACTION_EVENT = "playcounter:screenshot-box-action";

/** The box keeps this many of the game's newest pictures (quick_note.rs). */
const PICTURE_LIMIT = 500;

/** One picture as the box shows it, everything ready to show. */
export type ScreenshotBoxPicture = {
  path: string;
  /** The picture, with its time in the address so a marked up one loads anew. */
  url: string;
  /** Its small preview, or the picture when it has none yet. */
  thumbUrl: string;
  /** When it was taken, written out. */
  takenAt: string;
  group: PictureGroup;
  caption: string | null;
  /** Mark up works on it: the player's own JPEG. */
  markable: boolean;
};

export type ScreenshotBoxAction =
  | { kind: "caption"; path: string; caption: string | null }
  | { kind: "recycle"; path: string }
  /** The marks as a see-through PNG, in base64. */
  | { kind: "markUp"; path: string; png: string };

/** What the main window did with the box's last action. */
export type ScreenshotBoxDone = {
  kind: ScreenshotBoxAction["kind"];
  path: string;
  ok: boolean;
};

/** The pictures, oldest first, and the one to open at. The main window sends
 *  it again after every change, with `done` after an action. */
export type ScreenshotBoxState = {
  pictures: ScreenshotBoxPicture[];
  index: number;
  done?: ScreenshotBoxDone;
};

export type ScreenshotBoxLabel =
  | MarkupText
  | "Mark up"
  | "Move to the Recycle Bin"
  | "Close"
  | "Previous screenshot"
  | "Next screenshot"
  | "All screenshots"
  | "Open screenshot {{index}} of {{total}}"
  | "{{takenAt}} · {{index}} of {{total}}"
  | "This session"
  | "Add a caption"
  | "Change the caption"
  | "Caption"
  | "What's happening in this picture?"
  | "Enter saves · Esc cancels"
  | "“{{caption}}”"
  | "Moved to the Recycle Bin"
  | "Saved into the picture"
  | "That didn't work"
  | "The picture may have been moved or deleted."
  | "The caption couldn't be saved."
  | "Draw on the picture. Drag stickers and numbers to move them."
  | "Esc takes you back to the game.";

/** What the box gets. It has no i18n of its own: its texts come along, keyed
 *  by their English, placeholders left for the box to fill. */
export type ScreenshotBoxPayload = {
  gameName: string;
  coverUrl: string | null;
  screenshots: ScreenshotBoxState;
  labels: Record<ScreenshotBoxLabel, string>;
  monitor?: string | null;
  locale?: string | null;
  theme: "dark" | "light";
  accentColor: string | null;
  reducedMotion: boolean;
};

function screenshotBoxLabels(): Record<ScreenshotBoxLabel, string> {
  return {
    ...markupTexts(),
    "Mark up": t("Mark up"),
    "Move to the Recycle Bin": t("Move to the Recycle Bin"),
    Close: t("Close"),
    "Previous screenshot": t("Previous screenshot"),
    "Next screenshot": t("Next screenshot"),
    "All screenshots": t("All screenshots"),
    // The box puts the numbers in.
    "Open screenshot {{index}} of {{total}}": t(
      "Open screenshot {{index}} of {{total}}",
      { index: "{{index}}", total: "{{total}}" },
    ),
    "{{takenAt}} · {{index}} of {{total}}": t(
      "{{takenAt}} · {{index}} of {{total}}",
      { takenAt: "{{takenAt}}", index: "{{index}}", total: "{{total}}" },
    ),
    "This session": t("This session"),
    "Add a caption": t("Add a caption"),
    "Change the caption": t("Change the caption"),
    Caption: t("Caption"),
    "What's happening in this picture?": t("What's happening in this picture?"),
    "Enter saves · Esc cancels": t("Enter saves · Esc cancels"),
    "“{{caption}}”": t("“{{caption}}”", { caption: "{{caption}}" }),
    "Moved to the Recycle Bin": t("Moved to the Recycle Bin"),
    "Saved into the picture": t("Saved into the picture"),
    "That didn't work": t("That didn't work"),
    "The picture may have been moved or deleted.": t(
      "The picture may have been moved or deleted.",
    ),
    "The caption couldn't be saved.": t("The caption couldn't be saved."),
    "Draw on the picture. Drag stickers and numbers to move them.": t(
      "Draw on the picture. Drag stickers and numbers to move them.",
    ),
    "Esc takes you back to the game.": t("Esc takes you back to the game."),
  };
}

type Game = { gameKey: string; gameName: string };

/** The game's own pictures as the box shows them, oldest first. */
function boxPictures(game: Game): ScreenshotBoxPicture[] {
  const { shots, groups } = gamePictures(game.gameKey, game.gameName);
  return shots.slice(-PICTURE_LIMIT).map((shot) => {
    const url = screenshotSource(shot.path, shot.modifiedMs);
    return {
      path: shot.path,
      url,
      thumbUrl: shot.previewPath ? screenshotSource(shot.previewPath) : url,
      takenAt: new Date(shot.takenAtMs).toLocaleString(appLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      group: groups.get(shot.path)!,
      caption: shot.caption,
      markable: canMarkUp(shot),
    };
  });
}

let pidsOf: ((session: ActiveSession) => number[]) | null = null;
/** The game the open box shows. */
let openFor: Game | null = null;
let lastSent = "";

/** The game in front when the key was pressed, else the game started last. */
async function gameInFront(sessions: ActiveSession[]) {
  const pid = await invoke<number | null>("quick_note_foreground_pid").catch(
    (error) => {
      console.error("screenshot box: no window in front", error);
      return null;
    },
  );
  return (
    (pid && sessions.find((session) => pidsOf?.(session).includes(pid))) ||
    sessions[0]
  );
}

/** The "Show screenshots" key. */
export async function openScreenshotBox() {
  if (currentPlatform() === "macos") return;
  const sessions = useAppStore
    .getState()
    .activeSessions.filter(onThisPc)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  if (!sessions.length) {
    showCurrentSessionOverlay();
    return;
  }
  const session = await gameInFront(sessions);
  const game = {
    gameKey: resolvedCanonicalGameKey(session),
    gameName: session.gameName,
  };
  const coverUrl =
    coverOverride(useAppStore.getState(), session) ??
    (session.coverUrl || null);
  const pictures = boxPictures(game);
  if (!pictures.length) {
    showScreenshotOverlay({
      outcome: "none",
      gameName: session.gameName,
      coverUrl: coverUrl ?? undefined,
    });
    return;
  }
  const payload: ScreenshotBoxPayload = {
    gameName: session.gameName,
    coverUrl,
    screenshots: { pictures, index: pictures.length - 1 },
    labels: screenshotBoxLabels(),
    ...boxLook(),
  };
  openFor = game;
  lastSent = JSON.stringify(pictures);
  try {
    // False when the key closed an open box instead.
    if (!(await invoke<boolean>("quick_note_open", { payload })))
      openFor = null;
  } catch (error) {
    console.error("screenshot box failed to open", error);
    openFor = null;
  }
}

/** Sends the box its list when it changed, and always with `done`. */
function send(done?: ScreenshotBoxDone) {
  const game = openFor;
  if (!game) return;
  const pictures = boxPictures(game);
  const text = JSON.stringify(pictures);
  if (!done && text === lastSent) return;
  lastSent = text;
  const update: ScreenshotBoxState = {
    pictures,
    index: Math.max(0, pictures.length - 1),
    ...(done ? { done } : {}),
  };
  void invoke<boolean>("screenshot_box_update", { update })
    .then((open) => {
      // Closed in the meantime: nothing more to send.
      if (!open && openFor === game) openFor = null;
    })
    .catch((error) => console.error("screenshot box update failed", error));
}

function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0));
}

/** Does what the box asked, for a picture it shows, then tells it. */
async function applyScreenshotBoxAction(action: ScreenshotBoxAction) {
  const game = openFor;
  if (!game) return;
  const known = boxPictures(game).some(
    (picture) => picture.path === action.path,
  );
  let ok = known;
  if (known)
    try {
      if (action.kind === "caption")
        await setScreenshotCaption(action.path, action.caption);
      else if (action.kind === "recycle") await deleteScreenshot(action.path);
      else await markUpScreenshot(action.path, fromBase64(action.png));
    } catch (error) {
      console.error("screenshot box action failed", error);
      ok = false;
    }
  send({ kind: action.kind, path: action.path, ok });
}

let lifecycle: {
  disposed: boolean;
  unlisten?: UnlistenFn;
  unsubscribe: () => void;
} | null = null;

/** `pids` names a running game's processes, to find the one in front. */
export function initializeScreenshotBox(
  pids: (session: ActiveSession) => number[],
) {
  pidsOf = pids;
  if (lifecycle) return;
  const unsubscribeFiles = useScreenshots.subscribe(() => send());
  // A session that ends moves its pictures from "This session" to its day.
  const unsubscribeSessions = useAppStore.subscribe((state, previous) => {
    if (
      state.activeSessions !== previous.activeSessions ||
      state.recentSessions !== previous.recentSessions
    )
      send();
  });
  const current = {
    disposed: false,
    unlisten: undefined as UnlistenFn | undefined,
    unsubscribe: () => {
      unsubscribeFiles();
      unsubscribeSessions();
    },
  };
  lifecycle = current;
  void listen<ScreenshotBoxAction>(
    SCREENSHOT_BOX_ACTION_EVENT,
    ({ payload }) => {
      if (!current.disposed) void applyScreenshotBoxAction(payload);
    },
  )
    .then((unlisten) => {
      if (current.disposed) unlisten();
      else current.unlisten = unlisten;
    })
    .catch((error) => console.error("screenshot box listener failed", error));
}

export function disposeScreenshotBox() {
  if (!lifecycle) return;
  lifecycle.disposed = true;
  lifecycle.unlisten?.();
  lifecycle.unsubscribe();
  lifecycle = null;
  pidsOf = null;
  openFor = null;
  lastSent = "";
}
