import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { invokeMock, initializeAutomaticBackups, breakLoading } = vi.hoisted(
  () => ({
    invokeMock: vi.fn(async (command: string) => {
      if (command === "scan_processes") return [];
      if (command === "privacy_context") return {};
      if (command === "install_uuid") return "load-failure-test-install";
      if (command === "ignored_processes") {
        return { processes: [], userProcesses: [], userFilePath: null };
      }
      return undefined;
    }),
    initializeAutomaticBackups: vi.fn(),
    breakLoading: { current: false },
  }),
);
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
vi.mock("./desktopOverlayBridge", () => ({
  initializeDesktopOverlays: vi.fn(),
  disposeDesktopOverlays: vi.fn(),
  armDesktopOverlays: vi.fn(),
  emitOverlayEvent: vi.fn(),
  noteDiscoveredExecutable: vi.fn(),
}));
vi.mock("./controllerBridge", () => ({
  initializeControllerBridge: vi.fn(),
  disposeControllerBridge: vi.fn(),
  armControllerBridge: vi.fn(),
}));
vi.mock("./automaticBackups", () => ({
  initializeAutomaticBackups,
  disposeAutomaticBackups: vi.fn(),
}));
// Stands in for any future bug that makes loading throw.
vi.mock("./ui/tour/tourState", async (importOriginal) => {
  const original = await importOriginal<typeof import("./ui/tour/tourState")>();
  return {
    ...original,
    normalizeTourProgress: (
      ...args: Parameters<typeof original.normalizeTourProgress>
    ) => {
      if (breakLoading.current) throw new Error("loading bug");
      return original.normalizeTourProgress(...args);
    },
  };
});

const STORAGE_KEY = "playcounter:v1";
const save = readFileSync(
  new URL("./__fixtures__/saves/playcounter-v1.2.json", import.meta.url),
  "utf8",
);
let storage: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  invokeMock.mockClear();
  initializeAutomaticBackups.mockClear();
  breakLoading.current = false;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startApp() {
  const { initializeTracker } = await import("./tracker");
  const { useAppStore } = await import("./store");
  const persistence = await import("./persistence");
  await initializeTracker();
  // Ordinary use that saves: a click in the UI, then startup work and scans.
  useAppStore.getState().toggleSectionCollapsed("load-failure-test");
  await vi.advanceTimersByTimeAsync(60_000);
  return { useAppStore, persistence };
}

function expectNothingRan() {
  expect(invokeMock).not.toHaveBeenCalledWith("scan_processes");
  expect(initializeAutomaticBackups).not.toHaveBeenCalled();
}

it("keeps unreadable saved data untouched and says how to recover", async () => {
  const unreadable = save.slice(0, save.length / 2);
  storage.set(STORAGE_KEY, unreadable);

  const { useAppStore, persistence } = await startApp();

  expect(storage.get(STORAGE_KEY)).toBe(unreadable);
  expect(persistence.isPersistenceSuspended()).toBe(true);
  expect(useAppStore.getState().runtimeError).toMatch(
    /can't read its saved data.*Import data.*reset PlayCounter/,
  );
  expectNothingRan();
});

it("keeps saved data untouched when loading it fails", async () => {
  breakLoading.current = true;
  storage.set(STORAGE_KEY, save);

  const { useAppStore, persistence } = await startApp();

  expect(storage.get(STORAGE_KEY)).toBe(save);
  expect(persistence.isPersistenceSuspended()).toBe(true);
  const message = useAppStore.getState().runtimeError;
  expect(message).toMatch(/couldn't load your saved data.*still there/);
  // Resetting would delete data a fixed version can still load.
  expect(message).not.toMatch(/reset/i);
  expectNothingRan();
});

it("still restores a backup over data that failed to load", async () => {
  storage.set(STORAGE_KEY, "{");
  const { persistence } = await startApp();

  persistence.writePersistedRecord({ restored: true });

  expect(JSON.parse(storage.get(STORAGE_KEY)!)).toEqual({ restored: true });
});

it("starts normally and saves when the saved data loads", async () => {
  storage.set(STORAGE_KEY, save);

  const { useAppStore, persistence } = await startApp();

  expect(persistence.isPersistenceSuspended()).toBe(false);
  expect(useAppStore.getState().runtimeError).toBeNull();
  expect(invokeMock).toHaveBeenCalledWith("scan_processes");
  expect(initializeAutomaticBackups).toHaveBeenCalled();
  expect(JSON.parse(storage.get(STORAGE_KEY)!).collapsedSections).toContain(
    "load-failure-test",
  );
});

it("starts normally on a new install", async () => {
  const { useAppStore, persistence } = await startApp();

  expect(persistence.isPersistenceSuspended()).toBe(false);
  expect(useAppStore.getState().runtimeError).toBeNull();
  expect(storage.has(STORAGE_KEY)).toBe(true);
});
