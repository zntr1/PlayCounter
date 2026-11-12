import { Download, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
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
  selectableGameIds,
  type ImportSession,
} from "../../library/importSession";
import { useAppStore } from "../../store";
import { Panel } from "../components";
import { Button } from "../primitives";
import { ImportError } from "./ImportError";
import { ImportGameDetail } from "./ImportGameDetail";
import { useImportActions, useImportLibrary } from "./importHost";
import { ImportQueue } from "./ImportQueue";
import { importRows, type ImportRow } from "./importRows";
import { ImportShelves } from "./ImportShelves";
import { launcherName } from "./importTexts";
import { AccountLine, LauncherLogo } from "./LauncherIdentity";

const t = getT("import");
const tc = getT("common");

/** Rows of the scan, sorted onto the four shelves. Showing, checking or
 *  skipping a game leaves them as they are. */
export function useImportGroups(session: ImportSession) {
  const { libraryImports, ignoredProcesses } = useImportLibrary();
  const { providerId, scan, resolved, saved, replacements, completed } =
    session;
  return useMemo(() => {
    const source = {
      providerId,
      scan,
      resolved,
      saved,
      replacements,
      completed,
    };
    const selectable = selectableGameIds(source, {
      libraryImports,
      ignoredProcesses,
    });
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
    // Games in My Games with new playtime come first, as the list shows them.
    groups.imported = [
      ...groups.imported.filter((row) => row.newPlaytime),
      ...groups.imported.filter((row) => !row.newPlaytime),
    ];
    return { rows, groups, selectable };
  }, [
    providerId,
    scan,
    resolved,
    saved,
    replacements,
    completed,
    libraryImports,
    ignoredProcesses,
  ]);
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
    <Panel
      dataTour="import-source"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
    >
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

/** How tall the list and the game's box must be to end at the bottom of the
 *  content area, whatever sits above them (warnings, notices, shelves on two
 *  lines) or below them (the import bar). Measured, so nothing above can push
 *  Import out of the window. In the content's own pixels: the content area is
 *  zoomed, and its zoom turns window pixels into them. */
function usePaneHeight(
  rootRef: RefObject<HTMLElement | null>,
  panesRef: RefObject<HTMLElement | null>,
) {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const panes = panesRef.current;
    // The app's content area, or the guide's sample of this page.
    const content = root?.closest<HTMLElement>(
      "[data-controller-content], [data-import-content]",
    );
    if (!root || !panes || !content || typeof ResizeObserver === "undefined")
      return;
    const measure = () => {
      const area = content.getBoundingClientRect();
      const zoom = area.height / content.offsetHeight || 1;
      const box = panes.getBoundingClientRect();
      // Counted from the top of the page, so scrolling changes nothing.
      const top = (box.top - area.top) / zoom + content.scrollTop;
      const below = (root.getBoundingClientRect().bottom - box.bottom) / zoom;
      const padding = parseFloat(getComputedStyle(content).paddingBottom) || 0;
      setHeight(Math.floor(content.clientHeight - padding - top - below));
    };
    measure();
    // The window, and anything in the review above or below the panes.
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef, panesRef]);
  return height;
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
  const actions = useImportActions();
  const { libraryImports } = useImportLibrary();
  const rootRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const paneHeight = usePaneHeight(rootRef, panesRef);
  const closedWarnings = useAppStore((state) => state.closedScanWarnings);
  const warnings = (session.scan?.warnings ?? []).filter(
    (warning) => !closedWarnings.includes(warning),
  );
  const { groups } = useImportGroups(session);
  const group = session.group;
  const shelf = groups[group];
  // The bar belongs to tabs with checkboxes, and imports the open tab only.
  // "Needs you" imports game by game; every tab keeps its own checks.
  const checkable = shelf.some((row) => row.selectable);
  const current =
    shelf.find((row) => row.game.externalId === session.current) ?? shelf[0];
  // A game still being saved is decided: it leaves the list in a moment.
  const toDecide = groups.attention.filter(
    (row) =>
      !session.skipped.has(row.game.externalId) &&
      (row.key === current?.key || !session.importing.has(row.game.externalId)),
  );
  const index = toDecide.findIndex((row) => row.key === current?.key);
  const nextToDecide =
    toDecide[index + 1] ??
    toDecide.find((row) => row.key !== current?.key) ??
    null;
  const chosen = shelf
    .filter(
      (row) => row.selectable && session.selected.has(row.game.externalId),
    )
    .map((row) => row.game.externalId);
  const updates = chosen.filter((id) =>
    libraryImports.has(`${session.providerId}:${id}`),
  ).length;
  const added = chosen.length - updates;

  return (
    <div ref={rootRef} className="grid gap-4 pb-2">
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
      {warnings.length ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-tint py-3 pl-4 pr-2 text-sm text-warning">
          <div className="min-w-0 flex-1">
            {warnings.map((warning) => (
              <p key={warning}>{nativeText(warning)}</p>
            ))}
          </div>
          {/* Closed for good: these warnings never show again. */}
          <button
            type="button"
            aria-label={tc("Close")}
            title={tc("Close")}
            onClick={() => useAppStore.getState().closeScanWarnings(warnings)}
            className="-my-1 grid h-7 w-7 shrink-0 place-items-center rounded-md transition hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <ImportShelves
        groups={groups}
        active={group}
        onSelect={actions.showGroup}
      />
      <div
        ref={panesRef}
        className="grid items-start gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]"
        style={
          paneHeight === null
            ? undefined
            : ({
                "--import-pane-height": `${paneHeight}px`,
              } as CSSProperties)
        }
      >
        <ImportQueue
          key={group}
          group={group}
          rows={shelf}
          currentId={current?.game.externalId ?? null}
          selected={session.selected}
          skipped={session.skipped}
          onShow={actions.showGame}
          onSelected={actions.setGameSelected}
          onSelectAll={(checked) =>
            actions.setGamesSelected(
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
      {checkable ? (
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
            icon={group === "imported" ? RefreshCw : Download}
            loading={session.phase === "importing"}
            disabled={chosen.length === 0 || session.capability !== "supported"}
            onClick={() => actions.importSelected(chosen)}
            data-tour="import-selected"
            className="px-5 py-2.5 text-[15px]"
          >
            {group === "imported"
              ? t("Update {{count}} games", { count: chosen.length })
              : t("Import {{count}} games", { count: chosen.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
