// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { saveHotkey } from "./hotkeys";
import { resetSettings } from "./resetSettings";
import { createDefaultSettings, useAppStore } from "./store";
import { createPersistedPayload, STORAGE_KEY } from "./persistence";
import {
  AUTOMATIC_BACKUP_STORAGE_KEY,
  useAutomaticBackupStore,
} from "./automaticBackups";
import { emptyJournal } from "./personalLibrary";

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock("./hotkeys", () => ({ saveHotkey: vi.fn() }));

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.clearAllMocks();
  vi.mocked(isEnabled).mockResolvedValue(false);
  vi.mocked(enable).mockResolvedValue();
  vi.mocked(saveHotkey).mockImplementation(async (key, shortcut) => {
    useAppStore.getState().setHotkey(key, shortcut);
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restores defaults and native preferences while keeping saved data, running sessions, and backup preferences", async () => {
  const game = {
    gameId: 7,
    gameName: "Fixture game",
    source: "igdb" as const,
    igdbId: 77,
  };
  const session = {
    ...game,
    id: 12,
    exeName: "fixture.exe",
    startedAt: "2026-09-24T12:00:00.000Z",
    endedAt: "2026-09-24T12:10:00.000Z",
    durationSeconds: 600,
  };
  useAppStore.setState((state) => ({
    installUuid: "550e8400-e29b-41d4-a716-446655440000",
    recentSessions: [session],
    activeSessions: [
      {
        ...game,
        id: 13,
        exeName: "fixture.exe",
        coverUrl: "",
        startedAt: "2026-09-24T12:10:00.000Z",
        checkpointedAt: "2026-09-24T12:11:00.000Z",
      },
    ],
    gameJournals: {
      "igdb:7": { ...emptyJournal(game), note: "Keep this note" },
    },
    personalShelves: [{ id: "shelf", name: "Keep this shelf" }],
    customHeroArt: { "igdb:7": "https://example.com/art.jpg" },
    launchTargets: new Map([
      [
        "fixture.exe",
        {
          exeName: "fixture.exe",
          path: "C:\\Games\\fixture.exe",
          owner: { gameId: 7, source: "igdb" },
        },
      ],
    ]),
    settings: {
      ...state.settings,
      theme: "light",
      accentColor: "#ff0000",
      contentScale: 1.25,
      menuScale: 1.25,
      launchOnStartup: false,
      showDurationDays: true,
      libraryCardSize: "list",
      libraryShowProviderTabs: false,
      emulatorDetection: false,
      gameLaunchingEnabled: true,
      controllerNavigationEnabled: true,
      ignoredEmulatorIds: ["pcsx2"],
      desktopOverlaysEnabled: false,
      showWindowHotkey: "Control+KeyP",
      currentSessionHotkey: "Alt+F8",
      pollingIntervalSeconds: 60,
    },
  }));
  const backupSettings = JSON.stringify({
    enabled: false,
    directory: "D:\\Recovery",
    keepCount: 30,
  });
  localStorage.setItem(AUTOMATIC_BACKUP_STORAGE_KEY, backupSettings);
  const backupState = useAutomaticBackupStore.getState();
  const before = useAppStore.getState();
  const beforePayload = createPersistedPayload(before);

  await resetSettings();
  const after = useAppStore.getState();
  expect(after.settings).toEqual(createDefaultSettings());
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(enable).toHaveBeenCalledOnce();
  expect(saveHotkey).toHaveBeenCalledWith("showWindowHotkey", null);
  expect(saveHotkey).toHaveBeenCalledWith("currentSessionHotkey", null);
  expect(after.activeSessions).toBe(before.activeSessions);
  expect(after.gameJournals).toBe(before.gameJournals);
  expect(after.personalShelves).toBe(before.personalShelves);
  expect(after.launchTargets).toBe(before.launchTargets);
  expect(createPersistedPayload(after)).toEqual({
    ...beforePayload,
    settings: createDefaultSettings(),
  });
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(
    JSON.parse(
      JSON.stringify({ ...beforePayload, settings: createDefaultSettings() }),
    ),
  );
  expect(localStorage.getItem(AUTOMATIC_BACKUP_STORAGE_KEY)).toBe(
    backupSettings,
  );
  expect(useAutomaticBackupStore.getState()).toBe(backupState);
});

it("reports a failed settings save without replacing preferences or trimming history", () => {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, theme: "light" },
    recentSessions: [
      {
        id: 1,
        gameId: 7,
        gameName: "Fixture game",
        exeName: "fixture.exe",
        startedAt: "2026-09-24T12:00:00.000Z",
        endedAt: "2026-09-24T12:10:00.000Z",
        durationSeconds: 600,
      },
    ],
  }));
  const before = useAppStore.getState();
  const saved = JSON.stringify(createPersistedPayload(before));
  localStorage.setItem(STORAGE_KEY, saved);
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Storage full", "QuotaExceededError");
  });

  expect(() => before.restoreDefaultSettings()).toThrow("Storage full");
  expect(useAppStore.getState().settings).toBe(before.settings);
  expect(useAppStore.getState().recentSessions).toBe(before.recentSessions);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  expect(write).toHaveBeenCalledOnce();
});

it("does not reset app preferences when startup access fails, and allows retry", async () => {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, theme: "light", launchOnStartup: false },
  }));
  const previousSettings = useAppStore.getState().settings;
  vi.mocked(enable).mockRejectedValueOnce(new Error("Startup access denied"));
  await expect(resetSettings()).rejects.toThrow("Startup access denied");
  expect(useAppStore.getState().settings).toBe(previousSettings);
  expect(saveHotkey).not.toHaveBeenCalled();
  await resetSettings();
  expect(useAppStore.getState().settings).toEqual(createDefaultSettings());
});

it("keeps the startup preference accurate after a shortcut failure and completes on retry", async () => {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, theme: "light", launchOnStartup: false },
  }));
  vi.mocked(saveHotkey).mockRejectedValueOnce(
    new Error("Shortcut service unavailable"),
  );
  await expect(resetSettings()).rejects.toThrow("Shortcut service unavailable");
  expect(useAppStore.getState().settings.launchOnStartup).toBe(true);
  expect(useAppStore.getState().settings.theme).toBe("light");
  vi.mocked(isEnabled).mockResolvedValue(true);
  await resetSettings();
  expect(useAppStore.getState().settings).toEqual(createDefaultSettings());
  expect(enable).toHaveBeenCalledOnce();
});
