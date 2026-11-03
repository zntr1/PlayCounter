import type { Game } from "@playcounter/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
import type { EmulatorMapping } from "./emulators/types";
import {
  createPersistedPayload,
  LIVE_STORAGE_KEY,
  readPersistedRecord,
  STORAGE_KEY,
} from "./persistence";
import { useAppStore, type ExeCacheEntry } from "./store";
import { resetToolTickForTests, scanProcessesNow } from "./tracker";
import { localDayKey } from "./toolUsage";

// The rule under test: while the same things keep running (a game, software,
// a Discovered app, an emulator game), scans never rewrite the whole saved
// state. Every other PlayCounter window (the live timer, overlays) gets a copy
// of each write, and the copies of a half-megabyte save piled up there.

const T0 = new Date("2026-11-03T18:00:00Z").getTime();
const romFile = String.raw`D:\PS2\Final Fantasy X.chd`;
const romKey = "pcsx2:rom:final fantasy x.chd";

const game: Game = { id: 42, name: "Game", coverUrl: "", source: "igdb" };

function cached(entry: Partial<ExeCacheEntry> & { exeName: string }) {
  return {
    state: "matched",
    lastCheckedAt: new Date(T0).toISOString(),
    ...entry,
  } as ExeCacheEntry;
}

const mapping: EmulatorMapping = {
  contentKey: romKey,
  emulatorId: "pcsx2",
  label: "PCSX2",
  contentKind: "rom",
  contentValue: "final fantasy x.chd",
  display: "Final Fantasy X.chd",
  trust: "recognized",
  decision: "game",
  gameId: 43,
  gameName: "Final Fantasy X",
  source: "igdb",
  confidence: "user",
  shareable: true,
  detectionSource: "open_file_handle",
  decidedAt: "2026-10-01T00:00:00.000Z",
  lastSeenAt: "2026-10-01T00:00:00.000Z",
};

const gameProcess = {
  exeName: "Game.exe",
  exePath: String.raw`C:\Games\Game\Game.exe`,
  pid: 101,
};
let running: unknown[];

function installMemoryStorage() {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => {
    values.set(key, value);
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem,
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    },
  });
  return {
    values,
    writesTo: (key: string) =>
      setItem.mock.calls
        .filter(([written]) => written === key)
        .map(([, value]) => value),
  };
}

async function scanAt(ms: number) {
  vi.setSystemTime(new Date(ms));
  await scanProcessesNow();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
  resetToolTickForTests();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    platform: "Win32",
  });
  running = [
    gameProcess,
    {
      exeName: "Discord.exe",
      exePath: String.raw`C:\Apps\Discord\Discord.exe`,
      pid: 102,
    },
    {
      exeName: "Helper.exe",
      exePath: String.raw`C:\Apps\Helper\Helper.exe`,
      pid: 103,
    },
    {
      exeName: "pcsx2-qt.exe",
      exePath: String.raw`C:\Emulators\pcsx2-qt.exe`,
      emulatorId: "pcsx2",
      pid: 104,
      startedAtUnix: 10,
      commandLine: [romFile],
      openFiles: [romFile],
      windowTitle: "Custom title",
    },
  ];
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "scan_processes") return running;
    if (command === "verify_emulator_content_paths")
      return [{ path: romFile, status: "ok" }];
    return undefined;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({})),
  );
  useAppStore.setState({
    exeCache: new Map([
      [
        "game.exe",
        cached({
          exeName: "Game.exe",
          gameId: game.id,
          gameName: game.name,
          coverUrl: game.coverUrl,
          source: game.source,
        }),
      ],
      [
        "discord.exe",
        cached({
          exeName: "Discord.exe",
          state: "tool",
          gameId: 7,
          gameName: "Discord",
          coverUrl: "",
          source: "community",
        }),
      ],
      ["helper.exe", cached({ exeName: "Helper.exe", state: "unmatched" })],
    ]),
    scopedExeLinks: new Map(),
    activeSessions: [],
    ambiguousMatches: [],
    recentSessions: [],
    toolUsage: {},
    knownEmulators: new Map(),
    emulatorMappings: new Map([[romKey, mapping]]),
    emulatorObservations: [],
    blacklist: new Set(),
    ignoredProcesses: new Set(),
    userIgnoredProcesses: new Set(),
    installUuid: "550e8400-e29b-41d4-a716-446655440000",
    seenContributionStatus: {},
    notifications: [],
    toasts: [],
    backendHealth: {
      status: "online",
      checkedAt: "2026-11-03T00:00:00.000Z",
      detail: null,
    },
    settings: {
      ...useAppStore.getState().settings,
      trackTools: true,
      emulatorDetection: true,
      emulatorContentLookup: false,
      ignoredEmulatorIds: [],
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("never rewrites the big save while the same things keep running", async () => {
  const storage = installMemoryStorage();
  await scanAt(T0);
  await scanAt(T0 + 5_000);
  const bigSaves = storage.writesTo(STORAGE_KEY).length;
  expect(bigSaves).toBeGreaterThan(0);

  for (let at = T0 + 10_000; at <= T0 + 180_000; at += 5_000) await scanAt(at);

  // All of it really ran and counted.
  const state = useAppStore.getState();
  const lastScan = new Date(T0 + 180_000).toISOString();
  expect(state.activeSessions.map((session) => session.gameId).sort()).toEqual([
    42, 43,
  ]);
  for (const session of state.activeSessions) {
    expect(Date.parse(session.checkpointedAt)).toBeGreaterThanOrEqual(
      T0 + 120_000,
    );
  }
  expect(state.toolUsage["discord.exe"]?.days[localDayKey(T0)]).toBe(180);
  expect(state.exeCache.get("helper.exe")?.trackedSeconds).toBeGreaterThan(0);
  expect(state.knownEmulators.get("pcsx2")?.lastSeenAt).toBe(lastScan);
  expect(state.emulatorMappings.get(romKey)?.lastSeenAt).toBe(lastScan);

  expect(storage.writesTo(STORAGE_KEY)).toHaveLength(bigSaves);
  const playSaves = storage.writesTo(LIVE_STORAGE_KEY);
  expect(playSaves.length).toBeGreaterThan(30);
  for (const save of playSaves) expect(save.length).toBeLessThan(2_000);
  // A restart loads all of it.
  expect(readPersistedRecord()).toEqual(
    JSON.parse(JSON.stringify(createPersistedPayload(state))),
  );
});

it("saves a finished session to the big save", async () => {
  const storage = installMemoryStorage();
  for (let at = T0; at <= T0 + 120_000; at += 5_000) await scanAt(at);
  const bigSaves = storage.writesTo(STORAGE_KEY).length;

  running = running.filter((process) => process !== gameProcess);
  for (let at = T0 + 125_000; at <= T0 + 150_000; at += 5_000) await scanAt(at);

  expect(useAppStore.getState().recentSessions).toEqual([
    expect.objectContaining({ gameId: 42 }),
  ]);
  expect(storage.writesTo(STORAGE_KEY).length).toBeGreaterThan(bigSaves);
  expect(JSON.parse(storage.values.get(STORAGE_KEY)!).sessions).toEqual([
    expect.objectContaining({ gameId: 42 }),
  ]);
});
