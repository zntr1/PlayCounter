import type {
  EmulatorContentKind,
  EmulatorContentRef,
  EmulatorSignalTrust,
} from "@playcounter/shared";

export const GENERIC_IDENTITY_DENYLIST = new Set([
  "dosbox",
  "dosbox-x",
  "dosbox_x",
  "dosbox-staging",
  "dolphin",
  "dolphin-emu",
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
    /\.(?:exe|com|bat|conf|elf|dol|gcm|iso|tgc|wbfs|ciso|gcz|wad|dff|wia|rvz|json)$/i,
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
