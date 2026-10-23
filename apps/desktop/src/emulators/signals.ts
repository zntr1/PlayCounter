import type {
  EmulatorContentKind,
  EmulatorContentRef,
  EmulatorSignalTrust,
} from "@playcounter/shared";
import type { EmulatorContentSignal, EmulatorDetectionSource } from "./types";

export const GENERIC_IDENTITY_DENYLIST = new Set([
  "dosbox",
  "dosbox-x",
  "dosbox_x",
  "dosbox-staging",
  "dolphin",
  "dolphin-emu",
  "pcsx2",
  "pcsx2-qt",
  "mgba",
  "mgba-sdl",
  "cemu",
  "rpcs3",
  "ppsspp",
  "duckstation",
  "ryujinx",
  "eden",
  "azahar",
  "melonds",
  "xenia",
  "xenia_canary",
  "eboot",
  "bios",
  "ps2 bios",
  "boot",
  "staging",
  "config",
  "conf",
  "default",
  "settings",
  "setup",
  "install",
  "readme",
  "start",
  "run",
  "play",
  "go",
  "main",
  "menu",
  "launcher",
  "game",
  "games",
  "test",
  "demo",
  "intro",
  "dos4gw",
  "cwsdpmi",
  "command",
  "exit",
]);

export const GENERIC_FOLDER_DENYLIST = new Set([
  ...GENERIC_IDENTITY_DENYLIST,
  "bin",
  "data",
  "roms",
  "emulators",
  "emulation",
  "gog games",
  "gog com",
  "program files",
  "program files (x86)",
  "users",
  "desktop",
  "downloads",
  "documents",
  "onedrive",
  "temp",
  "tmp",
  "new folder",
  "steamapps",
  "common",
]);

export function basename(value: string) {
  return stripQuotes(value).split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function stripQuotes(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeToken(raw: string, kind?: EmulatorContentKind) {
  const token = basename(raw)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (
    token.length < 2 ||
    token.length > 96 ||
    token.startsWith("-") ||
    /[:\\/]/.test(token) ||
    /^[0-9.]+$/.test(token)
  ) {
    return null;
  }
  const base = token.replace(
    /\.(?:exe|com|bat|conf|elf|dol|gcm|iso|tgc|wbfs|ciso|gcz|wad|dff|wia|rvz|json|bin|img|mdf|chd|cso|zso|(?:iso\.)?gz|gba|gbc|gb|sgb|zip|7z)$/i,
    "",
  );
  const denylist =
    kind === "folder" ? GENERIC_FOLDER_DENYLIST : GENERIC_IDENTITY_DENYLIST;
  if (denylist.has(base)) return null;
  return token;
}

export function isShareableToken(input: {
  value: string;
  kind: EmulatorContentKind;
  trust: EmulatorSignalTrust;
  privateTokens: readonly string[];
}) {
  if (input.trust !== "recognized" || input.kind === "folder") return false;
  return !input.privateTokens
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2)
    .some((token) => input.value.includes(token));
}

export function contentKey(ref: EmulatorContentRef) {
  return `${ref.emulatorId}:${ref.contentKind}:${ref.contentValue}`.toLowerCase();
}

export function prettyDisplay(value: string) {
  return /\.(?:exe|com|bat)$/i.test(value) ? value.toUpperCase() : value;
}

/** Letters and digits only, without bracketed tags or a file extension. */
export function comparableName(value: string) {
  return basename(value)
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[[(][^()[\]]*[\])]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** "Breath of the Wild" fits "The Legend of Zelda Breath of the Wild [ALZP01]". */
export function namesAgree(a: string, b: string) {
  const left = comparableName(a);
  const right = comparableName(b);
  return (
    left.length >= 4 &&
    right.length >= 4 &&
    (left.includes(right) || right.includes(left))
  );
}

/**
 * A game name from an anchored, non-editable title format may go to the API
 * as a search hint when it holds no path, control character or private token.
 */
export function isShareableHint(
  hint: string | undefined,
  privateTokens: readonly string[],
) {
  return Boolean(
    hint &&
    hint.length >= 2 &&
    hint.length <= 120 &&
    !/[\/\u0000-\u001f\u007f]/.test(hint) &&
    isShareableToken({
      value: hint.toLowerCase(),
      kind: "title_id",
      trust: "recognized",
      privateTokens,
    }),
  );
}

/**
 * A title ID read from an anchored window title, with the game name as its
 * search hint. Homebrew and placeholder IDs stay local.
 */
export function namedTitleIdSignal(input: {
  titleId: string;
  name: string;
  local: boolean;
  privateTokens: readonly string[];
  detectionSource: EmulatorDetectionSource;
}): EmulatorContentSignal {
  const shareable = !input.local;
  return {
    kind: "title_id",
    value: input.titleId,
    display: input.name,
    trust: input.local ? "weak" : "recognized",
    shareable,
    volatile: input.detectionSource === "window_title",
    detectionSource: input.detectionSource,
    searchHint: input.local ? undefined : input.name,
    shareableSearchHint:
      shareable && isShareableHint(input.name, input.privateTokens),
  };
}
