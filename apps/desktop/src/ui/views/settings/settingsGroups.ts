import { currentPlatform } from "../../../platform";

/** The groups of the Settings menu, in menu order. Kept free of React and of
 *  the store, because the store and the Quick Tour read it too. */
export const SETTINGS_GROUP_IDS = [
  "general",
  "appearance",
  "shortcuts",
  "play",
  "popups",
  "launching",
  "library",
  "emulators",
  "discovery",
  "backup",
  "about",
] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number];

export const DEFAULT_SETTINGS_GROUP: SettingsGroupId = "general";

/** Whether this computer shows the group. Desktop popups (and the overlays
 *  of While you play) don't exist on macOS; starting games is Windows only. */
export function settingsGroupAvailable(group: SettingsGroupId) {
  const platform = currentPlatform();
  if (group === "play" || group === "popups") return platform !== "macos";
  if (group === "launching") return platform === "windows";
  return true;
}

export function availableSettingsGroups() {
  return SETTINGS_GROUP_IDS.filter(settingsGroupAvailable);
}

// Controls inside an available group that only Windows shows.
const WINDOWS_ONLY_TOUR_ANCHORS = [
  "settings-auto-add",
  "settings-watch-folders",
  "settings-watch-folders-add",
  "settings-watch-folders-dismissed",
];

/** Whether a Quick Tour step that opens `group` finds its control on this
 *  computer. The tour asks before it opens the group, so it can't look. */
export function settingsTourAnchorAvailable(
  group: SettingsGroupId,
  anchor: string | undefined,
) {
  if (!settingsGroupAvailable(group)) return false;
  if (
    anchor &&
    currentPlatform() !== "windows" &&
    WINDOWS_ONLY_TOUR_ANCHORS.some((name) =>
      anchor.includes(`data-tour="${name}"`),
    )
  )
    return false;
  return true;
}
