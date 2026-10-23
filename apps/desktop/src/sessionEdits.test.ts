import type { Session } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import {
  breakAround,
  changedFields,
  combineSessions,
  editSession,
  fillSessionTimes,
  overlappingSession,
  sessionNeighbours,
  splitKnobRange,
  splitSession,
  UNCHANGED_FIELDS,
  type SessionTimeField,
  type SessionTimeValues,
} from "./sessionEdits";

const at = (time: string, day = "2026-10-20") =>
  Date.parse(`${day}T${time}:00.000Z`);
const iso = (time: string, day?: string) =>
  new Date(at(time, day)).toISOString();
const hours = (value: number) => value * 3600;

let nextId = 1;
function session(
  start: string,
  end: string,
  overrides: Partial<Session> = {},
): Session {
  return {
    id: nextId++,
    gameId: 7,
    source: "community",
    gameName: "Hollow Knight",
    exeName: "hollow_knight.exe",
    startedAt: iso(start),
    endedAt: iso(end),
    durationSeconds: (at(end) - at(start)) / 1000,
    ...overrides,
  };
}

const gameKey = (entry: Session) => `${entry.source}:${entry.gameId}`;

describe("the edit box: type any two, the third fills in", () => {
  // Opened on a session from 20:00 to 21:00.
  function type(...steps: Array<[SessionTimeField, string | number]>) {
    let changed = UNCHANGED_FIELDS;
    let values: SessionTimeValues = {
      startMs: at("20:00"),
      endMs: at("21:00"),
      lengthSeconds: hours(1),
    };
    for (const [field, value] of steps) {
      changed = changedFields(changed, field);
      values = fillSessionTimes(changed, {
        ...values,
        ...(field === "start" ? { startMs: at(value as string) } : {}),
        ...(field === "end" ? { endMs: at(value as string) } : {}),
        ...(field === "length" ? { lengthSeconds: value as number } : {}),
      });
    }
    return values;
  }
  const result = (start: string, end: string, length: number) => ({
    startMs: at(start),
    endMs: at(end),
    lengthSeconds: length,
  });

  it("moves the end when only the length changes", () => {
    expect(type(["length", hours(2)])).toEqual(
      result("20:00", "22:00", hours(2)),
    );
  });

  it("changes the length when only the end changes", () => {
    expect(type(["end", "21:30"])).toEqual(
      result("20:00", "21:30", hours(1.5)),
    );
  });

  it("changes the length and keeps the end when only the start changes", () => {
    expect(type(["start", "19:30"])).toEqual(
      result("19:30", "21:00", hours(1.5)),
    );
  });

  it.each([
    {
      order: "Length → End",
      steps: [
        ["length", hours(2)],
        ["end", "23:00"],
      ],
      want: ["21:00", "23:00", hours(2)],
    },
    {
      order: "End → Length",
      steps: [
        ["end", "23:00"],
        ["length", hours(2)],
      ],
      want: ["21:00", "23:00", hours(2)],
    },
    {
      order: "Start → End",
      steps: [
        ["start", "19:00"],
        ["end", "22:00"],
      ],
      want: ["19:00", "22:00", hours(3)],
    },
    {
      order: "Start → Length",
      steps: [
        ["start", "19:00"],
        ["length", hours(1)],
      ],
      want: ["19:00", "20:00", hours(1)],
    },
    {
      order: "Length → Start",
      steps: [
        ["length", hours(2)],
        ["start", "19:00"],
      ],
      want: ["19:00", "21:00", hours(2)],
    },
  ] as const)("fills the third field after $order", ({ steps, want }) => {
    expect(
      type(...(steps as unknown as Array<[SessionTimeField, string | number]>)),
    ).toEqual(result(want[0], want[1], want[2]));
  });
});

