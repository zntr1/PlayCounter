import {
  basename,
  isShareableHint,
  isShareableToken,
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

// GameList::supported_file_extensions (citra_qt/game_list.cpp).
const CONTENT_EXTENSION =
  /\.(?:3ds|cci|cxi|3dsx|app|elf|axf|z3dsx|zcci|zcxi|bcci)$/i;
// Options that take a value (GMainWindow's constructor in citra_qt.cpp).
const VALUE_OPTIONS = new Set([
  "-d",
  "--dump-video",
  "-g",
  "--gdbport",
  "-i",
  "--install",
  "-p",
  "--movie-play",
  "-r",
  "--movie-record",
  "-a",
  "--movie-record-author",
  "-m",
  "--multiplayer",
]);

type AzaharTitle = { idle: true } | { name: string };

/**
 * GMainWindow::UpdateWindowTitle: "Azahar <version>" while idle,
 * "Azahar <version> | <name>" while a game runs. With separate windows the
 * game windows add " | Primary Window" or " | Secondary Window" in the UI
 * language, and the scanner keeps that longer title. The name is the game's
 * English short title, whatever language the user runs Azahar in; a game
 * without one shows the idle title.
 */
export function readAzaharTitle(title: string | null): AzaharTitle | null {
  const segments = (title?.trim() ?? "").split(" | ");
  if (!/^Azahar \S+$/i.test(segments[0] ?? "")) return null;
  if (segments.length === 1) return { idle: true };
  const name = segments
    .slice(1, segments.length > 2 ? -1 : undefined)
    .join(" | ")
    .trim();
  return name ? { name } : null;
}

/** Azahar boots the last argument when it is not an option or its value. */
function gameArgument(args: string[]) {
  let path: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    if (VALUE_OPTIONS.has(arg.toLowerCase())) {
      index += 1;
      path = null;
    } else {
      path = arg.startsWith("-") ? null : arg;
    }
  }
  return path && CONTENT_EXTENSION.test(basename(path)) ? path : null;
}

/** A start-up file counts only while the title shows a game of that name. */
export function discoverAzaharLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = gameArgument(signals.args);
  const title = readAzaharTitle(signals.windowTitle);
  if (!filePath || !title || "idle" in title) return null;
  return namesAgree(title.name, basename(filePath))
    ? { target: { kind: "file", filePath }, source: "launch_arguments" }
    : null;
}

/** The API rejects ":" and "/" in identities; the full name stays the hint. */
function nameIdentity(name: string) {
  return normalizeToken(name.replace(/[:\\/]+/g, " "), "rom");
}

function nameSignal(
  name: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal | null {
  const value = nameIdentity(name);
  if (!value || context.denylist.has(value)) return null;
  const shareable =
    /^[\p{L}\p{N}]/u.test(value) &&
    isShareableToken({
      value,
      kind: "rom",
      trust: "recognized",
      privateTokens: context.privateTokens,
    });
  return {
    kind: "rom",
    value,
    display: name,
    trust: "recognized",
    shareable,
    volatile: detectionSource === "window_title",
    detectionSource,
    searchHint: name,
    shareableSearchHint:
      shareable && isShareableHint(name, context.privateTokens),
  };
}

export const azaharAdapter: EmulatorAdapter = {
  id: "azahar",
  label: "Azahar",
  platformLabel: "Nintendo 3DS",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("Nintendo 3DS games, mappings, and emulator playtime");
  },
  exeNames: ["azahar.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: [
      "3ds",
      "cci",
      "cxi",
      "3dsx",
      "app",
      "elf",
      "axf",
      "z3dsx",
      "zcci",
      "zcxi",
      "bcci",
    ],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    // A file name is not the game name Azahar shows, so it is no identity.
    identifyTarget: () => null,
    discoverTarget: discoverAzaharLaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      if (!CONTENT_EXTENSION.test(basename(target.filePath))) {
        return { valid: false, reason: "unsupported-content-file" };
      }
      return namesAgree(mapping.display, basename(target.filePath))
        ? { valid: true, association: "proven" }
        : { valid: true, association: "requires_confirmation" };
    },
  },
  read(signals, context) {
    if (!signals.windowTitle?.trim()) return { state: "idle" };
    const title = readAzaharTitle(signals.windowTitle);
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if ("idle" in title) return { state: "idle" };
    const content = nameSignal(title.name, context, "window_title");
    return content
      ? { state: "content", content }
      : { state: "unidentified", reason: "title-not-parsable" };
  },
};
