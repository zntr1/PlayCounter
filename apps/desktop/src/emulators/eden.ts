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

const CONTENT_EXTENSION = /\.(?:nsp|xci|nca|nro|nso)$/i;
// getopt options that take a value (src/core/launch_params.cpp).
const VALUE_OPTIONS = new Set([
  "-c",
  "--config",
  "-m",
  "--multiplayer",
  "-u",
  "--user",
]);

type EdenTitle = { idle: true } | { name: string };

/**
 * MainWindow::UpdateWindowTitle: "Eden | <version> | <compiler>" while idle,
 * "Eden | <version> | <compiler> | <name> (64-bit) | <game version> | <GPU>"
 * while a game runs. The name comes from the game's metadata (the file name
 * when it has none); "(64-bit)" is translated and the game version is
 * optional. Nightly builds say "Eden Nightly".
 */
export function readEdenTitle(title: string | null): EdenTitle | null {
  const segments = (title?.trim() ?? "").split(" | ");
  if (!/^Eden(?: Nightly)?$/i.test(segments[0] ?? "")) return null;
  if (segments.length === 3) return { idle: true };
  if (segments.length < 5) return null;
  const middle = segments.slice(3, -1);
  if (middle.length > 1 && /^v?\d[\w.+-]*$/i.test(middle.at(-1)!)) {
    middle.pop();
  }
  const name = middle
    .join(" | ")
    .replace(/\s*\([^()]*(?:32|64)[^()]*\)$/, "")
    .replace(CONTENT_EXTENSION, "")
    .trim();
  return name ? { name } : null;
}

function gameArgument(args: string[]) {
  let path: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    const lower = arg.toLowerCase();
    if (lower === "-g" || lower === "--game") {
      path = stripQuotes(args[index + 1] ?? "");
      index += 1;
    } else if (lower.startsWith("--game=")) {
      path = stripQuotes(arg.slice("--game=".length));
    } else if (VALUE_OPTIONS.has(lower)) {
      index += 1;
    } else if (!arg.startsWith("-")) {
      path = arg;
    }
  }
  return path && CONTENT_EXTENSION.test(basename(path)) ? path : null;
}

/** A start-up file counts only while the title shows a game of that name. */
export function discoverEdenLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = gameArgument(signals.args);
  const title = readEdenTitle(signals.windowTitle);
  if (!filePath || !title || "idle" in title) return null;
  return namesAgree(title.name, basename(filePath))
    ? { target: { kind: "file", filePath }, source: "launch_arguments" }
    : null;
}

/**
 * The API rejects ":" and "/" in identities, which Switch names often have
 * ("Zelda: Tears of the Kingdom"); the full name stays the search hint.
 */
function nameIdentity(name: string) {
  return normalizeToken(name.replace(/[:\\/]+/g, " "), "rom");
}

function nameSignal(
  name: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal | null {
  const value = nameIdentity(name);
  if (!value) return null;
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

export const edenAdapter: EmulatorAdapter = {
  id: "eden",
  label: "Eden",
  platformLabel: "Nintendo Switch",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("Nintendo Switch games, mappings, and emulator playtime");
  },
  exeNames: ["eden.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["nsp", "xci", "nca", "nro", "nso"],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    // A file name is not the game name Eden shows, so it is no identity.
    identifyTarget: () => null,
    discoverTarget: discoverEdenLaunchTarget,
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
    const title = readEdenTitle(signals.windowTitle);
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if ("idle" in title) return { state: "idle" };
    const content = nameSignal(title.name, context, "window_title");
    return content
      ? { state: "content", content }
      : { state: "unidentified", reason: "title-not-parsable" };
  },
};
