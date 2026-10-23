import { basename, isShareableToken, normalizeToken } from "./signals";
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

// NdsRomExtensions in Window.cpp, each also Zstandard-compressed.
const CONTENT_EXTENSION = /\.(?:nds|srl|dsi|ids)(?:\.zst)?$/i;

/**
 * EmuThread: "[<fps>/<target fps>] melonDS <version>" while a game runs,
 * "melonDS <version>" while paused or without a game. With several
 * instances or windows MainWindow puts "[p1] ", "[w2] " or "[p1:w2] " in
 * front. The title never names the game.
 */
export function readMelonDSTitle(title: string | null) {
  const match =
    /^(?:\[(?:p\d+(?::w\d+)?|w\d+)\] )?(\[\d+\/\d+\] )?melonDS(?: .*)?$/i.exec(
      title?.trim() ?? "",
    );
  return match ? { running: Boolean(match[1]) } : null;
}

/** "D:\DS\games.zip|Mario Kart DS (USA).nds" names a ROM inside an archive. */
function romName(recentFile: string) {
  return basename(recentFile.split("|").at(-1) ?? "");
}

/** One identity per ROM file, without its extension. */
function fileIdentity(fileName: string) {
  return normalizeToken(fileName.replace(CONTENT_EXTENSION, ""), "rom");
}

function identifyFile(
  path: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal | null {
  const fileName = romName(path).normalize("NFKC");
  if (
    !CONTENT_EXTENSION.test(fileName) ||
    /[\u0000-\u001f\u007f]/.test(fileName)
  ) {
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
    volatile: detectionSource === "recent_file",
    detectionSource,
  };
}

/**
 * melonDS reads a ROM into memory and closes it. After every load it puts
 * the ROM at the top of its recent list, which the scanner reads, so while a
 * game runs that entry is the game. A ROM inside an archive is no file to
 * start.
 */
export function discoverMelonDSLaunchTarget(
  signals: Pick<RawEmulatorSignals, "recentFile" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = signals.recentFile?.trim();
  if (
    !filePath ||
    filePath.includes("|") ||
    !CONTENT_EXTENSION.test(basename(filePath)) ||
    !readMelonDSTitle(signals.windowTitle)?.running
  ) {
    return null;
  }
  return { target: { kind: "file", filePath }, source: "recent_file" };
}

export const melondsAdapter: EmulatorAdapter = {
  id: "melonds",
  label: "melonDS",
  platformLabel: "Nintendo DS",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("Nintendo DS games, mappings, and emulator playtime");
  },
  exeNames: ["melonds.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["nds", "srl", "dsi", "ids", "zst"],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    identifyTarget: (target, context) =>
      identifyFile(target.filePath, context, "launch_arguments"),
    discoverTarget: discoverMelonDSLaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      const value = fileIdentity(romName(target.filePath).normalize("NFKC"));
      return value && value === mapping.contentValue
        ? { valid: true, association: "proven" }
        : { valid: false, reason: "content-name-mismatch" };
    },
  },
  read(signals, context) {
    if (!signals.windowTitle?.trim()) return { state: "idle" };
    const title = readMelonDSTitle(signals.windowTitle);
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if (!title.running) return { state: "idle" };
    const content =
      signals.recentFile &&
      identifyFile(signals.recentFile, context, "recent_file");
    return content
      ? { state: "content", content }
      : { state: "unidentified", reason: "no-signal" };
  },
};
