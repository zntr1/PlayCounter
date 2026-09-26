import { resolveEmulatorLaunchTarget } from "./emulatorLaunch";
import type { EmulatorLaunchTarget } from "./emulatorLaunch";
import { adapterFor } from "./emulators/registry";
import type { EmulatorMapping } from "./emulators/types";
import {
  findManualLaunchTarget,
  launchTargetsForGame,
  type LaunchOwner,
  type LaunchTargetLike,
  type MatchedExeLike,
} from "./gameLaunch";

/* Whether Play can start a game ──────────────────────────────────────────────
   The game card, the library banner and the Launchable filter all ask this, so
   a game with a Play button is always in Launchable and the other way round.
   Settings that hide Play (launching turned off, not Windows) stay with the
   callers: the filter still means "could launch". Battle.net installs only
   open the launcher, so they do not count on their own. */

const PLAY_PROVIDERS: readonly string[] = ["steam", "xbox", "epic"];

export type LaunchableGame = {
  exeNames: readonly string[];
  aliases: readonly LaunchOwner[];
  emulatorContentKeys: readonly string[];
  libraryImports: ReadonlyArray<{ provider: string; installed: boolean }>;
};

export type LaunchSources = {
  launchTargets: ReadonlyMap<string, LaunchTargetLike>;
  manualLaunchTargets: ReadonlyMap<string, LaunchTargetLike>;
  exeCache: ReadonlyMap<string, MatchedExeLike>;
  emulatorMappings: ReadonlyMap<string, EmulatorMapping>;
  emulatorAutoLaunchTargets: ReadonlyMap<string, EmulatorLaunchTarget>;
  emulatorManualLaunchTargets: ReadonlyMap<string, EmulatorLaunchTarget>;
};

/** Emulator mappings Play can start. Play picks one only when it is the only one. */
export function launchableEmulatorMappings(
  contentKeys: readonly string[],
  mappings: ReadonlyMap<string, EmulatorMapping>,
) {
  return contentKeys.flatMap((contentKey) => {
    const mapping = mappings.get(contentKey);
    return mapping?.decision === "game" &&
      adapterFor(mapping.emulatorId)?.launch
      ? [mapping]
      : [];
  });
}

export function isLaunchable(game: LaunchableGame, sources: LaunchSources) {
  if (findManualLaunchTarget(game.aliases, sources.manualLaunchTargets))
    return true;
  if (
    launchTargetsForGame({
      exeNames: game.exeNames,
      aliases: game.aliases,
      launchTargets: sources.launchTargets,
      exeCache: sources.exeCache,
    }).length > 0
  )
    return true;
  const emulatorMappings = launchableEmulatorMappings(
    game.emulatorContentKeys,
    sources.emulatorMappings,
  );
  if (
    emulatorMappings.length === 1 &&
    resolveEmulatorLaunchTarget(
      emulatorMappings[0].contentKey,
      sources.emulatorAutoLaunchTargets,
      sources.emulatorManualLaunchTargets,
    )
  )
    return true;
  return game.libraryImports.some(
    (entry) => entry.installed && PLAY_PROVIDERS.includes(entry.provider),
  );
}
