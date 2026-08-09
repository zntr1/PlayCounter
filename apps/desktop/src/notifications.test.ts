import { describe, expect, it } from "vitest";
import { shouldNotifyContributionTransition } from "./notifications";

describe("contribution transitions", () => {
  it.each([
    [undefined, "pending", false],
    [undefined, "verified", true],
    [undefined, "rejected", true],
    ["pending", "verified", true],
    ["pending", "rejected", true],
    ["verified", "verified", false],
    ["rejected", "pending", false],
  ] as const)("maps %s -> %s to notify=%s", (previous, incoming, expected) => {
    expect(shouldNotifyContributionTransition(previous, incoming)).toBe(
      expected,
    );
  });
});
