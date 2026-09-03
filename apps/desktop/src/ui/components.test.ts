import { describe, expect, it } from "vitest";
import { communitySuggestionApproval } from "./components";

describe("community suggestion approval", () => {
  it("has nothing to report without a suggestion", () => {
    expect(communitySuggestionApproval({})).toBeUndefined();
    expect(
      communitySuggestionApproval({ verified: true, status: "verified" }),
    ).toBeUndefined();
  });

  it("prefers the recorded status over the verified flag", () => {
    expect(
      communitySuggestionApproval({
        suggestionId: 84,
        verified: true,
        status: "pending",
      }),
    ).toBe("pending");
    expect(
      communitySuggestionApproval({
        suggestionId: 84,
        verified: false,
        status: "verified",
      }),
    ).toBe("approved");
  });

  it("falls back to the verified flag when no status was stored", () => {
    expect(communitySuggestionApproval({ suggestionId: 84 })).toBe("pending");
    expect(
      communitySuggestionApproval({ suggestionId: 84, verified: true }),
    ).toBe("approved");
  });

  it("stays silent on a rejected suggestion", () => {
    expect(
      communitySuggestionApproval({ suggestionId: 84, status: "rejected" }),
    ).toBeUndefined();
  });
});
