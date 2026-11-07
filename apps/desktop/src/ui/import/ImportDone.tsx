import clsx from "clsx";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { Trans } from "react-i18next";
import { getT } from "../../i18n";
import { importProfile } from "../../library/importProfiles";
import {
  notImportedText,
  reviewRemainingGames,
  showImportList,
  showImportUpdates,
  type ImportSession,
} from "../../library/importSession";
import { useAppStore } from "../../store";
import { Panel } from "../components";
import { GameCover } from "../GameCover";
import { Button } from "../primitives";
import { useImportGroups } from "./ImportReview";
import { launcherName } from "./importTexts";

const t = getT("import");

/** Step 4: what the import brought, and what is left. */
export function ImportDone({ session }: { session: ImportSession }) {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setLibraryTab = useAppStore((state) => state.setLibraryTab);
  const { rows, groups } = useImportGroups(session);
  const profile = importProfile(session.providerId);
  const providerName = launcherName(session.providerId);
  const added = session.lastImport?.added ?? [];
  const updated = session.lastImport?.updated ?? 0;
  const notImported = session.lastImport?.notImported ?? [];
  const remaining = groups.attention.filter((row) => !row.completed).length;
  // Games in My Games with new playtime wait on their own tab.
  const updates = groups.imported.filter((row) => row.newPlaytime).length;
  const covers = rows
    .filter((row) => added.includes(row.game.externalId) && row.coverUrl)
    .slice(0, 5);
  return (
    <Panel className="grid items-center gap-8 p-8 md:grid-cols-[auto_minmax(0,1fr)]">
      {covers.length > 0 ? (
        <div aria-hidden="true" className="flex justify-center pl-8">
          {covers.map((row, index) => (
            <GameCover
              key={row.key}
              src={row.coverUrl!}
              alt=""
              className={clsx(
                "-ml-8 h-[123px] w-[92px] rounded-lg border-[3px] border-surface object-cover shadow-raised",
                index % 2 === 0
                  ? "-rotate-[5deg]"
                  : "translate-y-1.5 rotate-[4deg]",
              )}
            />
          ))}
        </div>
      ) : null}
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-tight text-text">
          {added.length > 0
            ? t("{{count}} games imported from {{providerName}}", {
                count: added.length,
                providerName,
              })
            : t("{{count}} games in My Games updated", { count: updated })}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">
          {profile.hasPlaytime ? (
            t(
              "Their playtime is in My Games now. New sessions are tracked automatically.",
            )
          ) : (
            <>
              {t(
                "They are in My Games now. New sessions are tracked automatically.",
              )}{" "}
              <Trans
                t={t}
                i18nKey="After importing, right-click a game in <strong>My Games</strong> and choose <strong>Adjust total playtime</strong>."
                components={{ strong: <strong className="text-text" /> }}
              />
            </>
          )}
        </p>
        {(added.length > 0 && updated > 0) ||
        notImported.length > 0 ||
        remaining > 0 ||
        updates > 0 ? (
          <ul className="mt-4 grid gap-1.5 text-sm text-text-muted">
            {added.length > 0 && updated > 0 ? (
              <li className="flex items-center gap-2">
                <Check size={16} aria-hidden="true" className="text-success" />
                {t("{{count}} games in My Games updated", { count: updated })}
              </li>
            ) : null}
            {notImported.map((name, index) => (
              <li key={index} className="flex items-center gap-2">
                <AlertTriangle
                  size={16}
                  aria-hidden="true"
                  className="text-accent-ink"
                />
                {notImportedText(name)}
              </li>
            ))}
            {remaining > 0 ? (
              <li className="flex items-center gap-2">
                <AlertTriangle
                  size={16}
                  aria-hidden="true"
                  className="text-accent-ink"
                />
                {t("{{count}} games still need you", { count: remaining })}
              </li>
            ) : null}
            {updates > 0 ? (
              <li className="flex items-center gap-2">
                <RefreshCw
                  size={16}
                  aria-hidden="true"
                  className="text-accent-ink"
                />
                {t("{{count}} games in My Games have new playtime", {
                  count: updates,
                })}
              </li>
            ) : null}
          </ul>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              setLibraryTab(session.providerId);
              setActiveView("games");
            }}
            className="px-5 py-2.5 text-[15px]"
          >
            {t("Open My Games")}
          </Button>
          {remaining > 0 ? (
            <Button
              variant="secondary"
              onClick={reviewRemainingGames}
              className="px-5 py-2.5 text-[15px]"
            >
              {t("Review {{count}} games", { count: remaining })}
            </Button>
          ) : null}
          {updates > 0 ? (
            <Button
              variant="secondary"
              onClick={showImportUpdates}
              className="px-5 py-2.5 text-[15px]"
            >
              {t("Show updates")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={showImportList}>
            {t("Back to the importer")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
