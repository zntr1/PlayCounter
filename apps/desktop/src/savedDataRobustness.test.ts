import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPersistedPayload,
  persistAppState,
  STORAGE_KEY,
} from "./persistence";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: vi.fn(async (command: string) =>
    command === "scan_processes"
      ? [
          {
            exeName: "eldenring.exe",
            exePath: String.raw`C:\Games\ELDEN RING\Game\eldenring.exe`,
            pid: 100,
            startedAtUnix: 1_790_000_000,
          },
          {
            exeName: "NewGame.exe",
            exePath: String.raw`D:\Games\New\NewGame.exe`,
            pid: 200,
            startedAtUnix: 1_790_000_000,
          },
        ]
      : undefined,
  ),
}));

import { createDefaultSettings, useAppStore } from "./store";
import { hydrate, scanProcessesNow } from "./tracker";

// One release with a bug can write one bad value. The next start must still
// load everything else, keep tracking, and save without losing playtime.
const save = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/saves/playcounter-v1.2.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

const JUNK: [string, unknown][] = [
  ["null", null],
  ["a number", 7],
  ["a string", "junk"],
  ["a boolean", true],
  ["an empty object", {}],
  ["an object of nulls", { a: null }],
  ["an array", []],
  ["an array with null", [null]],
  ["an array with a number", [7]],
  ["an array with a string", ["junk"]],
  ["an array with an empty object", [{}]],
  ["an array with an array", [[]]],
];

// Fields whose content is playtime. Junk there may drop that playtime, but
// must not break loading or anything else.
const PLAYTIME_FIELDS = new Set([
  "sessions",
  "archivedSeconds",
  "archivedGameSeconds",
  "playtimeAdjustments",
]);

let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function totalSeconds() {
  const state = useAppStore.getState();
  let total = 0;
  for (const session of state.recentSessions) {
    total += session.durationSeconds ?? 0;
  }
  for (const seconds of Object.values(state.archivedGameSeconds)) {
    total += seconds;
  }
  for (const seconds of Object.values(state.playtimeAdjustments)) {
    total += seconds;
  }
  return total;
}

// Every field this version saves, every field in the fixture, and the
// legacy single active session.
const FIELDS = [
  ...new Set([
    ...Object.keys(createPersistedPayload(useAppStore.getInitialState())),
    ...Object.keys(save),
    "activeSession",
  ]),
].sort();

async function expectLoadsAndTracks(
  field: string,
  broken: Record<string, unknown>,
) {
  useAppStore.setState(useAppStore.getInitialState(), true);
  storage.set(STORAGE_KEY, JSON.stringify(save));
  hydrate();
  const expectedSeconds = totalSeconds();

  useAppStore.setState(useAppStore.getInitialState(), true);
  storage.set(STORAGE_KEY, JSON.stringify(broken));
  expect(() => hydrate()).not.toThrow();
  if (!PLAYTIME_FIELDS.has(field)) {
    expect(totalSeconds()).toBe(expectedSeconds);
  }

  expect(persistAppState(useAppStore.getState()).status).toBe("saved");
  useAppStore.setState(useAppStore.getInitialState(), true);
  expect(() => hydrate()).not.toThrow();
  if (!PLAYTIME_FIELDS.has(field)) {
    expect(totalSeconds()).toBe(expectedSeconds);
  }

  // Tracking keeps working on what was loaded. Without the executable
  // cache, a known game needs the (here offline) API again.
  await scanProcessesNow();
  expect(useAppStore.getState().lastProcessScanError).toBeNull();
  if (field !== "exeCache") {
    expect(useAppStore.getState().activeSessions).toContainEqual(
      expect.objectContaining({ exeName: "eldenring.exe" }),
    );
  }
}

describe.each(FIELDS)("saved field %s", (field) => {
  it.each(JUNK)("loads and saves when it holds %s", (_label, junk) =>
    expectLoadsAndTracks(field, { ...save, [field]: junk }),
  );
});

const SETTINGS = [
  ...new Set([
    ...Object.keys(createDefaultSettings()),
    ...Object.keys(save.settings as object),
  ]),
].sort();

describe.each(SETTINGS)("saved setting %s", (setting) => {
  it.each(JUNK)("loads and saves when it holds %s", async (_label, junk) => {
    await expectLoadsAndTracks("settings", {
      ...save,
      settings: { ...(save.settings as object), [setting]: junk },
    });
    const fallback: unknown = Reflect.get(createDefaultSettings(), setting);
    if (typeof fallback === "number" || typeof fallback === "boolean") {
      const loaded: unknown = Reflect.get(
        useAppStore.getState().settings,
        setting,
      );
      expect(typeof loaded).toBe(typeof fallback);
    }
  });
});
