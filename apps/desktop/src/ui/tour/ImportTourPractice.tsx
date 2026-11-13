import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mergeReading } from "../../library/accountReadings";
import { needsGameChoice } from "../../library/importGroups";
import { buildLibraryImportCommit } from "../../library/importPlan";
import {
  createImportSession,
  rowMatch,
  selectableGameIds,
  selectedExecutableFor,
  type ImportSession,
} from "../../library/importSession";
import type { KeptLogin } from "../../library/keptLogins";
import type { LoginHealth } from "../../library/loginHealth";
import {
  libraryEntryKey,
  type LibraryImportCommit,
  type LibraryImportEntry,
  type ResolvedLibraryGame,
  type ScannedLibraryGame,
} from "../../library/types";
import { useAppStore, type GameMetadata } from "../../store";
import { ImportDone } from "../import/ImportDone";
import {
  SampleImport,
  type ImportActions,
  type ImportLibrary,
} from "../import/importHost";
import { ImportReview } from "../import/ImportReview";
import { LauncherCard } from "../import/LauncherCard";
import { TOUR_DEMO_EMULATOR } from "./tourDemoGame";
import { emitTourEvent } from "./tourEvents";

/* The practice importer of the guide "Import a launcher library": the app's
   own import screens, working on a sample Xbox account. The sample brings the
   games a scan would have found and does what the buttons do to them, so
   nothing is scanned, signed in, looked up or saved. What is imported lands
   in the sample's own "My Games" and is gone when the guide ends. */

const PROVIDER = "xbox";
const NOT_IGNORED: ReadonlySet<string> = new Set();
const key = (externalId: string) => libraryEntryKey(PROVIDER, externalId);

const igdb = (
  id: number,
  name: string,
  releaseYear: number,
  coverUrl = "",
): GameMetadata => ({
  id,
  igdbId: id,
  source: "igdb",
  name,
  releaseYear,
  coverUrl,
});

// i18n-exempt: sample game names, as the launcher and the game database
// spell them.
const DIABLO = igdb(-101, "Diablo IV", 2023, "/tour/diablo-iv-cover.webp");
const FORZA = igdb(-102, "Forza Horizon 5", 2021); // i18n-exempt: sample game name.
const SEA = igdb(-103, "Sea of Thieves", 2018); // i18n-exempt: sample game name.
// i18n-exempt: sample game name.
const GTA = igdb(-104, "Grand Theft Auto V", 2013, "/tour/gta-v-cover.webp");
const GTA_ONLINE = igdb(-105, "Grand Theft Auto Online", 2013); // i18n-exempt: sample game name.
// i18n-exempt: sample game name.
const MCC = igdb(-106, "Halo: The Master Chief Collection", 2014);
const HALO = igdb(-107, "Halo Infinite", 2021); // i18n-exempt: sample game name.

/** What a search in the sample can find: the sample's own games and the two
 *  titles the other practice searches use (the tour's Diablo IV is DIABLO). */
const SEARCHABLE: GameMetadata[] = [
  DIABLO,
  FORZA,
  SEA,
  GTA,
  GTA_ONLINE,
  MCC,
  HALO,
  igdb(-2, TOUR_DEMO_EMULATOR.gameName, 2002, TOUR_DEMO_EMULATOR.coverUrl),
];

/** The game that needs the player to say which game it is. */
const PICK_GAME = "1870475503";
/** The installed game that needs the file that starts it. */
const PICK_FILE = "1144039928";
const IN_MY_GAMES = "2043073184";

// i18n-exempt: a sample gamertag.
const ACCOUNT = { key: "playcounter-sample", name: "SamplePlayer" };
const SIGNED_IN: KeptLogin = {
  service: PROVIDER,
  name: ACCOUNT.name,
  savedAt: 0,
};
const HEALTHY: LoginHealth = {
  status: "valid",
  checkedAt: null,
  lastSuccessAt: null,
};

/** The sample: the import as the screens read it, and the sample's own list
 *  of imported games in place of the player's library. */
type Sample = {
  session: ImportSession;
  imports: ReadonlyMap<string, LibraryImportEntry>;
};

