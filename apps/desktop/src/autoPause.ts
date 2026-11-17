/* Auto pause (docs/auto-pause-plan.md): a game behind another app or
   minimized stops counting after a minute; a game in front stops after 5
   minutes without input. The pause starts at the moment you left, and input
   at the game counts on from there. Only a pause made here resumes by itself;
   one the player made waits for the player. */
import { invoke } from "@tauri-apps/api/core";
import { currentPlatform } from "./platform";
import { useAppStore, type ActiveSession } from "./store";

/** Behind another app or minimized this long: not played. */
export const BEHIND_AFTER_MS = 60_000;
/** In front without any input this long: not played (AFK). */
export const IDLE_AFTER_MS = 5 * 60_000;
const CHECK_INTERVAL_MS = 5_000;
/** The last input's time is worked out from a tick count at every check, so
 *  it moves by a few milliseconds without anyone touching anything. */
const INPUT_TIME_SLACK_MS = 1_000;

export type GameActivity = {
  /** Last keyboard, mouse or controller input on this PC. */
  lastInputAtMs: number;
  /** The game's window is the active one. */
  inFront: boolean;
  /** The game shows a window at all, minimized counts. Without one (a
   *  launcher whose child runs the game) only input decides. */
  hasWindow: boolean;
  /** When the checks first saw the game behind another app; null while it
   *  is in front. */
  leftFrontAtMs: number | null;
};

export type AwayStep = { pause: number } | { resume: number } | null;

/** Played on this PC: a console timer or a PlayStation session has no input
 *  here to go by. */
function playedHere(session: ActiveSession) {
  return !session.timer && !session.console;
}

/** What auto pause does to one session now: pause it from a moment in the
 *  past, resume it from your input, or nothing. */
export function awayStep(
  session: ActiveSession,
  activity: GameActivity,
  nowMs: number,
): AwayStep {
  if (!playedHere(session)) return null;
  const behind = activity.hasWindow && !activity.inFront;
  if (session.pausedAt) {
    if (session.pauseKind !== "away" || behind) return null;
    const pausedAtMs = Date.parse(session.pausedAt);
    return activity.lastInputAtMs > pausedAtMs + INPUT_TIME_SLACK_MS
      ? { resume: Math.min(activity.lastInputAtMs, nowMs) }
      : null;
  }
  // Each rule that applies names when you left; the earliest one wins.
  const leftAt: number[] = [];
  if (nowMs - activity.lastInputAtMs >= IDLE_AFTER_MS) {
    leftAt.push(activity.lastInputAtMs);
  }
  if (
    behind &&
    activity.leftFrontAtMs !== null &&
    nowMs - activity.leftFrontAtMs >= BEHIND_AFTER_MS
  ) {
    leftAt.push(activity.leftFrontAtMs);
  }
  if (leftAt.length === 0) return null;
  const awaySinceMs = Math.min(...leftAt);
  const startedAtMs = Date.parse(session.startedAt);
  return {
    pause: Number.isFinite(startedAtMs)
      ? Math.max(awaySinceMs, startedAtMs)
      : awaySinceMs,
  };
}

/** What `play_activity` answers, one entry per pid group. */
type PlayActivity = {
  inputIdleMs: number;
  /** Null until a controller was seen moving. */
  padIdleMs: number | null;
  inFront: boolean[];
  hasWindow: boolean[];
};

export type AutoPauseDeps = {
  /** The game's processes in the last scan, as the live timer uses them. */
  gamePids: (session: ActiveSession) => number[];
  pause: (sessionId: number, atMs: number) => void;
  resume: (sessionId: number, atMs: number) => void;
};

/** Session id → when the checks first saw that game behind another app. */
const leftFront = new Map<number, number>();
let checking = false;

/** One check of every running game. */
export async function checkAway(deps: AutoPauseDeps) {
  const { settings, activeSessions } = useAppStore.getState();
  if (settings.autoPauseEnabled !== true) {
    // Switched off: nobody stays paused by a feature that is off.
    leftFront.clear();
    for (const session of activeSessions) {
      if (session.pausedAt && session.pauseKind === "away") {
        deps.resume(session.id, Date.now());
      }
    }
    return;
  }
  const sessions = activeSessions.filter(playedHere);
  if (sessions.length === 0 || checking) {
    if (sessions.length === 0) leftFront.clear();
    return;
  }
  checking = true;
  let activity: PlayActivity;
  try {
    activity = await invoke<PlayActivity>("play_activity", {
      pidGroups: sessions.map((session) => deps.gamePids(session)),
    });
  } catch (error) {
    console.warn("auto pause check failed", error);
    return;
  } finally {
    checking = false;
  }
  const nowMs = Date.now();
  const lastInputAtMs =
    nowMs - Math.min(activity.inputIdleMs, activity.padIdleMs ?? Infinity);
  const current = new Map(
    useAppStore.getState().activeSessions.map((session) => [session.id, session]),
  );
  for (const [index, checked] of sessions.entries()) {
    const session = current.get(checked.id);
    if (!session) continue;
    const inFront = activity.inFront[index] === true;
    const hasWindow = activity.hasWindow[index] === true;
    // A paused game starts over once it counts again, so a resume while the
    // game is still behind never pauses it from before that resume.
    if (session.pausedAt || inFront || !hasWindow) {
      leftFront.delete(session.id);
    } else if (!leftFront.has(session.id)) {
      leftFront.set(session.id, nowMs);
    }
    const step = awayStep(
      session,
      {
        lastInputAtMs,
        inFront,
        hasWindow,
        leftFrontAtMs: leftFront.get(session.id) ?? null,
      },
      nowMs,
    );
    if (step && "pause" in step) {
      leftFront.delete(session.id);
      deps.pause(session.id, step.pause);
    } else if (step) {
      deps.resume(session.id, step.resume);
    }
  }
  for (const id of leftFront.keys()) {
    if (!current.has(id)) leftFront.delete(id);
  }
}

let timer: number | undefined;
let unsubscribe: (() => void) | undefined;

export function initializeAutoPause(deps: AutoPauseDeps) {
  if (timer !== undefined || currentPlatform() !== "windows") return;
  timer = window.setInterval(() => void checkAway(deps), CHECK_INTERVAL_MS);
  unsubscribe = useAppStore.subscribe((state, previous) => {
    // Turning it off resumes at once, not at the next check.
    if (
      state.settings.autoPauseEnabled !== true &&
      previous.settings.autoPauseEnabled === true
    ) {
      void checkAway(deps);
    }
  });
}

export function disposeAutoPause() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  leftFront.clear();
  checking = false;
}
