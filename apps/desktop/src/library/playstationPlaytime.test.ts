import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryProviderId, Session } from "@playcounter/shared";
import { milestoneMetrics } from "../milestones";
import { persistAppState } from "../persistence";
import {
  createGameIdentityResolver,
  foldSessionsIntoArchive,
  useAppStore,
} from "../store";
import { hydrate, setGamePlaytime } from "../tracker";
import { commitLibraryImports } from "./commit";
import { providerFloors } from "./playtimeFloor";
import type { LibraryImportCommit } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

// docs/psn-import-plan.md, "Playtime: two sides": PS5 time never overlaps
// this PC's sessions, so a game's total is this PC's side plus PlayStation's.

const H = 3600;
const START = "2026-10-01T12:00:00.000Z";

function read(
  provider: LibraryProviderId,
  externalId: string,
  hours: number,
  readAt = START,
): LibraryImportCommit {
  return {
    entry: {
      provider,
      externalId,
      gameId: 1,
      igdbId: 100,
      source: "igdb",
      name: "Elden Ring",
      coverUrl: "",
      importedAt: START,
      lastReadAt: readAt,
      providerSeconds: hours * H,
      linkedExeNames: [],
      linkedExeSources: [],
    },
    metadata: {
      id: 1,
      igdbId: 100,
      name: "Elden Ring",
      coverUrl: "",
      source: "igdb",
    },
    exeCacheEntries: [],
    scopedLinks: [],
  };
}

const sony = (hours: number, readAt = START, concept = "10000333") =>
  read("playstation", concept, hours, readAt);
const steam = (hours: number, readAt = START) =>
  read("steam", "1245620", hours, readAt);

let nextSessionId = 1;
function session(
  hours: number,
  startedAt: string,
  origin?: Session["origin"],
): Session {
  const started = Date.parse(startedAt);
  return {
    id: nextSessionId++,
    gameId: 1,
    igdbId: 100,
    source: "igdb",
    gameName: "Elden Ring",
    exeName: origin === "playstation" ? "PPSA04609_00" : "eldenring.exe",
    startedAt,
    endedAt: new Date(started + hours * H * 1000).toISOString(),
    durationSeconds: hours * H,
    ...(origin ? { origin } : {}),
    ...(origin === "playstation" ? { console: "PS5" as const } : {}),
  };
}

