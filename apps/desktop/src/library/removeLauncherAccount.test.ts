import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  achievementListKey,
  useAchievementLists,
} from "../achievements/achievementLists";
import { milestoneMetrics, parseMilestoneId } from "../milestones";
import { createGameIdentityResolver, useAppStore } from "../store";
import { removeLauncherAccount, setGamePlaytime } from "../tracker";
import { EARLIER_IMPORT } from "./accountReadings";
import { commitLibraryImports } from "./commit";
import { buildLibraryImportCommit } from "./importPlan";
import {
  isLauncherGameDismissed,
  readLibraryAutoAdd,
} from "./libraryAutoAddState";
import { myGamesKeys } from "./myGamesKeys";
import { providerFloors } from "./playtimeFloor";
import { scopedExeLinkKey } from "./scopedLinks";
import type { LibraryProviderId, Session } from "@playcounter/shared";
import type { LibraryAccount } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

// docs/remove-account-hours-plan.md, "What Remove does": everything an
// account brought to a game goes, PlayCounter's own time and corrections
// stay, and nothing about the account is kept.

const H = 3600;
const PHIL: LibraryAccount = { key: "a".repeat(32), name: "Dreamfire" };
const KID: LibraryAccount = { key: "b".repeat(32), name: "Kid" };
const FRIEND: LibraryAccount = { key: "c".repeat(32), name: "Friend" };

type TestGame = {
  id: number;
  igdbId: number;
  name: string;
  exe: string;
};
const AOE4: TestGame = {
  id: 11,
  igdbId: 119_284,
  name: "Age of Empires IV",
  exe: "RelicCardinal.exe",
};
const PALWORLD: TestGame = {
  id: 12,
  igdbId: 151_665,
  name: "Palworld",
  exe: "Palworld-WinGDK-Shipping.exe",
};
const HALO: TestGame = {
  id: 13,
  igdbId: 103_281,
  name: "Halo Infinite",
  exe: "HaloInfinite.exe",
};

/** One launcher read of a game, as the importer commits it. */
function read(
  provider: LibraryProviderId,
  externalId: string,
  game: TestGame,
  hours: number,
  options: {
    account?: LibraryAccount;
    lastPlayed?: string;
    installPath?: string;
    at?: string;
  } = {},
) {
  commitLibraryImports([
    buildLibraryImportCommit({
      provider,
      now: options.at ?? "2026-11-01T12:00:00.000Z",
      scanned: {
        externalId,
        name: game.name.toUpperCase(),
        playtimeSeconds: hours * H,
        hasPlayedEvidence: true,
        inAccountLibrary: true,
        installed: options.installPath !== undefined,
        ...(options.installPath ? { installPath: options.installPath } : {}),
        ...(options.lastPlayed
          ? { lastPlayedUnix: Date.parse(options.lastPlayed) / 1000 }
          : {}),
        executables: [],
      },
      resolved: {
        key: `${provider}:${externalId}`,
        status: "resolved",
        game: {
          id: game.id,
          igdbId: game.igdbId,
          name: game.name,
          coverUrl: "",
          source: "igdb",
        },
        executables: [
          {
            platform: "windows",
            kind: "exe",
            value: game.exe,
            verified: true,
            provenance: "community",
          },
        ],
      },
      ...(options.account ? { account: options.account } : {}),
    })!,
  ]);
}

function entry(provider: LibraryProviderId, externalId: string) {
  return useAppStore.getState().libraryImports.get(`${provider}:${externalId}`);
}

/** The total every screen shows for the game, in hours. */
function shownHours(game: TestGame) {
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
  }).games.get(`igdb#${game.igdbId}`)?.hours;
}

/** The card's facts Details hands over: the game, its launchers and
 *  whether PlayCounter counted time for it. */
function card(game: TestGame, recordedSeconds = 0) {
  return {
    gameId: game.id,
    source: "igdb" as const,
    aliases: [{ gameId: game.id, source: "igdb" as const }],
    libraryImports: [...useAppStore.getState().libraryImports.values()]
      .filter((item) => item.igdbId === game.igdbId)
      .map(({ provider, externalId }) => ({ provider, externalId })),
    recordedSeconds,
  };
}

function inMyGames(game: TestGame) {
  return myGamesKeys(useAppStore.getState()).has(`igdb#${game.igdbId}`);
}

function playOnPc(game: TestGame, hours: number, startedAt: string) {
  const started = Date.parse(startedAt);
  const session: Session = {
    id: started,
    gameId: game.id,
    igdbId: game.igdbId,
    source: "igdb",
    gameName: game.name,
    exeName: game.exe.toLowerCase(),
    startedAt,
    endedAt: new Date(started + hours * H * 1000).toISOString(),
    durationSeconds: hours * H,
  };
  useAppStore.setState((state) => ({
    recentSessions: [session, ...state.recentSessions],
  }));
}

