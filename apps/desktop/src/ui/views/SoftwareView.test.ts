import { describe, expect, it } from "vitest";
import type { ExeCacheEntry } from "../../store";
import { buildSoftwareRows } from "./SoftwareView";

const now = new Date(2026, 8, 26, 12).getTime();
const today = "2026-09-26";

function tool(exeName: string, overrides: Partial<ExeCacheEntry> = {}) {
  return [
    exeName.toLowerCase(),
    {
      exeName,
      state: "tool",
      gameId: 1,
      gameName: "Tool",
      coverUrl: "",
      source: "community",
      lastCheckedAt: "2026-09-26T00:00:00.000Z",
      ...overrides,
    } satisfies ExeCacheEntry,
  ] as const;
}

describe("Software page rows", () => {
  it("groups a tool's executables, hides unused and ignored ones, and puts running first", () => {
    const rows = buildSoftwareRows({
      exeCache: new Map<string, ExeCacheEntry>([
        tool("upc.exe", { gameId: 9, gameName: "Ubisoft Connect" }),
        tool("UbisoftConnect.exe", { gameId: 9, gameName: "Ubisoft Connect" }),
        tool("Discord.exe", { gameId: 7, gameName: "Discord" }),
        tool("Spotify.exe", { gameId: 8, gameName: "Spotify" }),
        tool("Steam.exe", { gameId: 10, gameName: "Steam" }),
        [
          "game.exe",
          {
            exeName: "Game.exe",
            state: "matched",
            gameId: 2,
            gameName: "Game",
            lastCheckedAt: "",
          },
        ],
      ]),
      toolUsage: {
        "upc.exe": { days: { [today]: 60 } },
        "ubisoftconnect.exe": { days: { [today]: 120 }, exePath: "C:/u.exe" },
        "discord.exe": { days: { "2026-09-22": 30 } },
        "steam.exe": { days: { [today]: 999 } },
        "game.exe": { days: { [today]: 5000 } },
      },
      runningExeKeys: new Set(["discord.exe"]),
      userIgnoredProcesses: new Set(["steam.exe"]),
      now,
    });

    expect(rows.map((row) => row.name)).toEqual(["Discord", "Ubisoft Connect"]);
    expect(rows[0].running).toBe(true);
    expect(rows[1]).toMatchObject({
      exeNames: ["upc.exe", "UbisoftConnect.exe"],
      exePath: "C:/u.exe",
      summary: { todaySeconds: 180, weekSeconds: 180, totalSeconds: 180 },
    });
  });
});
