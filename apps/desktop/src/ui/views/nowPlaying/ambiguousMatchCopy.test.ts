import { describe, expect, it } from "vitest";
import { ambiguousMatchCopy, formatAgo } from "./ambiguousMatchCopy";

describe("ambiguousMatchCopy", () => {
  it("asks which game for several candidates", () => {
    const copy = ambiguousMatchCopy({ candidateCount: 3 });
    expect(copy.eyebrow).toBe("Unidentified process");
    expect(copy.headline).toBe("Which game is {exe}?");
    expect(copy.description).toContain("3 games in the database");
  });

  it("uses the singular for one candidate", () => {
    const copy = ambiguousMatchCopy({
      candidateCount: 1,
      candidateName: "Hollow Knight",
    });
    expect(copy.description).toMatch(/^A game in the database/);
  });

  it("explains an empty candidate list", () => {
    const copy = ambiguousMatchCopy({ candidateCount: 0 });
    expect(copy.description).toContain("no game in the database");
  });

  it("leads with the report for files flagged as not a game", () => {
    const copy = ambiguousMatchCopy({
      candidateCount: 1,
      candidateName: "Some Indie Game",
      flagReason: "not_a_game",
    });
    expect(copy.eyebrow).toBe("Reported as not a game");
    expect(copy.headline).toBe("Is {exe} a game?");
    expect(copy.description).toContain("It still matches Some Indie Game.");
  });

  it("counts the remaining matches for a flagged file", () => {
    expect(
      ambiguousMatchCopy({ candidateCount: 3, flagReason: "not_a_game" })
        .description,
    ).toContain("It still matches 3 games.");
    expect(
      ambiguousMatchCopy({ candidateCount: 0, flagReason: "not_a_game" })
        .description,
    ).not.toContain("still matches");
  });

  it("treats the ambiguous flag like an unflagged multi-match", () => {
    expect(
      ambiguousMatchCopy({ candidateCount: 2, flagReason: "ambiguous" }),
    ).toEqual(ambiguousMatchCopy({ candidateCount: 2 }));
  });
});

describe("formatAgo", () => {
  it("rounds down to the largest unit", () => {
    expect(formatAgo(12)).toBe("just now");
    expect(formatAgo(4 * 60 + 30)).toBe("4m ago");
    expect(formatAgo(2 * 3600 + 5 * 60)).toBe("2h 5m ago");
  });
});
