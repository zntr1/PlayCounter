import { useState, type RefObject } from "react";
import type { LibraryProviderId } from "@playcounter/shared";
import { Download, Trash2, UsersRound } from "lucide-react";
import { currentPlatform } from "../../platform";
import { useAppStore } from "../../store";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu";
import { ForgetImportDialog } from "../ForgetImportDialog";
import { importableProviderTabs } from "../libraryProviderTabs";
import type { LibraryTabDescriptor } from "../libraryTabs";
import { getT } from "../../i18n";

const t = getT("shell");
const accountsT = getT("accounts");
const settingsT = getT("settings");

/* Right-click on a launcher or on PlayCounter under My Games in the sidebar.
   Import games opens the same import page as "Import more from …" in My
   Games, and only where that button shows. Forget imported data opens the
   same dialog as its Forget in Settings, and only where that one is enabled:
   while the launcher has imports. */

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
  const provider: LibraryProviderId | null =
    source.id === "all" || source.id === "unimported" ? null : source.id;
  const hasImports = useAppStore((state) => {
    if (!provider) return false;
    for (const entry of state.libraryImports.values())
      if (entry.provider === provider) return true;
    return false;
  });
  const [forgetting, setForgetting] = useState<LibraryProviderId | null>(null);

  return (
    <>
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
        {provider && hasImports ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              icon={Trash2}
              danger
              onClick={() => {
                onClose();
                setForgetting(provider);
              }}
            >
              {settingsT("Forget imported data")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenu>
      {forgetting ? (
        <ForgetImportDialog
          provider={forgetting}
          onClose={() => setForgetting(null)}
        />
      ) : null}
    </>
  );
}
