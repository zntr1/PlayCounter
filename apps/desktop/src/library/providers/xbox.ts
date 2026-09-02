import type {
  XboxImportFailureReason,
  XboxImportGame,
  XboxImportResultResponse,
  XboxImportStartResponse,
} from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_API_ENDPOINT } from "../../store";
import type { LocalLibraryProvider, LibraryScanOptions } from "../provider";
import type { LibraryScanResult, ResolvedLibraryGame } from "../types";

const XBOX_IMPORT_POLL_INTERVAL_MS = 1_500;
const XBOX_IMPORT_TIMEOUT_MS = 5 * 60 * 1_000;

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
  launch: async () => {
    throw new Error(
      "Xbox games are launched through the Xbox app, not PlayCounter.",
    );
  },
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

  try {
    const startResponse = await fetch(`${apiEndpoint}/api/xbox/import/start`, {
      method: "POST",
      signal: requestController.signal,
    });
    if (!startResponse.ok) {
      throw new Error(`Xbox import could not start (${startResponse.status}).`);
    }

    const start = (await startResponse.json()) as XboxImportStartResponse;
    if (
      typeof start.attemptId !== "string" ||
      !start.attemptId ||
      typeof start.authorizeUrl !== "string"
    ) {
      throw new Error("Xbox import returned an invalid sign-in response.");
    }
    attemptId = start.attemptId;
    attemptActive = true;

    await invoke<void>("open_microsoft_signin_url", {
      url: start.authorizeUrl,
    });

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

      const result = (await resultResponse.json()) as XboxImportResultResponse;
      if (result.status === "done") {
        attemptActive = false;
        if (!Array.isArray(result.games)) {
          throw new Error("Xbox import returned an invalid game list.");
        }
        return mapXboxImportGames(result.games);
      }
      if (result.status === "failed") {
        attemptActive = false;
        throw new Error(xboxImportFailureMessage(result.reason));
      }
      if (result.status !== "pending") {
        throw new Error("Xbox import returned an invalid status.");
      }

      await abortableDelay(
        XBOX_IMPORT_POLL_INTERVAL_MS,
        requestController.signal,
      );
    }
  } catch (error) {
    if (attemptActive && attemptId) {
      await cancelXboxImport(apiEndpoint, attemptId);
    }
    if (timedOut) {
      throw new Error(xboxImportFailureMessage("timed_out"));
    }
    if (externalSignal?.aborted) {
      throw new Error(xboxImportFailureMessage("cancelled"));
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

function mapXboxImportGames(games: XboxImportGame[]): LibraryScanResult {
  const resolvedGames: ResolvedLibraryGame[] = games.map((game) => ({
    key: `xbox:${game.externalId}`,
    status: game.status,
    game: game.game
      ? {
          id: game.game.id,
          igdbId: game.game.igdbId,
          name: game.game.name,
          coverUrl: game.game.coverUrl,
          source: game.game.source === "community" ? "community" : "igdb",
        }
      : undefined,
    executables: game.executables ?? [],
  }));

  return {
    games: games.map((game) => ({
      externalId: game.externalId,
      name: game.name,
      playtimeSeconds: game.providerSeconds,
      lastPlayedUnix: isoTimestampToUnix(game.providerLastPlayedAt),
      installed: false,
      executables: [],
    })),
    warnings: [],
    partial: false,
    resolvedGames,
  };
}

async function cancelXboxImport(apiEndpoint: string, attemptId: string) {
  try {
    await fetch(`${apiEndpoint}/api/xbox/import/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId }),
    });
  } catch {
    // Best effort: the backend TTL still removes an abandoned attempt.
  }
}

function isoTimestampToUnix(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : undefined;
}

function xboxImportFailureMessage(reason?: XboxImportFailureReason) {
  switch (reason) {
    case "cancelled":
      return "Xbox sign-in was cancelled.";
    case "timed_out":
      return "Xbox sign-in timed out. Start the import again to retry.";
    case "oauth_error":
      return "Microsoft sign-in failed. Start the import again to retry.";
    case "xbox_api_error":
      return "Xbox Live could not return your game history. Try again later.";
    default:
      return "Xbox import failed. Try again later.";
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
