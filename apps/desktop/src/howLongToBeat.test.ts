import { describe, expect, it } from "vitest";
import type { Session } from "@playcounter/shared";
import { emptyJournal, type GameJournal } from "./personalLibrary";
import {
  hltbPlatform,
  hltbRuns,
  hltbStorefront,
  howLongToBeatSubmitUrl,
  howLongToBeatUrl,
  preferredRun,
  runDates,
  runSeconds,
  runSessions,
  splitDuration,
  timeToBeatProgress,
} from "./howLongToBeat";

const HOUR = 3_600;

function session(
  id: number,
  overrides: Partial<Session> & { hours?: number } = {},
): Session {
  const { hours = 1, ...rest } = overrides;
  return {
    id,
    gameId: 7,
    exeName: "eldenring.exe", // i18n-exempt: sample game file
    startedAt: `2026-09-${String(id).padStart(2, "0")}T18:00:00.000Z`,
    endedAt: `2026-09-${String(id).padStart(2, "0")}T19:00:00.000Z`,
    durationSeconds: hours * HOUR,
    ...rest,
  };
}

function journal(patch: Partial<GameJournal> = {}): GameJournal {
  return { ...emptyJournal({ gameId: 7, source: "igdb" }), ...patch };
}

function playthrough(
  id: string,
  completedAt: string | null = null,
): GameJournal["playthroughs"][number] {
  return {
    id,
    name: id,
    note: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    completedAt,
  };
}

describe("which hours count for time left", () => {
  it("counts only a second playthrough's own hours", () => {
    // You beat Elden Ring in 90 h, then start a second playthrough and play
    // 5 h of it: time left is measured on those 5 h, not on all 95 h.
    const sessions = [
      session(1, { hours: 60 }),
      session(2, { hours: 30 }),
      session(3, { hours: 2, playthroughId: "ng-plus" }),
    ];

    expect(
      runSeconds({
        playthroughId: "ng-plus",
        playthroughIds: ["ng-plus"],
        gameSessions: sessions,
        archivedPlaythroughSeconds: { "ng-plus": 3 * HOUR },
        gameTotalSeconds: 95 * HOUR,
      }),
    ).toBe(5 * HOUR);
  });

  it("counts imported launcher hours for a game without named playthroughs", () => {
    // 30 h on Steam before PlayCounter, then 5 h tracked: all 35 h are the run.
    expect(
      runSeconds({
        playthroughId: null,
        playthroughIds: [],
        gameSessions: [session(1, { hours: 5 })],
        archivedPlaythroughSeconds: {},
        gameTotalSeconds: 35 * HOUR,
      }),
    ).toBe(35 * HOUR);
  });

  it("gives the default playthrough everything the named ones do not have", () => {
    expect(
      runSeconds({
        playthroughId: null,
        playthroughIds: ["ng-plus"],
        gameSessions: [
          session(1, { hours: 90 }),
          session(2, { hours: 5, playthroughId: "ng-plus" }),
        ],
        archivedPlaythroughSeconds: {},
        gameTotalSeconds: 125 * HOUR,
      }),
    ).toBe(120 * HOUR);
  });
});

describe("time left: the next of the three marks", () => {
  const time = {
    hastilySeconds: 52 * HOUR,
    normallySeconds: 85 * HOUR,
    completelySeconds: 133 * HOUR,
    count: 1204,
  };

  it("counts down to the first mark you haven't reached", () => {
    expect(timeToBeatProgress(time, 42 * HOUR, false)).toEqual({
      state: "playing",
      playedSeconds: 42 * HOUR,
      nextPace: "hastily",
      leftSeconds: 10 * HOUR,
    });
  });

  it("moves on to the next mark once you pass one", () => {
    expect(timeToBeatProgress(time, 60 * HOUR, false)).toEqual({
      state: "playing",
      playedSeconds: 60 * HOUR,
      nextPace: "normally",
      leftSeconds: 25 * HOUR,
    });
  });

  it("says when you are past every mark", () => {
    expect(timeToBeatProgress(time, 140 * HOUR, false)).toEqual({
      state: "past-all",
      playedSeconds: 140 * HOUR,
    });
  });

  it("compares a finished run with the middle number instead of counting down", () => {
    expect(timeToBeatProgress(time, 90 * HOUR, true)).toEqual({
      state: "finished",
      playedSeconds: 90 * HOUR,
      averageSeconds: 85 * HOUR,
    });
  });

  it("skips a pace IGDB has no number for", () => {
    // About one in five IGDB rows lacks the middle number (third-party count,
    // 2026-10-25: 7,776 of 9,575 have it).
    const partial = {
      hastilySeconds: 52 * HOUR,
      completelySeconds: 133 * HOUR,
      count: 3,
    };
    expect(timeToBeatProgress(partial, 60 * HOUR, false)).toEqual({
      state: "playing",
      playedSeconds: 60 * HOUR,
      nextPace: "completely",
      leftSeconds: 73 * HOUR,
    });
    expect(timeToBeatProgress(partial, 60 * HOUR, true)).toEqual({
      state: "finished",
      playedSeconds: 60 * HOUR,
    });
  });

  it("has nothing to measure without numbers", () => {
    expect(timeToBeatProgress(undefined, 12 * HOUR, false)).toBeNull();
    expect(timeToBeatProgress({ count: 0 }, 12 * HOUR, false)).toBeNull();
  });
});

