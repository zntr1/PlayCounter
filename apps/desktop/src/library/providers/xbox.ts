import type {
  GameMetadataResponse,
  LibraryKnownExecutable,
  LibraryReverseResolveRequest,
  LibraryReverseResolveResponse,
  XboxImportCancelRequest,
  XboxImportFailureReason,
  XboxImportFailureStage,
  XboxImportGame,
  XboxImportProgressStage,
  XboxImportStartResponse,
} from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_API_ENDPOINT, type GameMetadata } from "../../store";
import type { LocalLibraryProvider, LibraryScanOptions } from "../provider";
import type {
  LibraryScanResult,
  ResolvedLibraryGame,
  ScannedExecutable,
} from "../types";

const XBOX_IMPORT_POLL_INTERVAL_MS = 1_500;
const XBOX_IMPORT_TIMEOUT_MS = 5 * 60 * 1_000;
const XBOX_CANCEL_TIMEOUT_MS = 3_000;
type ParsedXboxImportGame = Omit<XboxImportGame, "candidates"> & {
  candidates: GameMetadata[];
};

export type XboxLocalGame = {
  externalId: string;
  name: string;
  installPath: string;
  executables: ScannedExecutable[];
};

export type XboxLocalScan = {
  games: XboxLocalGame[];
  warnings: string[];
  partial: boolean;
};

type XboxFailureContext = {
  reason: XboxImportFailureReason;
  stage?: XboxImportFailureStage;
  errorCode?: string;
  accountLabel?: string;
};

type ParsedXboxImportResult =
  | { status: "pending"; stage?: XboxImportProgressStage }
  | { status: "done"; games: ParsedXboxImportGame[] }
  | ({ status: "failed" } & XboxFailureContext);

export const xboxProvider: LocalLibraryProvider = {
  id: "xbox",
  label: "Xbox",
  detect: async () => ({
    provider: "xbox",
    available: true,
    checkedPaths: [],
  }),
  listAccounts: async () => [
    {
      accountId: 0,
      personaName: "Sign in with Microsoft",
      mostRecent: true,
      gamesWithPlaytime: 0,
    },
  ],
  scan: (_accountId, options) => scanXboxLibrary(options),
  launch: (externalId, mode = "play") =>
    mode === "store"
      ? invoke<void>("open_xbox_app")
      : invoke<void>("library_launch_app", {
          provider: "xbox",
          externalId,
          mode,
        }),
};

