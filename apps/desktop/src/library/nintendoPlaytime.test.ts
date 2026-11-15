import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryProviderId, Session } from "@playcounter/shared";
import { milestoneMetrics } from "../milestones";
import { createGameIdentityResolver, useAppStore } from "../store";
import { commitLibraryImports } from "./commit";
import { providerFloors } from "./playtimeFloor";
import type { LibraryImportCommit } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

// docs/nintendo-import-plan.md, "How it fits the app": Nintendo is a console
// launcher like PlayStation. Its time never overlaps this PC's sessions, so it
// is added to this PC's side, and console launchers add up among themselves.

const H = 3600;
const START = "2026-11-14T12:00:00.000Z";

function read(
  provider: LibraryProviderId,
  externalId: string,
  hours: number,
): LibraryImportCommit {
  return {
    entry: {
      provider,
      externalId,
      gameId: 1,
      igdbId: 26_758,
      source: "igdb",
      name: "Hollow Knight",
      coverUrl: "",
      importedAt: START,
      lastReadAt: START,
      providerSeconds: hours * H,
      linkedExeNames: [],
      linkedExeSources: [],
    },
    metadata: {
      id: 1,
      igdbId: 26_758,
      name: "Hollow Knight",
      coverUrl: "",
      source: "igdb",
    },
    exeCacheEntries: [],
    scopedLinks: [],
  };
}

const nintendo = (hours: number, titleId = "0100633007d48000") =>
  read("nintendo", titleId, hours);
const sony = (hours: number) => read("playstation", "10000886", hours);
const steam = (hours: number) => read("steam", "367520", hours);

let nextSessionId = 1;
function play(hours: number, startedAt: string, origin?: "manual") {
  const started = Date.parse(startedAt);
  const session: Session = {
    id: nextSessionId++,
    gameId: 1,
    igdbId: 26_758,
    source: "igdb",
    gameName: "Hollow Knight",
    exeName: origin ? "" : "hollow_knight.exe",
    startedAt,
    endedAt: new Date(started + hours * H * 1000).toISOString(),
    durationSeconds: hours * H,
    ...(origin ? { origin } : {}),
  };
  useAppStore.setState((state) => ({
    recentSessions: [session, ...state.recentSessions],
  }));
}

/** The lifetime total every screen shows for the game, in hours. */
function shownHours() {
  const state = useAppStore.getState();
  const metrics = milestoneMetrics({
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
  });
  return metrics.games.get("igdb#26758")?.hours;
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

describe("Nintendo time is console time", () => {
  it("a game with PlayStation and Nintendo time shows both added up", () => {
    commitLibraryImports([sony(10), nintendo(5)]);
    expect(shownHours()).toBe(15);
  });

  it("a game with Steam and Nintendo time shows both added up", () => {
    commitLibraryImports([steam(4), nintendo(5)]);
    expect(shownHours()).toBe(9);
  });

  it("two Nintendo title ids IGDB calls one game add up", () => {
    commitLibraryImports([
      nintendo(3, "0100633007d48000"),
      nintendo(2, "0100abcd00010000"),
    ]);
    expect(shownHours()).toBe(5);
  });

  it("hours timed by hand on a game with Nintendo data are not counted twice", () => {
    play(5, "2026-11-01T12:00:00.000Z", "manual");
    commitLibraryImports([nintendo(6)]);
    expect(shownHours()).toBe(6);
  });

  it("time PlayCounter tracked on this PC stays on top of Nintendo's: added, never compared", () => {
    play(50, "2026-11-01T12:00:00.000Z");
    commitLibraryImports([nintendo(13)]);
    expect(shownHours()).toBe(63);
  });
});
