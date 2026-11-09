import { create } from "zustand";
import { nativeText } from "../../../nativeText";

/** Work in progress that other rows must wait for: Reset waits for an
 *  import, an export, an update install and the auto-start check. */
export const useSettingsOps = create<{
  startupSyncing: boolean;
  startupError: string | null;
  importing: boolean;
  exporting: boolean;
  installingUpdate: boolean;
}>(() => ({
  startupSyncing: false,
  startupError: null,
  importing: false,
  exporting: false,
  installingUpdate: false,
}));

export function setSettingsOp(
  patch: Partial<ReturnType<typeof useSettingsOps.getState>>,
) {
  useSettingsOps.setState(patch);
}

export function formatError(error: unknown) {
  return nativeText(error instanceof Error ? error.message : String(error));
}
