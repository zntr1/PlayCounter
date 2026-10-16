import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@playcounter/shared";
import { milestoneMetrics, recordedSecondsByGame } from "../milestones";
import { persistAppState, STORAGE_KEY } from "../persistence";
import {
  effectiveTotalSeconds,
  trackedSinceReadSeconds,
} from "../playtimeAdjustments";
import { createGameIdentityResolver, useAppStore } from "../store";
import {
  fillRecordedSecondsAtRead,
  hydrate,
  removeHistorySession,
  setGamePlaytime,
} from "../tracker";
import { commitLibraryImports, recordedSecondsAtRead } from "./commit";
import { providerFloors } from "./playtimeFloor";
import type { LibraryImportCommit, LibraryImportEntry } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

const H = 3600;
const IMPORTED_AT = "2026-10-01T12:00:00.000Z";

const steamEntry: LibraryImportEntry = {
  provider: "steam",
  externalId: "100",
  gameId: 1,
  igdbId: 100,
  source: "igdb",
  name: "Shared game",
  coverUrl: "",
  importedAt: IMPORTED_AT,
  lastReadAt: IMPORTED_AT,
  providerSeconds: 100 * H,
  linkedExeNames: [],
  linkedExeSources: [],
};

function steamRead(hours: number, readAt = IMPORTED_AT): LibraryImportCommit {
  return {
    entry: { ...steamEntry, providerSeconds: hours * H, lastReadAt: readAt },
    metadata: {
      id: 1,
      igdbId: 100,
      name: "Shared game",
      coverUrl: "",
      source: "igdb",
    },
    exeCacheEntries: [],
    scopedLinks: [],
  };
}

let nextSessionId = 1;
function session(hours: number, startedAt: string): Session {
  const started = Date.parse(startedAt);
  return {
    id: nextSessionId++,
    gameId: 1,
    igdbId: 100,
    source: "igdb",
    gameName: "Shared game",
    exeName: "shared.exe",
    startedAt,
    endedAt: new Date(started + hours * H * 1000).toISOString(),
    durationSeconds: hours * H,
  };
}

function play(hours: number, startedAt: string) {
  useAppStore.setState((state) => ({
    recentSessions: [session(hours, startedAt), ...state.recentSessions],
  }));
}

