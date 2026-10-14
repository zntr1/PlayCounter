import {
  basename,
  namedTitleIdSignal,
  namesAgree,
  stripQuotes,
} from "./signals";
import type {
  EmulatorAdapter,
  EmulatorDetectionSource,
  EmulatorLaunchDiscovery,
  EmulatorReadContext,
  RawEmulatorSignals,
} from "./types";
import { getT } from "../i18n";

const t = getT("emulators");

const SERIAL = /^[A-Z]{4}\d{5}$/i;
const PATH_SERIAL = /(?:^|[^A-Z0-9])([A-Z]{4}\d{5})(?![0-9])/gi;
// RPCS3's QCommandLineParser options that take a value (rpcs3/rpcs3.cpp).
const VALUE_OPTIONS = new Set([
  "--game-screen",
  "--style",
  "--stylesheet",
  "--config",
  "--input-config",
  "--installfw",
  "--installpkg",
  "--decrypt",
  "--user-id",
  "--savestate",
  "--last-savestate",
  "--rsx-capture",
]);

type Rpcs3Title = { idle: true } | { serial: string; name: string };

export function isRpcs3ContentFile(fileName: string) {
  return /^eboot\.bin$/i.test(fileName) || /\.(?:self|elf|iso)$/i.test(fileName);
}

/**
 * The game window's title follows "Window Title Format", by default
 * "FPS: %F | %R | %V | %T [%t]" (Emu/system_config.h), e.g.
 * "FPS: 59.94 | Vulkan | 0.0.38-18000 | Demon's Souls [BLUS30443]". The main
 * window is always "RPCS3 <version> | <branch>"; the scanner keeps the longest
 * title, which is the game window while a game runs. A custom format without
 * [%t] cannot be read.
 */
export function readRpcs3Title(title: string | null): Rpcs3Title | null {
  const trimmed = title?.trim() ?? "";
  const matches = [...trimmed.matchAll(/\[([A-Z]{4}\d{5})\]/gi)];
  const last = matches.at(-1);
  if (last?.index !== undefined) {
    const name = trimmed.slice(0, last.index).split(" | ").at(-1)!.trim();
    return { serial: last[1].toLowerCase(), name };
  }
  return /^RPCS3\s+\S/i.test(trimmed) ? { idle: true } : null;
}

function pathSerial(path: string) {
  const matches = [...stripQuotes(path).matchAll(PATH_SERIAL)];
  return matches.at(-1)?.[1].toLowerCase() ?? null;
}

/** EBOOT.BIN sits in <game>/PS3_GAME/USRDIR or dev_hdd0/game/<serial>/USRDIR. */
function pathGameName(path: string) {
  const parts = stripQuotes(path).split(/[\\/]/).filter(Boolean);
  if (/\.iso$/i.test(parts.at(-1) ?? "")) return parts.at(-1) ?? "";
  parts.pop();
  while (parts.length > 0 && /^(?:usrdir|ps3_game)$/i.test(parts.at(-1)!)) {
    parts.pop();
  }
  return parts.at(-1) ?? "";
}

function pathMatches(path: string, serial: string, name: string) {
  const fromPath = pathSerial(path);
  return fromPath ? fromPath === serial : namesAgree(name, pathGameName(path));
}

function gameArgument(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    if (arg.startsWith("-")) {
      if (VALUE_OPTIONS.has(arg.toLowerCase())) index += 1;
      continue;
    }
    // The first positional argument is the boot path; the rest go to the game.
    return isRpcs3ContentFile(basename(arg)) ? arg : null;
  }
  return null;
}

/** A start-up file counts only while the game window shows the same game. */
export function discoverRpcs3LaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = gameArgument(signals.args);
  const title = readRpcs3Title(signals.windowTitle);
  if (!filePath || !title || "idle" in title) return null;
  return pathMatches(filePath, title.serial, title.name)
    ? { target: { kind: "file", filePath }, source: "launch_arguments" }
    : null;
}

function serialSignal(
  serial: string,
  name: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
) {
  return namedTitleIdSignal({
    titleId: serial,
    name: name || serial.toUpperCase(),
    local: false,
    privateTokens: context.privateTokens,
    detectionSource,
  });
}

export const rpcs3Adapter: EmulatorAdapter = {
  id: "rpcs3",
  label: "RPCS3",
  platformLabel: "PlayStation 3",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("PlayStation 3 games, mappings, and emulator playtime");
  },
  exeNames: ["rpcs3.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["bin", "self", "elf", "iso"],
    isValidContentFile: isRpcs3ContentFile,
    // Only a path with a serial names the game; "EBOOT.BIN" alone does not.
    identifyTarget: (target, context) => {
      const serial = pathSerial(target.filePath);
      return serial && SERIAL.test(serial)
        ? serialSignal(serial, "", context, "launch_arguments")
        : null;
    },
    discoverTarget: discoverRpcs3LaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      if (!isRpcs3ContentFile(basename(target.filePath))) {
        return { valid: false, reason: "unsupported-content-file" };
      }
      return pathMatches(target.filePath, mapping.contentValue, mapping.display)
        ? { valid: true, association: "proven" }
        : { valid: true, association: "requires_confirmation" };
    },
  },
  read(signals, context) {
    if (!signals.windowTitle?.trim()) return { state: "idle" };
    const title = readRpcs3Title(signals.windowTitle);
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if ("idle" in title) return { state: "idle" };
    return {
      state: "content",
      content: serialSignal(title.serial, title.name, context, "window_title"),
    };
  },
};
