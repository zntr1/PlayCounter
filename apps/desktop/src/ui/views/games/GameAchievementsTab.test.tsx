// @vitest-environment happy-dom
import type { AchievementList, GameAchievement } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { loadListMock } = vi.hoisted(() => ({ loadListMock: vi.fn() }));
vi.mock("../../../achievements/xboxLists", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../achievements/xboxLists")>();
  return {
    ...original,
    loadXboxAchievementList: loadListMock,
    saveXboxAchievementLists: vi.fn(async (lists: AchievementList[]) => {
      original.useXboxAchievementLists.setState((state) => {
        const next = new Map(state.lists);
        for (const list of lists) next.set(list.externalId, list);
        return { lists: next };
      });
    }),
  };
});

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("../../../library/providers/xbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../library/providers/xbox")>()),
  refreshXboxAchievementList: refreshMock,
}));

import { useXboxAchievementLists } from "../../../achievements/xboxLists";
import { useKeptLogins } from "../../../library/keptLogins";
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
  useXboxAchievementLists.setState({ lists: new Map() });
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
  it("games with a Steam or Xbox entry, Steam first", () => {
    const entry = (provider: string, externalId: string) =>
      ({ provider, externalId }) as never;
    expect(
      achievementSources({
        libraryImports: [
          entry("xbox", "1234"),
          entry("epic", "fortnite"),
          entry("steam", "620"),
          entry("steam", "620"),
        ],
      }),
    ).toEqual([
      { provider: "steam", externalId: "620" },
      { provider: "xbox", externalId: "1234" },
    ]);
    expect(
      achievementSources({ libraryImports: [entry("battlenet", "wow")] }),
    ).toEqual([]);
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
    loadListMock.mockImplementation(async (titleId: string) => {
      useXboxAchievementLists.setState({ lists: new Map([[titleId, null]]) });
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
    useXboxAchievementLists.setState({
      lists: new Map([
        [
          "1234",
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
      loadListMock.mockImplementation(async (titleId: string) => {
        useXboxAchievementLists.setState({ lists: new Map([[titleId, null]]) });
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
      useXboxAchievementLists.setState({
        lists: new Map([
          [
            "1234",
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
      loadListMock.mockImplementation(async (titleId: string) => {
        useXboxAchievementLists.setState({ lists: new Map([[titleId, null]]) });
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
    useXboxAchievementLists.setState({
      lists: new Map([
        [
          "1234",
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
});
