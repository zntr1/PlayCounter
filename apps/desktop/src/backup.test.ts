import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, openMock, saveMock, reloadMock, getVersionMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    openMock: vi.fn(),
    saveMock: vi.fn(),
    reloadMock: vi.fn(),
    getVersionMock: vi.fn(),
  }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: getVersionMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
  save: saveMock,
}));

import { createTransferData, exportLocalData, importLocalData } from "./backup";
import { STORAGE_KEY } from "./persistence";

const installUuid = "550e8400-e29b-41d4-a716-446655440000";

function backup(data: Record<string, unknown>, version = 2) {
  return JSON.stringify({
    format: "playcounter-backup",
    version,
    app: "PlayCounter",
    exportedAt: "2026-08-19T00:00:00.000Z",
    data,
  });
}

function installLocalStorage(initial: string | null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(STORAGE_KEY, initial);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    },
  });
  return values;
}

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
  saveMock.mockReset();
  reloadMock.mockReset();
  getVersionMock.mockReset();
  getVersionMock.mockResolvedValue("1.1.5");
  vi.stubGlobal("window", { location: { reload: reloadMock } });
});

describe("backup transfer data", () => {
  it("keeps durable progress but excludes notifications and ignored processes", () => {
    const result = createTransferData({
      sessions: [{ id: 1 }],
      settings: { theme: "light" },
      awardedMilestones: [{ id: "milestone:total:10" }],
      seenContributionStatus: { contribution: "verified" },
      notifications: [{ id: "old-notification" }],
      lastSeenReleaseNotesVersion: "1.1.4",
      discoveredReviewReminder: {
        notifiedAt: "2026-08-18T00:00:00.000Z",
        notifiedCount: 10,
      },
      blacklist: ["ignored.exe"],
      launchTargets: [
        {
          exeName: "game.exe",
          path: String.raw`C:\Users\player\Games\game.exe`,
          owner: { gameId: 42, source: "igdb" },
        },
      ],
      manualLaunchTargets: [
        {
          exeName: "Launcher.exe",
          path: String.raw`C:\Users\player\Games\Launcher.exe`,
          owner: { gameId: 42, source: "igdb" },
        },
      ],
      emulatorAutoBinaries: [
        {
          emulatorId: "dolphin",
          exePath: String.raw`C:\Emulators\Dolphin.exe`,
        },
      ],
      emulatorManualBinaries: [
        {
          emulatorId: "dolphin",
          exePath: String.raw`D:\Portable\Dolphin.exe`,
        },
      ],
      emulatorAutoLaunchTargets: [
        {
          contentKey: "dolphin:rom:game.rvz",
          filePath: String.raw`D:\Games\game.rvz`,
        },
      ],
      emulatorManualLaunchTargets: [
        {
          contentKey: "dolphin:title_id:abc123",
          filePath: String.raw`D:\Games\other.rvz`,
        },
      ],
      emulatorLaunchCandidates: [
        {
          contentKey: "dolphin:title_id:g4op69",
          filePath: String.raw`D:\Games\The Sims 2.rvz`,
          displayName: "The Sims 2.rvz",
        },
      ],
      libraryImports: [
        {
          provider: "steam",
          externalId: "730",
          igdbId: 1942,
          providerSeconds: 7_200,
        },
        {
          provider: "xbox",
          externalId: "1234",
          igdbId: 133430,
          providerSeconds: null,
        },
      ],
      libraryInstalls: [
        {
          provider: "steam",
          externalId: "730",
          installPath: String.raw`C:\Steam\common\CS2`,
        },
      ],
      scopedExeLinks: [
        {
          provider: "steam",
          externalId: "730",
          pathPrefix: String.raw`C:\Steam\common\CS2`,
        },
      ],
      activeSessions: [{ id: 2 }],
      ambiguousMatches: [{ exeName: "game.exe" }],
      exeCache: [
        { exeName: "ignored.exe", state: "blacklisted" },
        { exeName: "game.exe", state: "matched" },
      ],
    });

    expect(result).toMatchObject({
      sessions: [{ id: 1 }],
      settings: { theme: "light" },
      awardedMilestones: [{ id: "milestone:total:10" }],
      seenContributionStatus: { contribution: "verified" },
      exeCache: [{ exeName: "game.exe", state: "matched" }],
      libraryImports: [
        {
          provider: "steam",
          externalId: "730",
          igdbId: 1942,
          providerSeconds: 7_200,
        },
        {
          provider: "xbox",
          externalId: "1234",
          igdbId: 133430,
          providerSeconds: null,
        },
      ],
    });
    expect(result).not.toHaveProperty("notifications");
    expect(result).not.toHaveProperty("lastSeenReleaseNotesVersion");
    expect(result).not.toHaveProperty("discoveredReviewReminder");
    expect(result).not.toHaveProperty("blacklist");
    expect(result).not.toHaveProperty("launchTargets");
    expect(result).not.toHaveProperty("manualLaunchTargets");
    expect(result).not.toHaveProperty("emulatorAutoBinaries");
    expect(result).not.toHaveProperty("emulatorManualBinaries");
    expect(result).not.toHaveProperty("emulatorAutoLaunchTargets");
    expect(result).not.toHaveProperty("emulatorManualLaunchTargets");
    expect(result).not.toHaveProperty("emulatorLaunchCandidates");
    expect(result).not.toHaveProperty("libraryInstalls");
    expect(result).not.toHaveProperty("scopedExeLinks");
    expect(result).not.toHaveProperty("activeSessions");
    expect(result).not.toHaveProperty("ambiguousMatches");
  });

  it("exports version 2 without notification or ignore state", async () => {
    installLocalStorage(
      JSON.stringify({
        installUuid,
        notifications: [{ id: "old-notification" }],
        blacklist: ["ignored.exe"],
        sessions: [],
      }),
    );
    saveMock.mockResolvedValue("backup.json");
    invokeMock.mockResolvedValue(undefined);

    await expect(exportLocalData()).resolves.toEqual({ path: "backup.json" });

    const write = invokeMock.mock.calls.find(
      ([command]) => command === "write_text_file",
    );
    const envelope = JSON.parse(write?.[1]?.contents as string);
    expect(envelope.version).toBe(2);
    expect(envelope.data.installUuid).toBe(installUuid);
    expect(envelope.data).not.toHaveProperty("notifications");
    expect(envelope.data).not.toHaveProperty("blacklist");
  });
});

