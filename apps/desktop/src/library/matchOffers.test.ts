import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { rateLimitedFetch } from "../rateLimitedFetch";
import {
  checkLibraryImportForMatches,
  type LibraryImportMatchCheck,
} from "./recheck";
import {
  dismissLibraryMatchOffer,
  startLibraryImportMatchChecks,
  untrackableLibraryImports,
  useLibraryMatchOffers,
} from "./matchOffers";
import { libraryEntryKey, type LibraryImportEntry } from "./types";

vi.mock("./recheck", () => ({ checkLibraryImportForMatches: vi.fn() }));
const lookup = vi.mocked(checkLibraryImportForMatches);
let stop: (() => void) | undefined;

function entry(
  id: number,
  provider: "steam" | "xbox" = "steam",
): LibraryImportEntry {
  return {
    provider,
    externalId: String(id),
    gameId: id,
    igdbId: id,
    source: "igdb",
    name: `Game ${id}`,
    coverUrl: "",
    importedAt: "2026-01-01T00:00:00.000Z",
    lastReadAt: "2026-01-01T00:00:00.000Z",
    providerSeconds: null,
    linkedExeNames: [],
    linkedExeSources: [],
  };
}

function setImports(entries: LibraryImportEntry[]) {
  useAppStore.setState({
    libraryImports: new Map(
      entries.map((item) => [
        libraryEntryKey(item.provider, item.externalId),
        item,
      ]),
    ),
  });
}

function found(item: LibraryImportEntry): LibraryImportMatchCheck {
  return {
    kind: "found",
    executableNames: ["game.exe"],
    executableMatches: [{ name: "game.exe", sources: ["community"] }],
    commit: {
      entry: item,
      metadata: {
        id: item.gameId,
        igdbId: item.igdbId,
        name: item.name,
        coverUrl: "",
        source: "igdb",
      },
      exeCacheEntries: [],
      scopedLinks: [],
    },
  };
}

function health(status: "online" | "offline") {
  useAppStore.setState({
    backendHealth: { status, checkedAt: null, detail: null },
  });
}

