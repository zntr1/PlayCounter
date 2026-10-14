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

const CONTENT_EXTENSION = /\.(?:nsp|xci|nca|nro|nso)$/i;
const APPLICATION_ID = /^01[0-9a-f]{14}$/;
const FILE_ID = /(?:^|[^0-9a-f])(01[0-9a-f]{14})(?![0-9a-f])/i;
// Options that take a value (Ryujinx/Utilities/CommandLineState.cs).
const VALUE_OPTIONS = new Set([
  "-r",
  "--root-data-dir",
  "-rdct",
  "--rd-capture-title-format",
  "--install-firmware",
  "-p",
  "--profile",
  "-g",
  "--graphics-backend",
  "--backend-threading",
  "--bt",
  "--pptc",
  "-m",
  "--memory-manager-mode",
  "--system-region",
  "--system-language",
  "-i",
  "--application-id",
  "--hide-cursor",
]);

type RyujinxTitle = { idle: true } | { titleId: string; name: string };

/**
 * TitleHelper.ActiveApplicationTitle:
 * "Ryujinx <ver> - <name> v<game ver> (<ID>) (64-bit)", or with the Windows
 * custom title bar "Ryujinx <ver>\n<name>\nv<game ver>\n(<ID>) (64-bit)".
 * A paused game appends " (<paused>)" in the UI language. Idle:
 * "Ryujinx <ver>" or "Ryujinx Canary <ver>". The scanner keeps the longest
 * title, and a running game's title is longer than Ryujinx's dialog titles.
 */
export function readRyujinxTitle(title: string | null): RyujinxTitle | null {
  const trimmed = title?.trim() ?? "";
  if (/^Ryujinx(?: Canary)? \S+$/i.test(trimmed)) return { idle: true };
  const prefix = /^Ryujinx(?: Canary)? \S+(?: - |\s*\n)/i.exec(trimmed);
  const id = /\(([0-9a-f]{16})\)\s*\((?:32|64)-bit\)/i.exec(trimmed);
  if (!prefix) return null;
  // Dialogs use "Ryujinx <ver> - <window name>" without a game.
  if (!id || id.index < prefix[0].length) return { idle: true };
  const lines = trimmed
    .slice(prefix[0].length, id.index)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const name = (
    lines.length > 1
      ? lines.filter((line) => !/^v\d/i.test(line)).join(" ")
      : (lines[0] ?? "").replace(/\s+v\d[\w.+-]*$/i, "")
  ).trim();
  return { titleId: id[1].toLowerCase(), name };
}

function fileTitleId(path: string) {
  return FILE_ID.exec(basename(path))?.[1].toLowerCase() ?? null;
}

function pathMatches(path: string, titleId: string, name: string) {
  const fromPath = fileTitleId(path);
  return fromPath ? fromPath === titleId : namesAgree(name, basename(path));
}

function gameArgument(args: string[]) {
  let path: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    if (VALUE_OPTIONS.has(arg.toLowerCase())) {
      index += 1;
      continue;
    }
    // Ryujinx takes the last argument that is not an option.
    if (!arg.startsWith("-")) path = arg;
  }
  return path && CONTENT_EXTENSION.test(basename(path)) ? path : null;
}

/** A start-up file counts only while the title shows the same game. */
export function discoverRyujinxLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = gameArgument(signals.args);
  const title = readRyujinxTitle(signals.windowTitle);
  if (!filePath || !title || "idle" in title) return null;
  return pathMatches(filePath, title.titleId, title.name)
    ? { target: { kind: "file", filePath }, source: "launch_arguments" }
    : null;
}

function idSignal(
  titleId: string,
  name: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
) {
  return namedTitleIdSignal({
    titleId,
    name: name || titleId.toUpperCase(),
    // Homebrew runs with a zero or made-up program ID.
    local: !APPLICATION_ID.test(titleId) || /^0100000000000000$/.test(titleId),
    privateTokens: context.privateTokens,
    detectionSource,
  });
}

export const ryujinxAdapter: EmulatorAdapter = {
  id: "ryujinx",
  label: "Ryujinx",
  platformLabel: "Nintendo Switch",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("Nintendo Switch games, mappings, and emulator playtime");
  },
  exeNames: ["ryujinx.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["nsp", "xci", "nca", "nro", "nso"],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    identifyTarget: (target, context) => {
      const titleId = fileTitleId(target.filePath);
      return titleId
        ? idSignal(titleId, "", context, "launch_arguments")
        : null;
    },
    discoverTarget: discoverRyujinxLaunchTarget,
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
    if (!signals.windowTitle?.trim()) return { state: "idle" };
    const title = readRyujinxTitle(signals.windowTitle);
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if ("idle" in title) return { state: "idle" };
    return {
      state: "content",
      content: idSignal(title.titleId, title.name, context, "window_title"),
    };
  },
};
