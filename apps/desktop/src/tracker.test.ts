import type { Contribution, Game, Session } from "@playcounter/shared";
import type { EmulatorMapping } from "./emulators/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock, openMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
import { findManualLaunchTarget, manualLaunchTargetKey } from "./gameLaunch";
import {
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
  type ExeCacheEntry,
} from "./store";
import {
  addManualSession,
  applyGameMatch,
  applyCommunitySuggestionOutcome,
  applyContributionMarkers,
  cancelCommunitySuggestion,
  checkBackendHealth,
  chooseEmulatorLaunchFile,
  chooseLaunchTarget,
  clearLocalLibrary,
  dismissAmbiguousMatch,
  evaluateAndStoreMilestones,
  forgetManualLaunchTarget,
  hydrateGameMetadata,
  findGameMatches,
  ignoreDiscoveredProcess,
  launchGame,
  launchEmulatorGame,
  suggestIgnoredProcess,
  persist,
  pollContributions,
  removeGameHistory,
  reportNegativeMatch,
  scanProcessesNow,
  selectAmbiguousMatch,
  selectEmulatorGame,
  shareEmulatorMapping,
  setGamePlaytime,
  suggestTrackedGameToCommunity,
  untrackGame,
  verifyLaunchTargets,
} from "./tracker";

function entry(overrides: Partial<ExeCacheEntry> = {}): ExeCacheEntry {
  return {
    exeName: "Game.exe",
    state: "matched",
    gameId: -1,
    gameName: "Game",
    coverUrl: "cover",
    source: "custom",
    lastCheckedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    platform: "windows",
    kind: "exe",
    value: "Game.exe",
    gameId: 42,
    gameName: "Game",
    coverUrl: "cover",
    status: "rejected",
    reviewNote: "Wrong game",
    createdAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function emulatorMapping(
  overrides: Partial<EmulatorMapping> = {},
): EmulatorMapping {
  return {
    contentKey: "dosbox:program:doom3.exe",
    emulatorId: "dosbox",
    label: "DOSBox",
    contentKind: "program",
    contentValue: "doom3.exe",
    display: "Private presentation title",
    trust: "recognized",
    decision: "game",
    gameId: 42,
    gameName: "Doom 3",
    source: "igdb",
    confidence: "user",
    shareable: true,
    decidedAt: "2026-08-20T09:00:00.000Z",
    lastSeenAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    platform: "Win32",
  });
  invokeMock.mockReset();
  openMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "set_user_ignored_process") {
      return {
        processes: ["game.exe"],
        userProcesses: ["game.exe"],
        userFilePath: "ignored-processes.txt",
      };
    }
    if (command === "scan_processes") return [];
    return undefined;
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: vi.fn(), getItem: vi.fn(() => null) },
  });
  useAppStore.setState({
    exeCache: new Map(),
    launchTargets: new Map(),
    manualLaunchTargets: new Map(),
    emulatorAutoBinaries: new Map(),
    emulatorManualBinaries: new Map(),
    emulatorAutoLaunchTargets: new Map(),
    emulatorManualLaunchTargets: new Map(),
    emulatorLaunchCandidates: new Map(),
    activeSessions: [],
    ambiguousMatches: [],
    emulatorMappings: new Map(),
    emulatorObservations: [],
    recentSessions: [],
    gameMetadata: new Map(),
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: {},
    blacklist: new Set(),
    ignoredProcesses: new Set(),
    userIgnoredProcesses: new Set(),
    installUuid: null,
    installPresenceMarker: null,
    contributionOwnerUuid: null,
    seenContributionStatus: {},
    contributionCounts: {
      suggested: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
    },
    emulatorContributionCounts: {
      suggested: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
    },
    notifications: [],
    toasts: [],
    awardedMilestones: [],
    milestonesInitializedAt: null,
    suppressStartupNotificationsOnce: false,
    suppressContributionNotificationsOnce: false,
    backendHealth: {
      status: "online",
      checkedAt: "2026-08-09T00:00:00.000Z",
      detail: null,
    },
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: true,
      controllerNavigationEnabled: false,
    },
  });
});

describe("install presence wiring", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";
  const apiEndpoint = "https://api.playcounter.test";

  it("reports presence after a successful health check and persists the marker", async () => {
    useAppStore.setState({
      installUuid,
      installPresenceMarker: null,
      settings: { ...useAppStore.getState().settings, apiEndpoint },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input).endsWith("/health")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ ok: true }),
          } as Response;
        }
        return { ok: true, status: 204, statusText: "No Content" } as Response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await checkBackendHealth();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const presenceCall = fetchMock.mock.calls[1];
    expect(String(presenceCall[0])).toBe(`${apiEndpoint}/api/install-presence`);
    expect(JSON.parse(String(presenceCall[1]?.body))).toEqual({ installUuid });
    expect(useAppStore.getState().installPresenceMarker).toMatchObject({
      endpoint: apiEndpoint,
      installUuid,
      kind: "success",
    });
    expect(globalThis.localStorage.setItem).toHaveBeenCalled();
  });

  it("keeps a fresh marker quiet but bypasses it for a changed endpoint", async () => {
    useAppStore.setState({
      installUuid,
      installPresenceMarker: {
        endpoint: apiEndpoint,
        installUuid,
        sentAt: new Date().toISOString(),
        kind: "success",
      },
      settings: { ...useAppStore.getState().settings, apiEndpoint },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: String(input).endsWith("/health") ? 200 : 204,
      statusText: "OK",
      json: async () => ({ ok: true }),
    })) as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    await checkBackendHealth();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        apiEndpoint: "https://other.playcounter.test",
      },
    });
    await checkBackendHealth();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      "https://other.playcounter.test/api/install-presence",
    );
  });
});

