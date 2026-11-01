// @vitest-environment happy-dom
import type { AchievementList, GameAchievement } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { loadListMock, saveListsMock } = vi.hoisted(() => ({
  loadListMock: vi.fn(),
  saveListsMock: vi.fn(),
}));
vi.mock("../../../achievements/achievementLists", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../../achievements/achievementLists")
    >();
  saveListsMock.mockImplementation(async (lists: AchievementList[]) => {
    original.useAchievementLists.setState((state) => {
      const next = new Map(state.lists);
      for (const list of lists)
        next.set(`${list.provider}:${list.externalId}`, list);
      return { lists: next };
    });
  });
  return {
    ...original,
    loadAchievementList: loadListMock,
    saveAchievementLists: saveListsMock,
  };
});

const platform = vi.hoisted(() => ({ value: "windows" }));
vi.mock("../../../platform", () => ({
  currentPlatform: () => platform.value,
}));

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("../../../library/providers/xbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../library/providers/xbox")>()),
  refreshXboxAchievementList: refreshMock,
}));

import { useAchievementLists } from "../../../achievements/achievementLists";
import { useKeptLogins } from "../../../library/keptLogins";
import {
  clearLoginHealth,
  recordLoginHealth,
} from "../../../library/loginHealth";
import { appLocale } from "../../../i18n";
import { useAppStore } from "../../../store";
import { achievementSources, GameAchievementsTab } from "./GameAchievementsTab";

let root: Root;
let container: HTMLDivElement;

function achievement(
  id: string,
  fields: Partial<GameAchievement> = {},
): GameAchievement {
  return {
    id,
    name: id,
    description: `About ${id}`,
    hidden: false,
    unlocked: false,
    ...fields,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAchievementLists.setState({ lists: new Map() });
  useKeptLogins.setState({ logins: [] });
  clearLoginHealth("epic");
  clearLoginHealth("gog");
  platform.value = "windows";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  invokeMock.mockReset();
  loadListMock.mockReset();
  vi.unstubAllGlobals();
});

function steamAnswers(read: unknown, catalog: unknown = []) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "steam_read_achievements") return read;
    if (command === "steam_achievement_catalog") return catalog;
    throw new Error(`unexpected ${command}`);
  });
}

async function render(
  sources: Parameters<typeof GameAchievementsTab>[0]["sources"],
) {
  await act(async () => root.render(<GameAchievementsTab sources={sources} />));
  // Let the reads resolve.
  await act(async () => {});
  await act(async () => {});
}

const rowNames = () =>
  [...container.querySelectorAll("[data-achievement-row] h4")].map(
    (node) => node.textContent,
  );

describe("which games get the tab", () => {
  const entry = (provider: string, externalId: string) =>
    ({ provider, externalId }) as never;

  it("games with a Steam, Epic Games or Xbox entry: Steam, Epic, Xbox last", () => {
    expect(
      achievementSources({
        libraryImports: [
          entry("xbox", "1234"),
          entry("epic", "Sugar"),
          entry("steam", "620"),
          entry("steam", "620"),
        ],
      }),
    ).toEqual([
      { provider: "steam", externalId: "620" },
      { provider: "epic", externalId: "Sugar" },
      { provider: "xbox", externalId: "1234" },
    ]);
    expect(
      achievementSources({ libraryImports: [entry("battlenet", "wow")] }),
    ).toEqual([]);
  });

  it("Epic Games only on Windows, where its sign-in exists", () => {
    platform.value = "macos";
    expect(
      achievementSources({
        libraryImports: [entry("epic", "Sugar"), entry("steam", "620")],
      }),
    ).toEqual([{ provider: "steam", externalId: "620" }]);
  });

  it("GOG games too, after Epic Games and before Xbox", () => {
    expect(
      achievementSources({
        libraryImports: [
          entry("xbox", "1234"),
          entry("gog", "1213504814"),
          entry("epic", "Sugar"),
          entry("steam", "620"),
          entry("gog", "1213504814"),
        ],
      }),
    ).toEqual([
      { provider: "steam", externalId: "620" },
      { provider: "epic", externalId: "Sugar" },
      { provider: "gog", externalId: "1213504814" },
      { provider: "xbox", externalId: "1234" },
    ]);
  });

  it("GOG only on Windows, where its sign-in exists", () => {
    platform.value = "macos";
    expect(
      achievementSources({
        libraryImports: [entry("gog", "1213504814"), entry("steam", "620")],
      }),
    ).toEqual([{ provider: "steam", externalId: "620" }]);
  });
});

