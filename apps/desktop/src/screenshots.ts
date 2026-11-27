import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session } from "@playcounter/shared";
import { useMemo } from "react";
import { create } from "zustand";
import {
  showCurrentSessionOverlay,
  showScreenshotOverlay,
} from "./desktopOverlayBridge";
import { appLocale, getT } from "./i18n";
import { screenshotBlackNotification } from "./notifications";
import { coverOverride } from "./pickedCovers";
import { isSampleShot, useSampleScreenshots } from "./screenshotSample";
import { openScreenshotCaptionBox } from "./quickNote";
import {
  resolvedCanonicalGameKey,
  useAppStore,
  type ActiveSession,
} from "./store";

const t = getT("history");

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
  /** Kept in the picture file itself. */
  caption: string | null;
};

/** Sent by Rust when the caption box closes, with or without a caption. */
export const SCREENSHOT_CAPTION_CLOSE_EVENT =
  "playcounter:screenshot-caption-close";

/** What Rust says when the caption box closes. `markUp`: its picture was
 *  clicked to mark it up. */
export type CaptionBoxClosed = {
  path: string;
  caption: string | null;
  markUp?: boolean;
};

/** With the moment it was taken: the time in its name, else the file's.
 *  `pictureMs` is the file's time when its picture last changed (marked up).
 *  A caption changes the file, not the picture: the picture keeps its
 *  address (`pictureSource`), so nothing shown loads again and flickers. */
export type Screenshot = ScreenshotFile & {
  takenAtMs: number;
  pictureMs?: number;
};

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
    pictureMs: file.modifiedMs,
  };
}

