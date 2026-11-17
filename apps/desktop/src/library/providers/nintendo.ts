import type { LocalLibraryProvider } from "../provider";
import { currentPlatform } from "../../platform";
import {
  nintendoScanResult,
  readNintendoAccountLibrary,
  readSavedNintendoGames,
} from "../nintendoAccount";
import { getT } from "../../i18n";

const t = getT("import");

/**
 * The Nintendo Account's played Switch games (and older 3DS / Wii U ones)
 * with Nintendo's playtime. Nothing is installed on this PC, so there are no
 * files and no Play.
 */
export const nintendoProvider: LocalLibraryProvider = {
  id: "nintendo",
  label: "Nintendo",
  accountMode: "none",
  // Kept sign-ins and the sign-in window are Windows-only for now.
  detect: async () => ({
    provider: "nintendo",
    available: currentPlatform() === "windows",
    checkedPaths: [],
  }),
  listAccounts: async () => [],
  scan: async (_accountId, options) => {
    options?.signal?.throwIfAborted();
    options?.onStage?.("account");
    if (options?.savedLoginOnly) {
      const saved = await readSavedNintendoGames();
      if (saved.status !== "valid" || !saved.value)
        throw new Error(t("Sign in to Nintendo to read your games."));
      return nintendoScanResult(saved.value);
    }
    const library = await readNintendoAccountLibrary(options?.signal);
    options?.signal?.throwIfAborted();
    return nintendoScanResult(library);
  },
  launch: async () => {
    // i18n-exempt: never shown, Nintendo games have no Play button
    throw new Error("Nintendo games start on the console.");
  },
};
