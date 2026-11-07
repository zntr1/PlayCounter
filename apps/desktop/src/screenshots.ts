import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Session } from "@playcounter/shared";
import { create } from "zustand";
import {
  showCurrentSessionOverlay,
  showScreenshotOverlay,
} from "./desktopOverlayBridge";
import { screenshotBlackNotification } from "./notifications";
import { pickedCover } from "./pickedCovers";
import { useAppStore, type ActiveSession } from "./store";

/* Screenshots (docs/memory-book-plan.md). The screenshot key saves a picture
   of the game to Pictures\PlayCounter\<Game>\. That folder is the whole list:
   nothing about a picture is stored anywhere else. A picture belongs to the
   session that ran when it was taken, so editing, splitting or combining
   sessions moves it along by itself. */

/** A picture in Pictures\PlayCounter, as Rust lists it. */
export type ScreenshotFile = {
  path: string;
  /** The game folder's name; empty for pictures right in PlayCounter. */
  folder: string;
  name: string;
  bytes: number;
  modifiedMs: number;
  previewPath: string | null;
};

/** With the moment it was taken: the time in its name, else the file's. */
export type Screenshot = ScreenshotFile & { takenAtMs: number };

/** What the screenshot key's Rust side answers. */
type TakeResult =
  | { status: "saved"; sessionId: number; file: ScreenshotFile }
  | { status: "black"; sessionId: number }
  | { status: "minimized"; sessionId: number }
  | { status: "no-window" };

type SessionLike = {
  id: number;
  startedAt: string;
  gameName?: string;
  durationSeconds?: number | null;
  endedAt?: string | null;
};

/** A picture written this long after the game closed still belongs to it. */
export const SCREENSHOT_GRACE_MS = 2 * 60_000;

export const useScreenshots = create<{ files: Screenshot[] }>(() => ({
  files: [],
}));

const NAME_TIME =
  /(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})(?: \(\d+\))?\.[^.]+$/;

/** The local time in "Elden Ring 2026-11-07 19-14-03.jpg", or null. */
export function screenshotTimeFromName(name: string): number | null {
  const match = NAME_TIME.exec(name);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  // new Date() rolls impossible dates over (month 13, hour 25); a real local
  // time comes back the same.
  const same =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === second;
  return same ? date.getTime() : null;
}

export function toScreenshot(file: ScreenshotFile): Screenshot {
  return {
    ...file,
    takenAtMs: screenshotTimeFromName(file.name) ?? file.modifiedMs,
  };
}

function sessionSpan(session: SessionLike, nowMs: number) {
  const startMs = Date.parse(session.startedAt);
  const endMs =
    typeof session.durationSeconds === "number" &&
    Number.isFinite(session.durationSeconds)
      ? startMs + Math.max(0, session.durationSeconds) * 1000
      : session.endedAt
        ? Date.parse(session.endedAt)
        : nowMs;
  return { session, startMs, endMs: Number.isFinite(endMs) ? endMs : nowMs };
}

/** Letters and digits only: "Halo: Reach" and its folder "Halo Reach" match. */
function simplified(name: string) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Each session's pictures, oldest first. A picture goes to the session that
 *  ran when it was taken; when two games ran, to the one its folder names,
 *  else to the game started last. Pictures outside every session are left
 *  out. */
export function screenshotsBySession(
  shots: Screenshot[],
  sessions: SessionLike[],
  nowMs: number,
): Map<number, Screenshot[]> {
  const result = new Map<number, Screenshot[]>();
  if (!shots.length || !sessions.length) return result;
  const spans = sessions
    .map((session) => sessionSpan(session, nowMs))
    .filter((span) => Number.isFinite(span.startMs))
    .sort((left, right) => left.startMs - right.startMs);
  const longest = spans.reduce(
    (most, span) => Math.max(most, span.endMs - span.startMs),
    0,
  );
  for (const shot of shots) {
    // The last session that started by then; earlier ones are only worth
    // checking as far back as the longest session.
    let low = 0;
    let high = spans.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (spans[middle].startMs <= shot.takenAtMs) low = middle + 1;
      else high = middle;
    }
    const running = [];
    for (let index = low - 1; index >= 0; index--) {
      const span = spans[index];
      if (span.startMs < shot.takenAtMs - longest - SCREENSHOT_GRACE_MS) break;
      if (shot.takenAtMs <= span.endMs + SCREENSHOT_GRACE_MS)
        running.push(span);
    }
    if (!running.length) continue;
    const folder = simplified(shot.folder);
    const owner =
      (folder &&
        running.find(
          ({ session }) => simplified(session.gameName ?? "") === folder,
        )) ||
      running[0];
    const list = result.get(owner.session.id) ?? [];
    list.push(shot);
    result.set(owner.session.id, list);
  }
  for (const list of result.values())
    list.sort((left, right) => left.takenAtMs - right.takenAtMs);
  return result;
}

let memo: {
  files: Screenshot[];
  recent: Session[];
  active: ActiveSession[];
  map: Map<number, Screenshot[]>;
} | null = null;
const NONE: Screenshot[] = [];

/** The pictures of one session, oldest first. */
export function useSessionScreenshots(sessionId: number): Screenshot[] {
  const files = useScreenshots((state) => state.files);
  const recent = useAppStore((state) => state.recentSessions);
  const active = useAppStore((state) => state.activeSessions);
  if (!files.length) return NONE;
  if (
    !memo ||
    memo.files !== files ||
    memo.recent !== recent ||
    memo.active !== active
  ) {
    memo = {
      files,
      recent,
      active,
      map: screenshotsBySession(files, [...recent, ...active], Date.now()),
    };
  }
  return memo.map.get(sessionId) ?? NONE;
}

