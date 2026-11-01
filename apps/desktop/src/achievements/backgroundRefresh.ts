import {
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
  type ActiveSession,
  type GameIdentityRef,
} from "../store";
import { useKeptLogins } from "../library/keptLogins";
import {
  getLoginHealth,
  getLoginOperationRevision,
} from "../library/loginHealth";
import {
  refreshXboxAchievementList,
  XboxSignInRequiredError,
} from "../library/providers/xbox";
import { saveXboxAchievementLists } from "./xboxLists";

// Give the launcher a moment to upload unlocks after its game exits.
const AFTER_GAME_DELAY_MS = 15_000;

type Job = {
  game: GameIdentityRef;
  timer?: ReturnType<typeof setTimeout>;
  controller: AbortController;
  accountRevision: number;
};

const jobs = new Map<string, Job>();

function xboxReady() {
  return (
    useKeptLogins.getState().logins.some((login) => login.service === "xbox") &&
    getLoginHealth("xbox")?.status !== "needsSignIn"
  );
}

function currentGameSources(game: GameIdentityRef) {
  const state = useAppStore.getState();
  const resolve = createGameIdentityResolver(
    state.gameMetadata,
    state.exeCache,
    state.libraryImports,
  );
  const key = resolvedCanonicalGameKey(game, resolve);
  const running = state.activeSessions.some(
    (session) => resolvedCanonicalGameKey(session, resolve) === key,
  );
  const titleIds = [...state.libraryImports.values()]
    .filter(
      (entry) =>
        entry.provider === "xbox" &&
        resolvedCanonicalGameKey(
          { ...entry, gameName: entry.name },
          resolve,
        ) === key,
    )
    .map((entry) => entry.externalId);
  return { running, titleIds: new Set(titleIds) };
}

async function refresh(titleId: string, job: Job) {
  job.timer = undefined;
  const { running, titleIds } = currentGameSources(job.game);
  if (
    running ||
    !titleIds.has(titleId) ||
    !xboxReady() ||
    job.accountRevision !== getLoginOperationRevision("xbox")
  ) {
    if (jobs.get(titleId) === job) jobs.delete(titleId);
    return;
  }
  // Do not write a previous account's result after logout, account switching,
  // reset, or a server change while the network operation is in flight.
  const apiEndpoint = useAppStore.getState().settings.apiEndpoint;
  const account = useKeptLogins
    .getState()
    .logins.find((login) => login.service === "xbox");
  const stopWatchingAccount = useKeptLogins.subscribe((state) => {
    const current = state.logins.find((login) => login.service === "xbox");
    if (!current || current.name !== account?.name) job.controller.abort();
  });
  try {
    const result = await refreshXboxAchievementList(titleId, {
      apiEndpoint,
      signal: job.controller.signal,
      savedLoginOnly: true,
    });
    const currentAccount = useKeptLogins
      .getState()
      .logins.find((login) => login.service === "xbox");
    const sources = currentGameSources(job.game);
    if (
      job.controller.signal.aborted ||
      !xboxReady() ||
      job.accountRevision !== getLoginOperationRevision("xbox") ||
      useAppStore.getState().settings.apiEndpoint !== apiEndpoint ||
      currentAccount?.name !== account?.name ||
      sources.running ||
      !sources.titleIds.has(titleId)
    )
      return;
    if ("list" in result) {
      await saveXboxAchievementLists([result.list], { show: true });
    }
  } catch (error) {
    // A background task never opens account UI. The provider records expired
    // credentials in loginHealth; all failures preserve the previous list.
    if (error instanceof XboxSignInRequiredError) return;
  } finally {
    stopWatchingAccount();
    if (jobs.get(titleId) === job) jobs.delete(titleId);
  }
}

/** Called after a session of play has been removed from tracking. The sign-in
 *  is checked when the refresh runs: kept sign-ins load a few seconds after
 *  the start, when a game that ended while PlayCounter was closed ends. */
export function schedulePostGameAchievementRefresh(session: ActiveSession) {
  const { running, titleIds } = currentGameSources(session);
  if (running) return;
  for (const titleId of titleIds) {
    const previous = jobs.get(titleId);
    if (previous && previous.timer === undefined) continue;
    if (previous?.timer !== undefined) clearTimeout(previous.timer);
    const job: Job = {
      game: { ...session },
      controller: new AbortController(),
      accountRevision: getLoginOperationRevision("xbox"),
    };
    job.timer = setTimeout(
      () => void refresh(titleId, job),
      AFTER_GAME_DELAY_MS,
    );
    jobs.set(titleId, job);
  }
}

export function disposePostGameAchievementRefresh() {
  for (const job of jobs.values()) {
    if (job.timer !== undefined) clearTimeout(job.timer);
    job.controller.abort();
  }
  jobs.clear();
}
