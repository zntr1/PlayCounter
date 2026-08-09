import { describe, expect, it } from "vitest";
import {
  gameSecondsKey,
  gameSecondsKeys,
  sanitizeGameSecondsRecord,
} from "./gameSeconds";

describe("game seconds keys", () => {
  it("normalizes unknown sources and deduplicates aliases", () => {
    expect(gameSecondsKey({ gameId: 7, source: null })).toBe("unknown:7");
    expect(
      gameSecondsKeys([
        { gameId: 7, source: "community" },
        { gameId: 7, source: "community" },
      ]),
    ).toEqual(["community:7"]);
  });

  it("sanitizes signed adjustments and unsigned archives", () => {
    const value = {
      "community:7": 12.6,
      "igdb:8": -20,
      "unknown:-1": 0,
      "invalid:9": 10,
      "custom:nope": 10,
      "igdb:10": Number.POSITIVE_INFINITY,
      bad: 1,
    };
    expect(sanitizeGameSecondsRecord(value, { signed: true })).toEqual({
      "community:7": 13,
      "igdb:8": -20,
    });
    expect(sanitizeGameSecondsRecord(value, { signed: false })).toEqual({
      "community:7": 13,
    });
  });
});