describe("Steam", () => {
  it("shows the count and lists unlocked first, newest first", async () => {
    steamAnswers({
      status: "ok",
      hasPlayerStats: true,
      achievements: [
        achievement("Locked one"),
        achievement("Old win", { unlocked: true, unlockedAt: 1_000_000 }),
        achievement("New win", { unlocked: true, unlockedAt: 9_000_000 }),
      ],
    });
    await render([{ provider: "steam", externalId: "620" }]);
    expect(container.textContent).toContain("2 of 3 unlocked");
    expect(rowNames()).toEqual(["New win", "Old win", "Locked one"]);
    expect(invokeMock).toHaveBeenCalledWith("steam_read_achievements", {
      appId: "620",
      accountId: null,
      language: "english",
    });
  });

  it("adds the share of players and newer achievements from Steam's public list", async () => {
    steamAnswers(
      {
        status: "ok",
        hasPlayerStats: true,
        achievements: [achievement("Win", { unlocked: true })],
      },
      [
        {
          id: "Win",
          name: "Win",
          description: "",
          hidden: false,
          globalPercent: 74,
        },
        { id: "New", name: "New", description: "", hidden: false },
      ],
    );
    // Its own app: the public list is kept per app while the app runs.
    await render([{ provider: "steam", externalId: "730" }]);
    expect(container.textContent).toContain("1 of 2 unlocked");
    expect(container.textContent).toContain("74% of players");
  });

  it("keeps a hidden locked achievement secret until shown", async () => {
    steamAnswers({
      status: "ok",
      hasPlayerStats: true,
      achievements: [achievement("Big twist", { hidden: true })],
    });
    await render([{ provider: "steam", externalId: "620" }]);
    expect(container.textContent).not.toContain("Big twist");
    expect(container.textContent).toContain("Hidden achievement");
    const show = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Show",
    );
    await act(async () => show!.click());
    expect(container.textContent).toContain("Big twist");
  });

  it("filters unlocked and locked", async () => {
    steamAnswers({
      status: "ok",
      hasPlayerStats: true,
      achievements: [
        achievement("Done", { unlocked: true }),
        achievement("Open"),
      ],
    });
    await render([{ provider: "steam", externalId: "620" }]);
    const pill = (label: string) =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.startsWith(label),
      )!;
    await act(async () => pill("Locked").click());
    expect(rowNames()).toEqual(["Open"]);
    await act(async () => pill("Unlocked").click());
    expect(rowNames()).toEqual(["Done"]);
  });

  it("says so when Steam never started the game on this PC", async () => {
    steamAnswers({ status: "noSchema" });
    await render([{ provider: "steam", externalId: "620" }]);
    expect(container.textContent).toContain(
      "Steam saves achievements on this PC once you start the game through Steam.",
    );
  });

  it("warns when the list has no progress for the account", async () => {
    steamAnswers({
      status: "ok",
      hasPlayerStats: false,
      achievements: [achievement("Open")],
    });
    await render([{ provider: "steam", externalId: "620" }]);
    expect(container.textContent).toContain(
      "Steam has no progress for your Steam account on this PC yet.",
    );
  });

  it("has a text for every other state", async () => {
    for (const [status, text] of [
      ["noAchievements", "This game has no Steam achievements."],
      ["noSteam", "Steam was not found on this PC."],
      [
        "unreadable",
        "PlayCounter can't read Steam's achievement file for this game.",
      ],
    ] as const) {
      steamAnswers({ status });
      await act(async () => root.render(<></>));
      await render([{ provider: "steam", externalId: "620" }]);
      expect(container.textContent).toContain(text);
    }
  });
});

