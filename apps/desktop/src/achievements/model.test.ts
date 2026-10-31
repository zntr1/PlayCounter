import { describe, expect, it } from "vitest";
import type { GameAchievement } from "@playcounter/shared";
import {
  achievementSummary,
  filterAchievements,
  isConcealed,
  mergeSteamCatalog,
  orderAchievements,
  parseAchievementList,
} from "./model";

function achievement(
  id: string,
  fields: Partial<GameAchievement> = {},
): GameAchievement {
  return {
    id,
    name: id,
    description: "",
    hidden: false,
    unlocked: false,
    ...fields,
  };
}

describe("order", () => {
  it("puts unlocked first, newest unlock first", () => {
    const order = orderAchievements([
      achievement("locked"),
      achievement("old", { unlocked: true, unlockedAt: 1_000 }),
      achievement("new", { unlocked: true, unlockedAt: 5_000 }),
      achievement("no-date", { unlocked: true }),
    ]).map((a) => a.id);
    expect(order).toEqual(["new", "old", "no-date", "locked"]);
  });

  it("puts started locked ones closest to done first, then the most common, then by name", () => {
    const order = orderAchievements([
      achievement("b-unknown"),
      achievement("a-unknown"),
      achievement("rare", { globalPercent: 2 }),
      achievement("common", { globalPercent: 60 }),
      achievement("half", { progress: { current: 5, target: 10 } }),
      achievement("almost", { progress: { current: 9, target: 10 } }),
      // 0 / 100 is not started: it sorts by how common it is.
      achievement("not-started", {
        globalPercent: 3,
        progress: { current: 0, target: 100 },
      }),
    ]).map((a) => a.id);
    expect(order).toEqual([
      "almost",
      "half",
      "common",
      "not-started",
      "rare",
      "a-unknown",
      "b-unknown",
    ]);
  });
});

describe("summary", () => {
  it("counts unlocked of all, with the percent rounded down", () => {
    expect(
      achievementSummary([
        achievement("a", { unlocked: true }),
        achievement("b"),
        achievement("c"),
      ]),
    ).toEqual({ total: 3, unlocked: 1, percent: 33 });
  });

  it("adds Gamerscore only when the list has any", () => {
    expect(
      achievementSummary([
        achievement("a", { unlocked: true, gamerscore: 30 }),
        achievement("b", { gamerscore: 70 }),
      ]),
    ).toEqual({
      total: 2,
      unlocked: 1,
      percent: 50,
      gamerscore: { earned: 30, total: 100 },
    });
  });

  it("shows 100 only when everything is unlocked", () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      achievement(String(index), { unlocked: index > 0 }),
    );
    expect(achievementSummary(many).percent).toBe(99);
    expect(achievementSummary([]).percent).toBe(0);
  });
});

describe("filters", () => {
  const list = [achievement("u", { unlocked: true }), achievement("l")];

  it("all, unlocked and locked", () => {
    expect(filterAchievements(list, "all").map((a) => a.id)).toEqual([
      "u",
      "l",
    ]);
    expect(filterAchievements(list, "unlocked").map((a) => a.id)).toEqual([
      "u",
    ]);
    expect(filterAchievements(list, "locked").map((a) => a.id)).toEqual(["l"]);
  });
});

describe("hidden achievements", () => {
  it("stay concealed while locked, until shown", () => {
    const secret = achievement("s", { hidden: true });
    expect(isConcealed(secret, new Set())).toBe(true);
    expect(isConcealed(secret, new Set(["s"]))).toBe(false);
    expect(isConcealed({ ...secret, unlocked: true }, new Set())).toBe(false);
    expect(isConcealed(achievement("open"), new Set())).toBe(false);
  });
});

describe("Steam's public list", () => {
  it("adds the share of players and the achievements this PC's file lacks, as locked", () => {
    const merged = mergeSteamCatalog(
      [
        achievement("FIRST", { name: "Der Narr", unlocked: true }),
        achievement("SECOND"),
      ],
      [
        {
          id: "FIRST",
          name: "The Fool",
          description: "",
          hidden: false,
          globalPercent: 74,
        },
        {
          id: "NEW",
          name: "Hochsicherheitszone",
          description: "Brich aus Arkham aus",
          hidden: false,
          iconUrl: "https://shared.steamstatic.com/a.jpg",
          globalPercent: 20.6,
        },
      ],
    );
    expect(merged).toEqual([
      achievement("FIRST", {
        name: "Der Narr",
        unlocked: true,
        globalPercent: 74,
      }),
      achievement("SECOND"),
      achievement("NEW", {
        name: "Hochsicherheitszone",
        description: "Brich aus Arkham aus",
        iconUrl: "https://shared.steamstatic.com/a.jpg",
        globalPercent: 20.6,
      }),
    ]);
  });

  it("keeps the local texts: they are in the player's language and current", () => {
    const [first] = mergeSteamCatalog(
      [achievement("FIRST", { name: "Der Narr", description: "Lokal" })],
      [{ id: "FIRST", name: "Other", description: "Remote", hidden: true }],
    );
    expect(first).toEqual(
      achievement("FIRST", { name: "Der Narr", description: "Lokal" }),
    );
  });
});

describe("stored lists", () => {
  const valid = {
    provider: "xbox",
    externalId: "1234567",
    fetchedAt: 1_700_000_000_000,
    achievements: [
      {
        id: "scid:1",
        name: "Win",
        description: "Win a race",
        hidden: false,
        unlocked: true,
        unlockedAt: 1_600_000_000_000,
        iconUrl: "https://images-eds-ssl.xboxlive.com/image?url=x",
        gamerscore: 30,
        globalPercent: 12.5,
        progress: { current: 3, target: 5 },
      },
    ],
  };

  it("accepts a well-formed list", () => {
    expect(parseAchievementList(valid)).toEqual(valid);
  });

  it("rejects lists that are not lists", () => {
    expect(parseAchievementList(null)).toBeNull();
    expect(parseAchievementList({ ...valid, provider: "psn" })).toBeNull();
    expect(parseAchievementList({ ...valid, externalId: "abc" })).toBeNull();
    expect(parseAchievementList({ ...valid, achievements: "nope" })).toBeNull();
    expect(
      parseAchievementList({
        ...valid,
        achievements: [{ ...valid.achievements[0], unlocked: "yes" }],
      }),
    ).toBeNull();
  });

  it("drops fields it can't trust instead of the list", () => {
    const parsed = parseAchievementList({
      ...valid,
      achievements: [
        {
          ...valid.achievements[0],
          iconUrl: "http://evil.example/x.png",
          globalPercent: 140,
          progress: { current: 1, target: 0 },
          gamerscore: -5,
        },
        // Unlock time on a locked achievement means nothing.
        { ...valid.achievements[0], id: "scid:2", unlocked: false },
        // The same id twice: the first one counts.
        { ...valid.achievements[0], name: "Copy" },
      ],
    });
    expect(parsed?.achievements).toEqual([
      {
        id: "scid:1",
        name: "Win",
        description: "Win a race",
        hidden: false,
        unlocked: true,
        unlockedAt: 1_600_000_000_000,
      },
      {
        id: "scid:2",
        name: "Win",
        description: "Win a race",
        hidden: false,
        unlocked: false,
        iconUrl: "https://images-eds-ssl.xboxlive.com/image?url=x",
        gamerscore: 30,
        globalPercent: 12.5,
        progress: { current: 3, target: 5 },
      },
    ]);
  });
});
