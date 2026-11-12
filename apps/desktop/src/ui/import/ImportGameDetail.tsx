import { AlertTriangle, Download, Gamepad2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getT } from "../../i18n";
import { importExeCandidates } from "../../library/exeCandidates";
import {
  requiresExecutableChoice,
  startsUnchecked,
} from "../../library/importGroups";
import { importProfile } from "../../library/importProfiles";
import type { ImportSession } from "../../library/importSession";
import type { ScannedExecutable } from "../../library/types";
import { useAppStore } from "../../store";
import { GameCover } from "../GameCover";
import { Button } from "../primitives";
import { GameFilePicker } from "./GameFilePicker";
import { GameMatchPicker } from "./GameMatchPicker";
import {
  useImportActions,
  useImportLibrary,
  useIsSampleImport,
} from "./importHost";
import { IMPORT_PANE_HEIGHT } from "./ImportQueue";
import {
  lastPlayedText,
  playtimeGrowth,
  playtimeText,
  unavailableReason,
  type ImportRow,
} from "./importRows";
import { launcherIdLabel, launcherName } from "./importTexts";

const t = getT("import");

/** The game picked in the list: its facts, and the decision it needs. */
export function ImportGameDetail({
  session,
  row,
  nextToDecide,
}: {
  session: ImportSession;
  row: ImportRow;
  /** The game to show after this one is skipped. */
  nextToDecide: string | null;
}) {
  const actions = useImportActions();
  const { game } = row;
  const id = game.externalId;
  const lastPlayed = lastPlayedText(game);
  const files =
    row.resolved?.status === "resolved" ? row.resolved.executables : [];
  const skipped = session.skipped.has(id);
  const matched = row.resolved?.game;
  // "Wrong game?" opens the picker; it stays open while a pick is in place.
  const [doubted, setDoubted] = useState(false);
  const offersWrongGame =
    row.canReplaceMatch && !(row.group === "attention" && skipped);
  const replacing =
    offersWrongGame && (doubted || row.replacement !== undefined);
  // A console game has no install or file on this PC to tell about.
  const consoleOnly = importProfile(session.providerId).consoleOnly;
  const deciding = !row.completed && row.group === "attention" && !skipped;
  return (
    // Every game's box is as high as the list, whatever it shows: what doesn't
    // fit scrolls above the bottom line, so Skip for now and Import stay in
    // one spot and Import can be clicked game after game.
    <section
      aria-label={row.title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-raised ${IMPORT_PANE_HEIGHT}`}
    >
      {/* One column as wide as the box, so a long path can't widen it. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-y-auto p-5">
        <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-5">
          <span className="grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-xl bg-surface-hover text-text-faint shadow-raised">
            {row.coverUrl ? (
              <GameCover
                src={row.coverUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <Gamepad2 size={26} aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-xl font-bold tracking-tight text-text">
              {row.title}
            </h3>
            {row.replacement && matched ? (
              <p className="mt-1 text-sm text-text-muted">
                {t("Your pick. {{launcher}} matched {{name}}.", {
                  launcher: launcherName(session.providerId),
                  name: matched.name,
                })}
              </p>
            ) : null}
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-sm">
              <Fact label={t("Playtime")}>
                {row.group === "imported" && playtimeGrowth(row)
                  ? playtimeGrowth(row)
                  : playtimeText(game)}
              </Fact>
              {lastPlayed ? (
                <Fact label={t("Last played")}>{lastPlayed}</Fact>
              ) : null}
              {consoleOnly ? null : (
                <Fact label={t("On this PC")}>
                  {game.installed
                    ? (game.installPath ?? t("Installed"))
                    : game.installationStatusUnknown
                      ? t("Installation not checked")
                      : t("Not installed")}
                </Fact>
              )}
              <Fact label={launcherIdLabel(session.providerId)}>
                {game.externalId}
              </Fact>
              {row.resolved?.status === "resolved" &&
              !row.replacement &&
              !consoleOnly ? (
                <Fact label={t("Game files")}>
                  {files.length
                    ? t("{{count}} known game files", { count: files.length })
                    : t("No known game file")}
                </Fact>
              ) : null}
            </dl>
            {game.consoleUnknown ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning-border/60 bg-warning-tint/40 px-3 py-2 text-xs leading-5 text-warning">
                <AlertTriangle
                  size={14}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
                <span className="min-w-0">
                  {t(
                    "Sony lists this game without a console. Check it only if you played it yourself and want to add it to your PlayCounter library.",
                  )}
                </span>
              </p>
            ) : null}
            {offersWrongGame && !replacing ? (
              <button
                type="button"
                data-tour="import-wrong-game"
                onClick={() => setDoubted(true)}
                className="mt-3 rounded text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {t("Wrong game?")}
              </button>
            ) : null}
          </div>
        </div>

        {row.completed ? (
          <p className="text-sm text-success">{t("Imported just now")}</p>
        ) : row.group === "attention" ? (
          skipped ? (
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-text-muted">
              {t("Skipped for now")}
              <button
                type="button"
                onClick={() => actions.unskip(id)}
                className="rounded font-semibold text-accent-ink hover:underline"
              >
                {t("Decide now")}
              </button>
            </p>
          ) : (
            <ImportDecision session={session} row={row} replacing={replacing} />
          )
        ) : row.group === "imported" ? (
          <>
            <p className="text-sm text-text-muted">
              {t(
                "Already in My Games. Check it in the list to import it again.",
              )}
            </p>
            {row.showsFile ? (
              <FileQuestion session={session} row={row} />
            ) : null}
          </>
        ) : row.group === "unavailable" ? (
          <p className="text-sm text-text-muted">{unavailableReason(game)}</p>
        ) : replacing ? (
          <div className="grid gap-4 rounded-xl border border-accent/30 bg-surface-hover/40 p-4">
            <MatchReplacement session={session} row={row} />
            <p className="text-xs leading-5 text-text-faint">
              {t(
                "Your pick is imported instead of the matched game. Nothing is sent.",
              )}
            </p>
          </div>
        ) : null}
      </div>
      {deciding ? (
        <DecisionActions
          session={session}
          row={row}
          nextToDecide={nextToDecide}
        />
      ) : null}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-text">{children}</dd>
    </>
  );
}

/** A click on Import this soon after an Import moved on to the game was meant
 *  for the game before. */
const MOVED_ON_CLICK_PAUSE_MS = 500;

/** Skip for now and Import, for a game that needs the player. */
function DecisionActions({
  session,
  row,
  nextToDecide,
}: {
  session: ImportSession;
  row: ImportRow;
  /** The game to show after this one is skipped or imported. */
  nextToDecide: string | null;
}) {
  const actions = useImportActions();
  const { ignoredProcesses } = useImportLibrary();
  const { game } = row;
  const id = game.externalId;
  const requiresFile = requiresExecutableChoice(
    game,
    row.resolved,
    ignoredProcesses,
  );
  const canImport =
    session.capability === "supported" &&
    (!row.needsGame || Boolean(session.picks[id])) &&
    (!requiresFile || Boolean(session.manualExecutables[id]));
  return (
    <div className="flex min-w-0 shrink-0 flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
      <Button variant="ghost" onClick={() => actions.skip(id, nextToDecide)}>
        {t("Skip for now")}
      </Button>
      <Button
        variant="primary"
        icon={Download}
        loading={session.importing.has(id)}
        disabled={!canImport}
        data-tour="import-game-import"
        onClick={() => {
          const { movedOn } = session;
          if (
            movedOn?.externalId === id &&
            Date.now() - movedOn.at < MOVED_ON_CLICK_PAUSE_MS
          )
            return;
          actions.importOne(id, nextToDecide);
        }}
      >
        {t("Import")}
      </Button>
    </div>
  );
}

/** "Which game is it?" and "Which file starts it?". */
function ImportDecision({
  session,
  row,
  replacing,
}: {
  session: ImportSession;
  row: ImportRow;
  /** "Wrong game?" is open on a matched game. */
  replacing: boolean;
}) {
  const actions = useImportActions();
  const sample = useIsSampleImport();
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const profile = importProfile(session.providerId);
  const { game } = row;
  const id = game.externalId;
  const pick = session.picks[id];
  const pickedId = row.needsGame ? pick?.id : undefined;
  // Asked as soon as the game is shown, so Import does not wait for the server.
  useEffect(() => {
    if (pickedId !== undefined) actions.lookUpPickedGame(pickedId);
  }, [actions, pickedId]);
  const launcherTitle = game.name ?? row.title;
  const candidates = session.choices[id] ?? row.resolved?.candidates ?? [];
  return (
    <div className="grid gap-5 rounded-xl border border-accent/30 bg-surface-hover/40 p-4">
      {row.needsGame ? (
        <section data-tour="import-pick-game">
          <h4 className="mb-2.5 text-sm font-semibold text-text">
            {t("Which game is “{{title}}”?", { title: launcherTitle })}
          </h4>
          <GameMatchPicker
            key={id}
            practice={sample}
            title={launcherTitle}
            candidates={candidates}
            selectedId={pick?.igdbId ?? null}
            onSelect={(choice) => actions.pickGame(id, choice)}
            onResults={(games) => actions.setChoices(id, games)}
            search={(query, signal) =>
              actions.searchGames(apiEndpoint, query, {
                signal,
                mainGamesAndRemastersOnly: profile.mainGamesOnlySearch,
              })
            }
            searchOnOpen={
              startsUnchecked(game) &&
              Boolean(game.name) &&
              !row.resolved?.candidates?.length &&
              candidates.length === 0
            }
          />
        </section>
      ) : replacing ? (
        <MatchReplacement session={session} row={row} />
      ) : null}
      {row.showsFile ? <FileQuestion session={session} row={row} /> : null}
      <p className="text-xs leading-5 text-text-faint">
        {row.showsFile
          ? t(
              "A game file PlayCounter doesn't know yet goes to the community for review.",
            )
          : profile.hasPlaytime
            ? t(
                "Game names are not always unique. Confirm the right game before its playtime is added to your library.",
              )
            : t(
                "Game names are not always unique. Confirm the right game before adding it to your library.",
              )}
      </p>
    </div>
  );
}

/** "Wrong game?": the server's match first, then a search for the launcher's
 *  name for the game. Picking the match again takes the pick back. */
function MatchReplacement({
  session,
  row,
}: {
  session: ImportSession;
  row: ImportRow;
}) {
  const actions = useImportActions();
  const sample = useIsSampleImport();
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const profile = importProfile(session.providerId);
  const id = row.game.externalId;
  const pickedId = row.replacement?.id;
  // Asked as soon as it is picked, so Import does not wait for the server.
  useEffect(() => {
    if (pickedId !== undefined) actions.lookUpPickedGame(pickedId);
  }, [actions, pickedId]);
  const matched = row.resolved?.game;
  if (!matched) return null;
  const launcherTitle = row.game.name ?? matched.name;
  const results = session.choices[id];
  return (
    <section>
      <h4 className="mb-2.5 text-sm font-semibold text-text">
        {t("Which game is “{{title}}”?", { title: launcherTitle })}
      </h4>
      <GameMatchPicker
        practice={sample}
        title={launcherTitle}
        candidates={[
          matched,
          ...(results ?? []).filter((game) => game.igdbId !== matched.igdbId),
        ]}
        matchedId={matched.igdbId}
        selectedId={row.replacement?.igdbId ?? matched.igdbId ?? null}
        onSelect={(choice) => actions.replaceMatch(id, choice)}
        onResults={(games) => actions.setReplacementChoices(id, games)}
        search={(query, signal) =>
          actions.searchGames(apiEndpoint, query, {
            signal,
            mainGamesAndRemastersOnly: profile.mainGamesOnlySearch,
          })
        }
        searchOnOpen={results === undefined}
      />
    </section>
  );
}

function FileQuestion({
  session,
  row,
}: {
  session: ImportSession;
  row: ImportRow;
}) {
  const actions = useImportActions();
  const { ignoredProcesses } = useImportLibrary();
  const id = row.game.externalId;
  const candidates = importExeCandidates(
    row.game.executables,
    row.resolved?.executables ?? [],
    row.resolved?.game?.name ?? row.game.name,
    ignoredProcesses,
  );
  const browsed: ScannedExecutable | undefined = session.browsedExecutables[id];
  const options =
    browsed &&
    !candidates.some(
      (candidate) =>
        candidate.relativePath.toLowerCase() ===
        browsed.relativePath.toLowerCase(),
    )
      ? [browsed, ...candidates]
      : candidates;
  return (
    <section data-tour="import-pick-file">
      <h4 className="mb-2.5 text-sm font-semibold text-text">
        {t("Which file starts the game?")}
      </h4>
      <GameFilePicker
        gameName={row.title}
        options={options}
        value={session.manualExecutables[id]}
        onPick={(relativePath) => actions.pickFile(id, relativePath)}
        onBrowse={() => actions.browseFile(id)}
        browsing={session.browsing === id}
      />
    </section>
  );
}
