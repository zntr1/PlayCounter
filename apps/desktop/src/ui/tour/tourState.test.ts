import { describe, expect, it } from "vitest";
import {
  defaultTourProgress,
  markTourCompleted,
  markWelcomeSeen,
  normalizeTourProgress,
  shouldShowWelcome,
} from "./tourState";

describe("tour progress", () => {
  it("defaults safely for missing and malformed persisted data", () => {
    expect(normalizeTourProgress(undefined, ["core"])).toEqual(
      defaultTourProgress(),
    );
    expect(normalizeTourProgress([], ["core"])).toEqual(defaultTourProgress());
    expect(normalizeTourProgress({ version: 99 }, ["core"])).toEqual(
      defaultTourProgress(),
    );
  });

  it("keeps only known, numeric completions", () => {
    expect(
      normalizeTourProgress(
        {
          version: 1,
          welcomeVersion: 1,
          completed: { core: 1, removed: 4, broken: "yes" },
        },
        ["core", "broken"],
      ),
    ).toEqual({
      version: 1,
      welcomeVersion: 1,
      completed: { core: 1 },
    });
  });

  it("marks welcome and completion immutably", () => {
    const original = defaultTourProgress();
    const seen = markWelcomeSeen(original);
    const completed = markTourCompleted(seen, "core", 2);
    expect(shouldShowWelcome(original)).toBe(true);
    expect(shouldShowWelcome(seen)).toBe(false);
    expect(completed.completed).toEqual({ core: 2 });
    expect(original.completed).toEqual({});
  });
});