describe("game launching", () => {
  const target = {
    exeName: "Game.exe",
    path: String.raw`C:\Games\Game.exe`,
    owner: { gameId: 42, source: "igdb" as const },
  };

  it("accepts a differently-named manual launcher", async () => {
    openMock.mockResolvedValueOnce(String.raw`C:\Games\Launcher.exe`);

    await expect(
      chooseLaunchTarget(["Game.exe"], target.owner),
    ).resolves.toMatchObject({
      exeName: "Launcher.exe",
      path: String.raw`C:\Games\Launcher.exe`,
    });
    expect(useAppStore.getState().launchTargets.size).toBe(0);
    expect(
      useAppStore
        .getState()
        .manualLaunchTargets.get(manualLaunchTargetKey(target.owner)),
    ).toMatchObject({ exeName: "Launcher.exe" });
  });

  it("keeps identical launcher basenames independent between games", async () => {
    const secondOwner = { gameId: 84, source: "igdb" as const };
    openMock
      .mockResolvedValueOnce(String.raw`C:\First\Launcher.exe`)
      .mockResolvedValueOnce(String.raw`D:\Second\Launcher.exe`);

    await chooseLaunchTarget(["Game.exe"], target.owner);
    await chooseLaunchTarget(["OtherGame.exe"], secondOwner);

    expect(useAppStore.getState().manualLaunchTargets.size).toBe(2);
    expect(
      useAppStore
        .getState()
        .manualLaunchTargets.get(manualLaunchTargetKey(target.owner))?.path,
    ).toBe(String.raw`C:\First\Launcher.exe`);
    expect(
      useAppStore
        .getState()
        .manualLaunchTargets.get(manualLaunchTargetKey(secondOwner))?.path,
    ).toBe(String.raw`D:\Second\Launcher.exe`);
  });

  it("replaces and forgets a manual launcher stored under an older alias", async () => {
    const oldOwner = { gameId: -1, source: "custom" as const };
    const aliases = [oldOwner, target.owner];
    useAppStore.getState().setManualLaunchTarget({
      exeName: "OldLauncher.exe",
      path: String.raw`C:\Games\OldLauncher.exe`,
      owner: oldOwner,
    });
    openMock.mockResolvedValueOnce(String.raw`C:\Games\NewLauncher.exe`);

    await chooseLaunchTarget(["Game.exe"], target.owner, aliases);
    const selected = findManualLaunchTarget(
      aliases,
      useAppStore.getState().manualLaunchTargets,
    );
    expect(selected?.path).toBe(String.raw`C:\Games\NewLauncher.exe`);
    expect(
      useAppStore
        .getState()
        .manualLaunchTargets.has(manualLaunchTargetKey(oldOwner)),
    ).toBe(false);

    if (!selected) throw new Error("Expected a manual launcher");
    forgetManualLaunchTarget(selected.owner);
    expect(useAppStore.getState().manualLaunchTargets.size).toBe(0);
  });

  it("invokes the native launcher", async () => {
    const firstTarget = {
      ...target,
      path: String.raw`C:\Games\First.exe`,
    };
    await launchGame(firstTarget);
    expect(invokeMock).toHaveBeenCalledWith("launch_executable", {
      path: firstTarget.path,
    });
  });

  it("launches a Dolphin game with the resolved emulator and content files", async () => {
    const contentKey = "dolphin:rom:the sims 2.rvz";
    const mapping = emulatorMapping({
      contentKey,
      emulatorId: "dolphin",
      label: "Dolphin",
      contentKind: "rom",
      contentValue: "the sims 2.rvz",
      display: "The Sims 2.rvz",
    });
    const binary = {
      emulatorId: "dolphin",
      exePath: String.raw`C:\Emulators\Dolphin.exe`,
      setAt: "2026-08-24T00:00:00.000Z",
    };
    const content = {
      emulatorId: "dolphin",
      contentKey,
      filePath: String.raw`D:\Games\The Sims 2.rvz`,
      setAt: "2026-08-24T00:00:00.000Z",
    };
    useAppStore.setState({
      emulatorMappings: new Map([[contentKey, mapping]]),
      emulatorAutoBinaries: new Map([["dolphin", binary]]),
      emulatorAutoLaunchTargets: new Map([[contentKey, content]]),
    });
    invokeMock.mockResolvedValueOnce({ kind: "spawned" });

    await expect(launchEmulatorGame(mapping)).resolves.toEqual({
      kind: "spawned",
    });
    expect(invokeMock).toHaveBeenCalledWith("launch_emulator_content", {
      request: {
        emulatorId: "dolphin",
        exePath: binary.exePath,
        contentPath: content.filePath,
      },
    });
  });

  it("stores a manually selected Dolphin game file", async () => {
    const mapping = emulatorMapping({
      contentKey: "dolphin:title_id:g4op69",
      emulatorId: "dolphin",
      label: "Dolphin",
      contentKind: "title_id",
      contentValue: "g4op69",
      display: "The Sims 2: Pets",
    });
    openMock.mockResolvedValueOnce(String.raw`D:\Games\The Sims 2 Pets.rvz`);

    await expect(chooseEmulatorLaunchFile(mapping)).resolves.toMatchObject({
      contentKey: mapping.contentKey,
      emulatorId: "dolphin",
      filePath: String.raw`D:\Games\The Sims 2 Pets.rvz`,
    });
    expect(
      useAppStore
        .getState()
        .emulatorManualLaunchTargets.get(mapping.contentKey),
    ).toMatchObject({ filePath: String.raw`D:\Games\The Sims 2 Pets.rvz` });
  });

  it("requires the launcher feature to be enabled", async () => {
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);
    await expect(launchGame(target)).rejects.toThrow("Enable");
    expect(invokeMock).not.toHaveBeenCalledWith("launch_executable", {
      path: target.path,
    });
  });

  it("forgets only genuinely missing targets", async () => {
    useAppStore.getState().setLaunchTarget(target);
    invokeMock.mockRejectedValueOnce({ kind: "notFound", message: "Gone" });
    await expect(launchGame(target)).rejects.toMatchObject({
      kind: "notFound",
    });
    expect(useAppStore.getState().launchTargets.has("game.exe")).toBe(false);

    useAppStore.getState().setLaunchTarget(target);
    invokeMock.mockRejectedValueOnce({
      kind: "unreadable",
      message: "Drive unavailable",
    });
    await expect(launchGame(target)).rejects.toMatchObject({
      kind: "unreadable",
    });
    expect(useAppStore.getState().launchTargets.get("game.exe")).toEqual(
      target,
    );

    invokeMock.mockRejectedValueOnce({
      kind: "notAFile",
      message: "Not a program",
    });
    await expect(launchGame(target)).rejects.toMatchObject({
      kind: "notAFile",
    });
    expect(useAppStore.getState().launchTargets.has("game.exe")).toBe(false);
  });

  it("forgets a failed manual launcher without removing the auto target", async () => {
    const manual = {
      ...target,
      exeName: "Launcher.exe",
      path: String.raw`C:\Games\Launcher.exe`,
    };
    useAppStore.getState().setLaunchTarget(target);
    useAppStore.getState().setManualLaunchTarget(manual);
    invokeMock.mockRejectedValueOnce({ kind: "notFound", message: "Gone" });

    await expect(launchGame(manual)).rejects.toMatchObject({
      kind: "notFound",
    });
    expect(useAppStore.getState().manualLaunchTargets.size).toBe(0);
    expect(useAppStore.getState().launchTargets.get("game.exe")).toEqual(
      target,
    );
  });

  it("suppresses concurrent launch requests", async () => {
    const raceTarget = {
      ...target,
      exeName: "Race.exe",
      path: String.raw`C:\Games\Race.exe`,
    };
    let finishLaunch!: () => void;
    invokeMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishLaunch = resolve)),
    );

    const first = launchGame(raceTarget);
    await expect(launchGame(raceTarget)).resolves.toBe("busy");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    finishLaunch();
    await expect(first).resolves.toBe("launched");
  });

  it("captures a resolved process path without churning identical scans", async () => {
    useAppStore.setState({
      exeCache: new Map([["game.exe", entry({ gameId: 42, source: "igdb" })]]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "scan_processes") {
        return [
          {
            exeName: "Game.exe",
            exePath: String.raw`C:\Games\Game.exe`,
            pid: 123,
          },
        ];
      }
      return undefined;
    });

    await scanProcessesNow();
    const first = useAppStore.getState().launchTargets.get("game.exe");
    expect(first).toEqual(target);
    await scanProcessesNow();
    expect(useAppStore.getState().launchTargets.get("game.exe")).toBe(first);
  });

  it("learns Dolphin.exe and an exact ISO path from a running game", async () => {
    const contentKey = "dolphin:rom:the sims 2.rvz";
    useAppStore.setState({
      emulatorMappings: new Map([
        [
          contentKey,
          emulatorMapping({
            contentKey,
            emulatorId: "dolphin",
            label: "Dolphin",
            contentKind: "rom",
            contentValue: "the sims 2.rvz",
            display: "The Sims 2.rvz",
          }),
        ],
      ]),
    });
    const exePath = String.raw`C:\Emulators\Dolphin.exe`;
    const filePath = String.raw`D:\Games\The Sims 2.rvz`;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "scan_processes") {
        return [
          {
            exeName: "Dolphin.exe",
            exePath,
            pid: 123,
            startedAtUnix: 10,
            emulatorId: "dolphin",
            commandLine: [`--exec=${filePath}`],
            windowTitle: null,
          },
        ];
      }
      if (command === "verify_emulator_content_paths") {
        return [{ path: filePath, status: "ok" }];
      }
      return undefined;
    });

    await scanProcessesNow();

    expect(
      useAppStore.getState().emulatorAutoBinaries.get("dolphin"),
    ).toMatchObject({
      exePath,
    });
    expect(
      useAppStore.getState().emulatorAutoLaunchTargets.get(contentKey),
    ).toMatchObject({ filePath });
    expect(useAppStore.getState().emulatorLaunchCandidates.size).toBe(0);
  });

  it("learns the file opened later in Dolphin without a redundant confirmation", async () => {
    const contentKey = "dolphin:title_id:g4op69";
    useAppStore.setState({
      emulatorMappings: new Map([
        [
          contentKey,
          emulatorMapping({
            contentKey,
            emulatorId: "dolphin",
            label: "Dolphin",
            contentKind: "title_id",
            contentValue: "g4op69",
            display: "The Sims 2: Pets",
          }),
        ],
      ]),
    });
    const filePath = String.raw`D:\Games\The Sims 2 Pets.rvz`;
    let running = true;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "scan_processes") {
        return running
          ? [
              {
                exeName: "Dolphin.exe",
                exePath: String.raw`C:\Emulators\Dolphin.exe`,
                pid: 123,
                startedAtUnix: 10,
                emulatorId: "dolphin",
                commandLine: [],
                windowTitle:
                  "Dolphin 2606 | JIT64 SC | Vulkan | HLE | The Sims 2: Pets (G4OP69)",
                openFiles: [filePath],
              },
            ]
          : [];
      }
      if (command === "verify_emulator_content_paths") {
        return [{ path: filePath, status: "ok" }];
      }
      return undefined;
    });

    await scanProcessesNow();

    expect(
      useAppStore.getState().emulatorAutoLaunchTargets.get(contentKey),
    ).toMatchObject({ filePath });
    expect(useAppStore.getState().emulatorLaunchCandidates.size).toBe(0);

    running = false;
    await scanProcessesNow();
    expect(
      useAppStore.getState().emulatorAutoLaunchTargets.get(contentKey),
    ).toMatchObject({ filePath });
    expect(useAppStore.getState().emulatorLaunchCandidates.size).toBe(0);
  });

  it("uses the existing mapping while a PlayCounter-launched Dolphin window is still starting", async () => {
    const contentKey = "dolphin:title_id:g4op69";
    const filePath = String.raw`D:\Games\Sims 2, The - Pets (Europe) (En,Fr,De).rvz`;
    const mapping = emulatorMapping({
      contentKey,
      emulatorId: "dolphin",
      label: "Dolphin",
      contentKind: "title_id",
      contentValue: "g4op69",
      display: "The Sims 2: Pets",
      gameName: "The Sims 2: Pets",
    });
    useAppStore.setState({
      emulatorMappings: new Map([[contentKey, mapping]]),
      emulatorAutoLaunchTargets: new Map([
        [
          contentKey,
          {
            contentKey,
            emulatorId: "dolphin",
            filePath,
            setAt: "2026-08-24T00:00:00.000Z",
          },
        ],
      ]),
      emulatorObservations: [
        {
          kind: "content",
          key: "dolphin:rom:sims 2, the - pets (europe) (en,fr,de).rvz",
          emulatorId: "dolphin",
          label: "Dolphin",
          hostExeName: "Dolphin.exe",
          contentKind: "rom",
          contentValue: "sims 2, the - pets (europe) (en,fr,de).rvz",
          display: "Sims 2, The - Pets (Europe) (En,Fr,De).rvz",
          trust: "recognized",
          shareable: true,
          state: "unknown",
          detectedAt: "2026-08-24T00:00:00.000Z",
        },
      ],
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "scan_processes") {
        return [
          {
            exeName: "Dolphin.exe",
            exePath: String.raw`C:\Emulators\Dolphin.exe`,
            pid: 123,
            startedAtUnix: 10,
            emulatorId: "dolphin",
            commandLine: ["--batch", `--exec=${filePath}`],
            windowTitle: null,
            openFiles: [filePath],
          },
        ];
      }
      return undefined;
    });

    await scanProcessesNow();

    expect(useAppStore.getState().emulatorObservations).toEqual([]);
    expect(useAppStore.getState().activeSessions).toHaveLength(1);
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      gameName: "The Sims 2: Pets",
      emulator: {
        emulatorId: "dolphin",
        contentKey,
      },
    });
  });

  it("does not learn executable paths from temporary folders", async () => {
    useAppStore.setState({
      exeCache: new Map([
        ["gg5.exe", entry({ exeName: "gg5.exe", gameId: 42, source: "igdb" })],
      ]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "scan_processes") {
        return [
          {
            exeName: "gg5.exe",
            exePath: String.raw`C:\Users\Me\AppData\Local\Temp\extract\gg5.exe`,
            pid: 123,
          },
        ];
      }
      return undefined;
    });

    await scanProcessesNow();
    expect(useAppStore.getState().launchTargets.has("gg5.exe")).toBe(false);
  });

  it("does not learn executable paths while launching is disabled", async () => {
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);
    useAppStore.setState({
      exeCache: new Map([["game.exe", entry({ gameId: 42, source: "igdb" })]]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "scan_processes") {
        return [
          {
            exeName: "Game.exe",
            exePath: target.path,
            pid: 123,
          },
        ];
      }
      return undefined;
    });

    await scanProcessesNow();
    expect(useAppStore.getState().launchTargets.size).toBe(0);
  });

  it("prunes verified missing targets but keeps inaccessible ones", async () => {
    const inaccessible = {
      ...target,
      exeName: "NetworkGame.exe",
      path: String.raw`Z:\Games\NetworkGame.exe`,
    };
    useAppStore.getState().setLaunchTarget(target);
    useAppStore.getState().setLaunchTarget(inaccessible);
    invokeMock.mockResolvedValueOnce([
      { path: target.path, status: "missing" },
      { path: inaccessible.path, status: "unreadable" },
    ]);

    await expect(verifyLaunchTargets("test")).resolves.toBe(1);
    expect(useAppStore.getState().launchTargets.has("game.exe")).toBe(false);
    expect(useAppStore.getState().launchTargets.get("networkgame.exe")).toEqual(
      inaccessible,
    );
  });

  it("prunes stale manual launchers independently", async () => {
    const manual = {
      ...target,
      exeName: "Launcher.exe",
      path: String.raw`C:\Games\Launcher.exe`,
    };
    useAppStore.getState().setLaunchTarget(target);
    useAppStore.getState().setManualLaunchTarget(manual);
    invokeMock.mockResolvedValueOnce([
      { path: target.path, status: "ok" },
      { path: manual.path, status: "missing" },
    ]);

    await expect(verifyLaunchTargets("manual-test")).resolves.toBe(1);
    expect(useAppStore.getState().manualLaunchTargets.size).toBe(0);
    expect(useAppStore.getState().launchTargets.get("game.exe")).toEqual(
      target,
    );
  });

  it("does not verify saved paths while launching is disabled", async () => {
    useAppStore.getState().setLaunchTarget(target);
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);

    await expect(verifyLaunchTargets("test-disabled")).resolves.toBe(0);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "verify_launch_paths",
      expect.anything(),
    );
    expect(useAppStore.getState().launchTargets.get("game.exe")).toEqual(
      target,
    );
  });

  it("captures an ambiguous executable for only the selected local game", () => {
    useAppStore.setState({
      ambiguousMatches: [
        {
          exeName: "Mixtape.exe",
          exePath: String.raw`C:\Games\Mixtape.exe`,
          candidates: [],
          detectedAt: "2026-08-20T10:00:00.000Z",
          endedAt: "2026-08-20T10:01:00.000Z",
        },
      ],
    });

    selectAmbiguousMatch("Mixtape.exe", {
      id: 7,
      name: "Mixtape",
      coverUrl: "cover",
      source: "igdb",
    });

    expect(useAppStore.getState().launchTargets.get("mixtape.exe")).toEqual({
      exeName: "Mixtape.exe",
      path: String.raw`C:\Games\Mixtape.exe`,
      owner: { gameId: 7, source: "igdb" },
    });
  });
});

