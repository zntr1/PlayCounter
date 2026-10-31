import { Download, Gamepad2 } from "lucide-react";
import type { ReactNode } from "react";
import { getT } from "../../i18n";
import { importExeCandidates } from "../../library/exeCandidates";
import { searchLibraryGames } from "../../library/gameLookup";
import {
  requiresExecutableChoice,
  startsUnchecked,
} from "../../library/importGroups";
import { importProfile } from "../../library/importProfiles";
import {
  browseGameFile,
  importOneGame,
  pickGameFile,
  pickImportGame,
  setImportChoices,
  skipImportGame,
  unskipImportGame,
  type ImportSession,
} from "../../library/importSession";
import type { ScannedExecutable } from "../../library/types";
import { useAppStore } from "../../store";
import { GameCover } from "../GameCover";
import { Button } from "../primitives";
import { GameFilePicker } from "./GameFilePicker";
import { GameMatchPicker } from "./GameMatchPicker";
import {
  lastPlayedText,
  playtimeGrowth,
  playtimeText,
  unavailableReason,
  type ImportRow,
} from "./importRows";
import { launcherIdLabel } from "./importTexts";

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
  const { game } = row;
  const id = game.externalId;
  const lastPlayed = lastPlayedText(game);
  const files =
    row.resolved?.status === "resolved" ? row.resolved.executables : [];
  const skipped = session.skipped.has(id);
  return (
    <section
      aria-label={row.title}
      className="grid min-w-0 content-start gap-5 rounded-lg border border-border bg-surface p-5 shadow-raised"
    >
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
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-sm">
            <Fact label={t("Playtime")}>
              {row.group === "imported" && playtimeGrowth(row)
                ? playtimeGrowth(row)
                : playtimeText(game)}
            </Fact>
            {lastPlayed ? (
              <Fact label={t("Last played")}>{lastPlayed}</Fact>
            ) : null}
            <Fact label={t("On this PC")}>
              {game.installed
                ? (game.installPath ?? t("Installed"))
                : game.installationStatusUnknown
                  ? t("Installation not checked")
                  : t("Not installed")}
            </Fact>
            <Fact label={launcherIdLabel(session.providerId)}>
              {game.externalId}
            </Fact>
            {row.resolved?.status === "resolved" ? (
              <Fact label={t("Game files")}>
                {files.length
                  ? t("{{count}} known game files", { count: files.length })
                  : t("No known game file")}
              </Fact>
            ) : null}
          </dl>
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
              onClick={() => unskipImportGame(id)}
              className="rounded font-semibold text-accent-ink hover:underline"
            >
              {t("Decide now")}
            </button>
          </p>
        ) : (
          <ImportDecision
            session={session}
            row={row}
            onSkip={() => skipImportGame(id, nextToDecide)}
          />
        )
      ) : row.group === "imported" ? (
        <>
          <p className="text-sm text-text-muted">
            {t("Already in My Games. Check it in the list to import it again.")}
          </p>
          {row.showsFile ? <FileQuestion session={session} row={row} /> : null}
        </>
      ) : row.group === "unavailable" ? (
        <p className="text-sm text-text-muted">{unavailableReason(game)}</p>
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

/** "Which game is it?" and "Which file starts it?", then one Import. */
function ImportDecision({
  session,
  row,
  onSkip,
}: {
  session: ImportSession;
  row: ImportRow;
  onSkip: () => void;
}) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const profile = importProfile(session.providerId);
  const { game } = row;
  const id = game.externalId;
  const pick = session.picks[id];
  const requiresFile = requiresExecutableChoice(
    game,
    row.resolved,
    ignoredProcesses,
  );
  const canImport =
    session.capability === "supported" &&
    (!row.needsGame || Boolean(pick)) &&
    (!requiresFile || Boolean(session.manualExecutables[id]));
  const launcherTitle = game.name ?? row.title;
  return (
    <div className="grid gap-5 rounded-xl border border-accent/30 bg-surface-hover/40 p-4">
      {row.needsGame ? (
        <section>
          <h4 className="mb-2.5 text-sm font-semibold text-text">
            {t("Which game is “{{title}}”?", { title: launcherTitle })}
          </h4>
          <GameMatchPicker
            key={id}
            title={launcherTitle}
            candidates={session.choices[id] ?? row.resolved?.candidates ?? []}
            selectedId={pick?.igdbId ?? null}
            onSelect={(choice) => pickImportGame(id, choice)}
            onResults={(games) => setImportChoices(id, games)}
            search={(query, signal) =>
              searchLibraryGames(apiEndpoint, query, {
                signal,
                mainGamesAndRemastersOnly: profile.mainGamesOnlySearch,
              })
            }
            searchOnOpen={
              startsUnchecked(game) &&
              Boolean(game.name) &&
              !row.resolved?.candidates?.length
            }
          />
        </section>
      ) : null}
      {row.showsFile ? <FileQuestion session={session} row={row} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto min-w-0 flex-1 basis-60 text-xs leading-5 text-text-faint">
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
        <Button variant="ghost" onClick={onSkip}>
          {t("Skip for now")}
        </Button>
        <Button
          variant="primary"
          icon={Download}
          loading={session.busy === id}
          disabled={!canImport}
          onClick={() => void importOneGame(id)}
        >
          {t("Import")}
        </Button>
      </div>
    </div>
  );
}

function FileQuestion({
  session,
  row,
}: {
  session: ImportSession;
  row: ImportRow;
}) {
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
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
    <section>
      <h4 className="mb-2.5 text-sm font-semibold text-text">
        {t("Which file starts the game?")}
      </h4>
      <GameFilePicker
        gameName={row.title}
        options={options}
        value={session.manualExecutables[id]}
        onPick={(relativePath) => pickGameFile(id, relativePath)}
        onBrowse={() => void browseGameFile(id)}
        browsing={session.browsing === id}
      />
    </section>
  );
}
