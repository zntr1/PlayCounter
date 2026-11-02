import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { applyLanguage } from "../i18n";
import { useKeptLogins } from "../library/keptLogins";
import { clearLoginHealth, getLoginHealth } from "../library/loginHealth";
import type { LibraryImportEntry } from "../library/types";
import { useAppStore } from "../store";
import { RATE_LIMIT_WAIT_MS, readPlayStationTrophies } from "./playstation";

// docs/psn-trophies-plan.md, "Rules" 1, 6 and 8, and "States".

const NOW = Date.parse("2026-11-02T12:00:00.000Z");

const eldenRing: LibraryImportEntry = {
  provider: "playstation",
  externalId: "10000333",
  igdbId: 119133,
  gameId: 7,
  source: "igdb",
  name: "Elden Ring",
  coverUrl: "",
  importedAt: "2026-11-01T20:00:00.000Z",
  lastReadAt: "2026-11-01T20:00:00.000Z",
  providerSeconds: 10 * 3600,
  linkedExeNames: [],
  linkedExeSources: [],
  consoleTitleIds: ["PPSA04609_00", "CUSA18638_00"],
};

/** One trophy as playstation_trophies.rs sends it (a written example). */
const godrick = {
  id: "NPWR22810_00:2",
  name: "Shardbearer Godrick",
  description: "About Shardbearer Godrick",
  hidden: false,
  unlocked: true,
  unlockedAt: 1_793_395_328_000,
  iconUrl: "https://image.api.playstation.com/trophy/np/NPWR22810_00_00/2.PNG",
  globalPercent: 58.1,
  trophyType: "bronze",
};

/** What the Rust part answers. */
function sony(answer: () => unknown) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "playstation_read_trophies") return answer();
    if (command === "logins_list") return useKeptLogins.getState().logins;
    throw new Error(`unexpected ${command}`);
  });
}

const reads = () =>
  invokeMock.mock.calls.filter(
    ([command]) => command === "playstation_read_trophies",
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  invokeMock.mockReset();
  useAppStore.setState({
    libraryImports: new Map([["playstation:10000333", eldenRing]]),
  });
  useKeptLogins.setState({
    logins: [{ service: "playstation", name: "zesarex_ps", savedAt: 1 }],
  });
  clearLoginHealth("playstation");
});

afterEach(() => {
  applyLanguage("en");
  vi.useRealTimers();
});

describe("a game's trophies", () => {
  it("are asked for with the game's saved copies, in the app's language", async () => {
    sony(() => ({ status: "valid", value: [godrick] }));
    expect(await readPlayStationTrophies("10000333")).toEqual({
      list: {
        provider: "playstation",
        externalId: "10000333",
        fetchedAt: NOW,
        achievements: [godrick],
      },
    });
    expect(reads()).toEqual([
      [
        "playstation_read_trophies",
        { titleIds: ["PPSA04609_00", "CUSA18638_00"], language: "en-US" },
      ],
    ]);
    applyLanguage("de");
    await readPlayStationTrophies("10000333");
    expect(reads()[1][1]).toEqual({
      titleIds: ["PPSA04609_00", "CUSA18638_00"],
      language: "de-DE",
    });
  });

  it("are none when no copy of the game has a trophy list", async () => {
    sony(() => ({ status: "valid", value: [] }));
    expect(await readPlayStationTrophies("10000333")).toEqual({
      status: "noAchievements",
    });
  });

  it("ask nothing for a game without saved copies", async () => {
    sony(() => ({ status: "valid", value: [godrick] }));
    useAppStore.setState({
      libraryImports: new Map([
        ["playstation:10000333", { ...eldenRing, consoleTitleIds: [] }],
      ]),
    });
    expect(await readPlayStationTrophies("10000333")).toEqual({
      status: "noAchievements",
    });
    // Not in My Games at all.
    expect(await readPlayStationTrophies("10002684")).toEqual({
      status: "noAchievements",
    });
    expect(reads()).toHaveLength(0);
  });

  it("show on Launcher accounts that the kept sign-in works", async () => {
    sony(() => ({ status: "valid", value: [godrick] }));
    await readPlayStationTrophies("10000333");
    expect(getLoginHealth("playstation")?.status).toBe("valid");
  });
});

describe("an answer without trophies", () => {
  it.each([
    ["signedOut", "noLogin"],
    ["needsSignIn", "needsSignIn"],
    // A sign-in window is open.
    ["busy", "unavailable"],
    ["unavailable", "unavailable"],
  ])("Sony's %s reads as %s", async (status, expected) => {
    sony(() => ({ status }));
    expect(await readPlayStationTrophies("10000333")).toEqual({
      status: expected,
    });
  });

  it("a sign-in Sony refused shows on Launcher accounts", async () => {
    sony(() => ({ status: "needsSignIn" }));
    await readPlayStationTrophies("10000333");
    expect(getLoginHealth("playstation")?.status).toBe("needsSignIn");
  });

  it("anything else never reads as no trophies", async () => {
    for (const answer of [
      null,
      "valid",
      { status: "valid" },
      { status: "valid", value: "none" },
      { status: "valid", value: [{ id: "NPWR22810_00:2" }] },
      { status: "weird" },
    ]) {
      sony(() => answer);
      expect(
        await readPlayStationTrophies("10000333"),
        JSON.stringify(answer),
      ).toEqual({ status: "unavailable" });
    }
    sony(() => {
      throw new Error("IPC down");
    });
    expect(await readPlayStationTrophies("10000333")).toEqual({
      status: "unavailable",
    });
  });
});

describe("Sony busy", () => {
  it("asks nothing for ten minutes, then again", async () => {
    sony(() => ({ status: "unavailable", rateLimited: true }));
    expect(await readPlayStationTrophies("10000333")).toEqual({
      status: "unavailable",
    });
    expect(reads()).toHaveLength(1);
    vi.setSystemTime(NOW + RATE_LIMIT_WAIT_MS - 1_000);
    expect(await readPlayStationTrophies("10000333")).toEqual({
      status: "unavailable",
    });
    expect(reads()).toHaveLength(1);
    vi.setSystemTime(NOW + RATE_LIMIT_WAIT_MS);
    sony(() => ({ status: "valid", value: [godrick] }));
    expect(await readPlayStationTrophies("10000333")).toHaveProperty("list");
    expect(reads()).toHaveLength(2);
    expect(RATE_LIMIT_WAIT_MS).toBe(10 * 60_000);
  });
});
