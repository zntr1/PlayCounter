import { describe, expect, it } from "vitest";
import {
  normalizeCollapsedSections,
  toggleCollapsedSection,
} from "./sectionCollapse";

describe("section collapse state", () => {
  it("adds and removes a section without mutating the input", () => {
    const original = ["history.playtime"];
    const added = toggleCollapsedSection(original, "history.timeline");

    expect(added).toEqual(["history.playtime", "history.timeline"]);
    expect(original).toEqual(["history.playtime"]);
    expect(toggleCollapsedSection(added, "history.playtime")).toEqual([
      "history.timeline",
    ]);
  });

  it("normalizes persisted values to unique non-empty strings", () => {
    expect(normalizeCollapsedSections(undefined)).toEqual([]);
    expect(normalizeCollapsedSections("history.timeline")).toEqual([]);
    expect(
      normalizeCollapsedSections([
        "history.timeline",
        1,
        null,
        "",
        "history.timeline",
        "achievements.total",
      ]),
    ).toEqual(["history.timeline", "achievements.total"]);
  });
});
