import type {
  LibraryProviderId,
  LibraryResolveRequest,
  LibraryResolveResponse,
} from "@playcounter/shared";
import type { ResolvedLibraryGame, ScannedLibraryGame } from "./types";

const BATCH_SIZE = 100;

export type LibraryResolveOutcome =
  | { capability: "supported"; games: ResolvedLibraryGame[] }
  | { capability: "unsupported"; games: [] };

export async function resolveLibraryGames(
  apiEndpoint: string,
  provider: LibraryProviderId,
  games: readonly ScannedLibraryGame[],
): Promise<LibraryResolveOutcome> {
  const resolved: ResolvedLibraryGame[] = [];
  const offsets =
    games.length === 0
      ? [0]
      : Array.from(
          { length: Math.ceil(games.length / BATCH_SIZE) },
          (_, index) => index * BATCH_SIZE,
        );
  for (const offset of offsets) {
    const items: LibraryResolveRequest["items"] = games
      .slice(offset, offset + BATCH_SIZE)
      .map((game) => ({
        key: `${provider}:${game.externalId}`,
        provider,
        externalId: game.externalId,
      }));
    const response = await fetch(libraryResolveUrl(apiEndpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items } satisfies LibraryResolveRequest),
    });
    if ([404, 405, 501].includes(response.status)) {
      return { capability: "unsupported", games: [] };
    }
    if (!response.ok) {
      throw new Error(`Library lookup failed (${response.status}).`);
    }
    const body = (await response.json()) as LibraryResolveResponse;
    for (const item of body.results) {
      const flagged = new Set(
        (item.flaggedIdentifiers ?? []).map((identifier) =>
          identifier.value.toLowerCase(),
        ),
      );
      resolved.push({
        key: item.key,
        status: item.status,
        game: item.game
          ? {
              id: item.game.id,
              igdbId: item.game.igdbId,
              name: item.game.name,
              coverUrl: item.game.coverUrl,
              source: item.game.source === "community" ? "community" : "igdb",
            }
          : undefined,
        executables: (item.executables ?? []).map((executable) => ({
          ...executable,
          ambiguous:
            executable.ambiguous || flagged.has(executable.value.toLowerCase()),
        })),
      });
    }
  }
  return { capability: "supported", games: resolved };
}

export function libraryResolveUrl(apiEndpoint: string) {
  return `${apiEndpoint.replace(/\/+$/, "")}/api/library/resolve`;
}
