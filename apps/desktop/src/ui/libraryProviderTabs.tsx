import type { LibraryProviderId, Platform } from "@playcounter/shared";
import battleNetIconUrl from "../../../../assets/battlenet/battlenet.svg";
import steamIconUrl from "../../../../assets/steam/Steam_icon_logo.svg";
import xboxIconUrl from "../../../../assets/xbox/xbox-logo.svg";
import type { BuiltinImportProviderId } from "../library/importProviders";

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

export const PROVIDER_TAB_CONFIGS: readonly ProviderTabConfig[] = [
  {
    id: "steam",
    label: "Steam",
    iconUrl: steamIconUrl,
    headline: "Steam library",
    subtitle: "Imported from Steam on this PC.",
    importCtaLabel: "Import more from Steam",
    emptyTitle: "No Steam games imported yet",
    emptyBody:
      "PlayCounter reads Steam on this PC and brings in your games with their Steam playtime. You never have to sign in, and your game list stays on this PC.",
    firstImportCtaLabel: "Import from Steam",
    import: { kind: "builtin", platforms: ["windows"] },
  },
  {
    id: "xbox",
    label: "Xbox",
    iconUrl: xboxIconUrl,
    headline: "Xbox library",
    subtitle: "Imported from your Xbox account.",
    importCtaLabel: "Import more from Xbox",
    emptyTitle: "No Xbox games imported yet",
    emptyBody:
      "Sign in with Microsoft in your browser, then confirm the games PlayCounter recognized. Most of them need your confirmation. PlayCounter never sees your password, and your sign-in is thrown away as soon as the import is done.",
    firstImportCtaLabel: "Import from Xbox",
    import: { kind: "builtin", platforms: ["windows", "macos", "linux"] },
  },
  {
    id: "battlenet",
    label: "Battle.net",
    iconUrl: battleNetIconUrl,
    headline: "Battle.net library",
    subtitle:
      "Installed games imported from this PC. Historical playtime is unavailable.",
    importCtaLabel: "Import more from Battle.net",
    emptyTitle: "No Battle.net games imported yet",
    emptyBody:
      "Add Battle.net games installed on this PC, with their last-played date when available. PlayCounter tracks your future sessions. No sign-in needed.",
    firstImportCtaLabel: "Import from Battle.net",
    import: { kind: "builtin", platforms: ["windows"] },
  },
];

export function providerTabConfig(tab: string) {
  return PROVIDER_TAB_CONFIGS.find((config) => config.id === tab);
}

export function isImportableProviderTabConfig(
  config: ProviderTabConfig | undefined,
): config is ImportableProviderTabConfig {
  return config?.import.kind === "builtin";
}

export function importableProviderTabs(
  platform: Platform,
): ImportableProviderTabConfig[] {
  return PROVIDER_TAB_CONFIGS.filter(
    (config): config is ImportableProviderTabConfig =>
      isImportableProviderTabConfig(config) &&
      config.import.platforms.includes(platform),
  );
}
