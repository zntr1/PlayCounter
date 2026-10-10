import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import enAchievements from "./locales/en/achievements.json";
import enCommon from "./locales/en/common.json";
import enDialogs from "./locales/en/dialogs.json";
import enDiscovered from "./locales/en/discovered.json";
import enEmulators from "./locales/en/emulators.json";
import enGames from "./locales/en/games.json";
import enHistory from "./locales/en/history.json";
import enImport from "./locales/en/import.json";
import enMyGames from "./locales/en/myGames.json";
import enNowPlaying from "./locales/en/nowPlaying.json";
import enSettings from "./locales/en/settings.json";
import enShell from "./locales/en/shell.json";
import enSoftware from "./locales/en/software.json";
import enTour from "./locales/en/tour.json";

/* PlayCounter's language. Texts live in src/locales/<language>/<area>.json,
   one file per area. The key is the English text itself, so code reads
   t("Ignore this app?"). English is the source: every language has the same
   keys, and a key a language lacks shows in English. Changing an English
   text changes its key, so every translation of it has to be redone. */

/** Languages PlayCounter has texts for. */
export const APP_LANGUAGES = ["en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** The Settings value: "system" follows the computer's language. */
export type LanguageSetting = "system" | AppLanguage;

/** Each language in its own language, so anyone finds theirs, even in an app
 *  they can't read. */
export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
};

const resources = {
  en: {
    achievements: enAchievements,
    common: enCommon,
    dialogs: enDialogs,
    discovered: enDiscovered,
    emulators: enEmulators,
    games: enGames,
    history: enHistory,
    import: enImport,
    myGames: enMyGames,
    nowPlaying: enNowPlaying,
    settings: enSettings,
    shell: enShell,
    software: enSoftware,
    tour: enTour,
  },
};

type Namespace = keyof (typeof resources)["en"];

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "settings";
    keySeparator: false;
    nsSeparator: false;
    resources: (typeof resources)["en"];
  }
}

void i18next.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "settings",
  // Keys are English sentences: dots and colons are part of the key.
  keySeparator: false,
  nsSeparator: false,
  // React escapes text when it renders it.
  interpolation: { escapeValue: false },
  // Every text ships with the app, so the first render already has them.
  initAsync: false,
});

// {{count, number}} in a text formats like the rest of the app.
i18next.services.formatter?.add("number", (value, _language, options) =>
  Number(value).toLocaleString(appLocale(), options),
);

/** The text function for one area's file, e.g. `const t = getT("myGames")`
 *  at the top of a module. It reads the current language on every call. */
export function getT<N extends Namespace>(namespace: N) {
  return i18next.getFixedT(null, namespace);
}

let currentLocale = formattingLocale("en", systemLocales()[0]);

/** Locale for dates and numbers. Pass it to every toLocale…() and Intl call so
 *  they follow PlayCounter's language, not the computer's. */
export function appLocale() {
  return currentLocale;
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.some((language) => language === value);
}

/** "system", or a language PlayCounter doesn't have, becomes the first of the
 *  computer's languages PlayCounter has, else English. */
export function resolveLanguage(
  setting: string | undefined,
  systemLocales: readonly string[],
): AppLanguage {
  if (isAppLanguage(setting)) return setting;
  for (const locale of systemLocales) {
    const match =
      APP_LANGUAGES.find(
        (language) => language.toLowerCase() === locale.toLowerCase(),
      ) ??
      APP_LANGUAGES.find(
        (language) => baseLanguage(language) === baseLanguage(locale),
      );
    if (match) return match;
  }
  return "en";
}

/** The language "system" stands for on this computer. */
export function systemLanguage() {
  return resolveLanguage("system", systemLocales());
}

/** The app language with the computer's region: English on a German PC is
 *  en-DE, so English words, but day first, a 24-hour clock and 1.234,5. */
export function formattingLocale(
  language: AppLanguage,
  systemLocale: string | undefined,
) {
  if (!systemLocale) return language;
  try {
    const app = new Intl.Locale(language);
    const system = new Intl.Locale(systemLocale);
    if (system.language === app.language) return system.toString();
    if (app.region || !system.region) return language;
    const mixed = `${app.language}-${system.region}`;
    return new Intl.DateTimeFormat(mixed).resolvedOptions().locale === mixed
      ? mixed
      : language;
  } catch {
    return language;
  }
}

/** Monday to Sunday in the app's language: "Mon" or "Monday". */
export function weekdayNames(width: "short" | "long") {
  // 1 January 2024 was a Monday.
  return Array.from({ length: 7 }, (_, day) =>
    new Date(2024, 0, 1 + day).toLocaleDateString(appLocale(), {
      weekday: width,
    }),
  );
}

/** Switches texts, date and number formats and <html lang> to the setting. */
export function applyLanguage(setting: string | undefined) {
  const locales = systemLocales();
  const language = resolveLanguage(setting, locales);
  currentLocale = formattingLocale(language, locales[0]);
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
  if (i18next.language !== language) void i18next.changeLanguage(language);
}

function systemLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

function baseLanguage(locale: string) {
  return locale.split("-")[0].toLowerCase();
}
