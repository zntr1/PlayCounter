// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { forgetUninstalledLibraryInstalls } from "./installRecheck";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

const SCANNED_AT = "2026-09-25T12:00:00.000Z";
const notFound = { kind: "notFound", message: "The file was not found." };

function storeInstall(provider: "steam" | "xbox", externalId: string) {
  useAppStore.getState().setLibraryInstall({
    provider,
    externalId,
    installPath: `C:\Games\${externalId}`,
    scannedAt: SCANNED_AT,
  });
}

describe("forgetUninstalledLibraryInstalls", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAppStore.setState({ libraryInstalls: new Map() });
  });

  it("forgets a Steam install that is gone after its game file vanished", async () => {
    storeInstall("steam", "730");
    vi.mocked(invoke).mockResolvedValue(false);

    await forgetUninstalledLibraryInstalls(notFound, [
      { provider: "steam", externalId: "730", installed: true },
    ]);

    expect(invoke).toHaveBeenCalledWith("library_install_exists", {
      provider: "steam",
      externalId: "730",
    });
    expect(useAppStore.getState().libraryInstalls.size).toBe(0);
  });

  it("keeps installs that the launcher still reports", async () => {
    storeInstall("steam", "730");
    storeInstall("xbox", "123");
    vi.mocked(invoke).mockResolvedValue(true);

    await forgetUninstalledLibraryInstalls(notFound, [
      { provider: "steam", externalId: "730", installed: true },
      { provider: "xbox", externalId: "123", installed: true },
    ]);

    expect(useAppStore.getState().libraryInstalls.size).toBe(2);
  });

  it("only rechecks after a missing file, and never for Battle.net", async () => {
    storeInstall("steam", "730");

    await forgetUninstalledLibraryInstalls(
      { kind: "spawnFailed", message: "Access denied." },
      [{ provider: "steam", externalId: "730", installed: true }],
    );
    await forgetUninstalledLibraryInstalls(notFound, [
      { provider: "battlenet", externalId: "wow", installed: true },
      { provider: "steam", externalId: "440", installed: false },
    ]);

    expect(invoke).not.toHaveBeenCalled();
    expect(useAppStore.getState().libraryInstalls.size).toBe(1);
  });

  it("keeps the install when the recheck itself fails", async () => {
    storeInstall("steam", "730");
    vi.mocked(invoke).mockRejectedValue(new Error("IPC failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await forgetUninstalledLibraryInstalls(notFound, [
      { provider: "steam", externalId: "730", installed: true },
    ]);

    expect(useAppStore.getState().libraryInstalls.size).toBe(1);
  });
});
