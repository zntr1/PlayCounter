import { describe, expect, it } from "vitest";
import type { Session } from "@playcounter/shared";
import {
  hltbPlatform,
  hltbStorefront,
  howLongToBeatUrl,
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
        activePlaythroughId: "ng-plus",
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
        activePlaythroughId: null,
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
        activePlaythroughId: null,
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

describe("time left against the average", () => {
  const time = {
    hastilySeconds: 12 * HOUR,
    normallySeconds: 18 * HOUR,
    completelySeconds: 40 * HOUR,
    count: 312,
  };

  it("says how much is left while you are below the middle number", () => {
    expect(timeToBeatProgress(time, 12 * HOUR, false)).toEqual({
      state: "playing",
      playedSeconds: 12 * HOUR,
      averageSeconds: 18 * HOUR,
      leftSeconds: 6 * HOUR,
    });
  });

  it("says how far past the average you are once you pass it", () => {
    expect(timeToBeatProgress(time, 21 * HOUR, false)).toEqual({
      state: "playing-past",
      playedSeconds: 21 * HOUR,
      averageSeconds: 18 * HOUR,
      overSeconds: 3 * HOUR,
    });
  });

  it("compares a finished run with the average instead of counting down", () => {
    expect(timeToBeatProgress(time, 42 * HOUR, true)).toEqual({
      state: "finished",
      playedSeconds: 42 * HOUR,
      averageSeconds: 18 * HOUR,
    });
  });

  it("has nothing to measure without numbers", () => {
    expect(timeToBeatProgress(undefined, 12 * HOUR, false)).toBeNull();
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
});

describe("values for the Add your time dialog", () => {
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
