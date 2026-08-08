import { describe, expect, it } from "vitest";
import { findReviewExecutables, sortReviewExecutables } from "./discoveredSort";

type ReviewItem = {
  exeName: string;
  exePath: string | null;
  isRunning: boolean;
  cacheEntry: {
    state: string;
    trackedSeconds?: number;
    runningSince?: string;
  } | null;
};

const now = Date.parse("2026-08-09T12:00:00.000Z");

function reviewItem(
  exeName: string,
  overrides: Partial<ReviewItem> = {},
): ReviewItem {
  return {
    exeName,
    exePath: null,
    isRunning: false,
    cacheEntry: {
      state: "unmatched",
      trackedSeconds: 0,
    },
    ...overrides,
  };
}

describe("sortReviewExecutables", () => {
  it("places running processes before non-running processes", () => {
    const sorted = sortReviewExecutables(
      [
        reviewItem("stopped.exe", {
          cacheEntry: { state: "unmatched", trackedSeconds: 10_000 },
        }),
        reviewItem("running.exe", { isRunning: true }),
      ],
      now,
    );

    expect(sorted.map((item) => item.exeName)).toEqual([
      "running.exe",
      "stopped.exe",
    ]);
  });

  it("ranks each running tier by accumulated and open runtime", () => {
    const sorted = sortReviewExecutables(
      [
        reviewItem("short.exe", {
          isRunning: true,
          cacheEntry: {
            state: "unmatched",
            trackedSeconds: 30,
            runningSince: "2026-08-09T11:59:30.000Z",
          },
        }),
        reviewItem("long.exe", {
          isRunning: true,
          cacheEntry: {
            state: "unmatched",
            trackedSeconds: 60,
            runningSince: "2026-08-09T11:58:00.000Z",
          },
        }),
      ],
      now,
    );

    expect(sorted.map((item) => item.exeName)).toEqual([
      "long.exe",
      "short.exe",
    ]);
  });

  it("uses executable name for stable ties without mutating the input", () => {
    const items = [reviewItem("Zulu.exe"), reviewItem("alpha.exe")];
    const sorted = sortReviewExecutables(items, now);

    expect(sorted.map((item) => item.exeName)).toEqual([
      "alpha.exe",
      "Zulu.exe",
    ]);
    expect(items.map((item) => item.exeName)).toEqual([
      "Zulu.exe",
      "alpha.exe",
    ]);
  });
});

describe("findReviewExecutables", () => {
  const items = [
    reviewItem("helper.exe", {
      exePath: "C:\\Games\\Mixtape\\helper.exe",
    }),
    reviewItem("Mixtape.exe", {
      exePath: "D:\\SteamLibrary\\Mixtape.exe",
    }),
    reviewItem("another-mixtape-tool.exe"),
  ];

  it("finds executable names and paths, prioritizing name prefixes", () => {
    expect(
      findReviewExecutables(items, "mixtape").map((item) => item.exeName),
    ).toEqual(["Mixtape.exe", "another-mixtape-tool.exe", "helper.exe"]);
  });

  it("returns no suggestions for an empty query and respects the limit", () => {
    expect(findReviewExecutables(items, "   ")).toEqual([]);
    expect(findReviewExecutables(items, "exe", 2)).toHaveLength(2);
  });
});