/** A session on this PC. */
function playOnPc(hours: number, startedAt: string) {
  add(session(hours, startedAt));
}
/** A PS5 session PlayCounter saw live. */
function playOnPs5(hours: number, startedAt: string) {
  add(session(hours, startedAt, "playstation"));
}
/** Timed or logged by hand. */
function playByHand(hours: number, startedAt: string) {
  add(session(hours, startedAt, "manual"));
}
function add(entry: Session) {
  useAppStore.setState((state) => ({
    recentSessions: [entry, ...state.recentSessions],
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
  return metrics.games.get("igdb#100")?.hours;
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

describe("PS5 time and this PC's time are added, never compared", () => {
  it("example 1: 10h on PS5, then 2h on PC and 3h on PS5 is 15h, also after the refresh", () => {
    commitLibraryImports([sony(10)]);
    playOnPc(2, "2026-10-02T12:00:00.000Z");
    playOnPs5(3, "2026-10-03T12:00:00.000Z");
    expect(shownHours()).toBe(15);

    commitLibraryImports([sony(13, "2026-10-04T12:00:00.000Z")]);
    expect(shownHours()).toBe(15);
  });

  it("example 1 with Steam's own reads of the PC hours", () => {
    commitLibraryImports([steam(0), sony(10)]);
    playOnPc(2, "2026-10-02T12:00:00.000Z");
    commitLibraryImports([steam(2, "2026-10-02T20:00:00.000Z")]);
    playOnPs5(3, "2026-10-03T12:00:00.000Z");
    expect(shownHours()).toBe(15);

    commitLibraryImports([sony(13, "2026-10-04T12:00:00.000Z")]);
    expect(shownHours()).toBe(15);
    commitLibraryImports([steam(2, "2026-10-05T12:00:00.000Z")]);
    expect(shownHours()).toBe(15);
  });

  it("example 2: PS5 play while PlayCounter was off comes in with Sony's next total", () => {
    commitLibraryImports([sony(10)]);
    playOnPc(2, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(12);

    commitLibraryImports([sony(13, "2026-10-04T12:00:00.000Z")]);
    expect(shownHours()).toBe(15);
  });

  it("example 3: Sony counting part of a live session meanwhile counts it once", () => {
    commitLibraryImports([sony(10)]);
    playOnPs5(1, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(11);

    commitLibraryImports([sony(10.5, "2026-10-02T12:30:00.000Z")]);
    expect(shownHours()).toBe(11);
    commitLibraryImports([sony(11, "2026-10-02T14:00:00.000Z")]);
    expect(shownHours()).toBe(11);
  });

  it("example 4: hours timed by hand before the import are not counted twice", () => {
    playByHand(5, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([sony(6)]);
    expect(shownHours()).toBe(6);
  });

  it("example 4: a lower Sony total never lowers what was timed by hand", () => {
    playByHand(5, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([sony(4)]);
    expect(shownHours()).toBe(5);
    playOnPc(1, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(6);
  });

  it("example 5: a game without PlayStation data keeps today's numbers", () => {
    playByHand(5, "2026-09-20T12:00:00.000Z");
    playOnPc(30, "2026-09-21T12:00:00.000Z");
    commitLibraryImports([steam(40)]);
    expect(shownHours()).toBe(40);
    playOnPc(2, "2026-10-02T12:00:00.000Z");
    playByHand(1, "2026-10-03T12:00:00.000Z");
    expect(shownHours()).toBe(43);
  });

  it("PC time PlayCounter tracked without any PC launcher stays on top of Sony's", () => {
    playOnPc(50, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([sony(13)]);
    expect(shownHours()).toBe(63);
  });

  it("this PC's higher time and Sony's time are added when Steam is lower", () => {
    playOnPc(50, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([steam(40), sony(13)]);
    expect(shownHours()).toBe(63);
  });

  it("adds two PlayStation concepts IGDB calls one game", () => {
    commitLibraryImports([sony(30, START, "228748"), sony(20, START, "10009762")]);
    expect(shownHours()).toBe(50);
  });

  it("keeps counting PS5 sessions once after they move to the archive", () => {
    playOnPs5(30, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([sony(30, "2026-10-01T12:00:00.000Z")]);
    playOnPc(2, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(32);

    const state = useAppStore.getState();
    const old = state.recentSessions.filter(
      (entry) => entry.origin === "playstation",
    );
    const archive = foldSessionsIntoArchive(
      state.archivedSeconds,
      state.archivedGameSeconds,
      old,
      state.archivedPlaythroughSeconds,
      state.archivedConsoleSeconds,
    );
    useAppStore.setState({
      recentSessions: state.recentSessions.filter(
        (entry) => !old.includes(entry),
      ),
      archivedSeconds: archive.archivedSeconds,
      archivedGameSeconds: archive.archivedGameSeconds,
      archivedPlaythroughSeconds: archive.archivedPlaythroughSeconds,
      archivedConsoleSeconds: archive.archivedConsoleSeconds,
    });
    expect(archive.archivedConsoleSeconds).toEqual({ "igdb:1": 30 * H });
    expect(shownHours()).toBe(32);
  });

  it("keeps the archived PS5 share after a restart", async () => {
    const state = useAppStore.getState();
    const archive = foldSessionsIntoArchive(
      0,
      {},
      [session(4, "2026-09-01T12:00:00.000Z", "playstation")],
      {},
      {},
    );
    useAppStore.setState({ ...state, ...archive });
    persistAppState(useAppStore.getState());
    useAppStore.setState(useAppStore.getInitialState(), true);
    await hydrate();
    expect(useAppStore.getState().archivedConsoleSeconds).toEqual({
      "igdb:1": 4 * H,
    });
  });

  it("Set total still sets exactly the shown total", () => {
    commitLibraryImports([sony(10)]);
    playOnPc(2, "2026-10-02T12:00:00.000Z");
    setGamePlaytime({
      gameId: 1,
      igdbId: 100,
      gameName: "Elden Ring",
      coverUrl: "",
      source: "igdb",
      exeName: "eldenring.exe",
      targetSeconds: 20 * H,
    });
    expect(shownHours()).toBe(20);
    playOnPs5(1, "2026-10-03T12:00:00.000Z");
    expect(shownHours()).toBe(21);
  });
});
