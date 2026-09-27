/* Time counter for software (Discord, Spotify, launchers). Tools never become
   sessions, so nothing in the game code (Now Playing, history, achievements,
   stats) ever sees them. Each scan credits the time since the previous scan
   to every running tool, once per tool, split at local midnight.

   Usage is keyed by executable, not by tool id: a local tool that gets
   approved, merged or renamed on the server keeps its hours without moving
   any data. */

export type ToolUsageRecord = {
  /** Last seen path of the executable, for its icon. */
  exePath?: string;
  /** Local date (YYYY-MM-DD) → seconds. */
  days: Record<string, number>;
  /** Time collected while the executable waited in Discovered. Its days are
   *  unknown, so it only counts toward the total. */
  carriedSeconds?: number;
  /** Art picked on this PC. Wins over the shared art and stays here. */
  artUrl?: string;
};

/** Lowercase executable name → usage. */
export type ToolUsage = Record<string, ToolUsageRecord>;

export type RunningTool = {
  /** Identity of the tool; all executables of one tool share it. */
  toolKey: string;
  /** Lowercase executable name. */
  exeKey: string;
  exePath: string | null;
};

export type ToolUsageSummary = {
  todaySeconds: number;
  weekSeconds: number;
  totalSeconds: number;
};

/** A longer gap between two scans is not counted: the PC slept or the app
 *  froze, and a tool left open overnight must not collect those hours. */
export const MAX_TOOL_TICK_GAP_MS = 5 * 60 * 1000;

export function localDayKey(ms: number) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The interval [fromMs, toMs) cut at local midnights, as seconds per day. */
export function splitByLocalDay(fromMs: number, toMs: number) {
  const parts: Array<{ day: string; seconds: number }> = [];
  let start = fromMs;
  while (start < toMs) {
    const date = new Date(start);
    const nextMidnight = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    ).getTime();
    const end = Math.min(toMs, nextMidnight);
    parts.push({ day: localDayKey(start), seconds: (end - start) / 1000 });
    start = end;
  }
  return parts;
}

/**
 * Credits [fromMs, toMs) to every running tool. A tool with several running
 * executables is credited once, on its alphabetically first executable, so
 * the sum over a tool's executables never counts the same second twice.
 * Returns the same object when nothing changed.
 */
export function creditToolUsage(
  usage: ToolUsage,
  running: readonly RunningTool[],
  fromMs: number,
  toMs: number,
): ToolUsage {
  let next = usage;
  const edit = (exeKey: string) => {
    if (next === usage) next = { ...usage };
    const record = next[exeKey] ?? { days: {} };
    const copy = { ...record, days: { ...record.days } };
    next[exeKey] = copy;
    return copy;
  };

  for (const tool of running) {
    if (tool.exePath && usage[tool.exeKey]?.exePath !== tool.exePath) {
      edit(tool.exeKey).exePath = tool.exePath;
    }
  }

  const gap = toMs - fromMs;
  if (gap <= 0 || gap > MAX_TOOL_TICK_GAP_MS) return next;

  const creditedExeByTool = new Map<string, string>();
  for (const tool of running) {
    const current = creditedExeByTool.get(tool.toolKey);
    if (current === undefined || tool.exeKey < current) {
      creditedExeByTool.set(tool.toolKey, tool.exeKey);
    }
  }
  const parts = splitByLocalDay(fromMs, toMs);
  for (const exeKey of creditedExeByTool.values()) {
    const record = edit(exeKey);
    for (const { day, seconds } of parts) {
      record.days[day] = (record.days[day] ?? 0) + seconds;
    }
  }
  return next;
}

/** Adds finished stretches of time to one executable, split at local
 *  midnight: time counted as a game that turned out to be this software. */
export function addToolIntervals(
  usage: ToolUsage,
  exeKey: string,
  intervals: ReadonlyArray<{ fromMs: number; toMs: number }>,
): ToolUsage {
  let record: ToolUsageRecord | undefined;
  for (const { fromMs, toMs } of intervals) {
    if (!(toMs > fromMs)) continue;
    const current = usage[exeKey] ?? { days: {} };
    record ??= { ...current, days: { ...current.days } };
    for (const { day, seconds } of splitByLocalDay(fromMs, toMs)) {
      record.days[day] = (record.days[day] ?? 0) + seconds;
    }
  }
  return record ? { ...usage, [exeKey]: record } : usage;
}

