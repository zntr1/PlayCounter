import { useAppStore } from "../store";

/** Settings, on Keyboard shortcuts. A dialog open on another page closes
 *  with that page. */
export function openKeyboardShortcuts() {
  const store = useAppStore.getState();
  store.setSettingsGroup("shortcuts");
  store.setActiveView("settings");
}