describe("Xbox", () => {
  it("offers the sign-in when nothing is saved for the title", async () => {
    loadListMock.mockImplementation(async (_: string, titleId: string) => {
      useAchievementLists.setState({
        lists: new Map([[`xbox:${titleId}`, null]]),
      });
      return null;
    });
    await render([{ provider: "xbox", externalId: "1234" }]);
    expect(container.textContent).toContain(
      "Sign in with Microsoft to load your Xbox achievements.",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Sign in with Microsoft",
      ),
    ).toBe(true);
  });

  it("shows a saved list with its Gamerscore", async () => {
    useAchievementLists.setState({
      lists: new Map([
        [
          "xbox:1234",
          {
            provider: "xbox",
            externalId: "1234",
            fetchedAt: Date.UTC(2026, 9, 20),
            achievements: [
              achievement("Win", { unlocked: true, gamerscore: 30 }),
              achievement("Lose", { gamerscore: 70 }),
            ],
          },
        ],
      ]),
    });
    await render([{ provider: "xbox", externalId: "1234" }]);
    expect(container.textContent).toContain("1 of 2 unlocked");
    expect(container.textContent).toContain("30 of 100 Gamerscore");
    expect(container.textContent).toContain("Refresh with Microsoft");
    expect(loadListMock).not.toHaveBeenCalled();
  });

  it("shows progress only once it started: Xbox sends 0 / 100 for every locked one", async () => {
    useAchievementLists.setState({
      lists: new Map([
        [
          "xbox:1234",
          {
            provider: "xbox",
            externalId: "1234",
            fetchedAt: 1,
            achievements: [
              achievement("Not started", {
                progress: { current: 0, target: 100 },
              }),
              achievement("Halfway", {
                progress: { current: 45, target: 100 },
              }),
            ],
          },
        ],
      ]),
    });
    await render([{ provider: "xbox", externalId: "1234" }]);
    const row = (name: string) =>
      [...container.querySelectorAll("[data-achievement-row]")].find(
        (node) => node.querySelector("h4")?.textContent === name,
      )?.textContent;
    expect(row("Halfway")).toContain("45 / 100");
    expect(row("Not started")).toBeDefined();
    expect(row("Not started")).not.toContain("/ 100");
  });

  describe("with a kept sign-in", () => {
    const kept = [{ service: "xbox" as const, name: "Chief", savedAt: 1 }];
    const buttons = () =>
      [...container.querySelectorAll("button")].map((button) =>
        button.textContent?.trim(),
      );

    beforeEach(() => {
      invokeMock.mockImplementation(async (command: string) =>
        command === "logins_list" ? kept : undefined,
      );
      useKeptLogins.setState({ logins: kept });
    });

    afterEach(() => {
      useKeptLogins.setState({ logins: [] });
      refreshMock.mockReset();
    });

    it("loads without a Microsoft sign-in", async () => {
      loadListMock.mockImplementation(async (_: string, titleId: string) => {
        useAchievementLists.setState({
          lists: new Map([[`xbox:${titleId}`, null]]),
        });
        return null;
      });
      await render([{ provider: "xbox", externalId: "1234" }]);

      expect(container.textContent).toContain(
        "Your Xbox achievements are not loaded yet.",
      );
      expect(buttons()).toContain("Refresh");
      expect(buttons()).not.toContain("Sign in with Microsoft");
    });

    it("refreshes a saved list without Microsoft in the button", async () => {
      useAchievementLists.setState({
        lists: new Map([
          [
            "xbox:1234",
            {
              provider: "xbox",
              externalId: "1234",
              fetchedAt: Date.UTC(2026, 9, 20),
              achievements: [achievement("Win", { unlocked: true })],
            },
          ],
        ]),
      });
      await render([{ provider: "xbox", externalId: "1234" }]);

      expect(buttons()).toContain("Refresh");
      expect(buttons()).not.toContain("Refresh with Microsoft");
    });

    it("shows no sign-in link while it reads, until Microsoft asks for one", async () => {
      loadListMock.mockImplementation(async (_: string, titleId: string) => {
        useAchievementLists.setState({
          lists: new Map([[`xbox:${titleId}`, null]]),
        });
        return null;
      });
      let askForSignIn: ((url: string) => void) | undefined;
      refreshMock.mockImplementation(
        (
          _titleId: string,
          options: { onAuthorizeUrl?: (url: string) => void },
        ) => {
          askForSignIn = options.onAuthorizeUrl;
          return new Promise(() => {});
        },
      );
      await render([{ provider: "xbox", externalId: "1234" }]);
      const refresh = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Refresh",
      );
      await act(async () => refresh!.click());

      expect(container.textContent).toContain("Reading your Xbox history…");
      expect(buttons()).not.toContain("Copy sign-in link");

      // Microsoft refused the kept sign-in: the browser sign-in takes over.
      await act(async () =>
        askForSignIn?.(
          "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
        ),
      );
      expect(container.textContent).toContain("Waiting for Microsoft sign-in…");
      expect(buttons()).toContain("Copy sign-in link");
    });
  });
});

