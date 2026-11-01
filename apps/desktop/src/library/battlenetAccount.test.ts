import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { validLibraryExternalId } from "@playcounter/shared";
import reader from "../../src-tauri/src/library/battlenet_account.js?raw";
import {
  mergeBattleNetAccountLibrary,
  readBattleNetAccountLibrary,
  retainBattleNetProductIds,
  signInBattleNetAccount,
  type BattleNetAccountLibrary,
} from "./battlenetAccount";
import { battleNetProvider } from "./providers/battlenet";
import type { LibraryScanResult } from "./types";
import { useKeptLogins } from "./keptLogins";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const empty: LibraryScanResult = { games: [], warnings: [], partial: false };
const account: BattleNetAccountLibrary = {
  games: [{ titleId: 5730135, name: "World of Warcraft", franchise: "wow" }],
  incomplete: false,
};

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Battle.net account and installation merge", () => {
  it("deduplicates regional accounts without treating membership as play history", () => {
    const result = mergeBattleNetAccountLibrary(
      { ...account, games: [...account.games, ...account.games] },
      empty,
    );
    expect(result.games).toEqual([
      {
        externalId: "wow",
        name: "World of Warcraft",
        installed: false,
        installationStatusUnknown: undefined,
        inAccountLibrary: true,
        playtimeSeconds: null,
        hasPlayedEvidence: false,
        executables: [],
      },
    ]);
  });

  it("merges installed evidence and keeps WoW variants separate", () => {
    const local: LibraryScanResult = {
      ...empty,
      games: ["wow", "wow_classic", "wow_classic_era"].map((externalId) => ({
        externalId,
        installed: true,
        installPath: `C:\\WoW\\${externalId}`,
        playtimeSeconds: null,
        hasPlayedEvidence: true,
        lastPlayedUnix: 1_700_000_000,
        executables: [
          {
            fileName: "Wow.exe",
            relativePath: "Wow.exe",
            sizeBytes: 1000,
            depth: 0,
          },
        ],
      })),
    };
    const result = mergeBattleNetAccountLibrary(account, local);
    expect(result.games).toHaveLength(3);
    expect(result.games.find((game) => game.externalId === "wow")).toEqual({
      ...local.games[0],
      inAccountLibrary: true,
    });
    expect(result.games.filter((game) => game.inAccountLibrary)).toHaveLength(
      1,
    );
  });

  it("retains imported product aliases when a later installation uses another code", () => {
    const diablo: BattleNetAccountLibrary = {
      games: [{ titleId: 4613486, name: "Diablo IV", franchise: null }],
      incomplete: false,
    };
    const local: LibraryScanResult = {
      ...empty,
      games: [
        {
          externalId: "fen",
          installed: true,
          playtimeSeconds: null,
          executables: [],
          installPath: "C:\\Diablo",
        },
      ],
    };
    expect(mergeBattleNetAccountLibrary(diablo, local).games).toHaveLength(1);
    expect(
      mergeBattleNetAccountLibrary(diablo, local, ["fenris"]).games[0],
    ).toMatchObject({ externalId: "fenris", installed: true });
    expect(
      retainBattleNetProductIds(local, ["fenris"]).games[0].externalId,
    ).toBe("fenris");
  });

  it("keeps unknown titles and classic editions for review with stable, valid IDs", () => {
    const games: BattleNetAccountLibrary["games"] = [
      { titleId: 12345, name: "New release", franchise: null },
      { titleId: null, name: "Diablo II", franchise: "diablo-ii" },
      {
        titleId: null,
        name: "Diablo II: Lord of Destruction",
        franchise: "diablo-ii",
      },
    ];
    const first = mergeBattleNetAccountLibrary(
      { games, incomplete: false },
      empty,
    ).games;
    const second = mergeBattleNetAccountLibrary(
      { games: [...games].reverse(), incomplete: false },
      empty,
    ).games;
    expect(first).toEqual(second);
    expect(new Set(first.map((game) => game.externalId)).size).toBe(3);
    expect(
      first.every((game) =>
        validLibraryExternalId("battlenet", game.externalId),
      ),
    ).toBe(true);
    expect(first.find((game) => game.name === "New release")?.externalId).toBe(
      "title_12345",
    );
  });

  it("marks uncertain installation status only when the local scan is incomplete", () => {
    const partialLocal = mergeBattleNetAccountLibrary(account, {
      ...empty,
      partial: true,
      warnings: ["Local scan failed"],
    });
    expect(partialLocal.games[0].installationStatusUnknown).toBe(true);
    expect(partialLocal.partial).toBe(true);
    const partialAccount = mergeBattleNetAccountLibrary(
      { ...account, incomplete: true },
      empty,
    );
    expect(partialAccount.games[0].installationStatusUnknown).toBeUndefined();
    expect(partialAccount.warnings).toHaveLength(1);
  });
});

