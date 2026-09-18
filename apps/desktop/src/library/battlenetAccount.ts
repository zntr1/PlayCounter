import { invoke } from "@tauri-apps/api/core";
import type { LibraryScanResult, ScannedLibraryGame } from "./types";

/** Deliberately excludes account names, credentials, subscriptions and CD keys. */
export type BattleNetAccountLibrary = {
  games: { titleId: number | null; name: string; franchise: string | null }[];
  incomplete: boolean;
};

// Account title IDs are not product.db IDs. Only explicit product identities
// belong here; unknown titles keep a stable ID and require manual game review.
// Reference: PlayniteExtensions/source/Libraries/BattleNetLibrary/BattleNetGames.cs
const ACCOUNT_PRODUCTS: Readonly<Record<number, string>> = {
  5730135: "wow",
  17459: "diablo3",
  21298: "s2",
  21297: "s1",
  1465140039: "hs_beta",
  1214607983: "heroes",
  5272175: "prometheus",
  22323: "w3",
  5198665: "osi",
  4613486: "fenris",
  1095647827: "anbs",
  // This ID represents the shared Call of Duty launcher, not a specific sequel.
  1096108883: "auks",
  1447645266: "viper",
  1329875278: "odin",
  1279351378: "lazarus",
  1514493267: "zeus",
  1464615513: "wlby",
  1381257807: "rtro",
  1179603525: "fore",
  1146246220: "d1",
  5714258: "w1r",
  5714514: "w2r",
  1463898673: "w1",
  1462911566: "w2",
  4674137: "gryphon",
  1095911763: "aris",
  1396920146: "scorpio",
  4280907: "arkansas",
  1279414849: "libra",
  1095849281: "aqua",
};

function productAliases(id: string): readonly string[] {
  return id === "fen" || id === "fenris" ? ["fenris", "fen"] : [id];
}

export function retainBattleNetProductIds(
  local: LibraryScanResult,
  previousIds: readonly string[],
): LibraryScanResult {
  if (previousIds.length === 0) return local;
  return {
    ...local,
    games: local.games.map((game) => ({
      ...game,
      externalId: previousIds.includes(game.externalId)
        ? game.externalId
        : (productAliases(game.externalId).find((id) =>
            previousIds.includes(id),
          ) ?? game.externalId),
    })),
  };
}

export function mergeBattleNetAccountLibrary(
  account: BattleNetAccountLibrary,
  local: LibraryScanResult,
  previousIds: readonly string[] = [],
): LibraryScanResult {
  const games = new Map(
    retainBattleNetProductIds(local, previousIds).games.map((game) => [
      game.externalId,
      game,
    ]),
  );
  for (const game of account.games) {
    const product =
      game.titleId === null
        ? classicProductId(game.name, game.franchise)
        : (ACCOUNT_PRODUCTS[game.titleId] ?? `title_${game.titleId}`);
    const aliases = productAliases(product);
    const externalId =
      aliases.find((id) => games.has(id)) ??
      aliases.find((id) => previousIds.includes(id)) ??
      product;
    const installed = games.get(externalId);
    const entry: ScannedLibraryGame = installed
      ? { ...installed, inAccountLibrary: true }
      : {
          externalId,
          name: game.name,
          installed: false,
          installationStatusUnknown: local.partial || undefined,
          inAccountLibrary: true,
          playtimeSeconds: null,
          hasPlayedEvidence: false,
          executables: [],
        };
    games.set(externalId, entry);
  }
  return {
    games: [...games.values()].sort((a, b) =>
      (a.name ?? a.externalId).localeCompare(b.name ?? b.externalId),
    ),
    warnings: [
      ...local.warnings,
      ...(account.incomplete
        ? [
            "Battle.net returned only part of your account library. Sign in again to retry the missing games.",
          ]
        : []),
    ],
    partial: local.partial || account.incomplete,
  };
}

function classicProductId(name: string, franchise: string | null) {
  // Classic records have no numeric title ID. Keep distinct editions separate
  // instead of inferring an expansion from the number of keys/accounts.
  const identity = `${franchise ?? ""}\n${name}`
    .normalize("NFKC")
    .toLowerCase();
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(identity)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `classic_${hash.toString(16)}`;
}

export async function readBattleNetAccountLibrary(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void invoke("library_cancel_battlenet_account", { requestId }).catch(
        () => {},
      );
      reject(
        signal?.reason ?? new DOMException("Import cancelled", "AbortError"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      invoke<BattleNetAccountLibrary>("library_battlenet_account_games", {
        requestId,
      }),
      aborted,
    ]);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