function scannedGames(): ScannedLibraryGame[] {
  const daysAgo = (days: number) =>
    Math.floor(Date.now() / 1000) - days * 86_400;
  const played = (
    externalId: string,
    name: string,
    playtimeSeconds: number,
    lastPlayedDaysAgo: number,
  ): ScannedLibraryGame => ({
    externalId,
    name,
    playtimeSeconds,
    lastPlayedUnix: daysAgo(lastPlayedDaysAgo),
    installed: false,
    executables: [],
  });
  return [
    played("1924792066", DIABLO.name, 232_200, 2),
    played("2030093255", FORZA.name, 111_900, 9),
    played("1717113201", SEA.name, 29_700, 41),
    // i18n-exempt: Xbox's name for the game, which matches no game exactly.
    played(PICK_GAME, "Grand Theft Auto V Enhanced", 310_320, 5),
    {
      ...played(PICK_FILE, MCC.name, 151_200, 17),
      installed: true,
      installPath: "C:\\XboxGames\\Halo- The Master Chief Collection\\Content",
      executables: [
        {
          fileName: "mcclauncher.exe",
          relativePath: "mcclauncher.exe",
          sizeBytes: 1_250_000,
          depth: 0,
        },
        {
          fileName: "MCC-Win64-Shipping.exe",
          relativePath: "MCC\\Binaries\\Win64\\MCC-Win64-Shipping.exe",
          sizeBytes: 71_600_000,
          depth: 3,
        },
      ],
    },
    played(IN_MY_GAMES, HALO.name, 55_800, 1),
  ];
}

const matched = (
  externalId: string,
  game: GameMetadata,
): [string, ResolvedLibraryGame] => [
  key(externalId),
  { key: key(externalId), status: "resolved", game, executables: [] },
];

/** The launcher card, before any game is looked for. */
function beforeScan(): Sample {
  return {
    imports: new Map(),
    session: {
      ...createImportSession(PROVIDER),
      phase: "ready",
      status: { provider: PROVIDER, available: true, checkedPaths: [] },
      accountId: 0,
      capability: "supported",
    },
  };
}

/** The review as a scan of the sample account leaves it. */
function afterScan(): Sample {
  const games = scannedGames();
  const earlier = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const inMyGames: LibraryImportEntry = {
    provider: PROVIDER,
    externalId: IN_MY_GAMES,
    igdbId: HALO.igdbId!,
    gameId: HALO.id,
    source: "igdb",
    name: HALO.name,
    coverUrl: HALO.coverUrl,
    importedAt: earlier,
    providerSeconds: 43_200,
    lastReadAt: earlier,
    linkedExeNames: [],
    linkedExeSources: [],
    accounts: [{ ...ACCOUNT, seconds: 43_200, readAt: earlier }],
  };
  const start = beforeScan();
  return {
    imports: new Map([[key(IN_MY_GAMES), inMyGames]]),
    session: {
      ...start.session,
      scannedScope: "account",
      scan: { games, warnings: [], partial: false, account: ACCOUNT },
      resolved: new Map([
        matched(games[0].externalId, DIABLO),
        matched(games[1].externalId, FORZA),
        matched(games[2].externalId, SEA),
        [
          key(PICK_GAME),
          {
            key: key(PICK_GAME),
            status: "unknown",
            executables: [],
            candidates: [GTA, GTA_ONLINE],
          },
        ],
        // Matched, but none of its known files is on this PC.
        matched(PICK_FILE, MCC),
      ]),
      saved: new Map([matched(IN_MY_GAMES, HALO)]),
      // As a scan checks them: every ready game, and the game in My Games
      // that has new playtime.
      selected: new Set([
        ...games.slice(0, 3).map((game) => game.externalId),
        IN_MY_GAMES,
      ]),
      // The first suggestion is picked, as a scan does.
      picks: { [PICK_GAME]: GTA },
      group: "ready",
    },
  };
}

const change = (sample: Sample, session: Partial<ImportSession>): Sample => ({
  ...sample,
  session: { ...sample.session, ...session },
});

const isImported = (sample: Sample, externalId: string) =>
  sample.imports.has(key(externalId));

