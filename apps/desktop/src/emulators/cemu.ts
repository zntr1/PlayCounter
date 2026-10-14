import { basename, isShareableToken, stripQuotes } from "./signals";
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

const CONTENT_EXTENSION = /\.(?:wud|wux|wua|wuhb|iso|rpx|elf)$/i;
// Cemu names homebrew without a title "Unknown Game" and gives it a
// placeholder title ID made from a hash of the .rpx (CafeSystem.cpp).
const PLACEHOLDER_TITLE_ID = /^ffffffff/;
const UNKNOWN_GAME = "Unknown Game"; // i18n-exempt: Cemu's own placeholder name, compared, never shown by us

type CemuTitle = { idle: true } | { titleId: string; name: string };

/**
 * Window title (WindowSystem::UpdateWindowTitles): "Cemu <version>" while
 * idle, "Cemu <version> - Loading..." while a game starts, then
 * "Cemu <version> - FPS: <fps> [<renderer>] [<gpu>] [TitleId: <hi>-<lo>]
 * [Online...] <name> [<region> v<version>]". [Online-<name>] carries a
 * user-typed network name and is dropped. Null for any other title.
 */
export function readCemuTitle(title: string | null): CemuTitle | null {
  const trimmed = title?.trim() ?? "";
  if (/^Cemu \S+(?: - Loading\.\.\.)?$/i.test(trimmed)) return { idle: true };
  const match =
    /^Cemu \S+ - FPS: .*?\[TitleId: ([0-9a-f]{8})-([0-9a-f]{8})\](?: \[Online[^\]]*\])? (.+?)(?: \[(?:[A-Z]{2} )?v\d+\])?$/i.exec(
      trimmed,
    );
  if (!match) return null;
  const name = match[3].trim();
  return name
    ? { titleId: `${match[1]}${match[2]}`.toLowerCase(), name }
    : null;
}

function comparable(value: string) {
  return value
    .replace(CONTENT_EXTENSION, "")
    .replace(/[[(][^()[\]]*[\])]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** "Breath of the Wild" fits "The Legend of Zelda Breath of the Wild [ALZP01]". */
function namesAgree(a: string, b: string) {
  const left = comparable(a);
  const right = comparable(b);
  return (
    left.length >= 4 &&
    right.length >= 4 &&
    (left.includes(right) || right.includes(left))
  );
}

/**
 * A game installed into Cemu sits at
 * mlc01/usr/title/<hi>/<lo>/code/<name>.rpx, so its path carries the title ID.
 */
function pathTitleId(path: string) {
  const match = /[\\/]([0-9a-f]{8})[\\/]([0-9a-f]{8})[\\/]code[\\/][^\\/]+\.rpx$/i.exec(
    stripQuotes(path),
  );
  return match ? `${match[1]}${match[2]}`.toLowerCase() : null;
}

/** The .rpx in an unpacked game is named after the engine, its folder after the game. */
function pathGameName(path: string) {
  const parts = stripQuotes(path).split(/[\\/]/).filter(Boolean);
  const fileName = parts.at(-1) ?? "";
  return /\.rpx$/i.test(fileName) && parts.at(-2)?.toLowerCase() === "code"
    ? (parts.at(-3) ?? "")
    : fileName;
}

function pathMatches(path: string, titleId: string, name: string) {
  const fromPath = pathTitleId(path);
  return fromPath ? fromPath === titleId : namesAgree(name, pathGameName(path));
}

function gameArgument(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    const lower = arg.toLowerCase();
    const value = lower.startsWith("--game=")
      ? arg.slice("--game=".length)
      : lower === "-g" || lower === "--game"
        ? (args[index + 1] ?? "")
        : null;
    if (value === null) continue;
    const path = stripQuotes(value);
    return CONTENT_EXTENSION.test(basename(path)) ? path : null;
  }
  return null;
}

/**
 * "Close game" plus another game from Cemu's list leaves the start-up file
 * stale, so it only counts while the title shows the same game.
 */
export function discoverCemuLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = gameArgument(signals.args);
  const title = readCemuTitle(signals.windowTitle);
  if (!filePath || !title || "idle" in title) return null;
  return pathMatches(filePath, title.titleId, title.name)
    ? { target: { kind: "file", filePath }, source: "launch_arguments" }
    : null;
}

function titleIdSignal(
  titleId: string,
  name: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal {
  const homebrew = PLACEHOLDER_TITLE_ID.test(titleId) || name === UNKNOWN_GAME;
  const shareable = !homebrew;
  return {
    kind: "title_id",
    value: titleId,
    display: name,
    trust: homebrew ? "weak" : "recognized",
    shareable,
    volatile: detectionSource === "window_title",
    detectionSource,
    searchHint: homebrew ? undefined : name,
    shareableSearchHint:
      shareable &&
      name.length >= 2 &&
      name.length <= 120 &&
      !/[\\/:\u0000-\u001f\u007f]/.test(name) &&
      isShareableToken({
        value: name.toLowerCase(),
        kind: "title_id",
        trust: "recognized",
        privateTokens: context.privateTokens,
      }),
  };
}

export const cemuAdapter: EmulatorAdapter = {
  id: "cemu",
  label: "Cemu",
  platformLabel: "Wii U",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("Wii U games, mappings, and emulator playtime");
  },
  exeNames: ["cemu.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["wud", "wux", "wua", "wuhb", "iso", "rpx", "elf"],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    // Only an installed game's path names its title ID; a file name alone
    // is not a Cemu identity.
    identifyTarget: (target, context) => {
      const titleId = pathTitleId(target.filePath);
      return titleId
        ? titleIdSignal(
            titleId,
            titleId.toUpperCase(),
            context,
            "launch_arguments",
          )
        : null;
    },
    discoverTarget: discoverCemuLaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      if (!CONTENT_EXTENSION.test(basename(target.filePath))) {
        return { valid: false, reason: "unsupported-content-file" };
      }
      return pathMatches(target.filePath, mapping.contentValue, mapping.display)
        ? { valid: true, association: "proven" }
        : { valid: true, association: "requires_confirmation" };
    },
  },
  read(signals, context) {
    const title = readCemuTitle(signals.windowTitle);
    // Right after start-up the window has no title yet.
    if (!signals.windowTitle?.trim()) return { state: "idle" };
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if ("idle" in title) return { state: "idle" };
    return {
      state: "content",
      content: titleIdSignal(title.titleId, title.name, context, "window_title"),
    };
  },
};