describe("Battle.net provider sign-in lifecycle", () => {
  it("connects without scanning any games and refreshes saved status", async () => {
    const saved = [{ service: "battlenet", name: null, savedAt: 1 }];
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "logins_list" ? saved : undefined,
    );
    await signInBattleNetAccount();
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "library_battlenet_sign_in",
      "logins_list",
    ]);
    expect(useKeptLogins.getState().logins).toEqual(saved);
  });

  it("updates the saved connection when native cleanup finishes after leaving the view", async () => {
    let complete!: () => void;
    const saved = [{ service: "battlenet", name: null, savedAt: 2 }];
    useKeptLogins.setState({ logins: [] });
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "library_battlenet_sign_in")
        return new Promise((resolve) => {
          complete = () => resolve(undefined);
        });
      return Promise.resolve(command === "logins_list" ? saved : undefined);
    });
    const controller = new AbortController();
    const result = signInBattleNetAccount(controller.signal);
    const cancelled = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await cancelled;
    expect(useKeptLogins.getState().logins).toEqual([]);
    complete();
    await vi.waitFor(() =>
      expect(useKeptLogins.getState().logins).toEqual(saved),
    );
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
  });

  it("never signs in for a local or background scan", async () => {
    vi.mocked(invoke).mockResolvedValue(empty);
    expect(await battleNetProvider.scan(0)).toEqual(empty);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("library_scan", {
      provider: "battlenet",
      accountId: 0,
    });
  });

  it("reads the account only when requested, then combines it with a fresh local scan", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(empty);
    const result = await battleNetProvider.scan(0, { battleNetAccount: true });
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "library_battlenet_account_games",
      "logins_list",
      "library_scan",
    ]);
    expect(result.games[0]).toMatchObject({
      externalId: "wow",
      inAccountLibrary: true,
      installed: false,
    });
  });

  it("cancels the matching native window promptly and ignores its late result", async () => {
    let complete!: (value: BattleNetAccountLibrary) => void;
    vi.mocked(invoke).mockImplementation((command) =>
      command === "library_battlenet_account_games"
        ? new Promise((resolve) => {
            complete = resolve as typeof complete;
          })
        : Promise.resolve(undefined),
    );
    const controller = new AbortController();
    const pending = readBattleNetAccountLibrary(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    const { requestId } = vi.mocked(invoke).mock.calls[0][1] as {
      requestId: string;
    };
    controller.abort();
    await rejected;
    expect(invoke).toHaveBeenCalledWith("library_cancel_battlenet_account", {
      requestId,
    });
    complete(account);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
  });

  it("does not open a window for an already cancelled import", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readBattleNetAccountLibrary(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Battle.net webview reader", () => {
  function harness(
    modern: unknown,
    classic: unknown,
    statuses = [200, 200],
    pathname = "/overview",
    authentication: { body: unknown; status: number } = {
      body: { authenticated: true },
      status: 200,
    },
  ) {
    const window: Record<string, unknown> = {};
    const fetch = vi.fn(async (path: string, _options?: RequestInit) => {
      const index = path.endsWith("classic-games") ? 1 : 0;
      const response = new Response(
        JSON.stringify(
          path === "/api/" ? authentication.body : index ? classic : modern,
        ),
        {
          status: path === "/api/" ? authentication.status : statuses[index],
          headers: { "content-type": "application/json" },
        },
      );
      Object.defineProperty(response, "url", {
        value: `https://account.battle.net${path}`,
      });
      return response;
    });
    const evaluate = () =>
      runInNewContext(reader, {
        window,
        location: { origin: "https://account.battle.net", pathname },
        fetch,
        AbortController,
        setTimeout,
        clearTimeout,
      }) as {
        status: string;
        games?: BattleNetAccountLibrary["games"];
        incomplete?: boolean;
        error?: string;
      } | null;
    return { evaluate, fetch };
  }

  it("returns only game metadata, stripping names of accounts, CD keys and subscription fields", async () => {
    const modern = {
      gameAccounts: [
        {
          titleId: 5730135,
          localizedGameName: "World of Warcraft",
          regionalGameFranchiseIconFilename: "wow",
          gameAccountName: "Private account",
          accountUniqueId: { gameAccountId: 998877 },
          titleHasGameTime: true,
        },
      ],
    };
    const classic = {
      classicGames: [
        {
          localizedGameName: "Diablo II",
          regionalGameFranchiseIconFilename: "diablo-ii",
          cdKeys: ["PRIVATE-KEY"],
        },
      ],
    };
    const { evaluate, fetch } = harness(modern, classic);
    expect(evaluate()?.status).toBe("pending");
    await vi.waitFor(() => expect(evaluate()?.status).toBe("complete"));
    const result = evaluate();
    expect(result?.games).toEqual([
      { titleId: 5730135, name: "World of Warcraft", franchise: "wow" },
      { titleId: null, name: "Diablo II", franchise: "diablo-ii" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /Private|PRIVATE|998877|titleHasGameTime|cdKeys/,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/",
      "/api/games-and-subs",
      "/api/classic-games",
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/games-and-subs",
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
      }),
    );
  });

  it("does not read login forms or start requests on the sign-in page", () => {
    const { evaluate, fetch } = harness({}, {}, [200, 200], "/login/");
    expect(evaluate()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([200, 401, 403])(
    "confirms an expired session from account status HTTP %s without fetching games",
    async (status) => {
      const { evaluate, fetch } = harness({}, {}, [200, 200], "/overview", {
        body: { authenticated: false, accountName: "Private account" },
        status,
      });
      evaluate();
      await vi.waitFor(() =>
        expect(evaluate()).toEqual({ status: "error", error: "expired" }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403])(
    "requests renewal for a library HTTP %s without declaring the login expired",
    async (status) => {
      const { evaluate } = harness({}, {}, [status, status]);
      evaluate();
      await vi.waitFor(() =>
        expect(evaluate()).toEqual({ status: "error", error: "renew" }),
      );
    },
  );

  it.each([{}, { authenticated: "true" }, null])(
    "requires an explicit authenticated account status: %j",
    async (body) => {
      const { evaluate, fetch } = harness({}, {}, [200, 200], "/overview", {
        body,
        status: 200,
      });
      evaluate();
      await vi.waitFor(() =>
        expect(evaluate()).toEqual({ status: "error", error: "unavailable" }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves the session on an account-status server failure", async () => {
    const { evaluate, fetch } = harness({}, {}, [200, 200], "/overview", {
      body: { authenticated: false },
      status: 503,
    });
    evaluate();
    await vi.waitFor(() =>
      expect(evaluate()).toEqual({ status: "error", error: "unavailable" }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("requests renewal for a forbidden HTML challenge without declaring the login expired", async () => {
    const { evaluate, fetch } = harness({}, {});
    fetch.mockImplementation(async () => {
      const response = new Response("<html>Challenge</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", {
        value: "https://account.battle.net/api/",
      });
      return response;
    });
    evaluate();
    await vi.waitFor(() =>
      expect(evaluate()).toEqual({ status: "error", error: "renew" }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch games before the authentication response arrives", async () => {
    const { evaluate, fetch } = harness({}, {});
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    evaluate();
    expect(fetch).toHaveBeenCalledTimes(1);
    const response = Response.json({ authenticated: false });
    Object.defineProperty(response, "url", {
      value: "https://account.battle.net/api/",
    });
    finish(response);
    await vi.waitFor(() => expect(evaluate()?.status).toBe("error"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats an account-status network failure as unavailable", async () => {
    const { evaluate, fetch } = harness({}, {});
    fetch.mockRejectedValue(new Error("network unavailable"));
    evaluate();
    await vi.waitFor(() =>
      expect(evaluate()).toEqual({ status: "error", error: "unavailable" }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [200, "{invalid", "unavailable"],
    [401, "{invalid", "renew"],
    [
      200,
      JSON.stringify({ authenticated: true, extra: "x".repeat(64_000) }),
      "unavailable",
    ],
  ])(
    "rejects malformed or oversized account status HTTP %s",
    async (status, body, error) => {
      const { evaluate, fetch } = harness({}, {});
      fetch.mockImplementation(async () => {
        const response = new Response(body as string, {
          status: status as number,
          headers: { "content-type": "application/json" },
        });
        Object.defineProperty(response, "url", {
          value: "https://account.battle.net/api/",
        });
        return response;
      });
      evaluate();
      await vi.waitFor(() =>
        expect(evaluate()).toEqual({ status: "error", error }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("times out an unresponsive account check without fetching games", async () => {
    vi.useFakeTimers();
    try {
      const { evaluate, fetch } = harness({}, {});
      fetch.mockImplementation(
        (_path, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Timed out", "AbortError")),
              { once: true },
            );
          }),
      );
      evaluate();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(evaluate()).toEqual({ status: "error", error: "unavailable" });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects responses from an unexpected origin even if their shape looks valid", async () => {
    const { evaluate, fetch } = harness({}, {});
    fetch.mockImplementation(async () => {
      const response = Response.json({ gameAccounts: [], classicGames: [] });
      Object.defineProperty(response, "url", {
        value: "https://evil.test/api/games-and-subs",
      });
      return response;
    });
    evaluate();
    await vi.waitFor(() =>
      expect(evaluate()).toEqual({ status: "error", error: "unavailable" }),
    );
  });

  it("retains a valid list when the classic endpoint fails and marks it incomplete", async () => {
    const { evaluate } = harness(
      { gameAccounts: [{ titleId: 17459, localizedGameName: "Diablo III" }] },
      {},
      [200, 500],
    );
    evaluate();
    await vi.waitFor(() => expect(evaluate()?.status).toBe("complete"));
    expect(evaluate()).toMatchObject({
      incomplete: true,
      games: [{ titleId: 17459, name: "Diablo III" }],
    });
  });

  it("rejects changed response shapes and safely skips invalid IDs", async () => {
    const changed = harness({ differentField: [] }, {}, [200, 500]);
    changed.evaluate();
    await vi.waitFor(() => expect(changed.evaluate()?.status).toBe("error"));
    const malformed = harness(
      {
        gameAccounts: [
          { titleId: -1 },
          { titleId: "123", localizedGameName: "Valid" },
        ],
      },
      { classicGames: [] },
    );
    malformed.evaluate();
    await vi.waitFor(() =>
      expect(malformed.evaluate()?.status).toBe("complete"),
    );
    expect(malformed.evaluate()).toMatchObject({
      incomplete: true,
      games: [{ titleId: 123, name: "Valid" }],
    });
  });
});
