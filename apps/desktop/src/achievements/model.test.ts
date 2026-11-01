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

describe("Epic lists", () => {
  // From Epic's Rocket League answer (app name "Sugar"), 2026-11-01.
  const icons =
    "https://shared-static-prod.epicgames.com/epic-achievements/e6bcca5b37d0457ca881aec508205542/9773aa1aa54f4f7b80e44bef04986cea/icons";
  const epicList = (
    externalId: string,
    fields: Partial<GameAchievement> = {},
  ) => ({
    provider: "epic",
    externalId,
    fetchedAt: 1_793_471_100_000,
    achievements: [
      {
        id: "1",
        name: "Stocked",
        description: "Collect 150 Items",
        hidden: false,
        unlocked: true,
        unlockedAt: 1_793_471_047_123,
        iconUrl: `${icons}/d4ecb934e2415a74c66f75c49fee22ee`,
        lockedIconUrl: `${icons}/4b370970a13bf6933ed19baf50373115`,
        globalPercent: 35,
        xp: 50,
        ...fields,
      },
    ],
  });

  it("parse with the app name as id, their XP and Epic's icons", () => {
    expect(parseAchievementList(epicList("Sugar"))).toEqual(epicList("Sugar"));
    // Epic also names apps with 32 hex digits.
    expect(
      parseAchievementList(epicList("4fe75bbc5a674f4f9b356b5c90567da5"))
        ?.externalId,
    ).toBe("4fe75bbc5a674f4f9b356b5c90567da5");
  });

  it("are dropped when the app name is not one", () => {
    for (const name of ["", "../Sugar", "Sugar Rush", "-Sugar", "a".repeat(65)])
      expect(parseAchievementList(epicList(name))).toBeNull();
  });

  it("drop icons from other hosts", () => {
    for (const url of [
      "https://evil.example/icon.png",
      "https://epicgames.com.evil.test/icon.png",
      `http://shared-static-prod.epicgames.com/icons/x`,
    ]) {
      const [parsed] = parseAchievementList(
        epicList("Sugar", { iconUrl: url, lockedIconUrl: url }),
      )!.achievements;
      expect(parsed.iconUrl).toBeUndefined();
      expect(parsed.lockedIconUrl).toBeUndefined();
    }
  });

  it("drop XP that isn't a number of points", () => {
    for (const xp of [-5, Number.NaN, "50" as unknown as number])
      expect(
        parseAchievementList(epicList("Sugar", { xp }))!.achievements[0].xp,
      ).toBeUndefined();
  });

  it("sum XP like Gamerscore: unlocked of all", () => {
    expect(
      achievementSummary([
        achievement("0", { xp: 100 }),
        achievement("1", { unlocked: true, xp: 50 }),
        achievement("10", { unlocked: true, xp: 15 }),
      ]),
    ).toEqual({
      total: 3,
      unlocked: 2,
      percent: 66,
      xp: { earned: 65, total: 165 },
    });
  });
});

describe("GOG lists", () => {
  // A written example: no real GOG answer has been seen yet. The id is the
  // GOG product id PlayCounter imports (Shadow of Mordor GOTY), not the
  // GALAXY client id GOG's achievement service is asked with.
  const gogList = (
    externalId: string,
    fields: Partial<GameAchievement> = {},
  ) => ({
    provider: "gog",
    externalId,
    fetchedAt: 1_793_471_100_000,
    achievements: [
      {
        id: "WIN_10",
        name: "Ten Wins",
        description: "About Ten Wins",
        hidden: false,
        unlocked: true,
        unlockedAt: 1_793_471_047_000,
        iconUrl: "https://images.gog.com/WIN_10_unlocked.png",
        lockedIconUrl: "https://images.gog-statics.com/WIN_10_locked.png",
        globalPercent: 12.5,
        ...fields,
      },
    ],
  });

  it("parse with the GOG product id as id and GOG's icons", () => {
    expect(parseAchievementList(gogList("1213504814"))).toEqual(
      gogList("1213504814"),
    );
    expect(parseAchievementList(gogList("1"))?.externalId).toBe("1");
  });

  it("are dropped when the id is not a GOG product id", () => {
    for (const id of [
      "",
      "0",
      "01",
      "12345678901",
      "1213504814a",
      "Sugar",
      // The GALAXY client id of the same game.
      "55687131321183296",
    ])
      expect(parseAchievementList(gogList(id)), id).toBeNull();
  });

  it("drop icons from other hosts", () => {
    for (const url of [
      "https://evil.example/icon.png",
      "https://gog.com.evil.test/icon.png",
      "https://notgog.com/icon.png",
      "http://images.gog.com/WIN_10_unlocked.png",
    ]) {
      const [parsed] = parseAchievementList(
        gogList("1213504814", { iconUrl: url, lockedIconUrl: url }),
      )!.achievements;
      expect(parsed.iconUrl, url).toBeUndefined();
      expect(parsed.lockedIconUrl, url).toBeUndefined();
    }
  });
});
