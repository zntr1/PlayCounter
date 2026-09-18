import type { Settings } from "@playcounter/shared";
import { isLibraryGridColumns } from "./ui/myGamesPresentation";
import {
  GAME_STATUSES,
  journalKey,
  type GameJournal,
  type PersonalShelf,
} from "./personalLibrary";

type Validator = (value: unknown, path: string) => void;

function invalid(path: string): never {
  throw new Error(
    `The backup contains invalid data at ${path}. No local data was changed.`,
  );
}

function check(test: (value: unknown) => boolean): Validator {
  return (value, path) => {
    if (!test(value)) invalid(path);
  };
}

const string = check((value) => typeof value === "string");
const nonempty = check(
  (value) => typeof value === "string" && value.trim().length > 0,
);
const boolean = check((value) => typeof value === "boolean");
const number = check(
  (value) => typeof value === "number" && Number.isFinite(value),
);
const nonnegative = check(
  (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
);
const integer = check((value) => Number.isSafeInteger(value));
const positiveId = check(
  (value) => Number.isSafeInteger(value) && (value as number) > 0,
);
const date = check(
  (value) => typeof value === "string" && Number.isFinite(Date.parse(value)),
);
const uuid = check(
  (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.trim(),
    ),
);

function oneOf(...values: unknown[]): Validator {
  return check((value) => values.includes(value));
}

function nullable(validate: Validator): Validator {
  return (value, path) => {
    if (value !== null) validate(value, path);
  };
}

function array(validate: Validator): Validator {
  return (value, path) => {
    if (!Array.isArray(value)) invalid(path);
    value.forEach((item, index) => validate(item, `${path}[${index}]`));
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path);
  return value as Record<string, unknown>;
}

function object(
  required: Record<string, Validator>,
  optional: Record<string, Validator> = {},
): Validator {
  return (value, path) => {
    const fields = record(value, path);
    for (const [key, validate] of Object.entries(required))
      validate(fields[key], `${path}.${key}`);
    for (const [key, validate] of Object.entries(optional)) {
      if (fields[key] !== undefined) validate(fields[key], `${path}.${key}`);
    }
  };
}

function dictionary(validate: Validator): Validator {
  return (value, path) => {
    for (const [key, item] of Object.entries(record(value, path)))
      validate(item, `${path}.${key}`);
  };
}

const source = oneOf("igdb", "community", "custom");
const provider = oneOf("steam", "xbox", "battlenet");
const gameStatus = oneOf(...Object.keys(GAME_STATUSES));
const contributionStatus = oneOf("pending", "verified", "rejected");
const contentKind = oneOf("conf", "program", "folder", "rom", "title_id");
const trust = oneOf("recognized", "weak");
const detectionSource = oneOf(
  "window_title",
  "launch_arguments",
  "open_file_handle",
);
const game = object(
  { id: integer, name: nonempty, coverUrl: string, source },
  { igdbId: positiveId, releaseYear: integer },
);
const gameFields = {
  igdbId: positiveId,
  gameName: string,
  coverUrl: string,
  source,
  communitySuggestionId: positiveId,
  communitySuggestionVerified: boolean,
  communitySuggestionStatus: contributionStatus,
  communitySuggestionNote: string,
};
const emulatorContext = object({
  emulatorId: nonempty,
  label: string,
  contentKey: nonempty,
  display: string,
  trust,
});
const session = object(
  {
    id: integer,
    gameId: integer,
    // Emulator and manual sessions may have no executable associated with them.
    exeName: string,
    startedAt: date,
    endedAt: nullable(date),
    durationSeconds: nullable(nonnegative),
  },
  {
    ...gameFields,
    origin: oneOf("manual"),
    emulator: emulatorContext,
    playthroughId: nonempty,
  },
);
const exeEntry = object(
  {
    exeName: nonempty,
    state: oneOf("matched", "unmatched", "blacklisted"),
    lastCheckedAt: date,
  },
  {
    ...gameFields,
    gameId: integer,
    identifierSource: source,
    pendingCommunityGame: game,
    communityUpgradeGame: game,
    dismissedCommunityUpgradeGameId: positiveId,
    dismissedCommunityUpgradeSource: source,
    shareState: oneOf("unshared", "failed"),
    libraryProvider: provider,
    libraryExternalId: nonempty,
    trackedSeconds: nonnegative,
    runningSince: date,
  },
);
const libraryImport = object(
  {
    provider,
    externalId: nonempty,
    igdbId: positiveId,
    gameId: positiveId,
    source: oneOf("igdb", "community"),
    name: nonempty,
    coverUrl: string,
    importedAt: date,
    lastReadAt: date,
    providerSeconds: nullable(nonnegative),
    linkedExeNames: array(nonempty),
  },
  {
    providerLastPlayedAt: date,
    providerHasPlayedEvidence: boolean,
    linkedExeSources: array(source),
  },
);
const emulatorMapping = object(
  {
    contentKey: nonempty,
    emulatorId: nonempty,
    label: string,
    contentKind,
    contentValue: nonempty,
    display: string,
    trust,
    decision: oneOf("game", "ignored"),
    confidence: oneOf("curated", "probable", "user"),
    decidedAt: date,
    lastSeenAt: date,
  },
  {
    gameId: integer,
    igdbId: positiveId,
    gameName: string,
    coverUrl: string,
    source,
    needsConfirmation: boolean,
    shareable: boolean,
    detectionSource,
    share: object(
      {
        status: oneOf("pending", "verified", "rejected", "already_curated"),
        gameId: positiveId,
        submittedAt: date,
      },
      { curatedGameName: string, reviewNote: string },
    ),
  },
);
const observationBase = {
  key: nonempty,
  emulatorId: nonempty,
  label: string,
  hostExeName: nonempty,
  detectedAt: date,
};
const contentObservation = object(
  {
    ...observationBase,
    kind: oneOf("content"),
    contentKind,
    contentValue: nonempty,
    display: string,
    trust,
    shareable: boolean,
    state: oneOf("resolving", "ambiguous", "unknown"),
  },
  {
    detectionSource,
    searchHint: string,
    shareableSearchHint: boolean,
    autoResolve: boolean,
    candidates: array(game),
    lastCheckedAt: date,
    runningSince: date,
    trackedSeconds: nonnegative,
    endedAt: date,
  },
);
const hostNotice = object(
  {
    ...observationBase,
    kind: oneOf("host-notice"),
    reason: oneOf("no-signal", "title-not-parsable"),
  },
  { endedAt: date, dismissedAt: date },
);
const observation: Validator = (value, path) => {
  const fields = record(value, path);
  (fields.kind === "host-notice" ? hostNotice : contentObservation)(
    value,
    path,
  );
};
const counts = object({
  suggested: nonnegative,
  verified: nonnegative,
  pending: nonnegative,
  rejected: nonnegative,
});
const milestone = object(
  {
    id: nonempty,
    kind: oneOf(
      "milestone-total",
      "milestone-month",
      "milestone-game",
      "milestone-streak",
      "milestone-verified",
      "milestone-emulator",
    ),
  },
  // Legacy backfilled awards receive their date and title during hydration.
  {
    title: string,
    coverUrl: string,
    awardedAt: date,
    backfilled: boolean,
    aliasIds: array(nonempty),
  },
);

const settings = object({}, {
  showWindowHotkey: nullable(string),
  currentSessionHotkey: nullable(string),
  launchOnStartup: boolean,
  showDurationDays: boolean,
  libraryCardSize: oneOf("grid", "large", "list"),
  libraryGridColumns: nullable(check(isLibraryGridColumns)),
  librarySortKey: oneOf("recent", "playtime", "name", "sessions"),
  libraryShowBadges: boolean,
  libraryShowOriginBadges: boolean,
  libraryShowMatchBadges: boolean,
  libraryShowStatusBadges: boolean,
  libraryShowNoteBadges: boolean,
  libraryHighResCovers: boolean,
  libraryShowStatCards: boolean,
  libraryShowShelves: boolean,
  libraryHideEmptyProviderTabs: boolean,
  libraryStatCards: array(
    oneOf(
      "games",
      "playtime",
      "tracked",
      "recent",
      "sessions",
      "played",
      "unplayed",
      "installed",
      "emulator",
    ),
  ),
  autoShareIgnoredProcesses: boolean,
  pollingIntervalSeconds: nonnegative,
  unmatchedRetryDays: nonnegative,
  apiEndpoint: nonempty,
  verboseLogs: boolean,
  theme: oneOf("dark", "light"),
  accentColor: nullable(string),
  emulatorDetection: boolean,
  emulatorContentLookup: boolean,
  ignoredEmulatorIds: array(nonempty),
  desktopOverlaysEnabled: boolean,
  overlayMonitor: string,
  overlayFirstDetections: boolean,
  overlaySessionStarts: boolean,
  overlayPlaythroughNames: boolean,
  overlayGameNotes: boolean,
  overlaySessionSummaries: boolean,
  overlayMilestones: boolean,
  overlayActionRequired: boolean,
  overlayDiscoveries: boolean,
  rememberLaunchPaths: boolean,
  gameLaunchingEnabled: boolean,
  controllerNavigationEnabled: boolean,
} satisfies Record<keyof Settings, Validator>);

/** Validate only transfer data, after machine-local/transient fields are removed.
 * Missing fields remain valid for older backups; present fields must be safe
 * for the tracker and views to consume. This runs before any import side effect.
 */
const validateBackupShape: Validator = object(
  {},
  {
    installUuid: nullable(uuid),
    contributionOwnerUuid: nullable(uuid),
    settings,
    sessions: array(session),
    gameJournals: dictionary(
      object({
        game: object(
          { gameId: integer },
          {
            source: nullable(source),
            igdbId: positiveId,
            gameName: string,
            coverUrl: string,
          },
        ),
        note: string,
        favorite: boolean,
        status: nullable(gameStatus),
        shelfIds: array(nonempty),
        activePlaythroughId: nullable(nonempty),
        playthroughs: array(
          object({
            id: nonempty,
            name: nonempty,
            note: string,
            createdAt: date,
            completedAt: nullable(date),
          }),
        ),
      }),
    ),
    personalShelves: array(
      object(
        { id: nonempty, name: nonempty },
        {
          filters: object(
            {},
            {
              search: string,
              source: oneOf("all", "steam", "xbox", "battlenet", "unimported"),
              status: oneOf(...Object.keys(GAME_STATUSES), "none"),
              favorite: boolean,
              installed: boolean,
              played: oneOf("played", "unplayed"),
              emulator: oneOf("dosbox", "dolphin", "pcsx2"),
              lastPlayedDays: positiveId,
            },
          ),
        },
      ),
    ),
    archivedPlaythroughSeconds: dictionary(nonnegative),
    exeCache: array(exeEntry),
    gameMetadata: array(game),
    libraryImports: array(libraryImport),
    playcounterLibrary: array(
      object(
        {
          gameId: positiveId,
          igdbId: positiveId,
          source: oneOf("igdb", "community"),
          name: nonempty,
          coverUrl: string,
          addedAt: date,
        },
        {
          lastPlayedAt: date,
          aliases: array(
            object({ gameId: integer }, { source: nullable(source) }),
          ),
        },
      ),
    ),
    emulatorMappings: array(emulatorMapping),
    emulatorObservations: array(observation),
    knownEmulators: array(
      object({
        emulatorId: nonempty,
        label: string,
        firstSeenAt: date,
        lastSeenAt: date,
        hostExeNames: array(nonempty),
      }),
    ),
    seenContributionStatus: dictionary(contributionStatus),
    contributionCounts: counts,
    emulatorContributionCounts: counts,
    awardedMilestones: array(milestone),
    awardedMilestoneIds: array(nonempty),
    milestonesInitializedAt: nullable(date),
    archivedSeconds: nonnegative,
    archivedGameSeconds: dictionary(nonnegative),
    playtimeAdjustments: dictionary(number),
    collapsedSections: array(string),
    autoDetectedGameKeys: array(nonempty),
    tours: object({
      version: integer,
      welcomeVersion: integer,
      completed: dictionary(integer),
    }),
  },
);

export const validateBackupData: Validator = (value, path) => {
  validateBackupShape(value, path);
  const data = record(value, path);
  const journals = (data.gameJournals ?? {}) as Record<string, GameJournal>;
  const shelves = (data.personalShelves ?? []) as PersonalShelf[];
  const shelfIds = new Set<string>();
  for (const shelf of shelves) {
    if (shelfIds.has(shelf.id))
      invalid(`${path}.personalShelves (duplicate id)`);
    shelfIds.add(shelf.id);
  }
  const playthroughIds = new Set<string>();
  for (const [key, journal] of Object.entries(journals)) {
    if (journalKey(journal.game) !== key)
      invalid(`${path}.gameJournals.${key}.game`);
    for (const playthrough of journal.playthroughs) {
      if (playthroughIds.has(playthrough.id))
        invalid(`${path}.gameJournals.${key}.playthroughs (duplicate id)`);
      playthroughIds.add(playthrough.id);
    }
    if (
      journal.activePlaythroughId &&
      !journal.playthroughs.some(
        (p) => p.id === journal.activePlaythroughId && !p.completedAt,
      )
    )
      invalid(`${path}.gameJournals.${key}.activePlaythroughId`);
    if (journal.shelfIds.some((id) => !shelfIds.has(id)))
      invalid(`${path}.gameJournals.${key}.shelfIds`);
  }
  for (const [index, session] of (
    (data.sessions ?? []) as Array<{ playthroughId?: string }>
  ).entries()) {
    if (session.playthroughId && !playthroughIds.has(session.playthroughId))
      invalid(`${path}.sessions[${index}].playthroughId`);
  }
  for (const id of Object.keys(
    (data.archivedPlaythroughSeconds ?? {}) as object,
  )) {
    if (!playthroughIds.has(id))
      invalid(`${path}.archivedPlaythroughSeconds.${id}`);
  }
};
