import type { GameSource } from "@playcounter/shared";
import type { LibraryExecutableMatch } from "../library/recheck";
import {
  libraryEntryKey,
  type LibraryImportEntry,
  type LibraryInstallEntry,
} from "../library/types";
import {
  canSwitchApprovedSuggestionToCommunity,
  type ExeCacheEntry,
} from "../store";

/**
 * Every "Level up" the library offers at once: a custom file whose suggestion
 * was approved, a custom file the database now knows, and a launcher game no
 * file tracks yet that has files to track.
 */
export type LevelUpOffer =
  | { kind: "approved"; key: string; gameName: string; exeName: string }
  | {
      kind: "match";
      key: string;
      gameName: string;
      exeName: string;
      matchName: string;
      matchSource: GameSource;
    }
  | {
      kind: "tracking";
      key: string;
      gameName: string;
      entry: LibraryImportEntry;
      install?: LibraryInstallEntry;
      exeNames: string[];
    };

type LevelUpGame = {
  name: string;
  exeNames: readonly string[];
  emulatorContentKeys: readonly string[];
  libraryImports: ReadonlyArray<{
    provider: LibraryImportEntry["provider"];
    externalId: string;
    entry: LibraryImportEntry;
    install?: LibraryInstallEntry;
  }>;
};

type LibraryMatchOffer = {
  entry: LibraryImportEntry;
  executableMatches: readonly LibraryExecutableMatch[];
};

export function collectLevelUpOffers(
  games: readonly LevelUpGame[],
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  libraryMatchOffers: ReadonlyMap<string, LibraryMatchOffer>,
): LevelUpOffer[] {
  const offers: LevelUpOffer[] = [];
  const seenFiles = new Set<string>();
  for (const game of games) {
    for (const exeName of game.exeNames) {
      const key = exeName.toLowerCase();
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      const entry = exeCache.get(key);
      if (entry?.state !== "matched" || entry.source !== "custom") continue;
      // Same order as the card: a database match hides the approval.
      if (entry.communityUpgradeGame) {
        offers.push({
          kind: "match",
          key: `file:${key}`,
          gameName: game.name,
          exeName: entry.exeName,
          matchName: entry.communityUpgradeGame.name,
          matchSource: entry.communityUpgradeGame.source,
        });
      } else if (canSwitchApprovedSuggestionToCommunity(entry)) {
        offers.push({
          kind: "approved",
          key: `file:${key}`,
          gameName: game.name,
          exeName: entry.exeName,
        });
      }
    }

    // Same rule as the card's "Match found - Review to start tracking".
    if (game.exeNames.length > 0 || game.emulatorContentKeys.length > 0) {
      continue;
    }
    for (const item of game.libraryImports) {
      const importKey = libraryEntryKey(item.provider, item.externalId);
      const offer = libraryMatchOffers.get(importKey);
      if (offer?.entry !== item.entry) continue;
      offers.push({
        kind: "tracking",
        key: `import:${importKey}`,
        gameName: game.name,
        entry: item.entry,
        install: item.install,
        exeNames: offer.executableMatches.map((match) => match.name),
      });
      break;
    }
  }
  return offers;
}
