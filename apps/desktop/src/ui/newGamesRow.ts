import {
  LIBRARY_PROVIDER_LABELS,
  type LibraryProviderId,
} from "@playcounter/shared";
import { appLocale, getT } from "../i18n";
import type { LibraryImportEntry } from "../library/types";
import { isNewGame, type MyGamesSortValue } from "./myGamesSort";

const t = getT("myGames");

/** An import that brings at least this many new games is one card. */
export const IMPORT_GROUP_MIN_GAMES = 5;

export type NewRowGame = Pick<
  MyGamesSortValue,
  | "name"
  | "addedAt"
  | "sessionCount"
  | "hasLastPlayedEvidence"
  | "activeStartedAt"
> & {
  libraryImports: ReadonlyArray<{
    provider: LibraryProviderId;
    entry: Pick<LibraryImportEntry, "importedAt">;
  }>;
};

/** 5 or more games one launcher brought in on one day. The key names the
 *  launcher and the day, so it stays the same while its games change. */
type ImportEntry<G> = {
  kind: "import";
  key: string;
  provider: LibraryProviderId;
  games: G[];
};

export type NewRowEntry<G> = { kind: "game"; game: G } | ImportEntry<G>;

const addedTime = (game: NewRowGame) => Date.parse(game.addedAt ?? "");

/** The New row's games: the ones with the New badge, newest first. */
export function newRowGames<G extends NewRowGame>(
  games: readonly G[],
  nowMs: number,
): G[] {
  return games
    .filter((game) => isNewGame(game, nowMs))
    .sort(
      (left, right) =>
        addedTime(right) - addedTime(left) ||
        left.name.localeCompare(right.name),
    );
}

function localDay(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** The launcher and day that brought the game in, when an import did: its
 *  first import entry, on the day the game joined the library. */
function importBatch(game: NewRowGame) {
  let first: NewRowGame["libraryImports"][number] | undefined;
  for (const item of game.libraryImports) {
    if (
      !first ||
      Date.parse(item.entry.importedAt) < Date.parse(first.entry.importedAt)
    ) {
      first = item;
    }
  }
  if (!first || !game.addedAt) return null;
  const day = localDay(first.entry.importedAt);
  // Already in the library before this import: the import didn't bring it.
  if (day !== localDay(game.addedAt)) return null;
  return { key: `${first.provider}|${day}`, provider: first.provider };
}

/** The row's cards in order. 5 or more games one launcher brought in on one
 *  day are one card, at the place of its newest game. */
export function newRowEntries<G extends NewRowGame>(
  games: readonly G[],
): NewRowEntry<G>[] {
  const batches = new Map<string, ImportEntry<G>>();
  const entries: NewRowEntry<G>[] = [];
  for (const game of games) {
    const batch = importBatch(game);
    if (!batch) {
      entries.push({ kind: "game", game });
      continue;
    }
    let entry = batches.get(batch.key);
    if (!entry) {
      entry = {
        kind: "import",
        key: batch.key,
        provider: batch.provider,
        games: [],
      };
      batches.set(batch.key, entry);
      entries.push(entry);
    }
    entry.games.push(game);
  }
  return entries.flatMap((entry) =>
    entry.kind === "import" && entry.games.length < IMPORT_GROUP_MIN_GAMES
      ? entry.games.map((game) => ({ kind: "game" as const, game }))
      : [entry],
  );
}

/** The folded row's one line: "Hollow Knight: Silksong, a Steam import of 115
 *  games and 2 more". */
export function newRowSummary(entries: readonly NewRowEntry<NewRowGame>[]) {
  const names = entries.map((entry) =>
    entry.kind === "game"
      ? entry.game.name
      : t("a {{launcher}} import of {{count}} games", {
          launcher: LIBRARY_PROVIDER_LABELS[entry.provider],
          count: entry.games.length,
        }),
  );
  if (names.length <= 3) {
    return new Intl.ListFormat(appLocale(), { type: "conjunction" }).format(
      names,
    );
  }
  return t("{{first}}, {{second}} and {{count}} more", {
    first: names[0],
    second: names[1],
    count: names.length - 2,
  });
}

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "Added today", "Added yesterday", "Added 3 days ago": calendar days. */
export function addedLabel(addedAt: string | undefined, nowMs: number) {
  const addedMs = Date.parse(addedAt ?? "");
  const days = Number.isFinite(addedMs)
    ? Math.max(
        0,
        // Rounded: a day with a clock change is 23 or 25 hours long.
        Math.round((startOfDay(nowMs) - startOfDay(addedMs)) / 86_400_000),
      )
    : 0;
  if (days === 0) return t("Added today");
  if (days === 1) return t("Added yesterday");
  return t("Added {{count}} days ago", { count: days });
}
