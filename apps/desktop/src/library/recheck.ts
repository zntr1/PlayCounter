import type { LibraryKnownExecutable } from "@playcounter/shared";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import { buildLibraryImportCommit } from "./importPlan";
import { resolveLibraryGames } from "./resolve";
import {
  libraryEntryKey,
  type LibraryImportCommit,
  type LibraryImportEntry,
  type LibraryInstallEntry,
  type ScannedLibraryGame,
  type ResolvedLibraryGame,
} from "./types";

export type LibraryExecutableMatch = {
  name: string;
  sources: LibraryKnownExecutable["provenance"][];
};

export type LibraryImportMatchCheck =
  | {
      kind: "found";
      commit: LibraryImportCommit;
      executableNames: string[];
      executableMatches: LibraryExecutableMatch[];
    }
  | { kind: "not_found" }
  | { kind: "needs_install"; executableNames: string[] }
  | { kind: "unsupported" };

export async function checkLibraryImportForMatches(input: {
  apiEndpoint: string;
  entry: LibraryImportEntry;
  install?: LibraryInstallEntry;
  ignoredProcesses?: ReadonlySet<string>;
  signal?: AbortSignal;
}): Promise<LibraryImportMatchCheck> {
  let scanned = importedGameAsScan(input.entry, input.install);
  if (input.entry.provider === "battlenet") {
    const { battleNetProvider } = await import("./providers/battlenet");
    const local = await battleNetProvider.scan(0, { signal: input.signal });
    const found = local.games.find(
      (game) => game.externalId === input.entry.externalId,
    );
    if (!found)
      return {
        kind: "needs_install",
        executableNames: input.entry.linkedExeNames,
      };
    scanned = {
      ...found,
      hasPlayedEvidence:
        input.entry.providerHasPlayedEvidence || found.hasPlayedEvidence,
    };
  }
  let resolved: ResolvedLibraryGame | undefined;
  if (input.entry.provider !== "steam") {
    // Keep the confirmed identity for providers that support a manual choice.
    const { reverseResolveXboxGame } = await import("./providers/xbox");
    const result = await reverseResolveXboxGame(
      input.apiEndpoint,
      input.entry.gameId,
      input.signal,
    );
    resolved = {
      key: libraryEntryKey(input.entry.provider, input.entry.externalId),
      status: "resolved",
      ...result,
    };
  } else {
    const lookup = await resolveLibraryGames(
      input.apiEndpoint,
      input.entry.provider,
      [scanned],
      input.signal,
    );
    if (lookup.capability === "unsupported") return { kind: "unsupported" };
    resolved = lookup.games.find(
      (game) =>
        game.key ===
        libraryEntryKey(input.entry.provider, input.entry.externalId),
    );
  }
  if (!resolved?.game || resolved.status !== "resolved") {
    return { kind: "not_found" };
  }

  const commit = buildLibraryImportCommit({
    provider: input.entry.provider,
    scanned,
    resolved,
    ignoredProcesses: input.ignoredProcesses,
  });
  if (!commit) return { kind: "not_found" };

  // Only call an executable "linked" when the plan can actually install a
  // local cache or path-scoped mapping using the provider's safety rules.
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
    // Attribute each usable file to its exact Windows executable evidence,
    // independently of the game's metadata source or older saved links.
    executableMatches: executableNames.map((name) => ({
      name,
      sources: [
        ...new Set(
          resolved.executables
            .filter(
              (executable) =>
                executable.platform === "windows" &&
                executable.kind === "exe" &&
                executable.value.trim().toLowerCase() === name.toLowerCase(),
            )
            .map((executable) => executable.provenance),
        ),
      ].sort(),
    })),
    commit: {
      ...commit,
      entry: {
        ...commit.entry,
        linkedExeNames: uniqueExecutableNames([
          ...input.entry.linkedExeNames,
          ...executableNames,
        ]),
        linkedExeSources: [
          ...new Set([
            ...input.entry.linkedExeSources,
            ...commit.entry.linkedExeSources,
          ]),
        ],
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
    hasPlayedEvidence: entry.providerHasPlayedEvidence,
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
