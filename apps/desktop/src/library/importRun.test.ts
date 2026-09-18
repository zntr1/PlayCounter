import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { rateLimitedFetch } from "../rateLimitedFetch";
import { submitLocalLinkToCommunity } from "../tracker";
import { runLibraryImport } from "./importRun";
import type { LibraryImportCommit } from "./types";

vi.mock("../tracker", () => ({ submitLocalLinkToCommunity: vi.fn() }));
const submit = vi.mocked(submitLocalLinkToCommunity);
let sequence = 0;
let endpoint: string;

function commit(id: number): LibraryImportCommit {
  const exeName = `game-${id}.exe`;
  return {
    entry: {
      provider: "steam",
      externalId: String(id),
      igdbId: id,
      gameId: id,
      source: "igdb",
      name: `Game ${id}`,
      coverUrl: "",
      importedAt: "2026-09-16T00:00:00Z",
      lastReadAt: "2026-09-16T00:00:00Z",
      providerSeconds: 3600,
      linkedExeNames: [exeName],
      linkedExeSources: ["custom"],
    },
    metadata: {
      id,
      igdbId: id,
      name: `Game ${id}`,
      coverUrl: "",
      source: "igdb",
    },
    exeCacheEntries: [
      {
        exeName,
        state: "matched",
        gameId: -id,
        igdbId: id,
        gameName: `Game ${id}`,
        source: "custom",
        lastCheckedAt: "2026-09-16T00:00:00Z",
        libraryProvider: "steam",
        libraryExternalId: String(id),
      },
    ],
    scopedLinks: [],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  endpoint = `https://import-${sequence++}.example`;
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, apiEndpoint: endpoint },
  });
  vi.stubGlobal("localStorage", {
    setItem: vi.fn(),
    getItem: vi.fn(() => null),
  });
  submit.mockReset().mockResolvedValue({ kind: "submitted" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bulk import requests", () => {
  it("keeps a Battle.net executable choice local without submitting a global mapping", async () => {
    const plan = commit(1);
    plan.entry.provider = "battlenet";
    plan.entry.externalId = "wow_classic_era";
    plan.entry.providerSeconds = null;
    plan.exeCacheEntries = [];
    plan.scopedLinks = [
      {
        exeName: "WowClassic.exe",
        pathPrefix: "c:\\games\\wow\\_classic_era_",
        gameId: -1,
        igdbId: 1,
        gameName: "WoW Classic",
        coverUrl: "",
        source: "custom",
        provider: "battlenet",
        externalId: "wow_classic_era",
        setAt: plan.entry.importedAt,
      },
    ];
    expect((await runLibraryImport([plan])).shareOutcomes).toEqual([]);
    expect(submit).not.toHaveBeenCalled();
    expect(useAppStore.getState().scopedExeLinks.size).toBe(1);
  });

  it("resumes remaining submissions after a 429 without replaying the attempted write", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
        ),
    );
    submit.mockImplementationOnce(async () => {
      await rateLimitedFetch(endpoint);
      return { kind: "failed", error: "429 Too Many Requests" };
    });
    const run = runLibraryImport([commit(1), commit(2)]);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await run;
    expect(submit.mock.calls.map(([ref]) => ref.key)).toEqual([
      "game-1.exe",
      "game-2.exe",
    ]);
    expect(result.shareOutcomes.map(({ outcome }) => outcome.kind)).toEqual([
      "failed",
      "submitted",
    ]);
  });

  it("stops during pacing without undoing the imported local library", async () => {
    const controller = new AbortController();
    const run = runLibraryImport([commit(1), commit(2)], controller.signal);
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await rejected;
    expect(submit).toHaveBeenCalledOnce();
    expect(useAppStore.getState().libraryImports.size).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saves the library immediately but paces submissions instead of bursting", async () => {
    const run = runLibraryImport([commit(1), commit(2), commit(3)]);
    expect(useAppStore.getState().libraryImports.size).toBe(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_001);
    expect((await run).shareOutcomes).toHaveLength(3);
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("waits out a known cooldown and stops queued submissions when cancelled", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
        ),
    );
    await rateLimitedFetch(endpoint);
    const controller = new AbortController();
    const run = runLibraryImport([commit(1), commit(2)], controller.signal);
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(submit).not.toHaveBeenCalled();
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(useAppStore.getState().libraryImports.size).toBe(2);
  });
});