export async function scanXboxLibrary(
  options: LibraryScanOptions = {},
): Promise<LibraryScanResult> {
  const apiEndpoint = (options.apiEndpoint ?? DEFAULT_API_ENDPOINT).replace(
    /\/+$/,
    "",
  );
  const externalSignal = options.signal;
  ensureNotAborted(externalSignal);

  const requestController = new AbortController();
  const onExternalAbort = () => requestController.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, XBOX_IMPORT_TIMEOUT_MS);
  let attemptId: string | undefined;
  let attemptActive = false;
  let reportedProgress: XboxImportProgressStage | undefined;
  const reportProgress = (stage: XboxImportProgressStage) => {
    if (reportedProgress === stage) return;
    reportedProgress = stage;
    options.onXboxProgress?.(stage);
  };

  try {
    const startResponse = await fetch(`${apiEndpoint}/api/xbox/import/start`, {
      method: "POST",
      signal: requestController.signal,
    });
    if (!startResponse.ok) {
      throw new Error(`Xbox import could not start (${startResponse.status}).`);
    }

    const start = parseXboxImportStart(await startResponse.json());
    attemptId = start.attemptId;
    attemptActive = true;
    options.onAuthorizeUrl?.(start.authorizeUrl);
    reportProgress("authorization");

    if (options.openAuthorizeUrl !== false) {
      try {
        await invoke<void>("open_microsoft_signin_url", {
          url: start.authorizeUrl,
        });
      } catch {
        // Keep polling: the importer exposes the same URL for manual copying
        // when the system browser integration is unavailable or has stale state.
      }
    }

    while (true) {
      ensureNotAborted(requestController.signal);
      const resultResponse = await fetch(
        `${apiEndpoint}/api/xbox/import/result?attemptId=${encodeURIComponent(attemptId)}`,
        { signal: requestController.signal },
      );
      if (!resultResponse.ok) {
        throw new Error(
          `Xbox import status could not be checked (${resultResponse.status}).`,
        );
      }

      const result = parseXboxImportResult(await resultResponse.json());
      if (result.status === "done") {
        attemptActive = false;
        return mapXboxImportGames(result.games, await scanLocalXboxGames());
      }
      if (result.status === "failed") {
        attemptActive = false;
        throw new Error(xboxImportFailureMessage(result));
      }
      if (result.status !== "pending") {
        throw new Error("Xbox import returned an invalid status.");
      }
      if (result.stage) reportProgress(result.stage);

      await abortableDelay(
        XBOX_IMPORT_POLL_INTERVAL_MS,
        requestController.signal,
      );
    }
  } catch (error) {
    if (attemptActive && attemptId) {
      void cancelXboxImport(apiEndpoint, attemptId);
    }
    if (timedOut) {
      throw new Error(xboxImportFailureMessage({ reason: "timed_out" }));
    }
    if (externalSignal?.aborted) {
      throw new Error(xboxImportFailureMessage({ reason: "cancelled" }));
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

async function scanLocalXboxGames(): Promise<XboxLocalScan> {
  try {
    return await invoke<XboxLocalScan>("library_scan_xbox_local");
  } catch {
    return { games: [], warnings: [], partial: false };
  }
}

function mapXboxImportGames(
  games: ParsedXboxImportGame[],
  local: XboxLocalScan,
): LibraryScanResult {
  const byExternalId = new Map(
    local.games.map((game) => [game.externalId, game]),
  );
  const resolvedGames: ResolvedLibraryGame[] = games.map((game) => ({
    key: `xbox:${game.externalId}`,
    status: "unknown",
    executables: [],
    candidates: game.candidates,
  }));

  return {
    games: games.map((game) => {
      const localGame = byExternalId.get(game.externalId);
      return {
        externalId: game.externalId,
        name: game.name,
        playtimeSeconds: game.providerSeconds,
        lastPlayedUnix: isoTimestampToUnix(game.providerLastPlayedAt),
        installed: Boolean(localGame),
        installPath: localGame?.installPath,
        executables: localGame?.executables ?? [],
      };
    }),
    warnings: local.warnings,
    partial: local.partial,
    resolvedGames,
  };
}

async function cancelXboxImport(apiEndpoint: string, attemptId: string) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    XBOX_CANCEL_TIMEOUT_MS,
  );
  try {
    await fetch(`${apiEndpoint}/api/xbox/import/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId } satisfies XboxImportCancelRequest),
      signal: controller.signal,
    });
  } catch {
    // Best effort: the backend TTL still removes an abandoned attempt.
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function searchXboxGames(
  apiEndpoint: string,
  rawQuery: string,
): Promise<GameMetadata[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];
  const endpoint = apiEndpoint.replace(/\/+$/, "");
  const response = await fetch(
    `${endpoint}/api/games/search?query=${encodeURIComponent(query)}&mainGamesAndRemastersOnly=true`,
  );
  if (!response.ok) {
    throw new Error(`Xbox game search failed (${response.status}).`);
  }
  const value: unknown = await response.json();
  const record = asRecord(value);
  if (!record || !Array.isArray(record.games)) {
    throw new Error("Xbox game search returned an invalid response.");
  }
  return record.games.map(
    parseGameMetadata,
  ) satisfies GameMetadataResponse["games"];
}
export async function reverseResolveXboxGame(
  apiEndpoint: string,
  gameId: number,
): Promise<{
  game: GameMetadata;
  executables: LibraryKnownExecutable[];
}> {
  const endpoint = apiEndpoint.replace(/\/+$/, "");
  const response = await fetch(`${endpoint}/api/library/reverse-resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId } satisfies LibraryReverseResolveRequest),
  });
  if (!response.ok) {
    throw new Error(`The game file lookup failed (${response.status}).`);
  }
  const record = asRecord(await response.json());
  if (!record || !Array.isArray(record.executables)) {
    throw new Error("The game file lookup sent back an invalid response.");
  }
  return {
    game: parseGameMetadata(record.game),
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

function parseXboxImportStart(value: unknown): XboxImportStartResponse {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.attemptId !== "string" ||
    !/^[a-f0-9]{48}$/.test(record.attemptId) ||
    typeof record.authorizeUrl !== "string" ||
    !record.authorizeUrl
  ) {
    throw new Error("Xbox import returned an invalid sign-in response.");
  }
  return {
    attemptId: record.attemptId,
    authorizeUrl: record.authorizeUrl,
  };
}