describe("editSession", () => {
  it("moves start and end and keeps everything else", () => {
    const edited = session("20:00", "21:00", {
      note: "Beat Hornet",
      playthroughId: "steel-soul",
      origin: "manual",
      emulator: {
        emulatorId: "dolphin",
        label: "Dolphin",
        contentKey: "dolphin:game:GALE01",
        display: "Melee",
        trust: "recognized",
      },
    });
    const result = editSession([edited], edited.id, {
      startMs: at("19:00"),
      endMs: at("21:30"),
    });
    expect(result).toEqual([
      {
        ...edited,
        startedAt: iso("19:00"),
        endedAt: iso("21:30"),
        durationSeconds: hours(2.5),
      },
    ]);
  });

  it("sorts the list again, newest first", () => {
    const early = session("10:00", "11:00");
    const late = session("20:00", "21:00");
    const result = editSession([late, early], early.id, {
      startMs: at("22:00"),
      endMs: at("23:00"),
    });
    expect(result.map((entry) => entry.id)).toEqual([early.id, late.id]);
  });

  it("refuses a session under one minute", () => {
    const edited = session("20:00", "21:00");
    const sessions = [edited];
    expect(
      editSession(sessions, edited.id, {
        startMs: at("20:00"),
        endMs: at("20:00") + 30_000,
      }),
    ).toBe(sessions);
  });
});

describe("splitSession", () => {
  it("removes the break; the later part keeps the id and the note", () => {
    const whole = session("14:00", "20:00", {
      note: "Long evening",
      playthroughId: "steel-soul",
    });
    const result = splitSession(
      [whole],
      whole.id,
      { startMs: at("15:30"), endMs: at("19:00") },
      99,
    );
    expect(result).toEqual([
      {
        ...whole,
        startedAt: iso("19:00"),
        endedAt: iso("20:00"),
        durationSeconds: hours(1),
      },
      {
        ...whole,
        id: 99,
        note: undefined,
        startedAt: iso("14:00"),
        endedAt: iso("15:30"),
        durationSeconds: hours(1.5),
      },
    ]);
    expect("note" in result[1]!).toBe(false);
  });

  it("cuts without removing anything when the break has no length", () => {
    const whole = session("14:00", "16:00");
    const result = splitSession(
      [whole],
      whole.id,
      { startMs: at("15:00"), endMs: at("15:00") },
      99,
    );
    expect(result.map((entry) => entry.durationSeconds)).toEqual([
      hours(1),
      hours(1),
    ]);
  });

  it.each([
    { why: "a first part under a minute", from: "14:00", to: "15:00" },
    { why: "a second part under a minute", from: "15:00", to: "16:00" },
    { why: "a break outside the session", from: "13:00", to: "15:00" },
    { why: "a break that ends before it starts", from: "15:30", to: "15:00" },
  ])("refuses $why", ({ from, to }) => {
    const whole = session("14:00", "16:00");
    const sessions = [whole];
    expect(
      splitSession(
        sessions,
        whole.id,
        { startMs: at(from), endMs: at(to) },
        99,
      ),
    ).toBe(sessions);
  });
});

describe("combineSessions", () => {
  it("counts the gap and keeps the later session", () => {
    const first = session("20:00", "21:10", { playthroughId: "first-run" });
    const second = session("21:13", "22:30", { playthroughId: "steel-soul" });
    const result = combineSessions([second, first], first.id, second.id);
    expect(result).toEqual([
      {
        ...second,
        startedAt: iso("20:00"),
        endedAt: iso("22:30"),
        durationSeconds: hours(2.5),
      },
    ]);
  });

  it("works in either order", () => {
    const first = session("20:00", "21:10");
    const second = session("21:13", "22:30");
    expect(combineSessions([second, first], second.id, first.id)).toEqual(
      combineSessions([second, first], first.id, second.id),
    );
  });

  it("joins the notes, earlier first, cut at 1,000 characters", () => {
    const first = session("20:00", "21:00", { note: "Crashed at the boss" });
    const second = session("21:05", "22:00", { note: "Beat it" });
    expect(combineSessions([second, first], first.id, second.id)[0]!.note).toBe(
      "Crashed at the boss\nBeat it",
    );

    const long = session("20:00", "21:00", { note: "a".repeat(990) });
    const short = session("21:05", "22:00", { note: "b".repeat(50) });
    const joined = combineSessions([short, long], long.id, short.id)[0]!.note;
    expect(joined).toHaveLength(1000);
    expect(joined!.startsWith("a".repeat(990))).toBe(true);
  });

  it("keeps the one note there is and adds none", () => {
    const first = session("20:00", "21:00", { note: "Only note" });
    const second = session("21:05", "22:00");
    expect(combineSessions([second, first], first.id, second.id)[0]!.note).toBe(
      "Only note",
    );
    const third = session("22:05", "23:00");
    expect(
      "note" in combineSessions([third, second], second.id, third.id)[0]!,
    ).toBe(false);
  });

  it("is Manual when either session was", () => {
    const first = session("20:00", "21:00", { origin: "manual" });
    const second = session("21:05", "22:00");
    expect(
      combineSessions([second, first], first.id, second.id)[0]!.origin,
    ).toBe("manual");
    const third = session("22:05", "23:00");
    expect(
      combineSessions([third, second], second.id, third.id)[0]!.origin,
    ).toBeUndefined();
  });
});

