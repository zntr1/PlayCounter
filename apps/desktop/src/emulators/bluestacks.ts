import { isShareableHint, isShareableToken } from "./signals";
import type { EmulatorAdapter } from "./types";
import { getT } from "../i18n";

const t = getT("emulators");

/**
 * Android itself, BlueStacks' own apps (home screen, app center, ads) and
 * the system apps of Android and Google (Play Store, recent apps, Play
 * services). None of them is a game.
 */
const SYSTEM_PACKAGE =
  /^(?:android$|com\.bluestacks\.|com\.uncube\.|com\.android\.|com\.google\.android\.)/i;

/**
 * Google Play's categories for apps that are no games, as BlueStacks' app
 * list names them. "Sports" is missing on purpose: games have a category of
 * the same name. A category that is not listed here counts as a game, so an
 * unknown or translated name never hides one.
 */
const OTHER_APP_CATEGORIES = new Set(
  [
    "Art & Design",
    "Auto & Vehicles",
    "Beauty",
    "Books & Reference",
    "Business",
    "Comics",
    "Communication",
    "Dating",
    "Education",
    "Entertainment",
    "Events",
    "Finance",
    "Food & Drink",
    "Health & Fitness",
    "House & Home",
    "Libraries & Demo",
    "Lifestyle",
    "Maps & Navigation",
    "Medical",
    "Music & Audio",
    "News & Magazines",
    "Parenting",
    "Personalization",
    "Photography",
    "Productivity",
    "Shopping",
    "Social",
    "Tools",
    "Travel & Local",
    "Video Players & Editors",
    "Weather",
  ].map(categoryKey),
);

/** "Music & Audio", "music and audio" and "MUSIC_AND_AUDIO" are one category. */
function categoryKey(category: string) {
  return category
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]/g, "");
}

/**
 * BlueStacks runs Android in a VM, so Windows only sees HD-Player.exe, and
 * its window title never names the game. The scanner reads the app in front
 * from BlueStacks' own log instead (ProcessSnapshot.foregroundApp). The app's
 * package is its Google Play ID. Minimizing BlueStacks changes nothing here,
 * so time keeps counting.
 */
export const bluestacksAdapter: EmulatorAdapter = {
  id: "bluestacks",
  label: "BlueStacks",
  platformLabel: "Android",
  // A getter, so the text follows the current language.
  get subtitle() {
    return t("Android games, mappings, and emulator playtime");
  },
  exeNames: ["hd-player.exe"],
  read(signals, context) {
    const app = signals.foregroundApp;
    if (!app) return { state: "unidentified", reason: "no-signal" };
    if (
      SYSTEM_PACKAGE.test(app.package) ||
      OTHER_APP_CATEGORIES.has(categoryKey(app.category ?? ""))
    ) {
      return { state: "idle" };
    }
    const label = app.label?.trim() || undefined;
    const shareable =
      // The API takes 2 to 96 characters that start with a letter or digit.
      /^[a-z0-9].{1,95}$/i.test(app.package) &&
      isShareableToken({
        value: app.package.toLowerCase(),
        kind: "title_id",
        trust: "recognized",
        privateTokens: context.privateTokens,
      });
    return {
      state: "content",
      content: {
        kind: "title_id",
        value: app.package,
        display: label ?? app.package,
        trust: "recognized",
        shareable,
        volatile: true,
        detectionSource: "activity_log",
        searchHint: label,
        shareableSearchHint:
          shareable && isShareableHint(label, context.privateTokens),
      },
    };
  },
};
