// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./store";
import { STORAGE_KEY, writePersistedRecord } from "./persistence";
import { validateBackupData } from "./backupValidation";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (value: string) => value,
}));

import {
  AUTOMATIC_BACKUP_STORAGE_KEY,
  disposeAutomaticBackups,
  initializeAutomaticBackups,
  isAutomaticBackupDue,
  runAutomaticBackup,
  setAutomaticBackupPreferences,
  useAutomaticBackupStore,
} from "./automaticBackups";

const now = "2026-09-15T12:00:00.000Z";
const directory = String.raw`C:\AppData\PlayCounter\backups\automatic`;
const savedPath = `${directory}\\snapshot.json`;
const defaults = useAutomaticBackupStore.getInitialState().preferences;
const writes = () =>
  invokeMock.mock.calls.filter(
    ([command]) => command === "write_automatic_backup",
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAutomaticBackupStore.setState(
    useAutomaticBackupStore.getInitialState(),
    true,
  );
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "default_backup_directory") return directory;
    if (command === "write_automatic_backup")
      return { path: savedPath, cleanupWarning: null };
  });
});

afterEach(async () => {
  disposeAutomaticBackups();
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start(preferences: Partial<typeof defaults> = {}) {
  localStorage.setItem(
    AUTOMATIC_BACKUP_STORAGE_KEY,
    JSON.stringify({ ...defaults, ...preferences }),
  );
  initializeAutomaticBackups();
  await runAutomaticBackup();
}

describe("automatic backup scheduling", () => {
  it.each([null, {}])(
    "defaults to enabled weekly backups in app data, retaining 5 snapshots (saved=%j)",
    async (saved) => {
      if (saved !== null) {
        localStorage.setItem(
          AUTOMATIC_BACKUP_STORAGE_KEY,
          JSON.stringify(saved),
        );
      }
      initializeAutomaticBackups();
      await runAutomaticBackup();
      expect(writes()).toHaveLength(1);
      expect(useAutomaticBackupStore.getState()).toMatchObject({
        preferences: {
          enabled: true,
          interval: "weekly",
          directory: null,
          keepCount: 5,
        },
        defaultDirectory: directory,
      });
    },
  );

  it("backs up current durable state, excluding machine paths and schedule settings", async () => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 42,
          exeName: "",
          startedAt: "2026-09-14T12:00:00.000Z",
          endedAt: "2026-09-14T12:01:00.000Z",
          durationSeconds: 60,
        },
      ],
      activeSessions: [
        {
          id: 2,
          gameId: 42,
          gameName: "Game",
          source: "igdb",
          coverUrl: "",
          exeName: "game.exe",
          startedAt: now,
          checkpointedAt: now,
        },
      ],
      blacklist: new Set(["ignored.exe"]),
    });
    // A snapshot must also include changes not yet persisted by a microtask.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: [] }));
    await start({ enabled: true });
    expect(writes()).toHaveLength(1);
    const args = writes()[0][1];
    expect(args).toMatchObject({ directory: null, keepCount: 5 });
    const envelope = JSON.parse(args.contents);
    expect(envelope).toMatchObject({
      format: "playcounter-backup",
      version: 2,
      app: "PlayCounter",
    });
    expect(envelope.data.sessions).toHaveLength(1);
    expect(() => validateBackupData(envelope.data, "data")).not.toThrow();
    expect(envelope.data).not.toHaveProperty("activeSessions");
    expect(envelope.data).not.toHaveProperty("blacklist");
    expect(args.contents).not.toContain(directory);
    expect(args.contents).not.toContain("lastBackupAt");
    expect(
      JSON.parse(localStorage.getItem(AUTOMATIC_BACKUP_STORAGE_KEY)!),
    ).toMatchObject({ lastBackupAt: now, lastBackupPath: savedPath });
  });

  it.each(["daily", "weekly"] as const)(
    "runs a %s backup when due, once after a long sleep",
    async (interval) => {
      await start({ enabled: true, interval, lastBackupAt: now });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writes()).toHaveLength(0);
      vi.setSystemTime(
        Date.parse(now) + (interval === "weekly" ? 14 : 2) * 86400_000,
      );
      window.dispatchEvent(new Event("focus"));
      await runAutomaticBackup();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(writes()).toHaveLength(1);
    },
  );

  it("catches up on startup, persists the schedule, and does not repeat on restart", async () => {
    await start({ enabled: true, lastBackupAt: "2026-09-01T00:00:00.000Z" });
    expect(writes()).toHaveLength(1);
    disposeAutomaticBackups();
    useAutomaticBackupStore.setState(
      useAutomaticBackupStore.getInitialState(),
      true,
    );
    initializeAutomaticBackups();
    await runAutomaticBackup();
    expect(writes()).toHaveLength(1);
  });

  it("starts when enabled, stops when disabled, and disposes its listeners and timer", async () => {
    await start({ enabled: false });
    setAutomaticBackupPreferences({ enabled: true });
    await runAutomaticBackup();
    expect(writes()).toHaveLength(1);
    setAutomaticBackupPreferences({ enabled: false });
    vi.setSystemTime(Date.parse(now) + 14 * 86400_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes()).toHaveLength(1);
    disposeAutomaticBackups();
    setAutomaticBackupPreferences({ enabled: true });
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes()).toHaveLength(1);
  });

  it("deduplicates manual, timer, focus, and duplicate initialization requests", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    invokeMock.mockImplementation((command) =>
      command === "write_automatic_backup"
        ? pending
        : Promise.resolve(directory),
    );
    localStorage.setItem(
      AUTOMATIC_BACKUP_STORAGE_KEY,
      JSON.stringify({ ...defaults, enabled: true }),
    );
    initializeAutomaticBackups();
    initializeAutomaticBackups();
    const manual = runAutomaticBackup(true);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(writes()).toHaveLength(1);
    resolve({ path: savedPath, cleanupWarning: null });
    await manual;
    expect(useAutomaticBackupStore.getState().running).toBe(false);
  });

  it("preserves the successful timestamp on failure and retries after 15 minutes", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "write_automatic_backup")
        throw new Error("Folder unavailable");
      return directory;
    });
    const previous = "2026-09-01T00:00:00.000Z";
    await start({
      enabled: true,
      directory: "D:\\Backups",
      lastBackupAt: previous,
    });
    expect(writes()).toHaveLength(1);
    expect(useAutomaticBackupStore.getState()).toMatchObject({
      error: "Folder unavailable",
      preferences: { lastBackupAt: previous },
    });
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    window.dispatchEvent(new Event("focus"));
    await runAutomaticBackup();
    expect(writes()).toHaveLength(1);
    invokeMock.mockResolvedValue({ path: savedPath, cleanupWarning: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes()).toHaveLength(2);
    expect(useAutomaticBackupStore.getState().error).toBeNull();
    expect(writes().every(([, args]) => args.directory === "D:\\Backups")).toBe(
      true,
    );
  });

  it("allows Back up now while disabled and during retry backoff", async () => {
    await start({ enabled: false });
    invokeMock.mockRejectedValueOnce("Disk full");
    await runAutomaticBackup(true);
    expect(
      useAutomaticBackupStore.getState().preferences.lastBackupAt,
    ).toBeNull();
    await runAutomaticBackup(true);
    expect(writes()).toHaveLength(2);
    expect(useAutomaticBackupStore.getState().preferences.lastBackupAt).toBe(
      now,
    );
  });

  it("takes a fresh snapshot in a newly chosen folder and can switch back to app data", async () => {
    await start({ enabled: true, lastBackupAt: now });
    setAutomaticBackupPreferences({ directory: "D:\\Backups", keepCount: 5 });
    await runAutomaticBackup();
    expect(writes()[0][1]).toMatchObject({
      directory: "D:\\Backups",
      keepCount: 5,
    });
    setAutomaticBackupPreferences({ directory: null });
    await runAutomaticBackup();
    expect(writes()[1][1].directory).toBeNull();
  });

  it("treats retention failure as a saved backup with a warning", async () => {
    await start({ enabled: false });
    invokeMock.mockResolvedValue({
      path: savedPath,
      cleanupWarning: "Old file is read-only",
    });
    await runAutomaticBackup(true);
    expect(useAutomaticBackupStore.getState()).toMatchObject({
      error: null,
      cleanupWarning: "Old file is read-only",
      preferences: { lastBackupAt: now },
    });
  });

  it("does not change preferences or start backups when settings storage fails", async () => {
    await start({ enabled: false });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    setAutomaticBackupPreferences({ enabled: true });
    await runAutomaticBackup();
    expect(writes()).toHaveLength(0);
    expect(useAutomaticBackupStore.getState()).toMatchObject({
      preferences: { enabled: false },
      error: expect.stringContaining("Storage full"),
    });
  });

  it("keeps this PC's schedule and destination when app data is replaced", async () => {
    await start({
      enabled: false,
      directory: "D:\\Backups",
      interval: "daily",
      keepCount: 30,
    });
    const saved = localStorage.getItem(AUTOMATIC_BACKUP_STORAGE_KEY);
    writePersistedRecord({ settings: { theme: "light" }, sessions: [] });
    expect(localStorage.getItem(AUTOMATIC_BACKUP_STORAGE_KEY)).toBe(saved);
    disposeAutomaticBackups();
    useAutomaticBackupStore.setState(
      useAutomaticBackupStore.getInitialState(),
      true,
    );
    initializeAutomaticBackups();
    await runAutomaticBackup();
    expect(useAutomaticBackupStore.getState().preferences).toMatchObject({
      enabled: false,
      directory: "D:\\Backups",
      interval: "daily",
      keepCount: 30,
    });
  });

  it("recovers from a clock rollback and stays off when saved settings are corrupt", async () => {
    expect(
      isAutomaticBackupDue({
        ...defaults,
        enabled: true,
        lastBackupAt: "2027-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    localStorage.setItem(AUTOMATIC_BACKUP_STORAGE_KEY, "broken JSON");
    initializeAutomaticBackups();
    await runAutomaticBackup();
    expect(writes()).toHaveLength(0);
    expect(useAutomaticBackupStore.getState().error).toBeTruthy();
  });
});