describe("local library reset", () => {
  it("clears every library data source and preserves app identity and preferences", () => {
    const settings = useAppStore.getState().settings;
    const completedSession: Session = {
      id: 1,
      gameId: 42,
      gameName: "Doom 3",
      coverUrl: "cover",
      source: "igdb",
      exeName: "Doom3.exe",
      startedAt: "2026-08-20T09:00:00.000Z",
      endedAt: "2026-08-20T10:00:00.000Z",
      durationSeconds: 3600,
    };

    useAppStore.setState({
      installUuid: "install-id",
      settings,
      blacklist: new Set(["ignored.exe"]),
      contributionCounts: {
        suggested: 2,
        verified: 1,
        pending: 0,
        rejected: 1,
      },
      knownEmulators: new Map([
        [
          "dosbox",
          {
            emulatorId: "dosbox",
            label: "DOSBox",
            firstSeenAt: "2026-08-20T09:00:00.000Z",
            lastSeenAt: "2026-08-20T10:00:00.000Z",
            hostExeNames: ["dosbox.exe"],
          },
        ],
      ]),
      exeCache: new Map([["doom3.exe", entry({ gameId: 42, source: "igdb" })]]),
      recentSessions: [completedSession],
      activeSessions: [
        {
          id: 2,
          gameId: 42,
          gameName: "Doom 3",
          coverUrl: "cover",
          source: "igdb",
          exeName: "Doom3.exe",
          startedAt: "2026-08-20T11:00:00.000Z",
          checkpointedAt: "2026-08-20T11:00:00.000Z",
        },
      ],
      ambiguousMatches: [
        {
          exeName: "game.exe",
          exePath: null,
          candidates: [],
          detectedAt: "2026-08-20T11:00:00.000Z",
        },
      ],
      emulatorMappings: new Map([
        ["dosbox:program:doom3.exe", emulatorMapping()],
      ]),
      emulatorObservations: [
        {
          kind: "host-notice",
          key: "dosbox:host",
          emulatorId: "dosbox",
          label: "DOSBox",
          hostExeName: "dosbox.exe",
          reason: "no-signal",
          detectedAt: "2026-08-20T11:00:00.000Z",
        },
      ],
      gameMetadata: new Map([
        [
          "igdb:42",
          {
            id: 42,
            name: "Doom 3",
            coverUrl: "cover",
            source: "igdb",
          },
        ],
      ]),
      archivedSeconds: 7200,
      archivedGameSeconds: { "igdb:42": 7200 },
      playtimeAdjustments: { "igdb:42": 600 },
      autoDetectedGameKeys: ["igdb:42"],
      manualLaunchTargets: new Map([
        [
          "42:igdb",
          {
            exeName: "Launcher.exe",
            path: String.raw`C:\Games\Launcher.exe`,
            owner: { gameId: 42, source: "igdb" },
          },
        ],
      ]),
    });

    expect(clearLocalLibrary()).toEqual({
      matches: 1,
      sessions: 1,
      activeSessions: 1,
      emulatorMappings: 1,
    });

    const state = useAppStore.getState();
    expect(state).toMatchObject({
      installUuid: "install-id",
      settings,
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      autoDetectedGameKeys: [],
    });
    expect(state.blacklist).toEqual(new Set(["ignored.exe"]));
    expect(state.manualLaunchTargets.size).toBe(0);
    expect(state.contributionCounts).toMatchObject({ verified: 1 });
    expect(state.knownEmulators.has("dosbox")).toBe(true);
    expect(state.exeCache.size).toBe(0);
    expect(state.recentSessions).toEqual([]);
    expect(state.activeSessions).toEqual([]);
    expect(state.ambiguousMatches).toEqual([]);
    expect(state.emulatorMappings.size).toBe(0);
    expect(state.emulatorObservations).toEqual([]);
    expect(state.gameMetadata.size).toBe(0);
    expect(globalThis.localStorage.setItem).toHaveBeenCalled();
  });
});

