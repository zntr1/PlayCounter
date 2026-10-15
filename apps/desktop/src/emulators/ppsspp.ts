import {
  basename,
  namedTitleIdSignal,
  namesAgree,
  normalizeToken,
  stripQuotes,
} from "./signals";
import type {
  EmulatorAdapter,
  EmulatorContentSignal,
  EmulatorDetectionSource,
  EmulatorLaunchDiscovery,
  EmulatorReadContext,
  RawEmulatorSignals,
} from "./types";
import { getT } from "../i18n";

const t = getT("emulators");

const CONTENT_EXTENSION = /\.(?:iso|cso|chd|pbp|elf|prx)$/i;
const FILE_SERIAL = /(?:^|[^A-Z0-9])([A-Z]{4})[-_ ]?(\d{5})(?![0-9])/i;

type PpssppTitle =
  | { idle: true }
  | { discId: string | null; name: string };

/**
 * Windows title (Windows/main.cpp, SET_WINDOW_TITLE):
 * "PPSSPP <version>" while idle, "PPSSPP <version> - <DISC_ID> : <title>"
 * while a game runs (Core/System.cpp; the title comes from PARAM.SFO).
 * "Gold", " (debug)" and " (instance: N)" are optional.
 */
export function readPpssppTitle(title: string | null): PpssppTitle | null {
  const trimmed = (title?.trim() ?? "")
    .replace(/ \(instance: \d+\)$/, "")
    .replace(/ \(debug\)$/, "");
  const match = /^PPSSPP (?:Gold )?\S+(?: - (.*))?$/i.exec(trimmed);
  if (!match) return null;
  const game = match[1]?.trim();
  if (!game) return { idle: true };
  const withId = /^([A-Z]{4}\d{5}) : (.*)$/i.exec(game);
  return withId
    ? { discId: withId[1].toLowerCase(), name: withId[2].trim() }
    : { discId: null, name: game };
}

function fileSerial(path: string) {
  const match = FILE_SERIAL.exec(basename(path));
  return match ? `${match[1]}${match[2]}`.toLowerCase() : null;
}

function pathMatches(path: string, discId: string | null, name: string) {
  const fromPath = fileSerial(path);
  return fromPath && discId
    ? fromPath === discId
    : namesAgree(name, basename(path));
}

function gameArgument(args: string[]) {
  // PPSSPP boots the first argument that is not an option.
  const arg = args.map(stripQuotes).find((value) => !value.startsWith("-"));
  return arg && CONTENT_EXTENSION.test(basename(arg)) ? arg : null;
}

/** A start-up file counts only while the title shows the same game. */
export function discoverPpssppLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = gameArgument(signals.args);
  const title = readPpssppTitle(signals.windowTitle);
  if (!filePath || !title || "idle" in title) return null;
  return pathMatches(filePath, title.discId, title.name)
    ? { target: { kind: "file", filePath }, source: "launch_arguments" }
    : null;
}

function nameSignal(
  name: string,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal | null {
  // Homebrew without a DISC_ID: the name is the only signal and stays local.
  const value = normalizeToken(name, "rom");
  return value
    ? {
        kind: "rom",
        value,
        display: name,
        trust: "weak",
        shareable: false,
        volatile: detectionSource === "window_title",
        detectionSource,
      }
    : null;
}

function discSignal(
  discId: string,
  name: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
) {
  return namedTitleIdSignal({
    titleId: discId,
    name: name || discId.toUpperCase(),
    local: false,
    privateTokens: context.privateTokens,
    detectionSource,
  });
}

export const ppssppAdapter: EmulatorAdapter = {
  id: "ppsspp",
  label: "PPSSPP",
  platformLabel: "PSP",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("PSP games, mappings, and emulator playtime");
  },
  exeNames: ["ppssppwindows64.exe", "ppssppwindows.exe", "ppssppwindowsarm64.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["iso", "cso", "chd", "pbp", "elf", "prx"],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    identifyTarget: (target, context) => {
      const serial = fileSerial(target.filePath);
      return serial
        ? discSignal(serial, "", context, "launch_arguments")
        : null;
    },
    discoverTarget: discoverPpssppLaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      if (!CONTENT_EXTENSION.test(basename(target.filePath))) {
        return { valid: false, reason: "unsupported-content-file" };
      }
      const discId = mapping.contentKind === "title_id" ? mapping.contentValue : null;
      return pathMatches(target.filePath, discId, mapping.display)
        ? { valid: true, association: "proven" }
        : { valid: true, association: "requires_confirmation" };
    },
  },
  read(signals, context) {
    if (!signals.windowTitle?.trim()) return { state: "idle" };
    const title = readPpssppTitle(signals.windowTitle);
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if ("idle" in title) return { state: "idle" };
    const content = title.discId
      ? discSignal(title.discId, title.name, context, "window_title")
      : nameSignal(title.name, "window_title");
    return content
      ? { state: "content", content }
      : { state: "unidentified", reason: "title-not-parsable" };
  },
};