describe("both stores", () => {
  it("switches between Steam and Xbox", async () => {
    steamAnswers({
      status: "ok",
      hasPlayerStats: true,
      achievements: [achievement("Steam win", { unlocked: true })],
    });
    useAchievementLists.setState({
      lists: new Map([
        [
          "xbox:1234",
          {
            provider: "xbox",
            externalId: "1234",
            fetchedAt: 1,
            achievements: [achievement("Xbox win", { unlocked: true })],
          },
        ],
      ]),
    });
    await render([
      { provider: "steam", externalId: "620" },
      { provider: "xbox", externalId: "1234" },
    ]);
    expect(rowNames()).toEqual(["Steam win"]);
    const xbox = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Xbox",
    );
    await act(async () => xbox!.click());
    expect(rowNames()).toEqual(["Xbox win"]);
  });

  it("names Steam and Epic Games in the pills", async () => {
    steamAnswers({
      status: "ok",
      hasPlayerStats: true,
      achievements: [achievement("Steam win", { unlocked: true })],
    });
    useAchievementLists.setState({
      lists: new Map([
        [
          "epic:Sugar",
          {
            provider: "epic",
            externalId: "Sugar",
            fetchedAt: 1,
            achievements: [achievement("Epic win", { unlocked: true, xp: 5 })],
          },
        ],
      ]),
    });
    await render([
      { provider: "steam", externalId: "620" },
      { provider: "epic", externalId: "Sugar" },
    ]);
    const pills = [...container.querySelectorAll('[role="group"] button')].map(
      (button) => button.textContent,
    );
    expect(pills).toEqual(["Steam", "Epic Games"]);
    const epic = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Epic Games",
    );
    await act(async () => epic!.click());
    expect(rowNames()).toEqual(["Epic win"]);
  });
});

