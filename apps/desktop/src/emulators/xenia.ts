import {
  basename,
  namedTitleIdSignal,
  namesAgree,
  stripQuotes,
} from "./signals";
import type {
  EmulatorAdapter,
  EmulatorLaunchDiscovery,
  RawEmulatorSignals,
} from "./types";
import { getT } from "../i18n";

const t = getT("emulators");

const CONTENT_EXTENSION = /\.(?:iso|xex|zar)$/i;
// Zero, the dashboard and other system titles (FFFE…) and homebrew (FFFF…).
const LOCAL_TITLE_ID = /^(?:0{8}|ff[fe][0-9a-f]{5})$/;
// Appended after the game in this order (EmulatorWindow::UpdateTitle).
const TITLE_SUFFIXES = [
  / \[Plugins Loaded\]$/,
  / \[Patches Applied\]$/,
  / \(Preloading shaders(?:…|\.\.\.)\)$/,
  / \(@[\d.]+x\)$/,
  / <[^<>]*>$/,
];

type XeniaTitle = { idle: true } | { titleId: string; name: string };

/**
 * EmulatorWindow::UpdateTitle: "Xenia-canary (<branch>@<commit> on <date>)"
 * (master: "Xenia (…)") while idle; a running game adds
 * " | [<title ID> v<version>] <name>", where the name is in the console
 * language set in Xenia. The graphics backend (" <Vulkan>") and status
 * markers follow.
 */
export function readXeniaTitle(title: string | null): XeniaTitle | null {
  const trimmed = title?.trim() ?? "";
  const prefix = /^Xenia(?:-canary)?(?: DEBUG| CHECKED)? \([^()]*\)/i.exec(
    trimmed,
  );
  if (!prefix) return null;
  let rest = trimmed.slice(prefix[0].length);
  const id = /^ \| \[([0-9a-f]{8})(?: v[^\]]*)?\]/i.exec(rest);
  if (!id) return { idle: true };
  rest = rest.slice(id[0].length);
  for (const suffix of TITLE_SUFFIXES) rest = rest.replace(suffix, "");
  return { titleId: id[1].toLowerCase(), name: rest.trim() };
}

/** An unpacked game is started by default.xex inside the game's folder. */
function gameName(path: string) {
  const parts = stripQuotes(path).split(/[\\/]/).filter(Boolean);
  const fileName = parts.at(-1) ?? "";
  return /^default\.xex$/i.test(fileName) ? (parts.at(-2) ?? "") : fileName;
}

function gameArgument(args: string[]) {
  let path: string | null = null;
  for (const raw of args) {
    const arg = stripQuotes(raw);
    // Settings are "--name=value" or "--name value"; the game is positional.
    if (!arg.startsWith("-") && CONTENT_EXTENSION.test(basename(arg))) {
      path = arg;
    }
  }
  return path;
}

/** A start-up file counts only while the title shows a game of that name. */
export function discoverXeniaLaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  const filePath = gameArgument(signals.args);
  const title = readXeniaTitle(signals.windowTitle);
  if (!filePath || !title || "idle" in title) return null;
  return namesAgree(title.name, gameName(filePath))
    ? { target: { kind: "file", filePath }, source: "launch_arguments" }
    : null;
}

export const xeniaAdapter: EmulatorAdapter = {
  id: "xenia",
  label: "Xenia",
  platformLabel: "Xbox 360",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("Xbox 360 games, mappings, and emulator playtime");
  },
  exeNames: ["xenia_canary.exe", "xenia.exe"],
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["iso", "xex", "zar"],
    isValidContentFile: (fileName) => CONTENT_EXTENSION.test(fileName),
    // Disc and archive names carry no title ID, so a file is no identity.
    identifyTarget: () => null,
    discoverTarget: discoverXeniaLaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      if (!CONTENT_EXTENSION.test(basename(target.filePath))) {
        return { valid: false, reason: "unsupported-content-file" };
      }
      return namesAgree(mapping.display, gameName(target.filePath))
        ? { valid: true, association: "proven" }
        : { valid: true, association: "requires_confirmation" };
    },
  },
  read(signals, context) {
    if (!signals.windowTitle?.trim()) return { state: "idle" };
    const title = readXeniaTitle(signals.windowTitle);
    if (!title) return { state: "unidentified", reason: "title-not-parsable" };
    if ("idle" in title) return { state: "idle" };
    return {
      state: "content",
      content: namedTitleIdSignal({
        titleId: title.titleId,
        name: title.name || title.titleId.toUpperCase(),
        local: LOCAL_TITLE_ID.test(title.titleId),
        privateTokens: context.privateTokens,
        detectionSource: "window_title",
      }),
    };
  },
};
