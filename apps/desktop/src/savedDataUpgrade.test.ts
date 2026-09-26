import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameSecondsKey } from "./gameSeconds";
import { STORAGE_KEY } from "./persistence";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: vi.fn(async () => undefined),
}));

import { useAppStore } from "./store";
import { hydrate } from "./tracker";

// Saves in the exact shape each released version wrote them. An update must
// load every one of them without losing playtime or library data, and must
// load its own save again after writing it.
const readSave = (version: string) =>
  readFileSync(
    new URL(
      `./__fixtures__/saves/playcounter-${version}.json`,
      import.meta.url,
    ),
    "utf8",
  );

const CUSTOM = "custom:-1280780723";
const v10Seconds = {
  "igdb:1001": 12_600,
  "igdb:1002": 3_000,
  [CUSTOM]: 1_200,
  "community:1003": 3_600,
};
const archivedSeconds = {
  "igdb:1001": 52_600,
  "igdb:1002": 14_800,
  [CUSTOM]: 600,
  "community:1003": 3_600,
};

let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function secondsByGame() {
  const state = useAppStore.getState();
  const totals: Record<string, number> = {};
  const add = (key: string, seconds: number) => {
    totals[key] = (totals[key] ?? 0) + seconds;
  };
  for (const session of state.recentSessions) {
    add(gameSecondsKey(session), session.durationSeconds ?? 0);
  }
  for (const [key, seconds] of Object.entries(state.archivedGameSeconds)) {
    add(key, seconds);
  }
  for (const [key, seconds] of Object.entries(state.playtimeAdjustments)) {
    add(key, seconds);
  }
  return totals;
}

async function saveAndReload() {
  // Any ordinary action saves the whole state.
  useAppStore.getState().toggleSectionCollapsed("upgrade-test");
  await Promise.resolve();
  const saved = storage.get(STORAGE_KEY);
  expect(saved).toBeDefined();
  useAppStore.setState(useAppStore.getInitialState(), true);
  storage = new Map([[STORAGE_KEY, saved!]]);
  hydrate();
}

describe.each([
  ["v1.0", v10Seconds],
  ["v1.1", archivedSeconds],
  ["v1.2", archivedSeconds],
])("upgrading a %s save", (version, expectedSeconds) => {
  function expectEverythingKept() {
    const state = useAppStore.getState();
    expect(secondsByGame()).toEqual(expectedSeconds);
    expect(state.recentSessions).toHaveLength(5);
    expect(state.activeSessions).toEqual([
      expect.objectContaining({ gameId: 1002, exeName: "Hades.exe" }),
    ]);
    expect(state.installUuid).toBe("0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0");
    expect(
      [...state.exeCache.values()].filter((entry) => entry.state === "matched"),
    ).toHaveLength(4);
    expect(state.blacklist.has("notagame.exe")).toBe(true);
    expect(state.ambiguousMatches).toHaveLength(1);
    if (version === "v1.0") return;
    expect(state.notifications).toHaveLength(1);
    expect(state.contributionCounts.verified).toBe(1);
    expect(state.awardedMilestones.map((milestone) => milestone.id)).toContain(
      "milestone:total:36000",
    );
    if (version === "v1.1") return;
    expect(state.gameJournals["igdb#119133"]).toMatchObject({
      note: "Beat Margit on the 12th try",
      favorite: true,
      status: "playing",
    });
    expect(state.personalShelves).toEqual([
      { id: "shelf-souls", name: "Soulslikes" },
    ]);
    expect(state.launchTargets.size).toBe(1);
    expect([...state.libraryImports.values()]).toEqual([
      expect.objectContaining({
        externalId: "1145360",
        providerSeconds: 90_000,
      }),
    ]);
    expect(state.playcounterLibrary.size).toBe(1);
    expect(state.libraryInstalls.size).toBe(1);
    expect(state.settings.gameLaunchingEnabled).toBe(true);
  }

  it("keeps all playtime and library data", () => {
    storage.set(STORAGE_KEY, readSave(version));
    hydrate();
    expectEverythingKept();
  });

  it("keeps everything after saving and loading again", async () => {
    storage.set(STORAGE_KEY, readSave(version));
    hydrate();
    await saveAndReload();
    expectEverythingKept();
    await saveAndReload();
    expectEverythingKept();
  });
});