describe("post-import notification baseline", () => {
  it("records reached achievements without delivering notifications", () => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          source: "community",
          exeName: "Game.exe",
          startedAt: "2026-08-09T00:00:00.000Z",
          endedAt: "2026-08-09T10:00:00.000Z",
          durationSeconds: 10 * 3600,
        },
      ],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      notifications: [],
      toasts: [],
    });

    const delivered = evaluateAndStoreMilestones({
      now: new Date("2026-08-19T00:00:00.000Z"),
      suppressNotifications: true,
    });

    expect(delivered).toEqual([]);
    expect(
      useAppStore.getState().awardedMilestones.map((item) => item.id),
    ).toEqual(expect.arrayContaining(["milestone:total:10"]));
    expect(useAppStore.getState().notifications).toEqual([]);
    expect(useAppStore.getState().toasts).toEqual([]);
  });

  it("baselines contribution transitions and achievements silently", async () => {
    const verified = contribution({
      status: "verified",
      reviewNote: undefined,
      reviewedAt: "2026-08-18T00:00:00.000Z",
    });
    useAppStore.setState({
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
      seenContributionStatus: {},
      contributionCounts: {
        suggested: 0,
        verified: 0,
        pending: 0,
        rejected: 0,
      },
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      suppressContributionNotificationsOnce: true,
      notifications: [],
      toasts: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          items: [verified],
          counts: { suggested: 1, verified: 1, pending: 0, rejected: 0 },
        }),
      })),
    );

    await pollContributions("interval");

    const state = useAppStore.getState();
    expect(Object.values(state.seenContributionStatus)).toEqual(["verified"]);
    expect(state.contributionCounts.verified).toBe(1);
    expect(state.suppressContributionNotificationsOnce).toBe(false);
    expect(state.awardedMilestones.map((item) => item.id)).toContain(
      "milestone:verified:1",
    );
    expect(state.notifications).toEqual([]);
    expect(state.toasts).toEqual([]);
  });

  it("keeps the contribution baseline pending while the API is offline", async () => {
    useAppStore.setState({
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
      suppressContributionNotificationsOnce: true,
      backendHealth: {
        status: "offline",
        checkedAt: "2026-08-19T00:00:00.000Z",
        detail: "offline",
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await pollContributions("startup");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().suppressContributionNotificationsOnce).toBe(
      true,
    );
  });
});

describe("emulator contribution polling", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";
  const contentKey = "dosbox:program:doom.exe";
  const mapping: EmulatorMapping = {
    contentKey,
    emulatorId: "dosbox",
    label: "DOSBox",
    contentKind: "program",
    contentValue: "doom.exe",
    display: "DOOM.EXE",
    trust: "recognized",
    decision: "game",
    gameId: 42,
    gameName: "Doom",
    coverUrl: "cover",
    source: "igdb",
    confidence: "user",
    shareable: true,
    share: {
      status: "pending",
      gameId: 42,
      submittedAt: "2026-08-20T10:00:00.000Z",
    },
    decidedAt: "2026-08-20T10:00:00.000Z",
    lastSeenAt: "2026-08-20T10:00:00.000Z",
  };

  it("notifies, reconciles state, and awards the separate ladder", async () => {
    useAppStore.setState({
      installUuid,
      emulatorMappings: new Map([[contentKey, mapping]]),
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
    });
    const status = { current: "verified" as "verified" | "rejected" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          items: [],
          counts: { suggested: 0, verified: 0, pending: 0, rejected: 0 },
          emulator: {
            items: [
              {
                emulatorId: "dosbox",
                contentKind: "program",
                contentValue: "doom.exe",
                gameId: 42,
                gameName: "Doom",
                coverUrl: "cover",
                status: status.current,
                reviewNote:
                  status.current === "rejected" ? "Wrong game" : undefined,
                reviewedAt: "2026-08-21T10:00:00.000Z",
                createdAt: "2026-08-20T10:00:00.000Z",
              },
            ],
            counts: {
              suggested: 1,
              verified: status.current === "verified" ? 1 : 0,
              pending: 0,
              rejected: status.current === "rejected" ? 1 : 0,
            },
          },
        }),
      })),
    );

    await pollContributions("emulator-test");
    let state = useAppStore.getState();
    expect(state.emulatorContributionCounts.verified).toBe(1);
    expect(state.emulatorMappings.get(contentKey)?.share?.status).toBe(
      "verified",
    );
    expect(
      state.notifications.filter((item) => item.kind === "suggestion-verified"),
    ).toHaveLength(1);
    expect(state.awardedMilestones.map((item) => item.id)).toContain(
      "milestone:emulator:1",
    );
    expect(state.awardedMilestones.map((item) => item.id)).not.toContain(
      "milestone:verified:1",
    );

    await pollContributions("emulator-repeat");
    expect(
      useAppStore
        .getState()
        .notifications.filter((item) => item.kind === "suggestion-verified"),
    ).toHaveLength(1);

    status.current = "rejected";
    await pollContributions("emulator-rejected");
    state = useAppStore.getState();
    expect(state.emulatorMappings.get(contentKey)?.share?.status).toBe(
      "rejected",
    );
    expect(
      state.notifications.some((item) => item.kind === "suggestion-rejected"),
    ).toBe(true);
    expect(state.awardedMilestones.map((item) => item.id)).not.toContain(
      "milestone:emulator:1",
    );
  });

  it("preserves emulator state when an older API omits the block", async () => {
    useAppStore.setState({
      installUuid,
      emulatorMappings: new Map([[contentKey, mapping]]),
      emulatorContributionCounts: {
        suggested: 1,
        verified: 1,
        pending: 0,
        rejected: 0,
      },
      awardedMilestones: [
        {
          id: "milestone:emulator:1",
          kind: "milestone-emulator",
          title: "Your first emulator match was approved",
          awardedAt: "2026-08-20T10:00:00.000Z",
        },
      ],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          items: [],
          counts: { suggested: 0, verified: 0, pending: 0, rejected: 0 },
        }),
      })),
    );

    await pollContributions("legacy-api");

    const state = useAppStore.getState();
    expect(state.emulatorContributionCounts.verified).toBe(1);
    expect(state.emulatorMappings.get(contentKey)?.share?.status).toBe(
      "pending",
    );
    expect(state.awardedMilestones.map((item) => item.id)).toContain(
      "milestone:emulator:1",
    );
  });
});