/** Adds Discovered time to the total of an executable that became a tool. */
export function carryDiscoveredSeconds(
  usage: ToolUsage,
  exeKey: string,
  seconds: number,
): ToolUsage {
  if (!(seconds > 0)) return usage;
  const record = usage[exeKey] ?? { days: {} };
  return {
    ...usage,
    [exeKey]: {
      ...record,
      carriedSeconds: (record.carriedSeconds ?? 0) + seconds,
    },
  };
}

/** Sets (or with null clears) the art picked on this PC for every
 *  executable of one tool. */
export function withToolArt(
  usage: ToolUsage,
  exeKeys: readonly string[],
  artUrl: string | null,
): ToolUsage {
  const next = { ...usage };
  for (const exeKey of exeKeys) {
    const record = next[exeKey] ?? { days: {} };
    if (artUrl) {
      next[exeKey] = { ...record, artUrl };
    } else {
      const { artUrl: _artUrl, ...rest } = record;
      next[exeKey] = rest;
    }
  }
  return next;
}

/** Today, this week (Monday to Sunday, like My History) and all time. */
export function summarizeToolUsage(
  records: readonly (ToolUsageRecord | undefined)[],
  nowMs: number,
): ToolUsageSummary {
  const now = new Date(nowMs);
  const today = localDayKey(nowMs);
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = localDayKey(
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - mondayOffset,
    ).getTime(),
  );
  const summary: ToolUsageSummary = {
    todaySeconds: 0,
    weekSeconds: 0,
    totalSeconds: 0,
  };
  for (const record of records) {
    if (!record) continue;
    summary.totalSeconds += record.carriedSeconds ?? 0;
    for (const [day, seconds] of Object.entries(record.days)) {
      summary.totalSeconds += seconds;
      if (day === today) summary.todaySeconds += seconds;
      if (day >= monday && day <= today) summary.weekSeconds += seconds;
    }
  }
  return summary;
}

export type ToolUsageDetails = {
  /** First and last local day with counted time (YYYY-MM-DD). */
  firstDay: string | null;
  lastDay: string | null;
  daysUsed: number;
  /** Counted time per day the app ran; Discovered time has no days. */
  averagePerDaySeconds: number;
  longestDay: { day: string; seconds: number } | null;
};

/** Everything the per-day buckets already tell, across a tool's exes. */
export function describeToolUsage(
  records: readonly (ToolUsageRecord | undefined)[],
): ToolUsageDetails {
  const byDay = new Map<string, number>();
  for (const record of records) {
    for (const [day, seconds] of Object.entries(record?.days ?? {})) {
      byDay.set(day, (byDay.get(day) ?? 0) + seconds);
    }
  }
  const days = [...byDay.keys()].sort();
  let longestDay: ToolUsageDetails["longestDay"] = null;
  let countedSeconds = 0;
  for (const [day, seconds] of byDay) {
    countedSeconds += seconds;
    if (
      !longestDay ||
      seconds > longestDay.seconds ||
      (seconds === longestDay.seconds && day > longestDay.day)
    ) {
      longestDay = { day, seconds };
    }
  }
  return {
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
    daysUsed: days.length,
    averagePerDaySeconds: days.length > 0 ? countedSeconds / days.length : 0,
    longestDay,
  };
}

/** Drops malformed persisted or imported usage instead of failing hydration. */
export function sanitizeToolUsage(value: unknown): ToolUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const usage: ToolUsage = {};
  for (const [exeKey, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const input = raw as Record<string, unknown>;
    const days: Record<string, number> = {};
    if (input.days && typeof input.days === "object") {
      for (const [day, seconds] of Object.entries(input.days)) {
        if (
          /^\d{4}-\d{2}-\d{2}$/.test(day) &&
          typeof seconds === "number" &&
          Number.isFinite(seconds) &&
          seconds > 0
        ) {
          days[day] = seconds;
        }
      }
    }
    const record: ToolUsageRecord = { days };
    if (typeof input.exePath === "string" && input.exePath) {
      record.exePath = input.exePath;
    }
    if (typeof input.artUrl === "string" && input.artUrl) {
      record.artUrl = input.artUrl;
    }
    if (
      typeof input.carriedSeconds === "number" &&
      Number.isFinite(input.carriedSeconds) &&
      input.carriedSeconds > 0
    ) {
      record.carriedSeconds = input.carriedSeconds;
    }
    usage[exeKey.toLowerCase()] = record;
  }
  return usage;
}

/** Identity of a tool; every executable of one tool shares it. */
export function toolIdentityKey(entry: {
  source?: string | null;
  gameId?: number;
}) {
  return `${entry.source ?? "custom"}:${entry.gameId}`;
}
