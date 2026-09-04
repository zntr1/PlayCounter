import type { LibraryProviderId, Platform } from "@playcounter/shared";
import steamIconUrl from "../../../../assets/steam/Steam_icon_logo.svg";
import xboxIconUrl from "../../../../assets/xbox/xbox-logo.svg";
import type { BuiltinImportProviderId } from "../library/importProviders";

type ProviderTabCopy = {
  label: string;
  iconUrl?: string;
  headline: string;
  subtitle: string;
  importCtaLabel: string;
  statLabels: {
    games: string;
    lifetime: string;
    played: string;
    installed: string;
  };
  emptyTitle: string;
  emptyBody: string;
  firstImportTitle: string;
  firstImportBody: string;
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
    statLabels: {
      games: "Steam games",
      lifetime: "Steam lifetime playtime",
      played: "Played on Steam",
      installed: "Installed on this PC",
    },
    emptyTitle: "No Steam games imported yet",
    emptyBody:
      "PlayCounter reads Steam on this PC and brings in your games with their Steam playtime. You never have to sign in, and your game list stays on this PC.",
    firstImportTitle: "No games tracked yet",
    firstImportBody:
      "PlayCounter adds games automatically as soon as it sees one running. You can also bring your Steam library in right now.",
    firstImportCtaLabel: "Import from Steam",
    import: { kind: "builtin", platforms: ["windows"] },
  },
  {
    id: "xbox",
    label: "Xbox",
    iconUrl: xboxIconUrl,
    headline: "Xbox library",
    subtitle:
      "Imported from your Xbox account.",
    importCtaLabel: "Import more from Xbox",
    statLabels: {
      games: "Xbox games",
      lifetime: "Known Xbox playtime",
      played: "Played on Xbox",
      installed: "Linked on this PC",
    },
    emptyTitle: "No Xbox games imported yet",
    emptyBody:
      "Sign in with Microsoft in your browser, then confirm the games PlayCounter recognized. Most of them need your confirmation. PlayCounter never sees your password, and your sign-in is thrown away as soon as the import is done.",
    firstImportTitle: "No games tracked yet",
    firstImportBody:
      "Bring in your Xbox playtime by signing in with Microsoft in your browser. Most games need your confirmation first. PlayCounter never sees your password and keeps nothing from your sign-in.",
    firstImportCtaLabel: "Import from Xbox",
    import: { kind: "builtin", platforms: ["windows", "macos", "linux"] },
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