describe("ignored process suggestions", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";

  it("user-ignores locally and sends minimal, platform-scoped evidence", async () => {
    const cached = entry({
      exeName: "Service.exe",
      state: "unmatched",
      gameId: undefined,
      gameName: undefined,
    });
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["service.exe", cached]]),
      settings: {
        ...useAppStore.getState().settings,
        autoShareIgnoredProcesses: true,
      },
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ status: "recorded" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await ignoreDiscoveredProcess("Service.exe");

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: {
        kind: "suggested",
        status: "recorded",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(useAppStore.getState().exeCache.has("service.exe")).toBe(false);
    expect(globalThis.localStorage.setItem).toHaveBeenCalled();
    const request = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/community/ignored-processes"),
    );
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      exeName: "Service.exe",
      platform: "windows",
      installUuid,
    });
  });

  it("only user-ignores locally when automatic sharing is disabled", async () => {
    useAppStore.setState({
      installUuid,
      settings: {
        ...useAppStore.getState().settings,
        autoShareIgnoredProcesses: false,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ignoreDiscoveredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "disabled" },
    });
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("protects matched games and pickers", async () => {
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["game.exe", entry({ source: "igdb" })]]),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(suggestIgnoredProcess("Game.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "not_eligible", reason: "matched_game" },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    useAppStore.setState({
      blacklist: new Set(),
      ambiguousMatches: [
        {
          exeName: "Picker.exe",
          exePath: null,
          candidates: [],
          detectedAt: "2026-08-16T20:00:00.000Z",
        },
      ],
    });
    await expect(suggestIgnoredProcess("Picker.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "not_eligible", reason: "ambiguous_picker" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still user-ignores locally when suggestions are unavailable offline", async () => {
    useAppStore.setState({
      installUuid,
      backendHealth: {
        status: "offline",
        checkedAt: "2026-08-16T20:00:00.000Z",
        detail: "unreachable",
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(suggestIgnoredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "skipped", reason: "offline" },
    });
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the local user-ignore when submitting the suggestion fails", async () => {
    useAppStore.setState({ installUuid });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })),
    );

    await expect(suggestIgnoredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "failed" },
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
  });

  it("still submits the suggestion when the user ignore file cannot be updated", async () => {
    useAppStore.setState({ installUuid });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "set_user_ignored_process") throw new Error("locked");
      if (command === "scan_processes") return [];
      return undefined;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ status: "recorded" }),
      })),
    );

    await expect(suggestIgnoredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: false,
      suggestion: {
        kind: "suggested",
        status: "recorded",
      },
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    useAppStore.setState({ installUuid });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ status: "recorded" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = suggestIgnoredProcess("Service.exe");
    const second = suggestIgnoredProcess("Service.exe");
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("negative match reports", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";
  const activeSession = {
    id: 10,
    gameId: 42,
    gameName: "Wrong game",
    exeName: "Game.exe",
    coverUrl: "cover",
    source: "igdb" as const,
    startedAt: "2026-08-09T10:00:00.000Z",
    checkpointedAt: "2026-08-09T10:01:00.000Z",
  };
  const historySession: Session = {
    id: 11,
    gameId: 42,
    gameName: "Wrong game",
    exeName: "Game.exe",
    coverUrl: "cover",
    source: "igdb",
    startedAt: "2026-08-08T10:00:00.000Z",
    endedAt: "2026-08-08T10:01:00.000Z",
    durationSeconds: 60,
  };

  function seedMatchedGame() {
    useAppStore.setState({
      installUuid,
      exeCache: new Map([
        [
          "game.exe",
          entry({
            gameId: 42,
            gameName: "Wrong game",
            source: "igdb",
          }),
        ],
      ]),
      activeSessions: [activeSession],
      recentSessions: [historySession],
    });
  }

  it("blocks locally, stops the active session, and sends mapped evidence", async () => {
    seedMatchedGame();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ status: "recorded", flagged: false }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await reportNegativeMatch("Game.exe");

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      report: "recorded",
    });
    expect(useAppStore.getState().blacklist.has("game.exe")).toBe(true);
    expect(useAppStore.getState().exeCache.has("game.exe")).toBe(false);
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(useAppStore.getState().recentSessions).toEqual([historySession]);
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Game.exe",
      ignored: true,
    });
    const reportRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/community/identifier-reports"),
    );
    expect(reportRequest).toBeDefined();
    expect(JSON.parse(String(reportRequest?.[1]?.body))).toEqual({
      exeName: "Game.exe",
      reason: "not_a_game",
      installUuid,
      gameId: 42,
      gameSource: "igdb",
    });
  });

  it("keeps the local block and report when the ignore-file write fails", async () => {
    seedMatchedGame();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "set_user_ignored_process") {
        throw new Error("file locked");
      }
      if (command === "scan_processes") {
        return [{ exeName: "Game.exe", exePath: null }];
      }
      return undefined;
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/community/identifier-reports")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ status: "recorded", flagged: false }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          matches: [
            {
              key: "game.exe",
              game: {
                id: 42,
                name: "Wrong game",
                coverUrl: "",
                source: "igdb",
              },
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await reportNegativeMatch("Game.exe");
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("scan_processes"),
    );

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: false,
      report: "recorded",
    });
    expect(useAppStore.getState().blacklist.has("game.exe")).toBe(true);
    expect(useAppStore.getState().exeCache.has("game.exe")).toBe(false);
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/api/match-processes"),
      ),
    ).toHaveLength(0);
  });

  it("dismisses and ignores an uncertain picker without sending a report", async () => {
    useAppStore.setState({
      installUuid,
      ambiguousMatches: [
        {
          exeName: "Game.exe",
          exePath: null,
          candidates: [
            {
              id: 42,
              name: "Possible game",
              coverUrl: "",
              source: "igdb",
            },
          ],
          detectedAt: "2026-08-09T10:00:00.000Z",
        },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await dismissAmbiguousMatch("Game.exe");
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("scan_processes"),
    );

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
    });
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
    expect(useAppStore.getState().blacklist.has("game.exe")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns flag metadata from a manual match lookup", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        matches: [
          {
            key: "game.exe",
            game: null,
            ambiguousGames: [
              {
                id: 42,
                name: "Possible game",
                coverUrl: "",
                source: "igdb",
              },
            ],
            flaggedIdentifier: { reason: "not_a_game" },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findGameMatches("Game.exe")).resolves.toEqual({
      games: [
        {
          id: 42,
          name: "Possible game",
          coverUrl: "",
          source: "igdb",
        },
      ],
      flaggedIdentifier: { reason: "not_a_game" },
    });
  });

  it("returns pending community alternatives so a mistaken correction can be reverted", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        matches: [
          {
            key: "palworld.exe",
            game: null,
            pendingCommunityGames: [
              {
                id: 42,
                igdbId: 100,
                name: "Palworld",
                coverUrl: "palworld.jpg",
                source: "community",
              },
              {
                id: 84,
                igdbId: 200,
                name: "Warcraft III",
                coverUrl: "warcraft.jpg",
                source: "community",
              },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findGameMatches("Palworld.exe")).resolves.toEqual({
      games: [
        {
          id: 42,
          igdbId: 100,
          name: "Palworld",
          coverUrl: "palworld.jpg",
          source: "community",
        },
        {
          id: 84,
          igdbId: 200,
          name: "Warcraft III",
          coverUrl: "warcraft.jpg",
          source: "community",
        },
      ],
      pendingCommunityGameIds: [42, 84],
    });
  });

  it("does not offer the current in-review correction as a community match", async () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "palworld.exe",
          entry({
            exeName: "Palworld.exe",
            gameId: -123,
            igdbId: 200,
            gameName: "Warcraft III: The Frozen Throne",
            coverUrl: "warcraft.jpg",
            communitySuggestionId: 84,
            communitySuggestionVerified: false,
            communitySuggestionStatus: "pending",
          }),
        ],
      ]),
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        matches: [
          {
            key: "palworld.exe",
            game: {
              id: 42,
              igdbId: 100,
              name: "Palworld",
              coverUrl: "palworld.jpg",
              source: "community",
            },
            pendingCommunityGames: [
              {
                id: 84,
                igdbId: 200,
                name: "Warcraft III: The Frozen Throne",
                coverUrl: "warcraft.jpg",
                source: "community",
              },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findGameMatches("Palworld.exe")).resolves.toEqual({
      games: [
        {
          id: 42,
          igdbId: 100,
          name: "Palworld",
          coverUrl: "palworld.jpg",
          source: "community",
        },
      ],
    });
  });

  it("locally switches an in-review correction back to an earlier community candidate", () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "palworld.exe",
          entry({
            exeName: "Palworld.exe",
            gameId: -123,
            igdbId: 200,
            gameName: "Warcraft III",
            coverUrl: "warcraft.jpg",
            communitySuggestionId: 84,
            communitySuggestionVerified: false,
            communitySuggestionStatus: "pending",
          }),
        ],
      ]),
    });

    suggestTrackedGameToCommunity(
      "Palworld.exe",
      "Palworld",
      "palworld.jpg",
      42,
      false,
      100,
    );

    expect(useAppStore.getState().exeCache.get("palworld.exe")).toMatchObject({
      state: "matched",
      source: "custom",
      igdbId: 100,
      gameName: "Palworld",
      coverUrl: "palworld.jpg",
      communitySuggestionId: 42,
      communitySuggestionVerified: false,
      communitySuggestionStatus: "pending",
      pendingCommunityGame: {
        id: 42,
        igdbId: 100,
        name: "Palworld",
        coverUrl: "palworld.jpg",
        source: "community",
      },
    });
  });
});

