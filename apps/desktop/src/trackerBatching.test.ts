import type {
  Game,
  MatchProcessesRequest,
  MatchProcessesResponse,
} from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));

import { useAppStore, type ProcessSnapshot } from "./store";
import { scanProcessesNow } from "./tracker";

const game: Game = { id: 42, name: "Game", source: "igdb", coverUrl: "" };
let processes: ProcessSnapshot[];
let requests: MatchProcessesRequest["processes"][];

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Macintosh" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    backendHealth: { status: "online", checkedAt: null, detail: null },
  });
  processes = [];
  requests = [];
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) =>
    command === "scan_processes" ? processes : undefined,
  );
});

afterEach(() => vi.unstubAllGlobals());

function macProcesses(count: number, prefix = "BatchGame"): ProcessSnapshot[] {
  return Array.from({ length: count }, (_, index) => {
    const exeName = `${prefix}${String(index).padStart(3, "0")}`;
    return {
      exeName,
      exePath: `/Applications/${exeName}.app/Contents/MacOS/${exeName}`,
      pid: 1000 + index,
    };
  });
}

function mockMatchApi(
  respond: (
    items: MatchProcessesRequest["processes"],
    requestNumber: number,
  ) => MatchProcessesResponse | Response,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/api/match-processes")) {
        throw new Error(`Unexpected request: ${input}`);
      }
      const body = JSON.parse(String(init?.body)) as MatchProcessesRequest;
      requests.push(body.processes);
      // Mirror the API's request limit so an oversized scan is rejected.
      if (body.processes.length === 0 || body.processes.length > 200) {
        return new Response(null, { status: 400, statusText: "Bad Request" });
      }
      const response = respond(body.processes, requests.length);
      return response instanceof Response ? response : Response.json(response);
    }),
  );
}

describe("process lookup batching", () => {
  it.each([0, 200, 201, 400, 405])(
    "resolves all %i macOS process names within the request limit",
    async (count) => {
      const unique = macProcesses(count);
      // Multiple instances must keep their PIDs while sharing a lookup.
      processes = unique.flatMap((process) => [
        process,
        { ...process, pid: process.pid! + 10000 },
      ]);
      const lastKey = unique.at(-1)?.exeName.toLowerCase();
      mockMatchApi((items) => ({
        matches: items.map(({ key }) => ({
          key,
          game: key === lastKey ? game : null,
        })),
      }));

      await scanProcessesNow();

      expect(requests).toHaveLength(Math.ceil(count / 200));
      expect(requests.every((items) => items.length <= 200)).toBe(true);
      expect(requests.flat()).toEqual(
        unique.map(({ exeName }) => ({
          key: exeName.toLowerCase(),
          identifiers: [
            { platform: "macos", kind: "app_bundle", value: `${exeName}.app` },
            { platform: "macos", kind: "process_name", value: exeName },
          ],
        })),
      );
      const state = useAppStore.getState();
      expect(state.runtimeError).toBeNull();
      expect(state.processes).toHaveLength(processes.length);
      expect(state.exeCache.size).toBe(count);
      expect(state.activeSessions).toHaveLength(count === 0 ? 0 : 1);
      if (lastKey) {
        expect(state.exeCache.get(lastKey)).toMatchObject({
          state: "matched",
          gameId: game.id,
        });
        expect(state.activeSessions[0].gameId).toBe(game.id);
      }
    },
  );

  it.each(["http", "network"])(
    "keeps successful batches and retries a batch after a %s failure",
    async (failure) => {
      processes = macProcesses(405);
      mockMatchApi((items, requestNumber) => {
        if (requestNumber === 2) {
          if (failure === "network") throw new Error("Network unavailable");
          return new Response(null, {
            status: 503,
            statusText: "Service Unavailable",
          });
        }
        return { matches: items.map(({ key }) => ({ key, game })) };
      });

      await scanProcessesNow();

      expect(requests.map((items) => items.length)).toEqual([200, 200, 5]);
      const state = useAppStore.getState();
      expect(state.exeCache.size).toBe(205);
      for (const process of processes.slice(200, 400)) {
        expect(state.exeCache.has(process.exeName.toLowerCase())).toBe(false);
      }
      expect(state.exeCache.get("batchgame000")?.gameId).toBe(game.id);
      expect(state.exeCache.get("batchgame404")?.gameId).toBe(game.id);
      expect(state.activeSessions).toHaveLength(1);
      const sessionId = state.activeSessions[0].id;

      await scanProcessesNow();

      expect(requests).toHaveLength(4);
      expect(requests[3].map(({ key }) => key)).toEqual(
        processes.slice(200, 400).map(({ exeName }) => exeName.toLowerCase()),
      );
      expect(useAppStore.getState().exeCache.size).toBe(405);
      expect(useAppStore.getState().activeSessions).toMatchObject([
        { id: sessionId, gameId: game.id },
      ]);
    },
  );

  it("keeps ambiguous and pending matches from a later batch", async () => {
    processes = macProcesses(202);
    const candidates = [game, { ...game, id: 43, name: "Another game" }];
    const pending: Game = { ...game, id: 44, source: "community" };
    mockMatchApi((items) => ({
      matches: items.map(({ key }) => ({
        key,
        game: null,
        ...(key === "batchgame200" ? { ambiguousGames: candidates } : {}),
        ...(key === "batchgame201" ? { pendingCommunityGames: [pending] } : {}),
      })),
    }));

    await scanProcessesNow();

    expect(requests.map((items) => items.length)).toEqual([200, 2]);
    const state = useAppStore.getState();
    expect(state.ambiguousMatches).toMatchObject([
      { exeName: "BatchGame200", candidates },
    ]);
    expect(state.exeCache.has("batchgame200")).toBe(false);
    expect(state.exeCache.get("batchgame201")).toMatchObject({
      state: "unmatched",
      pendingCommunityGame: pending,
    });
    expect(state.activeSessions).toEqual([]);
  });

  it.each([false, true])(
    "batches background upgrade checks (middle batch fails: %s)",
    async (failMiddleBatch) => {
      // Distinct names keep the per-executable retry cooldown independent.
      processes = macProcesses(405, `Upgrade${failMiddleBatch}`);
      useAppStore.setState({
        exeCache: new Map(
          processes.map(({ exeName }) => [
            exeName.toLowerCase(),
            {
              exeName,
              state: "matched" as const,
              gameId: -1,
              gameName: "Custom game",
              source: "custom" as const,
              coverUrl: "",
              lastCheckedAt: "2026-09-01T00:00:00.000Z",
            },
          ]),
        ),
      });
      mockMatchApi((items, requestNumber) => {
        if (failMiddleBatch && requestNumber === 2) {
          return new Response(null, { status: 503 });
        }
        return { matches: items.map(({ key }) => ({ key, game })) };
      });

      await scanProcessesNow();
      await vi.waitFor(() => {
        expect(
          useAppStore
            .getState()
            .exeCache.get(processes[404].exeName.toLowerCase())
            ?.communityUpgradeGame,
        ).toEqual(game);
      });

      expect(requests.map((items) => items.length)).toEqual([200, 200, 5]);
      const cache = useAppStore.getState().exeCache;
      for (const [index, process] of processes.entries()) {
        expect(
          cache.get(process.exeName.toLowerCase())?.communityUpgradeGame,
        ).toEqual(
          failMiddleBatch && index >= 200 && index < 400 ? undefined : game,
        );
      }
    },
  );
});
