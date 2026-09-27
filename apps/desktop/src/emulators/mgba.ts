import {
  basename,
  isShareableToken,
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

const CONTENT_EXTENSION = /\.(?:gba|gbc|gb|sgb|zip|7z)$/i;
// mGBA's getopt options that take a value (src/feature/commandline.c).
const VALUE_OPTIONS = new Set([
  "-b",
  "--bios",
  "-c",
  "--cheats",
  "-C",
  "--config",
  "-l",
  "--log-level",
  "-p",
  "--patch",
  "-s",
  "--frameskip",
  "-t",
  "--savestate",
]);

type MgbaTitle = { idle: true } | { game: string };

/**
 * Qt window title (Window::updateTitle): "mGBA - <version>" while idle,
 * "mGBA - <game> (<fps> fps) - <version>" while a game runs. <game> is the
 * file name, mGBA's No-Intro database name, or the ROM header title, and is
 * not user-editable. Null when the title is not in that format (SDL frontend).
 */
export function readMgbaTitle(title: string | null): MgbaTitle | null {
  const trimmed = title?.trim() ?? "";
  if (/^mGBA - \S+$/i.test(trimmed)) return { idle: true };
  const match = /^mGBA - (.+) - \S+$/i.exec(trimmed);
  if (!match) return null;
  const game = match[1]
    .replace(/\s\(\d+(?:[.,]\d+)?\s*[\p{L}/]+\)$/u, "")
    .replace(/\s-\s+Player \d+ of \d+$/i, "")
    .trim();
  return game ? { game } : null;
}

function launchArgument(args: string[]) {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    if (arg.startsWith("-") && arg.length > 1) {
      if (VALUE_OPTIONS.has(arg)) index += 1;
      continue;
    }
    positional.push(arg);
  }
  // mGBA only loads a game when exactly one positional argument is left.
  return positional.length === 1 &&
    CONTENT_EXTENSION.test(basename(positional[0]))
    ? positional[0]
    : null;
}

function comparable(value: string) {
  return basename(value)
    .replace(CONTENT_EXTENSION, "")
    .replace(/[[(][^()[\]]*[\])]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** "pokemonfire" (header) fits "pokemonfirered" (file) fits "pokemonfireredversion" (database). */
function namesAgree(game: string, filePath: string) {
  const a = comparable(game);
  const b = comparable(filePath);
  return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
}

/**
 * Start-up arguments go stale when another ROM is loaded from the menu, so the
 * file only counts while the title still agrees with it.
 */
export function discoverMgbaLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = launchArgument(signals.args);
  if (!filePath) return null;
  const title = readMgbaTitle(signals.windowTitle);
  if (title && ("idle" in title || !namesAgree(title.game, filePath))) {
    return null;
  }
  return { target: { kind: "file", filePath }, source: "launch_arguments" };
}

function signal(
  value: string,
  display: string,
  searchHint: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal {
  return {
    kind: "rom",
    value,
    display,
    trust: "recognized",
    // The API only accepts values that start with a letter or digit.
    shareable:
      /^[\p{L}\p{N}]/u.test(value) &&
      isShareableToken({
        value,
        kind: "rom",
        trust: "recognized",
        privateTokens: context.privateTokens,
      }),
    volatile: detectionSource === "window_title",
    detectionSource,
    searchHint,
  };
}

/**
 * Without the extension, so a No-Intro-named file has the same identity as
 * mGBA's database title for it.
 */
function fileIdentity(fileName: string) {
  const value = normalizeToken(fileName, "rom")?.replace(CONTENT_EXTENSION, "");
  return value && value.length >= 2 ? value : null;
}

function identifyFile(
  path: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
) {
  const fileName = basename(path);
  if (!CONTENT_EXTENSION.test(fileName)) return null;
  const value = fileIdentity(fileName);
  return value
    ? signal(
        value,
        fileName,
        fileName.replace(CONTENT_EXTENSION, ""),
        context,
        detectionSource,
      )
    : null;
}

function identifyTitle(game: string, context: EmulatorReadContext) {
  // "Show filename in title" gives the same identity as the file itself.
  if (CONTENT_EXTENSION.test(game)) {
    return identifyFile(game, context, "window_title");
  }
  const value = normalizeToken(game, "rom");
  return value ? signal(value, game, game, context, "window_title") : null;
}

export const mgbaAdapter: EmulatorAdapter = {
  id: "mgba",
  label: "mGBA",
  platformLabel: "Game Boy / GBA",
  subtitle:
    "Game Boy and Game Boy Advance games, mappings, and emulator playtime",
  exeNames: ["mgba.exe", "mgba-sdl.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["gba", "gb", "gbc", "sgb", "zip", "7z"],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    identifyTarget: (target, context) =>
      identifyFile(target.filePath, context, "launch_arguments"),
    discoverTarget: discoverMgbaLaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      if (!CONTENT_EXTENSION.test(basename(target.filePath))) {
        return { valid: false, reason: "unsupported-content-file" };
      }
      return fileIdentity(basename(target.filePath)) === mapping.contentValue ||
        namesAgree(mapping.contentValue, target.filePath)
        ? { valid: true, association: "proven" }
        : { valid: true, association: "requires_confirmation" };
    },
  },
  read(signals, context) {
    const title = readMgbaTitle(signals.windowTitle);
    // The title is always current, so an idle title wins over stale arguments.
    // With mGBA's dynamic title turned off it always reads idle.
    if (title && "idle" in title) return { state: "idle" };
    const fromTitle = title ? identifyTitle(title.game, context) : null;
    if (fromTitle) return { state: "content", content: fromTitle };
    if (signals.exeName.toLowerCase() !== "mgba-sdl.exe") {
      // Qt: only the title is current. Until the window has one (right after
      // start-up) the start-up file would add a second identity for the ROM.
      return title
        ? { state: "unidentified", reason: "title-not-parsable" }
        : { state: "idle" };
    }
    // SDL frontend: the start-up file is the only signal.
    const discovery = discoverMgbaLaunchTarget(signals);
    const content =
      discovery &&
      identifyFile(discovery.target.filePath, context, "launch_arguments");
    if (content) return { state: "content", content };
    return {
      state: "unidentified",
      reason: signals.windowTitle ? "title-not-parsable" : "no-signal",
    };
  },
};
