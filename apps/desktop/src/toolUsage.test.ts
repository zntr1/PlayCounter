import { describe, expect, it } from "vitest";
import {
  carryDiscoveredSeconds,
  creditToolUsage,
  describeToolUsage,
  localDayKey,
  MAX_TOOL_TICK_GAP_MS,
  sanitizeToolUsage,
  splitByLocalDay,
  summarizeToolUsage,
  type RunningTool,
  type ToolUsageRecord,
  withToolArt,
} from "./toolUsage";

// Local times, so the tests hold in every timezone.
const at = (day: number, hour: number, minute = 0, second = 0) =>
  new Date(2026, 8, day, hour, minute, second).getTime();

const discord: RunningTool = {
  toolKey: "community:1",
  exeKey: "discord.exe",
  exePath: "C:\\Discord\\discord.exe",
};

describe("tool usage counter", () => {
  it("credits the time between two scans to a running tool", () => {
    const usage = creditToolUsage({}, [discord], at(26, 10), at(26, 10, 0, 5));
    expect(usage["discord.exe"].days).toEqual({ "2026-09-26": 5 });
    expect(usage["discord.exe"].exePath).toBe("C:\\Discord\\discord.exe");
  });

  it("credits nothing for a gap longer than the cap, but still learns the path", () => {
    const usage = creditToolUsage(
      {},
      [discord],
      at(26, 1),
      at(26, 1) + MAX_TOOL_TICK_GAP_MS + 1,
    );
    expect(usage["discord.exe"].days).toEqual({});
    expect(usage["discord.exe"].exePath).toBe("C:\\Discord\\discord.exe");
  });

  it("credits a gap exactly at the cap", () => {
    const usage = creditToolUsage(
      {},
      [discord],
      at(26, 1),
      at(26, 1) + MAX_TOOL_TICK_GAP_MS,
    );
    expect(usage["discord.exe"].days["2026-09-26"]).toBe(
      MAX_TOOL_TICK_GAP_MS / 1000,
    );
  });

  it("splits a scan that crosses local midnight", () => {
    const usage = creditToolUsage(
      {},
      [discord],
      at(26, 23, 59, 58),
      at(27, 0, 0, 3),
    );
    expect(usage["discord.exe"].days).toEqual({
      "2026-09-26": 2,
      "2026-09-27": 3,
    });
  });

  it("counts a tool with several running executables once", () => {
    const usage = creditToolUsage(
      {},
      [
        { toolKey: "community:9", exeKey: "upc.exe", exePath: null },
        { toolKey: "community:9", exeKey: "ubisoftconnect.exe", exePath: null },
        discord,
      ],
      at(26, 10),
      at(26, 10, 0, 5),
    );
    expect(usage["ubisoftconnect.exe"].days).toEqual({ "2026-09-26": 5 });
    expect(usage["upc.exe"]).toBeUndefined();
    expect(usage["discord.exe"].days).toEqual({ "2026-09-26": 5 });
  });

  it("returns the same object when nothing changed", () => {
    const usage = creditToolUsage({}, [discord], at(26, 10), at(26, 10, 0, 5));
    expect(creditToolUsage(usage, [], at(26, 10), at(26, 10, 0, 5))).toBe(
      usage,
    );
    expect(creditToolUsage(usage, [discord], at(26, 10), at(26, 10))).toBe(
      usage,
    );
  });

  it("does not mutate the previous usage", () => {
    const before = creditToolUsage({}, [discord], at(26, 10), at(26, 10, 0, 5));
    const snapshot = structuredClone(before);
    creditToolUsage(before, [discord], at(26, 10, 0, 5), at(26, 10, 0, 10));
    expect(before).toEqual(snapshot);
  });
});

