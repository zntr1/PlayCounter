import { describe, expect, it } from "vitest";
import type { ExeCacheEntry, LaunchTarget } from "../store";
import { canSuggestCustomGameToCommunity } from "../store";
import { launchTargetsForGame } from "../gameLaunch";
import { isGenericExeName } from "./exeCandidates";
import {
  gamesLinkedToExe,
  genericExeFolder,
  genericFolderLink,
  isInIgnoredFolder,
  isSortedGenericCopy,
  localCustomGameId,
  moveGenericNameLinksToFolders,
} from "./genericExeLinks";
import { scopedExeLinkKey } from "./scopedLinks";
import type { IgnoredExeFolder, ScopedExeLink } from "./types";
import { createTransferData } from "../backup";

const TUPAC = String.raw`D:\Games\Tupac\Game.exe`;
const SOLITAIRE = String.raw`D:\Games\Solitaire\Game.exe`;

function nameLink(overrides: Partial<ExeCacheEntry> = {}): ExeCacheEntry {
  return {
    exeName: "Game.exe",
    state: "matched",
    gameId: -5,
    gameName: "Tupac",
    coverUrl: "",
    source: "custom",
    lastCheckedAt: "2026-09-27T10:00:00.000Z",
    ...overrides,
  };
}

function folderLink(
  exePath: string,
  gameId: number,
  gameName: string,
): ScopedExeLink {
  return genericFolderLink(
    { exeName: "Game.exe", exePath },
    { id: gameId, name: gameName, coverUrl: "", source: "custom" },
    "2026-09-27T10:00:00.000Z",
  )!;
}

function links(...values: ScopedExeLink[]) {
  return new Map(
    values.map((link) => [
      scopedExeLinkKey(link.exeName, link.pathPrefix)!,
      link,
    ]),
  );
}

describe("generic exe names", () => {
  it.each([
    "Game.exe",
    "game.exe",
    "RPG_RT.exe",
    "nw.exe",
    "Player.exe",
    "love.exe",
    "Launcher.exe",
    "start.exe",
  ])("treats %s as generic", (exeName) => {
    expect(isGenericExeName(exeName)).toBe(true);
  });

  it.each(["eldenring.exe", "Celeste.exe", "GameA.exe", "Tupac.exe"])(
    "treats %s as naming its game",
    (exeName) => {
      expect(isGenericExeName(exeName)).toBe(false);
    },
  );

  it("links a generic exe to the folder it runs from, as the path spells it", () => {
    expect(genericExeFolder({ exeName: "Game.exe", exePath: TUPAC })).toBe(
      String.raw`D:\Games\Tupac`,
    );
  });

  it.each([
    {
      exeName: "eldenring.exe",
      exePath: String.raw`D:\Games\ER\eldenring.exe`,
    },
    { exeName: "Game.exe", exePath: null },
    { exeName: "Game.exe", exePath: "/home/phil/games/Game.exe" },
  ])("keeps a name link for $exeName at $exePath", (file) => {
    expect(genericExeFolder(file)).toBeNull();
    expect(
      genericFolderLink(
        file,
        { id: 1, name: "X", coverUrl: "", source: "igdb" },
        "now",
      ),
    ).toBeNull();
  });

  it("gives each folder's custom game its own id", () => {
    const tupac = localCustomGameId({ exeName: "Game.exe", exePath: TUPAC }, 0);
    const solitaire = localCustomGameId(
      { exeName: "Game.exe", exePath: SOLITAIRE },
      0,
    );
    expect(tupac).not.toBe(solitaire);
    expect(tupac).toBeLessThan(0);
    expect(
      localCustomGameId(
        { exeName: "Celeste.exe", exePath: String.raw`D:\Celeste\Celeste.exe` },
        -7,
      ),
    ).toBe(-7);
  });

  it("lists every game linked to a name once, across folders", () => {
    const games = gamesLinkedToExe(
      "game.exe",
      new Map([["game.exe", nameLink({ gameId: -1, gameName: "Old" })]]),
      links(
        folderLink(TUPAC, -5, "Tupac"),
        folderLink(SOLITAIRE, -6, "Solitaire"),
        folderLink(String.raw`E:\Tupac\Game.exe`, -5, "Tupac"),
      ),
    );
    expect(games.map((game) => game.name)).toEqual([
      "Old",
      "Tupac",
      "Solitaire",
    ]);
  });

  it("never offers Game.exe to the community", () => {
    expect(
      canSuggestCustomGameToCommunity({
        source: "custom",
        exeName: "Game.exe",
      }),
    ).toBe(false);
    expect(
      canSuggestCustomGameToCommunity({
        source: "custom",
        exeName: "Celeste.exe",
      }),
    ).toBe(true);
  });

  it("starts each Game.exe game from its own folder", () => {
    const scopedExeLinks = links(
      folderLink(TUPAC, -5, "Tupac"),
      folderLink(SOLITAIRE, -6, "Solitaire"),
    );
    // The name's launch path is whichever copy ran last.
    const launchTargets = new Map([
      [
        "game.exe",
        {
          exeName: "Game.exe",
          path: SOLITAIRE,
          owner: { gameId: -6, source: "custom" as const },
        },
      ],
    ]);
    const pathFor = (gameId: number) =>
      launchTargetsForGame({
        exeNames: ["Game.exe"],
        aliases: [{ gameId, source: "custom" }],
        launchTargets,
        exeCache: new Map(),
        scopedExeLinks,
      }).map((target) => target.path);

    expect(pathFor(-5)).toEqual([TUPAC]);
    expect(pathFor(-6)).toEqual([SOLITAIRE]);
  });
});