describe("game metadata hydration", () => {
  it("does not loop when metadata has no IGDB identity", async () => {
    const session: Session = {
      id: 1,
      gameId: 987654,
      gameName: "Legacy community game",
      coverUrl: "",
      source: "community",
      exeName: "Legacy.exe",
      startedAt: "2026-08-09T00:00:00.000Z",
      endedAt: "2026-08-09T00:02:00.000Z",
      durationSeconds: 120,
    };
    const sessions = [session];
    useAppStore.setState({ recentSessions: sessions });
    vi.stubGlobal("window", globalThis);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        games: [
          {
            id: 987654,
            name: "Legacy community game",
            coverUrl: "",
            source: "community",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await hydrateGameMetadata([
      { gameId: session.gameId, source: session.source },
    ]);
    await hydrateGameMetadata([
      { gameId: session.gameId, source: session.source },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().recentSessions).toBe(sessions);
  });

  it("keeps unchanged persisted session references stable", () => {
    const session: Session = {
      id: 2,
      gameId: 42,
      gameName: "Game",
      coverUrl: "",
      source: "igdb",
      exeName: "Game.exe",
      startedAt: "2026-08-09T00:00:00.000Z",
      endedAt: "2026-08-09T00:02:00.000Z",
      durationSeconds: 120,
    };
    const sessions = [session];
    useAppStore.setState({ recentSessions: sessions });

    persist();

    expect(useAppStore.getState().recentSessions).toBe(sessions);
  });

  it("repairs a cached game corrupted by a reused server id", async () => {
    const reusedGameId = 310031;
    const wrongIgdbId = 378504;
    const wuchangSession: Session = {
      id: 31,
      gameId: reusedGameId,
      igdbId: wrongIgdbId,
      gameName: "Wuchang: Fallen Feathers",
      coverUrl: "wuchang-cover",
      source: "community",
      exeName: "Project_Plague-WinGDK-Shipping.exe",
      startedAt: "2026-08-08T00:00:00.000Z",
      endedAt: "2026-08-08T01:00:00.000Z",
      durationSeconds: 3600,
    };
    useAppStore.setState({
      gameMetadata: new Map([
        [
          `community:${reusedGameId}`,
          {
            id: reusedGameId,
            igdbId: wrongIgdbId,
            name: "Higher or Lower: Spotify Edition",
            coverUrl: "spotify-cover",
            source: "community",
          },
        ],
      ]),
      exeCache: new Map([
        [
          "project_plague-wingdk-shipping.exe",
          entry({
            exeName: "Project_Plague-WinGDK-Shipping.exe",
            gameId: reusedGameId,
            igdbId: wrongIgdbId,
            gameName: "Wuchang: Fallen Feathers",
            coverUrl: "wuchang-cover",
            source: "community",
          }),
        ],
      ]),
      activeSessions: [
        {
          id: wuchangSession.id,
          gameId: wuchangSession.gameId,
          igdbId: wuchangSession.igdbId,
          gameName: wuchangSession.gameName!,
          coverUrl: wuchangSession.coverUrl!,
          source: wuchangSession.source,
          exeName: wuchangSession.exeName,
          startedAt: wuchangSession.startedAt,
          checkpointedAt: wuchangSession.startedAt,
        },
      ],
      recentSessions: [wuchangSession],
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ games: [] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await hydrateGameMetadata([]);

    const state = useAppStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`ids=${reusedGameId}`);
    expect(state.gameMetadata.has(`community:${reusedGameId}`)).toBe(false);
    expect(
      state.exeCache.get("project_plague-wingdk-shipping.exe")?.igdbId,
    ).toBeUndefined();
    expect(state.activeSessions[0].igdbId).toBeUndefined();
    expect(state.recentSessions[0].igdbId).toBeUndefined();

    const resolveIgdbId = createGameIdentityResolver(
      state.gameMetadata,
      state.exeCache,
    );
    expect(
      resolvedCanonicalGameKey(state.recentSessions[0], resolveIgdbId),
    ).toBe(`community:${reusedGameId}`);
  });
});

describe("contribution marker repair", () => {
  it("repairs the sole matching markerless custom game", () => {
    const repaired = applyContributionMarkers(
      new Map([["game.exe", entry()]]),
      [contribution()],
    ).get("game.exe");
    expect(repaired?.communitySuggestionId).toBe(42);
    expect(repaired?.communitySuggestionStatus).toBe("rejected");
    expect(repaired?.communitySuggestionNote).toBe("Wrong game");
  });

  it("does not clobber an existing marker", () => {
    const existing = entry({ communitySuggestionId: 7 });
    const repaired = applyContributionMarkers(
      new Map([["game.exe", existing]]),
      [contribution()],
    ).get("game.exe");
    expect(repaired).toBe(existing);
  });

  it("does not repair a repurposed exe whose game name differs", () => {
    const existing = entry({ gameName: "Different Game" });
    const repaired = applyContributionMarkers(
      new Map([["game.exe", existing]]),
      [contribution()],
    ).get("game.exe");
    expect(repaired).toBe(existing);
  });

  it("does not choose between two viable contributions for one exe", () => {
    const existing = entry();
    const repaired = applyContributionMarkers(
      new Map([["game.exe", existing]]),
      [contribution(), contribution({ gameId: 43 })],
    ).get("game.exe");
    expect(repaired).toBe(existing);
  });
});

describe("rejected contribution reconciliation", () => {
  it("allows a rejected suggestion to become approved", () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "game.exe",
          entry({
            communitySuggestionId: 42,
            communitySuggestionVerified: false,
            communitySuggestionStatus: "rejected",
            communitySuggestionNote: "Old note",
          }),
        ],
      ]),
    });
    const approved: Game = {
      id: 42,
      igdbId: 12345,
      name: "Game",
      coverUrl: "cover",
      source: "community",
    };
    expect(
      applyCommunitySuggestionOutcome("Game.exe", [approved], [], true, true),
    ).toBe("approved");
    expect(
      useAppStore.getState().exeCache.get("game.exe")
        ?.communitySuggestionStatus,
    ).toBe("verified");
    expect(useAppStore.getState().exeCache.get("game.exe")?.igdbId).toBe(12345);
  });

  it("leaves an already rejected suggestion unchanged when still absent", () => {
    const rejected = entry({
      communitySuggestionId: 42,
      communitySuggestionVerified: false,
      communitySuggestionStatus: "rejected",
      communitySuggestionNote: "Keep this note",
    });
    useAppStore.setState({ exeCache: new Map([["game.exe", rejected]]) });
    expect(
      applyCommunitySuggestionOutcome("Game.exe", [], [], true, false),
    ).toBe("rejected");
    expect(useAppStore.getState().exeCache.get("game.exe")).toBe(rejected);
  });

  it("teaches a legacy pending custom entry its IGDB identity", () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "game.exe",
          entry({
            communitySuggestionId: 42,
            communitySuggestionStatus: "pending",
          }),
        ],
      ]),
      activeSessions: [
        {
          id: 1,
          gameId: -1,
          gameName: "Game",
          exeName: "Game.exe",
          coverUrl: "cover",
          source: "custom",
          startedAt: "2026-08-09T00:00:00.000Z",
          checkpointedAt: "2026-08-09T00:01:00.000Z",
        },
      ],
      recentSessions: [
        {
          id: 2,
          gameId: -1,
          gameName: "Game",
          exeName: "Game.exe",
          source: "custom",
          startedAt: "2026-08-08T00:00:00.000Z",
          endedAt: "2026-08-08T01:00:00.000Z",
          durationSeconds: 3600,
        },
      ],
    });
    const pending: Game = {
      id: 42,
      igdbId: 12345,
      name: "Game",
      coverUrl: "cover",
      source: "community",
    };

    expect(
      applyCommunitySuggestionOutcome("Game.exe", [], [pending], true, false),
    ).toBe("pending");
    expect(useAppStore.getState().exeCache.get("game.exe")?.igdbId).toBe(12345);
    expect(useAppStore.getState().activeSessions[0].igdbId).toBe(12345);
    expect(useAppStore.getState().recentSessions[0].igdbId).toBe(12345);
  });
});