const library = (sample: Sample): ImportLibrary => ({
  libraryImports: sample.imports,
  ignoredProcesses: NOT_IGNORED,
});

/** Saves commits into the sample's list, as an import saves them in My Games. */
function withImported(
  imports: Sample["imports"],
  commits: readonly LibraryImportCommit[],
) {
  const next = new Map(imports);
  for (const { entry } of commits) {
    const entryKey = key(entry.externalId);
    const previous = next.get(entryKey);
    const { accounts: _reading, ...read } = entry;
    next.set(entryKey, {
      ...read,
      importedAt: previous?.importedAt ?? entry.importedAt,
      ...mergeReading(previous, entry),
    });
  }
  return next;
}

function commitFor(
  sample: Sample,
  scanned: ScannedLibraryGame,
  resolved: ResolvedLibraryGame,
) {
  return buildLibraryImportCommit({
    provider: PROVIDER,
    scanned,
    resolved,
    selectedExecutable: selectedExecutableFor(sample.session, scanned),
    ignoredProcesses: NOT_IGNORED,
    account: sample.session.scan?.account,
  });
}

/** Import on one game that needed the player (importOneGame). */
function importOne(
  sample: Sample,
  externalId: string,
  next: string | null,
): Sample {
  const { session } = sample;
  const scanned = session.scan?.games.find(
    (game) => game.externalId === externalId,
  );
  if (!scanned) return sample;
  const inLibrary = isImported(sample, externalId);
  let resolved = rowMatch(session, externalId, inLibrary);
  const needsGame = needsGameChoice(PROVIDER, scanned, resolved);
  const pick = needsGame
    ? session.picks[externalId]
    : inLibrary
      ? undefined
      : session.replacements[externalId];
  if (pick)
    resolved = {
      key: key(externalId),
      status: "resolved",
      game: pick,
      executables: [],
      candidates: resolved?.candidates,
    };
  if (!resolved || (needsGame && !pick)) return sample;
  const commit = commitFor(sample, scanned, resolved);
  if (!commit) return sample;
  const selected = new Set(session.selected);
  selected.delete(externalId);
  return {
    imports: withImported(sample.imports, [commit]),
    session: {
      ...session,
      saved: new Map(session.saved).set(key(externalId), resolved),
      completed: new Set(session.completed).add(externalId),
      selected,
      // The next game that needs the player shows at once.
      ...(session.current === externalId || session.current === null
        ? { current: next }
        : {}),
    },
  };
}

/** The import bar: every checked game of the open group (importSelectedGames). */
function importSelected(
  sample: Sample,
  externalIds: readonly string[],
): Sample {
  const { session } = sample;
  const chosen = new Set(externalIds);
  const selectable = selectableGameIds(session, library(sample));
  const added: string[] = [];
  let updated = 0;
  const commits: LibraryImportCommit[] = [];
  const saved = new Map(session.saved);
  for (const game of session.scan?.games ?? []) {
    const id = game.externalId;
    if (!chosen.has(id) || !selectable.has(id)) continue;
    const inLibrary = isImported(sample, id);
    const replacement = inLibrary ? undefined : session.replacements[id];
    const resolved: ResolvedLibraryGame | undefined = replacement
      ? { key: key(id), status: "resolved", game: replacement, executables: [] }
      : rowMatch(session, id, inLibrary);
    const commit = resolved ? commitFor(sample, game, resolved) : null;
    if (!resolved || !commit) continue;
    if (inLibrary) updated += 1;
    else added.push(id);
    commits.push(commit);
    saved.set(key(id), resolved);
  }
  if (commits.length === 0) return sample;
  const imported = new Set(commits.map((commit) => commit.entry.externalId));
  return {
    imports: withImported(sample.imports, commits),
    session: {
      ...session,
      saved,
      selected: new Set(
        [...session.selected].filter((id) => !imported.has(id)),
      ),
      phase: "done",
      lastImport: { added, updated, notImported: [] },
    },
  };
}

const readyIds = (sample: Sample) =>
  [...selectableGameIds(sample.session, library(sample))].filter(
    (id) => !isImported(sample, id),
  );

/** A step's sample when it is reached by Back or a jump: as if every step
 *  before it had just been done. */
