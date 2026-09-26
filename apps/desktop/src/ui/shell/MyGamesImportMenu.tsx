import type { RefObject } from "react";
import { currentPlatform } from "../../platform";
import { useAppStore } from "../../store";
import {
  ContextMenu,
  ContextMenuHeading,
  ContextMenuItem,
} from "../ContextMenu";
import { importableProviderTabs } from "../libraryProviderTabs";

/* Right-click on "My Games" in the sidebar: a shortcut to every importer
   this platform supports, the same list the empty library offers. */

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
  const providers = importableProviderTabs(currentPlatform());

  if (providers.length === 0) return null;

  return (
    <ContextMenu
      open={open}
      position={position}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="Import games"
      focusFirstItem
    >
      <ContextMenuHeading>Import games</ContextMenuHeading>
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
    </ContextMenu>
  );
}
