import { describe, expect, it } from "vitest";
import {
  planUpdateNotice,
  UPDATE_RECHECK_MS,
  UPDATE_RETRY_MS,
} from "./updateNotice";

describe("update notice", () => {
  it("opens the window on the first successful check with an update", () => {
    expect(
      planUpdateNotice({
        outcome: "available",
        hadSuccessfulCheck: false,
        gameRunning: false,
      }),
    ).toEqual({ reveal: true, nextCheckMs: UPDATE_RECHECK_MS });
  });

  it("stays quiet while a game is running", () => {
    expect(
      planUpdateNotice({
        outcome: "available",
        hadSuccessfulCheck: false,
        gameRunning: true,
      }).reveal,
    ).toBe(false);
  });

  it("stays quiet on later checks", () => {
    expect(
      planUpdateNotice({
        outcome: "available",
        hadSuccessfulCheck: true,
        gameRunning: false,
      }),
    ).toEqual({ reveal: false, nextCheckMs: UPDATE_RECHECK_MS });
  });

  it("stays quiet without an update", () => {
    expect(
      planUpdateNotice({
        outcome: "current",
        hadSuccessfulCheck: false,
        gameRunning: false,
      }),
    ).toEqual({ reveal: false, nextCheckMs: UPDATE_RECHECK_MS });
  });

  it("retries a failed check soon without counting it", () => {
    expect(
      planUpdateNotice({
        outcome: "failed",
        hadSuccessfulCheck: false,
        gameRunning: false,
      }),
    ).toEqual({ reveal: false, nextCheckMs: UPDATE_RETRY_MS });
  });
});