describe("backup import", () => {
  it("adopts the contribution identity and starts with a silent notification baseline", async () => {
    const existing = JSON.stringify({
      installUuid: "11111111-1111-4111-8111-111111111111",
      sessions: [],
    });
    const values = installLocalStorage(existing);
    openMock.mockResolvedValue("backup.json");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "read_text_file") {
        return backup(
          {
            installUuid,
            contributionOwnerUuid: installUuid,
            sessions: [],
            settings: { theme: "light" },
            awardedMilestones: [{ id: "milestone:total:10" }],
            seenContributionStatus: { contribution: "verified" },
            notifications: [{ id: "old-notification" }],
            blacklist: ["ignored.exe"],
            exeCache: [
              { exeName: "ignored.exe", state: "blacklisted" },
              { exeName: "game.exe", state: "matched" },
            ],
          },
          1,
        );
      }
      if (command === "backup_local_data") return "automatic-backup.json";
      if (command === "adopt_install_uuid") return installUuid;
      return undefined;
    });

    await expect(importLocalData()).resolves.toMatchObject({ imported: true });

    expect(invokeMock).toHaveBeenCalledWith("adopt_install_uuid", {
      value: installUuid,
    });
    const imported = JSON.parse(values.get(STORAGE_KEY) ?? "{}");
    expect(imported).toMatchObject({
      installUuid,
      contributionOwnerUuid: installUuid,
      notifications: [],
      suppressStartupNotificationsOnce: true,
      suppressContributionNotificationsOnce: true,
      lastSeenReleaseNotesVersion: "1.1.5",
      awardedMilestones: [{ id: "milestone:total:10" }],
      seenContributionStatus: { contribution: "verified" },
      exeCache: [{ exeName: "game.exe", state: "matched" }],
    });
    expect(imported).not.toHaveProperty("blacklist");
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("still imports when the running version cannot be read", async () => {
    const values = installLocalStorage(null);
    getVersionMock.mockRejectedValue(new Error("version unavailable"));
    openMock.mockResolvedValue("backup.json");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "read_text_file") {
        return backup({ sessions: [], lastSeenReleaseNotesVersion: "0.9.0" });
      }
      return undefined;
    });

    await expect(importLocalData()).resolves.toMatchObject({ imported: true });

    const imported = JSON.parse(values.get(STORAGE_KEY) ?? "{}");
    expect(imported).not.toHaveProperty("lastSeenReleaseNotesVersion");
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("rejects a newer backup format before changing local data", async () => {
    const existing = JSON.stringify({ sessions: [{ id: 1 }] });
    const values = installLocalStorage(existing);
    openMock.mockResolvedValue("backup.json");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "read_text_file") return backup({}, 99);
      return undefined;
    });

    await expect(importLocalData()).rejects.toThrow(
      "created by a newer PlayCounter version",
    );
    expect(values.get(STORAGE_KEY)).toBe(existing);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("restores the previous local snapshot if UUID adoption fails", async () => {
    const existing = JSON.stringify({ sessions: [{ id: 1 }] });
    const values = installLocalStorage(existing);
    openMock.mockResolvedValue("backup.json");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "read_text_file") {
        return backup({ installUuid, sessions: [] });
      }
      if (command === "backup_local_data") return "automatic-backup.json";
      if (command === "adopt_install_uuid") throw new Error("disk locked");
      return undefined;
    });

    await expect(importLocalData()).rejects.toThrow("disk locked");
    expect(values.get(STORAGE_KEY)).toBe(existing);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
