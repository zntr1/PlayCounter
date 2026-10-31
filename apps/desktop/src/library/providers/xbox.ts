import {
  rateLimitedFetch,
  rateLimitDelay,
  responseError,
} from "../../rateLimitedFetch";
import { requestLibraryJson } from "../request";
import { parseLibraryGameMetadata } from "../gameLookup";
import type {
  AchievementList,
  XboxAchievementError,
  XboxImportCancelRequest,
  XboxImportFailureReason,
  XboxImportFailureStage,
  XboxImportGame,
  XboxImportProgressStage,
  XboxImportStartRequest,
  XboxImportStartResponse,
} from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { parseAchievementList } from "../../achievements/model";
import { DEFAULT_API_ENDPOINT, type GameMetadata } from "../../store";
import type { LocalLibraryProvider, LibraryScanOptions } from "../provider";
import type {
  LibraryScanResult,
  ResolvedLibraryGame,
  ScannedExecutable,
} from "../types";
import { appLanguage, getT } from "../../i18n";
import { refreshKeptLogins, useKeptLogins } from "../keptLogins";
import {
  getLoginOperationRevision,
  recordLoginHealth,
  supersedeLoginCheck,
} from "../loginHealth";

const t = getT("import");

const XBOX_IMPORT_POLL_INTERVAL_MS = 1_500;
const XBOX_IMPORT_TIMEOUT_MS = 5 * 60 * 1_000;
const XBOX_CANCEL_TIMEOUT_MS = 3_000;

/** A background operation has no reusable account and must wait for the user. */
export class XboxSignInRequiredError extends Error {
  constructor() {
    super(t("Sign in with Microsoft"));
    this.name = "XboxSignInRequiredError";
  }
}
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

type ParsedXboxImportResult = { loginReady?: boolean } & (
  | { status: "pending"; stage?: XboxImportProgressStage }
  | { status: "done"; games: ParsedXboxImportGame[] }
  | ({ status: "failed" } & XboxFailureContext)
);

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
      personaName: t("Sign in with Microsoft"),
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
  // A server without achievement support refuses the option: import plainly.
  const games =
    (await signInToXbox(options, {
      includeAchievements: true,
      language: appLanguage(),
    })) ?? (await signInToXbox(options));
  const localGames = await scanLocalXboxGames();
  ensureNotAborted(options.signal);
  return mapXboxImportGames(games ?? [], localGames);
}

/** Connect without importing or reading the account's library. */
export async function signInXboxAccount(
  options: LibraryScanOptions = {},
): Promise<void> {
  const result = await signInToXbox(options, { authenticationOnly: true });
  // Older servers can still connect through the existing import flow.
  if (result === null) await signInToXbox(options);
}

/** One Xbox title's achievements, after a Microsoft sign-in. Skips game
 *  matching, playtime and this PC's scan. */
export async function refreshXboxAchievementList(
  titleId: string,
  options: LibraryScanOptions = {},
): Promise<{ list: AchievementList } | { error: XboxAchievementError }> {
  const games = await signInToXbox(options, {
    achievementTitleIds: [titleId],
    language: appLanguage(),
  });
  if (!games) {
    throw new Error(
      t(
        "Refreshing Xbox achievements needs a newer PlayCounter server. Try again later.",
      ),
    );
  }
  const game = games.find((item) => item.externalId === titleId);
  return game?.achievements
    ? { list: game.achievements }
    : { error: game?.achievementError ?? "failed" };
}

/** Signs in through the backend and returns Xbox's titles. A kept sign-in
 *  needs no browser. With a `request` an older server answers 400 before any
 *  sign-in starts: null then. */
