import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import { getT } from "../../i18n";
import { importProfile } from "../../library/importProfiles";
import type { BuiltinImportProviderId } from "../../library/importProviders";
import type { ImportStage } from "../../library/importSession";
import { currentPlatform } from "../../platform";

const t = getT("import");

/* The few texts that name a launcher's own facts. Built while rendering, so
   a language switch updates them. Everything else on the import screens is
   one text for every launcher. */

export function launcherName(id: BuiltinImportProviderId) {
  return LIBRARY_PROVIDER_LABELS[id];
}

/** What the launcher calls its game IDs, shown in the game's details. */
export function launcherIdLabel(id: BuiltinImportProviderId) {
  switch (id) {
    case "steam":
      return t("AppID");
    case "xbox":
      return t("Xbox title ID");
    case "battlenet":
      return t("Product");
    case "epic":
      return t("App name");
    case "gog":
      return t("GOG ID");
  }
}

/** The one note on the launcher card. */
export function launcherNote(id: BuiltinImportProviderId) {
  const providerName = launcherName(id);
  switch (id) {
    case "steam":
      return t(
        "Your game list stays on this PC. PlayCounter only looks up the Steam AppIDs it found, to get game names and covers.",
      );
    case "xbox":
      // Only Windows keeps sign-ins (see keptLogins).
      return currentPlatform() === "windows"
        ? t(
            "Microsoft sign-in opens in your browser. PlayCounter never sees your password and keeps you signed in on this PC, so the next import needs no sign-in.",
          )
        : t(
            "Microsoft sign-in opens in your browser. PlayCounter never sees your password, and your sign-in is thrown away as soon as the import is done.",
          );
    case "battlenet":
    case "epic":
    case "gog":
      return t(
        "Sign-in opens in a separate {{providerName}} window. PlayCounter keeps you signed in on this PC until you sign out.",
        { providerName },
      );
  }
}

/** Said while the launcher is looked for on this PC. */
export function launcherDetectingText(id: BuiltinImportProviderId) {
  return id === "xbox"
    ? t("Preparing the Xbox import…")
    : t("Looking for {{providerName}} on this PC…", {
        providerName: launcherName(id),
      });
}

/** Why the launcher can't be imported here. */
export function launcherMissingText(id: BuiltinImportProviderId) {
  switch (id) {
    case "steam":
      return t(
        "PlayCounter looks for Steam in the Windows registry and in the usual install folders. You never have to sign in to Steam.",
      );
    case "xbox":
      return t(
        "The Xbox import is unavailable right now. Check your connection and try again.",
      );
    case "battlenet":
    case "epic":
    case "gog":
      return t("{{providerName}} import is available on Windows.", {
        providerName: launcherName(id),
      });
  }
}

/** Said when a launcher that lists accounts lists none. */
export function launcherNoAccountsText(id: BuiltinImportProviderId) {
  return id === "steam"
    ? t(
        "Steam is installed, but PlayCounter could not read any account data. Start Steam, sign in once, then come back here.",
      )
    : t("The Xbox import could not be prepared. Please try again later.");
}

/** The loader's text: the step the player waits on. */
export function importStageText(
  id: BuiltinImportProviderId,
  stage: ImportStage | null,
  waitingForServer: boolean,
) {
  const providerName = launcherName(id);
  if (waitingForServer)
    return t("The server is busy. Your import will continue automatically…");
  const browserSignIn = importProfile(id).copySignInLink;
  switch (stage) {
    case "connecting":
      return t("Connecting to Xbox…");
    case "signin":
      return browserSignIn
        ? t("Waiting for Microsoft sign-in…")
        : t(
            "Complete the {{providerName}} sign-in in the window that opened…",
            { providerName },
          );
    case "account":
      return browserSignIn
        ? t("Reading your Xbox history…")
        : t("Reading your {{providerName}} library…", { providerName });
    case "installs":
      return t("Looking for {{providerName}} games on this PC…", {
        providerName,
      });
    case "matching":
      return t("Matching your games…");
    case "local":
    default:
      return t("Scanning your {{providerName}} library…", { providerName });
  }
}
