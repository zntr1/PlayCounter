import type { BuiltinImportProviderId } from "./importProviders";
import type { KeptLoginService } from "./keptLogins";

/** What a scan reads: the launcher account, or only the games on this PC. */
export type ImportScope = "account" | "installed";

/**
 * What one launcher can do, as data. The importer reads these facts and never
 * asks which launcher it is, so every launcher gets the same screens.
 */
export type ImportProfile = {
  id: BuiltinImportProviderId;
  /** The sign-in PlayCounter keeps for it. Null: everything is read from this PC. */
  login: KeptLoginService | null;
  /**
   * "localAccounts": pick one of the launcher's accounts on this PC (Steam).
   * "account": the signed-in account only (Xbox).
   * "accountOrInstalled": the account, or only the games installed here.
   */
  choice: "localAccounts" | "account" | "accountOrInstalled";
  /**
   * "id": the launcher's ID names the game exactly (Steam AppIDs), so an
   * unknown ID means no game details. "name": the server matches by name, so
   * an unmatched game needs the player to confirm it.
   */
  matchedBy: "id" | "name";
  /** The launcher reports playtime. Battle.net does not. */
  hasPlaytime: boolean;
  /**
   * The scan reads the account and the installs on this PC as two steps, and
   * a complete scan tells which installs are gone (Epic, Battle.net).
   */
  accountAndInstalls: boolean;
  /**
   * Game files are linked to the install folder only, never by name alone
   * (see importPlan.ts), so an installed game needs its file picked when
   * nothing else links it.
   */
  linksFilesPerInstall: boolean;
  /** The sign-in runs in the browser and can be finished with a copied link. */
  copySignInLink: boolean;
  /** Name searches only offer main games and remasters. */
  mainGamesOnlySearch: boolean;
  /** Its missing playtime is explained once before the first scan. */
  playtimeNotice: boolean;
};

const PROFILES: Record<BuiltinImportProviderId, ImportProfile> = {
  steam: {
    id: "steam",
    login: null,
    choice: "localAccounts",
    matchedBy: "id",
    hasPlaytime: true,
    accountAndInstalls: false,
    linksFilesPerInstall: false,
    copySignInLink: false,
    mainGamesOnlySearch: false,
    playtimeNotice: false,
  },
  xbox: {
    id: "xbox",
    login: "xbox",
    choice: "account",
    matchedBy: "name",
    hasPlaytime: true,
    accountAndInstalls: false,
    linksFilesPerInstall: false,
    copySignInLink: true,
    mainGamesOnlySearch: true,
    playtimeNotice: false,
  },
  battlenet: {
    id: "battlenet",
    login: "battlenet",
    choice: "accountOrInstalled",
    matchedBy: "name",
    hasPlaytime: false,
    accountAndInstalls: true,
    linksFilesPerInstall: true,
    copySignInLink: false,
    mainGamesOnlySearch: false,
    playtimeNotice: true,
  },
  epic: {
    id: "epic",
    login: "epic",
    choice: "accountOrInstalled",
    matchedBy: "name",
    hasPlaytime: true,
    accountAndInstalls: true,
    linksFilesPerInstall: false,
    copySignInLink: false,
    mainGamesOnlySearch: false,
    playtimeNotice: false,
  },
};

export function importProfile(id: BuiltinImportProviderId): ImportProfile {
  return PROFILES[id];
}