describe("canonical alias actions", () => {
  it("carries identity through a running game match rewrite", () => {
    useAppStore.setState({
      exeCache: new Map([["game.exe", entry({ gameId: 7 })]]),
      activeSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          exeName: "Game.exe",
          coverUrl: "cover",
          source: "custom",
          startedAt: "2026-08-09T00:00:00.000Z",
          checkpointedAt: "2026-08-09T00:01:00.000Z",
        },
      ],
    });

    applyGameMatch("Game.exe", {
      id: 10,
      igdbId: 12345,
      name: "Game",
      coverUrl: "cover",
      source: "igdb",
    });
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      gameId: 10,
      igdbId: 12345,
      source: "igdb",
    });
  });

  it("untracks and adjusts all pairs represented by one merged card", () => {
    const aliases = [
      { gameId: 1, source: "igdb" as const },
      { gameId: 7, source: "community" as const },
    ];
    const sessions = aliases
      .map((alias, index) => ({
        id: index + 1,
        gameId: alias.gameId,
        igdbId: 12345,
        gameName: "Game",
        exeName: index === 0 ? "Game.exe" : "GameShipping.exe",
        source: alias.source,
        startedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
        endedAt: `2026-08-0${index + 1}T01:00:00.000Z`,
        durationSeconds: 3600,
      }))
      .reverse();
    useAppStore.setState({
      recentSessions: sessions,
      exeCache: new Map([
        ["game.exe", entry({ gameId: 1, source: "igdb", igdbId: 12345 })],
        [
          "gameshipping.exe",
          entry({
            exeName: "GameShipping.exe",
            gameId: 7,
            source: "community",
            igdbId: 12345,
          }),
        ],
      ]),
    });
    useAppStore.getState().setManualLaunchTarget({
      exeName: "Launcher.exe",
      path: String.raw`C:\Games\Launcher.exe`,
      owner: aliases[1],
    });

    setGamePlaytime({
      gameId: 1,
      igdbId: 12345,
      gameName: "Game",
      coverUrl: "cover",
      source: "igdb",
      exeName: "Game.exe",
      targetSeconds: 3600,
      aliases,
    });
    expect(useAppStore.getState().recentSessions).toEqual(sessions);
    expect(useAppStore.getState().playtimeAdjustments).toEqual({
      "igdb:1": -3600,
    });

    untrackGame(1, "igdb", true, aliases);
    expect(useAppStore.getState().exeCache.size).toBe(0);
    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
    expect(useAppStore.getState().manualLaunchTargets.size).toBe(0);
  });

  it("stores an archive-aware adjustment without inventing a session", () => {
    useAppStore.setState({
      archivedSeconds: 3600,
      archivedGameSeconds: { "community:7": 3600 },
    });

    setGamePlaytime({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      targetSeconds: 1800,
    });

    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(useAppStore.getState().playtimeAdjustments).toEqual({
      "community:7": -1800,
    });
  });

  it("refuses adjustments while the game is active", () => {
    useAppStore.setState({
      activeSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          coverUrl: "cover",
          exeName: "Game.exe",
          source: "community",
          startedAt: "2026-08-09T00:00:00.000Z",
          checkpointedAt: "2026-08-09T00:01:00.000Z",
        },
      ],
    });

    expect(() =>
      setGamePlaytime({
        gameId: 7,
        gameName: "Game",
        coverUrl: "cover",
        source: "community",
        exeName: "Game.exe",
        targetSeconds: 3600,
      }),
    ).toThrow("Stop the active session");
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
  });

  it("keeps archived and adjusted time when untracking without history removal", () => {
    useAppStore.setState({
      archivedSeconds: 3600,
      archivedGameSeconds: { "community:7": 3600 },
      playtimeAdjustments: { "community:7": 600 },
      exeCache: new Map([
        ["game.exe", entry({ gameId: 7, source: "community" })],
      ]),
    });

    untrackGame(7, "community", false);

    expect(useAppStore.getState()).toMatchObject({
      archivedSeconds: 3600,
      archivedGameSeconds: { "community:7": 3600 },
      playtimeAdjustments: { "community:7": 600 },
    });
  });

  it("marks a manually logged session without treating it as an adjustment", () => {
    addManualSession({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      durationSeconds: 600,
      endedAt: "2026-08-09T01:00:00.000Z",
    });

    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      origin: "manual",
      durationSeconds: 600,
    });
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
  });

  it("clears retained, archived, and adjusted time together", () => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 7,
          source: "community",
          exeName: "Game.exe",
          startedAt: "2026-08-09T00:00:00.000Z",
          endedAt: "2026-08-09T01:00:00.000Z",
          durationSeconds: 3600,
        },
      ],
      archivedSeconds: 1800,
      archivedGameSeconds: { "community:7": 1800 },
      playtimeAdjustments: { "community:7": -900 },
    });

    removeGameHistory(7, [{ gameId: 7, source: "community" }]);

    expect(useAppStore.getState()).toMatchObject({
      recentSessions: [],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
    });
  });

  it("revokes the only game's playtime achievements when adjusted to zero", () => {
    const awardedAt = "2026-08-09T20:00:00.000Z";
    const playtimeAwards = [
      {
        id: "milestone:total:10",
        kind: "milestone-total" as const,
        title: "You've played 10 hours in total",
        awardedAt,
      },
      {
        id: "milestone:game:community:7:10",
        kind: "milestone-game" as const,
        title: "10 hours played in Game",
        awardedAt,
      },
      {
        id: "milestone:month:2026-08:10",
        kind: "milestone-month" as const,
        title: "10 hours played in August 2026",
        awardedAt,
      },
    ];
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          source: "community",
          exeName: "Game.exe",
          startedAt: "2026-08-09T00:00:00.000Z",
          endedAt: "2026-08-09T20:00:00.000Z",
          durationSeconds: 20 * 3600,
        },
      ],
      awardedMilestones: playtimeAwards,
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      notifications: playtimeAwards.map((award) => ({
        id: award.id,
        kind: award.kind,
        title: award.title,
        createdAt: award.awardedAt,
      })),
      toasts: [],
    });

    setGamePlaytime({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      targetSeconds: 0,
    });

    const state = useAppStore.getState();
    expect(state.awardedMilestones.map((item) => item.id)).toEqual([
      "milestone:month:2026-08:10",
    ]);
    expect(state.notifications.map((item) => item.id)).toEqual([
      "milestone:month:2026-08:10",
    ]);
    expect(state.toasts).toEqual([]);
  });

  it("revokes playtime achievements after deleting all history", () => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          source: "community",
          exeName: "Game.exe",
          startedAt: "2026-08-09T00:00:00.000Z",
          endedAt: "2026-08-09T20:00:00.000Z",
          durationSeconds: 20 * 3600,
        },
      ],
      awardedMilestones: [
        {
          id: "milestone:total:10",
          kind: "milestone-total",
          title: "You've played 10 hours in total",
          awardedAt: "2026-08-09T20:00:00.000Z",
        },
        {
          id: "milestone:game:community:7:10",
          kind: "milestone-game",
          title: "10 hours played in Game",
          awardedAt: "2026-08-09T20:00:00.000Z",
        },
      ],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
    });

    removeGameHistory(7, [{ gameId: 7, source: "community" }]);

    expect(useAppStore.getState().awardedMilestones).toEqual([]);
  });

  it("awards achievements immediately for a manually added session", () => {
    useAppStore.setState({
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
    });

    addManualSession({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      durationSeconds: 10 * 3600,
      endedAt: "2026-08-09T20:00:00.000Z",
    });

    expect(
      useAppStore.getState().awardedMilestones.map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        "milestone:total:10",
        "milestone:game:community:7:10",
      ]),
    );
  });
});

describe("emulator mapping replacement", () => {
  it("moves active and completed sessions for the same content to the new game", async () => {
    const contentKey = "dosbox:program:game.exe";
    const mapping: EmulatorMapping = {
      contentKey,
      emulatorId: "dosbox",
      label: "DOSBox",
      contentKind: "program",
      contentValue: "GAME.EXE",
      display: "GAME.EXE",
      trust: "recognized",
      decision: "game",
      gameId: 1,
      gameName: "Old game",
      coverUrl: "old-cover",
      source: "igdb",
      confidence: "user",
      shareable: true,
      share: {
        status: "pending",
        gameId: 1,
        submittedAt: "2026-08-20T09:00:00.000Z",
      },
      decidedAt: "2026-08-20T09:00:00.000Z",
      lastSeenAt: "2026-08-20T10:00:00.000Z",
    };
    useAppStore.setState({
      emulatorMappings: new Map([[contentKey, mapping]]),
      emulatorObservations: [],
      activeSessions: [
        {
          id: 100,
          gameId: 1,
          gameName: "Old game",
          exeName: "",
          coverUrl: "old-cover",
          source: "igdb",
          startedAt: "2026-08-20T10:00:00.000Z",
          checkpointedAt: "2026-08-20T10:01:00.000Z",
          emulator: {
            emulatorId: "dosbox",
            label: "DOSBox",
            contentKey,
            display: "GAME.EXE",
            trust: "recognized",
          },
        },
      ],
      recentSessions: [
        {
          id: 101,
          gameId: 1,
          gameName: "Old game",
          exeName: "",
          coverUrl: "old-cover",
          source: "igdb",
          startedAt: "2026-08-19T10:00:00.000Z",
          endedAt: "2026-08-19T10:06:00.000Z",
          durationSeconds: 360,
          emulator: {
            emulatorId: "dosbox",
            label: "DOSBox",
            contentKey,
            display: "GAME.EXE",
            trust: "recognized",
          },
        },
        {
          id: 102,
          gameId: 1,
          gameName: "Old game",
          exeName: "",
          coverUrl: "old-cover",
          source: "igdb",
          startedAt: "2026-08-18T10:00:00.000Z",
          endedAt: "2026-08-18T10:03:00.000Z",
          durationSeconds: 180,
          emulator: {
            emulatorId: "dosbox",
            label: "DOSBox",
            contentKey: "dosbox:program:other.exe",
            display: "OTHER.EXE",
            trust: "recognized",
          },
        },
      ],
    });

    await selectEmulatorGame(contentKey, {
      id: 2,
      name: "New game",
      coverUrl: "new-cover",
      source: "igdb",
    });

    const state = useAppStore.getState();
    expect(state.activeSessions).toHaveLength(1);
    expect(state.activeSessions[0]).toMatchObject({
      id: 100,
      gameId: 2,
      gameName: "New game",
      coverUrl: "new-cover",
      startedAt: "2026-08-20T10:00:00.000Z",
      checkpointedAt: "2026-08-20T10:01:00.000Z",
    });
    expect(state.recentSessions[0]).toMatchObject({
      id: 101,
      gameId: 2,
      gameName: "New game",
      durationSeconds: 360,
    });
    expect(state.recentSessions[1]).toMatchObject({
      id: 102,
      gameId: 1,
      gameName: "Old game",
      durationSeconds: 180,
    });
    expect(state.emulatorMappings.get(contentKey)?.gameName).toBe("New game");
    expect(state.emulatorMappings.get(contentKey)?.share).toBeUndefined();
    expect(
      state.emulatorObservations.some((item) => item.key === contentKey),
    ).toBe(false);
  });
});