describe("tool usage summary", () => {
  it("sums today, this week from Monday, and all time", () => {
    // 2026-09-26 is a Saturday; its week started on Monday 2026-09-21.
    const records: (ToolUsageRecord | undefined)[] = [
      {
        days: {
          "2026-09-26": 60,
          "2026-09-21": 30,
          "2026-09-20": 7,
        },
        carriedSeconds: 100,
      },
      { days: { "2026-09-26": 5 } },
      undefined,
    ];
    expect(summarizeToolUsage(records, at(26, 12))).toEqual({
      todaySeconds: 65,
      weekSeconds: 95,
      totalSeconds: 202,
    });
  });

  it("treats Sunday as the last day of the week", () => {
    const records: ToolUsageRecord[] = [
      { days: { "2026-09-21": 10, "2026-09-27": 20 } },
    ];
    expect(summarizeToolUsage(records, at(27, 12)).weekSeconds).toBe(30);
    expect(summarizeToolUsage(records, at(28, 12)).weekSeconds).toBe(0);
  });
});

describe("tool usage helpers", () => {
  it("uses local dates", () => {
    expect(localDayKey(at(3, 0))).toBe("2026-09-03");
    expect(splitByLocalDay(at(26, 10), at(26, 10))).toEqual([]);
  });

  it("carries Discovered time into the total only", () => {
    const usage = carryDiscoveredSeconds({}, "voicemeeter.exe", 90);
    expect(usage["voicemeeter.exe"]).toEqual({ days: {}, carriedSeconds: 90 });
    expect(carryDiscoveredSeconds(usage, "voicemeeter.exe", 0)).toBe(usage);
  });

  it("drops malformed persisted usage", () => {
    expect(
      sanitizeToolUsage({
        "Discord.exe": {
          exePath: "C:\\d.exe",
          days: { "2026-09-26": 12, bad: 5, "2026-09-25": -1 },
          carriedSeconds: Number.NaN,
        },
        "broken.exe": null,
      }),
    ).toEqual({
      "discord.exe": { exePath: "C:\\d.exe", days: { "2026-09-26": 12 } },
    });
    expect(sanitizeToolUsage([])).toEqual({});
  });
});

describe("tool art picked on this PC", () => {
  it("is stored on every exe of the tool and can be cleared", () => {
    const usage = withToolArt(
      { "upc.exe": { days: { "2026-09-26": 5 } } },
      ["upc.exe", "ubisoftconnect.exe"],
      "https://cdn2.steamgriddb.com/grid/u.png",
    );
    expect(usage["upc.exe"]).toEqual({
      days: { "2026-09-26": 5 },
      artUrl: "https://cdn2.steamgriddb.com/grid/u.png",
    });
    expect(usage["ubisoftconnect.exe"].artUrl).toBe(
      "https://cdn2.steamgriddb.com/grid/u.png",
    );
    const cleared = withToolArt(usage, ["upc.exe", "ubisoftconnect.exe"], null);
    expect(cleared["upc.exe"]).toEqual({ days: { "2026-09-26": 5 } });
    expect(cleared["ubisoftconnect.exe"]).toEqual({ days: {} });
  });

  it("survives sanitizing", () => {
    expect(
      sanitizeToolUsage({ "a.exe": { days: {}, artUrl: "https://x/a.png" } }),
    ).toEqual({ "a.exe": { days: {}, artUrl: "https://x/a.png" } });
  });
});

describe("tool usage details", () => {
  it("merges a tool's exes per day", () => {
    expect(
      describeToolUsage([
        { days: { "2026-09-20": 600, "2026-09-26": 3600 } },
        {
          days: { "2026-09-26": 1800, "2026-09-10": 60 },
          carriedSeconds: 9000,
        },
        undefined,
      ]),
    ).toEqual({
      firstDay: "2026-09-10",
      lastDay: "2026-09-26",
      daysUsed: 3,
      averagePerDaySeconds: (600 + 5400 + 60) / 3,
      longestDay: { day: "2026-09-26", seconds: 5400 },
    });
  });

  it("is empty without counted days", () => {
    expect(describeToolUsage([{ days: {}, carriedSeconds: 60 }])).toEqual({
      firstDay: null,
      lastDay: null,
      daysUsed: 0,
      averagePerDaySeconds: 0,
      longestDay: null,
    });
  });
});
