import type { GameSource } from "@playcounter/shared";

export type LaunchOwner = {
  gameId: number;
  source: GameSource | null;
};

export type LaunchTargetLike = {
  exeName: string;
  path: string;
  owner: LaunchOwner;
};

export type MatchedExeLike = {
  state: string;
  gameId?: number;
  source?: GameSource;
};

export type LaunchErrorKind =
  | "invalidPath"
  | "notAFile"
  | "notFound"
  | "unreadable"
  | "unsupported"
  | "spawnFailed";

export type LaunchPathStatus =
  | "ok"
  | "missing"
  | "notAFile"
  | "unreadable"
  | "invalid";

export type LaunchPathReport = {
  path: string;
  status: LaunchPathStatus;
};

export type LaunchOutcome = "launched" | "busy";

const launchErrorKinds = new Set<LaunchErrorKind>([
  "invalidPath",
  "notAFile",
  "notFound",
  "unreadable",
  "unsupported",
  "spawnFailed",
]);

export function launchFileBaseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function isWindowsExecutablePath(
  path: string | null | undefined,
): path is string {
  if (typeof path !== "string") return false;
  const value = path.trim();
  if (!value || value.includes("\0")) return false;
  const segments = value.split(/[\\/]/);
  if (segments.includes("..")) return false;
  const baseName = launchFileBaseName(value);
  if (!baseName || baseName.toLowerCase() === ".exe") return false;
  if (!baseName.toLowerCase().endsWith(".exe")) return false;
  return (
    /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+[\\/]/.test(value)
  );
}

export function isVolatileLaunchPath(path: string) {
  if (!isWindowsExecutablePath(path)) return false;
  return path
    .replaceAll("/", "\\")
    .split("\\")
    .some((segment) => /^(temp|tmp)$/i.test(segment));
}

export function shouldForgetLaunchTarget(status: LaunchPathStatus) {
  return status === "missing" || status === "notAFile" || status === "invalid";
}

export function shouldForgetOnLaunchError(kind: LaunchErrorKind | null) {
  return kind === "notFound" || kind === "notAFile" || kind === "invalidPath";
}

export function matchesTrackedExeName(
  path: string,
  exeNames: readonly string[],
) {
  const baseName = launchFileBaseName(path).toLowerCase();
  return exeNames.some((exeName) => exeName.toLowerCase() === baseName);
}

export function manualLaunchTargetKey(owner: LaunchOwner) {
  return `${owner.gameId}:${owner.source ?? "null"}`;
}

export function findManualLaunchTarget(
  aliases: readonly LaunchOwner[],
  manualLaunchTargets: ReadonlyMap<string, LaunchTargetLike>,
) {
  for (const alias of aliases) {
    const target = manualLaunchTargets.get(manualLaunchTargetKey(alias));
    if (target) return target;
  }
  return undefined;
}

export function resolveLaunchOwner(
  exeKey: string,
  target: LaunchTargetLike,
  exeCache: ReadonlyMap<string, MatchedExeLike>,
): LaunchOwner {
  const cached = exeCache.get(exeKey.toLowerCase());
  if (cached?.state === "matched" && cached.gameId !== undefined) {
    return { gameId: cached.gameId, source: cached.source ?? null };
  }
  return target.owner;
}

function sameOwner(left: LaunchOwner, right: LaunchOwner) {
  return left.gameId === right.gameId && left.source === right.source;
}

export function launchTargetsForGame(params: {
  exeNames: readonly string[];
  aliases: readonly LaunchOwner[];
  launchTargets: ReadonlyMap<string, LaunchTargetLike>;
  exeCache: ReadonlyMap<string, MatchedExeLike>;
}) {
  const result: LaunchTargetLike[] = [];
  const seen = new Set<string>();
  for (const exeName of params.exeNames) {
    const key = exeName.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const target = params.launchTargets.get(key);
    if (
      !target ||
      target.exeName.toLowerCase() !== key ||
      !isWindowsExecutablePath(target.path)
    ) {
      continue;
    }
    const owner = resolveLaunchOwner(key, target, params.exeCache);
    if (!params.aliases.some((alias) => sameOwner(alias, owner))) continue;
    result.push(target);
  }
  return result;
}

export function primaryLaunchTarget(
  params: Parameters<typeof launchTargetsForGame>[0],
) {
  return launchTargetsForGame(params)[0];
}

export function launchErrorKind(error: unknown): LaunchErrorKind | null {
  if (typeof error === "string") {
    try {
      return launchErrorKind(JSON.parse(error));
    } catch {
      return null;
    }
  }
  if (!error || typeof error !== "object") return null;
  const kind = (error as { kind?: unknown }).kind;
  return typeof kind === "string" &&
    launchErrorKinds.has(kind as LaunchErrorKind)
    ? (kind as LaunchErrorKind)
    : null;
}

function errorDetail(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") {
    try {
      return errorDetail(JSON.parse(error));
    } catch {
      return error;
    }
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The operating system did not provide more details.";
}

export function launchErrorMessage(error: unknown, gameName: string) {
  const detail = errorDetail(error);
  switch (launchErrorKind(error)) {
    case "notFound":
      return {
        title: "Game file not found",
        detail: `${detail} Start the game once, or set the launch file again.`,
      };
    case "notAFile":
      return {
        title: "That is not a program",
        detail: `${detail} Set the launch file again.`,
      };
    case "unreadable":
      return {
        title: "Cannot open the game file",
        detail: `${detail} Check that the drive is connected.`,
      };
    case "invalidPath":
      return {
        title: "Launch file is not valid",
        detail: "PlayCounter can only start .exe files with a full path.",
      };
    case "unsupported":
      return {
        title: "Only available on Windows",
        detail: "Starting games from the library works on Windows.",
      };
    case "spawnFailed":
      return {
        title: `${gameName} could not be started`,
        detail,
      };
    default:
      return { title: `${gameName} could not be started`, detail };
  }
}