describe("emulator mapping sharing", () => {
  it("sends only the normalized identity, game id and install id", async () => {
    const contentKey = "dosbox:program:doom3.exe";
    useAppStore.setState({
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
      emulatorMappings: new Map([[contentKey, emulatorMapping()]]),
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await shareEmulatorMapping(contentKey)).toMatchObject({
      kind: "shared",
      share: { status: "pending", gameId: 42 },
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    expect(Object.keys(body).sort()).toEqual([
      "contentKind",
      "contentValue",
      "emulatorId",
      "gameId",
      "installUuid",
    ]);
    expect(body).not.toHaveProperty("display");
    expect(body).toMatchObject({
      emulatorId: "dosbox",
      contentKind: "program",
      contentValue: "doom3.exe",
      gameId: 42,
    });
  });

  it("delivers an already-rejected response through standard notifications", async () => {
    const contentKey = "dosbox:program:doom3.exe";
    useAppStore.setState({
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
      emulatorMappings: new Map([[contentKey, emulatorMapping()]]),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "rejected",
              reviewNote: "Wrong executable",
            }),
            { status: 200 },
          ),
      ),
    );

    expect(await shareEmulatorMapping(contentKey)).toMatchObject({
      kind: "shared",
      share: { status: "rejected" },
    });
    const state = useAppStore.getState();
    expect(state.notifications).toEqual([
      expect.objectContaining({
        kind: "suggestion-rejected",
        body: expect.stringContaining("Feedback: Wrong executable"),
      }),
    ]);
    expect(state.toasts).toEqual([
      expect.objectContaining({ title: "Doom 3 suggestion not approved" }),
    ]);
  });

  it("does not request sharing for local-only mappings", async () => {
    const contentKey = "dosbox:folder:private";
    useAppStore.setState({
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
      emulatorMappings: new Map([
        [
          contentKey,
          {
            contentKey,
            emulatorId: "dosbox",
            label: "DOSBox",
            contentKind: "folder",
            contentValue: "private",
            display: "Private",
            trust: "recognized",
            decision: "game",
            gameId: 42,
            gameName: "Game",
            source: "igdb",
            confidence: "user",
            shareable: false,
            decidedAt: "2026-08-20T09:00:00.000Z",
            lastSeenAt: "2026-08-20T10:00:00.000Z",
          },
        ],
      ]),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await shareEmulatorMapping(contentKey)).toEqual({
      kind: "skipped",
      reason: "not-shareable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("community suggestion cancellation", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";

  function pendingEntry(
    exeName: string,
    suggestionId: number,
    gameId = -suggestionId,
  ) {
    return entry({
      exeName,
      gameId,
      gameName: "Pending Game",
      communitySuggestionId: suggestionId,
      communitySuggestionVerified: false,
      communitySuggestionStatus: "pending",
      pendingCommunityGame: {
        id: suggestionId,
        name: "Pending Game",
        coverUrl: "cover",
        source: "community",
      },
    });
  }

  function contributionsResponse(items: Contribution[]) {
    return new Response(
      JSON.stringify({
        items,
        counts: {
          suggested: items.length,
          verified: items.filter((item) => item.status === "verified").length,
          pending: items.filter((item) => item.status === "pending").length,
          rejected: items.filter((item) => item.status === "rejected").length,
        },
      }),
      { status: 200 },
    );
  }

  it("clears only the exact pending marker and preserves local game data", async () => {
    const activeSession = {
      id: 1,
      gameId: -42,
      gameName: "Pending Game",
      exeName: "Mine.exe",
      coverUrl: "cover",
      source: "custom" as const,
      startedAt: "2026-08-23T10:00:00.000Z",
      checkpointedAt: "2026-08-23T10:01:00.000Z",
      communitySuggestionId: 42,
      communitySuggestionStatus: "pending" as const,
    };
    const recentSession: Session = {
      id: 2,
      gameId: -42,
      gameName: "Pending Game",
      exeName: "Mine.exe",
      coverUrl: "cover",
      source: "custom",
      startedAt: "2026-08-22T10:00:00.000Z",
      endedAt: "2026-08-22T11:00:00.000Z",
      durationSeconds: 3600,
      communitySuggestionId: 42,
      communitySuggestionStatus: "pending",
    };
    const sibling = pendingEntry("Sibling.exe", 84, -84);
    useAppStore.setState({
      installUuid,
      exeCache: new Map([
        ["mine.exe", pendingEntry("Mine.exe", 42)],
        ["sibling.exe", sibling],
      ]),
      activeSessions: [activeSession],
      recentSessions: [recentSession],
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({ status: "cancelled" }), {
            status: 200,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelCommunitySuggestion("Mine.exe", 42)).resolves.toEqual({
      kind: "cancelled",
    });

    const state = useAppStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)),
    ).toEqual({ exeName: "Mine.exe", gameId: 42, installUuid });
    expect(state.exeCache.get("mine.exe")).toMatchObject({
      gameId: -42,
      gameName: "Pending Game",
      source: "custom",
    });
    expect(
      state.exeCache.get("mine.exe")?.communitySuggestionId,
    ).toBeUndefined();
    expect(state.exeCache.get("sibling.exe")).toBe(sibling);
    expect(state.activeSessions[0]).toMatchObject({
      gameId: -42,
      gameName: "Pending Game",
    });
    expect(state.activeSessions[0].communitySuggestionId).toBeUndefined();
    expect(state.recentSessions[0].durationSeconds).toBe(3600);
    expect(state.recentSessions[0].communitySuggestionId).toBeUndefined();
  });

  it("does not send a request when the captured game identity is stale", async () => {
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["mine.exe", pendingEntry("Mine.exe", 43)]]),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelCommunitySuggestion("Mine.exe", 42)).resolves.toEqual({
      kind: "not-pending",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppresses stale pending polls until the server confirms absence", async () => {
    const pending = contribution({
      value: "Race.exe",
      gameId: 142,
      gameName: "Pending Game",
      status: "pending",
      reviewNote: undefined,
    });
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["race.exe", pendingEntry("Race.exe", 142)]]),
    });

    let resolveOldPoll!: (response: Response) => void;
    const oldPoll = new Promise<Response>((resolve) => {
      resolveOldPoll = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => oldPoll)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "cancelled" }), { status: 200 }),
      )
      .mockResolvedValueOnce(contributionsResponse([pending]))
      .mockResolvedValueOnce(contributionsResponse([]))
      .mockResolvedValueOnce(contributionsResponse([pending]));
    vi.stubGlobal("fetch", fetchMock);

    const inFlightPoll = pollContributions("before cancel");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await cancelCommunitySuggestion("Race.exe", 142);
    resolveOldPoll(contributionsResponse([pending]));
    await inFlightPoll;
    expect(
      useAppStore.getState().exeCache.get("race.exe")?.communitySuggestionId,
    ).toBeUndefined();

    await pollContributions("eventually consistent");
    expect(
      useAppStore.getState().exeCache.get("race.exe")?.communitySuggestionId,
    ).toBeUndefined();

    await pollContributions("cancel observed");
    expect(
      useAppStore.getState().exeCache.get("race.exe")?.communitySuggestionId,
    ).toBeUndefined();

    await pollContributions("new pending row");
    expect(
      useAppStore.getState().exeCache.get("race.exe")?.communitySuggestionId,
    ).toBe(142);
  });

  it("lets an exact successful re-suggestion retire the stale-poll guard", async () => {
    const pending = contribution({
      value: "Again.exe",
      gameId: 242,
      gameName: "Pending Game",
      status: "pending",
      reviewNote: undefined,
    });
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["again.exe", pendingEntry("Again.exe", 242)]]),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "cancelled" }), { status: 200 }),
      )
      .mockResolvedValueOnce(contributionsResponse([pending]));
    vi.stubGlobal("fetch", fetchMock);

    await cancelCommunitySuggestion("Again.exe", 242);
    suggestTrackedGameToCommunity(
      "Again.exe",
      "Pending Game",
      "cover",
      242,
      false,
    );
    await pollContributions("after re-suggestion");

    expect(
      useAppStore.getState().exeCache.get("again.exe")
        ?.communitySuggestionStatus,
    ).toBe("pending");
  });

  it("handles idempotent, ownership, and no-longer-pending responses", async () => {
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["missing.exe", pendingEntry("Missing.exe", 442)]]),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "not_found" }), {
            status: 200,
          }),
      ),
    );
    await expect(
      cancelCommunitySuggestion("Missing.exe", 442),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(
      useAppStore.getState().exeCache.get("missing.exe")?.communitySuggestionId,
    ).toBeUndefined();

    useAppStore.setState({
      exeCache: new Map([["owned.exe", pendingEntry("Owned.exe", 443)]]),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "not_owner" }), {
            status: 200,
          }),
      ),
    );
    await expect(cancelCommunitySuggestion("Owned.exe", 443)).resolves.toEqual({
      kind: "not-owner",
    });
    expect(
      useAppStore.getState().exeCache.get("owned.exe")?.communitySuggestionId,
    ).toBe(443);

    useAppStore.setState({
      exeCache: new Map([["reviewed.exe", pendingEntry("Reviewed.exe", 444)]]),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "not_pending" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(contributionsResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      cancelCommunitySuggestion("Reviewed.exe", 444),
    ).resolves.toEqual({ kind: "not-pending" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      useAppStore.getState().exeCache.get("reviewed.exe")
        ?.communitySuggestionId,
    ).toBe(444);
  });

  it("memoizes an older server that does not support cancellation", async () => {
    useAppStore.setState({
      installUuid,
      exeCache: new Map([
        ["legacy-one.exe", pendingEntry("Legacy-One.exe", 342)],
        ["legacy-two.exe", pendingEntry("Legacy-Two.exe", 343)],
      ]),
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cancelCommunitySuggestion("Legacy-One.exe", 342),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      cancelCommunitySuggestion("Legacy-Two.exe", 343),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