describe("the playthroughs to pick from", () => {
  it("shows one run with all the game's hours when there are no named playthroughs", () => {
    const played = session(1, { hours: 5 });
    const runs = hltbRuns({
      journal: journal({ status: "finished" }),
      gameSessions: [played],
      archivedPlaythroughSeconds: {},
      gameTotalSeconds: 35 * HOUR,
    });

    expect(runs).toEqual([
      {
        id: null,
        name: null,
        seconds: 35 * HOUR,
        finished: true,
        finishedAt: played.endedAt,
        active: true,
        sessions: [played],
      },
    ]);
  });

  it("finishes a named playthrough by its finish date and the default one by the Finished status", () => {
    const runs = hltbRuns({
      journal: journal({
        status: "playing",
        activePlaythroughId: "ng-plus",
        playthroughs: [
          playthrough("first", "2026-09-20T12:00:00.000Z"),
          playthrough("ng-plus"),
        ],
      }),
      gameSessions: [
        session(1, { hours: 4 }),
        session(2, { hours: 50, playthroughId: "first" }),
        session(3, { hours: 2, playthroughId: "ng-plus" }),
      ],
      archivedPlaythroughSeconds: {},
      gameTotalSeconds: 56 * HOUR,
    });

    expect(
      runs.map(({ id, seconds, finished, finishedAt, active }) => ({
        id,
        seconds,
        finished,
        finishedAt,
        active,
      })),
    ).toEqual([
      // The game's status is In progress, so the default run is not finished.
      {
        id: null,
        seconds: 4 * HOUR,
        finished: false,
        finishedAt: undefined,
        active: false,
      },
      {
        id: "first",
        seconds: 50 * HOUR,
        finished: true,
        finishedAt: "2026-09-20T12:00:00.000Z",
        active: false,
      },
      {
        id: "ng-plus",
        seconds: 2 * HOUR,
        finished: false,
        finishedAt: undefined,
        active: true,
      },
    ]);
  });

  it("leaves out an empty default playthrough nobody plays", () => {
    const runs = hltbRuns({
      journal: journal({
        activePlaythroughId: "first",
        playthroughs: [playthrough("first")],
      }),
      gameSessions: [session(1, { hours: 3, playthroughId: "first" })],
      archivedPlaythroughSeconds: {},
      gameTotalSeconds: 3 * HOUR,
    });

    expect(runs.map(({ id }) => id)).toEqual(["first"]);
  });
});

describe("the playthrough the tab starts on", () => {
  it("starts on a playthrough you just finished, though the default one became active", () => {
    // Real flow: marking a named playthrough finished makes the default one
    // active again (personalLibraryStore.ts, updatePlaythrough).
    const runs = hltbRuns({
      journal: journal({
        activePlaythroughId: null,
        playthroughs: [playthrough("first", "2026-09-21T09:00:00.000Z")],
      }),
      gameSessions: [
        session(2, { hours: 1 }),
        session(20, { hours: 40, playthroughId: "first" }),
      ],
      archivedPlaythroughSeconds: {},
      gameTotalSeconds: 41 * HOUR,
    });

    expect(preferredRun(runs)?.id).toBe("first");
  });

  it("starts on the playthrough you are playing", () => {
    const runs = hltbRuns({
      journal: journal({
        status: "finished",
        activePlaythroughId: "ng-plus",
        playthroughs: [playthrough("ng-plus")],
      }),
      gameSessions: [
        session(3, { hours: 90 }),
        session(25, { hours: 5, playthroughId: "ng-plus" }),
      ],
      archivedPlaythroughSeconds: {},
      gameTotalSeconds: 95 * HOUR,
    });

    expect(preferredRun(runs)?.id).toBe("ng-plus");
  });

  it("stays on the run you finished when the new playthrough has not been played yet", () => {
    const runs = hltbRuns({
      journal: journal({
        status: "finished",
        activePlaythroughId: "ng-plus",
        playthroughs: [playthrough("ng-plus")],
      }),
      gameSessions: [session(28, { hours: 90 })],
      archivedPlaythroughSeconds: {},
      gameTotalSeconds: 90 * HOUR,
    });

    expect(preferredRun(runs)?.id).toBeNull();
  });
});

