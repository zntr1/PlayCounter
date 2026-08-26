import { isAbsoluteWindowsPath } from "../gameLaunch";
import type { ProcessSnapshot } from "../store";
import type { ScopedExeLink } from "./types";

export function normalizeWindowsDir(value: string): string | null {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.includes("\0") ||
    !isAbsoluteWindowsPath(trimmed) ||
    trimmed.split(/[\\/]+/).some((part) => part === "..")
  ) {
    return null;
  }
  const unc = trimmed.startsWith("\\\\") || trimmed.startsWith("//");
  const body = trimmed.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "\\");
  return `${unc ? "\\\\" : ""}${body}`.replace(/\\+$/, "").toLowerCase();
}

export function isUnderPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}\\`);
}

export function scopedExeLinkKey(exeName: string, pathPrefix: string) {
  const normalized = normalizeWindowsDir(pathPrefix);
  return normalized ? `${exeName.toLowerCase()}|${normalized}` : null;
}

export function resolveScopedLink(
  process: Pick<ProcessSnapshot, "exeName" | "exePath">,
  links: ReadonlyMap<string, ScopedExeLink>,
): ScopedExeLink | null {
  if (!process.exePath) return null;
  const path = normalizeWindowsDir(process.exePath);
  if (!path) return null;
  const candidates = [...links.values()]
    .filter(
      (link) => link.exeName.toLowerCase() === process.exeName.toLowerCase(),
    )
    .map((link) => ({ link, prefix: normalizeWindowsDir(link.pathPrefix) }))
    .filter((item): item is { link: ScopedExeLink; prefix: string } =>
      Boolean(item.prefix && isUnderPrefix(path, item.prefix)),
    )
    .sort((left, right) => right.prefix.length - left.prefix.length);
  if (candidates.length === 0) return null;
  const best = candidates[0];
  const tiedConflict = candidates.some(
    (candidate) =>
      candidate.prefix.length === best.prefix.length &&
      candidate.link.igdbId !== best.link.igdbId,
  );
  return tiedConflict ? null : best.link;
}
