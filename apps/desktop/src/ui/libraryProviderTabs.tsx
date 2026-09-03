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
  footnote: string;
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
    subtitle: "Imported from your local Steam installation.",
    importCtaLabel: "Import more from Steam",
    statLabels: {
      games: "Steam games",
      lifetime: "Steam lifetime playtime",
      played: "Played on Steam",
      installed: "Installed on this PC",
    },
    footnote:
      "These statistics use only Steam's imported records. A game card still shows PlayCounter's effective playtime: the higher single source per game, never Steam and local sessions added together.",
    emptyTitle: "No Steam games imported yet",
    emptyBody:
      "PlayCounter reads your local Steam installation and imports your games with their Steam playtime. No Steam login and no ownership data leave this PC.",
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
    headline: "Xbox history",
    subtitle: "Imported from Xbox Live after Microsoft sign-in.",
    importCtaLabel: "Import more from Xbox",
    statLabels: {
      games: "Xbox games",
      lifetime: "Known Xbox playtime",
      played: "Played on Xbox",
      installed: "Linked on this PC",
    },
    footnote:
      "Xbox playtime is included only when Xbox Live reports a duration; titles with unknown duration still count as played. Game cards use the higher single source per game, never Xbox and local sessions added together.",
    emptyTitle: "No Xbox games imported yet",
    emptyBody:
      "Sign in with Microsoft in your browser, then review and confirm the recognized Xbox titles before importing. Most title matches need this confirmation. PlayCounter never sees your Microsoft credentials, and the server discards access tokens immediately after this import.",
    firstImportTitle: "No games tracked yet",
    firstImportBody:
      "Bring in your Xbox history by signing in with Microsoft in your browser. Most recognized title matches need your confirmation before import. PlayCounter never sees your password and keeps no access tokens.",
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
