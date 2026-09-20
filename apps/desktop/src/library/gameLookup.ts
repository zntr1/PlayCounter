import type {
  GameMetadataResponse,
  LibraryKnownExecutable,
  LibraryReverseResolveRequest,
  LibraryReverseResolveResponse,
} from "@playcounter/shared";
import { responseError } from "../rateLimitedFetch";
import type { GameMetadata } from "../store";
import { requestLibraryJson, type RateLimitWaitListener } from "./request";

export function librarySearchQuery(title: string): string {
  return title.replace(/[®™℠]/gu, "").replace(/\s+/gu, " ").trim();
}

export async function searchLibraryGames(
  apiEndpoint: string,
  rawQuery: string,
  options: {
    signal?: AbortSignal;
    mainGamesAndRemastersOnly: boolean;
    onRateLimitWait?: RateLimitWaitListener;
  },
): Promise<GameMetadata[]> {
  const { signal, mainGamesAndRemastersOnly } = options;
  const query = librarySearchQuery(rawQuery);
  if (query.length < 2) return [];
  const endpoint = apiEndpoint.replace(/\/+$/, "");
  const response = await requestLibraryJson<unknown>(
    `${endpoint}/api/games/search?query=${encodeURIComponent(query)}&mainGamesAndRemastersOnly=${mainGamesAndRemastersOnly}`,
    { signal, onRateLimitWait: options.onRateLimitWait },
  );
  if (!response.ok) {
    throw responseError(response, `Game search failed (${response.status}).`);
  }
  const value = response.data;
  const record = asRecord(value);
  if (!record || !Array.isArray(record.games)) {
    throw new Error("Game search returned an invalid response.");
  }
  return record.games.map(
    parseLibraryGameMetadata,
  ) satisfies GameMetadataResponse["games"];
}
export async function reverseResolveLibraryGame(
  apiEndpoint: string,
  gameId: number,
  signal?: AbortSignal,
): Promise<{
  game: GameMetadata;
  executables: LibraryKnownExecutable[];
}> {
  const endpoint = apiEndpoint.replace(/\/+$/, "");
  const response = await requestLibraryJson<unknown>(
    `${endpoint}/api/library/reverse-resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId } satisfies LibraryReverseResolveRequest),
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw responseError(
      response,
      `The game file lookup failed (${response.status}).`,
    );
  }
  const record = asRecord(response.data);
  if (!record || !Array.isArray(record.executables)) {
    throw new Error("The game file lookup sent back an invalid response.");
  }
  return {
    game: parseLibraryGameMetadata(record.game),
    executables: record.executables.map(parseLibraryExecutable),
  } satisfies LibraryReverseResolveResponse;
}

function parseLibraryExecutable(value: unknown): LibraryKnownExecutable {
  const record = asRecord(value);
  const platform = record?.platform;
  const kind = record?.kind;
  if (
    !record ||
    !isLibraryPlatform(platform) ||
    !isLibraryIdentifierKind(kind) ||
    typeof record.value !== "string" ||
    !record.value.trim() ||
    (record.provenance !== "igdb" && record.provenance !== "community") ||
    typeof record.verified !== "boolean" ||
    (record.ambiguous !== undefined && typeof record.ambiguous !== "boolean")
  ) {
    throw new Error("The game file lookup sent back invalid file data.");
  }
  return {
    platform,
    kind,
    value: record.value,
    provenance: record.provenance,
    verified: record.verified,
    ...(typeof record.ambiguous === "boolean"
      ? { ambiguous: record.ambiguous }
      : {}),
  };
}

function isLibraryPlatform(
  value: unknown,
): value is LibraryKnownExecutable["platform"] {
  return value === "windows" || value === "macos" || value === "linux";
}

function isLibraryIdentifierKind(
  value: unknown,
): value is LibraryKnownExecutable["kind"] {
  return (
    value === "exe" ||
    value === "bundle_id" ||
    value === "app_bundle" ||
    value === "process_name" ||
    value === "steam_app_id" ||
    value === "executable_path" ||
    value === "executable_name" ||
    value === "desktop_id" ||
    value === "wine_exe"
  );
}

export function parseLibraryGameMetadata(value: unknown): GameMetadata {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.id !== "number" ||
    !Number.isInteger(record.id) ||
    record.id <= 0 ||
    typeof record.igdbId !== "number" ||
    !Number.isInteger(record.igdbId) ||
    record.igdbId <= 0 ||
    typeof record.name !== "string" ||
    !record.name.trim() ||
    typeof record.coverUrl !== "string" ||
    (record.releaseYear !== undefined &&
      (typeof record.releaseYear !== "number" ||
        !Number.isInteger(record.releaseYear) ||
        record.releaseYear <= 0)) ||
    (record.source !== "igdb" && record.source !== "community")
  ) {
    throw new Error("Game lookup returned invalid game metadata.");
  }
  return {
    id: record.id,
    igdbId: record.igdbId,
    name: record.name,
    coverUrl: record.coverUrl,
    ...(typeof record.releaseYear === "number"
      ? { releaseYear: record.releaseYear }
      : {}),
    source: record.source,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