function parseXboxImportResult(value: unknown): ParsedXboxImportResult {
  const record = asRecord(value);
  if (!record || typeof record.status !== "string") {
    throw new Error("Xbox import returned an invalid status.");
  }
  if (record.status === "pending") {
    if (
      record.stage !== undefined &&
      record.stage !== "authorization" &&
      record.stage !== "history"
    ) {
      throw new Error("Xbox import returned an invalid progress stage.");
    }
    return {
      status: "pending",
      ...(record.stage === "authorization" || record.stage === "history"
        ? { stage: record.stage }
        : {}),
    };
  }
  if (record.status === "done") {
    if (!Array.isArray(record.games)) {
      throw new Error("Xbox import returned an invalid game list.");
    }
    return { status: "done", games: record.games.map(parseXboxImportGame) };
  }
  if (record.status === "failed" && isXboxFailureReason(record.reason)) {
    if (record.stage !== undefined && !isXboxFailureStage(record.stage)) {
      throw new Error("Xbox import returned an invalid failure stage.");
    }
    if (
      record.accountLabel !== undefined &&
      (typeof record.accountLabel !== "string" || !record.accountLabel.trim())
    ) {
      throw new Error("Xbox import returned an invalid account label.");
    }
    if (
      record.errorCode !== undefined &&
      (typeof record.errorCode !== "string" || !record.errorCode.trim())
    ) {
      throw new Error("Xbox import returned an invalid Microsoft error code.");
    }
    return {
      status: "failed",
      reason: record.reason,
      ...(isXboxFailureStage(record.stage) ? { stage: record.stage } : {}),
      ...(typeof record.errorCode === "string"
        ? { errorCode: record.errorCode.trim().slice(0, 200) }
        : {}),
      ...(typeof record.accountLabel === "string"
        ? { accountLabel: record.accountLabel.trim().slice(0, 254) }
        : {}),
    };
  }
  throw new Error("Xbox import returned an invalid status.");
}

function parseXboxImportGame(value: unknown): ParsedXboxImportGame {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.externalId !== "string" ||
    !/^[1-9][0-9]{0,9}$/.test(record.externalId) ||
    typeof record.name !== "string" ||
    !record.name.trim() ||
    (record.providerSeconds !== null &&
      (typeof record.providerSeconds !== "number" ||
        !Number.isFinite(record.providerSeconds) ||
        record.providerSeconds < 0)) ||
    !Array.isArray(record.candidates) ||
    (record.providerLastPlayedAt !== undefined &&
      (typeof record.providerLastPlayedAt !== "string" ||
        !Number.isFinite(Date.parse(record.providerLastPlayedAt))))
  ) {
    throw new Error("Xbox import returned invalid game data.");
  }
  return {
    externalId: record.externalId,
    name: record.name,
    providerSeconds: record.providerSeconds,
    ...(typeof record.providerLastPlayedAt === "string"
      ? { providerLastPlayedAt: record.providerLastPlayedAt }
      : {}),
    candidates: uniqueGames(record.candidates.map(parseGameMetadata)),
  };
}

function parseGameMetadata(value: unknown): GameMetadata {
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
    throw new Error("Xbox import returned invalid game metadata.");
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

function uniqueGames(games: GameMetadata[]) {
  return [...new Map(games.map((game) => [game.igdbId, game])).values()];
}

function isXboxFailureReason(value: unknown): value is XboxImportFailureReason {
  return (
    value === "cancelled" ||
    value === "timed_out" ||
    value === "oauth_error" ||
    value === "xbox_api_error"
  );
}

function isXboxFailureStage(value: unknown): value is XboxImportFailureStage {
  return (
    value === "authorization" ||
    value === "microsoft_token" ||
    value === "xbox_user_token" ||
    value === "xbox_xsts" ||
    value === "title_history"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isoTimestampToUnix(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : undefined;
}

export function xboxImportFailureMessage(context: XboxFailureContext) {
  const account = context.accountLabel
    ? ` Microsoft account: ${context.accountLabel}.`
    : "";
  const recovery =
    " Use the Microsoft account that belongs to your Xbox gamertag. If you are not sure, use Copy sign-in link and open it in a private browser window.";

  switch (context.stage) {
    case "authorization": {
      const errorCode = context.errorCode
        ? ` Microsoft returned ${context.errorCode}.`
        : "";
      return `Microsoft sign-in was not completed.${errorCode}${recovery}`;
    }
    case "microsoft_token":
      return `Microsoft answered, but PlayCounter could not finish the sign-in.${recovery}`;
    case "xbox_user_token":
      return `Microsoft sign-in completed.${account} Xbox Live did not accept this account.${recovery}`;
    case "xbox_xsts":
      return `Microsoft sign-in completed.${account} Xbox Live could not create a gaming session for this account.${recovery}`;
    case "title_history":
      return `Xbox sign-in completed.${account} Xbox did not send back any game history.${recovery}`;
  }

  switch (context.reason) {
    case "cancelled":
      return "Xbox sign-in was cancelled.";
    case "timed_out":
      return `Xbox sign-in timed out.${recovery}`;
    case "oauth_error":
      return `Microsoft sign-in failed.${account}${recovery}`;
    case "xbox_api_error":
      return `Xbox could not send back your game history.${account}${recovery}`;
    default:
      return "The Xbox import failed. Please try again later.";
  }
}

function ensureNotAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  const error = new Error("Xbox sign-in was cancelled.");
  error.name = "AbortError";
  throw error;
}

function abortableDelay(milliseconds: number, signal: AbortSignal | undefined) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      ensureNotAborted(signal);
      return;
    }

    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const error = new Error("Xbox sign-in was cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