function sampleAt(stepId: string): Sample {
  if (stepId === "start") return beforeScan();
  const scanned = afterScan();
  if (stepId === "ready") return scanned;
  const needsGame = change(scanned, { group: "attention", current: PICK_GAME });
  if (stepId === "pick-game") return needsGame;
  const needsFile = importOne(needsGame, PICK_GAME, PICK_FILE);
  if (stepId === "pick-file") return needsFile;
  const fileOf = needsFile.session.scan!.games.find(
    (game) => game.externalId === PICK_FILE,
  )!.executables[1].relativePath;
  const readyLeft = change(
    importOne(
      change(needsFile, { manualExecutables: { [PICK_FILE]: fileOf } }),
      PICK_FILE,
      null,
    ),
    { group: "ready", current: null },
  );
  if (stepId === "import") return readyLeft;
  const done = importSelected(readyLeft, readyIds(readyLeft));
  if (stepId === "totals" || stepId === "auto-add") return done;
  return change(done, { phase: "ready", group: "imported", current: null });
}

/** A step's sample when the guide moves on to it: what the player did stays,
 *  as long as the step can still show its part. */
function moveOn(sample: Sample, stepId: string): Sample {
  const { session } = sample;
  if (!session.scan) return sampleAt(stepId);
  switch (stepId) {
    case "pick-file":
      return isImported(sample, PICK_FILE)
        ? sampleAt(stepId)
        : change(sample, {
            phase: "ready",
            group: "attention",
            current: PICK_FILE,
          });
    case "import": {
      const ready = readyIds(sample);
      if (ready.length === 0) return sampleAt(stepId);
      return change(sample, {
        phase: "ready",
        group: "ready",
        current: null,
        // The bar needs a checked game to import.
        selected: ready.some((id) => session.selected.has(id))
          ? session.selected
          : new Set([...session.selected, ...ready]),
      });
    }
    case "totals":
    case "auto-add":
      return session.phase === "done" && session.lastImport
        ? sample
        : sampleAt(stepId);
    case "again":
      return change(sample, {
        phase: "ready",
        group: "imported",
        current: null,
      });
    default:
      return sampleAt(stepId);
  }
}

function searchSamples(query: string) {
  const wanted = query.trim().toLowerCase();
  return SEARCHABLE.filter((game) => game.name.toLowerCase().includes(wanted));
}

