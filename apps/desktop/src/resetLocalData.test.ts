// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { invokeMock, relaunchMock, stopTrackerMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  relaunchMock: vi.fn(),
  stopTrackerMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
vi.mock("./tracker", () => ({ stopTrackerForReset: stopTrackerMock }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  invokeMock.mockResolvedValue(undefined);
  relaunchMock.mockResolvedValue(undefined);
  stopTrackerMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("waits for pending work, keeps only paused backup preferences, and blocks late saves before restarting", async () => {
  const { resetLocalData } = await import("./resetLocalData");
  const persistence = await import("./persistence");
  const { useAppStore } = await import("./store");
  const backups = await import("./automaticBackups");
  localStorage.setItem(persistence.STORAGE_KEY, "old history");
  localStorage.setItem("playcounter:legacy", "old cache");
  sessionStorage.setItem("session", "old session");
  backups.useAutomaticBackupStore.setState({
    loaded: true,
    preferences: {
      ...backups.useAutomaticBackupStore.getState().preferences,
      directory: "D:\\Backups",
    },
  });
  let finishScan!: () => void;
  stopTrackerMock.mockReturnValue(
    new Promise<void>((resolve) => {
      finishScan = resolve;
    }),
  );
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "reset_local_data") {
      // A previously queued setting edit must not rewrite the erased library.
      useAppStore.getState().setShowDurationDays(true);
      await Promise.resolve();
      expect(localStorage.getItem(persistence.STORAGE_KEY)).toBe("old history");
    }
  });
  relaunchMock.mockImplementation(async () => {
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(persistence.STORAGE_KEY)).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(backups.AUTOMATIC_BACKUP_STORAGE_KEY)!),
    ).toMatchObject({
      enabled: false,
      directory: "D:\\Backups",
    });
    expect(sessionStorage.length).toBe(0);
    expect(persistence.persistAppState(useAppStore.getState()).status).toBe(
      "suspended",
    );
    expect(localStorage.length).toBe(1);
  });
  const reset = resetLocalData();
  expect(resetLocalData()).toBe(reset);
  expect(persistence.isPersistenceSuspended()).toBe(true);
  await Promise.resolve();
  expect(invokeMock).not.toHaveBeenCalled();
  finishScan();
  await reset;
  expect(invokeMock).toHaveBeenCalledExactlyOnceWith("reset_local_data");
  expect(relaunchMock).toHaveBeenCalledOnce();
  expect(() =>
    persistence.writePersistedRecord({ sessions: ["late"] }),
  ).toThrow("being reset");
  await backups.runAutomaticBackup(true);
  expect(invokeMock).toHaveBeenCalledTimes(1);
});

it("lets an existing backup finish and retains its latest path with the schedule paused", async () => {
  const { resetLocalData } = await import("./resetLocalData");
  const backups = await import("./automaticBackups");
  backups.useAutomaticBackupStore.setState({ loaded: true });
  let finishBackup!: (value: unknown) => void;
  invokeMock.mockImplementation((command: string) =>
    command === "write_automatic_backup"
      ? new Promise((resolve) => {
          finishBackup = resolve;
        })
      : Promise.resolve(),
  );
  const backup = backups.runAutomaticBackup(true);
  await Promise.resolve();
  const reset = resetLocalData();
  await Promise.resolve();
  expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
    "write_automatic_backup",
  ]);
  finishBackup({ path: "D:\\Backups\\snapshot.json", cleanupWarning: null });
  await backup;
  await reset;
  expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
    "write_automatic_backup",
    "reset_local_data",
  ]);
  expect(localStorage.length).toBe(1);
  expect(
    JSON.parse(localStorage.getItem(backups.AUTOMATIC_BACKUP_STORAGE_KEY)!),
  ).toMatchObject({
    enabled: false,
    lastBackupPath: "D:\\Backups\\snapshot.json",
  });
});

it("reports native failures without restarting, keeps stale writes suspended, and allows retry", async () => {
  const { resetLocalData } = await import("./resetLocalData");
  const { isPersistenceSuspended } = await import("./persistence");
  localStorage.setItem("playcounter:v1", "old history");
  invokeMock.mockRejectedValueOnce(new Error("Cover file is locked"));
  await expect(resetLocalData()).rejects.toThrow("locked");
  expect(relaunchMock).not.toHaveBeenCalled();
  expect(isPersistenceSuspended()).toBe(true);
  expect(localStorage.getItem("playcounter:v1")).toBe("old history");
  await resetLocalData();
  expect(localStorage.getItem("playcounter:v1")).toBeNull();
  expect(relaunchMock).toHaveBeenCalledOnce();
});

it("surfaces a failed restart and permits a safe retry after the app data has been cleared", async () => {
  const { resetLocalData } = await import("./resetLocalData");
  relaunchMock.mockRejectedValueOnce(new Error("Restart failed"));
  await expect(resetLocalData()).rejects.toThrow("Restart failed");
  expect(localStorage.getItem("playcounter:v1")).toBeNull();
  await resetLocalData();
  expect(relaunchMock).toHaveBeenCalledTimes(2);
});

it("does not create or rotate backups after restarting until the user enables them again", async () => {
  const { resetLocalData } = await import("./resetLocalData");
  const backups = await import("./automaticBackups");
  const preferences = {
    enabled: true,
    directory: "D:\\Recovery",
    interval: "daily" as const,
    keepCount: 1,
    lastBackupAt: "2020-01-01T00:00:00.000Z",
    lastBackupPath: "D:\\Recovery\\saved-history.json",
  };
  backups.useAutomaticBackupStore.setState({ loaded: true, preferences });
  await resetLocalData();

  // Recreate the modules as a fresh app launch, with the actual saved preferences.
  vi.resetModules();
  vi.useFakeTimers();
  const restarted = await import("./automaticBackups");
  invokeMock.mockReset().mockImplementation(async (command: string) => {
    if (command === "write_automatic_backup") {
      return { path: "D:\\Recovery\\new-backup.json", cleanupWarning: null };
    }
    return "C:\\AppData\\Backups";
  });
  try {
    restarted.initializeAutomaticBackups();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(restarted.useAutomaticBackupStore.getState().preferences).toEqual({
      ...preferences,
      enabled: false,
    });
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "write_automatic_backup",
      ),
    ).toBe(false);
    restarted.setAutomaticBackupPreferences({ enabled: true });
    await restarted.runAutomaticBackup();
    expect(invokeMock).toHaveBeenCalledWith(
      "write_automatic_backup",
      expect.objectContaining({ directory: "D:\\Recovery", keepCount: 1 }),
    );
  } finally {
    restarted.disposeAutomaticBackups();
  }
});
