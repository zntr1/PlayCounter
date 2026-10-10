import type {
  GameSource,
  LibraryProviderId,
  LibraryStatCardId,
  Settings,
} from "@playcounter/shared";
import { providerFloorKey } from "../library/playtimeFloor";
import type { LibraryTabKind } from "./libraryTabs";
import { hasUnknownProviderPlaytime } from "./providerLibrary";
import { getT } from "../i18n";

const t = getT("myGames");

/* My Games summary ───────────────────────────────────────────────────────────
   Every tab used to hard-code its own four cards, which is how the Steam tab
   ended up saying "214 games" next to "played on Steam: 214". One catalog now
   describes every card once, each tab kind picks the cards that mean something
   there, and the user picks which of those they actually want to see. */

export type LibraryStatGame = {
  gameId: number;
  igdbId?: number;
  source?: GameSource | null;
  totalSeconds: number;
  recordedSeconds: number;
  adjustmentSeconds: number;
  sessionCount: number;
  lastPlayedAt: string;
  hasLastPlayedEvidence?: boolean;
  emulatorIds: readonly string[];
  libraryImports: readonly {
    provider: LibraryProviderId;
    installed: boolean;
    entry?: {
      providerSeconds: number | null;
      providerHasPlayedEvidence?: boolean;
      providerLastPlayedAt?: string;
    };
  }[];
};

export type LibraryStatMetrics = {
  games: number;
  playtimeSeconds: number;
  trackedSeconds: number;
  played: number;
  unplayed: number;
  installed: number;
  sessions: number;
  recent: number;
  emulator: number;
};

export type LibraryStatFormat = "count" | "duration";
export type LibraryStatDefinition = {
  id: LibraryStatCardId;
  /** Tabs where the number is not a tautology or a constant zero. */
  kinds: readonly LibraryTabKind[];
  metric: keyof LibraryStatMetrics;
  format: LibraryStatFormat;
  label: (context: LibraryStatLabelContext) => string;
  /** One or two words for the summary chip beside the library title, where
   *  the tab name already says which library these numbers describe. */
  short: string;
  help: string;
};

export type LibraryStatLabelContext = {
  kind: LibraryTabKind;
  providerLabel?: string;
};

export type LibraryStatCard = {
  id: LibraryStatCardId;
  label: string;
  short: string;
  help: string;
  value: number;
  format: LibraryStatFormat;
};

export const RECENT_PLAY_WINDOW_DAYS = 30;
const RECENT_PLAY_WINDOW_MS = RECENT_PLAY_WINDOW_DAYS * 86_400_000;

const ALL_KINDS = ["all", "provider", "unimported"] as const;

export function libraryStatDefinitions(): readonly LibraryStatDefinition[] {
  return [
    {
      id: "games",
      kinds: ALL_KINDS,
      metric: "games",
      format: "count",
      label: ({ providerLabel }) =>
        providerLabel
          ? t("{{provider}} games", { provider: providerLabel })
          : t("Games"),
      short: t("games"),
      help: t("How many games this tab holds."),
    },
    {
      id: "playtime",
      kinds: ALL_KINDS,
      metric: "playtimeSeconds",
      format: "duration",
      label: ({ kind, providerLabel }) =>
        providerLabel === "Battle.net"
          ? t("Tracked playtime")
          : providerLabel
            ? t("{{provider}} lifetime playtime", { provider: providerLabel })
            : kind === "unimported"
              ? t("Tracked playtime")
              : t("Total playtime"),
      short: t("played"),
      help: t("All playtime this tab adds up to."),
    },
    {
      id: "tracked",
      kinds: ["provider"],
      metric: "trackedSeconds",
      format: "duration",
      label: () => t("Watched by PlayCounter"),
      short: t("watched"),
      help: t("How much of that playtime PlayCounter recorded itself."),
    },
    {
      id: "recent",
      kinds: ALL_KINDS,
      metric: "recent",
      format: "count",
      label: () =>
        t("Played in {{days}} days", {
          days: RECENT_PLAY_WINDOW_DAYS,
        }),
      short: t("in {{days}} days", {
        days: RECENT_PLAY_WINDOW_DAYS,
      }),
      help: t("Games you played in the last {{days}} days.", {
        days: RECENT_PLAY_WINDOW_DAYS,
      }),
    },
    {
      id: "sessions",
      kinds: ALL_KINDS,
      metric: "sessions",
      format: "count",
      label: () => t("Sessions tracked"),
      short: t("sessions"),
      help: t("Play sessions PlayCounter recorded for these games."),
    },
    {
      id: "played",
      kinds: ALL_KINDS,
      metric: "played",
      format: "count",
      label: ({ providerLabel }) =>
        providerLabel === "Battle.net"
          ? t("With play activity")
          : providerLabel
            ? t("Played on {{provider}}", { provider: providerLabel })
            : t("With play activity"),
      short: t("with activity"),
      help: t("Games with playtime or activity reported by their source."),
    },
    {
      id: "unplayed",
      kinds: ALL_KINDS,
      metric: "unplayed",
      format: "count",
      label: ({ providerLabel }) =>
        !providerLabel || providerLabel === "Battle.net"
          ? t("No play activity found")
          : t("Never played"),
      short: t("never played"),
      help: t(
        "Games without playtime or activity reported by their source. Missing Battle.net history does not prove a game was never played.",
      ),
    },
    {
      id: "installed",
      kinds: ["provider"],
      metric: "installed",
      format: "count",
      label: () => t("Installed on this PC"),
      short: t("installed"),
      help: t("Games this launcher currently has installed here."),
    },
    {
      id: "emulator",
      kinds: ["all", "unimported"],
      metric: "emulator",
      format: "count",
      label: () => t("Through an emulator"),
      short: t("emulated"),
      help: t("Games PlayCounter saw running inside an emulator."),
    },
  ];
}