describe("HowLongToBeat links", () => {
  it("opens the game's own page when its HowLongToBeat id is known", () => {
    expect(howLongToBeatUrl("Elden Ring", 68151)).toBe(
      "https://howlongtobeat.com/game/68151",
    );
  });

  it("searches HowLongToBeat by name otherwise, without spaces in the link", () => {
    // The Rust side refuses links with whitespace, so the name is encoded.
    expect(howLongToBeatUrl("Hollow Knight: Silksong")).toBe(
      "https://howlongtobeat.com/?q=Hollow%20Knight%3A%20Silksong",
    );
  });

  it("opens HowLongToBeat's form for adding a time when the id is known", () => {
    // The address Phil copied from HowLongToBeat's submit button, 2026-11-07.
    expect(howLongToBeatSubmitUrl(23050)).toBe(
      "https://howlongtobeat.com/submit/game/23050",
    );
  });

  it("has no form link without an id: the form belongs to one game", () => {
    expect(howLongToBeatSubmitUrl()).toBeUndefined();
    expect(howLongToBeatSubmitUrl(0)).toBeUndefined();
    expect(howLongToBeatSubmitUrl(Number.NaN)).toBeUndefined();
  });
});

describe("values for adding your time", () => {
  it("splits the time the way HowLongToBeat's form asks for it", () => {
    expect(splitDuration(42 * HOUR + 13 * 60 + 5)).toEqual({
      hours: 42,
      minutes: 13,
      seconds: 5,
    });
  });

  it("starts on the run's first session and ends on its last one", () => {
    expect(
      runDates([
        session(9, { startedAt: "2026-09-09T18:00:00.000Z" }),
        session(3, { startedAt: "2026-09-03T18:00:00.000Z" }),
        session(12, {
          startedAt: "2026-09-12T18:00:00.000Z",
          endedAt: "2026-09-12T21:30:00.000Z",
        }),
      ]),
    ).toEqual({
      startedAt: "2026-09-03T18:00:00.000Z",
      lastPlayedAt: "2026-09-12T21:30:00.000Z",
    });
  });

  it("takes a run's dates from its own sessions only", () => {
    const sessions = [session(1), session(5, { playthroughId: "ng-plus" })];

    expect(runSessions(sessions, "ng-plus").map(({ id }) => id)).toEqual([5]);
    expect(runSessions(sessions, null).map(({ id }) => id)).toEqual([1]);
  });

  it("names the platform with the most hours when a run used several", () => {
    expect(
      hltbPlatform([
        session(1, { hours: 1 }),
        session(2, { hours: 3, origin: "playstation", console: "PS5" }),
      ]),
    ).toBe("PlayStation 5");
  });

  it("leaves the start date open when the run's sessions are gone", () => {
    // Only the newest 2,500 sessions are kept; imported hours have no dates.
    expect(runDates([])).toEqual({});
  });

  it("names the platform HowLongToBeat's way, PC unless an emulator or console played it", () => {
    expect(hltbPlatform([session(1)])).toBe("PC");
    expect(hltbPlatform([])).toBe("PC");
    const emulated = (emulatorId: string) =>
      hltbPlatform([
        session(1, {
          emulator: {
            emulatorId,
            label: emulatorId,
            contentKey: "content",
            display: "content",
            trust: "recognized",
          },
        }),
      ]);
    expect(emulated("cemu")).toBe("Wii U");
    expect(emulated("rpcs3")).toBe("PlayStation 3");
    expect(emulated("ppsspp")).toBe("PlayStation Portable");
    expect(emulated("duckstation")).toBe("PlayStation");
    expect(emulated("pcsx2")).toBe("PlayStation 2");
    expect(emulated("ryujinx")).toBe("Nintendo Switch");
    expect(emulated("eden")).toBe("Nintendo Switch");
    expect(emulated("azahar")).toBe("Nintendo 3DS");
    expect(emulated("melonds")).toBe("Nintendo DS");
    expect(emulated("xenia")).toBe("Xbox 360");
    expect(emulated("bluestacks")).toBe("Mobile");
    expect(emulated("dosbox")).toBe("PC");
    // Dolphin runs GameCube and Wii games, mGBA Game Boy, Game Boy Color and
    // Game Boy Advance games (its content keys drop the file extension): the
    // player picks on HowLongToBeat.
    expect(emulated("dolphin")).toBeUndefined();
    expect(emulated("mgba")).toBeUndefined();
    expect(
      hltbPlatform([session(1, { origin: "playstation", console: "PS5" })]),
    ).toBe("PlayStation 5");
    expect(
      hltbPlatform([session(1, { origin: "playstation", console: "PS4" })]),
    ).toBe("PlayStation 4");
  });

  it("names the store HowLongToBeat's way, and leaves Xbox open", () => {
    expect(hltbStorefront(["steam"])).toBe("Steam");
    expect(hltbStorefront(["epic"])).toBe("Epic Games");
    expect(hltbStorefront(["gog"])).toBe("GOG");
    expect(hltbStorefront(["battlenet"])).toBe("Battle.net");
    expect(hltbStorefront(["playstation"])).toBe("PlayStation Store");
    // HowLongToBeat has Xbox Store, Microsoft Store and Xbox Game Pass, and
    // PlayCounter can't tell which one applies.
    expect(hltbStorefront(["xbox"])).toBeUndefined();
    expect(hltbStorefront([])).toBeUndefined();
  });
});
