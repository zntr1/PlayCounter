import type {
  AccountReading,
  LibraryAccount,
  LibraryImportEntry,
  LibraryScanResult,
  ScannedLibraryGame,
} from "./types";

/* A launcher account's hours of a game, kept apart from its other accounts'.
   One game never runs on two accounts at once, so the launcher's total is
   their sum (docs/import-accounts-plan.md). */

/** The key of hours read before PlayCounter knew accounts ("Earlier
 *  import"): an entry saved without `accounts` reads as one such reading. */
export const EARLIER_IMPORT = "earlier";

type MergedHours = Pick<
  LibraryImportEntry,
  "providerSeconds" | "providerLastPlayedAt" | "providerHasPlayedEvidence"
> & { accounts?: AccountReading[] };

/** A launcher total read again: the higher number wins, as it always did. */
export function mergeProviderSeconds(
  previous: number | null | undefined,
  incoming: number | null,
) {
  if (incoming === null) return previous ?? null;
  if (previous === null || previous === undefined) return incoming;
  return Math.max(previous, incoming);
}

/** The game's readings: its accounts, or its earlier hours as one. */
export function accountReadings(entry: LibraryImportEntry): AccountReading[] {
  return (
    entry.accounts ?? [
      {
        key: EARLIER_IMPORT,
        name: null,
        seconds: entry.providerSeconds,
        ...(entry.providerLastPlayedAt
          ? { lastPlayedAt: entry.providerLastPlayedAt }
          : {}),
        ...(entry.providerHasPlayedEvidence !== undefined
          ? { hasPlayedEvidence: entry.providerHasPlayedEvidence }
          : {}),
        readAt: entry.lastReadAt,
      },
    ]
  );
}

/** One account's reading of a scanned game. */
export function readingOf(
  account: LibraryAccount,
  read: Pick<
    LibraryImportEntry,
    | "providerSeconds"
    | "providerLastPlayedAt"
    | "providerHasPlayedEvidence"
    | "lastReadAt"
  >,
): AccountReading {
  return {
    key: account.key,
    name: account.name,
    seconds: read.providerSeconds,
    ...(read.providerLastPlayedAt
      ? { lastPlayedAt: read.providerLastPlayedAt }
      : {}),
    ...(read.providerHasPlayedEvidence !== undefined
      ? { hasPlayedEvidence: read.providerHasPlayedEvidence }
      : {}),
    readAt: read.lastReadAt,
  };
}

/**
 * A read merged into the game's entry. A read that names its account updates
 * only that account's hours, and the entry's total is the sum.
 *
 * Earlier hours (saved before accounts were known) go to the first account
 * that reports at least as many: an account's total never shrinks, so one
 * with fewer is another account and counts on top. A partial read, or one
 * without hours, decides nothing about them.
 *
 * A read without an account keeps today's rule for a game without accounts,
 * and never changes the hours of one with accounts: it can't tell whose they
 * are (Check for Matches repeats the stored total).
 */
export function mergeReading(
  previous: LibraryImportEntry | undefined,
  incoming: LibraryImportEntry,
  partialRead = false,
): MergedHours {
  const reading = incoming.accounts?.[0];
  const providerLastPlayedAt = latestDate(
    previous?.providerLastPlayedAt,
    incoming.providerLastPlayedAt,
  );
  const providerHasPlayedEvidence =
    previous?.providerHasPlayedEvidence === true
      ? true
      : incoming.providerHasPlayedEvidence;
  if (!previous?.accounts && !reading) {
    return {
      providerSeconds: mergeProviderSeconds(
        previous?.providerSeconds,
        incoming.providerSeconds,
      ),
      providerLastPlayedAt,
      providerHasPlayedEvidence,
    };
  }
  const unchanged = (): MergedHours => ({
    ...(previous?.accounts ? { accounts: previous.accounts } : {}),
    providerSeconds: previous?.providerSeconds ?? null,
    providerLastPlayedAt,
    providerHasPlayedEvidence,
  });
  if (!reading) return unchanged();

  const readings = previous
    ? accountReadings(previous).map((item) => ({ ...item }))
    : [];
  const own = readings.find((item) => item.key === reading.key);
  const earlier = readings.findIndex((item) => item.key === EARLIER_IMPORT);
  if (own) {
    own.seconds = mergeProviderSeconds(own.seconds, reading.seconds);
    own.name = reading.name ?? own.name;
    setLastPlayed(own, latestDate(own.lastPlayedAt, reading.lastPlayedAt));
    if (reading.hasPlayedEvidence) own.hasPlayedEvidence = true;
    own.readAt = reading.readAt;
  } else if (earlier < 0) {
    readings.push({ ...reading });
  } else if (partialRead || reading.seconds === null) {
    return unchanged();
  } else if (fits(readings[earlier], reading)) {
    const before = readings[earlier];
    readings[earlier] = {
      ...reading,
      seconds: mergeProviderSeconds(before.seconds, reading.seconds),
    };
    setLastPlayed(
      readings[earlier],
      latestDate(before.lastPlayedAt, reading.lastPlayedAt),
    );
    if (before.hasPlayedEvidence) readings[earlier].hasPlayedEvidence = true;
  } else {
    readings.push({ ...reading });
  }
  return {
    accounts: readings,
    providerSeconds: totalSeconds(readings),
    providerLastPlayedAt: readings.reduce(
      (latest, item) => latestDate(latest, item.lastPlayedAt),
      providerLastPlayedAt,
    ),
    providerHasPlayedEvidence: readings.some((item) => item.hasPlayedEvidence)
      ? true
      : providerHasPlayedEvidence,
  };
}

/**
 * What reading a game in My Games again would make of its launcher total:
 * the total after the read, and whether that is new playtime, a higher total
 * than the saved one: more hours on an account, or another account's hours.
 * The importer checks such a game and lists it under "New playtime" (D3,
 * widened by Phil 2026-11-02).
 */
export function readAgain(
  existing: LibraryImportEntry,
  game: Pick<ScannedLibraryGame, "playtimeSeconds">,
  scan?: Pick<LibraryScanResult, "account" | "totalsCutShort">,
) {
  const { accounts: _saved, ...entry } = existing;
  const incoming: LibraryImportEntry = {
    ...entry,
    providerSeconds:
      game.playtimeSeconds === null
        ? null
        : Math.max(0, Math.floor(game.playtimeSeconds)),
  };
  if (scan?.account) incoming.accounts = [readingOf(scan.account, incoming)];
  const merged = mergeReading(existing, incoming, scan?.totalsCutShort);
  return {
    seconds: merged.providerSeconds,
    newPlaytime:
      (merged.providerSeconds ?? 0) > (existing.providerSeconds ?? 0),
  };
}

/** Earlier hours are this account's when it reports at least as many. */
function fits(earlier: AccountReading, reading: AccountReading) {
  return (
    earlier.seconds === null ||
    (reading.seconds !== null && reading.seconds >= earlier.seconds)
  );
}

function totalSeconds(readings: readonly AccountReading[]) {
  const known = readings.filter((item) => item.seconds !== null);
  return known.length === 0
    ? null
    : known.reduce((total, item) => total + item.seconds!, 0);
}

function setLastPlayed(reading: AccountReading, date: string | undefined) {
  if (date) reading.lastPlayedAt = date;
  else delete reading.lastPlayedAt;
}

function latestDate(left: string | undefined, right: string | undefined) {
  const dates = [left, right].filter(
    (date): date is string =>
      Boolean(date) && Number.isFinite(Date.parse(date!)),
  );
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