describe("sessionNeighbours", () => {
  it("finds the same game's session right before and right after", () => {
    const a = session("10:00", "11:00");
    const other = session("11:30", "12:00", { gameId: 8 });
    const b = session("12:00", "13:00");
    const c = session("14:00", "15:00");
    const neighbours = sessionNeighbours([c, b, other, a], gameKey);
    expect(neighbours.get(b.id)).toEqual({ before: a, after: c });
    expect(neighbours.get(a.id)).toEqual({ before: undefined, after: b });
    expect(neighbours.get(c.id)).toEqual({ before: b, after: undefined });
    expect(neighbours.get(other.id)).toEqual({
      before: undefined,
      after: undefined,
    });
  });
});

describe("overlappingSession", () => {
  it("finds an overlap with the same game, not with another game", () => {
    const edited = session("20:00", "21:00");
    const sameGame = session("21:13", "22:30");
    const otherGame = session("21:30", "22:00", { gameId: 8 });
    const sessions = [otherGame, sameGame, edited];
    expect(
      overlappingSession(
        sessions,
        edited,
        { startMs: at("20:00"), endMs: at("21:20") },
        gameKey,
      ),
    ).toBe(sameGame);
    expect(
      overlappingSession(
        sessions,
        edited,
        { startMs: at("20:00"), endMs: at("21:13") },
        gameKey,
      ),
    ).toBeUndefined();
    expect(
      overlappingSession(
        [otherGame, edited],
        edited,
        { startMs: at("20:00"), endMs: at("21:45") },
        gameKey,
      ),
    ).toBeUndefined();
  });
});

describe("the split slider", () => {
  const minute = (time: string) => at(time) / 60_000;
  const times = { startMs: at("14:00"), endMs: at("20:00") };

  it("keeps a minute on each side without a break", () => {
    expect(splitKnobRange(times, 0)).toEqual({
      min: minute("14:01"),
      max: minute("19:59"),
    });
  });

  it("centres the break on the knob and keeps it inside the session", () => {
    const range = splitKnobRange(times, 60)!;
    expect(breakAround(range.min, 60)).toEqual({
      startMs: at("14:01"),
      endMs: at("15:01"),
    });
    expect(breakAround(range.max, 60)).toEqual({
      startMs: at("18:59"),
      endMs: at("19:59"),
    });
    expect(breakAround(minute("17:00"), 30)).toEqual({
      startMs: at("16:45"),
      endMs: at("17:15"),
    });
  });

  it("has no room for a break as long as the session", () => {
    expect(splitKnobRange(times, 6 * 60)).toBeNull();
    expect(splitKnobRange(times, 6 * 60 - 2)).toEqual({
      min: minute("17:00"),
      max: minute("17:00"),
    });
  });

  it("rounds a session with seconds inward to whole minutes", () => {
    const range = splitKnobRange(
      { startMs: at("14:00") + 30_000, endMs: at("20:00") - 30_000 },
      0,
    )!;
    expect(range).toEqual({ min: minute("14:02"), max: minute("19:58") });
    const session = {
      ...sessionAt(at("14:00") + 30_000, at("20:00") - 30_000),
    };
    for (const knob of [range.min, range.max]) {
      const parts = splitSession(
        [session],
        session.id,
        breakAround(knob, 0),
        99,
      );
      expect(parts).toHaveLength(2);
    }
  });
});

function sessionAt(startMs: number, endMs: number): Session {
  return {
    ...session("00:00", "01:00"),
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationSeconds: (endMs - startMs) / 1000,
  };
}
