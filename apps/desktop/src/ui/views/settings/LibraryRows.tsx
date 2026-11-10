import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import type { LibraryProviderId } from "@playcounter/shared";
import { ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { getT } from "../../../i18n";
import { useAppStore } from "../../../store";
import { ProviderBadge } from "../../components";
import { ForgetImportDialog } from "../../ForgetImportDialog";
import { Button, Switch } from "../../primitives";
import { SettingsRow, type SettingsRowProps } from "./SettingsKit";

const t = getT("settings");
const accountsT = getT("accounts");

export function AutoAddGamesRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.autoAddInstalledGames !== false,
  );
  const setAutoAddInstalledGames = useAppStore(
    (state) => state.setAutoAddInstalledGames,
  );
  return (
    <SettingsRow
      id="autoAddInstalledGames"
      dataTour="settings-auto-add"
      level={level}
      disabled={disabled}
      title={t("Add new games automatically")}
      description={t(
        "After your first import from Steam, Battle.net, Epic Games or GOG, games you install there show up in My Games on their own, and so do new games you play on PlayStation. Games you remove from PlayCounter are not added again. Xbox games still need an Xbox import, because Xbox does not tell PlayCounter which game an installation is.",
      )}
      control={
        <Switch
          aria-label={t("Add new games automatically")}
          checked={checked}
          disabled={disabled}
          onChange={(event) => setAutoAddInstalledGames(event.target.checked)}
        />
      }
    />
  );
}

export function LauncherAccountsRow({ level, disabled }: SettingsRowProps) {
  return (
    <SettingsRow
      id="launcherAccounts"
      level={level}
      disabled={disabled}
      title={accountsT("Launcher accounts")}
      description={accountsT("Manage your launcher connections in one place.")}
      control={
        <Button
          disabled={disabled}
          onClick={() => useAppStore.getState().setActiveView("accounts")}
        >
          {accountsT("Manage accounts")}
          <ChevronRight size={15} aria-hidden="true" />
        </Button>
      }
    />
  );
}

const PROVIDERS: readonly LibraryProviderId[] = [
  "steam",
  "xbox",
  "battlenet",
  "epic",
  "gog",
  "playstation",
];

/** One list for every launcher import, with a Forget each. */
export function ForgetImportsRow({ level, disabled }: SettingsRowProps) {
  const libraryImports = useAppStore((state) => state.libraryImports);
  const [confirm, setConfirm] = useState<LibraryProviderId | null>(null);
  const counts = new Map<LibraryProviderId, number>();
  for (const entry of libraryImports.values())
    counts.set(entry.provider, (counts.get(entry.provider) ?? 0) + 1);
  return (
    <>
      <SettingsRow
        id="forgetImports"
        level={level}
        disabled={disabled}
        title={t("Forget imported data")}
        description={t(
          "Forget removes what one import added. Sessions PlayCounter recorded itself are always kept.",
        )}
        below={
          <ul className="overflow-hidden rounded-[10px] border border-border">
            {PROVIDERS.map((provider) => {
              const count = counts.get(provider) ?? 0;
              return (
                <li
                  key={provider}
                  className="flex min-h-11 items-center gap-3 border-border/60 bg-bg/35 py-1.5 pl-3 pr-2 [&:not(:first-child)]:border-t"
                >
                  <ProviderBadge provider={provider} variant="mark" />
                  <b
                    className={
                      count
                        ? "min-w-0 flex-1 truncate text-sm font-medium text-text"
                        : "min-w-0 flex-1 truncate text-sm font-medium text-text-faint"
                    }
                  >
                    {LIBRARY_PROVIDER_LABELS[provider]}
                  </b>
                  <span
                    className={
                      count
                        ? "whitespace-nowrap text-[13px] text-text-muted"
                        : "whitespace-nowrap text-[13px] text-text-faint"
                    }
                  >
                    {count
                      ? t("{{count}} games", { count })
                      : t("Nothing imported")}
                  </span>
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    disabled={disabled || count === 0}
                    className="h-[30px] px-2.5 text-[13px] text-danger hover:bg-danger-tint hover:text-danger"
                    onClick={() => setConfirm(provider)}
                  >
                    {t("Forget")}
                  </Button>
                </li>
              );
            })}
          </ul>
        }
      />
      {confirm ? (
        <ForgetImportDialog
          provider={confirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
