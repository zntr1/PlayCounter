import type { LibraryProviderId } from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { launchErrorKind } from "../gameLaunch";
import { useAppStore } from "../store";

type ImportedInstall = {
  provider: LibraryProviderId;
  externalId: string;
  installed: boolean;
};

/**
 * A saved game file that vanished usually means the game was uninstalled in
 * its launcher. Recheck the game's stored Steam and Xbox installs right away,
 * so Play does not fall back to a launcher that would only offer to reinstall.
 */
export async function forgetUninstalledLibraryInstalls(
  error: unknown,
  imports: readonly ImportedInstall[],
) {
  if (launchErrorKind(error) !== "notFound") return;
  await Promise.all(
    imports
      .filter(
        (entry) =>
          entry.installed &&
          (entry.provider === "steam" || entry.provider === "xbox"),
      )
      .map(async (entry) => {
        try {
          const exists = await invoke<boolean>("library_install_exists", {
            provider: entry.provider,
            externalId: entry.externalId,
          });
          if (!exists) {
            useAppStore
              .getState()
              .removeLibraryInstall(entry.provider, entry.externalId);
          }
        } catch (recheckError) {
          console.warn("library install recheck failed", recheckError);
        }
      }),
  );
}
