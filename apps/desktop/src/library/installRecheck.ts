import type { LibraryProviderId } from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { launchErrorKind, type LaunchPathStatus } from "../gameLaunch";
import { useAppStore } from "../store";
import type { LibraryInstallEntry } from "./types";

type InstallReport = {
  provider: LibraryProviderId;
  externalId: string;
  status: LaunchPathStatus;
};

/**
 * A saved game file that vanished usually means the game was uninstalled in
 * its launcher. Recheck the game's stored launcher installs right away, so
 * Play does not fall back to a launcher that would only offer to reinstall.
 */
export async function forgetUninstalledLibraryInstalls(
  error: unknown,
  imports: readonly { install?: LibraryInstallEntry }[],
) {
  if (launchErrorKind(error) !== "notFound") return;
  const installs = imports.flatMap((entry) =>
    entry.install ? [entry.install] : [],
  );
  if (installs.length === 0) return;
  try {
    const reports = await invoke<InstallReport[]>("library_verify_installs", {
      installs: installs.map(({ provider, externalId, installPath }) => ({
        provider,
        externalId,
        installPath,
      })),
    });
    for (const report of reports) {
      // `unreadable` (for example an unplugged drive) proves nothing.
      if (report.status !== "missing") continue;
      useAppStore
        .getState()
        .removeLibraryInstall(report.provider, report.externalId);
    }
  } catch (recheckError) {
    console.warn("library install recheck failed", recheckError);
  }
}
