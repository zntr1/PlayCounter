import type { RefObject } from "react";
import { Download, UsersRound } from "lucide-react";
import { currentPlatform } from "../../platform";
import { useAppStore } from "../../store";
import { ContextMenu, ContextMenuItem } from "../ContextMenu";
import { importableProviderTabs } from "../libraryProviderTabs";
import type { LibraryTabDescriptor } from "../libraryTabs";
import { getT } from "../../i18n";

const t = getT("shell");
const accountsT = getT("accounts");

/* Right-click on a launcher or on PlayCounter under My Games in the sidebar.
   Import games opens the same import page as "Import more from …" in My
   Games, and only where that button shows. */

export function SourceMenu({
  source,
  open,
  position,
  onClose,
  anchorRef,
}: {
  source: LibraryTabDescriptor;
  open: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setLibraryImportProvider = useAppStore(
    (state) => state.setLibraryImportProvider,
  );
  const importable = importableProviderTabs(currentPlatform()).find(
    (config) => config.id === source.id,
  );

  return (
    <ContextMenu
      open={open}
      position={position}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel={source.label}
      focusFirstItem
    >
      <ContextMenuItem
        icon={UsersRound}
        onClick={() => {
          onClose();
          setActiveView("accounts");
        }}
      >
        {accountsT("Manage accounts")}
      </ContextMenuItem>
      {importable ? (
        <ContextMenuItem
          icon={Download}
          onClick={() => {
            onClose();
            setLibraryImportProvider(importable.id);
            setActiveView("import");
          }}
        >
          {t("Import games")}
        </ContextMenuItem>
      ) : null}
    </ContextMenu>
  );
}
