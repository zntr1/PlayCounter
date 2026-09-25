// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { forgetUninstalledLibraryInstalls } from "./installRecheck";
import type { LibraryInstallEntry } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

const notFound = { kind: "notFound", message: "The file was not found." };

function install(
  provider: LibraryInstallEntry["provider"],
  externalId: string,
): LibraryInstallEntry {
  return {
    provider,
    externalId,
    installPath: `C:\\Games\\${externalId}`,
    scannedAt: "2026-09-25T12:00:00.000Z",
  };
}

describe("forgetUninstalledLibraryInstalls", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAppStore.setState({ libraryInstalls: new Map() });
  });

  it("forgets the launcher installs that are gone after a game file vanished", async () => {
    const steam = install("steam", "730");
    const xbox = install("xbox", "123");
    const battleNet = install("battlenet", "wow");
    for (const entry of [steam, xbox, battleNet]) {
      useAppStore.getState().setLibraryInstall(entry);
    }
    vi.mocked(invoke).mockResolvedValue([
      { provider: "steam", externalId: "730", status: "missing" },
      { provider: "xbox", externalId: "123", status: "ok" },
      { provider: "battlenet", externalId: "wow", status: "missing" },
    ]);

    await forgetUninstalledLibraryInstalls(notFound, [
      { install: steam },
      { install: xbox },
      { install: battleNet },
      {},
    ]);

    expect(invoke).toHaveBeenCalledWith("library_verify_installs", {
      installs: [steam, xbox, battleNet].map(
        ({ provider, externalId, installPath }) => ({
          provider,
          externalId,
          installPath,
        }),
      ),
    });
    expect([...useAppStore.getState().libraryInstalls.keys()]).toEqual([
      "xbox:123",
    ]);
  });

  it("keeps installs it cannot check, such as games on an unplugged drive", async () => {
    const steam = install("steam", "730");
    useAppStore.getState().setLibraryInstall(steam);
    vi.mocked(invoke).mockResolvedValue([
      { provider: "steam", externalId: "730", status: "unreadable" },
    ]);

    await forgetUninstalledLibraryInstalls(notFound, [{ install: steam }]);

    expect(useAppStore.getState().libraryInstalls.size).toBe(1);
  });

  it("only rechecks after a missing file", async () => {
    const steam = install("steam", "730");
    useAppStore.getState().setLibraryInstall(steam);

    await forgetUninstalledLibraryInstalls(
      { kind: "spawnFailed", message: "Access denied." },
      [{ install: steam }],
    );
    await forgetUninstalledLibraryInstalls(notFound, [{}]);

    expect(invoke).not.toHaveBeenCalled();
    expect(useAppStore.getState().libraryInstalls.size).toBe(1);
  });

  it("keeps the install when the recheck itself fails", async () => {
    const steam = install("steam", "730");
    useAppStore.getState().setLibraryInstall(steam);
    vi.mocked(invoke).mockRejectedValue(new Error("IPC failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await forgetUninstalledLibraryInstalls(notFound, [{ install: steam }]);

    expect(useAppStore.getState().libraryInstalls.size).toBe(1);
  });
});
