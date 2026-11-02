import { getT, appLocale } from "../../i18n";
import { readAgain } from "../../library/accountReadings";
import {
  hasImportableActivity,
  importGroupForGame,
  needsGameChoice,
  showsFileChoice,
  type ImportGroupKey,
} from "../../library/importGroups";
import { rowMatch, type ImportSession } from "../../library/importSession";
import type {
  LibraryImportEntry,
  ResolvedLibraryGame,
  ScannedLibraryGame,
} from "../../library/types";
import { libraryEntryKey } from "../../library/types";
import type { GameMetadata } from "../../store";
import { formatDuration } from "../components";
import { launcherName } from "./importTexts";

const t = getT("import");

/** One scanned game, with everything the review shows about it. */
export type ImportRow = {
  game: ScannedLibraryGame;
  key: string;
  title: string;
  coverUrl?: string;
  /** What the shelf rules use: the game saved in My Games while the game is
   *  there, otherwise the server's answer. */
  resolved?: ResolvedLibraryGame;
  /** "Wrong game?": the game picked instead of the server's match. */
  replacement?: GameMetadata;
  /** The server matched it, so the player can say it's the wrong game. */
  canReplaceMatch: boolean;
  group: ImportGroupKey;
  existing?: LibraryImportEntry;
  /** A game in My Games: its launcher total after importing it again. */
  totalAfterImport?: number | null;
  /** A game in My Games an update would bring new playtime: listed under
   *  "New playtime" and counted as an update. */
  newPlaytime: boolean;
  completed: boolean;
  selectable: boolean;
  needsGame: boolean;
  showsFile: boolean;
};

/** The parts of the import its rows are made from. */
export type ImportRowSource = Pick<
  ImportSession,
  "providerId" | "scan" | "resolved" | "saved" | "replacements" | "completed"
>;

// A game whose row did not change keeps the same row object, so the list only
// redraws the games an import or a pick changed.
const previousRows = new WeakMap<ScannedLibraryGame, ImportRow>();

export function importRows(
  session: ImportRowSource,
  libraryImports: ReadonlyMap<string, LibraryImportEntry>,
  ignoredProcesses: ReadonlySet<string>,
  selectable: ReadonlySet<string>,
): ImportRow[] {
  const { providerId } = session;
  return (session.scan?.games ?? []).map((game) => {
    const key = libraryEntryKey(providerId, game.externalId);
    const existing = libraryImports.get(key);
    const inLibrary = existing !== undefined;
    const resolved = rowMatch(session, game.externalId, inLibrary);
    // Imported in this review, and still in My Games.
    const completed = inLibrary && session.completed.has(game.externalId);
    const replacement = inLibrary
      ? undefined
      : session.replacements[game.externalId];
    const group = importGroupForGame({
      game,
      provider: providerId,
      resolved,
      alreadyImported: inLibrary,
      completed,
      ignoredProcesses,
    });
    const shown = replacement ?? resolved?.game;
    const readNow = existing
      ? readAgain(existing, game, session.scan ?? undefined)
      : undefined;
    return unchangedRow({
      game,
      key,
      title:
        shown?.name ??
        game.name ??
        t("{{provider}} game {{id}}", {
          provider: launcherName(providerId),
          id: game.externalId,
        }),
      coverUrl: shown?.coverUrl || undefined,
      resolved,
      replacement,
      canReplaceMatch:
        !inLibrary &&
        resolved?.status === "resolved" &&
        (group === "ready" || group === "attention"),
      group,
      existing,
      totalAfterImport: readNow?.seconds,
      newPlaytime:
        (readNow?.newPlaytime ?? false) && selectable.has(game.externalId),
      completed,
      selectable: selectable.has(game.externalId),
      needsGame: needsGameChoice(providerId, game, resolved),
      showsFile: showsFileChoice(providerId, game, resolved, ignoredProcesses),
    });
  });
}

function unchangedRow(row: ImportRow) {
  const previous = previousRows.get(row.game);
  if (
    previous &&
    (Object.keys(row) as (keyof ImportRow)[]).every((field) =>
      Object.is(previous[field], row[field]),
    )
  )
    return previous;
  previousRows.set(row.game, row);
  return row;
}

function noImportablePlaytime(game: ScannedLibraryGame) {
  return (
    game.playtimeSeconds !== null &&
    game.playtimeSeconds <= 0 &&
    game.lastPlayedUnix === undefined
  );
}

export function playtimeText(game: ScannedLibraryGame) {
  if (!hasImportableActivity(game) && game.inAccountLibrary)
    return t("Never played");
  if (game.playtimeSeconds === null) return t("Playtime unknown");
  return formatDuration(game.playtimeSeconds, false);
}

export function lastPlayedText(game: ScannedLibraryGame) {
  return game.lastPlayedUnix
    ? new Date(game.lastPlayedUnix * 1000).toLocaleDateString(appLocale())
    : null;
}

/** Why a game can't be imported. */
export function unavailableReason(game: ScannedLibraryGame) {
  return noImportablePlaytime(game)
    ? t("No playtime to import")
    : t("Game details unavailable");
}

/** The launcher total an import again would bring, when it grew: another
 *  account's hours add to it. */
export function playtimeGrowth(row: ImportRow) {
  const before = row.existing?.providerSeconds;
  const after = row.totalAfterImport;
  if (before == null || after == null || after <= before) return null;
  return t("{{before}} → {{after}}", {
    before: formatDuration(before, false),
    after: formatDuration(after, false),
  });
}

/** The one fact a row in the list shows. */
export function rowFact(row: ImportRow, skipped: boolean) {
  if (row.completed) return t("Imported just now");
  switch (row.group) {
    case "attention":
      if (skipped) return t("Skipped for now");
      if (row.needsGame && row.showsFile)
        return t("Pick the game and its file");
      return row.needsGame ? t("Pick the game") : t("Pick the file");
    case "unavailable":
      return unavailableReason(row.game);
    case "imported":
      return playtimeGrowth(row) ?? playtimeText(row.game);
    case "ready": {
      const lastPlayed = lastPlayedText(row.game);
      return row.game.playtimeSeconds === null &&
        lastPlayed &&
        hasImportableActivity(row.game)
        ? t("Last played {{date}}", { date: lastPlayed })
        : playtimeText(row.game);
    }
  }
}