/** The lifetime total every screen shows for the game, in hours. */
function shownHours() {
  const state = useAppStore.getState();
  const metrics = milestoneMetrics({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
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

describe("imported playtime grows with PlayCounter sessions", () => {
  it("starts at the launcher total and adds every session played after the import", () => {
    play(5, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([steamRead(100)]);
    expect(shownHours()).toBe(100);

    play(5, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(105);
    play(50, "2026-10-03T12:00:00.000Z");
    expect(shownHours()).toBe(155);
  });

  it("starts at PlayCounter's time when it is higher and adds every session after", () => {
    play(120, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([steamRead(100)]);
    expect(shownHours()).toBe(120);

    play(5, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(125);
  });

  it.each([
    { launcherHours: 105, expectedHours: 105, why: "Steam saw the 5h" },
    { launcherHours: 125, expectedHours: 125, why: "plus 20h on a Steam Deck" },
    { launcherHours: 102, expectedHours: 105, why: "Steam missed 3h" },
    { launcherHours: 100, expectedHours: 105, why: "Steam saw nothing" },
    { launcherHours: 90, expectedHours: 105, why: "a lower reading" },
  ])(
    "importing again never lowers the total or counts an hour twice ($why)",
    ({ launcherHours, expectedHours }) => {
      play(5, "2026-09-20T12:00:00.000Z");
      commitLibraryImports([steamRead(100)]);
      play(5, "2026-10-02T12:00:00.000Z");
      expect(shownHours()).toBe(105);

      commitLibraryImports([
        steamRead(launcherHours, "2026-10-05T12:00:00.000Z"),
      ]);
      expect(shownHours()).toBe(expectedHours);

      play(1, "2026-10-06T12:00:00.000Z");
      expect(shownHours()).toBe(expectedHours + 1);
    },
  );

  it("keeps growing after several imports in a row", () => {
    commitLibraryImports([steamRead(100)]);
    play(5, "2026-10-02T12:00:00.000Z");
    commitLibraryImports([steamRead(105, "2026-10-03T12:00:00.000Z")]);
    commitLibraryImports([steamRead(105, "2026-10-04T12:00:00.000Z")]);
    play(2, "2026-10-05T12:00:00.000Z");
    commitLibraryImports([steamRead(107, "2026-10-06T12:00:00.000Z")]);
    expect(shownHours()).toBe(107);
    play(3, "2026-10-07T12:00:00.000Z");
    expect(shownHours()).toBe(110);
  });

  it("never shows less than the launcher total when sessions from before the import are deleted", () => {
    play(5, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([steamRead(100)]);
    useAppStore.setState({ recentSessions: [] });
    expect(shownHours()).toBe(100);
  });

  it("counts a running session's time live on top of the launcher total", () => {
    commitLibraryImports([steamRead(100)]);
    const floor = providerFloors(
      useAppStore.getState().libraryImports.values(),
    )[0];
    expect(
      effectiveTotalSeconds(
        2 * H,
        0,
        floor.seconds,
        trackedSinceReadSeconds(floor.recordedSecondsAtRead, 2 * H),
      ),
    ).toBe(102 * H);
  });
});

describe("re-import snapshot", () => {
  it.each([
    { previous: undefined, incoming: 100, recorded: 7, expected: 7 },
    {
      previous: { seconds: 100, recordedSecondsAtRead: undefined },
      incoming: 100,
      recorded: 7,
      expected: 7,
    },
    {
      previous: { seconds: 100, recordedSecondsAtRead: 5 },
      incoming: 103,
      recorded: 10,
      expected: 8,
    },
    {
      previous: { seconds: 100, recordedSecondsAtRead: 5 },
      incoming: 130,
      recorded: 10,
      expected: 10,
    },
    {
      previous: { seconds: 100, recordedSecondsAtRead: 5 },
      incoming: 90,
      recorded: 10,
      expected: 5,
    },
    // Sessions from before the last read were deleted.
    {
      previous: { seconds: 100, recordedSecondsAtRead: 5 },
      incoming: 100,
      recorded: 3,
      expected: 3,
    },
  ])(
    "$previous.seconds/$previous.recordedSecondsAtRead -> $incoming with $recorded recorded = $expected",
    ({ previous, incoming, recorded, expected }) => {
      expect(recordedSecondsAtRead(previous, incoming, recorded)).toBe(
        expected,
      );
    },
  );

  it("shows max(total before, new launcher total) after any re-import", () => {
    for (let run = 0; run < 2_000; run += 1) {
      const launcher = Math.floor(Math.random() * 500);
      const atRead = Math.floor(Math.random() * 500);
      const recorded = atRead + Math.floor(Math.random() * 200);
      const incoming = Math.floor(Math.random() * 800);
      const before = effectiveTotalSeconds(
        recorded,
        0,
        launcher,
        trackedSinceReadSeconds(atRead, recorded),
      );
      const snapshot = recordedSecondsAtRead(
        { seconds: launcher, recordedSecondsAtRead: atRead },
        Math.max(launcher, incoming),
        recorded,
      );
      const merged = Math.max(launcher, incoming);
      const after = effectiveTotalSeconds(
        recorded,
        0,
        merged,
        trackedSinceReadSeconds(snapshot, recorded),
      );
      expect(after).toBe(Math.max(before, merged));
    }
  });
});

function xboxRead(hours: number, readAt: string): LibraryImportCommit {
  const read = steamRead(hours, readAt);
  return {
    ...read,
    entry: { ...read.entry, provider: "xbox", externalId: "200" },
  };
}

describe("Hitman: Steam first, then Game Pass", () => {
  it("adds the Game Pass hours when Xbox is imported later and keeps growing", () => {
    commitLibraryImports([steamRead(40)]);
    expect(shownHours()).toBe(40);
    play(5, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(45);

    // Game Pass knows 20h from before plus the 5h PlayCounter saw.
    commitLibraryImports([xboxRead(25, "2026-10-05T12:00:00.000Z")]);
    expect(shownHours()).toBe(65);
    play(2, "2026-10-06T12:00:00.000Z");
    expect(shownHours()).toBe(67);
  });

  it("never drops when a launcher imported later knows less than PlayCounter added", () => {
    commitLibraryImports([steamRead(40)]);
    play(30, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(70);

    commitLibraryImports([xboxRead(20, "2026-10-05T12:00:00.000Z")]);
    expect(shownHours()).toBe(70);
    play(1, "2026-10-06T12:00:00.000Z");
    expect(shownHours()).toBe(71);
  });

  it("lets PlayCounter win when it has more than both launchers together", () => {
    play(80, "2026-09-20T12:00:00.000Z");
    commitLibraryImports([
      steamRead(40),
      xboxRead(20, "2026-10-01T12:00:00.000Z"),
    ]);
    expect(shownHours()).toBe(80);
    play(5, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(85);
  });

  it("gives back the hours a removed launcher's read took in", () => {
    commitLibraryImports([steamRead(40)]);
    play(5, "2026-10-02T12:00:00.000Z");
    commitLibraryImports([xboxRead(20, "2026-10-05T12:00:00.000Z")]);
    expect(shownHours()).toBe(60);
    useAppStore.getState().removeLibraryImport("xbox", "200");
    expect(shownHours()).toBe(45);
  });

  it("drops only Steam's hours when Steam is removed", () => {
    commitLibraryImports([
      steamRead(40),
      xboxRead(20, "2026-10-01T12:00:00.000Z"),
    ]);
    play(5, "2026-10-02T12:00:00.000Z");
    expect(shownHours()).toBe(65);
    useAppStore.getState().removeLibraryImport("steam", "100");
    expect(shownHours()).toBe(25);
  });
});

describe("PlayCounter time from before the import removed later", () => {
  const hoursOf = (sessions: Session[]) =>
    sessions.reduce((total, entry) => total + entry.durationSeconds! / H, 0);
  const randomHours = (max: number) => Math.floor(Math.random() * (max + 1));

  it("never holds back the sessions played after the import", () => {
    for (let run = 0; run < 100; run += 1) {
      useAppStore.setState(useAppStore.getInitialState(), true);
      const before = [0, 1, 2, 3].map((day) =>
        session(randomHours(30), `2026-09-1${day}T12:00:00.000Z`),
      );
      useAppStore.setState({ recentSessions: before });
      const launcherHours = randomHours(100);
      commitLibraryImports([steamRead(launcherHours)]);

      const removed = before.filter(() => Math.random() < 0.5);
      for (const entry of removed) removeHistorySession(entry.id);
      const newHours = randomHours(20);
      play(newHours, "2026-10-02T12:00:00.000Z");

      expect(shownHours()).toBe(
        Math.max(hoursOf(before) - hoursOf(removed), launcherHours) + newHours,
      );
    }
  });

  it.each([
    { launcherHours: 100, expectedHours: 103, why: "Steam saw nothing" },
    { launcherHours: 103, expectedHours: 103, why: "Steam saw the 3h" },
    { launcherHours: 110, expectedHours: 110, why: "plus 7h elsewhere" },
  ])(
    "keeps the sessions played after the import when importing again ($why)",
    ({ launcherHours, expectedHours }) => {
      const old = session(5, "2026-09-20T12:00:00.000Z");
      useAppStore.setState({ recentSessions: [old] });
      commitLibraryImports([steamRead(100)]);
      removeHistorySession(old.id);
      play(3, "2026-10-02T12:00:00.000Z");
      expect(shownHours()).toBe(103);

      commitLibraryImports([
        steamRead(launcherHours, "2026-10-05T12:00:00.000Z"),
      ]);
      expect(shownHours()).toBe(expectedHours);
      play(1, "2026-10-06T12:00:00.000Z");
      expect(shownHours()).toBe(expectedHours + 1);
    },
  );
});

function setTotal(hours: number) {
  setGamePlaytime({
    gameId: 1,
    igdbId: 100,
    gameName: "Shared game",
    coverUrl: "",
    source: "igdb",
    exeName: "shared.exe",
    targetSeconds: hours * H,
  });
}

describe("Set total before the first import", () => {
  it.each([
    { totalHours: 100, expectedHours: 100, why: "the Steam hours typed in" },
    { totalHours: 30, expectedHours: 100, why: "lower: Steam wins" },
    { totalHours: 150, expectedHours: 150, why: "higher: it wins" },
  ])(
    "counts no hour twice when the launcher is imported ($why)",
    ({ totalHours, expectedHours }) => {
      play(5, "2026-09-20T12:00:00.000Z");
      setTotal(totalHours);
      commitLibraryImports([steamRead(100)]);
      expect(shownHours()).toBe(expectedHours);
      play(1, "2026-10-02T12:00:00.000Z");
      expect(shownHours()).toBe(expectedHours + 1);
    },
  );
});

describe("Set total on an imported game", () => {
  it.each([
    { targetHours: 200, why: "above the shown total" },
    { targetHours: 120, why: "below the shown total" },
    { targetHours: 80, why: "below the launcher total" },
    { targetHours: 0, why: "zero" },
  ])(
    "shows exactly the new total and keeps adding sessions ($why)",
    ({ targetHours }) => {
      play(5, "2026-09-20T12:00:00.000Z");
      commitLibraryImports([steamRead(100)]);
      play(50, "2026-10-02T12:00:00.000Z");
      expect(shownHours()).toBe(150);

      setTotal(targetHours);
      expect(shownHours()).toBe(targetHours);
      play(1, "2026-10-03T12:00:00.000Z");
      expect(shownHours()).toBe(targetHours + 1);
    },
  );

  it.each([
    { launcherHours: 100, expectedHours: 120, why: "Steam saw nothing" },
    { launcherHours: 150, expectedHours: 120, why: "Steam saw the 50h" },
    { launcherHours: 160, expectedHours: 130, why: "plus 10h elsewhere" },
  ])(
    "keeps the change on top when importing again ($why)",
    ({ launcherHours, expectedHours }) => {
      commitLibraryImports([steamRead(100)]);
      play(50, "2026-10-02T12:00:00.000Z");
      setTotal(120);
      commitLibraryImports([
        steamRead(launcherHours, "2026-10-05T12:00:00.000Z"),
      ]);
      expect(shownHours()).toBe(expectedHours);
    },
  );

  it("goes back to the launcher total plus new sessions when reset", () => {
    commitLibraryImports([steamRead(100)]);
    play(50, "2026-10-02T12:00:00.000Z");
    setTotal(120);
    setTotal(150);
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
    expect(shownHours()).toBe(150);
  });
});

describe("launchers combined", () => {
  const xboxEntry: LibraryImportEntry = {
    ...steamEntry,
    provider: "xbox",
    externalId: "200",
    providerSeconds: 30 * H,
  };

  it("counts PlayCounter time from the newest launcher read on", () => {
    const [floor] = providerFloors([
      { ...steamEntry, recordedSecondsAtRead: 5 * H },
      {
        ...xboxEntry,
        lastReadAt: "2026-10-05T12:00:00.000Z",
        recordedSecondsAtRead: 8 * H,
      },
    ]);
    expect(floor).toMatchObject({
      seconds: 130 * H,
      recordedSecondsAtRead: 8 * H,
    });
    expect(
      effectiveTotalSeconds(
        10 * H,
        0,
        floor.seconds,
        trackedSinceReadSeconds(floor.recordedSecondsAtRead, 10 * H),
      ),
    ).toBe(132 * H);
  });

  it("does not grow while one launcher read has no snapshot", () => {
    const [floor] = providerFloors([
      { ...steamEntry, recordedSecondsAtRead: 5 * H },
      xboxEntry,
    ]);
    expect(floor.recordedSecondsAtRead).toBeUndefined();
    expect(
      effectiveTotalSeconds(
        10 * H,
        0,
        floor.seconds,
        trackedSinceReadSeconds(floor.recordedSecondsAtRead, 10 * H),
      ),
    ).toBe(130 * H);
  });
});

describe("imports saved before the snapshot existed", () => {
  it("counts sessions before the last read and all archived time as already in the launcher total", () => {
    const imports = new Map([["steam:100", steamEntry]]);
    const filled = fillRecordedSecondsAtRead(
      imports,
      recordedSecondsByGame({
        sessions: [
          session(2, "2026-09-20T12:00:00.000Z"),
          session(3, "2026-10-02T12:00:00.000Z"),
          {
            ...session(1, "2026-09-01T00:00:00.000Z"),
            startedAt: "not a date",
          },
        ],
        archivedGameSeconds: { "igdb:1": 4 * H },
        resolveIgdbId: createGameIdentityResolver(
          new Map(),
          new Map(),
          imports,
        ),
      }),
    );
    expect([...filled]).toEqual(["igdb#100"]);
    expect(imports.get("steam:100")?.recordedSecondsAtRead).toBe(7 * H);
  });

  it("leaves imports without a launcher total and filled snapshots alone", () => {
    const imports = new Map([
      ["steam:100", { ...steamEntry, recordedSecondsAtRead: 1 }],
      [
        "battlenet:x",
        {
          ...steamEntry,
          provider: "battlenet" as const,
          externalId: "x",
          providerSeconds: null,
        },
      ],
    ]);
    expect(
      fillRecordedSecondsAtRead(
        imports,
        recordedSecondsByGame({ sessions: [], archivedGameSeconds: {} }),
      ).size,
    ).toBe(0);
    expect(imports.get("battlenet:x")?.recordedSecondsAtRead).toBeUndefined();
  });

  it("fills the snapshot on startup, keeps it after a restart, and the total only grows", async () => {
    useAppStore.setState({
      libraryImports: new Map([["steam:100", steamEntry]]),
      recentSessions: [
        session(5, "2026-09-20T12:00:00.000Z"),
        session(4, "2026-10-02T12:00:00.000Z"),
      ],
    });
    expect(shownHours()).toBe(100);
    persistAppState(useAppStore.getState());
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.libraryImports[0].recordedSecondsAtRead).toBeUndefined();

    useAppStore.setState(useAppStore.getInitialState(), true);
    await hydrate();
    expect(
      useAppStore.getState().libraryImports.get("steam:100")
        ?.recordedSecondsAtRead,
    ).toBe(5 * H);
    expect(shownHours()).toBe(104);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).libraryImports[0]
        .recordedSecondsAtRead,
    ).toBe(5 * H);
  });

  it.each([
    {
      adjustmentHours: -5,
      expectedHours: 100,
      keptHours: undefined,
      why: "a lower total that did nothing",
    },
    {
      adjustmentHours: 140,
      expectedHours: 150,
      keptHours: 50,
      why: "a higher total",
    },
  ])(
    "keeps the total a save showed after Set total ($why)",
    async ({ adjustmentHours, expectedHours, keptHours }) => {
      useAppStore.setState({
        libraryImports: new Map([["steam:100", steamEntry]]),
        recentSessions: [session(10, "2026-09-20T12:00:00.000Z")],
        playtimeAdjustments: { "igdb:1": adjustmentHours * H },
      });
      persistAppState(useAppStore.getState());

      for (const restart of [1, 2]) {
        useAppStore.setState(useAppStore.getInitialState(), true);
        await hydrate();
        expect(shownHours(), `restart ${restart}`).toBe(expectedHours);
        expect(useAppStore.getState().playtimeAdjustments["igdb:1"]).toBe(
          keptHours === undefined ? undefined : keptHours * H,
        );
      }
      play(1, "2026-10-02T12:00:00.000Z");
      expect(shownHours()).toBe(expectedHours + 1);
    },
  );
});
