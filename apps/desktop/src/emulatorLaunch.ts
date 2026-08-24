import type { EmulatorMapping } from "./emulators/types";
import { adapterFor } from "./emulators/registry";
import {
  isAbsoluteWindowsPath,
  launchErrorKind,
  launchFileBaseName,
  type LaunchErrorKind,
  type LaunchPathStatus,
} from "./gameLaunch";

export type EmulatorBinaryEntry = {
  emulatorId: string;
  exePath: string;
  setAt: string;
};

export type EmulatorLaunchTarget = {
  contentKey: string;
  emulatorId: string;
  filePath: string;
  setAt: string;
};

export type EmulatorLaunchCandidate = EmulatorLaunchTarget & {
  displayName: string;
};

export type EmulatorLaunchOutcome =
  | { kind: "spawned" }
  | { kind: "hostRunning"; instanceCount: number }
  | { kind: "busy" };

export function resolveEmulatorBinary(
  emulatorId: string,
  auto: ReadonlyMap<string, EmulatorBinaryEntry>,
  manual: ReadonlyMap<string, EmulatorBinaryEntry>,
) {
  return manual.get(emulatorId) ?? auto.get(emulatorId);
}

export function resolveEmulatorLaunchTarget(
  contentKey: string,
  auto: ReadonlyMap<string, EmulatorLaunchTarget>,
  manual: ReadonlyMap<string, EmulatorLaunchTarget>,
) {
  return manual.get(contentKey) ?? auto.get(contentKey);
}

export function isValidEmulatorBinaryPath(
  emulatorId: string,
  path: string | null | undefined,
): path is string {
  if (!isAbsoluteWindowsPath(path)) return false;
  const baseName = launchFileBaseName(path).toLowerCase();
  if (!baseName.endsWith(".exe")) return false;
  if (emulatorId === "dolphin") return baseName === "dolphin.exe";
  return false;
}

export function isValidEmulatorContentPath(
  emulatorId: string,
  path: string | null | undefined,
): path is string {
  if (!isAbsoluteWindowsPath(path)) return false;
  return adapterFor(emulatorId)?.launch?.isValidContentFile(
    launchFileBaseName(path),
  ) === true;
}

export function emulatorTargetCompatibility(
  mapping: EmulatorMapping,
  filePath: string,
) {
  const adapter = adapterFor(mapping.emulatorId);
  if (!adapter?.launch || !isValidEmulatorContentPath(mapping.emulatorId, filePath)) {
    return { valid: false, reason: "unsupported-content-file" } as const;
  }
  return adapter.launch.validateTargetForMapping(mapping, {
    kind: "file",
    filePath,
  });
}

export function shouldForgetEmulatorPath(status: LaunchPathStatus) {
  return status === "missing" || status === "notAFile" || status === "invalid";
}

export function shouldForgetEmulatorOnLaunchError(error: unknown) {
  const kind = launchErrorKind(error);
  return kind === "notFound" || kind === "notAFile" || kind === "invalidPath";
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

export function emulatorLaunchErrorMessage(error: unknown, gameName: string) {
  const detail = errorDetail(error);
  const kind: LaunchErrorKind | null = launchErrorKind(error);
  switch (kind) {
    case "notFound":
      return { title: "Launch file not found", detail: `${detail} Set it again.` };
    case "notAFile":
      return { title: "That is not a file", detail: `${detail} Set it again.` };
    case "unreadable":
      return { title: "Cannot read the launch file", detail };
    case "invalidPath":
      return {
        title: "Launch file is not valid",
        detail: "Choose a supported emulator or content file with a full Windows path.",
      };
    case "unsupported":
      return { title: "Emulator launching is unavailable", detail };
    default:
      return { title: `${gameName} could not be started`, detail };
  }
}
