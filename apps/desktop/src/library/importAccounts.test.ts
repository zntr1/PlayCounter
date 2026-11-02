import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@playcounter/shared";
import { createTransferData } from "../backup";
import { validateBackupData } from "../backupValidation";
import { milestoneMetrics } from "../milestones";
import { createPersistedPayload, persistAppState } from "../persistence";
import { createGameIdentityResolver, useAppStore } from "../store";
import { hydrate, normalizePersistedLibraryImport } from "../tracker";
import { commitLibraryImports } from "./commit";
import { buildLibraryImportCommit } from "./importPlan";
import { providerFloors } from "./playtimeFloor";
import type { LibraryAccount, LibraryImportEntry } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

// docs/import-accounts-plan.md: each launcher account keeps its own hours of
// a game, the launcher's total is their sum (one game never runs on two
// accounts at once), and nothing saved before the change moves or counts
// twice.

const H = 3600;
const KEY = "steam:1245620";
const ELDEN_RING = {
  id: 7,
  igdbId: 119133,
  name: "Elden Ring",
  coverUrl: "",
  source: "igdb" as const,
};
const PHIL: LibraryAccount = { key: "a".repeat(32), name: "zesarex" };
const KID: LibraryAccount = { key: "b".repeat(32), name: "Kid" };

/** Steam reads Elden Ring's total for one account (none: a read from before
 *  accounts were known). */
function steamRead(
  hours: number | null,
  account?: LibraryAccount,
  options: { at?: string; partial?: boolean } = {},
) {
  commitLibraryImports([
    buildLibraryImportCommit({
      provider: "steam",
      now: options.at ?? "2026-11-01T12:00:00.000Z",
      scanned: {
        externalId: "1245620",
        name: "ELDEN RING",
        playtimeSeconds: hours === null ? null : hours * H,
        hasPlayedEvidence: true,
        inAccountLibrary: true,
        installed: false,
        executables: [],
      },
      resolved: {
        key: KEY,
        status: "resolved",
        game: ELDEN_RING,
        executables: [],
      },
      ...(account ? { account } : {}),
      ...(options.partial ? { partialRead: true } : {}),
    })!,
  ]);
}

function entry(): LibraryImportEntry {
  return useAppStore.getState().libraryImports.get(KEY)!;
}

/** Steam's total for the game, in hours. */
function steamHours() {
  return (entry().providerSeconds ?? 0) / H;
}

/** Each reading as [name, hours]; "earlier" for hours from before. */
function readings() {
  return entry().accounts?.map((reading) => [
    reading.name ?? reading.key,
    (reading.seconds ?? 0) / H,
  ]);
}

/** The lifetime total every screen shows for the game, in hours. */
function shownHours() {
  const state = useAppStore.getState();
  return milestoneMetrics({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    archivedConsoleSeconds: state.archivedConsoleSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    providerFloors: providerFloors(state.libraryImports.values()),
    resolveIgdbId: createGameIdentityResolver(
      state.gameMetadata,
      state.exeCache,
      state.libraryImports,
    ),
    verifiedContributions: 0,
  }).games.get("igdb#119133")?.hours;
}

