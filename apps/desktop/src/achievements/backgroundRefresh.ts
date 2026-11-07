import type { AchievementList } from "@playcounter/shared";
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
import { saveAchievementLists } from "./achievementLists";
import { readEpicAchievements } from "./epic";
import { readGogAchievements } from "./gog";
import { readPlayStationTrophies } from "./playstation";

// Give the launcher a moment to upload unlocks after its game exits.
const AFTER_GAME_DELAY_MS = 15_000;

/** Lists that refresh with a kept launcher sign-in. */
type Provider = "xbox" | "epic" | "gog" | "playstation";
const PROVIDERS: readonly string[] = ["xbox", "epic", "gog", "playstation"];

type Job = {
  provider: Provider;
  externalId: string;
  game: GameIdentityRef;
  timer?: ReturnType<typeof setTimeout>;
  controller: AbortController;
  accountRevision: number;
};

const jobs = new Map<string, Job>();

function signedIn(provider: Provider) {
  return (
    useKeptLogins
      .getState()
      .logins.some((login) => login.service === provider) &&
    getLoginHealth(provider)?.status !== "needsSignIn"
  );
}

function account(provider: Provider) {
  return useKeptLogins
    .getState()
    .logins.find((login) => login.service === provider);
}

/** Whether the game runs, and its Xbox title ids, Epic app names, GOG
 *  product ids and PlayStation concept ids. */
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
  const sources = new Set(
    [...state.libraryImports.values()]
      .filter(
        (entry) =>
          PROVIDERS.includes(entry.provider) &&
          resolvedCanonicalGameKey(
            { ...entry, gameName: entry.name },
            resolve,
          ) === key,
      )
      .map((entry) => `${entry.provider}:${entry.externalId}`),
  );
  return { running, sources };
}

async function readList(job: Job, apiEndpoint: string) {
  if (job.provider !== "xbox") {
    const result = await (job.provider === "epic"
      ? readEpicAchievements(job.externalId)
      : job.provider === "gog"
        ? readGogAchievements(job.externalId)
        : readPlayStationTrophies(job.externalId));
    return "list" in result ? result.list : null;
  }
  const result = await refreshXboxAchievementList(job.externalId, {
    apiEndpoint,
    signal: job.controller.signal,
    savedLoginOnly: true,
  });
  return "list" in result ? result.list : null;
}

async function refresh(key: string, job: Job) {
  job.timer = undefined;
  const { running, sources } = currentGameSources(job.game);
  if (
    running ||
    !sources.has(key) ||
    !signedIn(job.provider) ||
    job.accountRevision !== getLoginOperationRevision(job.provider)
  ) {
    if (jobs.get(key) === job) jobs.delete(key);
    return;
  }
  // Do not write a previous account's result after logout, account switching,
  // reset, or a server change while the network operation is in flight.
  const apiEndpoint = useAppStore.getState().settings.apiEndpoint;
  const before = account(job.provider);
  const stopWatchingAccount = useKeptLogins.subscribe((state) => {
    const current = state.logins.find(
      (login) => login.service === job.provider,
    );
    if (!current || current.name !== before?.name) job.controller.abort();
  });
  try {
    const list: AchievementList | null = await readList(job, apiEndpoint);
    const current = currentGameSources(job.game);
    if (
      job.controller.signal.aborted ||
      !signedIn(job.provider) ||
      job.accountRevision !== getLoginOperationRevision(job.provider) ||
      useAppStore.getState().settings.apiEndpoint !== apiEndpoint ||
      account(job.provider)?.name !== before?.name ||
      current.running ||
      !current.sources.has(key)
    )
      return;
    if (list) await saveAchievementLists([list], { show: true });
  } catch (error) {
    // A background task never opens account UI. The providers record expired
    // credentials in loginHealth; all failures preserve the previous list.
    if (error instanceof XboxSignInRequiredError) return;
  } finally {
    stopWatchingAccount();
    if (jobs.get(key) === job) jobs.delete(key);
  }
}

/** Called after a session of play has been removed from tracking. The sign-in
 *  is checked when the refresh runs: kept sign-ins load a few seconds after
 *  the start, when a game that ended while PlayCounter was closed ends. */
export function schedulePostGameAchievementRefresh(session: ActiveSession) {
  const { running, sources } = currentGameSources(session);
  if (running) return;
  for (const key of sources) {
    const previous = jobs.get(key);
    if (previous && previous.timer === undefined) continue;
    if (previous?.timer !== undefined) clearTimeout(previous.timer);
    const [provider, ...rest] = key.split(":");
    const job: Job = {
      provider: provider as Provider,
      externalId: rest.join(":"),
      game: { ...session },
      controller: new AbortController(),
      accountRevision: getLoginOperationRevision(provider as Provider),
    };
    job.timer = setTimeout(() => void refresh(key, job), AFTER_GAME_DELAY_MS);
    jobs.set(key, job);
  }
}

export function disposePostGameAchievementRefresh() {
  for (const job of jobs.values()) {
    if (job.timer !== undefined) clearTimeout(job.timer);
    job.controller.abort();
  }
  jobs.clear();
}