export const DEFAULT_LIBRARY_STAT_CARD_IDS: readonly LibraryStatCardId[] = [
  "games",
  "playtime",
  "recent",
  "sessions",
];

export function libraryStatDefinitionsForKind(kind: LibraryTabKind) {
  return libraryStatDefinitions().filter((definition) =>
    definition.kinds.includes(kind),
  );
}

export function resolveLibraryStatCardIds(
  settings: Pick<Partial<Settings>, "libraryStatCards"> | undefined,
): LibraryStatCardId[] {
  const requested = settings?.libraryStatCards;
  if (!Array.isArray(requested)) return [...DEFAULT_LIBRARY_STAT_CARD_IDS];
  // An empty list is a real choice: the user turned every card off.
  return libraryStatDefinitions()
    .filter((definition) => requested.includes(definition.id))
    .map((definition) => definition.id);
}

export function toggleLibraryStatCardIds(
  current: readonly LibraryStatCardId[],
  id: LibraryStatCardId,
  enabled: boolean,
): LibraryStatCardId[] {
  return libraryStatDefinitions()
    .filter((definition) =>
      definition.id === id ? enabled : current.includes(definition.id),
    )
    .map((definition) => definition.id);
}

function normalizedSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function summarizeLibraryStats(
  games: readonly LibraryStatGame[],
  options: {
    /** Set on a launcher tab: playtime then means that launcher's lifetime. */
    provider?: LibraryProviderId | null;
    providerFloorSeconds?: Readonly<Record<string, number>>;
    nowMs: number;
  },
): LibraryStatMetrics {
  const metrics: LibraryStatMetrics = {
    games: 0,
    playtimeSeconds: 0,
    trackedSeconds: 0,
    played: 0,
    unplayed: 0,
    installed: 0,
    sessions: 0,
    recent: 0,
    emulator: 0,
  };
  const provider = options.provider ?? null;
  const floors = options.providerFloorSeconds ?? {};
  const recentSince = options.nowMs - RECENT_PLAY_WINDOW_MS;

  for (const game of games) {
    const providerEntries = provider
      ? game.libraryImports.filter((entry) => entry.provider === provider)
      : [];
    if (provider && providerEntries.length === 0) continue;

    const seconds =
      provider === "battlenet"
        ? normalizedSeconds(game.recordedSeconds + game.adjustmentSeconds)
        : provider
          ? normalizedSeconds(floors[providerFloorKey(game)] ?? 0)
          : normalizedSeconds(game.totalSeconds);
    // Xbox can report a game without a playtime figure. That is still evidence
    // the game was played, so it must not count as "never played". An Epic
    // game found only on this PC has no playtime and no such evidence.
    const unknownPlaytime =
      provider !== null &&
      provider !== "battlenet" &&
      hasUnknownProviderPlaytime(
        providerEntries.filter(
          (item) => item.entry?.providerHasPlayedEvidence !== false,
        ),
        provider,
      );
    const battleNetActivity =
      (provider === null || provider === "battlenet") &&
      game.libraryImports.some(
        (item) =>
          item.provider === "battlenet" &&
          (item.entry?.providerHasPlayedEvidence === true ||
            Boolean(item.entry?.providerLastPlayedAt)),
      );
    const played =
      seconds > 0 ||
      unknownPlaytime ||
      battleNetActivity ||
      (provider === "battlenet" && game.sessionCount > 0);
    const lastPlayedAt = Date.parse(game.lastPlayedAt);

    metrics.games += 1;
    metrics.playtimeSeconds += seconds;
    metrics.trackedSeconds += normalizedSeconds(
      game.recordedSeconds + game.adjustmentSeconds,
    );
    metrics.sessions += Number.isFinite(game.sessionCount)
      ? Math.max(0, Math.trunc(game.sessionCount))
      : 0;
    if (played) metrics.played += 1;
    else metrics.unplayed += 1;
    if (providerEntries.some((entry) => entry.installed)) {
      metrics.installed += 1;
    }
    if (game.emulatorIds.length > 0) metrics.emulator += 1;
    // Imported play dates count too; a metadata/import timestamp alone does not.
    if (
      (game.hasLastPlayedEvidence || game.sessionCount > 0) &&
      Number.isFinite(lastPlayedAt) &&
      lastPlayedAt >= recentSince
    ) {
      metrics.recent += 1;
    }
  }

  return metrics;
}

export function libraryStatCards(
  ids: readonly LibraryStatCardId[],
  metrics: LibraryStatMetrics,
  context: LibraryStatLabelContext,
): LibraryStatCard[] {
  return libraryStatDefinitionsForKind(context.kind)
    .filter((definition) => ids.includes(definition.id))
    .map((definition) => ({
      id: definition.id,
      label: definition.label(context),
      short: definition.short,
      help: definition.help,
      value: metrics[definition.metric],
      format: definition.format,
    }));
}
