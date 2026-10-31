import { Download, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import { getT } from "../../i18n";
import { nativeText } from "../../nativeText";
import type { KeptLogin } from "../../library/keptLogins";
import type { LoginHealth } from "../../library/loginHealth";
import {
  IMPORT_GROUP_ORDER,
  type ImportGroupKey,
} from "../../library/importGroups";
import { importProfile } from "../../library/importProfiles";
import {
  importSelectedGames,
  selectableGameIds,
  setGameSelected,
  setGamesSelected,
  showImportGame,
  showImportGroup,
  type ImportSession,
} from "../../library/importSession";
import { useAppStore } from "../../store";
import { Panel } from "../components";
import { Button } from "../primitives";
import { ImportError } from "./ImportError";
import { ImportGameDetail } from "./ImportGameDetail";
import { ImportQueue } from "./ImportQueue";
import { importRows, type ImportRow } from "./importRows";
import { ImportShelves } from "./ImportShelves";
import { launcherName } from "./importTexts";
import { AccountLine, LauncherLogo } from "./LauncherIdentity";

const t = getT("import");

/** Rows of the scan, sorted onto the four shelves. Showing, checking or
 *  skipping a game leaves them as they are. */
export function useImportGroups(session: ImportSession) {
  const libraryImports = useAppStore((state) => state.libraryImports);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const { providerId, scan, resolved, completed } = session;
  return useMemo(() => {
    const source = { providerId, scan, resolved, completed };
    const selectable = selectableGameIds(source);
    const rows = importRows(
      source,
      libraryImports,
      ignoredProcesses,
      selectable,
    );
    const groups = Object.fromEntries(
      IMPORT_GROUP_ORDER.map((group) => [
        group,
        rows.filter((row) => row.group === group),
      ]),
    ) as Record<ImportGroupKey, ImportRow[]>;
    return { rows, groups, selectable };
  }, [providerId, scan, resolved, completed, libraryImports, ignoredProcesses]);
}

/** The launcher, who is read, and the buttons to change or repeat the scan. */
export function ImportSourceBar({
  session,
  keptLogin,
  health,
  onScanAgain,
  onChange,
  onSignOut,
}: {
  session: ImportSession;
  keptLogin: KeptLogin | null;
  health?: LoginHealth;
  onScanAgain: () => void;
  onChange: () => void;
  onSignOut: () => void;
}) {
  const { providerId } = session;
  const profile = importProfile(providerId);
  const localAccount = session.accounts.find(
    (account) => account.accountId === session.accountId,
  );
  // Xbox, and Steam with one account on this PC, have nothing to choose.
  const hasChoice =
    profile.choice === "accountOrInstalled" ||
    (profile.choice === "localAccounts" && session.accounts.length > 1);
  return (
    <Panel className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <LauncherLogo providerId={providerId} />
      <div className="min-w-0">
        <div className="font-semibold text-text">
          {launcherName(providerId)}
        </div>
        <AccountLine
          login={profile.login}
          keptLogin={keptLogin}
          health={health}
          localAccount={localAccount}
          onSignOut={onSignOut}
          signOutDisabled={session.phase === "importing"}
        />
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        {hasChoice ? (
          <Button
            variant="secondary"
            icon={SlidersHorizontal}
            disabled={session.phase === "importing"}
            onClick={onChange}
          >
            {t("Change what to import")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          icon={RefreshCw}
          disabled={session.phase === "importing" || session.accountId === null}
          onClick={onScanAgain}
        >
          {t("Scan again")}
        </Button>
      </div>
    </Panel>
  );
}

/** Step 3: the shelves filter the list, the picked game sits beside it. */
export function ImportReview({
  session,
  keptLogin,
  health,
  onScanAgain,
  onChange,
  onSignOut,
}: {
  session: ImportSession;
  keptLogin: KeptLogin | null;
  health?: LoginHealth;
  onScanAgain: () => void;
  onChange: () => void;
  onSignOut: () => void;
}) {
  const libraryImports = useAppStore((state) => state.libraryImports);
  const { groups, selectable } = useImportGroups(session);
  const group = session.group;
  const shelf = groups[group];
  const current =
    shelf.find((row) => row.game.externalId === session.current) ?? shelf[0];
  const toDecide = groups.attention.filter(
    (row) => !session.skipped.has(row.game.externalId),
  );
  const index = toDecide.findIndex((row) => row.key === current?.key);
  const nextToDecide =
    toDecide[index + 1] ??
    toDecide.find((row) => row.key !== current?.key) ??
    null;
  const chosen = [...session.selected].filter((id) => selectable.has(id));
  const updates = chosen.filter((id) =>
    libraryImports.has(`${session.providerId}:${id}`),
  ).length;
  const added = chosen.length - updates;

  return (
    <div className="grid gap-4 pb-2">
      <ImportSourceBar
        session={session}
        keptLogin={keptLogin}
        health={health}
        onScanAgain={onScanAgain}
        onChange={onChange}
        onSignOut={onSignOut}
      />
      {session.error ? <ImportError message={session.error} /> : null}
      {session.capability === "unsupported" ? (
        <div className="rounded-lg border border-warning-border bg-warning-tint px-4 py-3 text-sm text-warning">
          {t(
            "PlayCounter cannot look up {{providerName}} games right now. Your library was scanned, but importing is switched off so you do not end up with wrongly named games.",
            { providerName: launcherName(session.providerId) },
          )}
        </div>
      ) : null}
      {session.scan?.warnings.length ? (
        <div className="rounded-lg border border-warning-border bg-warning-tint px-4 py-3 text-sm text-warning">
          {session.scan.warnings.map((warning) => (
            <p key={warning}>{nativeText(warning)}</p>
          ))}
        </div>
      ) : null}
      <ImportShelves
        groups={groups}
        active={group}
        onSelect={showImportGroup}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <ImportQueue
          key={group}
          group={group}
          rows={shelf}
          currentId={current?.game.externalId ?? null}
          selected={session.selected}
          skipped={session.skipped}
          onShow={showImportGame}
          onSelected={setGameSelected}
          onSelectAll={(checked) =>
            setGamesSelected(
              shelf
                .filter((row) => row.selectable)
                .map((row) => row.game.externalId),
              checked,
            )
          }
        />
        {current ? (
          <ImportGameDetail
            key={current.key}
            session={session}
            row={current}
            nextToDecide={nextToDecide?.game.externalId ?? null}
          />
        ) : null}
      </div>
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-raised backdrop-blur">
        <div className="min-w-0">
          <div className="font-semibold text-text">
            {t("{{count}} games selected", { count: chosen.length })}
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-text-muted">
            {chosen.length === 0 ? (
              <span>{t("Check the games you want to import.")}</span>
            ) : null}
            {added > 0 ? (
              <span>{t("{{count}} new", { count: added })}</span>
            ) : null}
            {updates > 0 ? (
              <span>{t("{{count}} updates", { count: updates })}</span>
            ) : null}
          </div>
        </div>
        <div className="flex-1" />
        <Button
          variant="primary"
          icon={Download}
          loading={session.phase === "importing"}
          disabled={chosen.length === 0 || session.capability !== "supported"}
          onClick={() => void importSelectedGames()}
          className="px-5 py-2.5 text-[15px]"
        >
          {t("Import {{count}} games", { count: chosen.length })}
        </Button>
      </div>
    </div>
  );
}
