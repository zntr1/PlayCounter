import { createDefaultSettings } from "./store";

// Saved data is only written by PlayCounter, but one release with a bug can
// write one malformed value. Loading treats a field of the wrong type like a
// missing field and skips malformed list entries, so a single bad value never
// stops PlayCounter from loading everything else.

const OBJECT_LISTS = [
  "exeCache",
  "launchTargets",
  "manualLaunchTargets",
  "emulatorAutoBinaries",
  "emulatorManualBinaries",
  "emulatorAutoLaunchTargets",
  "emulatorManualLaunchTargets",
  "emulatorLaunchCandidates",
  "gameMetadata",
  "libraryImports",
  "playcounterLibrary",
  "libraryInstalls",
  "scopedExeLinks",
  "ignoredExeFolders",
  "sessions",
  "activeSessions",
  "ambiguousMatches",
  "emulatorMappings",
  "emulatorObservations",
  "knownEmulators",
  "notifications",
  "awardedMilestones",
  "personalShelves",
];

const STRING_LISTS = [
  "blacklist",
  "awardedMilestoneIds",
  "collapsedSections",
  "autoDetectedGameKeys",
];

const OBJECTS = [
  "settings",
  "gameJournals",
  "archivedPlaythroughSeconds",
  "archivedGameSeconds",
  "playtimeAdjustments",
  "seenContributionStatus",
  "contributionCounts",
  "emulatorContributionCounts",
  "customHeroArt",
  "tours",
  "activeSession",
];

// Fields a loaded entry is read through before any other validation.
const REQUIRED_STRINGS: Record<string, string[]> = {
  exeCache: ["exeName"],
  sessions: ["exeName", "startedAt"],
  activeSessions: ["exeName", "startedAt"],
  ambiguousMatches: ["exeName"],
  ignoredExeFolders: ["exeName", "pathPrefix", "ignoredAt"],
  emulatorMappings: ["contentKey", "emulatorId"],
  knownEmulators: ["emulatorId"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown, list: string) {
  return (
    isObject(value) &&
    (REQUIRED_STRINGS[list] ?? []).every(
      (field) => typeof value[field] === "string",
    )
  );
}

export function sanitizePersistedShape(
  value: unknown,
): Record<string, unknown> {
  if (!isObject(value)) return {};
  const record = { ...value };
  for (const key of OBJECT_LISTS) {
    if (!(key in record)) continue;
    const list = record[key];
    if (!Array.isArray(list)) {
      delete record[key];
      continue;
    }
    record[key] = list.filter((entry) => isEntry(entry, key));
  }
  for (const key of STRING_LISTS) {
    if (!(key in record)) continue;
    const list = record[key];
    if (Array.isArray(list)) {
      record[key] = list.filter((entry) => typeof entry === "string");
    } else {
      delete record[key];
    }
  }
  for (const key of OBJECTS) {
    if (key in record && !isObject(record[key])) delete record[key];
  }
  if (isObject(record.settings)) {
    record.settings = sanitizeSettings(record.settings);
  }
  if (isObject(record.gameJournals)) {
    record.gameJournals = Object.fromEntries(
      Object.entries(record.gameJournals).filter(([, journal]) =>
        isObject(journal),
      ),
    );
  }
  if (
    "archivedSeconds" in record &&
    (typeof record.archivedSeconds !== "number" ||
      !Number.isFinite(record.archivedSeconds))
  ) {
    delete record.archivedSeconds;
  }
  // Older versions kept a single running session.
  if (
    "activeSession" in record &&
    !isEntry(record.activeSession, "activeSessions")
  ) {
    delete record.activeSession;
  }
  return record;
}

// A setting of the wrong type falls back to its default. Settings without a
// fixed type, such as optional ones or ones older versions used, stay as they
// are for the code that migrates them.
function sanitizeSettings(settings: Record<string, unknown>) {
  const defaults = createDefaultSettings();
  return Object.fromEntries(
    Object.entries(settings).filter(([key, value]) => {
      const fallback: unknown = Reflect.get(defaults, key);
      if (fallback === null || fallback === undefined) return true;
      if (Array.isArray(fallback)) return Array.isArray(value);
      if (typeof fallback === "number") {
        return typeof value === "number" && Number.isFinite(value);
      }
      if (typeof fallback === "object") return isObject(value);
      return typeof value === typeof fallback;
    }),
  );
}
