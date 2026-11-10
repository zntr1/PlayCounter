import type { RefObject } from "react";
import { currentPlatform } from "../../platform";
import { useAppStore } from "../../store";
import {
  ContextMenu,
  ContextMenuHeading,
  ContextMenuItem,
} from "../ContextMenu";
import { useLibrarySources } from "../librarySources";
import { importableProviderTabs } from "../libraryProviderTabs";
import { getT } from "../../i18n";

const t = getT("shell");

/* Right-click on "My Games" in the sidebar: a shortcut to every importer
   this platform supports, the same list the empty library offers, and the
   switches for what the sidebar lists under My Games. */

export function MyGamesImportMenu({
  open,
  position,
  onClose,
  anchorRef,
}: {
  open: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setLibraryImportProvider = useAppStore(
    (state) => state.setLibraryImportProvider,
  );
  const showProviderTabs = useAppStore(
    (state) => state.settings.libraryShowProviderTabs !== false,
  );
  const setMyGamesShowProviderTabs = useAppStore(
    (state) => state.setMyGamesShowProviderTabs,
  );
  const hideEmptyProviderTabs = useAppStore(
    (state) => state.settings.libraryHideEmptyProviderTabs === true,
  );
  const setMyGamesHideEmptyProviderTabs = useAppStore(
    (state) => state.setMyGamesHideEmptyProviderTabs,
  );
  const canHideEmptySources = useLibrarySources(
    (state) => state.canHideEmptySources,
  );
  const providers = importableProviderTabs(currentPlatform());

  return (
    <ContextMenu
      open={open}
      position={position}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel={t("My Games")}
      focusFirstItem
    >
      {providers.length > 0 ? (
        <>
          <ContextMenuHeading>{t("Import games")}</ContextMenuHeading>
          <ContextMenuItem
            onClick={() => {
              onClose();
              setActiveView("accounts");
            }}
          >
            {getT("accounts")("Manage accounts")}
          </ContextMenuItem>
          {providers.map((config) => (
            <ContextMenuItem
              key={config.id}
              onClick={() => {
                onClose();
                setLibraryImportProvider(config.id);
                setActiveView("import");
              }}
            >
              <span className="flex items-center gap-2">
                {config.iconUrl ? (
                  <img
                    src={config.iconUrl}
                    alt=""
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 object-contain"
                  />
                ) : null}
                {config.firstImportCtaLabel}
              </span>
            </ContextMenuItem>
          ))}
        </>
      ) : null}
      <ContextMenuHeading>{t("Sidebar")}</ContextMenuHeading>
      <ContextMenuItem
        selected={showProviderTabs}
        onClick={() => {
          onClose();
          setMyGamesShowProviderTabs(!showProviderTabs);
        }}
      >
        {t("Launcher groups")}
      </ContextMenuItem>
      {showProviderTabs && canHideEmptySources ? (
        <ContextMenuItem
          selected={hideEmptyProviderTabs}
          onClick={() => {
            onClose();
            setMyGamesHideEmptyProviderTabs(!hideEmptyProviderTabs);
          }}
        >
          {t("Hide empty sources")}
        </ContextMenuItem>
      ) : null}
    </ContextMenu>
  );
}