export function ImportTourPractice({ stepId }: { stepId: string }) {
  const resetToken = useAppStore((state) => state.demoResetToken);
  const [sample, setSample] = useState(() => sampleAt(stepId));
  // The sample as the last click left it: a click's result is known at once,
  // so the guide can be told in the same breath.
  const latest = useRef(sample);
  const step = useRef(stepId);
  const entered = useRef({ stepId, resetToken });
  step.current = stepId;

  const apply = useCallback((update: (current: Sample) => Sample) => {
    const before = latest.current;
    latest.current = update(before);
    setSample(latest.current);
    return latest.current !== before;
  }, []);

  // Back and a jump in the guide's list put the step back to its start;
  // moving on keeps what the player did.
  useLayoutEffect(() => {
    const before = entered.current;
    entered.current = { stepId, resetToken };
    if (before.resetToken !== resetToken) apply(() => sampleAt(stepId));
    else if (before.stepId !== stepId)
      apply((current) => moveOn(current, stepId));
  }, [apply, stepId, resetToken]);

  const actions = useMemo<ImportActions>(() => {
    /** The step's task is done: by the player, and during that step. */
    const finish = (taskOf: string) => {
      if (step.current === taskOf) emitTourEvent("demo.step-completed");
    };
    const set = (update: (session: ImportSession) => Partial<ImportSession>) =>
      void apply((current) => change(current, update(current.session)));
    return {
      // An Xbox account has nothing to choose.
      chooseScope: () => {},
      chooseAccount: () => {},
      showGroup: (group) => set(() => ({ group, current: null })),
      showGame: (externalId) => set(() => ({ current: externalId })),
      setGameSelected: (externalId, checked) =>
        set((session) => {
          const selected = new Set(session.selected);
          if (checked) selected.add(externalId);
          else selected.delete(externalId);
          return { selected };
        }),
      setGamesSelected: (externalIds, checked) =>
        set((session) => {
          const selected = new Set(session.selected);
          for (const id of externalIds) {
            if (checked) selected.add(id);
            else selected.delete(id);
          }
          return { selected };
        }),
      importSelected: (externalIds) => {
        if (apply((current) => importSelected(current, externalIds)))
          finish("import");
      },
      importOne: (externalId, next) => {
        if (!apply((current) => importOne(current, externalId, next))) return;
        if (externalId === PICK_GAME) finish("pick-game");
        if (externalId === PICK_FILE) finish("pick-file");
      },
      skip: (externalId, next) =>
        set((session) => ({
          skipped: new Set(session.skipped).add(externalId),
          current: next,
        })),
      unskip: (externalId) =>
        set((session) => {
          const skipped = new Set(session.skipped);
          skipped.delete(externalId);
          return { skipped, current: externalId };
        }),
      pickGame: (externalId, game) =>
        set((session) => ({ picks: { ...session.picks, [externalId]: game } })),
      // Search results: the first one is picked, as in the app.
      setChoices: (externalId, games) =>
        set((session) => ({
          choices: { ...session.choices, [externalId]: games },
          picks: games[0]
            ? { ...session.picks, [externalId]: games[0] }
            : Object.fromEntries(
                Object.entries(session.picks).filter(
                  ([id]) => id !== externalId,
                ),
              ),
        })),
      // "Wrong game?": picking the matched game takes the pick back.
      replaceMatch: (externalId, game) =>
        set((session) => {
          const matchedGame = session.resolved.get(key(externalId))?.game;
          const replacements = { ...session.replacements };
          if (game.igdbId === matchedGame?.igdbId)
            delete replacements[externalId];
          else replacements[externalId] = game;
          return { replacements };
        }),
      setReplacementChoices: (externalId, games) =>
        set((session) => ({
          choices: { ...session.choices, [externalId]: games },
        })),
      // A picked sample game has nothing to look up.
      lookUpPickedGame: () => {},
      searchGames: async (_apiEndpoint, query) => searchSamples(query),
      pickFile: (externalId, relativePath) =>
        set((session) => ({
          manualExecutables: {
            ...session.manualExecutables,
            [externalId]: relativePath,
          },
        })),
      // The sample has no folder on this PC to browse.
      browseFile: () => {},
      reviewRemaining: () =>
        set(() => ({
          phase: "ready",
          group: "attention",
          current: null,
          skipped: new Set(),
        })),
      showList: () => set(() => ({ phase: "ready" })),
      showUpdates: () =>
        set(() => ({ phase: "ready", group: "imported", current: null })),
      // The sample's games are not in My Games.
      openMyGames: () => {},
    };
  }, [apply]);

  const sampleLibrary = useMemo(() => library(sample), [sample]);
  const { session } = sample;
  return (
    <SampleImport actions={actions} library={sampleLibrary}>
      <div
        data-tour="demo-import"
        // The review measures this box, to end its list at the bottom of it
        // as it does with the window in the app.
        data-import-content
        className="-m-1 min-h-0 overflow-y-auto p-1"
      >
        {!session.scan ? (
          <LauncherCard
            session={session}
            keptLogin={SIGNED_IN}
            health={HEALTHY}
            battleNetNoticeSeen={false}
            onFind={() => {
              apply(() => sampleAt("ready"));
              if (step.current === "start")
                emitTourEvent("demo.step-completed");
            }}
            onCopySignInLink={() => {}}
            onSignOut={() => {}}
          />
        ) : session.phase === "done" && session.lastImport ? (
          <ImportDone session={session} />
        ) : (
          <ImportReview
            session={session}
            keptLogin={SIGNED_IN}
            health={HEALTHY}
            // A new scan finds the sample account as the step needs it.
            onScanAgain={() =>
              apply(() =>
                sampleAt(step.current === "start" ? "ready" : step.current),
              )
            }
            onChange={() => {}}
            onSignOut={() => {}}
          />
        )}
      </div>
    </SampleImport>
  );
}

export default ImportTourPractice;