describe("Epic Games", () => {
  const sugar = [{ provider: "epic" as const, externalId: "Sugar" }];
  const kept = [{ service: "epic" as const, name: "Player One", savedAt: 1 }];
  const buttons = () =>
    [...container.querySelectorAll("button")].map((button) =>
      button.textContent?.trim(),
    );
  const number = (value: number) =>
    new Intl.NumberFormat(appLocale()).format(value);
  const epicReads = () =>
    invokeMock.mock.calls.filter(
      ([command]) => command === "epic_read_achievements",
    );

  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
    await act(async () => {});
    await act(async () => {});
  }

  function nothingSaved() {
    useAchievementLists.setState({ lists: new Map() });
    loadListMock.mockImplementation(async (provider: string, id: string) => {
      useAchievementLists.setState({
        lists: new Map([[`${provider}:${id}`, null]]),
      });
      return null;
    });
  }

  function saved(achievements: GameAchievement[]) {
    useAchievementLists.setState({
      lists: new Map([
        [
          "epic:Sugar",
          {
            provider: "epic",
            externalId: "Sugar",
            fetchedAt: Date.UTC(2026, 9, 31),
            achievements,
          },
        ],
      ]),
    });
  }

  /** What the Rust part answers, with these kept sign-ins. */
  function epic(answer: () => unknown, logins: typeof kept | [] = kept) {
    useKeptLogins.setState({ logins });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "logins_list") return logins;
      if (command === "epic_read_achievements") return answer();
      throw new Error(`unexpected ${command}`);
    });
  }

  afterEach(() => {
    saveListsMock.mockClear();
  });

  it("opening the tab with a kept sign-in and nothing saved loads the list once, without a window", async () => {
    nothingSaved();
    epic(() => ({
      status: "ok",
      achievements: [
        achievement("0", { name: "Virtuoso", xp: 100 }),
        achievement("1", { name: "Stocked", unlocked: true, xp: 50 }),
      ],
    }));
    await render(sugar);
    expect(epicReads()).toEqual([
      ["epic_read_achievements", { appName: "Sugar", language: "en-US" }],
    ]);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "library_epic_sign_in",
      expect.anything(),
    );
    expect(container.textContent).toContain("1 of 2 unlocked");
    expect(rowNames()).toEqual(["Stocked", "Virtuoso"]);
    expect(saveListsMock).toHaveBeenCalledOnce();

    // Saved now: opening the tab again reads nothing.
    await act(async () => root.render(<></>));
    await render(sugar);
    expect(epicReads()).toHaveLength(1);
  });

  it("never loads without a kept sign-in, and offers the Epic Games sign-in", async () => {
    nothingSaved();
    epic(() => ({ status: "ok", achievements: [] }), []);
    await render(sugar);
    expect(epicReads()).toHaveLength(0);
    expect(container.textContent).toContain(
      "Sign in to Epic Games to load your achievements.",
    );
    expect(buttons()).toContain("Sign in to Epic Games");
  });

  it("signs in through the existing Epic Games window, then loads once", async () => {
    nothingSaved();
    let logins: typeof kept | [] = [];
    useKeptLogins.setState({ logins });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "library_epic_sign_in") {
        logins = kept;
        return undefined;
      }
      if (command === "logins_list") return logins;
      if (command === "epic_read_achievements")
        return {
          status: "ok",
          achievements: [achievement("1", { unlocked: true, xp: 50 })],
        };
      throw new Error(`unexpected ${command}`);
    });
    await render(sugar);
    await click("Sign in to Epic Games");
    await act(async () => {});
    expect(invokeMock).toHaveBeenCalledWith(
      "library_epic_sign_in",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect(epicReads()).toHaveLength(1);
    expect(container.textContent).toContain("1 of 1 unlocked");
  });

  it("shows the XP under the count and on each row, and where the list is from", async () => {
    saved([
      achievement("0", { name: "Virtuoso", unlocked: true, xp: 200 }),
      achievement("1", { name: "Stocked", unlocked: true, xp: 50 }),
      achievement("2", { name: "Pitch Veteran", xp: 750 }),
    ]);
    epic(() => ({ status: "unavailable" }));
    await render(sugar);
    expect(container.textContent).toContain(
      `${number(250)} of ${number(1000)} XP`,
    );
    for (const xp of ["200 XP", "50 XP", "750 XP"])
      expect(container.textContent).toContain(xp);
    expect(container.textContent).toContain(
      `From Epic Games, updated ${new Date(Date.UTC(2026, 9, 31)).toLocaleDateString(appLocale())}`,
    );
    expect(buttons()).toContain("Refresh");
    // A saved list doesn't reload by itself.
    expect(epicReads()).toHaveLength(0);
  });

  it("has a text for every answer without a list", async () => {
    for (const [status, text] of [
      ["noAchievements", "This game has no Epic achievements."],
      ["notInAccount", "This game isn't in your Epic Games account."],
      ["blocked", "Epic Games didn't send the achievements. Try again later."],
      [
        "unavailable",
        "Epic Games didn't send the achievements. Try again later.",
      ],
      ["noLogin", "Sign in to Epic Games to load your achievements."],
      ["needsSignIn", "Epic Games needs you to sign in again."],
    ] as const) {
      nothingSaved();
      clearLoginHealth("epic");
      epic(() => ({ status }));
      await act(async () => root.render(<></>));
      await render(sugar);
      expect(container.textContent, status).toContain(text);
    }
    expect(buttons()).toContain("Sign in again");
  });

  it("reads nothing with a sign-in that already needs renewing", async () => {
    nothingSaved();
    epic(() => ({ status: "ok", achievements: [] }));
    recordLoginHealth("epic", "needsSignIn");
    await render(sugar);
    expect(epicReads()).toHaveLength(0);
    expect(container.textContent).toContain(
      "Epic Games needs you to sign in again.",
    );
    expect(buttons()).toContain("Sign in again");
  });

  it("says Reading achievements… while it reads", async () => {
    nothingSaved();
    epic(() => new Promise(() => {}));
    await render(sugar);
    expect(container.textContent).toContain("Reading achievements…");
  });

  it("a refresh that fails keeps the saved list on screen, with the line above it", async () => {
    saved([achievement("1", { name: "Stocked", unlocked: true, xp: 50 })]);
    epic(() => ({ status: "blocked" }));
    await render(sugar);
    await click("Refresh");
    expect(epicReads()).toHaveLength(1);
    expect(rowNames()).toEqual(["Stocked"]);
    expect(container.textContent).toContain(
      "Epic Games didn't send the achievements. Try again later.",
    );
    expect(saveListsMock).not.toHaveBeenCalled();
  });

  it("a refresh replaces the saved list with Epic's newer one", async () => {
    saved([achievement("1", { name: "Stocked" })]);
    epic(() => ({
      status: "ok",
      achievements: [
        achievement("1", {
          name: "Stocked",
          unlocked: true,
          unlockedAt: 1_793_471_047_123,
        }),
      ],
    }));
    await render(sugar);
    expect(container.textContent).toContain("0 of 1 unlocked");
    await click("Refresh");
    expect(container.textContent).toContain("1 of 1 unlocked");
    expect(saveListsMock).toHaveBeenCalledOnce();
  });
});