describe("moving name links of generic exes to folders", () => {
  function target(path: string, gameId = -5): LaunchTarget {
    return {
      exeName: "Game.exe",
      path,
      owner: { gameId, source: "custom" },
    };
  }

  it("moves a name link to the folder of its Play file, keeping its id", () => {
    const exeCache = new Map([["game.exe", nameLink()]]);
    const scoped = new Map<string, ScopedExeLink>();

    expect(
      moveGenericNameLinksToFolders(
        exeCache,
        scoped,
        new Map([["game.exe", target(TUPAC)]]),
      ),
    ).toBe(true);

    expect(exeCache.has("game.exe")).toBe(false);
    expect([...scoped.values()]).toEqual([
      expect.objectContaining({
        exeName: "Game.exe",
        pathPrefix: String.raw`D:\Games\Tupac`,
        exePath: TUPAC,
        gameId: -5,
        gameName: "Tupac",
        source: "custom",
      }),
    ]);
  });

  it.each([
    ["no Play file", new Map<string, LaunchTarget>()],
    ["another game's Play file", new Map([["game.exe", target(TUPAC, -9)]])],
  ])("keeps the name link with %s", (_label, launchTargets) => {
    const exeCache = new Map([["game.exe", nameLink()]]);
    expect(
      moveGenericNameLinksToFolders(exeCache, new Map(), launchTargets),
    ).toBe(false);
    expect(exeCache.get("game.exe")).toEqual(nameLink());
  });

  it("drops a launcher game's name link that already has its install folder", () => {
    const exeCache = new Map([
      ["game.exe", nameLink({ gameId: 9, source: "igdb", igdbId: 9 })],
    ]);
    const install = {
      ...folderLink(String.raw`C:\Steam\common\RPG\Game.exe`, 9, "RPG"),
      source: "igdb" as const,
      igdbId: 9,
    };
    const scoped = links(install);

    expect(moveGenericNameLinksToFolders(exeCache, scoped, new Map())).toBe(
      true,
    );
    expect(exeCache.size).toBe(0);
    expect([...scoped.values()]).toEqual([install]);
  });

  it("leaves unique names alone", () => {
    const celeste = nameLink({ exeName: "Celeste.exe", gameName: "Celeste" });
    const exeCache = new Map([["celeste.exe", celeste]]);
    moveGenericNameLinksToFolders(
      exeCache,
      new Map(),
      new Map([
        [
          "celeste.exe",
          {
            ...target(String.raw`D:\Celeste\Celeste.exe`),
            exeName: "Celeste.exe",
          },
        ],
      ]),
    );
    expect(exeCache.get("celeste.exe")).toBe(celeste);
  });
});

describe("folders ignored for a generic exe", () => {
  const ignored = new Map<string, IgnoredExeFolder>([
    [
      scopedExeLinkKey("Game.exe", String.raw`D:\Games\Utility`)!,
      {
        exeName: "Game.exe",
        pathPrefix: String.raw`D:\Games\Utility`,
        ignoredAt: "2026-09-27T10:00:00.000Z",
      },
    ],
  ]);

  it("covers only that folder's copy", () => {
    const at = (exePath: string | null, exeName = "Game.exe") =>
      isInIgnoredFolder({ exeName, exePath }, ignored);
    expect(at(String.raw`D:\Games\Utility\Game.exe`)).toBe(true);
    expect(at(String.raw`d:\games\utility\GAME.EXE`)).toBe(true);
    expect(at(TUPAC)).toBe(false);
    expect(at(null)).toBe(false);
    expect(at(String.raw`D:\Games\Utility\Other.exe`, "Other.exe")).toBe(false);
  });

  it("keeps sorted copies out of Discovered's unknown Game.exe", () => {
    const scoped = links(folderLink(TUPAC, -5, "Tupac"));
    const sorted = (exePath: string) =>
      isSortedGenericCopy({ exeName: "Game.exe", exePath }, scoped, ignored);

    expect(sorted(TUPAC)).toBe(true);
    expect(sorted(String.raw`D:\Games\Utility\Game.exe`)).toBe(true);
    expect(sorted(SOLITAIRE)).toBe(false);
    expect(
      isSortedGenericCopy(
        { exeName: "Celeste.exe", exePath: String.raw`D:\C\Celeste.exe` },
        scoped,
        ignored,
      ),
    ).toBe(false);
  });

  it("stays on this PC, like folder links", () => {
    const data = createTransferData({
      ignoredExeFolders: [...ignored.values()],
      scopedExeLinks: [folderLink(TUPAC, -5, "Tupac")],
    });
    expect(data).not.toHaveProperty("ignoredExeFolders");
    expect(data).not.toHaveProperty("scopedExeLinks");
  });
});