beforeEach(() => {
  lookup.mockReset();
  useAppStore.setState(useAppStore.getInitialState(), true);
  health("online");
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startup library match offers", () => {
  it("leaves request capacity for tracking even with hundreds of startup entries", async () => {
    vi.useFakeTimers();
    setImports(Array.from({ length: 240 }, (_, index) => entry(index + 1)));
    lookup.mockResolvedValue({ kind: "not_found" });
    stop = startLibraryImportMatchChecks();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(lookup).toHaveBeenCalledTimes(60);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lookup).toHaveBeenCalledTimes(60);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the retry when cooldown expires during the pacing delay", async () => {
    vi.useFakeTimers();
    const endpoint = "https://short-cooldown.example";
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, apiEndpoint: endpoint },
    });
    setImports([entry(1), entry(2), entry(3), entry(4)]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { "Retry-After": "1" } }),
        ),
    );
    lookup
      .mockImplementationOnce(async () => {
        await rateLimitedFetch(endpoint);
        throw new Error("429");
      })
      .mockImplementation(async ({ entry }) => found(entry));
    stop = startLibraryImportMatchChecks();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(useLibraryMatchOffers.getState().offers.size).toBe(4);
    expect(lookup).toHaveBeenCalledTimes(5);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a throttled lookup after cooldown without a health transition", async () => {
    vi.useFakeTimers();
    const endpoint = "https://startup-cooldown.example";
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, apiEndpoint: endpoint },
    });
    setImports([entry(1)]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
        ),
    );
    lookup
      .mockImplementationOnce(async () => {
        await rateLimitedFetch(endpoint);
        throw new Error("429");
      })
      .mockImplementation(async ({ entry }) => found(entry));
    stop = startLibraryImportMatchChecks();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(useLibraryMatchOffers.getState().offers.size).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("offers Steam and Xbox matches without applying them, and checks only once per startup", async () => {
    const entries = [entry(1), entry(2, "xbox")];
    setImports(entries);
    lookup.mockImplementation(async ({ entry }) => found(entry));
    stop = startLibraryImportMatchChecks();
    await vi.waitFor(() =>
      expect(useLibraryMatchOffers.getState().offers.size).toBe(2),
    );
    expect(useAppStore.getState().exeCache.size).toBe(0);
    expect(
      useLibraryMatchOffers.getState().offers.get("steam:1")?.executableMatches,
    ).toEqual([{ name: "game.exe", sources: ["community"] }]);
    expect(
      useLibraryMatchOffers.getState().offers.get("xbox:2")?.executableMatches,
    ).toEqual([{ name: "game.exe", sources: ["community"] }]);
    expect(useAppStore.getState().libraryImports.get("steam:1")).toBe(
      entries[0],
    );
    dismissLibraryMatchOffer("steam:1");
    health("offline");
    health("online");
    await Promise.resolve();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(useLibraryMatchOffers.getState().offers.has("steam:1")).toBe(false);
  });

  it("skips cached, scoped, and emulator links across providers, but rechecks stale linked names", () => {
    const entries = [
      entry(1),
      entry(2),
      entry(3),
      { ...entry(4), linkedExeNames: ["gone.exe"] },
      entry(5, "xbox"),
    ];
    entries[4].igdbId = 1;
    setImports(entries);
    useAppStore.setState({
      exeCache: new Map([
        [
          "one.exe",
          {
            exeName: "one.exe",
            state: "matched",
            gameId: 1,
            source: "igdb",
            lastCheckedAt: "",
          },
        ],
      ]),
      scopedExeLinks: new Map([
        [
          "two",
          {
            exeName: "two.exe",
            pathPrefix: "c:\\games",
            gameId: 2,
            igdbId: 2,
            source: "igdb",
            gameName: "Game 2",
            coverUrl: "",
            provider: "steam",
            externalId: "2",
            setAt: "",
          },
        ],
      ]),
      emulatorMappings: new Map([
        [
          "three",
          {
            contentKey: "three",
            emulatorId: "emu",
            label: "Game 3",
            contentKind: "title_id",
            contentValue: "three",
            display: "Game 3",
            trust: "recognized",
            decision: "game",
            gameId: 3,
            igdbId: 3,
            source: "igdb",
            confidence: "user",
            shareable: false,
            decidedAt: "",
            lastSeenAt: "",
          },
        ],
      ]),
    });
    expect(untrackableLibraryImports()).toEqual([entries[3]]);
  });

  it("waits for online status and retries failures without hiding other offers", async () => {
    setImports([entry(1), entry(2, "xbox")]);
    health("offline");
    lookup
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async ({ entry }) => found(entry));
    stop = startLibraryImportMatchChecks();
    expect(lookup).not.toHaveBeenCalled();
    health("online");
    await vi.waitFor(() =>
      expect(useLibraryMatchOffers.getState().offers.size).toBe(1),
    );
    health("offline");
    health("online");
    await vi.waitFor(() =>
      expect(useLibraryMatchOffers.getState().offers.size).toBe(2),
    );
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it.each(["removed", "linked", "stopped"])(
    "discards a pending result when the game is %s",
    async (change) => {
      const item = entry(1);
      setImports([item]);
      let finish!: (value: LibraryImportMatchCheck) => void;
      lookup.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      stop = startLibraryImportMatchChecks();
      if (change === "removed") setImports([]);
      if (change === "linked")
        useAppStore.setState({
          exeCache: new Map([
            [
              "game.exe",
              {
                exeName: "game.exe",
                state: "matched",
                gameId: 1,
                igdbId: 1,
                source: "igdb",
                lastCheckedAt: "",
              },
            ],
          ]),
        });
      if (change === "stopped") stop();
      finish(found(item));
      await Promise.resolve();
      expect(useLibraryMatchOffers.getState().offers.size).toBe(0);
    },
  );

  it("offers only usable matches and paces lookups", async () => {
    vi.useFakeTimers();
    setImports([entry(1), entry(2), entry(3), entry(4), entry(5)]);
    const finish: Array<() => void> = [];
    lookup.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(() =>
            resolve({ kind: "needs_install", executableNames: ["game.exe"] }),
          );
        }),
    );
    stop = startLibraryImportMatchChecks();
    expect(lookup).toHaveBeenCalledTimes(3);
    finish[0]();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(lookup).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(lookup).toHaveBeenCalledTimes(4);
    stop();
    finish.forEach((resolve) => resolve());
    await Promise.resolve();
    expect(useLibraryMatchOffers.getState().offers.size).toBe(0);
  });

  it("aborts a stuck lookup after 15 seconds", async () => {
    vi.useFakeTimers();
    setImports([entry(1)]);
    lookup.mockImplementation(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    stop = startLibraryImportMatchChecks();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(lookup.mock.calls[0][0].signal?.aborted).toBe(true);
    expect(useLibraryMatchOffers.getState().offers.size).toBe(0);
  });
});
