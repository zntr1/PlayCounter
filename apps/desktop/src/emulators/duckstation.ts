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
import { getT } from "../i18n";

const t = getT("emulators");

/** Files DuckStation keeps open while a disc runs (track files, CHD, PBP). */
const DISC_FILE = /\.(?:bin|img|iso|chd|pbp|ecm|mdf)$/i;
/** Files a user can start a game with; .cue/.mds/.ccd/.m3u point at disc files. */
const LAUNCH_FILE = /\.(?:cue|bin|img|iso|chd|pbp|ecm|mds|ccd|m3u)$/i;
// Options that take a value (duckstation-qt/qthost.cpp).
const VALUE_OPTIONS = new Set(["-state", "-statefile", "-exe"]);

function isDiscFile(raw: string, extension: RegExp) {
  const name = basename(raw);
  // BIOS images, caches and other files in the user directory can be .bin.
  return (
    extension.test(name) &&
    !/(?:^|[\\/])(?:bios|memcards|savestates|cache|shaders|textures|dump)(?:[\\/]|$)/i.test(
      raw,
    ) &&
    !/^(?:scph[-_ ]?\d|ps[x1]?[-_ ]?bios|bios(?:[._ -]|$)|ps-\d)/i.test(name) &&
    !/^(?:d3d\d*|vulkan|opengl|metal)[_-]/i.test(name)
  );
}

/**
 * One identity per game: no extension, track or disc number, so the .cue,
 * its .bin tracks, a .chd and every disc share one key.
 */
function fileIdentity(fileName: string) {
  const name = fileName
    .replace(LAUNCH_FILE, "")
    .replace(/\s*\((?:Track|Disc|Disk) \d+(?: of \d+)?\)/gi, "")
    .trim();
  const value = normalizeToken(name, "rom");
  return value && value.length >= 2 ? value : null;
}

function launchArgument(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    if (arg === "--") {
      const path = args[index + 1] ? stripQuotes(args[index + 1]) : "";
      return isDiscFile(path, LAUNCH_FILE) ? path : null;
    }
    if (arg.startsWith("-")) {
      if (VALUE_OPTIONS.has(arg)) index += 1;
      continue;
    }
    return isDiscFile(arg, LAUNCH_FILE) ? arg : null;
  }
  return null;
}

export function isDuckStationIdleTitle(title: string | null) {
  return /^DuckStation \S+(?: \[[^\]]*\])?$/i.test(title?.trim() ?? "");
}

/**
 * Current disc handles win over start-up arguments, which go stale when the
 * user starts another game. A successful empty scan means no game runs.
 */
export function discoverDuckStationLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "openFiles" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const argument = launchArgument(signals.args);
  if (signals.openFiles !== undefined) {
    const files = signals.openFiles
      .filter((path) => isDiscFile(path, DISC_FILE))
      .sort((a, b) => a.localeCompare(b));
    const identities = new Set(files.map((path) => fileIdentity(basename(path))));
    if (files.length === 0 || identities.size !== 1) return null;
    // Prefer the .cue or .m3u the game was started with over a track file.
    if (argument && fileIdentity(basename(argument)) === [...identities][0]) {
      return {
        target: { kind: "file", filePath: argument },
        source: "launch_arguments",
      };
    }
    return {
      target: { kind: "file", filePath: files[0] },
      source: "open_file_handle",
    };
  }
  if (isDuckStationIdleTitle(signals.windowTitle) || !argument) return null;
  return { target: { kind: "file", filePath: argument }, source: "launch_arguments" };
}

function identifyFile(
  path: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal | null {
  const fileName = basename(path).normalize("NFKC");
  if (!isDiscFile(path, LAUNCH_FILE) || /[\u0000-\u001f\u007f]/.test(fileName)) {
    return null;
  }
  const value = fileIdentity(fileName);
  if (!value || context.denylist.has(value)) return null;
  return {
    kind: "rom",
    value,
    display: fileName,
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
    volatile: detectionSource === "open_file_handle",
    detectionSource,
  };
}

export const duckstationAdapter: EmulatorAdapter = {
  id: "duckstation",
  label: "DuckStation",
  platformLabel: "PlayStation",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("PlayStation games, mappings, and emulator playtime");
  },
  exeNames: [
    "duckstation-qt-x64-releaseltcg.exe",
    "duckstation-qt-x64-releaseltcg-sse2.exe",
    "duckstation-qt-arm64-releaseltcg.exe",
  ],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["cue", "bin", "img", "iso", "chd", "pbp", "ecm", "mds", "ccd", "m3u"],
    isValidContentFile: (fileName) => isDiscFile(fileName, LAUNCH_FILE),
    identifyTarget: (target, context) =>
      identifyFile(target.filePath, context, "launch_arguments"),
    discoverTarget: discoverDuckStationLaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      const value = fileIdentity(basename(target.filePath).normalize("NFKC"));
      return value && value === mapping.contentValue
        ? { valid: true, association: "proven" }
        : { valid: false, reason: "content-name-mismatch" };
    },
  },
  read(signals, context) {
    const discovery = discoverDuckStationLaunchTarget(signals);
    const content =
      discovery &&
      identifyFile(discovery.target.filePath, context, discovery.source);
    if (content) return { state: "content", content };
    // The window title is only the game's name (customizable), never an
    // identity. Readable handles without a disc mean no game runs.
    if (signals.openFiles !== undefined) {
      const discFiles = signals.openFiles.filter((path) => isDiscFile(path, DISC_FILE));
      return discFiles.length === 0
        ? { state: "idle" }
        : { state: "unidentified", reason: "no-signal" };
    }
    if (isDuckStationIdleTitle(signals.windowTitle)) return { state: "idle" };
    return {
      state: "unidentified",
      reason: signals.windowTitle ? "title-not-parsable" : "no-signal",
    };
  },
};
