import type { LocalLibraryProvider } from "../provider";
import { currentPlatform } from "../../platform";
import {
  playStationScanResult,
  readPlayStationAccountLibrary,
  readSavedPlayStationGames,
} from "../playstationAccount";
import { getT } from "../../i18n";

const t = getT("import");

/**
 * The PlayStation account's played PS4 and PS5 games with Sony's playtime.
 * Nothing is installed on this PC, so there are no files and no Play.
 */
export const playStationProvider: LocalLibraryProvider = {
  id: "playstation",
  label: "PlayStation",
  accountMode: "none",
  // Kept sign-ins and the sign-in window are Windows-only for now.
  detect: async () => ({
    provider: "playstation",
    available: currentPlatform() === "windows",
    checkedPaths: [],
  }),
  listAccounts: async () => [],
  scan: async (_accountId, options) => {
    options?.signal?.throwIfAborted();
    options?.onStage?.("account");
    if (options?.savedLoginOnly) {
      const saved = await readSavedPlayStationGames();
      if (saved.status !== "valid" || !saved.value)
        throw new Error(t("Sign in to PlayStation to read your games."));
      return playStationScanResult(saved.value);
    }
    const account = await readPlayStationAccountLibrary(options?.signal);
    options?.signal?.throwIfAborted();
    return playStationScanResult(account);
  },
  launch: async () => {
    // i18n-exempt: never shown, PlayStation games have no Play button
    throw new Error("PlayStation games start on the console.");
  },
};
