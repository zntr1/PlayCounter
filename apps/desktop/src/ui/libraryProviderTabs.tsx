import type { LibraryProviderId, Platform } from "@playcounter/shared";
import battleNetIconUrl from "../../../../assets/battlenet/battlenet.svg";
import epicIconUrl from "../../../../assets/epic/epic.svg";
import steamIconUrl from "../../../../assets/steam/Steam_icon_logo.svg";
import xboxIconUrl from "../../../../assets/xbox/xbox-logo.svg";
import type { BuiltinImportProviderId } from "../library/importProviders";
import { getT } from "../i18n";

const t = getT("myGames");

type ProviderTabCopy = {
  label: string;
  iconUrl?: string;
  headline: string;
  subtitle: string;
  importCtaLabel: string;
  emptyTitle: string;
  emptyBody: string;
  firstImportCtaLabel: string;
};

export type ProviderTabConfig =
  | (ProviderTabCopy & {
      id: BuiltinImportProviderId;
      import: { kind: "builtin"; platforms: readonly Platform[] };
    })
  | (ProviderTabCopy & {
      id: LibraryProviderId;
      import: { kind: "none" };
    });

export type ImportableProviderTabConfig = Extract<
  ProviderTabConfig,
  { import: { kind: "builtin" } }
>;

export function providerTabConfigs(): readonly ProviderTabConfig[] {
  return [
    {
      id: "steam",
      label: "Steam",
      iconUrl: steamIconUrl,
      headline: t("Steam library"),
      subtitle: t("Imported from Steam on this PC."),
      importCtaLabel: t("Import more from Steam"),
      emptyTitle: t("No Steam games imported yet"),
      emptyBody: t(
        "PlayCounter reads Steam on this PC and brings in your games with their Steam playtime. You never have to sign in, and your game list stays on this PC.",
      ),
      firstImportCtaLabel: t("Import from Steam"),
      import: { kind: "builtin", platforms: ["windows"] },
    },
    {
      id: "xbox",
      label: "Xbox",
      iconUrl: xboxIconUrl,
      headline: t("Xbox library"),
      subtitle: t("Imported from your Xbox account."),
      importCtaLabel: t("Import more from Xbox"),
      emptyTitle: t("No Xbox games imported yet"),
      emptyBody: t(
        "Sign in with Microsoft in your browser, then confirm the games PlayCounter recognized. Most of them need your confirmation. PlayCounter never sees your password, and your sign-in is thrown away as soon as the import is done.",
      ),
      firstImportCtaLabel: t("Import from Xbox"),
      import: { kind: "builtin", platforms: ["windows", "macos", "linux"] },
    },
    {
      id: "battlenet",
      label: "Battle.net",
      iconUrl: battleNetIconUrl,
      headline: t("Battle.net library"),
      subtitle: t("Games imported from your Battle.net account and this PC."),
      importCtaLabel: t("Import more from Battle.net"),
      emptyTitle: t("No Battle.net games imported yet"),
      emptyBody: t(
        "Sign in to include games from your Battle.net account, or scan installed games without signing in. PlayCounter tracks your future sessions.",
      ),
      firstImportCtaLabel: t("Import from Battle.net"),
      import: { kind: "builtin", platforms: ["windows"] },
    },
    {
      id: "epic",
      label: "Epic Games",
      iconUrl: epicIconUrl,
      headline: t("Epic Games library"),
      subtitle: t("Games imported from your Epic Games account and this PC."),
      importCtaLabel: t("Import more from Epic Games"),
      emptyTitle: t("No Epic Games games imported yet"),
      emptyBody: t(
        "Sign in to bring in your Epic Games library with its playtime, or scan installed games without signing in. PlayCounter tracks your future sessions.",
      ),
      firstImportCtaLabel: t("Import from Epic Games"),
      import: { kind: "builtin", platforms: ["windows"] },
    },
  ];
}

export function providerTabConfig(tab: string) {
  return providerTabConfigs().find((config) => config.id === tab);
}

export function isImportableProviderTabConfig(
  config: ProviderTabConfig | undefined,
): config is ImportableProviderTabConfig {
  return config?.import.kind === "builtin";
}

export function importableProviderTabs(
  platform: Platform,
): ImportableProviderTabConfig[] {
  return providerTabConfigs().filter(
    (config): config is ImportableProviderTabConfig =>
      isImportableProviderTabConfig(config) &&
      config.import.platforms.includes(platform),
  );
}