/** A session PlayCounter saw on this PC. */
function playOnPc(hours: number, startedAt: string) {
  const started = Date.parse(startedAt);
  const session: Session = {
    id: started,
    gameId: ELDEN_RING.id,
    igdbId: ELDEN_RING.igdbId,
    source: "igdb",
    gameName: ELDEN_RING.name,
    exeName: "eldenring.exe",
    startedAt,
    endedAt: new Date(started + hours * H * 1000).toISOString(),
    durationSeconds: hours * H,
  };
  useAppStore.setState((state) => ({
    recentSessions: [session, ...state.recentSessions],
  }));
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("two accounts of one launcher", () => {
  it("add up: one game never runs on two accounts at once", () => {
    steamRead(100, PHIL);
    steamRead(20, KID);
    expect(steamHours()).toBe(120);
    expect(readings()).toEqual([
      ["zesarex", 100],
      ["Kid", 20],
    ]);
  });

  it("a later read of one account changes only its hours", () => {
    steamRead(100, PHIL);
    steamRead(20, KID);
    steamRead(105, PHIL);
    expect(steamHours()).toBe(125);
    expect(readings()).toEqual([
      ["zesarex", 105],
      ["Kid", 20],
    ]);
  });

  it("an account keeps its hours under a new name", () => {
    steamRead(100, PHIL);
    steamRead(101, { ...PHIL, name: "zesarex_new" });
    expect(steamHours()).toBe(101);
    expect(readings()).toEqual([["zesarex_new", 101]]);
  });

  it("an account's lower read keeps its higher hours, as before", () => {
    steamRead(100, PHIL);
    steamRead(90, PHIL);
    expect(steamHours()).toBe(100);
  });
});

describe("games imported before accounts were known (D1)", () => {
  it("the account with at least as many hours takes the earlier hours over", () => {
    steamRead(100);
    expect(entry().accounts).toBeUndefined();
    steamRead(105, PHIL);
    expect(steamHours()).toBe(105);
    expect(readings()).toEqual([["zesarex", 105]]);
  });

  it("an account with fewer hours is another account and counts on top", () => {
    // Before: Phil 120h and his kid's 100h, kept as the higher 120h.
    steamRead(120);
    steamRead(100, KID);
    expect(steamHours()).toBe(220);
    expect(readings()).toEqual([
      ["earlier", 120],
      ["Kid", 100],
    ]);
    steamRead(120, PHIL);
    expect(steamHours()).toBe(220);
    expect(readings()).toEqual([
      ["zesarex", 120],
      ["Kid", 100],
    ]);
  });

  it("an account with more hours takes them over, and the earlier account adds on its next read", () => {
    steamRead(100); // Phil's, before
    steamRead(150, KID);
    expect(steamHours()).toBe(150);
    steamRead(100, PHIL);
    expect(steamHours()).toBe(250);
  });

  it("a partial read, or one without hours, never splits the earlier hours", () => {
    steamRead(100);
    steamRead(50, PHIL, { partial: true });
    steamRead(null, PHIL);
    expect(steamHours()).toBe(100);
    expect(entry().accounts).toBeUndefined();
    steamRead(105, PHIL);
    expect(readings()).toEqual([["zesarex", 105]]);
  });

  it("an old save loads with every total exactly as it was", async () => {
    steamRead(100);
    const saved = entry();
    persistAppState(useAppStore.getState());
    useAppStore.setState(useAppStore.getInitialState(), true);
    await hydrate();
    expect(entry()).toEqual(saved);
  });
});

describe("a read without an account", () => {
  it("never changes the hours of a game with accounts (Check for Matches repeats the total)", () => {
    steamRead(100, PHIL);
    steamRead(20, KID);
    steamRead(120);
    expect(steamHours()).toBe(120);
    expect(readings()).toEqual([
      ["zesarex", 100],
      ["Kid", 20],
    ]);
  });
});

describe("PlayCounter's own time and a second account", () => {
  it("never lowers the total and never counts an hour twice", () => {
    steamRead(40, PHIL, { at: "2026-10-01T12:00:00.000Z" });
    playOnPc(5, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(45);
    // Phil's 40h is stale: the 5h since return with his next read.
    steamRead(20, KID, { at: "2026-10-03T12:00:00.000Z" });
    expect(shownHours()).toBe(60);
    steamRead(45, PHIL, { at: "2026-10-04T12:00:00.000Z" });
    expect(shownHours()).toBe(65);
  });
});

describe("saved data", () => {
  it("keeps the accounts through a restart, a backup and the saved-data check", async () => {
    steamRead(100, PHIL);
    steamRead(20, KID);
    persistAppState(useAppStore.getState());
    useAppStore.setState(useAppStore.getInitialState(), true);
    await hydrate();
    expect(steamHours()).toBe(120);
    expect(readings()).toEqual([
      ["zesarex", 100],
      ["Kid", 20],
    ]);

    const data = JSON.parse(
      JSON.stringify(
        createTransferData(createPersistedPayload(useAppStore.getState())),
      ),
    );
    expect(() => validateBackupData(data, "data")).not.toThrow();
    const restored = normalizePersistedLibraryImport(data.libraryImports[0])!;
    expect(restored.accounts).toEqual(entry().accounts);
    // Versions before accounts read only this: it is the sum.
    expect(restored.providerSeconds).toBe(120 * H);
  });

  it("drops a broken reading and keeps the game", () => {
    steamRead(100, PHIL);
    const restored = normalizePersistedLibraryImport({
      ...entry(),
      accounts: [
        ...entry().accounts!,
        { key: "", name: 7, seconds: -1, readAt: "never" },
      ],
    })!;
    expect(restored.accounts?.map((reading) => reading.name)).toEqual([
      "zesarex",
    ]);
  });
});