async function signInToXbox(
  options: LibraryScanOptions,
  request?: XboxImportStartRequest,
): Promise<ParsedXboxImportGame[] | null> {
  const apiEndpoint = (options.apiEndpoint ?? DEFAULT_API_ENDPOINT).replace(
    /\/+$/,
    "",
  );
  const externalSignal = options.signal;
  ensureNotAborted(externalSignal);
  const endpointUrl = new URL(apiEndpoint);
  if (
    endpointUrl.username ||
    endpointUrl.password ||
    endpointUrl.search ||
    endpointUrl.hash ||
    (endpointUrl.protocol !== "https:" &&
      !(
        endpointUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpointUrl.hostname)
      ))
  ) {
    throw new Error(
      t(
        "Xbox sign-in requires an HTTPS API connection (or a local development server).",
      ),
    );
  }

  const requestController = new AbortController();
  const accountRevision = getLoginOperationRevision("xbox");
  if (!options.savedLoginOnly) supersedeLoginCheck("xbox");
  const onExternalAbort = () => requestController.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, XBOX_IMPORT_TIMEOUT_MS);
  let attemptId: string | undefined;
  let attemptActive = false;
  let claimHash: string | null = null;
  let savingLogin: Promise<boolean> | null = null;
  const persistLogin = (): Promise<boolean> => {
    if (savingLogin) return savingLogin;
    if (!attemptId || !claimHash) return Promise.resolve(false);
    // This native operation deliberately outlives a cancelled view. Its store
    // generation prevents an explicit sign-out from being undone by a late save.
    savingLogin = keepXboxLogin(attemptId, claimHash, accountRevision)
      .then((kept) => {
        if (kept) claimHash = null;
        return kept;
      })
      .finally(() => {
        savingLogin = null;
      });
    return savingLogin;
  };
  let reportedProgress: XboxImportProgressStage | undefined;
  const reportProgress = (stage: XboxImportProgressStage) => {
    if (reportedProgress === stage) return;
    reportedProgress = stage;
    options.onXboxProgress?.(stage);
  };

  try {
    // The claim hash lets the Rust part keep this sign-in. The web UI never
    // sees its secret or the token.
    const keptAttemptId = await startKeptXboxImport(
      apiEndpoint,
      request,
      options,
      requestController.signal,
      accountRevision,
    );
    if (keptAttemptId) {
      attemptId = keptAttemptId;
      attemptActive = true;
      reportProgress("history");
    } else {
      if (options.savedLoginOnly) throw new XboxSignInRequiredError();
      claimHash = await xboxLoginClaimHash(apiEndpoint);
      const start = await startXboxSignIn(
        apiEndpoint,
        request,
        claimHash,
        options,
        requestController.signal,
      );
      if (!start) return null;
      // An older server refused keepLogin: there is nothing to claim.
      if (!start.keeping) claimHash = null;
      attemptId = start.attemptId;
      attemptActive = true;
      ensureNotAborted(requestController.signal);
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
    }

    while (true) {
      ensureNotAborted(requestController.signal);
      const resultResponse = await rateLimitedFetch(
        `${apiEndpoint}/api/xbox/import/result?attemptId=${encodeURIComponent(attemptId)}`,
        {
          signal: requestController.signal,
          redirect: "error",
          cache: "no-store",
        },
      );
      if (resultResponse.status === 429) {
        options.onRateLimitWait?.(true);
        try {
          await abortableDelay(
            Math.min(60_000, Math.max(1_000, rateLimitDelay(apiEndpoint))),
            requestController.signal,
          );
        } finally {
          options.onRateLimitWait?.(false);
        }
        continue;
      }
      if (!resultResponse.ok) {
        throw new Error(
          t("Xbox import status could not be checked ({{status}}).", {
            status: resultResponse.status,
          }),
        );
      }

      const result = parseXboxImportResult(await resultResponse.json());
      // The Microsoft refresh token is ready before Xbox history completes.
      // Save even if leaving the view just aborted the import in the meantime.
      if (result.loginReady || result.status === "done") {
        const saved = await persistLogin();
        // A terminal response has no next poll to retry a transient claim or
        // secure-store failure. Do not report success with an unsaved login.
        if (
          result.status === "done" &&
          claimHash &&
          !saved &&
          !(await persistLogin())
        ) {
          throw new Error(
            t(
              "The Xbox import is unavailable right now. Check your connection and try again.",
            ),
          );
        }
      }
      ensureNotAborted(requestController.signal);
      if (result.status === "done") {
        attemptActive = false;
        return result.games;
      }
      if (result.status === "failed") {
        attemptActive = false;
        throw new Error(xboxImportFailureMessage(result));
      }
      if (result.status !== "pending") {
        throw new Error(t("Xbox import returned an invalid status."));
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
    // An OAuth callback already in progress can finish after the last poll.
    // The backend retains that claim after cancellation; Rust retries briefly.
    if (attemptId && claimHash) void persistLogin();
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

/** Starts with a kept sign-in. Only a missing or rejected login opens a browser. */
async function startKeptXboxImport(
  apiEndpoint: string,
  request: XboxImportStartRequest | undefined,
  options: LibraryScanOptions,
  signal: AbortSignal,
  accountRevision: number,
): Promise<string | null> {
  let syncRequest = request;
  const recordHealth = (status: "valid" | "needsSignIn" | "unavailable") => {
    if (
      !signal.aborted &&
      accountRevision === getLoginOperationRevision("xbox")
    )
      recordLoginHealth("xbox", status);
  };
  const hadSavedLogin = useKeptLogins
    .getState()
    .logins.some((login) => login.service === "xbox");
  for (let tries = 0; tries < 5; tries++) {
    ensureNotAborted(signal);
    let answer: Record<string, unknown> | null;
    try {
      answer = asRecord(
        await invoke<unknown>("xbox_login_sync_start", {
          apiEndpoint,
          options: syncRequest ?? {},
        }),
      );
    } catch {
      recordHealth("unavailable");
      throw new Error(
        t(
          "The Xbox import is unavailable right now. Check your connection and try again.",
        ),
      );
    }
    if (
      answer?.status === "started" &&
      typeof answer.attemptId === "string" &&
      /^[a-f0-9]{48}$/.test(answer.attemptId)
    ) {
      recordHealth("valid");
      return answer.attemptId;
    }
    if (answer?.status === "busy") {
      const seconds =
        typeof answer.retryAfterSeconds === "number"
          ? Math.min(60, Math.max(1, answer.retryAfterSeconds))
          : 5;
      options.onRateLimitWait?.(true);
      try {
        await abortableDelay(seconds * 1_000, signal);
      } finally {
        options.onRateLimitWait?.(false);
      }
      continue;
    }
    if (answer?.status === "unavailable") {
      if (answer.httpStatus === 400 && syncRequest?.authenticationOnly) {
        // A server predating separate account connections can still renew
        // this saved login. Retry its old flow without opening a browser.
        const { authenticationOnly: _ignored, ...legacyRequest } = syncRequest;
        syncRequest = legacyRequest;
        continue;
      }
      recordHealth("unavailable");
      throw new Error(
        typeof answer.httpStatus === "number"
          ? t("Xbox import could not start ({{status}}).", {
              status: answer.httpStatus,
            })
          : t(
              "The Xbox import is unavailable right now. Check your connection and try again.",
            ),
      );
    }
    if (answer?.status === "signedOut" && hadSavedLogin) {
      recordHealth("needsSignIn");
    }
    if (options.savedLoginOnly && answer?.status !== "signedOut") {
      recordHealth("unavailable");
      throw new Error(
        t(
          "The Xbox import is unavailable right now. Check your connection and try again.",
        ),
      );
    }
    return null;
  }
  throw new Error(
    t(
      "The Xbox import is unavailable right now. Check your connection and try again.",
    ),
  );
}

/** null when this PC keeps no sign-ins or the server is not PlayCounter's. */
async function xboxLoginClaimHash(apiEndpoint: string) {
  try {
    const hash = await invoke<unknown>("xbox_login_claim_hash", {
      apiEndpoint,
    });
    return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)
      ? hash
      : null;
  } catch {
    return null;
  }
}

async function keepXboxLogin(
  attemptId: string,
  claimHash: string,
  accountRevision: number,
) {
  return invoke<boolean>("xbox_login_keep", { attemptId, claimHash })
    .then(async (kept) => {
      if (kept) {
        await refreshKeptLogins();
        if (accountRevision === getLoginOperationRevision("xbox")) {
          recordLoginHealth("xbox", "valid");
        }
      }
      return kept;
    })
    .catch(() => false);
}

/** The browser sign-in's start. An older server refuses options it does not
 *  know before any sign-in starts: first `keepLogin`, then `request` (null). */
async function startXboxSignIn(
  apiEndpoint: string,
  request: XboxImportStartRequest | undefined,
  claimHash: string | null,
  options: LibraryScanOptions,
  signal: AbortSignal,
): Promise<(XboxImportStartResponse & { keeping: boolean }) | null> {
  const bodies = claimHash
    ? [{ ...request, keepLogin: { claimHash } }, request]
    : [request];
  for (const body of bodies) {
    const startResponse = await requestLibraryJson<unknown>(
      `${apiEndpoint}/api/xbox/import/start`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal,
        onRateLimitWait: options.onRateLimitWait,
        ...(body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      },
    );
    if (body && startResponse.status === 400) continue;
    if (!startResponse.ok) {
      throw responseError(
        startResponse,
        t("Xbox import could not start ({{status}}).", {
          status: startResponse.status,
        }),
      );
    }
    return {
      ...parseXboxImportStart(startResponse.data),
      keeping: Boolean(body && "keepLogin" in body),
    };
  }
  return null;
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
  const achievementLists = games.flatMap((game) =>
    game.achievements ? [game.achievements] : [],
  );

  return {
    ...(achievementLists.length ? { achievementLists } : {}),
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
    await rateLimitedFetch(`${apiEndpoint}/api/xbox/import/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId } satisfies XboxImportCancelRequest),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    // Best effort: the backend TTL still removes an abandoned attempt.
  } finally {
    globalThis.clearTimeout(timeout);
  }
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
    throw new Error(t("Xbox import returned an invalid sign-in response."));
  }
  let url: URL;
  try {
    url = new URL(record.authorizeUrl);
  } catch {
    throw new Error(t("Xbox import returned an invalid sign-in URL."));
  }
  if (
    url.origin !== "https://login.microsoftonline.com" ||
    url.pathname !== "/consumers/oauth2/v2.0/authorize" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(t("Xbox import returned an unsupported sign-in URL."));
  }
  return {
    attemptId: record.attemptId,
    authorizeUrl: record.authorizeUrl,
  };
}

function parseXboxImportResult(value: unknown): ParsedXboxImportResult {
  const record = asRecord(value);
  if (!record || typeof record.status !== "string") {
    throw new Error(t("Xbox import returned an invalid status."));
  }
  const loginReady = record.loginReady === true;
  if (record.status === "pending") {
    if (
      record.stage !== undefined &&
      record.stage !== "authorization" &&
      record.stage !== "history"
    ) {
      throw new Error(t("Xbox import returned an invalid progress stage."));
    }
    return {
      status: "pending",
      loginReady,
      ...(record.stage === "authorization" || record.stage === "history"
        ? { stage: record.stage }
        : {}),
    };
  }
  if (record.status === "done") {
    if (!Array.isArray(record.games)) {
      throw new Error(t("Xbox import returned an invalid game list."));
    }
    return {
      status: "done",
      loginReady,
      games: record.games.map(parseXboxImportGame),
    };
  }
  if (record.status === "failed" && isXboxFailureReason(record.reason)) {
    if (record.stage !== undefined && !isXboxFailureStage(record.stage)) {
      throw new Error(t("Xbox import returned an invalid failure stage."));
    }
    if (
      record.accountLabel !== undefined &&
      (typeof record.accountLabel !== "string" || !record.accountLabel.trim())
    ) {
      throw new Error(t("Xbox import returned an invalid account label."));
    }
    if (
      record.errorCode !== undefined &&
      (typeof record.errorCode !== "string" || !record.errorCode.trim())
    ) {
      throw new Error(
        t("Xbox import returned an invalid Microsoft error code."),
      );
    }
    return {
      status: "failed",
      loginReady,
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
  throw new Error(t("Xbox import returned an invalid status."));
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
    throw new Error(t("Xbox import returned invalid game data."));
  }
  // A broken list never costs the game its import: it is just left out.
  const achievements = parseAchievementList(record.achievements);
  return {
    externalId: record.externalId,
    name: record.name,
    providerSeconds: record.providerSeconds,
    ...(typeof record.providerLastPlayedAt === "string"
      ? { providerLastPlayedAt: record.providerLastPlayedAt }
      : {}),
    candidates: uniqueGames(record.candidates.map(parseLibraryGameMetadata)),
    ...(achievements?.provider === "xbox" &&
    achievements.externalId === record.externalId
      ? { achievements }
      : {}),
    ...(isXboxAchievementError(record.achievementError)
      ? { achievementError: record.achievementError }
      : {}),
  };
}

function isXboxAchievementError(value: unknown): value is XboxAchievementError {
  return (
    value === "unavailable" ||
    value === "forbidden" ||
    value === "rate_limited" ||
    value === "failed"
  );
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

// Whole sentences, joined with spaces.
export function xboxImportFailureMessage(context: XboxFailureContext) {
  const account = context.accountLabel
    ? t("Microsoft account: {{account}}.", { account: context.accountLabel })
    : null;
  const recovery = t(
    "Use the Microsoft account that belongs to your Xbox gamertag. If you are not sure, use Copy sign-in link and open it in a private browser window.",
  );
  const sentences = ((): Array<string | null> => {
    switch (context.stage) {
      case "authorization":
        return [
          t("Microsoft sign-in was not completed."),
          context.errorCode
            ? t("Microsoft returned {{code}}.", { code: context.errorCode })
            : null,
          recovery,
        ];
      case "microsoft_token":
        return [
          t(
            "Microsoft answered, but PlayCounter could not finish the sign-in.",
          ),
          recovery,
        ];
      case "xbox_user_token":
        return [
          t("Microsoft sign-in completed."),
          account,
          t("Xbox Live did not accept this account."),
          recovery,
        ];
      case "xbox_xsts":
        return [
          t("Microsoft sign-in completed."),
          account,
          t("Xbox Live could not create a gaming session for this account."),
          recovery,
        ];
      case "title_history":
        return [
          t("Xbox sign-in completed."),
          account,
          t("Xbox did not send back any game history."),
          recovery,
        ];
    }
    switch (context.reason) {
      case "cancelled":
        return [t("Xbox sign-in was cancelled.")];
      case "timed_out":
        return [t("Xbox sign-in timed out."), recovery];
      case "oauth_error":
        return [t("Microsoft sign-in failed."), account, recovery];
      case "xbox_api_error":
        return [
          t("Xbox could not send back your game history."),
          account,
          recovery,
        ];
      default:
        return [t("The Xbox import failed. Please try again later.")];
    }
  })();
  return sentences.filter(Boolean).join(" ");
}

function ensureNotAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  const error = new Error(t("Xbox sign-in was cancelled."));
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
      const error = new Error(t("Xbox sign-in was cancelled."));
      error.name = "AbortError";
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
