import { describe, expect, it } from "vitest";
import {
  countNeedsReview,
  getDiscoveryStatus,
  NEEDS_REVIEW_STATUSES,
  type DiscoveryReviewInput,
} from "./discoveredReview";
import type { ExeCacheEntry, ProcessSnapshot } from "./store";

const checkedAt = "2026-08-10T00:00:00.000Z";

function cacheEntry(
  exeName: string,
  state: ExeCacheEntry["state"],
  source?: ExeCacheEntry["source"],
): ExeCacheEntry {
  return { exeName, state, source, lastCheckedAt: checkedAt };
}

function input(
  processes: ProcessSnapshot[],
  entries: ExeCacheEntry[] = [],
  overrides: Partial<DiscoveryReviewInput> = {},
): DiscoveryReviewInput {
  return {
    processes,
    exeCache: new Map(
      entries.map((entry) => [entry.exeName.toLowerCase(), entry]),
    ),
    ignoredProcesses: new Set(),
    userIgnoredProcesses: new Set(),
    blacklist: new Set(),
    ambiguousMatches: [],
    ...overrides,
  };
}

describe("discovered review count", () => {
  it("counts only checked executables that need review", () => {
    const processes = [
      { exeName: "checking.exe", exePath: null },
      { exeName: "unmatched.exe", exePath: null },
      { exeName: "matched.exe", exePath: null },
      { exeName: "custom.exe", exePath: null },
      { exeName: "ignored.exe", exePath: null },
      { exeName: "user-ignored.exe", exePath: null },
    ];
    const state = input(
      processes,
      [
        cacheEntry("unmatched.exe", "unmatched"),
        cacheEntry("matched.exe", "matched", "igdb"),
        cacheEntry("custom.exe", "matched", "custom"),
      ],
      {
        ignoredProcesses: new Set(["ignored.exe"]),
        userIgnoredProcesses: new Set(["user-ignored.exe"]),
      },
    );

    expect(countNeedsReview(state)).toBe(1);
  });

  it("does not expose a process before its database check completes", () => {
    const state = input([{ exeName: "subnautica.exe", exePath: null }]);

    expect(
      getDiscoveryStatus(
        "subnautica.exe",
        state.exeCache.get("subnautica.exe"),
        state.ignoredProcesses,
        state.userIgnoredProcesses,
        state.blacklist,
      ),
    ).toBeNull();
    expect(countNeedsReview(state)).toBe(0);
  });

  it("excludes ambiguous matches and de-duplicates cached running executables", () => {
    const state = input(
      [
        { exeName: "duplicate.exe", exePath: null },
        { exeName: "ambiguous.exe", exePath: null },
      ],
      [
        cacheEntry("duplicate.exe", "unmatched"),
        cacheEntry("saved.exe", "unmatched"),
      ],
      {
        ambiguousMatches: [
          {
            exeName: "ambiguous.exe",
            exePath: null,
            candidates: [],
            detectedAt: checkedAt,
          },
        ],
      },
    );

    expect(countNeedsReview(state)).toBe(2);
  });

  it("respects wildcard ignore patterns", () => {
    const state = input(
      [{ exeName: "overlay-helper.exe", exePath: null }],
      [],
      { ignoredProcesses: new Set(["overlay-*.exe"]) },
    );

    expect(countNeedsReview(state)).toBe(0);
  });

  it("routes emulator hosts through content review instead of exe review", () => {
    const state = input(
      [
        {
          exeName: "dosbox.exe",
          exePath: null,
          emulatorId: "dosbox",
        },
      ],
      [],
    );

    expect(countNeedsReview(state)).toBe(0);
  });

  it("uses the same statuses as the Needs review filter", () => {
    const entries = [
      cacheEntry("unmatched.exe", "unmatched"),
      cacheEntry("matched.exe", "matched", "igdb"),
      cacheEntry("custom.exe", "matched", "custom"),
      cacheEntry("blocked.exe", "blacklisted"),
    ];
    const state = input(
      [
        ...entries.map((entry) => ({ exeName: entry.exeName, exePath: null })),
        { exeName: "checking.exe", exePath: null },
      ],
      entries,
    );
    const statuses = state.processes.map((process) =>
      getDiscoveryStatus(
        process.exeName,
        state.exeCache.get(process.exeName.toLowerCase()),
        state.ignoredProcesses,
        state.userIgnoredProcesses,
        state.blacklist,
      ),
    );

    expect(countNeedsReview(state)).toBe(
      statuses.filter((status) =>
        NEEDS_REVIEW_STATUSES.includes(
          status as (typeof NEEDS_REVIEW_STATUSES)[number],
        ),
      ).length,
    );
  });
});