let pidsOf: ((session: ActiveSession) => number[]) | null = null;
let lifecycle: { disposed: boolean } | null = null;
/** What Rust was last told: keep the graphics device ready or not. */
let ready: boolean | null = null;
let stopWatching: (() => void) | null = null;

/** A game on this PC. Console and hand-timed sessions have no window here. */
function onThisPc(session: ActiveSession) {
  return !session.recoveredFromCheckpoint && !session.timer && !session.console;
}

function tellReady(on: boolean) {
  ready = on;
  void invoke("screenshot_ready", { on }).catch((error) =>
    console.error("screenshot ready failed", error),
  );
}

/** While a game runs and the key is set, Rust keeps the graphics device
 *  ready, so a picture is taken the moment the key is pressed. Otherwise it
 *  lets the device go and the memory with it. */
function syncReady() {
  const state = useAppStore.getState();
  const want =
    !!state.settings.screenshotHotkey && state.activeSessions.some(onThisPc);
  if (want !== ready) tellReady(want);
}

/** Reads the folder once at start. `pids` names a running game's processes. */
export function initializeScreenshots(
  pids: (session: ActiveSession) => number[],
) {
  pidsOf = pids;
  if (lifecycle) return;
  lifecycle = { disposed: false };
  void loadScreenshots();
  ready = null;
  syncReady();
  stopWatching = useAppStore.subscribe(syncReady);
}

export function disposeScreenshots() {
  if (lifecycle) lifecycle.disposed = true;
  lifecycle = null;
  pidsOf = null;
  stopWatching?.();
  stopWatching = null;
  if (ready) tellReady(false);
  ready = null;
}

/** Reads Pictures\PlayCounter again: pictures added or deleted in Explorer
 *  show up or go. */
export async function loadScreenshots() {
  const current = lifecycle;
  try {
    const files = await invoke<ScreenshotFile[]>("screenshot_list");
    if (current && current.disposed) return;
    useScreenshots.setState({ files: (files ?? []).map(toScreenshot) });
  } catch (error) {
    console.error("screenshot list failed", error);
  }
}

/** The screenshot key: a picture of the game in front, or of the game
 *  started last, added to its running session. */
export async function takeScreenshot() {
  const state = useAppStore.getState();
  const sessions = state.activeSessions
    .filter(onThisPc)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const candidates = sessions.map((session) => ({
    sessionId: session.id,
    pids: pidsOf?.(session) ?? [],
    gameName: session.gameName,
  }));
  if (!candidates.length) {
    // Rust answers anyway, so the "didn't work" sound plays.
    await invoke("screenshot_take", { candidates }).catch((error) =>
      console.error("screenshot failed", error),
    );
    showCurrentSessionOverlay();
    return;
  }
  const game = (session: ActiveSession) => ({
    gameName: session.gameName,
    coverUrl: pickedCover(state, session) ?? (session.coverUrl || undefined),
  });
  let result: TakeResult;
  try {
    result = await invoke<TakeResult>("screenshot_take", { candidates });
  } catch (error) {
    console.error("screenshot failed", error);
    showScreenshotOverlay({ outcome: "failed", ...game(sessions[0]) });
    return;
  }
  const session =
    ("sessionId" in result &&
      sessions.find((entry) => entry.id === result.sessionId)) ||
    sessions[0];
  switch (result.status) {
    case "saved": {
      const shot = toScreenshot(result.file);
      useScreenshots.setState((current) => ({
        files: [
          ...current.files.filter((entry) => entry.path !== shot.path),
          shot,
        ],
      }));
      showScreenshotOverlay({ outcome: "saved", ...game(session) });
      return;
    }
    case "black":
      // The popup can't show over exclusive fullscreen; the bell keeps it.
      useAppStore
        .getState()
        .addNotification(
          screenshotBlackNotification(
            session.gameName,
            new Date().toISOString(),
          ),
        );
      showScreenshotOverlay({ outcome: "black", ...game(session) });
      return;
    case "minimized":
      showScreenshotOverlay({ outcome: "minimized", ...game(session) });
      return;
    default:
      showScreenshotOverlay({ outcome: "no-window", ...game(session) });
  }
}

/** An address the window can show a picture file from. */
export function screenshotSource(path: string) {
  return convertFileSrc(path);
}

/** The preview of a picture that has none yet, made now. Null on failure. */
export async function makeScreenshotPreview(path: string) {
  try {
    return await invoke<string>("screenshot_preview", { path });
  } catch (error) {
    console.error("screenshot preview failed", error);
    return null;
  }
}

export function openScreenshot(path: string) {
  return invoke("screenshot_open", { path });
}

export function revealScreenshot(path: string) {
  return invoke("screenshot_reveal", { path });
}

/** Moves the picture to the Recycle Bin and drops it from the list. */
export async function deleteScreenshot(path: string) {
  await invoke("screenshot_delete", { path });
  useScreenshots.setState((current) => ({
    files: current.files.filter((entry) => entry.path !== path),
  }));
}

export function screenshotsFolder() {
  return invoke<string>("screenshot_folder");
}

export function openScreenshotsFolder() {
  return invoke("screenshot_open_folder");
}

/** The picture viewer: the pictures it pages through, the one shown, and the
 *  game's name for its title. */
export const useScreenshotViewer = create<{
  shots: Screenshot[];
  index: number;
  title?: string;
}>(() => ({ shots: [], index: 0 }));

export function openScreenshotViewer(
  shots: Screenshot[],
  index: number,
  title?: string,
) {
  useScreenshotViewer.setState({
    shots,
    index: Math.min(Math.max(0, index), shots.length - 1),
    title,
  });
}

export function closeScreenshotViewer() {
  useScreenshotViewer.setState({ shots: [], index: 0, title: undefined });
}
