import { currentPlatform } from "./platform";

export function isMacOS() {
  return currentPlatform() === "macos";
}

/** App shortcuts use Cmd on macOS and Ctrl everywhere else. */
export function hasShortcutModifier(
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
) {
  return isMacOS()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** How a shortcut is written in tooltips: "⌘B" on macOS, "Ctrl+B" elsewhere. */
export function shortcutLabel(key: string) {
  return isMacOS() ? `⌘${key}` : `Ctrl+${key}`;
}