function gameMilestones(game: TestGame) {
  return useAppStore
    .getState()
    .awardedMilestones.map((milestone) => parseMilestoneId(milestone.id))
    .filter(
      (parsed) =>
        parsed?.category === "game" && parsed.scope === `igdb#${game.igdbId}`,
    )
    .map((parsed) => parsed!.threshold);
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAchievementLists.setState({ lists: new Map() });
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("an account that leaves a game with other accounts", () => {
  beforeEach(() => {
    read("steam", "1466860", AOE4, 120, { account: PHIL });
    read("xbox", "1848392557", AOE4, 200, {
      account: PHIL,
      lastPlayed: "2026-10-01T18:00:00.000Z",
    });
    read("xbox", "1848392557", AOE4, 30, {
      account: KID,
      lastPlayed: "2026-11-10T18:00:00.000Z",
    });
  });

  it("takes only that account's hours and last played date; Xbox stays on the game", () => {
    expect(shownHours(AOE4)).toBe(350);

    expect(
      removeLauncherAccount(card(AOE4), {
        provider: "xbox",
        externalId: "1848392557",
        accountKey: KID.key,
      }),
    ).toBe("account");

    expect(shownHours(AOE4)).toBe(320);
    const xbox = entry("xbox", "1848392557")!;
    expect(xbox.providerSeconds).toBe(200 * H);
    expect(xbox.accounts?.map((item) => item.name)).toEqual(["Dreamfire"]);
    expect(xbox.providerLastPlayedAt).toBe("2026-10-01T18:00:00.000Z");
    expect(entry("steam", "1466860")?.providerSeconds).toBe(120 * H);
  });

  // Q2 A: the saved list is the game's, not an account's: whoever was
  // signed in at the last read. It goes, and is read again from the account
  // signed in now.
  it("deletes the game's saved achievement list too", () => {
    const key = achievementListKey("xbox", "1848392557");
    useAchievementLists.setState({
      lists: new Map([
        [
          key,
          {
            provider: "xbox",
            externalId: "1848392557",
            fetchedAt: "2026-11-10T18:00:00.000Z",
            achievements: [],
          } as never,
        ],
      ]),
    });
    removeLauncherAccount(card(AOE4), {
      provider: "xbox",
      externalId: "1848392557",
      accountKey: KID.key,
    });
    expect(useAchievementLists.getState().lists.get(key)).toBeNull();
  });

  it("keeps nothing: the next read of that account counts again", () => {
    removeLauncherAccount(card(AOE4), {
      provider: "xbox",
      externalId: "1848392557",
      accountKey: KID.key,
    });
    read("xbox", "1848392557", AOE4, 35, {
      account: KID,
      at: "2026-11-15T12:00:00.000Z",
    });
    expect(shownHours(AOE4)).toBe(355);
  });
});

describe("the launcher's last account", () => {
  const palworldLink = {
    exeName: "Palworld-WinGDK-Shipping.exe",
    pathPrefix: "c:\\xboxgames\\palworld\\content",
    gameId: PALWORLD.id,
    source: "igdb" as const,
    igdbId: PALWORLD.igdbId,
    gameName: PALWORLD.name,
    coverUrl: "",
    provider: "xbox" as const,
    externalId: "2034576873",
    setAt: "2026-11-01T12:00:00.000Z",
  };

  beforeEach(() => {
    read("steam", "1623730", PALWORLD, 40, { account: PHIL });
    // Imported before PlayCounter knew accounts: no account on it.
    read("xbox", "2034576873", PALWORLD, 60, {
      installPath: "C:\\XboxGames\\Palworld\\Content",
    });
    useAppStore.setState((state) => ({
      scopedExeLinks: new Map(state.scopedExeLinks).set(
        scopedExeLinkKey(palworldLink.exeName, palworldLink.pathPrefix)!,
        palworldLink,
      ),
    }));
    useAchievementLists.setState({
      lists: new Map([
        [
          achievementListKey("xbox", "2034576873"),
          {
            provider: "xbox",
            externalId: "2034576873",
            fetchedAt: "2026-11-01T12:00:00.000Z",
            achievements: [],
          } as never,
        ],
      ]),
    });
  });

  it("takes the launcher off the game: entry, install, folder links, achievement list", () => {
    expect(shownHours(PALWORLD)).toBe(100);
    expect(entry("xbox", "2034576873")?.accounts).toBeUndefined();

    // A game from before accounts: Remove sits on the playtime line.
    expect(
      removeLauncherAccount(card(PALWORLD), {
        provider: "xbox",
        externalId: "2034576873",
        accountKey: EARLIER_IMPORT,
      }),
    ).toBe("launcher");

    const state = useAppStore.getState();
    expect(entry("xbox", "2034576873")).toBeUndefined();
    expect(state.libraryInstalls.has("xbox:2034576873")).toBe(false);
    expect(
      [...state.scopedExeLinks.values()].filter(
        (link) => link.provider === "xbox",
      ),
    ).toEqual([]);
    expect(
      useAchievementLists
        .getState()
        .lists.get(achievementListKey("xbox", "2034576873")),
    ).toBeNull();
    expect(shownHours(PALWORLD)).toBe(40);
    expect(entry("steam", "1623730")?.providerSeconds).toBe(40 * H);
    expect(inMyGames(PALWORLD)).toBe(true);
    // Steam auto-add (and its kin) leave it out until it is imported by hand.
    expect(
      isLauncherGameDismissed(readLibraryAutoAdd(), {
        provider: "xbox",
        externalId: "2034576873",
      }),
    ).toBe(true);
  });

  it("an import by hand brings it back", () => {
    removeLauncherAccount(card(PALWORLD), {
      provider: "xbox",
      externalId: "2034576873",
      accountKey: EARLIER_IMPORT,
    });
    read("xbox", "2034576873", PALWORLD, 62, { account: PHIL });
    expect(shownHours(PALWORLD)).toBe(102);
    expect(
      isLauncherGameDismissed(readLibraryAutoAdd(), {
        provider: "xbox",
        externalId: "2034576873",
      }),
    ).toBe(false);
  });

  it("leaves PlayCounter's sessions and a Set total correction alone", () => {
    playOnPc(PALWORLD, 2, "2026-11-02T12:00:00.000Z");
    expect(shownHours(PALWORLD)).toBe(102);
    setGamePlaytime({
      gameId: PALWORLD.id,
      igdbId: PALWORLD.igdbId,
      gameName: PALWORLD.name,
      coverUrl: "",
      source: "igdb",
      exeName: PALWORLD.exe.toLowerCase(),
      targetSeconds: 92 * H,
    });
    expect(shownHours(PALWORLD)).toBe(92);

    removeLauncherAccount(card(PALWORLD, 2 * H), {
      provider: "xbox",
      externalId: "2034576873",
      accountKey: EARLIER_IMPORT,
    });
    // Steam 40h + 2h played since, then the −10h correction.
    expect(shownHours(PALWORLD)).toBe(32);
    expect(useAppStore.getState().recentSessions).toHaveLength(1);
  });

  it("takes back a PlayCounter achievement the game no longer reaches, without a notification", () => {
    expect(gameMilestones(PALWORLD)).toContain(100);
    const notificationsBefore = useAppStore.getState().notifications.length;

    removeLauncherAccount(card(PALWORLD), {
      provider: "xbox",
      externalId: "2034576873",
      accountKey: EARLIER_IMPORT,
    });

    expect(gameMilestones(PALWORLD)).not.toContain(100);
    expect(gameMilestones(PALWORLD)).not.toContain(50);
    expect(gameMilestones(PALWORLD)).toContain(25);
    expect(useAppStore.getState().notifications.length).toBeLessThanOrEqual(
      notificationsBefore,
    );
  });
});

describe("the game's last launcher", () => {
  beforeEach(() => {
    // A friend's account, imported by mistake: Halo only came from there.
    read("xbox", "2043073184", HALO, 80, { account: FRIEND });
  });

  it("takes the game out of My Games when PlayCounter never counted time for it", () => {
    expect(inMyGames(HALO)).toBe(true);
    expect(
      removeLauncherAccount(card(HALO), {
        provider: "xbox",
        externalId: "2043073184",
        accountKey: FRIEND.key,
      }),
    ).toBe("game");
    expect(entry("xbox", "2043073184")).toBeUndefined();
    expect(inMyGames(HALO)).toBe(false);
    expect(useAppStore.getState().exeCache.has("haloinfinite.exe")).toBe(false);
  });

  it("keeps the game with PlayCounter's own time", () => {
    playOnPc(HALO, 3, "2026-11-03T12:00:00.000Z");
    expect(
      removeLauncherAccount(card(HALO, 3 * H), {
        provider: "xbox",
        externalId: "2043073184",
        accountKey: FRIEND.key,
      }),
    ).toBe("launcher");
    expect(entry("xbox", "2043073184")).toBeUndefined();
    expect(inMyGames(HALO)).toBe(true);
    expect(shownHours(HALO)).toBe(3);
  });
});
