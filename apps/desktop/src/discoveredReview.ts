import { matchesProcessPatternSet } from "./ignoredProcessPatterns";
import type {
  AmbiguousProcessMatch,
  ExeCacheEntry,
  ProcessSnapshot,
} from "./store";

export type DiscoveryStatus =
  | "matched"
  | "custom"
  | "unmatched"
  | "ignored"
  | "userIgnored"
  | "checking";

export const NEEDS_REVIEW_STATUSES = [
  "unmatched",
  "checking",
] as const satisfies readonly DiscoveryStatus[];

export type DiscoveryReviewInput = {
  processes: readonly ProcessSnapshot[];
  exeCache: ReadonlyMap<string, ExeCacheEntry>;
  ignoredProcesses: Set<string>;
  userIgnoredProcesses: Set<string>;
  blacklist: Set<string>;
  ambiguousMatches: readonly AmbiguousProcessMatch[];
};

export function countNeedsReview(input: DiscoveryReviewInput) {
  // Exes with a pending ambiguity picker are handled in Now Playing; they
  // are not additionally up for review here.
  const ambiguousKeys = new Set(
    input.ambiguousMatches.map((match) => match.exeName.toLowerCase()),
  );
  const byKey = new Map<string, ExeCacheEntry | null>();
  for (const process of input.processes) {
    if (process.emulatorId) continue;
    const key = process.exeName.toLowerCase();
    byKey.set(key, input.exeCache.get(key) ?? null);
  }
  for (const entry of input.exeCache.values()) {
    const key = entry.exeName.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, entry);
  }

  let count = 0;
  for (const [key, entry] of byKey) {
    if (ambiguousKeys.has(key)) continue;
    const status = getDiscoveryStatus(
      entry?.exeName ?? key,
      entry ?? undefined,
      input.ignoredProcesses,
      input.userIgnoredProcesses,
      input.blacklist,
    );
    if (
      NEEDS_REVIEW_STATUSES.includes(
        status as (typeof NEEDS_REVIEW_STATUSES)[number],
      )
    ) {
      count += 1;
    }
  }
  return count;
}

export function getDiscoveryStatus(
  exeName: string,
  cacheEntry: ExeCacheEntry | undefined,
  ignoredProcesses: Set<string>,
  userIgnoredProcesses: Set<string>,
  blacklist: Set<string>,
): DiscoveryStatus {
  const key = exeName.toLowerCase();

  if (
    matchesProcessPatternSet(key, userIgnoredProcesses) ||
    matchesProcessPatternSet(key, blacklist) ||
    cacheEntry?.state === "blacklisted"
  ) {
    return "userIgnored";
  }
  if (matchesProcessPatternSet(key, ignoredProcesses)) return "ignored";
  if (cacheEntry?.state === "matched" && cacheEntry.source === "custom") {
    return "custom";
  }
  if (cacheEntry?.state === "matched") return "matched";
  if (cacheEntry?.state === "unmatched") return "unmatched";

  return "checking";
}