/** The picture as listed now, for keeping what didn't change. */
function listed(path: string) {
  return useScreenshots.getState().files.find((entry) => entry.path === path);
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

/** Every session's pictures, worked out once per change of the lists. */
function sessionPictures(
  files: Screenshot[],
  recent: Session[],
  active: ActiveSession[],
) {
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
  return memo.map;
}

/** The pictures of one session, oldest first. */
export function useSessionScreenshots(sessionId: number): Screenshot[] {
  const files = useScreenshots((state) => state.files);
  const recent = useAppStore((state) => state.recentSessions);
  const active = useAppStore((state) => state.activeSessions);
  if (!files.length) return NONE;
  return sessionPictures(files, recent, active).get(sessionId) ?? NONE;
}

/** One of a game's own pictures, with the session it was taken in when that
 *  session is still kept. */
export type GameScreenshot = {
  shot: Screenshot;
  session?: Session | ActiveSession;
};

const NO_GAME_SHOTS: GameScreenshot[] = [];

/** A game's own pictures, newest first (Game Details): those taken in its
 *  sessions, plus those in its own folder that no kept session claims, such
 *  as one from a session that has aged out of the list. `gameKey` is the
 *  game's historyGameKey. */
export function useGameScreenshots(
  gameKey: string | null,
  gameName: string,
): GameScreenshot[] {
  const files = useScreenshots((state) => state.files);
  const recent = useAppStore((state) => state.recentSessions);
  const active = useAppStore((state) => state.activeSessions);
  return useMemo(
    () => gameScreenshotList(files, recent, active, gameKey, gameName),
    [files, recent, active, gameKey, gameName],
  );
}

/** useGameScreenshots' list, from the lists given. */
export function gameScreenshotList(
  files: Screenshot[],
  recent: Session[],
  active: ActiveSession[],
  gameKey: string | null,
  gameName: string,
): GameScreenshot[] {
  if (!files.length) return NO_GAME_SHOTS;
  const bySession = sessionPictures(files, recent, active);
  const result: GameScreenshot[] = [];
  if (gameKey)
    for (const session of [...recent, ...active]) {
      if (resolvedCanonicalGameKey(session) !== gameKey) continue;
      for (const shot of bySession.get(session.id) ?? [])
        result.push({ shot, session });
    }
  const claimed = new Set(
    [...bySession.values()].flat().map((shot) => shot.path),
  );
  const folder = simplified(gameName);
  if (folder)
    for (const shot of files)
      if (!claimed.has(shot.path) && simplified(shot.folder) === folder)
        result.push({ shot });
  if (!result.length) return NO_GAME_SHOTS;
  return result.sort(
    (left, right) => right.shot.takenAtMs - left.shot.takenAtMs,
  );
}

/** Where a picture sits in the viewer's row (docs/session-screenshots-plan.md):
 *  under its session's day, the running session's under "This session". */
export type PictureGroup = { key: string; label: string; current: boolean };

function localDay(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Sat 23 Nov", with the year when it isn't this year's. */
function dayLabel(ms: number, nowMs: number) {
  const thisYear = new Date(ms).getFullYear() === new Date(nowMs).getFullYear();
  return new Date(ms).toLocaleDateString(appLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
  });
}

/** All of a game's own pictures, oldest first, each with its group: the
 *  viewer's list from Now Playing and the screenshot box's. */
export function gamePictures(gameKey: string | null, gameName: string) {
  const { files } = useScreenshots.getState();
  const { recentSessions, activeSessions } = useAppStore.getState();
  const running = new Set(activeSessions.map((session) => session.id));
  const nowMs = Date.now();
  const list = [
    ...gameScreenshotList(
      files,
      recentSessions,
      activeSessions,
      gameKey,
      gameName,
    ),
  ].reverse();
  const groups = new Map<string, PictureGroup>();
  for (const { shot, session } of list) {
    if (session && running.has(session.id))
      groups.set(shot.path, {
        key: `session:${session.id}`,
        label: t("This session"),
        current: true,
      });
    else if (session) {
      const startMs = Date.parse(session.startedAt);
      groups.set(shot.path, {
        key: `session:${session.id}`,
        label: dayLabel(startMs, nowMs),
        current: false,
      });
    } else
      groups.set(shot.path, {
        key: `day:${localDay(shot.takenAtMs)}`,
        label: dayLabel(shot.takenAtMs, nowMs),
        current: false,
      });
  }
  return { shots: list.map(({ shot }) => shot), groups };
}

let pidsOf: ((session: ActiveSession) => number[]) | null = null;
let lifecycle: { disposed: boolean; unlisten?: UnlistenFn } | null = null;

type PopupGame = { gameName?: string; coverUrl?: string };
/** Pictures whose caption box is open, with the game for the popup after. */
const captionBoxes = new Map<string, PopupGame>();

/** A game on this PC. Console and hand-timed sessions have no window here. */
export function onThisPc(session: ActiveSession) {
  return !session.recoveredFromCheckpoint && !session.timer && !session.console;
}

/** Reads the folder once at start. `pids` names a running game's processes. */
export function initializeScreenshots(
  pids: (session: ActiveSession) => number[],
) {
  pidsOf = pids;
  if (lifecycle) return;
  const state: { disposed: boolean; unlisten?: UnlistenFn } = {
    disposed: false,
  };
  lifecycle = state;
  void loadScreenshots();
  void listen<CaptionBoxClosed>(
    SCREENSHOT_CAPTION_CLOSE_EVENT,
    ({ payload }) => {
      if (state.disposed) return;
      // Clicked to mark up: the screenshot box saves the caption and says when
      // it's done (screenshotBox.ts).
      if (payload.markUp) captionBoxes.delete(payload.path);
      else void captionBoxClosed(payload.path, payload.caption);
    },
  )
    .then((unlisten) => {
      if (state.disposed) unlisten();
      else state.unlisten = unlisten;
    })
    .catch((error) => console.error("caption listener failed", error));
}

export function disposeScreenshots() {
  if (lifecycle) {
    lifecycle.disposed = true;
    lifecycle.unlisten?.();
  }
  lifecycle = null;
  pidsOf = null;
  captionBoxes.clear();
}

/** The caption box closed: save what was written, then show the popup the
 *  picture would have had at once. */
async function captionBoxClosed(path: string, caption: string | null) {
  const game = captionBoxes.get(path) ?? {};
  captionBoxes.delete(path);
  if (caption?.trim()) {
    try {
      const shot = await setScreenshotCaption(path, caption);
      showScreenshotOverlay({
        outcome: "saved",
        ...game,
        caption: shot.caption ?? undefined,
      });
      return;
    } catch (error) {
      // The picture is saved anyway; the popup just has no caption.
      console.error("screenshot caption failed", error);
    }
  }
  showScreenshotOverlay({ outcome: "saved", ...game });
}

/** Writes the caption into the picture (null removes it) and updates the
 *  list and the viewer. */
export async function setScreenshotCaption(
  path: string,
  caption: string | null,
) {
  if (isSampleShot(path)) {
    // The guide's sample picture: the caption stays in memory.
    const current = useSampleScreenshots
      .getState()
      .shots.find((entry) => entry.path === path)!;
    const sample = { ...current, caption: caption?.trim() || null };
    const swapSample = <T extends ViewerPicture>(shots: T[]) =>
      shots.map((entry) =>
        !isWebPicture(entry) && entry.path === path ? sample : entry,
      );
    useSampleScreenshots.setState((state) => ({
      shots: swapSample(state.shots),
    }));
    useScreenshotViewer.setState((state) => ({
      shots: swapSample(state.shots),
    }));
    return sample;
  }
  const file = await invoke<ScreenshotFile>("screenshot_caption", {
    path,
    caption,
  });
  const before = listed(path);
  // The file's time moved, not the picture or the moment it was taken.
  const shot: Screenshot = {
    ...toScreenshot({ ...file, path }),
    ...(before
      ? {
          takenAtMs: before.takenAtMs,
          pictureMs: before.pictureMs ?? before.modifiedMs,
        }
      : {}),
  };
  const swap = <T extends ViewerPicture>(shots: T[]) =>
    shots.map((entry) =>
      !isWebPicture(entry) && entry.path === path ? shot : entry,
    );
  useScreenshots.setState((current) => ({ files: swap(current.files) }));
  useScreenshotViewer.setState((current) => ({ shots: swap(current.shots) }));
  return shot;
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
 *  started last, added to its running session. With `caption`, the caption
 *  box opens over the game first and the popup comes when it closes. With
 *  `markUp`, the picture opens over the game to mark it up
 *  (screenshotBox.ts); it answers whether it opened. */
export async function takeScreenshot({
  caption = false,
  markUp,
}: {
  caption?: boolean;
  markUp?: (path: string) => Promise<boolean>;
} = {}) {
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
    coverUrl: coverOverride(state, session) ?? (session.coverUrl || undefined),
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
      if (caption) {
        captionBoxes.set(shot.path, game(session));
        const opened = await openScreenshotCaptionBox(shot, {
          sessionId: session.id,
          ...game(session),
        }).catch((error) => {
          console.error("caption box failed", error);
          return false;
        });
        if (opened) return;
        captionBoxes.delete(shot.path);
      } else if (markUp) {
        const opened = await markUp(shot.path).catch((error) => {
          console.error("mark up box failed", error);
          return false;
        });
        if (opened) return;
      }
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

/** An address the window can show a picture file from. `version` (the
 *  file's modifiedMs) gives a picture that changed in place, such as a marked
 *  up one, a new address, so the window doesn't show its old copy. The asset
 *  protocol ignores the query. */
export function screenshotSource(path: string, version?: number) {
  if (isSampleShot(path)) return path;
  const source = convertFileSrc(path);
  return version ? `${source}?v=${version}` : source;
}

/** The picture's address: new when the picture changed, not when only its
 *  caption did. */
export function pictureSource(shot: Screenshot) {
  return screenshotSource(shot.path, shot.pictureMs ?? shot.modifiedMs);
}

/** Only the player's own pictures can be marked up, and only JPEGs: that's
 *  what the screenshot key saves. Not IGDB's, not the guide's sample, not a
 *  PNG or WebP put into the folder by hand. */
export function canMarkUp(picture: ViewerPicture) {
  return (
    !isWebPicture(picture) &&
    !isSampleShot(picture.path) &&
    /\.jpe?g$/i.test(picture.path)
  );
}

/** Draws the marks (a see-through PNG as big as the picture) into the picture
 *  for good; the picture without them goes to the Recycle Bin. Updates the
 *  list and the viewer. */
export async function markUpScreenshot(path: string, marks: Uint8Array) {
  const file = await invoke<ScreenshotFile>("screenshot_markup", {
    path,
    marks: Array.from(marks),
  });
  const before = listed(path);
  // A new picture (new address), taken at the same moment.
  const shot: Screenshot = {
    ...toScreenshot({ ...file, path }),
    ...(before ? { takenAtMs: before.takenAtMs } : {}),
  };
  const swap = <T extends ViewerPicture>(shots: T[]) =>
    shots.map((entry) =>
      !isWebPicture(entry) && entry.path === path ? shot : entry,
    );
  useScreenshots.setState((current) => ({ files: swap(current.files) }));
  useScreenshotViewer.setState((current) => ({ shots: swap(current.shots) }));
  return shot;
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
  if (isSampleShot(path)) return Promise.resolve();
  return invoke("screenshot_open", { path });
}

export function revealScreenshot(path: string) {
  if (isSampleShot(path)) return Promise.resolve();
  return invoke("screenshot_reveal", { path });
}

/** Moves the picture to the Recycle Bin and drops it from the list. */
export async function deleteScreenshot(path: string) {
  if (isSampleShot(path)) {
    useSampleScreenshots.setState((state) => ({
      shots: state.shots.filter((entry) => entry.path !== path),
    }));
    return;
  }
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

/** A picture from the web, such as IGDB's screenshots of a game, shown in
 *  the viewer next to the player's own. It has no file: no caption, folder
 *  or Recycle Bin. */
export type WebPicture = { url: string };

/** What the viewer pages through. */
export type ViewerPicture = Screenshot | WebPicture;

export function isWebPicture(picture: ViewerPicture): picture is WebPicture {
  return "url" in picture;
}

/** The picture viewer: the pictures it pages through, the one shown, and the
 *  game's name for its title. */
export const useScreenshotViewer = create<{
  shots: ViewerPicture[];
  index: number;
  title?: string;
  /** Each picture's session by its path, when the row shows sessions. */
  groups?: Map<string, PictureGroup>;
}>(() => ({ shots: [], index: 0 }));

export function openScreenshotViewer(
  shots: ViewerPicture[],
  index: number,
  title?: string,
  groups?: Map<string, PictureGroup>,
) {
  useScreenshotViewer.setState({
    shots,
    index: Math.min(Math.max(0, index), shots.length - 1),
    title,
    groups,
  });
}

export function closeScreenshotViewer() {
  useScreenshotViewer.setState({
    shots: [],
    index: 0,
    title: undefined,
    groups: undefined,
  });
}