describe("GOG", () => {
  // Middle-earth: Shadow of Mordor GOTY, by its GOG product id.
  const mordor = [{ provider: "gog" as const, externalId: "1213504814" }];
  const kept = [{ service: "gog" as const, name: "zesarex", savedAt: 1 }];
  const buttons = () =>
    [...container.querySelectorAll("button")].map((button) =>
      button.textContent?.trim(),
    );
  const gogReads = () =>
    invokeMock.mock.calls.filter(
      ([command]) => command === "gog_read_achievements",
    );

  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
    await act(async () => {});
    await act(async () => {});
  }

  function nothingSaved() {
    useAchievementLists.setState({ lists: new Map() });
    loadListMock.mockImplementation(async (provider: string, id: string) => {
      useAchievementLists.setState({
        lists: new Map([[`${provider}:${id}`, null]]),
      });
      return null;
    });
  }

  function saved(achievements: GameAchievement[]) {
    useAchievementLists.setState({
      lists: new Map([
        [
          "gog:1213504814",
          {
            provider: "gog",
            externalId: "1213504814",
            fetchedAt: Date.UTC(2026, 10, 1),
            achievements,
          },
        ],
      ]),
    });
  }

  /** What the Rust part answers, with these kept sign-ins. */
  function gog(answer: () => unknown, logins: typeof kept | [] = kept) {
    useKeptLogins.setState({ logins });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "logins_list") return logins;
      if (command === "gog_read_achievements") return answer();
      throw new Error(`unexpected ${command}`);
    });
  }

  afterEach(() => {
    saveListsMock.mockClear();
  });

  it("opening the tab with a kept sign-in and nothing saved loads the list once, without a window", async () => {
    nothingSaved();
    gog(() => ({
      status: "ok",
      achievements: [
        achievement("FIRST_STEP", { name: "First Step", globalPercent: 85 }),
        achievement("WIN_10", { name: "Ten Wins", unlocked: true }),
      ],
    }));
    await render(mordor);
    expect(gogReads()).toEqual([
      ["gog_read_achievements", { productId: "1213504814", language: "en-US" }],
    ]);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "library_gog_sign_in",
      expect.anything(),
    );
    expect(container.textContent).toContain("1 of 2 unlocked");
    expect(rowNames()).toEqual(["Ten Wins", "First Step"]);
    expect(saveListsMock).toHaveBeenCalledOnce();

    // Saved now: opening the tab again reads nothing.
    await act(async () => root.render(<></>));
    await render(mordor);
    expect(gogReads()).toHaveLength(1);
  });

  it("never loads without a kept sign-in, and offers the GOG sign-in", async () => {
    nothingSaved();
    gog(() => ({ status: "ok", achievements: [] }), []);
    await render(mordor);
    expect(gogReads()).toHaveLength(0);
    expect(container.textContent).toContain(
      "Sign in to GOG to load your achievements.",
    );
    expect(buttons()).toContain("Sign in to GOG");
  });

  it("signs in through the existing GOG window, then loads once", async () => {
    nothingSaved();
    let logins: typeof kept | [] = [];
    useKeptLogins.setState({ logins });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "library_gog_sign_in") {
        logins = kept;
        return undefined;
      }
      if (command === "logins_list") return logins;
      if (command === "gog_read_achievements")
        return {
          status: "ok",
          achievements: [achievement("WIN_10", { unlocked: true })],
        };
      throw new Error(`unexpected ${command}`);
    });
    await render(mordor);
    await click("Sign in to GOG");
    await act(async () => {});
    expect(invokeMock).toHaveBeenCalledWith(
      "library_gog_sign_in",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect(gogReads()).toHaveLength(1);
    expect(container.textContent).toContain("1 of 1 unlocked");
  });

  it("shows where the list is from, without points", async () => {
    saved([
      achievement("WIN_10", { name: "Ten Wins", unlocked: true }),
      achievement("FIRST_STEP", { name: "First Step", globalPercent: 85 }),
    ]);
    gog(() => ({ status: "unavailable" }));
    await render(mordor);
    expect(container.textContent).toContain(
      `From GOG, updated ${new Date(Date.UTC(2026, 10, 1)).toLocaleDateString(appLocale())}`,
    );
    expect(container.textContent).not.toContain("XP");
    expect(container.textContent).not.toContain("Gamerscore");
    expect(buttons()).toContain("Refresh");
    // A saved list doesn't reload by itself.
    expect(gogReads()).toHaveLength(0);
  });

  it("has a text for every answer without a list", async () => {
    for (const [status, text] of [
      ["noAchievements", "This game has no GOG achievements."],
      ["unavailable", "GOG didn't send the achievements. Try again later."],
      ["noLogin", "Sign in to GOG to load your achievements."],
      ["needsSignIn", "GOG needs you to sign in again."],
    ] as const) {
      nothingSaved();
      clearLoginHealth("gog");
      gog(() => ({ status }));
      await act(async () => root.render(<></>));
      await render(mordor);
      expect(container.textContent, status).toContain(text);
    }
    expect(buttons()).toContain("Sign in again");
  });

  it("reads nothing with a sign-in that already needs renewing", async () => {
    nothingSaved();
    gog(() => ({ status: "ok", achievements: [] }));
    recordLoginHealth("gog", "needsSignIn");
    await render(mordor);
    expect(gogReads()).toHaveLength(0);
    expect(container.textContent).toContain("GOG needs you to sign in again.");
    expect(buttons()).toContain("Sign in again");
  });

  it("a refresh that fails keeps the saved list on screen, with the line above it", async () => {
    saved([achievement("WIN_10", { name: "Ten Wins", unlocked: true })]);
    gog(() => ({ status: "unavailable" }));
    await render(mordor);
    await click("Refresh");
    expect(gogReads()).toHaveLength(1);
    expect(rowNames()).toEqual(["Ten Wins"]);
    expect(container.textContent).toContain(
      "GOG didn't send the achievements. Try again later.",
    );
    expect(saveListsMock).not.toHaveBeenCalled();
  });

  it("a refresh replaces the saved list with GOG's newer one", async () => {
    saved([achievement("WIN_10", { name: "Ten Wins" })]);
    gog(() => ({
      status: "ok",
      achievements: [
        achievement("WIN_10", {
          name: "Ten Wins",
          unlocked: true,
          unlockedAt: 1_793_471_047_000,
        }),
      ],
    }));
    await render(mordor);
    expect(container.textContent).toContain("0 of 1 unlocked");
    await click("Refresh");
    expect(container.textContent).toContain("1 of 1 unlocked");
    expect(saveListsMock).toHaveBeenCalledOnce();
  });

  it("names GOG in the pills", async () => {
    // The Epic Games pill comes first, with nothing saved for it.
    loadListMock.mockResolvedValue(null);
    saved([achievement("WIN_10", { name: "Ten Wins", unlocked: true })]);
    gog(() => ({ status: "unavailable" }));
    await render([
      { provider: "epic", externalId: "Sugar" },
      ...mordor,
      { provider: "xbox", externalId: "1234" },
    ]);
    const pills = [...container.querySelectorAll('[role="group"] button')].map(
      (button) => button.textContent,
    );
    expect(pills).toEqual(["Epic Games", "GOG", "Xbox"]);
  });
});
