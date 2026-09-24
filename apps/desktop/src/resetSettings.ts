import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { saveHotkey } from "./hotkeys";
import { isPersistenceSuspended } from "./persistence";
import { createDefaultSettings, useAppStore } from "./store";

/** Restore app preferences without touching library data or backup preferences. */
export async function resetSettings() {
  if (isPersistenceSuspended()) throw new Error("PlayCounter is being reset.");
  const defaults = createDefaultSettings();
  const startupEnabled = await isEnabled();
  if (startupEnabled !== defaults.launchOnStartup) {
    if (defaults.launchOnStartup) await enable();
    else await disable();
  }
  // Keep the saved preference consistent with each successful native change,
  // even when a later step fails and the user needs to retry.
  useAppStore.getState().setLaunchOnStartup(defaults.launchOnStartup);
  await saveHotkey("showWindowHotkey", defaults.showWindowHotkey ?? null);
  await saveHotkey(
    "currentSessionHotkey",
    defaults.currentSessionHotkey ?? null,
  );
  useAppStore.getState().restoreDefaultSettings();
}
