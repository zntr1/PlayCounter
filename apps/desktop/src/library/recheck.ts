import type { LibraryKnownExecutable } from "@playcounter/shared";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import { buildSteamImportCommit } from "./importPlan";
import { resolveLibraryGames } from "./resolve";
import {
  libraryEntryKey,
  type LibraryImportCommit,
  type LibraryImportEntry,
  type LibraryInstallEntry,
  type ScannedLibraryGame,
} from "./types";

export type SteamImportMatchCheck =
  | {
      kind: "found";
      commit: LibraryImportCommit;
      executableNames: string[];
    }
  | { kind: "not_found" }
  | { kind: "needs_install"; executableNames: string[] }
  | { kind: "unsupported" };

export async function checkSteamImportForMatches(input: {
  apiEndpoint: string;
  entry: LibraryImportEntry;
  install?: LibraryInstallEntry;
  ignoredProcesses?: ReadonlySet<string>;
}): Promise<SteamImportMatchCheck> {
  const scanned = importedGameAsScan(input.entry, input.install);
  const lookup = await resolveLibraryGames(input.apiEndpoint, "steam", [scanned]);
  if (lookup.capability === "unsupported") return { kind: "unsupported" };

  const resolved = lookup.games.find(
    (game) => game.key === libraryEntryKey("steam", input.entry.externalId),
  );
  if (!resolved?.game || resolved.status !== "resolved") {
    return { kind: "not_found" };
  }

  const commit = buildSteamImportCommit({
    scanned,
    resolved,
    ignoredProcesses: input.ignoredProcesses,
  });
  if (!commit) return { kind: "not_found" };

  // Only call an executable "linked" when the plan can actually install a
  // global or path-scoped local mapping. Ambiguous basenames without a known
  // Steam install root must not make tracking appear ready.
  const executableNames = uniqueExecutableNames([
    ...commit.exeCacheEntries.map((entry) => entry.exeName),
    ...commit.scopedLinks.map((entry) => entry.exeName),
  ]);
  if (executableNames.length === 0) {
    const knownNames = knownWindowsExecutableNames(
      resolved.executables,
      input.ignoredProcesses,
    );
    return knownNames.length > 0
      ? { kind: "needs_install", executableNames: knownNames }
      : { kind: "not_found" };
  }

  return {
    kind: "found",
    executableNames,
    commit: {
      ...commit,
      entry: {
        ...commit.entry,
        linkedExeNames: uniqueExecutableNames([
          ...input.entry.linkedExeNames,
          ...executableNames,
        ]),
      },
    },
  };
}

function importedGameAsScan(
  entry: LibraryImportEntry,
  install?: LibraryInstallEntry,
): ScannedLibraryGame {
  const lastPlayedMs = entry.providerLastPlayedAt
    ? Date.parse(entry.providerLastPlayedAt)
    : Number.NaN;
  return {
    externalId: entry.externalId,
    name: entry.name,
    playtimeSeconds: entry.providerSeconds,
    lastPlayedUnix: Number.isFinite(lastPlayedMs)
      ? Math.floor(lastPlayedMs / 1_000)
      : undefined,
    installed: Boolean(install),
    installPath: install?.installPath,
    executables: [],
  };
}

function knownWindowsExecutableNames(
  executables: readonly LibraryKnownExecutable[],
  ignoredProcesses: ReadonlySet<string> | undefined,
) {
  return uniqueExecutableNames(
    executables
      .filter(
        (entry) =>
          entry.platform === "windows" &&
          entry.kind === "exe" &&
          entry.value.trim().toLowerCase().endsWith(".exe") &&
          !matchesProcessPatternSet(
            entry.value.trim(),
            ignoredProcesses ?? new Set(),
          ),
      )
      .map((entry) => entry.value.trim()),
  );
}

function uniqueExecutableNames(names: readonly string[]) {
  const unique = new Map<string, string>();
  for (const name of names) unique.set(name.toLowerCase(), name);
  return [...unique.values()];
}
