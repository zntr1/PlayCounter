import type { Settings } from "@playcounter/shared";

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
const provider = oneOf("steam", "xbox");
const contributionStatus = oneOf("pending", "verified", "rejected");
const contentKind = oneOf("conf", "program", "folder", "rom", "title_id");
const trust = oneOf("recognized", "weak");
const detectionSource = oneOf("window_title", "launch_arguments");
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
    exeName: nonempty,
    startedAt: date,
    endedAt: nullable(date),
    durationSeconds: nullable(nonnegative),
  },
  { ...gameFields, origin: oneOf("manual"), emulator: emulatorContext },
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
  { providerLastPlayedAt: date, linkedExeSources: array(source) },
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
  librarySortKey: oneOf("recent", "playtime", "name", "sessions"),
  libraryShowBadges: boolean,
  libraryShowOriginBadges: boolean,
  libraryShowMatchBadges: boolean,
  libraryHighResCovers: boolean,
  libraryShowStatCards: boolean,
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
export const validateBackupData: Validator = object(
  {},
  {
    installUuid: nullable(uuid),
    contributionOwnerUuid: nullable(uuid),
    settings,
    sessions: array(session),
    exeCache: array(exeEntry),
    gameMetadata: array(game),
    libraryImports: array(libraryImport),
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
